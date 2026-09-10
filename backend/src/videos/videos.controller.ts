import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
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
}
