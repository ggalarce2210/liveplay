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
   *
   * Uso pensado hoy: copiar el token a mano en `config.env` del TV box. Para el flujo nuevo de
   * "código de enrolamiento" (ver `generateEnrollmentCode` más abajo) no hace falta llamar a
   * este método aparte — el código ya deja un token nuevo emitido y listo para entregarse solo.
   */
  async issueAgentToken(id: string) {
    const camera = await this.db.query.cameras.findFirst({ where: eq(cameras.id, id) });
    if (!camera) throw new NotFoundException('Cámara no encontrada');

    const token = crypto.randomBytes(32).toString('hex');
    const agentKeyHash = crypto.createHash('sha256').update(token).digest('hex');
    await this.db.update(cameras).set({ agentKeyHash, updatedAt: new Date() }).where(eq(cameras.id, id));

    return { token };
  }

  /**
   * Alfabeto del código de enrolamiento: sin `0/O/1/I` (se confunden entre sí en una tipografía
   * chica de TV, y el TV box lo tipea el instalador con un control remoto, no un teclado). 8
   * caracteres de este alfabeto dan ~38 bits de entropía — de sobra para un código de un solo
   * uso que vence en minutos, no hace falta más para este umbral de riesgo.
   */
  private static readonly ENROLLMENT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  private static readonly ENROLLMENT_CODE_LENGTH = 8;
  private static readonly ENROLLMENT_CODE_TTL_MINUTES = 10;

  private generateEnrollmentCodeValue(): string {
    const alphabet = CamerasService.ENROLLMENT_CODE_ALPHABET;
    const bytes = crypto.randomBytes(CamerasService.ENROLLMENT_CODE_LENGTH);
    let raw = '';
    for (let i = 0; i < CamerasService.ENROLLMENT_CODE_LENGTH; i++) {
      raw += alphabet[bytes[i] % alphabet.length];
    }
    // Se muestra con un guión al medio (ABCD-EFGH) solo para que sea más fácil de leer/tipear;
    // el guión no forma parte del código real (se quita antes de hashear, tanto acá como en
    // AgentEnrollController.redeem, para que no importe si el instalador lo tipea o no).
    return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  }

  /**
   * Genera de punta a punta lo que necesita un TV box nuevo para autoconfigurarse (pedido del
   * usuario 2026-09-29: reemplazar el proceso manual de editar `config.env` a mano, que venía
   * siendo la parte más "engorrosa" de instalar el agente local — ver AGENTE.md y el resumen del
   * proyecto). En una sola llamada:
   *   1. Rota el token de agente de la cámara (mismo mecanismo que `issueAgentToken`), pero esta
   *      vez guarda también el valor en texto plano en `pendingAgentToken` — la única forma de
   *      poder devolvérselo al TV box más tarde, cuando canjee el código (ver
   *      `AgentEnrollController.redeem` en `agent/agent-enroll.controller.ts`).
   *   2. Genera el código corto, guarda solo su hash + vencimiento (10 min).
   * Nunca conviven dos códigos activos para la misma cámara: generar uno nuevo invalida
   * cualquiera anterior sin canjear (se pisa el mismo campo).
   */
  async generateEnrollmentCode(id: string) {
    const camera = await this.db.query.cameras.findFirst({ where: eq(cameras.id, id) });
    if (!camera) throw new NotFoundException('Cámara no encontrada');

    const token = crypto.randomBytes(32).toString('hex');
    const agentKeyHash = crypto.createHash('sha256').update(token).digest('hex');
    const code = this.generateEnrollmentCodeValue();
    const enrollmentCodeHash = crypto.createHash('sha256').update(code.replace('-', '')).digest('hex');
    const expiresAt = new Date(Date.now() + CamerasService.ENROLLMENT_CODE_TTL_MINUTES * 60_000);

    await this.db
      .update(cameras)
      .set({
        agentKeyHash,
        pendingAgentToken: token,
        enrollmentCodeHash,
        enrollmentCodeExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(cameras.id, id));

    return { code, expiresAt };
  }

  /**
   * Canjea un código de enrolamiento (ver `generateEnrollmentCode`) por el bundle de config que
   * necesita el TV box para armar `config.env` solo, sin que nadie lo tipee a mano. Llamado
   * desde `AgentEnrollController` (`POST /agent/enroll`, sin ningún guard — el box todavía no
   * tiene credencial en este momento, el código ES la credencial de un solo uso).
   *
   * Es de un solo uso a propósito: apenas se lee, se borran los 3 campos efímeros
   * (`enrollmentCodeHash`/`enrollmentCodeExpiresAt`/`pendingAgentToken`) aunque el `agentKeyHash`
   * (el token real, ya rotado en `generateEnrollmentCode`) queda vigente — ese es el que el
   * agente va a usar de ahí en adelante contra `/agent/*`, igual que si se hubiera copiado a
   * mano.
   */
  async redeemEnrollmentCode(rawCode: string, apiPublicUrl: string) {
    const normalized = (rawCode ?? '').replace(/-/g, '').trim().toUpperCase();
    if (!normalized) throw new NotFoundException('Código inválido o vencido');

    const codeHash = crypto.createHash('sha256').update(normalized).digest('hex');
    const camera = await this.db.query.cameras.findFirst({ where: eq(cameras.enrollmentCodeHash, codeHash) });

    if (!camera || !camera.enrollmentCodeExpiresAt || camera.enrollmentCodeExpiresAt < new Date()) {
      throw new NotFoundException('Código inválido o vencido');
    }

    await this.db
      .update(cameras)
      .set({
        enrollmentCodeHash: null,
        enrollmentCodeExpiresAt: null,
        pendingAgentToken: null,
        updatedAt: new Date(),
      })
      .where(eq(cameras.id, camera.id));

    return {
      backendUrl: apiPublicUrl,
      agentToken: camera.pendingAgentToken,
      rtspUrl: camera.rtspUrl,
      cameraName: camera.name,
      // Defaults que ya usa el agente hoy (ver local-agent/config.example.env) — el TV box no
      // necesita elegir nada, pero los manda igual por si alguna vez se quiere afinar por cámara.
      segmentMinutes: 5,
      retentionHours: 48,
    };
  }

  /**
   * Lista los dispositivos que el Imou Open Platform ya reconoce como vinculados/compartidos a
   * nuestra `appId` — útil para que el panel de admin muestre "elegí una de estas cámaras" en
   * vez de pedir el serial a ciegas. No incluye cámaras que todavía no se emparejaron con la
   * app Imou Life (ver nota en `ImouCloudClient.bindDevice`).
   */
  async listImouDevices() {
    return this.imouCloudClient.listDevices();
  }

  /**
   * Alta de una cámara cloud (Imou o Dahua emparejada vía Imou Life): vincula el dispositivo a
   * nuestra app en Imou y recién si eso funciona lo persiste contra la cancha. Si el dispositivo
   * no existe en el directorio de Imou (típico caso: una Dahua dada de alta solo por DMSS, sin
   * pasar por Imou Life) `bindDevice` tira `BadGatewayException` con el código de error de Imou,
   * y acá no llegamos a crear el registro — evita cámaras "fantasma" en nuestra base.
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
   * Devuelve la URL HLS de streaming en vivo actual de una cámara `IMOU_CLOUD`. Cada llamada
   * puede crear una nueva sesión de live del lado de Imou (`bindDeviceLive` es idempotente si ya
   * había una activa) — no cachear esta URL más allá de una sesión de visualización corta.
   */
  async getImouLiveUrl(id: string): Promise<string> {
    const camera = await this.db.query.cameras.findFirst({ where: eq(cameras.id, id) });
    if (!camera) throw new NotFoundException('Cámara no encontrada');
    if (camera.type !== 'IMOU_CLOUD' || !camera.imouDeviceId) {
      throw new NotFoundException('Esta cámara no está configurada como IMOU_CLOUD');
    }
    return this.imouCloudClient.getLiveHlsUrl(camera.imouDeviceId, camera.imouChannelId ?? '0');
  }
}
