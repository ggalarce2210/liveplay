import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { matches, videos, videoSegments, notifications } from '../db/schema';
import { STORAGE_DRIVER } from '../storage/storage.module';
import { StorageDriver } from '../storage/storage.types';
import { buildStorageBaseKey } from '../matches/storage-key.util';
import * as mime from '../common/mime';
import { CreateUploadPlanDto } from './dto/upload-plan.dto';
import { FinalizeUploadDto } from './dto/finalize-upload.dto';

// Cuánto dura cada URL de subida firmada (§25: toda URL firmada vence sola) — 1h de margen de
// sobra para que el mini-PC suba todos los archivos de un partido incluso con una conexión lenta.
const UPLOAD_URL_TTL_SECONDS = 60 * 60;

// Mismo campo `durationWarning` que documenta schema.ts para el pipeline legacy (incidente
// 2026-10-08: un corte de wifi a mitad de partido puede dejar una grabación incompleta sin que
// nada tire error) — acá se calcula de la misma manera para "Escenario B": si la duración real
// queda por debajo del 90% de lo esperado para el turno (`matches.endTime - matches.startTime`),
// probablemente el corte pasó en la cámara o en el mini-PC, antes de llegar a este backend.
const DURATION_WARNING_RATIO = 0.9;

@Injectable()
export class AgentService {
  constructor(
    private dbService: DbService,
    @Inject(STORAGE_DRIVER) private storage: StorageDriver,
  ) {}
  private get db() {
    return this.dbService.db;
  }

  /**
   * Partidos de ESTA cancha (la de la cámara autenticada) que ya deberían haber terminado y
   * todavía no tienen un video listo — candidatos para que el agente local le pida a la cámara
   * (Dahua u otra) la grabación de esa ventana horaria y la suba.
   *
   * "Terminado" se decide así: si el partido tiene `endTime` cargado, alcanza con que ya haya
   * pasado; si no (lo más común: hoy `endTime` casi nunca se carga), asumimos que terminó
   * `bufferMinutes` después de `startTime` — el agente puede ajustar ese margen según la
   * duración típica de un turno en esa cancha.
   */
  async pendingMatches(courtId: string, bufferMinutes: number) {
    const now = new Date();
    const assumedEndCutoff = new Date(now.getTime() - bufferMinutes * 60_000);

    // Se trae todo lo de esta cancha y se filtra en memoria: a la escala de UNA cancha (decenas
    // de partidos activos, no miles) es más simple y más claro que armar en Drizzle un
    // `endTime pasado O (sin endTime Y startTime + buffer pasado)` con `or`/`and` anidados.
    const candidates = await this.db.query.matches.findMany({
      where: eq(matches.courtId, courtId),
      with: { video: true, teams: true },
      orderBy: (m, { asc }) => [asc(m.startTime)],
    });

    const ended = candidates.filter((m) => (m.endTime ? m.endTime <= now : m.startTime <= assumedEndCutoff));

    return ended
      // `matches.status === 'FAILED'` es "no reintentar más" a nivel de partido — mismo
      // significado que ya usa el pipeline legacy (`video-processing.service.ts`/
      // `.processor.ts`) cuando se agotan los reintentos, y lo que se usa para "resetear" a
      // mano partidos viejos sin grabación recuperable (ver nota 2026-10-20 en el resumen del
      // proyecto: sin esto, un video FAILED igual vuelve a aparecer como pendiente para
      // siempre, porque `video.status === 'FAILED'` abajo significa "reintentar", no "rendirse").
      .filter((m) => m.status !== 'FAILED')
      .filter((m) => !m.video || m.video.status === 'FAILED')
      .map((m) => ({
        id: m.id,
        date: m.date,
        startTime: m.startTime,
        endTime: m.endTime,
        sportType: m.sportType,
        teams: m.teams.map((t) => t.label),
        videoStatus: m.video?.status ?? null,
      }));
  }

  async assertMatchBelongsToCourt(matchId: string, courtId: string) {
    const match = await this.db.query.matches.findFirst({ where: eq(matches.id, matchId) });
    return match && match.courtId === courtId ? match : null;
  }

