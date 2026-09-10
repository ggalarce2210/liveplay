import { Body, Controller, Delete, ForbiddenException, Get, Param, Post, UseGuards } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { DbService } from '../db/db.service';
import { bookmarks } from '../db/schema';

/**
 * Marcadores/favoritos privados dentro de un partido — el corazón del sistema "Timeslice" (§7).
 * Cada jugador solo ve y gestiona sus propios marcadores.
 */
@UseGuards(JwtAuthGuard)
@Controller()
export class BookmarksController {
  constructor(private dbService: DbService) {}
  private get db() {
    return this.dbService.db;
  }

  @Get('matches/:matchId/bookmarks')
  list(@Param('matchId') matchId: string, @CurrentUser() user: AuthUser) {
    return this.db.query.bookmarks.findMany({
      where: and(eq(bookmarks.matchId, matchId), eq(bookmarks.userId, user.userId)),
      orderBy: [asc(bookmarks.timestampSeconds)],
    });
  }

  @Post('matches/:matchId/bookmarks')
  async create(@Param('matchId') matchId: string, @Body() body: { timestampSeconds: number; label: string }, @CurrentUser() user: AuthUser) {
    const [created] = await this.db.insert(bookmarks).values({ matchId, userId: user.userId, ...body }).returning();
    return created;
  }

  @Delete('bookmarks/:id')
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const bookmark = await this.db.query.bookmarks.findFirst({ where: eq(bookmarks.id, id) });
    if (!bookmark) throw new ForbiddenException();
    if (bookmark.userId !== user.userId) throw new ForbiddenException();
    const [deleted] = await this.db.delete(bookmarks).where(eq(bookmarks.id, id)).returning();
    return deleted;
  }
}
