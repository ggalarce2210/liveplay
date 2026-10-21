import { Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpException, HttpStatus, Inject, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { asc, desc, eq } from 'drizzle-orm';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Audit } from '../common/interceptors/audit-log.interceptor';
import { DbService } from '../db/db.service';
import { clips, matches } from '../db/schema';
import { VideoProcessingService } from '../video-processing/video-processing.service';
import { STORAGE_DRIVER } from '../storage/storage.module';
import { StorageDriver } from '../storage/storage.types';
import { Role } from '../common/roles';
import { VideoAccessService } from '../payments/video-access.service';

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
    private videoAccess: VideoAccessService,
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
    const match = await this.db.query.matches.findFirst({
      where: eq(matches.id, body.matchId),
      with: { complex: true },
    });
    if (!match) throw new NotFoundException('Partido no encontrado');
    // Antes esto no chequeaba nada de pago: un PLAYER sin pase vigente podía generar un clip de
    // un partido de un complejo que cobra y esquivar así el paywall de VideosService (§25) por
    // completo. Mismo criterio que VideosService.checkPaywall() (ver comentario ahí).
    await this.assertVideoAccess(match.complex, user);

    const [clip] = await this.db
      .insert(clips)
      .values({ matchId: body.matchId, createdByUserId: user.userId, title: body.title, startSeconds: body.startSeconds, endSeconds: body.endSeconds, status: 'PENDING' })
      .returning();
    await this.videoProcessing.enqueueGenerateClip(clip.id);
    return clip;
  }

  @Get(':id/playback')
  async getPlaybackUrl(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const clip = await this.db.query.clips.findFirst({
      where: eq(clips.id, id),
      with: { match: { with: { complex: true } } },
    });
    if (!clip) throw new ForbiddenException();
    if (clip.createdByUserId !== user.userId) throw new ForbiddenException();
    // Mismo chequeo que en `create()`: si el pase del usuario venció después de generar el clip
    // (o el clip es viejo, de antes de este fix), tampoco se entrega la URL de descarga.
    if (clip.match?.complex) await this.assertVideoAccess(clip.match.complex, user);
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
    const clip = await this.db.query.clips.findFirst({
      where: eq(clips.id, id),
      with: { match: { with: { complex: true } } },
    });
    if (!clip) throw new ForbiddenException();
    if (clip.createdByUserId !== user.userId) throw new ForbiddenException();
    if (clip.match?.complex) await this.assertVideoAccess(clip.match.complex, user);
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

  /**
   * Pago por ver videos (§25 / 2026-10-16), extendido a clips (2026-10-21): si el complejo del
   * partido cobra por ver sus videos, SUPER_ADMIN/COMPLEX_ADMIN siguen sin pagar; solo a un
   * PLAYER se le exige un pase vigente para poder generar o descargar un clip de ese partido.
   * Sin esto, "Mis mejores momentos" era una forma de ver (y llevarse) contenido pago sin pasar
   * nunca por el paywall de la pantalla de video.
   */
  private async assertVideoAccess(
    complex: { id: string; chargesForVideoAccess: boolean; videoAccessPriceArs: number | null; videoAccessPassDays: number | null } | null | undefined,
    user: AuthUser,
  ) {
    if (!complex?.chargesForVideoAccess) return;
    if (user.role !== Role.PLAYER) return;
    const hasAccess = await this.videoAccess.hasActivePass(complex.id, user.userId);
    if (hasAccess) return;
    throw new HttpException(
      {
        code: 'PAYMENT_REQUIRED',
        message: 'Necesitás un pase vigente para este complejo para generar o descargar clips.',
        complexId: complex.id,
        priceArs: complex.videoAccessPriceArs,
        passDays: complex.videoAccessPassDays,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
