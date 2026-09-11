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
 * Unico punto por el que se sirven bytes de video/imagen/manifest al navegador. Nunca se
 * expone la ruta fisica real: el cliente solo conoce una URL firmada de corta duracion
 * (`getSignedReadUrl`), que trae un JWT con la key embebida. Aca la validamos, chequeamos
 * expiracion y recien ahi servimos el archivo, con soporte de Range requests (imprescindible
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
      throw new BadRequestException('Enlace invalido o expirado');
    }

    const contentType = mime.lookup(payload.key);
    const localPath = this.storage.getLocalPathForRead?.(payload.key);

    // Backend remoto (S3/R2/MinIO): el driver no tiene una ruta de disco local
    // (`getLocalPathForRead` devuelve null a proposito, ver S3StorageDriver). El manifest y el
    // VTT son livianos y los seguimos reescribiendo nosotros para que cada linea apunte a este
    // mismo proxy; los segmentos .ts y el sprite de thumbnails, en cambio, son el peso real del
    // video, asi que redirigimos (302) a una URL firmada del propio bucket y el navegador los
    // baja directo de ahi, sin pasar por nuestro servidor.
    if (!localPath) {
      const exists = await this.storage.exists(payload.key);
      if (!exists) throw new NotFoundException('Archivo no encontrado');

      if (contentType === 'application/vnd.apple.mpegurl' || contentType === 'text/vtt') {
        const buffer = await this.storage.getObjectAsBuffer(payload.key);
        const rewritten = this.rewriteManifestOrVtt(buffer.toString('utf-8'), contentType, payload.key);
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'no-store');
        res.send(rewritten);
        return;
      }

      const signedUrl = await this.storage.getSignedReadUrl(payload.key, 60 * 60 * 4);
      res.redirect(302, signedUrl);
      return;
    }

    let stat;
    try {
      stat = await fsp.stat(localPath);
    } catch {
      throw new NotFoundException('Archivo no encontrado');
    }

    const range = req.headers.range;

    // Los .m3u8 y el .vtt de miniaturas reescriben referencias relativas a segmentos/sprite:
    // como el navegador pide cada uno por su propia URL firmada (no por ruta relativa),
    // reescribimos el archivo para que cada linea apunte a /stream/:tokenDeEseRecurso.
    if (contentType === 'application/vnd.apple.mpegurl' || contentType === 'text/vtt') {
      const content = await fsp.readFile(localPath, 'utf-8');
      const rewritten = this.rewriteManifestOrVtt(content, contentType, payload.key);
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

  /**
   * Reescribe un .m3u8 (segmentos) o un .vtt de miniaturas (lineas "sprite.jpg#xywh=...")
   * reemplazando cada referencia relativa por una URL firmada de corta duracion a este mismo
   * endpoint - usado tanto sirviendo desde disco local como desde un bucket remoto.
   */
  private rewriteManifestOrVtt(content: string, contentType: string, key: string): string {
    const baseKeyDir = key.substring(0, key.lastIndexOf('/'));
    const secret = this.config.get<string>('VIDEO_URL_SIGNING_SECRET', 'dev-secret-change-me');
    const publicBaseUrl = this.config.get<string>('API_PUBLIC_URL', 'http://localhost:3001');

    if (contentType === 'application/vnd.apple.mpegurl') {
      return content
        .split('\n')
        .map((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return line;
          const segKey = `${baseKeyDir}/${trimmed}`;
          const segToken = jwt.sign({ key: segKey }, secret, { expiresIn: 60 * 60 * 4 });
          return `${publicBaseUrl}/api/stream/${encodeURIComponent(segToken)}`;
        })
        .join('\n');
    }

    return content.replace(/^([\w.-]+\.jpg)(#xywh=[\d,]+)$/gm, (_match, fileName, fragment) => {
      const spriteKey = `${baseKeyDir}/${fileName}`;
      const spriteToken = jwt.sign({ key: spriteKey }, secret, { expiresIn: 60 * 60 * 4 });
      return `${publicBaseUrl}/api/stream/${encodeURIComponent(spriteToken)}${fragment}`;
    });
  }
}
