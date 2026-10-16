import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { and, eq, asc, ilike, isNotNull } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { DbService } from '../db/db.service';
import { complexes, courts, subscriptions, users } from '../db/schema';

type SportType = 'FUTBOL5' | 'PADEL';

/**
 * Contraseña temporal del administrador que se crea junto con el complejo (ver `create` más
 * abajo) — se muestra UNA SOLA VEZ en la respuesta del alta, nunca se guarda en texto plano ni
 * se vuelve a poder consultar; el SUPER_ADMIN que da de alta el complejo se la tiene que pasar
 * al dueño por fuera del sistema. Alfabeto sin caracteres ambiguos (0/O, 1/l/I) para que sea
 * fácil de transcribir a mano si hace falta.
 */
function generateTempPassword(): string {
  const charset = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += charset[bytes[i] % charset.length];
  return out;
}

@Injectable()
export class ComplexesService {
  constructor(private dbService: DbService) {}
  private get db() {
    return this.dbService.db;
  }

  /**
   * Listado público del buscador (§5.1): filtra por ciudad (case-insensitive) y, si se pide un
   * deporte, solo devuelve complejos que tengan al menos una cancha activa de ese deporte —
   * dentro de `courts` además se recorta a solo las canchas de ese deporte, para que el
   * frontend no tenga que volver a filtrar. El filtro de deporte se aplica en memoria porque
   * `with` no soporta condicionar el include por una columna de la tabla relacionada; a la
   * escala de "complejos por ciudad" esto es instantáneo (mismo criterio que en matches.service).
   */
  async list(filters: { city?: string; sportType?: SportType } = {}) {
    const all = await this.db.query.complexes.findMany({
      where: filters.city ? ilike(complexes.city, `%${filters.city}%`) : undefined,
      with: { courts: true, subscription: true },
      orderBy: [asc(complexes.name)],
    });

    if (!filters.sportType) return all;

    return all
      .map((c) => ({ ...c, courts: c.courts.filter((court) => court.sportType === filters.sportType) }))
      .filter((c) => c.courts.length > 0);
  }

  /** Ciudades con al menos un complejo (y, si se filtra por deporte, con al menos una cancha
   * de ese deporte) — alimenta el paso "elegí tu ciudad" del buscador. */
  async cities(sportType?: SportType): Promise<string[]> {
    const rows = sportType
      ? await this.db
          .selectDistinct({ city: complexes.city })
          .from(complexes)
          .innerJoin(courts, eq(courts.complexId, complexes.id))
          .where(and(isNotNull(complexes.city), eq(courts.sportType, sportType)))
      : await this.db.selectDistinct({ city: complexes.city }).from(complexes).where(isNotNull(complexes.city));

    return (rows.map((r) => r.city).filter(Boolean) as string[]).sort((a, b) => a.localeCompare(b));
  }

  get(id: string) {
    return this.db.query.complexes.findFirst({
      where: eq(complexes.id, id),
      with: { courts: { with: { camera: true } }, subscription: true },
    });
  }

  /**
   * Alta de un complejo (2026-10-16): cada complejo es un cliente propio, con su propio usuario
   * administrador (`COMPLEX_ADMIN`, `managedComplexId` apuntando a este complejo) — necesario
   * para que después pueda entrar a conectar su cuenta de Mercado Pago y ver sus pagos (ver
   * `MercadopagoService`). La contraseña se genera acá mismo y se devuelve en texto plano SOLO
   * en esta respuesta (ver `generateTempPassword`); nunca se persiste ni se loguea en claro.
   * No pasa por `AuthService.register` a propósito: ese flujo exige verificar el email antes de
   * poder loguearse, pero acá es el SUPER_ADMIN quien da de alta a otra persona, no un
   * self-signup, así que la cuenta queda verificada desde el vamos.
   */
  async create(data: {
    name: string;
    address?: string;
    city?: string;
    timezone?: string;
    openingHours?: any;
    adminEmail: string;
    adminFirstName: string;
    adminLastName: string;
  }) {
    if (!data.adminEmail || !data.adminFirstName || !data.adminLastName) {
      throw new BadRequestException('Falta el email, nombre o apellido del administrador del complejo');
    }
    const existing = await this.db.query.users.findFirst({ where: eq(users.email, data.adminEmail) });
    if (existing) throw new ConflictException('Ya existe un usuario con ese email');

    const adminTempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(adminTempPassword, 12);

    return this.db.transaction(async (tx) => {
      const [complex] = await tx
        .insert(complexes)
        .values({ name: data.name, address: data.address, city: data.city, timezone: data.timezone, openingHours: data.openingHours })
        .returning();
      await tx.insert(subscriptions).values({ complexId: complex.id });
      const [admin] = await tx
        .insert(users)
        .values({
          email: data.adminEmail,
          passwordHash,
          firstName: data.adminFirstName,
          lastName: data.adminLastName,
          role: 'COMPLEX_ADMIN',
          managedComplexId: complex.id,
          emailVerifiedAt: new Date(),
        })
        .returning();
      return {
        complex,
        admin: { id: admin.id, email: admin.email, firstName: admin.firstName, lastName: admin.lastName },
        adminTempPassword,
      };
    });
  }

  async update(id: string, data: any) {
    const [updated] = await this.db.update(complexes).set({ ...data, updatedAt: new Date() }).where(eq(complexes.id, id)).returning();
    return updated;
  }

  async remove(id: string) {
    const [deleted] = await this.db.delete(complexes).where(eq(complexes.id, id)).returning();
    return deleted;
  }
}
