import { Injectable, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { cameras } from '../db/schema';
import { ImouCloudClient } from './imou-cloud.client';

@Injectable()
export class CamerasService {
  constructor(
    private dbService: DbService,
    private imouCloudClient: ImouCloudClient,
  ) {}
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
   * En produccion esto correria como un cron/health-checker cada 30-60s: intenta un
   * `ffprobe rtsp://...` (o el heartbeat propio del NVR) con timeout corto y actualiza
   * status/lastSeenAt. Aca lo dejamos como endpoint manual para la demo.
   */
  async markHeartbeat(id: string, status: 'ONLINE' | 'OFFLINE') {
    const [updated] = await this.db.update(cameras).set({ status, lastSeenAt: new Date() }).where(eq(cameras.id, id)).returning();
    return updated;
  }

  /**
   * Emite (o rota) el token que usa el agente local de esta camara para autenticarse contra
   * /agent/* (ver AgentAuthGuard y backend/AGENTE.md). El token en texto plano se devuelve UNA
   * sola vez aca - solo guardamos su hash, igual que una contrasena - asi que si se pierde, la
   * unica forma de recuperarlo es rotar (llamar de nuevo, lo que invalida el anterior).
   */
  async issueAgentToken(id: string) {
    const camera = await this.db.query.cameras.findFirst({ where: eq(cameras.id, id) });
    if (!camera) throw new NotFoundException('Camara no encontrada');

    const token = crypto.randomBytes(32).toString('hex');
    const agentKeyHash = crypto.createHash('sha256').update(token).digest('hex');
    await this.db.update(cameras).set({ agentKeyHash, updatedAt: new Date() }).where(eq(cameras.id, id));

    return { token };
  }

  /**
   * Lista los dispositivos que el Imou Open Platform ya reconoce como vinculados/compartidos a
   * nuestra `appId` - util para que el panel de admin muestre "elegi una de estas camaras" en
   * vez de pedir el serial a ciegas. No incluye camaras que todavia no se emparejaron con la
   * app Imou Life (ver nota en `ImouCloudClient.bindDevice`).
   */
  async listImouDevices() {
    return this.imouCloudClient.listDevices();
  }

  /**
   * Alta de una camara cloud (Imou o Dahua emparejada via Imou Life): vincula el dispositivo a
   * nuestra app en Imou y recien si eso funciona lo persiste contra la cancha. Si el dispositivo
   * no existe en el directorio de Imou (tipico caso: una Dahua dada de alta solo por DMSS, sin
   * pasar por Imou Life) `bindDevice` tira `BadGatewayException` con el codigo de error de Imou,
   * y aca no llegamos a crear el registro - evita camaras "fantasma" en nuestra base.
   */
  async linkImouCamera(params: {
    courtId: string;
    name: string;
    deviceId: string;
    channelId?: string;
    code?: string;
  }) {
    const channelId = params.channelId ?? '0';
    await this.imouCloudClient.bindDevice(params.deviceId, params.code ?? '');

    const [created] = await this.db
      .insert(cameras)
      .values({
        courtId: params.courtId,
        name: params.name,
        type: 'IMOU_CLOUD',
        status: 'UNKNOWN',
        imouDeviceId: params.deviceId,
        imouChannelId: channelId,
      })
      .returning();
    return created;
  }

  /**
   * Devuelve la URL HLS de streaming en vivo actual de una camara `IMOU_CLOUD`. Cada llamada
   * puede crear una nueva sesion de live del lado de Imou (`bindDeviceLive` es idempotente si ya
   * habia una activa) - no cachear esta URL mas alla de una sesion de visualizacion corta.
   */
  async getImouLiveUrl(id: string): Promise<string> {
    const camera = await this.db.query.cameras.findFirst({ where: eq(cameras.id, id) });
    if (!camera) throw new NotFoundException('Camara no encontrada');
    if (camera.type !== 'IMOU_CLOUD' || !camera.imouDeviceId) {
      throw new NotFoundException('Esta camara no esta configurada como IMOU_CLOUD');
    }
    return this.imouCloudClient.getLiveHlsUrl(camera.imouDeviceId, camera.imouChannelId ?? '0');
  }
  }
