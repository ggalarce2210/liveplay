import { Controller, Delete, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/roles';
import { Audit } from '../common/interceptors/audit-log.interceptor';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { VideosService } from './videos.service';

@UseGuards(JwtAuthGuard)
@Controller('videos')
export class VideosController {
  constructor(private service: VideosService) {}

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.get(id, user);
  }

  @Get(':id/segments')
  getSegments(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.getSegments(id, user);
  }

  @Get(':id/playback')
  getPlaybackUrls(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.getPlaybackUrls(id, user);
  }

  /** Borra el video (archivos en storage + fila en DB). El partido en sí queda, solo sin video. */
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPLEX_ADMIN)
  @Audit('VIDEO_DELETE', 'Video')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
