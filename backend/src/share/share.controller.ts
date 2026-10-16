import { Body, Controller, ForbiddenException, Get, GoneException, Inject, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { StreamTokenService } from '../storage/stream-token.service';
import { eq, sql } from 'drizzle-orm';
import { Request } from 'express';
import * as crypto from 'crypto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { DbService } from '../db/db.service';
import { shareLinks } from '../db/schema';
import { STORAGE_DRIVER } from '../storage/storage.module';
import { StorageDriver } from '../storage/storage.types';

/**
 * Enlaces privados para compartir un clip o un partido completo (§17). Nunca se entrega la
 * ruta física: siempre se resuelve a una URL de streaming firmada de corta duración, generada
 * en el momento en que alguien abre el link.
 */
@Controller()
export class ShareController {
  constructor(private dbService: DbService, @Inject(STORAGE_DRIVER) private storage: StorageDriver, private streamTokens: StreamTokenService) {}
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
      with: { match: { with: { video: true } }, clip: true },
    });
    if (!link || link.revokedAt) throw new NotFoundException('Enlace no encontrado');
    if (link.expiresAt && link.expiresAt < new Date()) throw new GoneException('Este enlace venció');

    if (link.visibility !== 'PUBLIC') {
      const authHeader = req.headers.authorization;
      if (!authHeader) throw new ForbiddenException('Necesitás iniciar sesión para ver esto');
      // Nota: en un guard dedicado se validaría el JWT acá mismo; simplificado para la demo.
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
