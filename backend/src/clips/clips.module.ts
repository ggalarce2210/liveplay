import { Module } from '@nestjs/common';
import { ClipsController } from './clips.controller';
import { VideoProcessingModule } from '../video-processing/video-processing.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [VideoProcessingModule, PaymentsModule],
  controllers: [ClipsController],
})
export class ClipsModule {}
