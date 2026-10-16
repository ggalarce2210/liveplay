import { BadRequestException, Controller, Inject, Param, Put, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import * as jwt from 'jsonwebtoken';
import { STORAGE_DRIVER } from './storage.module';
import { StorageDriver } from './storage.types';

/**
 * Contraparte de StreamController, pero para SUBIR un archivo en vez de descargarlo. Solo entra
 * en juego cuando el driver activo es LocalDiskStorageDriver (demo / sin R2 configurado): ese
 * driver no tiene un bucket real al que apuntar con una URL PUT firmada de verdad, así que
 * `LocalDiskStorageDriver.getSignedPutUrl` devuelve un link a ESTE endpoint en vez de eso — mismo
 * JWT de corta duración que StreamController y el mismo secreto (`VIDEO_URL_SIGNING_SECRET`),
 * pero marcado `put:true` para que un token de lectura nunca pueda reutilizarse para escribir
 * (y viceversa). En producción con S3StorageDriver (R2) esto no se usa nunca: el agente del
 * mini-PC sube directo al bucket con la URL firmada real de S3 (ver AgentService.createUploadPlan
 * / "Escenario B" en backend/AGENTE.md).
 *
 * El body se recibe crudo (sin pasar por el body-parser JSON/urlencoded de Nest, que solo actúa
 * sobre esos dos Content-Type — ver main.ts) y se bufferiza entero: los archivos que sube el
 * agente (segmentos HLS de ~6s, sprites, manifest) pesan como mucho un par de MB, muy lejos del
 * volumen (cientos de MB/GB) que sí justifica el streaming-a-disco que usa `downloadToFile` para
 * el video original completo.
 */
@Controller('storage')
export class AgentUploadController {
  constructor(
    @Inject(STORAGE_DRIVER) private storage: StorageDriver,
    private config: ConfigService,
  ) {}

  @Put('agent-upload/:token')
  async upload(@Param('token') token: string, @Req() req: Request) {
    let payload: { key: string; contentType: string; put?: boolean };
    try {
      const secret = this.config.get<string>('VIDEO_URL_SIGNING_SECRET', 'dev-secret-change-me');
      payload = jwt.verify(decodeURIComponent(token), secret) as typeof payload;
    } catch {
      throw new BadRequestException('Enlace de subida inválido o expirado');
    }
    if (!payload.put) {
      throw new BadRequestException('Este token no está habilitado para subir archivos');
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks);

    await this.storage.putObject({ key: payload.key, body, contentType: payload.contentType });
    return { ok: true, key: payload.key, bytes: body.length };
  }
}
