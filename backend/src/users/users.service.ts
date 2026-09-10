import { Injectable, NotFoundException } from '@nestjs/common';
import { desc, eq, inArray } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { users, matchPlayers, matches } from '../db/schema';

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
