import { Module } from '@nestjs/common';
import { ComplexesController } from './complexes.controller';
import { ComplexesService } from './complexes.service';

@Module({
  controllers: [ComplexesController],
  providers: [ComplexesService],
  exports: [ComplexesService],
})
export class ComplexesModule {}
