import { Module } from '@nestjs/common';
import { ClipsController } from './clips.controller';
import { VideoProcessingModule } from '../video-processing/video-processing.module';

@Module({
  imports: [VideoProcessingModule],
  controllers: [ClipsController],
})
export class ClipsModule {}
