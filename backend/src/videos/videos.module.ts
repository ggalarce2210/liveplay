import { Module } from '@nestjs/common';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';
import { VideoProcessingModule } from '../video-processing/video-processing.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [VideoProcessingModule, PaymentsModule],
  controllers: [VideosController],
  providers: [VideosService],
  exports: [VideosService],
})
export class VideosModule {}