  /**
   * "Escenario B" (ver backend/AGENTE.md): el mini-PC ya corrió FFmpeg LOCALMENTE (HLS +
   * thumbnails, con `-c:v copy` porque la cámara real graba H.264 — ver decisión documentada en
   * el resumen del proyecto) y quiere subir los archivos resultantes DIRECTO a R2/S3, sin que
   * pasen por este backend. El pipeline legacy (`VideoProcessingService.runMatchVideoPipeline`,
   * disparado por `MatchesService.attachVideo`) sigue existiendo sin tocar — complejos sin
   * mini-PC siguen subiendo el video crudo y procesándolo acá.
   *
   * Acá: (a) dejamos el `videos` row en PENDING con la misma key base que usaría el pipeline
   * legacy (mismo layout, mismo contrato con StreamController — ver `buildStorageBaseKey`), y
   * (b) devolvemos una URL PUT firmada de corta duración POR ARCHIVO — nunca una credencial de
   * acceso al bucket completo: si se filtra una de estas URLs, solo sirve para subir esa key
   * puntual y vence sola en 1h.
   *
   * El Content-Type de cada URL firmada se calcula acá, NUNCA se confía en lo que mande el
   * device (podría pedir un Content-Type que rompa cómo StreamController sirve el archivo
   * después) — se deriva de la extensión con el mismo `mime.lookup` que ya usa StreamController.
   */
  async createUploadPlan(matchId: string, courtId: string, dto: CreateUploadPlanDto) {
    const match = await this.assertMatchBelongsToCourt(matchId, courtId);
    if (!match) throw new NotFoundException('Ese partido no pertenece a la cancha de este agente');

    const storageBaseKey = buildStorageBaseKey(match);
    const existingVideo = await this.db.query.videos.findFirst({ where: eq(videos.matchId, matchId) });
    if (existingVideo) {
      await this.db
        .update(videos)
        .set({ storageBaseKey, status: 'PENDING', errorMessage: null, updatedAt: new Date() })
        .where(eq(videos.id, existingVideo.id));
    } else {
      await this.db.insert(videos).values({ matchId, storageBaseKey, status: 'PENDING' });
    }
    await this.db.update(matches).set({ status: 'PROCESSING', updatedAt: new Date() }).where(eq(matches.id, matchId));

    const uploads = await Promise.all(
      dto.files.map(async (f) => {
        const key = `${storageBaseKey}/${f.relativePath}`;
        const contentType = mime.lookup(f.relativePath);
        const url = await this.storage.getSignedPutUrl(key, contentType, UPLOAD_URL_TTL_SECONDS);
        return { relativePath: f.relativePath, key, contentType, url, expiresInSeconds: UPLOAD_URL_TTL_SECONDS };
      }),
    );

    return { storageBaseKey, uploads };
  }

