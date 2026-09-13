import { Module } from '@nestjs/common';
import { CamerasController } from './cameras.controller';
import { CamerasService } from './cameras.service';
import { ImouCloudClient } from './imou-cloud.client';

@Module({
  controllers: [CamerasController],
  providers: [CamerasService, ImouCloudClient],
  exports: [CamerasService],
})
export class CamerasModule {}
