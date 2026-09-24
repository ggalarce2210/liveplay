import { Module } from '@nestjs/common';
import { VideoProcessingModule } from '../video-processing/video-processing.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [VideoProcessingModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
