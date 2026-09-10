import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { asc, eq } from 'drizzle-orm';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/roles';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { MatchesService } from './matches.service';
import { SearchMatchesDto } from './dto/search-matches.dto';
import { Audit } from '../common/interceptors/audit-log.interceptor';
import { DbService } from '../db/db.service';
import { events } from '../db/schema';

@UseGuards(JwtAuthGuard)
@Controller('matches')
export class MatchesController {
  constructor(private service: MatchesService, private dbService: DbService) {}
  private get db() {
    return this.dbService.db;
  }

  @Get()
  search(@Query() query: SearchMatchesDto, @CurrentUser() user: AuthUser) {
    return this.service.search(query, user);
  }

  @Get(':id')
  @Audit('MATCH_VIEW', 'Match')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.get(id, user);
  }

  @Get(':id/events')
  async getEvents(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.service.get(id, user); // valida acceso
    return this.db.query.events.findMany({ where: eq(events.matchId, id), orderBy: [asc(events.timestampSeconds)] });
  }

  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPLEX_ADMIN)
  @Audit('MATCH_CREATE', 'Match')
  @Post()
  create(@Body() body: any) {
    return this.service.create(body);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPLEX_ADMIN)
  @Audit('MATCH_UPDATE', 'Match')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.service.update(id, body);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPLEX_ADMIN)
  @Audit('MATCH_DELETE', 'Match')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPLEX_ADMIN)
  @Post(':id/players')
  addPlayers(@Param('id') id: string, @Body() body: { players: any[] }) {
    return this.service.addPlayers(id, body.players);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPLEX_ADMIN)
  @Post(':id/events')
  async addEvent(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthUser) {
    const [created] = await this.db.insert(events).values({ matchId: id, createdByUserId: user.userId, ...body }).returning();
    return created;
  }

  /**
   * Ingesta manual de un video ya grabado (ej. exportado de un NVR) para asociarlo a un
   * partido. En producción esto normalmente lo dispara un watcher sobre la carpeta de
   * grabaciones del NVR/DVR en vez de una subida manual — ver ARCHITECTURE.md §9/§10.
   */
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPLEX_ADMIN)
  @Audit('VIDEO_UPLOAD', 'Match')
  @Post(':id/video')
  @UseInterceptors(FileInterceptor('file', { dest: '/tmp/ecp-uploads' }))
  attachVideo(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    return this.service.attachVideo(id, file.path);
  }
}
