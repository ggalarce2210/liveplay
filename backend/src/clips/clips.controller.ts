import { Body, ConflictException, Controller, Delete, ForbiddenException, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { asc, desc, eq } from 'drizzle-orm';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Audit } from '../common/interceptors/audit-log.interceptor';
import { DbService } from '../db/db.service';
import { clips } from '../db/schema';
import { VideoProcessingService } from '../video-processing/video-processing.service';
import { STORAGE_DRIVER } from '../storage/storage.module';
import { StorageDriver } from '../storage/storage.types';

/** Máximo de clips/momentos que un usuario puede tener guardados a la vez (pedido explícito del
 *  usuario 2026-10-05, para no dejar crecer el storage sin límite por usuario). Al llegar al
 *  tope, `create()` rechaza el alta y devuelve los 3 clips más viejos del usuario para que el
 *  frontend le ofrezca tildarlos y borrarlos ahí mismo, sin tener que ir a "Mis momentos" aparte. */
const MAX_CLIPS_PER_USER = 10;

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
    const existing = await this.db.query.clips.findMany({
      where: eq(clips.createdByUserId, user.userId),
      columns: { id: true, title: true, status: true, createdAt: true },
      orderBy: [asc(clips.createdAt)],
    });
    if (existing.length >= MAX_CLIPS_PER_USER) {
      // 409, no 403: no es un tema de permisos, es un tope que el propio usuario puede resolver
      // ahí mismo borrando alguno de los 3 más viejos que le mandamos en el body del error.
      throw new ConflictException({
        code: 'CLIP_LIMIT_REACHED',
        message: `Llegaste al máximo de ${MAX_CLIPS_PER_USER} momentos guardados. Borrá alguno para poder guardar uno nuevo.`,
        oldestClips: existing.slice(0, 3),
      });
    }
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
