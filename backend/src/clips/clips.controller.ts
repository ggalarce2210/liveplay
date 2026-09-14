import { Body, Controller, Delete, ForbiddenException, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Audit } from '../common/interceptors/audit-log.interceptor';
import { DbService } from '../db/db.service';
import { clips } from '../db/schema';
import { VideoProcessingService } from '../video-processing/video-processing.service';
import { STORAGE_DRIVER } from '../storage/storage.module';
import { StorageDriver } from '../storage/storage.types';

/** "Mis mejores momentos" (§16): recortes independientes generados sin tocar el video original. */
@UseGuards(JwtAuthGuard)
@Controller('clips')
export class ClipsController {
  constructor(
    private dbService: DbService,
    private videoProcessing: VideoProcessingService,
    @Inject(STORAGE_DRIVER) private storage: StorageDriver,
  ) {}
  private get db() {
    return this.dbService.db;
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.db.query.clips.findMany({
      where: eq(clips.createdByUserId, user.userId),
      orderBy: [desc(clips.createdAt)],
      with: { match: { with: { court: true, complex: true } } },
    });
  }

  @Audit('CLIP_CREATE', 'Clip')
  @Post()
  async create(@Body() body: { matchId: string; title: string; startSeconds: number; endSeconds: number }, @CurrentUser() user: AuthUser) {
    const [clip] = await this.db
      .insert(clips)
      .values({ matchId: body.matchId, createdByUserId: user.userId, title: body.title, startSeconds: body.startSeconds, endSeconds: body.endSeconds, status: 'PENDING' })
      .returning();
    await this.videoProcessing.enqueueGenerateClip(clip.id);
    return clip;
  }

  @Get(':id/playback')
  async getPlaybackUrl(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const clip = await this.db.query.clips.findFirst({ where: eq(clips.id, id) });
    if (!clip) throw new ForbiddenException();
    if (clip.createdByUserId !== user.userId) throw new ForbiddenException();
    if (clip.status !== 'READY' || !clip.storageKey) return { status: clip.status, url: null };
    const url = await this.storage.getSignedReadUrl(clip.storageKey, 60 * 30);
    return { status: clip.status, url };
  }

  /**
   * Reintenta un clip que quedo en FAILED (o que se perdio por un crash del worker antes del
   * fix de video-processing.processor.ts) sin que el usuario tenga que recrearlo desde cero.
   */
  @Audit('CLIP_CREATE', 'Clip')
  @Post(':id/retry')
  async retry(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const clip = await this.db.query.clips.findFirst({ where: eq(clips.id, id) });
    if (!clip) throw new ForbiddenException();
    if (clip.createdByUserId !== user.userId) throw new ForbiddenException();
    const [updated] = await this.db
      .update(clips)
      .set({ status: 'PENDING', errorMessage: null, updatedAt: new Date() })
      .where(eq(clips.id, id))
      .returning();
    await this.videoProcessing.enqueueGenerateClip(id);
    return updated;
  }

  @Audit('CLIP_DELETE', 'Clip')
  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const clip = await this.db.query.clips.findFirst({ where: eq(clips.id, id) });
    if (!clip) throw new ForbiddenException();
    if (clip.createdByUserId !== user.userId) throw new ForbiddenException();
    if (clip.storageKey) await this.storage.deleteObject(clip.storageKey);
    const [deleted] = await this.db.delete(clips).where(eq(clips.id, id)).returning();
    return deleted;
  }
}
