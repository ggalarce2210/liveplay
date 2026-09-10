import { Module } from '@nestjs/common';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';
import { VideoProcessingModule } from '../video-processing/video-processing.module';

@Module({
  imports: [VideoProcessingModule],
  controllers: [VideosController],
  providers: [VideosService],
  exports: [VideosService],
})
export class VideosModule {}
