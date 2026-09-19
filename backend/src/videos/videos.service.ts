import { Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { videos } from '../db/schema';
import { StreamTokenService } from '../storage/stream-token.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

const MANIFEST_URL_TTL_SECONDS = 60 * 60 * 4; // 4hs: suficiente para ver el partido completo

@Injectable()
export class VideosService {
  constructor(private dbService: DbService, private streamTokens: StreamTokenService) {}
  private get db() {
    return this.dbService.db;
  }

  private async getAuthorized(id: string, requester: AuthUser) {
    const video = await this.db.query.videos.findFirst({
      where: eq(videos.id, id),
      with: {
        match: { with: { players: true } },
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
}
