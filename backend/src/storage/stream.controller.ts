import { BadRequestException, Controller, Get, Inject, NotFoundException, Param, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import * as jwt from 'jsonwebtoken';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as mime from '../common/mime';
import { STORAGE_DRIVER } from './storage.module';
import { StorageDriver } from './storage.types';

/**
 * Único punto por el que se sirven bytes de video/imagen/manifest al navegador. Nunca se
 * expone la ruta física real (§25): el cliente solo conoce una URL firmada de corta duración
 * (`getSignedReadUrl`), que trae un JWT con la key embebida. Acá la validamos, chequeamos
 * expiración y recién ahí servimos el archivo, con soporte de Range requests (imprescindible
 * para que el <video>/hls.js pueda hacer seek eficiente).
 */
@Controller('stream')
export class StreamController {
  constructor(
    @Inject(STORAGE_DRIVER) private storage: StorageDriver,
    private config: ConfigService,
  ) {}

  @Get(':token')
  async stream(@Param('token') token: string, @Req() req: Request, @Res() res: Response) {
    let payload: { key: string };
    try {
      const secret = this.config.get<string>('VIDEO_URL_SIGNING_SECRET', 'dev-secret-change-me');
      payload = jwt.verify(decodeURIComponent(token), secret) as { key: string };
    } catch {
      throw new BadRequestException('Enlace inválido o expirado');
    }

    const localPath = this.storage.getLocalPathForRead?.(payload.key);
    if (!localPath) throw new NotFoundException('Archivo no encontrado');

    let stat;
    try {
      stat = await fsp.stat(localPath);
    } catch {
      throw new NotFoundException('Archivo no encontrado');
    }

    const contentType = mime.lookup(localPath);
    const range = req.headers.range;

    // Los .m3u8 reescriben referencias relativas a segmentos: como el navegador pide cada
    // segmento por su propia URL firmada (no por ruta relativa), reescribimos el manifest
    // para que cada línea de segmento apunte a /stream/:tokenDeEseSegmento.
    if (contentType === 'application/vnd.apple.mpegurl') {
      const content = await fsp.readFile(localPath, 'utf-8');
      const baseKeyDir = payload.key.substring(0, payload.key.lastIndexOf('/'));
      const secret = this.config.get<string>('VIDEO_URL_SIGNING_SECRET', 'dev-secret-change-me');
      const publicBaseUrl = this.config.get<string>('API_PUBLIC_URL', 'http://localhost:3001');
      const rewritten = content
        .split('\n')
        .map((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return line;
          const segKey = `${baseKeyDir}/${trimmed}`;
          const segToken = jwt.sign({ key: segKey }, secret, { expiresIn: 60 * 60 * 4 });
          return `${publicBaseUrl}/api/stream/${encodeURIComponent(segToken)}`;
        })
        .join('\n');
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'no-store');
      res.send(rewritten);
      return;
    }

    // El WebVTT de miniaturas referencia "sprite.jpg#xywh=..." en forma relativa; lo
    // reescribimos igual que el manifest para que apunte a una URL firmada del sprite.
    if (contentType === 'text/vtt') {
      const content = await fsp.readFile(localPath, 'utf-8');
      const baseKeyDir = payload.key.substring(0, payload.key.lastIndexOf('/'));
      const secret = this.config.get<string>('VIDEO_URL_SIGNING_SECRET', 'dev-secret-change-me');
      const publicBaseUrl = this.config.get<string>('API_PUBLIC_URL', 'http://localhost:3001');
      const rewritten = content.replace(/^([\w.-]+\.jpg)(#xywh=[\d,]+)$/gm, (_match, fileName, fragment) => {
        const spriteKey = `${baseKeyDir}/${fileName}`;
        const spriteToken = jwt.sign({ key: spriteKey }, secret, { expiresIn: 60 * 60 * 4 });
        return `${publicBaseUrl}/api/stream/${encodeURIComponent(spriteToken)}${fragment}`;
      });
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'no-store');
      res.send(rewritten);
      return;
    }

    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : stat.size - 1;
      const chunkSize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
        'Cache-Control': contentType === 'video/MP2T' ? 'public, max-age=86400, immutable' : 'no-store',
      });
      fs.createReadStream(localPath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': contentType === 'video/MP2T' ? 'public, max-age=86400, immutable' : 'no-store',
      });
      fs.createReadStream(localPath).pipe(res);
    }
  }
}
