import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { clips, matches, videos } from '../db/schema';
import { VIDEO_PROCESSING_QUEUE, VideoProcessingJobData } from './video-processing.queue';
import { VideoProcessingService } from './video-processing.service';

/**
 * Worker de la cola de procesamiento (§27/§28). Se puede ejecutar embebido en la API (dev/demo)
 * o como proceso separado (`npm run worker`, ver worker.main.ts) escalando horizontalmente
 * de forma independiente al servidor HTTP — clave para cuando haya muchas canchas grabando
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
export class VideoProcessingProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(VideoProcessingProcessor.name);

  // Backoff para cuando Redis (Upstash) empieza a rechazar comandos (ej. límite mensual de
  // requests agotado, 2026-09-23: "ERR max requests limit exceeded"). Sin esto, BullMQ reintenta
  // el polling de la cola (bzpopmin sobre la "marker key") cada ~100ms sin parar apenas Redis
  // responde con un error en vez de bloquear (ver bullmq/dist/cjs/classes/worker.js,
  // `waitForJob`) — eso son miles de requests por minuto contra Redis las 24hs, aunque no haya
  // ningún video subiéndose, y fue justamente lo que terminó de agotar la cuota del free tier de
  // Upstash. Acá pausamos el worker con backoff exponencial (2s -> ... -> tope de 60s) mientras
  // los errores sigan, y lo reanudamos apenas vuelve a andar. No distingue el tipo de error
  // adrede: cualquier fallo sostenido de Redis (cuota agotada, caída de red, lo que sea) debe
  // frenar el loop igual, no solo este mensaje puntual.
  private static readonly BASE_BACKOFF_MS = 2_000;
  private static readonly MAX_BACKOFF_MS = 60_000;
  private consecutiveErrors = 0;
  private pausedForBackoff = false;
  private resumeTimer?: NodeJS.Timeout;

  constructor(
    private videoProcessingService: VideoProcessingService,
    private dbService: DbService,
  ) {
    super();
  }

  onApplicationBootstrap() {
    this.worker.on('error', (err: Error) => this.handleWorkerError(err));
    this.worker.on('active', () => this.resetBackoff());
  }

  private handleWorkerError(err: Error) {
    this.consecutiveErrors += 1;
    const backoffMs = Math.min(
      VideoProcessingProcessor.BASE_BACKOFF_MS * 2 ** (this.consecutiveErrors - 1),
      VideoProcessingProcessor.MAX_BACKOFF_MS,
    );
    this.logger.warn(
      `Error en el worker de video (#${this.consecutiveErrors}): ${err?.message}. ` +
        `Pausando el polling de la cola ${backoffMs}ms para no bombardear Redis.`,
    );
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    if (!this.pausedForBackoff) {
      this.pausedForBackoff = true;
      // No esperamos esta promesa: si Redis está caído, pause() también puede colgarse:
      // preferimos seguir adelante y dejar que el propio worker reintente su conexión.
      this.worker.pause().catch((pauseErr) => this.logger.error('No se pudo pausar el worker', pauseErr as Error));
    }
    this.resumeTimer = setTimeout(() => {
      this.pausedForBackoff = false;
      this.worker.resume();
      this.logger.log('Reanudando el worker de video tras el backoff.');
    }, backoffMs);
  }

  private resetBackoff() {
    if (this.consecutiveErrors > 0) {
      this.logger.log('El worker de video volvió a procesar normalmente, reseteando el backoff.');
    }
    this.consecutiveErrors = 0;
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
