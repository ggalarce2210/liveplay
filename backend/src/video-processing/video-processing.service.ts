import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { eq, gt, lt, and, asc } from 'drizzle-orm';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { DbService } from '../db/db.service';
import { videos, matches, videoSegments, notifications, clips } from '../db/schema';
import { FfmpegService } from './ffmpeg.service';
import { STORAGE_DRIVER } from '../storage/storage.module';
import { StorageDriver } from '../storage/storage.types';
import { VIDEO_PROCESSING_QUEUE, VideoProcessingJobData } from './video-processing.queue';

/**
 * Orquesta el procesamiento de video. Encola trabajos en BullMQ/Redis (§27, §28) para que
 * la ingesta de un partido no bloquee la API. `runProcessMatchVideoNow` ejecuta el mismo
 * pipeline de forma síncrona — se usa en el script de seed/demo cuando no hay un worker
 * separado corriendo, pero en producción SIEMPRE se debe usar la cola.
 */
@Injectable()
export class VideoProcessingService {
  private readonly logger = new Logger(VideoProcessingService.name);

  constructor(
    @InjectQueue(VIDEO_PROCESSING_QUEUE) private queue: Queue<VideoProcessingJobData>,
    private dbService: DbService,
    private ffmpeg: FfmpegService,
    @Inject(STORAGE_DRIVER) private storage: StorageDriver,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async enqueueProcessMatchVideo(videoId: string, sourceFilePath: string) {
    await this.queue.add('process-match-video', { type: 'process-match-video', videoId, sourceFilePath });
  }

  async enqueueGenerateClip(clipId: string) {
    await this.queue.add('generate-clip', { type: 'generate-clip', clipId });
  }

  async runProcessMatchVideoNow(videoId: string, sourceFilePath: string) {
    return this.processMatchVideo({ type: 'process-match-video', videoId, sourceFilePath });
  }

  async runGenerateClipNow(clipId: string) {
    return this.generateClip({ type: 'generate-clip', clipId });
  }

  async processMatchVideo(job: Extract<VideoProcessingJobData, { type: 'process-match-video' }>) {
    const { videoId, sourceFilePath } = job;
    const video = await this.db.query.videos.findFirst({ where: eq(videos.id, videoId) });
    if (!video) throw new Error(`Video ${videoId} no encontrado`);
    await this.db.update(videos).set({ status: 'PROCESSING' }).where(eq(videos.id, videoId));
    await this.db.update(matches).set({ status: 'PROCESSING' }).where(eq(matches.id, video.matchId));

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ecp-video-'));
    try {
      const probeResult = await this.ffmpeg.probe(sourceFilePath);

      const hlsDir = path.join(tmpDir, 'hls');
      const { manifestFile, segments } = await this.ffmpeg.generateHls(sourceFilePath, hlsDir);

      const thumbsDir = path.join(tmpDir, 'thumbs');
      const { spriteFile, vttFile } = await this.ffmpeg.generateThumbnailSprite(sourceFilePath, thumbsDir);

      let sizeBytes = 0;
      for (const seg of segments) {
        const stat = await fs.stat(path.join(hlsDir, seg.fileName));
        sizeBytes += stat.size;
      }
      sizeBytes += (await fs.stat(path.join(thumbsDir, spriteFile))).size;

      // Subir todo a la capa de storage bajo storageBaseKey (§10, §26)
      const base = video.storageBaseKey;
      await this.storage.putObject({ key: `${base}/hls/${manifestFile}`, filePath: path.join(hlsDir, manifestFile), contentType: 'application/vnd.apple.mpegurl' });
      for (const seg of segments) {
        await this.storage.putObject({ key: `${base}/hls/${seg.fileName}`, filePath: path.join(hlsDir, seg.fileName), contentType: 'video/MP2T' });
      }
      await this.storage.putObject({ key: `${base}/thumbs/${spriteFile}`, filePath: path.join(thumbsDir, spriteFile), contentType: 'image/jpeg' });
      await this.storage.putObject({ key: `${base}/thumbs/${vttFile}`, filePath: path.join(thumbsDir, vttFile), contentType: 'text/vtt' });

      await this.db.transaction(async (tx) => {
        await tx.delete(videoSegments).where(eq(videoSegments.videoId, videoId));
        if (segments.length) {
          await tx.insert(videoSegments).values(
            segments.map((seg) => ({
              videoId,
              index: seg.index,
              startOffsetSeconds: seg.startOffsetSeconds,
              endOffsetSeconds: seg.endOffsetSeconds,
              durationSeconds: seg.durationSeconds,
              storageKey: `${base}/hls/${seg.fileName}`,
              status: 'PROCESSED' as const,
            })),
          );
        }
        await tx
          .update(videos)
          .set({
            status: 'READY',
            hlsManifestKey: `${base}/hls/${manifestFile}`,
            thumbnailSpriteKey: `${base}/thumbs/${spriteFile}`,
            thumbnailVttKey: `${base}/thumbs/${vttFile}`,
            durationSeconds: probeResult.durationSeconds,
            width: probeResult.width,
            height: probeResult.height,
            fps: probeResult.fps,
            sizeBytes,
          })
          .where(eq(videos.id, videoId));
        await tx.update(matches).set({ status: 'READY' }).where(eq(matches.id, video.matchId));
      });

      const match = await this.db.query.matches.findFirst({ where: eq(matches.id, video.matchId), with: { players: true } });
      if (match) {
        const userIds = match.players.map((p) => p.userId).filter(Boolean) as string[];
        if (userIds.length) {
          await this.db.insert(notifications).values(
            userIds.map((userId) => ({
              userId,
              type: 'MATCH_READY' as const,
              title: 'Tu partido ya está disponible',
              body: `Tu partido del ${match.date} ya puede reproducirse.`,
              metadata: { matchId: match.id },
            })),
          );
        }
      }

      this.logger.log(`Video ${videoId} procesado: ${segments.length} segmentos, ${probeResult.durationSeconds.toFixed(1)}s`);
    } catch (err) {
      this.logger.error(`Falló el procesamiento del video ${videoId}`, err as Error);
      await this.db.update(videos).set({ status: 'FAILED', errorMessage: String(err) }).where(eq(videos.id, videoId));
      await this.db.update(matches).set({ status: 'FAILED' }).where(eq(matches.id, video.matchId));
      throw err;
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }

  async generateClip(job: Extract<VideoProcessingJobData, { type: 'generate-clip' }>) {
    const { clipId } = job;
    const clip = await this.db.query.clips.findFirst({ where: eq(clips.id, clipId), with: { match: { with: { video: true } } } });
    if (!clip) throw new Error(`Clip ${clipId} no encontrado`);
    if (!clip.match.video?.hlsManifestKey) throw new Error('El partido todavía no tiene video procesado');

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ecp-clip-'));
    try {
      const video = clip.match.video;
      const segments = await this.db.query.videoSegments.findMany({
        where: and(eq(videoSegments.videoId, video.id), gt(videoSegments.endOffsetSeconds, clip.startSeconds), lt(videoSegments.startOffsetSeconds, clip.endSeconds)),
        orderBy: [asc(videoSegments.index)],
      });
      const concatListPath = path.join(tmpDir, 'concat.txt');
      const localPaths: string[] = [];
      for (const seg of segments) {
        const localPath = path.join(tmpDir, path.basename(seg.storageKey));
        const buf = await this.storage.getObjectAsBuffer(seg.storageKey);
        await fs.writeFile(localPath, buf);
        localPaths.push(localPath);
      }
      await fs.writeFile(concatListPath, localPaths.map((p) => `file '${p}'`).join('\n'));

      const joinedPath = path.join(tmpDir, 'joined.mp4');
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      await promisify(execFile)('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', joinedPath]);

      const firstSegStart = segments[0]?.startOffsetSeconds ?? 0;
      const relativeStart = clip.startSeconds - firstSegStart;
      const relativeEnd = clip.endSeconds - firstSegStart;

      const outputPath = path.join(tmpDir, 'clip.mp4');
      await this.ffmpeg.generateClip(joinedPath, relativeStart, relativeEnd, outputPath);

      const key = `clips/${clip.matchId}/${clip.id}.mp4`;
      await this.storage.putObject({ key, filePath: outputPath, contentType: 'video/mp4' });

      await this.db.update(clips).set({ status: 'READY', storageKey: key }).where(eq(clips.id, clipId));
    } catch (err) {
      await this.db.update(clips).set({ status: 'FAILED', errorMessage: String(err) }).where(eq(clips.id, clipId));
      throw err;
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }
}
