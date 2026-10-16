import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/roles';
import { AdminService } from './admin.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.COMPLEX_ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private service: AdminService) {}

  @Get('stats')
  stats(@Query('complexId') complexId?: string) {
    return this.service.getStats(complexId);
  }

  @Get('storage')
  storage() {
    return this.service.getStorage();
  }

  /** Listado completo de videos agrupables por complejo/cancha/cámara — ver AdminService.getAllVideos. */
  @Get('videos')
  videos(@Query('complexId') complexId?: string) {
    return this.service.getAllVideos(complexId);
  }

  @UseGuards()
  @Roles(Role.SUPER_ADMIN)
  @Get('audit-logs')
  auditLogs() {
    return this.service.getAuditLogs();
  }

  /**
   * Backfill puntual (2026-09-24, no forma parte del flujo normal): genera la portada de los
   * videos que ya estaban `READY` antes de que existiera esta función y quedaron con
   * `posterKey` null para siempre. Se llama una vez a mano desde el panel/consola, no hay UI
   * dedicada — ver `VideoProcessingService.backfillPosters`.
   */
  @UseGuards()
  @Roles(Role.SUPER_ADMIN)
  @Post('videos/backfill-posters')
  backfillVideoPosters() {
    return this.service.backfillVideoPosters();
  }
}
