import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ShareController } from './share.controller';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [JwtModule.register({}), PaymentsModule],
  controllers: [ShareController],
})
export class ShareModule {}
