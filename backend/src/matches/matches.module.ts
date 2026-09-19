import { Module } from '@nestjs/common';
import { MatchesController } from './matches.controller';
import { MatchesService } from './matches.service';
import { MatchSchedulerService } from './match-scheduler.service';
import { VideoProcessingModule } from '../video-processing/video-processing.module';

@Module({
  imports: [VideoProcessingModule],
  controllers: [MatchesController],
  providers: [MatchesService, MatchSchedulerService],
  exports: [MatchesService, MatchSchedulerService],
})
export class MatchesModule {}
