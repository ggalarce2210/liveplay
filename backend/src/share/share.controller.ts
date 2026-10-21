import { Body, Controller, ForbiddenException, Get, GoneException, HttpException, HttpStatus, Inject, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { StreamTokenService } from '../storage/stream-token.service';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { eq, sql } from 'drizzle-orm';
import { Request } from 'express';
import * as crypto from 'crypto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { DbService } from '../db/db.service';
import { shareLinks } from '../db/schema';
import { STORAGE_DRIVER } from '../storage/storage.module';
import { StorageDriver } from '../storage/storage.types';
import { Role } from '../common/roles';
import { VideoAccessService } from '../payments/video-access.service';

/**
 * Enlaces privados para compartir un clip o un partido completo (§17). Nunca se entrega la
 * ruta física: siempre se resuelve a una URL de streaming firmada de corta duración, generada
 * en el momento en que alguien abre el link.
 */
@Controller()
export class ShareController {
  constructor(
    private dbService: DbService,
    @Inject(STORAGE_DRIVER) private storage: StorageDriver,
    private streamTokens: StreamTokenService,
    private jwt: JwtService,
    private config: ConfigService,
    private videoAccess: VideoAccessService,
  ) {}
  private get db() {
    return this.dbService.db;
  }

  @UseGuards(JwtAuthGuard)
  @Post('share-links')
  async create(
    @Body() body: { matchId?: string; clipId?: string; visibility: 'PUBLIC' | 'PRIVATE' | 'REGISTERED_ONLY'; expiresInHours?: number },
    @CurrentUser() user: AuthUser,
  ) {
    const token = crypto.randomBytes(16).toString('hex');
    const expiresAt = body.expiresInHours ? new Date(Date.now() + body.expiresInHours * 60 * 60 * 1000) : null;
    const [link] = await this.db
      .insert(shareLinks)
      .values({ token, matchId: body.matchId, clipId: body.clipId, visibility: body.visibility, expiresAt, createdByUserId: user.userId })
      .returning();
    return { ...link, url: `/share/${token}` };
  }

  @Get('share/:token')
  async resolve(@Param('token') token: string, @Req() req: Request) {
    const link = await this.db.query.shareLinks.findFirst({
      where: eq(shareLinks.token, token),
      with: {
        match: { with: { video: true, complex: true } },
        clip: { with: { match: { with: { complex: true } } } },
      },
    });
    if (!link || link.revokedAt) throw new NotFoundException('Enlace no encontrado');
    if (link.expiresAt && link.expiresAt < new Date()) throw new GoneException('Este enlace venció');

    // Antes esto solo chequeaba que *hubiera* un header Authorization, sin validar nada — ahora
    // lo decodificamos de verdad (mismo secret que JwtStrategy) tanto para confirmar la sesión en
    // links no públicos como para saber quién pide el contenido y poder chequear el paywall más
    // abajo. Un token ausente o inválido se trata como anónimo.
    let requester: { userId: string; role: string } | null = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const payload = this.jwt.verify<{ sub: string; role: string }>(authHeader.slice('Bearer '.length), {
          secret: this.config.get<string>('JWT_ACCESS_SECRET', 'dev-access-secret-change-me'),
        });
        requester = { userId: payload.sub, role: payload.role };
      } catch {
        requester = null;
      }
    }

    if (link.visibility !== 'PUBLIC' && !requester) {
      throw new ForbiddenException('Necesitás iniciar sesión para ver esto');
    }

    // Pago por ver videos (§25), extendido a los links para compartir (2026-10-21): sin esto,
    // compartir un clip o un partido (incluso como link "PUBLIC", visible para cualquiera sin
    // cuenta) era una forma de esquivar por completo el paywall de VideosService/ClipsController.
    // Mismo criterio: SUPER_ADMIN/COMPLEX_ADMIN pasan siempre, un PLAYER necesita pase vigente, y
    // un visitante anónimo nunca tiene pase, así que queda bloqueado igual que un PLAYER sin pase.
    const complex = link.match?.complex ?? link.clip?.match?.complex;
    if (complex?.chargesForVideoAccess) {
      const isAdmin = requester?.role === Role.SUPER_ADMIN || requester?.role === Role.COMPLEX_ADMIN;
      const hasAccess = isAdmin || (requester ? await this.videoAccess.hasActivePass(complex.id, requester.userId) : false);
      if (!hasAccess) {
        throw new HttpException(
          {
            code: 'PAYMENT_REQUIRED',
            message: 'Necesitás un pase vigente para este complejo para ver este contenido.',
            complexId: complex.id,
            priceArs: complex.videoAccessPriceArs,
            passDays: complex.videoAccessPassDays,
          },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
    }

    await this.db.update(shareLinks).set({ viewCount: sql`${shareLinks.viewCount} + 1` }).where(eq(shareLinks.id, link.id));

    if (link.clip?.storageKey) {
      const url = await this.storage.getSignedReadUrl(link.clip.storageKey, 60 * 30);
      return { type: 'clip', title: link.clip.title, url };
    }
    if (link.match?.video?.hlsManifestKey) {
      const url = await this.streamTokens.sign(link.match.video.hlsManifestKey, 60 * 30);
      return { type: 'match', manifestUrl: url };
    }
    throw new NotFoundException('El contenido todavía no está disponible');
  }
}
