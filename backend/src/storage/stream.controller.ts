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

    const contentType = mime.lookup(payload.key);
    const localPath = this.storage.getLocalPathForRead?.(payload.key);

    // Backend remoto (S3/R2/MinIO): el driver no tiene una ruta de disco local
    // (`getLocalPathForRead` devuelve null a propósito, ver S3StorageDriver). El manifest y el
    // VTT son livianos y los seguimos reescribiendo nosotros para que cada línea apunte a este
    // mismo proxy; los segmentos .ts y el sprite de thumbnails, en cambio, son el peso real del
    // video, así que redirigimos (302) a una URL firmada del propio bucket y el navegador los
    // baja directo de ahí, sin pasar por nuestro servidor.
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
    // reescribimos el archivo para que cada línea apunte a /stream/:tokenDeEseRecurso.
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
   * Reescribe un .m3u8 (segmentos) o un .vtt de miniaturas (líneas "sprite.jpg#xywh=...")
   * reemplazando cada referencia relativa por una URL firmada de corta duración a este mismo
   * endpoint — usado tanto sirviendo desde disco local como desde un bucket remoto (§25: nunca
   * se expone la key/ruta física real al cliente).
   *
   * Bug real encontrado el 2026-10-21: esta función arma la URL pública concatenando
   * `API_PUBLIC_URL` (config) + "/api/stream/...". Eso fue correcto mientras `API_PUBLIC_URL`
   * en Render apuntaba solo al host (sin "/api"). El 2026-10-20 se corrigió `API_PUBLIC_URL`
   * para que SÍ incluya el sufijo "/api" — necesario para que el agente local
   * (`agent-enroll.controller.ts` le entrega este mismo valor al mini-PC como
   * `LIVEPLAY_API_BASE`, y `local-agent/agent_lib.py` arma sus URLs como
   * `f"{LIVEPLAY_API_BASE}/agent/..."` sin agregar "/api" de nuevo) — pero esa misma variable
   * la lee ACÁ TAMBIÉN esta función, que todavía agregaba su propio "/api/" a mano, resultando
   * en URLs con "/api/api/stream/..." (404 siempre). Esto rompió la reproducción/miniaturas de
   * TODOS los partidos de la plataforma (no solo los de Escenario B) apenas se aplicó el fix
   * de `API_PUBLIC_URL`. Fix: `API_PUBLIC_URL` ya trae el prefijo "/api" puesto, así que acá
   * alcanza con `${publicBaseUrl}/stream/...` (sin agregarlo de nuevo).
   */
  private rewriteManifestOrVtt(content: string, contentType: string, key: string): string {
    const baseKeyDir = key.substring(0, key.lastIndexOf('/'));
    const secret = this.config.get<string>('VIDEO_URL_SIGNING_SECRET', 'dev-secret-change-me');
    const publicBaseUrl = this.config.get<string>('API_PUBLIC_URL', 'http://localhost:3001/api');

    if (contentType === 'application/vnd.apple.mpegurl') {
      return content
        .split('\n')
        .map((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return line;
          const segKey = `${baseKeyDir}/${trimmed}`;
          const segToken = jwt.sign({ key: segKey }, secret, { expiresIn: 60 * 60 * 4 });
          return `${publicBaseUrl}/stream/${encodeURIComponent(segToken)}`;
        })
        .join('\n');
    }

    return content.replace(/^([\w.-]+\.jpg)(#xywh=[\d,]+)$/gm, (_match, fileName, fragment) => {
      const spriteKey = `${baseKeyDir}/${fileName}`;
      const spriteToken = jwt.sign({ key: spriteKey }, secret, { expiresIn: 60 * 60 * 4 });
      return `${publicBaseUrl}/stream/${encodeURIComponent(spriteToken)}${fragment}`;
    });
  }
}
