import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { VIDEO_PROCESSING_QUEUE, VideoProcessingJobData } from './video-processing.queue';
import { VideoProcessingService } from './video-processing.service';

/**
 * Worker de la cola de procesamiento (§27/§28). Se puede ejecutar embebido en la API (dev/demo)
 * o como proceso separado (`npm run worker`, ver worker.main.ts) escalando horizontalmente
 * de forma independiente al servidor HTTP — clave para cuando haya muchas canchas grabando
 * a la vez.
 */
@Processor(VIDEO_PROCESSING_QUEUE, { concurrency: 2 })
export class VideoProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessingProcessor.name);

  constructor(private videoProcessingService: VideoProcessingService) {
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
}
