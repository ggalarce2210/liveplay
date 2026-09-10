import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  Logger.log('🎬 Worker de procesamiento de video escuchando la cola Redis/BullMQ...', 'Worker');
  await app.init();
}
bootstrap();
