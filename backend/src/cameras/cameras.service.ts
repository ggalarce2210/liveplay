import { Injectable, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
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

  /**
   * Emite (o rota) el token que usa el agente local de esta cámara para autenticarse contra
   * /agent/* (ver AgentAuthGuard y backend/AGENTE.md). El token en texto plano se devuelve UNA
   * sola vez acá — solo guardamos su hash, igual que una contraseña — así que si se pierde, la
   * única forma de recuperarlo es rotar (llamar de nuevo, lo que invalida el anterior).
   */
  async issueAgentToken(id: string) {
    const camera = await this.db.query.cameras.findFirst({ where: eq(cameras.id, id) });
    if (!camera) throw new NotFoundException('Cámara no encontrada');

    const token = crypto.randomBytes(32).toString('hex');
    const agentKeyHash = crypto.createHash('sha256').update(token).digest('hex');
    await this.db.update(cameras).set({ agentKeyHash, updatedAt: new Date() }).where(eq(cameras.id, id));

    return { token };
  }
}
