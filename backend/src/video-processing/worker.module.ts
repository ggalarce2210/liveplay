import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '../db/db.module';
import { StorageModule } from '../storage/storage.module';
import { VideoProcessingModule } from './video-processing.module';

/**
 * Módulo mínimo para correr SOLO el worker de procesamiento de video, sin levantar el
 * servidor HTTP. En producción esto corre como un deployment/replica set separado del API,
 * escalable de forma independiente (más CPU/GPU para transcodificar, sin tocar la capa web).
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), DbModule, StorageModule, VideoProcessingModule],
})
export class WorkerModule {}
