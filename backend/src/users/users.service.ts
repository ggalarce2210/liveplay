import { Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { users, matchPlayers, matches, userFavoriteComplexes } from '../db/schema';

@Injectable()
export class UsersService {
  constructor(private dbService: DbService) {}
  private get db() {
    return this.dbService.db;
  }

  async updateProfile(userId: string, data: { firstName?: string; lastName?: string; phone?: string; avatarUrl?: string; homeComplexId?: string }) {
    const [updated] = await this.db.update(users).set({ ...data, updatedAt: new Date() }).where(eq(users.id, userId)).returning();
    return updated;
  }

  /**
   * Lista las canchas favoritas del usuario (2026-10-22, ver comentario grande en
   * `userFavoriteComplexes` en schema.ts). Devuelve los `Complex` completos (con sus canchas
   * anidadas, igual que antes `GET /complexes/:id`) para que el dashboard pueda armar de una el
   * filtro de "Cancha"/"Deporte" sin otra ida y vuelta.
   *
   * Migración perezosa: si el usuario todavía no tiene ningún favorito pero sí tiene un
   * `homeComplexId` viejo guardado (de antes de este cambio, cuando "Mis partidos" solo
   * soportaba un complejo fijo), ese valor se convierte acá mismo en su primer favorito — así
   * nadie que ya había elegido su cancha pierde esa elección al pasar a este modelo nuevo.
   */
  async listFavoriteComplexes(userId: string) {
    let rows = await this.db.query.userFavoriteComplexes.findMany({
      where: eq(userFavoriteComplexes.userId, userId),
      with: { complex: { with: { courts: true } } },
      orderBy: (f, { asc }) => [asc(f.createdAt)],
    });

    if (rows.length === 0) {
      const user = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
      if (user?.homeComplexId) {
        await this.db.insert(userFavoriteComplexes).values({ userId, complexId: user.homeComplexId }).onConflictDoNothing();
        rows = await this.db.query.userFavoriteComplexes.findMany({
          where: eq(userFavoriteComplexes.userId, userId),
          with: { complex: { with: { courts: true } } },
          orderBy: (f, { asc }) => [asc(f.createdAt)],
        });
      }
    }

    return rows.map((r) => r.complex);
  }

  async addFavoriteComplex(userId: string, complexId: string) {
    await this.db.insert(userFavoriteComplexes).values({ userId, complexId }).onConflictDoNothing();
    return this.listFavoriteComplexes(userId);
  }

  async removeFavoriteComplex(userId: string, complexId: string) {
    await this.db
      .delete(userFavoriteComplexes)
      .where(and(eq(userFavoriteComplexes.userId, userId), eq(userFavoriteComplexes.complexId, complexId)));
    return this.listFavoriteComplexes(userId);
  }

  async getMatchHistory(userId: string) {
    const rows = await this.db.query.matchPlayers.findMany({
      where: eq(matchPlayers.userId, userId),
      with: { match: { with: { court: true, complex: true, video: true } } },
    });
    return rows.map((mp) => mp.match).sort((a, b) => (b?.startTime?.getTime() ?? 0) - (a?.startTime?.getTime() ?? 0));
  }

  list(role?: string) {
    return this.db.query.users.findMany({
      where: role ? eq(users.role, role as any) : undefined,
      orderBy: [desc(users.createdAt)],
    });
  }

  async findByIdOrThrow(id: string) {
    const user = await this.db.query.users.findFirst({ where: eq(users.id, id) });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return user;
  }
}
