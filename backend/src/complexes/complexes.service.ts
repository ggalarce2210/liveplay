import { Injectable } from '@nestjs/common';
import { and, eq, asc, ilike, isNotNull } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { complexes, courts, subscriptions } from '../db/schema';

type SportType = 'FUTBOL5' | 'PADEL';

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

  async create(data: { name: string; address?: string; city?: string; timezone?: string; openingHours?: any }) {
    return this.db.transaction(async (tx) => {
      const [complex] = await tx.insert(complexes).values(data).returning();
      await tx.insert(subscriptions).values({ complexId: complex.id });
      return complex;
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
