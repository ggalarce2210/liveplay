import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { FfmpegService } from './ffmpeg.service';
import { VideoProcessingService } from './video-processing.service';
import { VideoProcessingProcessor } from './video-processing.processor';
import { VIDEO_PROCESSING_QUEUE } from './video-processing.queue';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const password = config.get<string>('REDIS_PASSWORD');
        const useTls = config.get<string>('REDIS_TLS', 'false') === 'true';
        return {
          connection: {
            host: config.get<string>('REDIS_HOST', 'localhost'),
            port: config.get<number>('REDIS_PORT', 6379),
            ...(password ? { password } : {}),
            // Upstash (y la mayoría de los Redis "cloud") exponen el puerto solo con TLS.
            ...(useTls ? { tls: {} } : {}),
          },
        };
      },
    }),
    BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE }),
  ],
  providers: [FfmpegService, VideoProcessingService, VideoProcessingProcessor],
  exports: [FfmpegService, VideoProcessingService],
})
export class VideoProcessingModule {}
