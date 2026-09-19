import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { courts } from '../db/schema';
import { MatchSchedulerService } from '../matches/match-scheduler.service';

@Injectable()
export class CourtsService {
  constructor(private dbService: DbService, private matchScheduler: MatchSchedulerService) {}
  private get db() {
    return this.dbService.db;
  }

  listByComplex(complexId: string) {
    return this.db.query.courts.findMany({ where: eq(courts.complexId, complexId), with: { camera: true } });
  }

  get(id: string) {
    return this.db.query.courts.findFirst({ where: eq(courts.id, id), with: { camera: true, complex: true } });
  }

  async create(data: any) {
    const [created] = await this.db.insert(courts).values(data).returning();
    // Si la cancha ya nace con un horario de turnos configurado, generamos los próximos
    // partidos al toque en vez de esperar a la próxima vuelta del cron (hasta 1h) — ver
    // MatchSchedulerService.
    if (created?.operatingHours) await this.matchScheduler.generateForCourt(created.id);
    return created;
  }

  async update(id: string, data: any) {
    const [updated] = await this.db.update(courts).set({ ...data, updatedAt: new Date() }).where(eq(courts.id, id)).returning();
    if (updated?.operatingHours) await this.matchScheduler.generateForCourt(updated.id);
    return updated;
  }

  async remove(id: string) {
    const [deleted] = await this.db.delete(courts).where(eq(courts.id, id)).returning();
    return deleted;
  }
}
