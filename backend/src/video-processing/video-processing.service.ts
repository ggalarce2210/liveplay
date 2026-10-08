import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { eq, gt, lt, and, asc } from 'drizzle-orm';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { DbService } from '../db/db.service';
import { videos, matches, videoSegments, notifications, clips } from '../db/schema';
import { FfmpegService } from './ffmpeg.service';
import { STORAGE_DRIVER } from '../storage/storage.module';
import { StorageDriver } from '../storage/storage.types';
import { VIDEO_PROCESSING_QUEUE, VideoProcessingJobData } from './video-processing.queue';

/**
 * Orquesta el procesamiento de video. Encola trabajos en BullMQ/Redis (§27, §28) para que
 * la ingesta de un partido no bloquee la API. `runProcessMatchVideoNow` ejecuta el mismo
 * pipeline de forma síncrona — se usa en el script de seed/demo cuando no hay un worker
 * separado corriendo, pero en producción SIEMPRE se debe usar la cola.
 */
@Injectable()
export class VideoProcessingService {
  private readonly logger = new Logger(VideoProcessingService.name);

  constructor(
    @InjectQueue(VIDEO_PROCESSING_QUEUE) private queue: Queue<VideoProcessingJobData>,
    private dbService: DbService,
    private ffmpeg: FfmpegService,
    @Inject(STORAGE_DRIVER) private storage: StorageDriver,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  /**
   * `attempts`/`backoff`: si el proceso se cae a mitad de un job (ver nota en
   * VideoProcessingProcessor sobre por que esto pasaba con clips), BullMQ lo detecta como
   * "stalled" y lo vuelve a intentar - sin attempts > 1 esto se agota mucho antes y el job queda
   * dado por perdido (marcado 'failed' en la cola, pero sin haber corrido de nuevo). Con 3
   * intentos y backoff exponencial le damos margen a que la instancia se recupere entre uno y
   * otro antes de rendirse definitivamente (y ahi es cuando entra el listener de 'failed').
   */
  async enqueueProcessMatchVideo(videoId: string, sourceStorageKey: string) {
    await this.queue.add(
      'process-match-video',
      { type: 'process-match-video', videoId, sourceStorageKey },
      { attempts: 3, backoff: { type: 'exponential', delay: 15_000 } },
    );
  }

  /**
   * Sube el archivo recién recibido (ruta local EFÍMERA de Multer, ej. /tmp/ecp-uploads/<hash>)
   * a storage PERSISTENTE (R2/S3) antes de encolar el job — incidente 2026-10-08: antes,
   * `attachVideo` pasaba esa ruta local directo al job de BullMQ, que persiste durmiendo en Redis
   * hasta que el worker lo ejecuta; si el contenedor se reciclaba en el medio (deploy, OOM, o
   * simplemente el spin-down por inactividad del free tier de Render) ese archivo temporal ya no
   * existía en ningún lado y el job fallaba con ENOENT tras agotar sus 3 reintentos, perdiendo el
   * video original sin posibilidad de recuperarlo. Subiéndolo primero a storage persistente, el
   * worker puede descargarlo de ahí (ver `processMatchVideo`) sin importar cuántos reinicios
   * pasaron en el medio — R2/S3 sobrevive a cualquier reciclado del contenedor.
   */
  async ingestSourceFile(videoId: string, localUploadPath: string): Promise<string> {
    const ext = path.extname(localUploadPath) || '.mp4';
    const sourceStorageKey = `incoming/${videoId}/source${ext}`;
    await this.storage.putObject({ key: sourceStorageKey, filePath: localUploadPath, contentType: 'video/mp4' });
    try {
      await fs.rm(localUploadPath, { force: true });
    } catch (err) {
      this.logger.warn(`No se pudo borrar el archivo temporal de subida ${localUploadPath}: ${(err as Error).message}`);
    }
    await this.enqueueProcessMatchVideo(videoId, sourceStorageKey);
    return sourceStorageKey;
  }

  async enqueueGenerateClip(clipId: string) {
    await this.queue.add(
      'generate-clip',
      { type: 'generate-clip', clipId },
      { attempts: 3, backoff: { type: 'exponential', delay: 15_000 } },
    );
  }

  // Usado por el script de seed/demo: corre el pipeline directo sobre un archivo local de
  // ejemplo, sin pasar por storage persistente ni por la cola — no aplica el riesgo de reciclado
  // de contenedor que motiva `ingestSourceFile`/`processMatchVideo` (no hay espera entre la
  // "subida" y el procesamiento).
  async runProcessMatchVideoNow(videoId: string, sourceFilePath: string) {
    return this.runMatchVideoPipeline(videoId, sourceFilePath);
  }

  async runGenerateClipNow(clipId: string) {
    return this.generateClip({ type: 'generate-clip', clipId });
  }

  /**
   * Punto de entrada del worker para un job 'process-match-video' (§27/§28). `job.data` ya NO
   * trae una ruta local: trae la key en storage persistente donde `ingestSourceFile` subió el
   * original (ver comentario ahí y en video-processing.queue.ts). Acá se resuelve esa key a un
   * archivo local -y recién ahí se corre el pipeline de FFmpeg, que necesita un path de disco-,
   * usando el atajo de `getLocalPathForRead` si el driver es local (demo) o descargando con
   * streaming (`downloadToFile`, nunca bufferizando el video entero en memoria) si es S3/R2.
   */
  async processMatchVideo(job: Extract<VideoProcessingJobData, { type: 'process-match-video' }>) {
    const { videoId, sourceStorageKey } = job;
    const localPathFromDriver = this.storage.getLocalPathForRead?.(sourceStorageKey);
    if (localPathFromDriver) {
      await this.runMatchVideoPipeline(videoId, localPathFromDriver);
    } else {
      const downloadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ecp-source-'));
      const downloadedPath = path.join(downloadDir, `source${path.extname(sourceStorageKey) || '.mp4'}`);
      try {
        await this.storage.downloadToFile(sourceStorageKey, downloadedPath);
        await this.runMatchVideoPipeline(videoId, downloadedPath);
      } finally {
        await fs.rm(downloadDir, { recursive: true, force: true });
      }
    }
    // El original ya está procesado y persistido como HLS/thumbs: el crudo no hace más falta.
    // Si `runMatchVideoPipeline` arriba lanzó una excepción, no llegamos a esta línea — el
    // original persistido queda intacto para que BullMQ pueda reintentar el job (ver
    // `cleanupAbandonedSource`, que lo borra solo cuando se agotan los reintentos definitivamente).
    await this.storage.deleteObject(sourceStorageKey).catch((err) => {
      this.logger.warn(`No se pudo borrar el original persistido ${sourceStorageKey}: ${(err as Error).message}`);
    });
  }

  /**
   * Best-effort: llamado desde el listener 'failed' del processor cuando un job de
   * process-match-video agotó sus 3 reintentos definitivamente — el original persistido en
   * storage ya no se va a usar nunca más, así que se limpia para no dejarlo acumulándose en el
   * bucket. Si falla, solo se loguea (no es crítico: el video de todos modos ya quedó FAILED).
   */
  async cleanupAbandonedSource(sourceStorageKey: string): Promise<void> {
    try {
      await this.storage.deleteObject(sourceStorageKey);
    } catch (err) {
      this.logger.warn(`No se pudo limpiar el original abandonado ${sourceStorageKey}: ${(err as Error).message}`);
    }
  }

  /**
   * Pipeline real de FFmpeg (probe -> HLS -> thumbnails -> poster -> subida a storage -> DB).
   * Recibe siempre una ruta LOCAL de disco ya resuelta — no sabe ni le importa si esa ruta viene
   * del driver local (demo), de una descarga desde S3/R2 (producción, ver `processMatchVideo`), o
   * de un archivo de ejemplo del seed (ver `runProcessMatchVideoNow`). Lógica sin cambios respecto
   * a la versión anterior a la corrección del 2026-10-08 — solo se extrajo a un método separado.
   */
  private async runMatchVideoPipeline(videoId: string, sourceFilePath: string) {
    const video = await this.db.query.videos.findFirst({ where: eq(videos.id, videoId), with: { match: true } });
    if (!video) throw new Error(`Video ${videoId} no encontrado`);
    await this.db.update(videos).set({ status: 'PROCESSING' }).where(eq(videos.id, videoId));
    await this.db.update(matches).set({ status: 'PROCESSING' }).where(eq(matches.id, video.matchId));

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ecp-video-'));
    try {
      const probeResult = await this.ffmpeg.probe(sourceFilePath);

      // Detección de video incompleto (incidente 2026-10-08): si el partido tiene `endTime`
      // cargado, comparamos la duración real del archivo fuente contra la duración esperada del
      // turno (`endTime - startTime`). Un video sensiblemente más corto que lo esperado casi
      // siempre significa que la grabación de origen ya llegó incompleta - típicamente un corte
      // de wifi en la cancha a mitad de partido en "modo puente" (ver backend/AGENTE.md, sección
      // "Modo puente": ese modo no tiene colchón local, así que lo que no se llega a empujar se
      // pierde para siempre) - y NO un bug de este pipeline: FFmpeg ya reporta fielmente la
      // duración del archivo que recibió, por eso termina en 'READY' y no en 'FAILED'. Margen de
      // 120s para no disparar falsos positivos por el desfasaje de hasta un par de segundos del
      // corte a keyframe más cercano (ver "Limitaciones conocidas" en AGENTE.md). Si el partido no
      // tiene `endTime` (hoy todavía lo más común), no hay forma confiable de saber la duración
      // esperada desde acá - esa cuenta la hace hoy el agente local con `BUFFER_MINUTES` -, así
      // que no marcamos nada en ese caso.
      const expectedDurationSeconds = video.match?.endTime
        ? (video.match.endTime.getTime() - video.match.startTime.getTime()) / 1000
        : null;
      const durationWarning = expectedDurationSeconds != null && probeResult.durationSeconds < expectedDurationSeconds - 120;
      if (durationWarning) {
        this.logger.warn(
          `Video ${videoId}: duración procesada (${probeResult.durationSeconds.toFixed(1)}s) muy por debajo de la ` +
            `esperada para el turno (${expectedDurationSeconds!.toFixed(1)}s) - probablemente la grabación de origen ` +
            `llegó incompleta. Se marca duration_warning=true para revisión manual.`,
        );
      }

      const hlsDir = path.join(tmpDir, 'hls');
      const { manifestFile, segments } = await this.ffmpeg.generateHls(sourceFilePath, hlsDir);

      const thumbsDir = path.join(tmpDir, 'thumbs');
      const { spriteFile, vttFile } = await this.ffmpeg.generateThumbnailSprite(sourceFilePath, thumbsDir);

      // El poster es "lindo tener", no crítico: si un video puntual es demasiado corto/raro y
      // FFmpeg no puede sacar el frame en `atSeconds`, no queremos que eso tire abajo todo el
      // procesamiento del partido (que sí es crítico) — la tarjeta cae de nuevo al ícono
      // genérico si `posterKey` queda null.
      const posterFile = 'poster.jpg';
      let hasPoster = false;
      try {
        await this.ffmpeg.generatePoster(sourceFilePath, path.join(thumbsDir, posterFile));
        hasPoster = true;
      } catch (posterErr) {
        this.logger.warn(`No se pudo generar el poster del video ${videoId}: ${(posterErr as Error).message}`);
      }

      let sizeBytes = 0;
      for (const seg of segments) {
        const stat = await fs.stat(path.join(hlsDir, seg.fileName));
        sizeBytes += stat.size;
      }
      sizeBytes += (await fs.stat(path.join(thumbsDir, spriteFile))).size;

      // Subir todo a la capa de storage bajo storageBaseKey (§10, §26)
      const base = video.storageBaseKey;
      await this.storage.putObject({ key: `${base}/hls/${manifestFile}`, filePath: path.join(hlsDir, manifestFile), contentType: 'application/vnd.apple.mpegurl' });
      for (const seg of segments) {
        await this.storage.putObject({ key: `${base}/hls/${seg.fileName}`, filePath: path.join(hlsDir, seg.fileName), contentType: 'video/MP2T' });
      }
      await this.storage.putObject({ key: `${base}/thumbs/${spriteFile}`, filePath: path.join(thumbsDir, spriteFile), contentType: 'image/jpeg' });
      await this.storage.putObject({ key: `${base}/thumbs/${vttFile}`, filePath: path.join(thumbsDir, vttFile), contentType: 'text/vtt' });
      if (hasPoster) {
        await this.storage.putObject({ key: `${base}/thumbs/${posterFile}`, filePath: path.join(thumbsDir, posterFile), contentType: 'image/jpeg' });
      }

      await this.db.transaction(async (tx) => {
        await tx.delete(videoSegments).where(eq(videoSegments.videoId, videoId));
        if (segments.length) {
          await tx.insert(videoSegments).values(
            segments.map((seg) => ({
              videoId,
              index: seg.index,
              startOffsetSeconds: seg.startOffsetSeconds,
              endOffsetSeconds: seg.endOffsetSeconds,
              durationSeconds: seg.durationSeconds,
              storageKey: `${base}/hls/${seg.fileName}`,
              status: 'PROCESSED' as const,
            })),
          );
        }
        await tx
          .update(videos)
          .set({
            status: 'READY',
            hlsManifestKey: `${base}/hls/${manifestFile}`,
            posterKey: hasPoster ? `${base}/thumbs/${posterFile}` : null,
            thumbnailSpriteKey: `${base}/thumbs/${spriteFile}`,
            thumbnailVttKey: `${base}/thumbs/${vttFile}`,
            durationSeconds: probeResult.durationSeconds,
            durationWarning,
            width: probeResult.width,
            height: probeResult.height,
            fps: probeResult.fps,
            sizeBytes,
            updatedAt: new Date(),
          })
          .where(eq(videos.id, videoId));
        await tx.update(matches).set({ status: 'READY', updatedAt: new Date() }).where(eq(matches.id, video.matchId));
      });

      const match = await this.db.query.matches.findFirst({ where: eq(matches.id, video.matchId), with: { players: true } });
      if (match) {
        const userIds = match.players.map((p) => p.userId).filter(Boolean) as string[];
        if (userIds.length) {
          await this.db.insert(notifications).values(
            userIds.map((userId) => ({
              userId,
              type: 'MATCH_READY' as const,
              title: 'Tu partido ya está disponible',
              body: `Tu partido del ${match.date} ya puede reproducirse.`,
              metadata: { matchId: match.id },
            })),
          );
        }
      }

      this.logger.log(`Video ${videoId} procesado: ${segments.length} segmentos, ${probeResult.durationSeconds.toFixed(1)}s`);
    } catch (err) {
      this.logger.error(`Falló el procesamiento del video ${videoId}`, err as Error);
      await this.db.update(videos).set({ status: 'FAILED', errorMessage: String(err), updatedAt: new Date() }).where(eq(videos.id, videoId));
      await this.db.update(matches).set({ status: 'FAILED', updatedAt: new Date() }).where(eq(matches.id, video.matchId));
      throw err;
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }

  /**
   * Backfill puntual (2026-09-24) para videos que se procesaron ANTES de que existiera la
   * función de portada (`posterKey` quedó `null` para siempre en ellos, ya que el pipeline
   * normal solo genera el poster durante `processMatchVideo`). No hace falta el archivo
   * original: `originalFileKey` nunca se persiste (ver comentario en el schema), así que en vez
   * de reprocesar el partido entero se toma el primer segmento HLS ya guardado (~6s, ver
   * `SEGMENT_TARGET_SECONDS` en FfmpegService) y se le extrae un frame — mismo resultado visual
   * que si se hubiera generado en su momento, sin tener que volver a subir nada. Pensado para
   * llamarse una sola vez por admin vía `POST /admin/videos/backfill-posters`, no forma parte
   * del pipeline normal.
   */
  async backfillPosters() {
    const targets = await this.db.query.videos.findMany({
      where: (v, { and, eq, isNull, isNotNull }) => and(eq(v.status, 'READY'), isNull(v.posterKey), isNotNull(v.hlsManifestKey)),
    });
    const results: { videoId: string; ok: boolean; error?: string }[] = [];
    for (const video of targets) {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ecp-poster-backfill-'));
      try {
        const firstSegment = await this.db.query.videoSegments.findFirst({
          where: eq(videoSegments.videoId, video.id),
          orderBy: [asc(videoSegments.index)],
        });
        if (!firstSegment) throw new Error('El video no tiene segmentos guardados');

        const segLocalPath = path.join(tmpDir, 'segment.ts');
        const buf = await this.storage.getObjectAsBuffer(firstSegment.storageKey);
        await fs.writeFile(segLocalPath, buf);

        // atSeconds=0 (primer frame disponible): los segmentos HLS conservan el PTS absoluto
        // del stream original (no se resetea a 0 por segmento), así que pedir "el segundo 1"
        // podía caer antes del inicio del segmento y no encontrar ningún frame — FFmpeg en ese
        // caso termina con código 0 pero sin escribir el archivo de salida (silencioso). Pedir
        // el primer frame disponible es válido siempre, sin depender de esos timestamps.
        const posterLocalPath = path.join(tmpDir, 'poster.jpg');
        await this.ffmpeg.generatePoster(segLocalPath, posterLocalPath, 0);

        let posterBuffer: Buffer;
        try {
          posterBuffer = await fs.readFile(posterLocalPath);
        } catch {
          throw new Error('FFmpeg no generó el archivo de portada (sin frames en el segmento)');
        }

        // Subimos como Buffer (`body`) en vez de `filePath` (que en el driver S3/R2 arma un
        // `fs.createReadStream`): con un stream crudo, el SDK de AWS no conoce el content-length
        // de antemano y en R2 eso rompe con "Invalid value undefined for header
        // x-amz-decoded-content-length" — y como el stream queda sin consumir, el intento de
        // abrirlo más tarde (ya con esta carpeta temporal borrada por el `finally`) tira un ENOENT
        // no capturado que tumba el proceso entero. El poster pesa unos KB, así que cargarlo
        // entero en memoria es la vía simple y segura acá (no aplica al resto de `putObject`,
        // que sigue usando streams para archivos grandes como segmentos/clips).
        const posterKey = `${video.storageBaseKey}/thumbs/poster.jpg`;
        await this.storage.putObject({ key: posterKey, body: posterBuffer, contentType: 'image/jpeg' });
        await this.db.update(videos).set({ posterKey, updatedAt: new Date() }).where(eq(videos.id, video.id));
        results.push({ videoId: video.id, ok: true });
      } catch (err) {
        this.logger.warn(`No se pudo generar poster retroactivo para el video ${video.id}: ${(err as Error).message}`);
        results.push({ videoId: video.id, ok: false, error: String(err) });
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    }
    return results;
  }

  async generateClip(job: Extract<VideoProcessingJobData, { type: 'generate-clip' }>) {
    const { clipId } = job;
    const clip = await this.db.query.clips.findFirst({ where: eq(clips.id, clipId), with: { match: { with: { video: true } } } });
    if (!clip) throw new Error(`Clip ${clipId} no encontrado`);
    if (!clip.match.video?.hlsManifestKey) throw new Error('El partido todavía no tiene video procesado');

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ecp-clip-'));
    try {
      const video = clip.match.video;
      const segments = await this.db.query.videoSegments.findMany({
        where: and(eq(videoSegments.videoId, video.id), gt(videoSegments.endOffsetSeconds, clip.startSeconds), lt(videoSegments.startOffsetSeconds, clip.endSeconds)),
        orderBy: [asc(videoSegments.index)],
      });
      if (!segments.length) {
        throw new Error(`No hay segmentos de video que cubran el rango ${clip.startSeconds}s-${clip.endSeconds}s`);
      }
      const concatListPath = path.join(tmpDir, 'concat.txt');
      const localPaths: string[] = [];
      for (const seg of segments) {
        const localPath = path.join(tmpDir, path.basename(seg.storageKey));
        const buf = await this.storage.getObjectAsBuffer(seg.storageKey);
        await fs.writeFile(localPath, buf);
        localPaths.push(localPath);
      }
      await fs.writeFile(concatListPath, localPaths.map((p) => `file '${p}'`).join('\n'));

      const joinedPath = path.join(tmpDir, 'joined.mp4');
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      await promisify(execFile)('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', joinedPath]);

      const firstSegStart = segments[0]?.startOffsetSeconds ?? 0;
      const relativeStart = clip.startSeconds - firstSegStart;
      const relativeEnd = clip.endSeconds - firstSegStart;

      const outputPath = path.join(tmpDir, 'clip.mp4');
      await this.ffmpeg.generateClip(joinedPath, relativeStart, relativeEnd, outputPath);

      const key = `clips/${clip.matchId}/${clip.id}.mp4`;
      await this.storage.putObject({ key, filePath: outputPath, contentType: 'video/mp4' });

      await this.db.update(clips).set({ status: 'READY', storageKey: key, updatedAt: new Date() }).where(eq(clips.id, clipId));
    } catch (err) {
      this.logger.error(`Falló la generación del clip ${clipId}`, err as Error);
      await this.db.update(clips).set({ status: 'FAILED', errorMessage: String(err), updatedAt: new Date() }).where(eq(clips.id, clipId));
      throw err;
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }
}
