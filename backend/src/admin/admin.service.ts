import { Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, lt } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { users, matches, videos, courts, cameras, clips, auditLogs } from '../db/schema';
import { VideoProcessingService } from '../video-processing/video-processing.service';

const DEFAULT_QUOTA_BYTES = 5 * 1024 ** 4; // 5 TB — configurable por plan/complejo en producción

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private dbService: DbService, private videoProcessing: VideoProcessingService) {}
  private get db() {
    return this.dbService.db;
  }

  async getStats(complexId?: string) {
    const matchWhere = complexId ? eq(matches.complexId, complexId) : undefined;

    const [allUsers, allMatches, readyVideos, activeCourts, allCameras, allClips] = await Promise.all([
      this.db.query.users.findMany({ where: eq(users.role, 'PLAYER'), columns: { id: true } }),
      this.db.query.matches.findMany({ where: matchWhere, columns: { id: true } }),
      this.db.query.videos.findMany({
        where: eq(videos.status, 'READY'),
        columns: { durationSeconds: true },
        with: complexId ? { match: { columns: { complexId: true } } } : undefined,
      }),
      this.db.query.courts.findMany({ where: complexId ? and(eq(courts.status, 'ACTIVE'), eq(courts.complexId, complexId)) : eq(courts.status, 'ACTIVE'), columns: { id: true } }),
      this.db.query.cameras.findMany({ with: { court: true } }),
      this.db.query.clips.findMany({ where: eq(clips.status, 'READY'), columns: { id: true }, with: complexId ? { match: { columns: { complexId: true } } } : undefined }),
    ]);

    const filteredVideos = complexId ? readyVideos.filter((v: any) => v.match?.complexId === complexId) : readyVideos;
    const filteredCameras = complexId ? allCameras.filter((c: any) => c.court?.complexId === complexId) : allCameras;
    const filteredClips = complexId ? (allClips as any[]).filter((c: any) => c.match?.complexId === complexId) : allClips;

    const recordedSeconds = filteredVideos.reduce((sum, v) => sum + (v.durationSeconds ?? 0), 0);
    const camerasOnline = filteredCameras.filter((c: any) => c.status === 'ONLINE').length;

    return {
      totalUsers: allUsers.length,
      totalMatches: allMatches.length,
      recordedHours: Math.round((recordedSeconds / 3600) * 10) / 10,
      activeCourts: activeCourts.length,
      camerasOnline,
      camerasTotal: filteredCameras.length,
      totalClips: filteredClips.length,
    };
  }

  async getStorage() {
    const allVideos = await this.db.query.videos.findMany({
      where: (v, { isNotNull }) => isNotNull(v.sizeBytes),
      with: { match: { with: { court: true, complex: true } } },
      orderBy: [desc(videos.sizeBytes)],
    });
    const usedBytes = allVideos.reduce((sum, v) => sum + (v.sizeBytes ?? 0), 0);

    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const cutoff = ninetyDaysAgo.toISOString().slice(0, 10);
    const oldMatches = await this.db.query.matches.findMany({ where: lt(matches.date, cutoff), columns: { id: true } });

    return {
      quotaBytes: DEFAULT_QUOTA_BYTES,
      usedBytes,
      availableBytes: DEFAULT_QUOTA_BYTES - usedBytes,
      heaviestVideos: allVideos.slice(0, 10),
      oldMatchesCount: oldMatches.length,
    };
  }

  getAuditLogs(limit = 100) {
    return this.db.query.auditLogs.findMany({ limit, orderBy: [desc(auditLogs.createdAt)], with: { user: true } });
  }

  /**
   * Backfill puntual (2026-09-24) — ver comentario en VideoProcessingService.backfillPosters.
   * Se dispara en background (fire-and-forget) y responde al instante: el proxy de Vercel
   * corta requests largos (>~10-60s) y procesar varios videos con ffmpeg de forma síncrona
   * superaba ese límite (502 Bad Gateway). El resultado real queda en los logs del backend;
   * para verificar alcanza con refrescar el dashboard y ver las portadas.
   */
  backfillVideoPosters() {
    this.videoProcessing
      .backfillPosters()
      .then((results) => this.logger.log(`Backfill de portadas terminado: ${JSON.stringify(results)}`))
      .catch((err) => this.logger.error(`Backfill de portadas falló: ${(err as Error).message}`));
    return { started: true };
  }
}
