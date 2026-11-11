import { Injectable, Inject, Logger } from '@nestjs/common';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { users, matches, videos, courts, cameras, clips, auditLogs } from '../db/schema';
import { VideoProcessingService } from '../video-processing/video-processing.service';
import { STORAGE_DRIVER } from '../storage/storage.module';
import { StorageDriver } from '../storage/storage.types';
import { Role } from '../common/roles';

const DEFAULT_QUOTA_BYTES = 5 * 1024 ** 4; // 5 TB — configurable por plan/complejo en producción

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private dbService: DbService,
    private videoProcessing: VideoProcessingService,
    @Inject(STORAGE_DRIVER) private storage: StorageDriver,
  ) {}
  private get db() {
    return this.dbService.db;
  }

  /**
   * Bug real encontrado 2026-11-11: `getStats`/`getAllVideos` confiaban en el `complexId` que
   * mandaba el QUERY STRING sin verificar que el que llama tenga permiso sobre ESE complejo — un
   * `COMPLEX_ADMIN` podía pedir el de cualquier otro (o ni mandar el parámetro, trayendo TODO) y
   * ver estadísticas/videos de un negocio ajeno. Mismo criterio que ya usa `CamerasService.list`:
   * para un `COMPLEX_ADMIN` se ignora lo que haya mandado el cliente y se fuerza siempre su propio
   * `managedComplexId`; un `SUPER_ADMIN` (o una llamada interna sin `user`) sigue sin acotar.
   */
  private effectiveComplexId(complexId: string | undefined, user?: { role?: string; managedComplexId?: string | null }) {
    if (user?.role === Role.COMPLEX_ADMIN) return user.managedComplexId ?? '__none__';
    return complexId;
  }

  async getStats(complexId?: string, user?: { role?: string; managedComplexId?: string | null }) {
    complexId = this.effectiveComplexId(complexId, user);
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

    // Un video FAILED (o uno que quedo PROCESSING colgado, p.ej. porque el worker se
    // reinicio a mitad de un job) nunca llega a tener sizeBytes, asi que nunca aparece en
    // `allVideos` de arriba — sin esto, un admin no tenia forma de ver ni borrar los videos
    // que quedaron rotos/colgados en error o trabados procesando (y que si no se borran
    // pueden volver a encolarse solos y seguir ocupando el unico worker de la cola).
    const failedVideos = await this.db.query.videos.findMany({
      where: inArray(videos.status, ['FAILED', 'PROCESSING']),
      with: { match: { with: { court: true, complex: true } } },
      orderBy: [desc(videos.updatedAt)],
    });

    return {
      quotaBytes: DEFAULT_QUOTA_BYTES,
      usedBytes,
      availableBytes: DEFAULT_QUOTA_BYTES - usedBytes,
      heaviestVideos: allVideos.slice(0, 10),
      failedVideos,
      oldMatchesCount: oldMatches.length,
    };
  }

  /**
   * Listado completo de videos para el panel (§"organizar por complejo/cámara", 2026-10-08):
   * a diferencia de `MatchesService.search` (que solo devuelve partidos de los últimos 7 días,
   * límite de PRODUCTO pensado para jugadores, ver comentario ahí) acá un admin necesita poder
   * ver TODOS los videos que existen, sin importar la antigüedad, para poder ubicar a qué
   * complejo/cancha/cámara pertenece cada uno — hoy con una sola cámara no hace falta, pero con
   * decenas de complejos un listado plano se vuelve inmanejable. Devuelve partidos (no videos
   * sueltos) con `court.camera`/`complex` embebidos para que el frontend arme el árbol
   * complejo → cancha/cámara → partido sin pegarle a la API de nuevo por cada nivel; el
   * agrupamiento en sí se hace del lado del cliente (mismo criterio que ya usa esta clase en
   * `getStats`, que filtra por complexId en JS en vez de armar un WHERE con join).
   */
  async getAllVideos(complexId?: string, user?: { role?: string; managedComplexId?: string | null }) {
    complexId = this.effectiveComplexId(complexId, user);
    const allMatches = await this.db.query.matches.findMany({
      where: complexId ? eq(matches.complexId, complexId) : undefined,
      with: {
        complex: true,
        court: { with: { camera: true } },
        video: true,
      },
      orderBy: [desc(matches.startTime)],
    });
    return allMatches.filter((m: any) => !!m.video);
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

  /**
   * Reconciliador de storage huérfano (2026-10-27): compara TODOS los objetos del bucket contra
   * los `storageBaseKey` que todavía tiene algún `video` vivo en la base, y devuelve las
   * carpetas que sobran — típicamente partidos borrados a mano ANTES de que
   * `MatchesService.remove()` también borrara el storage (ver ese fix). Ignora a propósito
   * cualquier objeto que no empiece con `complex-`/`court-`: los clips viven en un prefijo
   * totalmente separado (`clips/<matchId>/<clipId>.mp4`, ver
   * VideoProcessingService.generateClip) y NO tienen que tocarse acá — un clip sobrevive al
   * borrado de su partido de origen a propósito (ver MatchRetentionService). Modo dry-run: no
   * borra nada, solo informa.
   */
  async listOrphanVideoStorage() {
    const allObjects = await this.storage.listAllObjects();
    const byBaseKey = new Map<string, number>();
    for (const obj of allObjects) {
      const parts = obj.key.split('/');
      if (parts.length < 7 || !parts[0].startsWith('complex-') || !parts[1].startsWith('court-')) continue;
      const baseKey = parts.slice(0, 6).join('/');
      byBaseKey.set(baseKey, (byBaseKey.get(baseKey) ?? 0) + obj.sizeBytes);
    }

    const liveVideos = await this.db.query.videos.findMany({ columns: { storageBaseKey: true } });
    const liveBaseKeys = new Set(liveVideos.map((v: any) => v.storageBaseKey));

    const orphans = [...byBaseKey.entries()]
      .filter(([baseKey]) => !liveBaseKeys.has(baseKey))
      .map(([baseKey, sizeBytes]) => ({ baseKey, sizeBytes }))
      .sort((a, b) => b.sizeBytes - a.sizeBytes);

    return {
      orphanCount: orphans.length,
      totalBytes: orphans.reduce((sum, o) => sum + o.sizeBytes, 0),
      orphans,
    };
  }

  /**
   * Borra de verdad las carpetas que `listOrphanVideoStorage` identifica como huérfanas.
   * Recalcula la lista fresca (no reusa un resultado cacheado de un dry-run previo) antes de
   * borrar, por las dudas.
   */
  async purgeOrphanVideoStorage() {
    const { orphans } = await this.listOrphanVideoStorage();
    let deletedCount = 0;
    let bytesFreed = 0;
    const failed: { baseKey: string; error: string }[] = [];
    for (const o of orphans) {
      try {
        await this.storage.deletePrefix(o.baseKey);
        deletedCount++;
        bytesFreed += o.sizeBytes;
      } catch (err) {
        failed.push({ baseKey: o.baseKey, error: (err as Error).message });
      }
    }
    this.logger.log(
      `Limpieza de storage huérfano: ${deletedCount} carpetas borradas (~${Math.round(bytesFreed / 1_000_000)} MB liberados), ${failed.length} fallidas.`,
    );
    return { deletedCount, bytesFreed, failed };
  }
}
