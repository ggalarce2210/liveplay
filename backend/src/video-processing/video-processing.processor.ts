import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { clips, matches, videos } from '../db/schema';
import { VIDEO_PROCESSING_QUEUE, VideoProcessingJobData } from './video-processing.queue';
import { VideoProcessingService } from './video-processing.service';

/**
 * Worker de la cola de procesamiento (§27/§28). Se puede ejecutar embebido en la API (dev/demo)
 * o como proceso separado (`npm run worker`, ver worker.main.ts) escalando horizontalmente
 * de forma independiente al servidor HTTP - clave para cuando haya muchas canchas grabando
 * a la vez.
 *
 * `concurrency: 1` a proposito (antes era 2): con dos jobs de ffmpeg reales corriendo a la vez
 * (concat + re-encode con libx264) se vio caer el proceso entero en Render (probablemente por
 * memoria/CPU del plan chico) - varios clips quedaban en PENDING para siempre porque el crash
 * pasaba antes de que el try/catch de `generateClip` pudiera marcar el error. Serializar los
 * jobs pesados evita ese pico de recursos; el costo es que un partido/clip tarda un poco mas en
 * arrancar si hay otro procesandose, aceptable para el volumen de esta demo.
 */
@Processor(VIDEO_PROCESSING_QUEUE, { concurrency: 1 })
export class VideoProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessingProcessor.name);

  constructor(
    private videoProcessingService: VideoProcessingService,
    private dbService: DbService,
  ) {
    super();
  }

  async process(job: Job<VideoProcessingJobData>): Promise<void> {
    this.logger.log(`Procesando job ${job.id} (${job.data.type})`);
    if (job.data.type === 'process-match-video') {
      await this.videoProcessingService.processMatchVideo(job.data);
    } else if (job.data.type === 'generate-clip') {
      await this.videoProcessingService.generateClip(job.data);
    }
  }

  /**
   * Red de seguridad: si el proceso se cae a mitad de un job (OOM, restart de Render, etc.), el
   * try/catch de `generateClip`/`processMatchVideo` nunca llega a ejecutarse, y sin esto la fila
   * en la base queda en PENDING/PROCESSING para siempre (asi se reprodujo el bug reportado: el
   * usuario ve "Generando..." sin fin, sin error, sin forma de reintentar). BullMQ reintenta
   * jobs "stalled" un par de veces solo y recien ahi emite 'failed' - este handler es lo que
   * traduce ese estado final de la cola a un status FAILED visible para el usuario, aunque la
   * causa haya sido un crash del proceso y no una excepcion capturada.
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<VideoProcessingJobData> | undefined, err: Error) {
    if (!job) return;
    this.logger.error(`Job ${job.id} (${job.data.type}) fallo definitivamente: ${err?.message}`);
    const db = this.dbService.db;
    try {
      if (job.data.type === 'generate-clip') {
        const clip = await db.query.clips.findFirst({ where: eq(clips.id, job.data.clipId) });
        if (clip && clip.status !== 'READY') {
          await db.update(clips).set({ status: 'FAILED', errorMessage: String(err?.message ?? err), updatedAt: new Date() }).where(eq(clips.id, job.data.clipId));
        }
      } else if (job.data.type === 'process-match-video') {
        const video = await db.query.videos.findFirst({ where: eq(videos.id, job.data.videoId) });
        if (video && video.status !== 'READY') {
          await db.update(videos).set({ status: 'FAILED', errorMessage: String(err?.message ?? err), updatedAt: new Date() }).where(eq(videos.id, job.data.videoId));
          await db.update(matches).set({ status: 'FAILED', updatedAt: new Date() }).where(eq(matches.id, video.matchId));
        }
      }
    } catch (updateErr) {
      this.logger.error(`No se pudo marcar el job ${job.id} como fallido en la base`, updateErr as Error);
    }
  }
}
