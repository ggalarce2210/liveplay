import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { cameras } from '../db/schema';

@Injectable()
export class CamerasService {
  constructor(private dbService: DbService) {}
  private get db() {
    return this.dbService.db;
  }

  list() {
    return this.db.query.cameras.findMany({ with: { court: { with: { complex: true } } } });
  }

  async create(data: any) {
    const [created] = await this.db.insert(cameras).values(data).returning();
    return created;
  }

  async update(id: string, data: any) {
    const [updated] = await this.db.update(cameras).set({ ...data, updatedAt: new Date() }).where(eq(cameras.id, id)).returning();
    return updated;
  }

  async remove(id: string) {
    const [deleted] = await this.db.delete(cameras).where(eq(cameras.id, id)).returning();
    return deleted;
  }

  /**
   * En producción esto correría como un cron/health-checker cada 30-60s: intenta un
   * `ffprobe rtsp://...` (o el heartbeat propio del NVR) con timeout corto y actualiza
   * status/lastSeenAt. Acá lo dejamos como endpoint manual para la demo.
   */
  async markHeartbeat(id: string, status: 'ONLINE' | 'OFFLINE') {
    const [updated] = await this.db.update(cameras).set({ status, lastSeenAt: new Date() }).where(eq(cameras.id, id)).returning();
    return updated;
  }
}