  /**
   * El mini-PC llama esto DESPUÉS de haber subido con éxito, a las URLs de `createUploadPlan`,
   * todos los archivos de un partido. Replica el mismo cierre de
   * `VideoProcessingService.runMatchVideoPipeline` (videoSegments + videos READY + matches READY
   * + notification MATCH_READY) pero es una copia separada a propósito — no reutiliza ni
   * refactoriza esa clase, para no arriesgar el pipeline legacy que otros complejos siguen usando.
   *
   * Validación barata antes de dar el partido por bueno: en vez de pedirle a R2/S3 que confirme
   * la existencia de los ~600 segmentos uno por uno (lento, y son llamadas HEAD que cuestan), se
   * verifica solo el manifest, el sprite, el vtt, el poster (si vino) y el primer y último
   * segmento — la subida del mini-PC es secuencial, así que si esos están es extremadamente
   * improbable que falte algo en el medio.
   */
  async finalizeDirectUpload(matchId: string, courtId: string, dto: FinalizeUploadDto) {
    const match = await this.assertMatchBelongsToCourt(matchId, courtId);
    if (!match) throw new NotFoundException('Ese partido no pertenece a la cancha de este agente');

    const video = await this.db.query.videos.findFirst({ where: eq(videos.matchId, matchId) });
    if (!video) throw new NotFoundException('Este partido todavía no tiene un plan de subida (llamar primero a upload-plan)');

    const base = video.storageBaseKey;
    const sortedSegments = [...dto.segments].sort((a, b) => a.index - b.index);
    const first = sortedSegments[0];
    const last = sortedSegments[sortedSegments.length - 1];

    const spotCheckPaths = new Set([dto.manifestRelativePath, dto.spriteRelativePath, dto.vttRelativePath, first.relativePath, last.relativePath]);
    if (dto.posterRelativePath) spotCheckPaths.add(dto.posterRelativePath);

    for (const relativePath of spotCheckPaths) {
      const key = `${base}/${relativePath}`;
      const exists = await this.storage.exists(key);
      if (!exists) {
        throw new NotFoundException(`No se encontró en storage el archivo esperado "${relativePath}" — ¿se subió con la URL de upload-plan?`);
      }
    }

    const expectedSeconds = match.endTime ? (match.endTime.getTime() - match.startTime.getTime()) / 1000 : null;
    const durationWarning = expectedSeconds != null && dto.durationSeconds < expectedSeconds * DURATION_WARNING_RATIO;

    await this.db.transaction(async (tx) => {
      await tx.delete(videoSegments).where(eq(videoSegments.videoId, video.id));
      await tx.insert(videoSegments).values(
        sortedSegments.map((seg) => ({
          videoId: video.id,
          index: seg.index,
          startOffsetSeconds: seg.startOffsetSeconds,
          endOffsetSeconds: seg.endOffsetSeconds,
          durationSeconds: seg.durationSeconds,
          storageKey: `${base}/${seg.relativePath}`,
          status: 'PROCESSED' as const,
        })),
      );
      await tx
        .update(videos)
        .set({
          status: 'READY',
          hlsManifestKey: `${base}/${dto.manifestRelativePath}`,
          posterKey: dto.posterRelativePath ? `${base}/${dto.posterRelativePath}` : null,
          thumbnailSpriteKey: `${base}/${dto.spriteRelativePath}`,
          thumbnailVttKey: `${base}/${dto.vttRelativePath}`,
          durationSeconds: dto.durationSeconds,
          width: dto.width ?? null,
          height: dto.height ?? null,
          fps: dto.fps ?? null,
          sizeBytes: dto.sizeBytes,
          durationWarning,
          errorMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(videos.id, video.id));
      await tx.update(matches).set({ status: 'READY', updatedAt: new Date() }).where(eq(matches.id, matchId));
    });

    const full = await this.db.query.matches.findFirst({ where: eq(matches.id, matchId), with: { players: true } });
    if (full) {
      const userIds = full.players.map((p) => p.userId).filter(Boolean) as string[];
      if (userIds.length) {
        await this.db.insert(notifications).values(
          userIds.map((userId) => ({
            userId,
            type: 'MATCH_READY' as const,
            title: 'Tu partido ya está disponible',
            body: `Tu partido del ${full.date} ya puede reproducirse.`,
            metadata: { matchId: full.id },
          })),
        );
      }
    }

    return { videoId: video.id, status: 'READY' as const, durationWarning };
  }

  /**
   * Llamado por el agente local (ver backend/AGENTE.md, "Chequeo de movimiento") cuando su
   * chequeo de actividad (MAFD vía FFmpeg, ver local-agent/agent_lib.py `measure_motion`) no
   * detecta movimiento real en la ventana de este partido — hoy LivePlay genera un partido
   * "placeholder" por cada hora de funcionamiento de la cancha, haya o no reserva real en el
   * sistema de turnos del complejo (CanchaYa en "Los Pinos", sin API disponible — ver nota
   * 2026-10-20 en el resumen del proyecto), así que la mayoría de esas horas no tienen partido
   * real. Marca el partido `FAILED` — el mismo estado que `pendingMatches` ya excluye arriba —
   * para que deje de reintentarse, SIN gastar tiempo/ancho de banda armando y subiendo el video
   * de una cancha vacía. `resultSummary` (columna jsonb ya existente, sin migración) guarda el
   * motivo solo a fines de diagnóstico — el backend nunca lo usa para decidir nada.
   */
  async markEmpty(matchId: string, courtId: string, dto: { reason?: string; mafd?: number }) {
    const match = await this.assertMatchBelongsToCourt(matchId, courtId);
    if (!match) throw new NotFoundException('Ese partido no pertenece a la cancha de este agente');

    await this.db
      .update(matches)
      .set({
        status: 'FAILED',
        resultSummary: {
          emptyCourt: true,
          reason: dto.reason ?? 'no_motion_detected',
          mafd: dto.mafd ?? null,
          detectedAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      })
      .where(eq(matches.id, matchId));

    return { id: matchId, status: 'FAILED' as const };
  }
}
