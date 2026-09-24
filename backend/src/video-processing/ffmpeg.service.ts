import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execFileAsync = promisify(execFile);

export interface ProbeResult {
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
}

export interface HlsSegmentInfo {
  index: number;
  startOffsetSeconds: number;
  endOffsetSeconds: number;
  durationSeconds: number;
  fileName: string;
}

const SEGMENT_TARGET_SECONDS = 6; // requisito §11: segmentos cortos, no un archivo único

/**
 * Envoltorio sobre FFmpeg/FFprobe (§28). Toda la lógica de "video real" del proyecto pasa
 * por acá: metadata, segmentación HLS, sprite de miniaturas + WebVTT, y generación de clips.
 * No usamos una librería intermedia (fluent-ffmpeg) para mantener control total y explícito
 * sobre cada comando — más fácil de auditar y de adaptar a hardware de transcodificación.
 */
@Injectable()
export class FfmpegService {
  private readonly logger = new Logger(FfmpegService.name);

  async probe(inputPath: string): Promise<ProbeResult> {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,r_frame_rate',
      '-show_entries', 'format=duration',
      '-of', 'json',
      inputPath,
    ]);
    const data = JSON.parse(stdout);
    const stream = data.streams?.[0] ?? {};
    const [num, den] = String(stream.r_frame_rate ?? '25/1').split('/').map(Number);
    return {
      durationSeconds: parseFloat(data.format?.duration ?? '0'),
      width: stream.width ?? 0,
      height: stream.height ?? 0,
      fps: den ? num / den : num,
    };
  }

  /**
   * Genera un HLS VOD real: manifest .m3u8 + segmentos .ts de ~6s.
   * Video: `-c:v copy` evita re-codificar (rápido, sin costo de CPU) cuando el input ya es
   * H.264, que es el caso normal de cámaras IP/NVR — para codecs de video variados, en el
   * futuro se podría forzar `-c:v libx264`.
   *
   * Audio: se fuerza `-c:a aac` en vez de copiarlo tal cual (2026-09-19, pregunta del
   * cliente sobre si el audio de la cámara se va a escuchar). Muchas cámaras IP económicas
   * (frecuente en Dahua/genéricas chinas) mandan el audio en G.711 (PCM A-law/u-law) en vez
   * de AAC — un `-c copy` a secas dejaría ese audio "adentro" del archivo pero MUDO en
   * cualquier reproductor web, porque HLS vía Media Source Extensions (lo que usa hls.js en
   * el navegador) solo decodifica audio AAC (o MP3), no G.711. Re-codificar solo el audio es
   * una operación liviana (nada que ver con re-codificar video, que sí es costoso) y deja el
   * pipeline a prueba de cualquier códec de audio que mande la cámara. Si el input no tiene
   * pista de audio, este flag simplemente no tiene nada que hacer y no rompe nada.
   */
  async generateHls(inputPath: string, outputDir: string): Promise<{ manifestFile: string; segments: HlsSegmentInfo[] }> {
    await fs.mkdir(outputDir, { recursive: true });
    const manifestFile = 'master.m3u8';
    const segmentPattern = 'segment_%05d.ts';

    await execFileAsync('ffmpeg', [
      '-y',
      '-i', inputPath,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-start_number', '0',
      '-hls_time', String(SEGMENT_TARGET_SECONDS),
      '-hls_playlist_type', 'vod',
      '-hls_flags', 'independent_segments',
      '-hls_segment_filename', path.join(outputDir, segmentPattern),
      path.join(outputDir, manifestFile),
    ]);

    const segments = await this.parseSegmentsFromManifest(path.join(outputDir, manifestFile));
    return { manifestFile, segments };
  }

  /** Lee el .m3u8 generado y reconstruye offsets acumulados por segmento (para la tabla VideoSegment). */
  private async parseSegmentsFromManifest(manifestPath: string): Promise<HlsSegmentInfo[]> {
    const content = await fs.readFile(manifestPath, 'utf-8');
    const lines = content.split('\n');
    const segments: HlsSegmentInfo[] = [];
    let cursor = 0;
    let index = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('#EXTINF:')) {
        const duration = parseFloat(line.replace('#EXTINF:', '').replace(',', ''));
        const fileName = lines[i + 1]?.trim();
        if (fileName && !fileName.startsWith('#')) {
          segments.push({
            index,
            startOffsetSeconds: cursor,
            endOffsetSeconds: cursor + duration,
            durationSeconds: duration,
            fileName,
          });
          cursor += duration;
          index++;
        }
      }
    }
    return segments;
  }

  /**
   * Genera un sprite de miniaturas (grilla de JPEGs) + un WebVTT que mapea tiempo -> recorte
   * del sprite. Esto es lo que permite la previsualización al arrastrar el scrubber (§12).
   */
  async generateThumbnailSprite(
    inputPath: string,
    outputDir: string,
    opts: { intervalSeconds?: number; columns?: number; rows?: number; tileWidth?: number } = {},
  ): Promise<{ spriteFile: string; vttFile: string }> {
    const interval = opts.intervalSeconds ?? 5;
    const columns = opts.columns ?? 10;
    const rows = opts.rows ?? 10;
    const tileWidth = opts.tileWidth ?? 160;

    await fs.mkdir(outputDir, { recursive: true });
    const spriteFile = 'sprite.jpg';
    const vttFile = 'thumbnails.vtt';
    const tileHeight = Math.round((tileWidth * 9) / 16);

    await execFileAsync('ffmpeg', [
      '-y',
      '-i', inputPath,
      '-vf', `fps=1/${interval},scale=${tileWidth}:-1,tile=${columns}x${rows}`,
      '-q:v', '4',
      path.join(outputDir, spriteFile),
    ]);

    const probeResult = await this.probe(inputPath);
    const totalTiles = Math.min(columns * rows, Math.ceil(probeResult.durationSeconds / interval));
    const vttLines = ['WEBVTT', ''];
    for (let i = 0; i < totalTiles; i++) {
      const start = i * interval;
      const end = Math.min(start + interval, probeResult.durationSeconds);
      const col = i % columns;
      const row = Math.floor(i / columns);
      vttLines.push(
        `${this.toVttTime(start)} --> ${this.toVttTime(end)}`,
        `${spriteFile}#xywh=${col * tileWidth},${row * tileHeight},${tileWidth},${tileHeight}`,
        '',
      );
    }
    await fs.writeFile(path.join(outputDir, vttFile), vttLines.join('\n'));
    return { spriteFile, vttFile };
  }

  /**
   * Extrae un único frame como JPEG para usar de "poster" (miniatura de portada) en las
   * tarjetas de partido — hasta ahora esas tarjetas mostraban un ícono genérico fijo (🎾/⚽)
   * en vez de una imagen real del video (pedido del cliente, 2026-09-24).
   *
   * `atSeconds` por default apunta a los 3s: lo suficientemente adentro del video como para
   * evitar frames negros/de transición del arranque de la grabación, pero sin acercarse a
   * requerir conocer la duración total de antemano (evita un `probe()` extra solo para esto).
   * Si el video dura menos que eso, FFmpeg simplemente devuelve el último frame disponible en
   * vez de fallar.
   */
  async generatePoster(inputPath: string, outputPath: string, atSeconds = 3): Promise<void> {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await execFileAsync('ffmpeg', [
      '-y',
      '-ss', String(atSeconds),
      '-i', inputPath,
      '-frames:v', '1',
      '-q:v', '3',
      outputPath,
    ]);
  }

  private toVttTime(totalSeconds: number): string {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
  }

  /**
   * Genera un clip independiente (mp4) a partir de un rango [startSeconds, endSeconds] del
   * video original, sin modificarlo (§16). Re-codifica (no `-c copy`) para garantizar un
   * corte preciso al frame solicitado en vez de saltar al keyframe más cercano.
   *
   * `-threads 1`: en la instancia chica de Render donde corre esto, dejar que libx264 use todos
   * los cores disponibles (default) generó picos de CPU/memoria que llegaron a tirar abajo todo
   * el proceso (ver nota en VideoProcessingProcessor) - un clip tarda un poco más así, pero no
   * pone en riesgo al resto de la API mientras se genera.
   */
  async generateClip(inputPath: string, startSeconds: number, endSeconds: number, outputPath: string): Promise<void> {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const duration = Math.max(0.1, endSeconds - startSeconds);
    await execFileAsync('ffmpeg', [
      '-y',
      '-ss', String(startSeconds),
      '-i', inputPath,
      '-t', String(duration),
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-preset', 'veryfast',
      '-threads', '1',
      outputPath,
    ]);
  }
}
