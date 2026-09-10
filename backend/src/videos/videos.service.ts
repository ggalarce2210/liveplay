import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { videos } from '../db/schema';
import { STORAGE_DRIVER } from '../storage/storage.module';
import { StorageDriver } from '../storage/storage.types';
import { AuthUser } from '../common/decorators/current-user.decorator';

const MANIFEST_URL_TTL_SECONDS = 60 * 60 * 4; // 4hs: suficiente para ver el partido completo

@Injectable()
export class VideosService {
  constructor(private dbService: DbService, @Inject(STORAGE_DRIVER) private storage: StorageDriver) {}
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
    if (requester.role === 'PLAYER' && !video.match.players.some((p) => p.userId === requester.userId)) {
      throw new ForbiddenException('No tenés acceso a este video');
    }
    return video;
  }

  async get(id: string, requester: AuthUser) {
    return this.getAuthorized(id, requester);
  }

  async getSegments(id: string, requester: AuthUser) {
    const video = await this.getAuthorized(id, requester);
    return video.segments;
  }

  /** Devuelve URLs firmadas de corta duración: nunca la ruta física real (§25). */
  async getPlaybackUrls(id: string, requester: AuthUser) {
    const video = await this.getAuthorized(id, requester);
    if (video.status !== 'READY' || !video.hlsManifestKey) {
      return { status: video.status, manifestUrl: null, thumbnailsVttUrl: null };
    }
    const manifestUrl = await this.storage.getSignedReadUrl(video.hlsManifestKey, MANIFEST_URL_TTL_SECONDS);
    const thumbnailsVttUrl = video.thumbnailVttKey
      ? await this.storage.getSignedReadUrl(video.thumbnailVttKey, MANIFEST_URL_TTL_SECONDS)
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
