import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { videos } from '../db/schema';
import { StreamTokenService } from '../storage/stream-token.service';
import { STORAGE_DRIVER } from '../storage/storage.module';
import { StorageDriver } from '../storage/storage.types';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/roles';
import { VideoAccessService } from '../payments/video-access.service';

const MANIFEST_URL_TTL_SECONDS = 60 * 60 * 4; // 4hs: suficiente para ver el partido completo

@Injectable()
export class VideosService {
  constructor(
    private dbService: DbService,
    private streamTokens: StreamTokenService,
    private videoAccess: VideoAccessService,
    @Inject(STORAGE_DRIVER) private storage: StorageDriver,
  ) {}
  private get db() {
    return this.dbService.db;
  }

  private async getAuthorized(id: string, requester: AuthUser) {
    const video = await this.db.query.videos.findFirst({
      where: eq(videos.id, id),
      with: {
        match: { with: { players: true, complex: true } },
        segments: { orderBy: (s, { asc }) => [asc(s.index)] },
      },
    });
    if (!video) throw new NotFoundException('Video no encontrado');
    // Antes esto exigía que el PLAYER estuviera en `match.players` para poder ver el video.
    // Igual que en `MatchesService.search` (ver comentario ahí, 2026-09-19): desde que los
    // partidos se generan solos por horario de turno nadie asigna jugadores nunca, así que esta
    // restricción le bloqueaba el video a TODOS los jugadores, siempre — el video quedaba
    // visible solo para SUPER_ADMIN/COMPLEX_ADMIN, que ya estaban exceptuados de este chequeo.
    // Decisión del cliente: cualquier usuario logueado puede ver cualquier turno grabado, mismo
    // criterio para los tres roles.
    return video;
  }

  /**
   * Pago por ver videos (2026-10-16): si el complejo del partido cobra por ver sus videos,
   * SUPER_ADMIN/COMPLEX_ADMIN siguen viendo todo sin pagar (son quienes administran el
   * complejo, no "clientes" del paywall) — solo a un PLAYER se le exige un pase vigente.
   */
  private async checkPaywall(video: Awaited<ReturnType<VideosService['getAuthorized']>>, requester: AuthUser) {
    const complex = video.match?.complex;
    if (!complex?.chargesForVideoAccess) return { blocked: false as const };
    if (requester.role !== Role.PLAYER) return { blocked: false as const };

    const hasAccess = await this.videoAccess.hasActivePass(complex.id, requester.userId);
    if (hasAccess) return { blocked: false as const };

    return {
      blocked: true as const,
      complexId: complex.id,
      priceArs: complex.videoAccessPriceArs,
      passDays: complex.videoAccessPassDays,
    };
  }

  async get(id: string, requester: AuthUser) {
    return this.getAuthorized(id, requester);
  }

  async getSegments(id: string, requester: AuthUser) {
    const video = await this.getAuthorized(id, requester);
    return video.segments;
  }

  /**
   * Devuelve URLs firmadas de corta duración: nunca la ruta física real (§25). Importante: acá
   * SIEMPRE armamos un link a nuestro propio `/api/stream/:token` (vía StreamTokenService), no
   * llamamos a `storage.getSignedReadUrl()` directo — con el driver S3 eso devolvería la URL
   * firmada del bucket sin pasar por StreamController, y el manifest llegaría sin reescribir
   * (referencias a segmentos relativas, sin firmar — el player nunca podría reproducir nada).
   */
  async getPlaybackUrls(id: string, requester: AuthUser) {
    const video = await this.getAuthorized(id, requester);
    if (video.status !== 'READY' || !video.hlsManifestKey) {
      return { status: video.status, manifestUrl: null, thumbnailsVttUrl: null };
    }

    const paywall = await this.checkPaywall(video, requester);
    if (paywall.blocked) {
      return {
        status: 'PAYMENT_REQUIRED' as const,
        manifestUrl: null,
        thumbnailsVttUrl: null,
        complexId: paywall.complexId,
        priceArs: paywall.priceArs,
        passDays: paywall.passDays,
      };
    }

    const manifestUrl = this.streamTokens.sign(video.hlsManifestKey, MANIFEST_URL_TTL_SECONDS);
    const thumbnailsVttUrl = video.thumbnailVttKey
      ? this.streamTokens.sign(video.thumbnailVttKey, MANIFEST_URL_TTL_SECONDS)
      : null;
    return {
      status: video.status,
      manifestUrl,
      thumbnailsVttUrl,
      durationSeconds: video.durationSeconds,
      width: video.width,
      height: video.height,
    };
  }

  /**
   * Borra un video: primero los archivos reales en storage (HLS, segmentos, poster, thumbnails
   * — todo vive bajo `storageBaseKey`, ver storage.types.ts) y recién después la fila en DB. El
   * partido (`matches`) NO se borra, solo queda sin video asociado — para liberar espacio desde
   * el panel de admin sin perder el registro del partido en sí.
   */
  async remove(id: string) {
    const video = await this.db.query.videos.findFirst({ where: eq(videos.id, id) });
    if (!video) throw new NotFoundException('Video no encontrado');
    await this.storage.deletePrefix(video.storageBaseKey);
    const [deleted] = await this.db.delete(videos).where(eq(videos.id, id)).returning();
    return deleted;
  }
}
