import { Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
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

  /**
   * Bug real encontrado 2026-11-11 (mismo patrón que el ya corregido en CamerasService.list y
   * ComplexesController el 2026-11-01): esto no acotaba por el complejo del `COMPLEX_ADMIN` que
   * llama — cualquier admin de complejo podía pedir `?complexId=<otro-complejo>` (o ni siquiera
   * mandar el parámetro) y ver las estadísticas de un negocio ajeno. Se pasa `req.user` para que
   * `AdminService.getStats` fuerce el acotado para `COMPLEX_ADMIN`, igual que ya hace
   * `CamerasService.list`.
   */
  @Get('stats')
  stats(@Req() req: any, @Query('complexId') complexId?: string) {
    return this.service.getStats(complexId, req.user);
  }

  /** Uso de storage de TODA la plataforma — no tiene noción de "complejo", es un dato
   * operativo/de facturación de la plataforma entera, así que queda restringido a SUPER_ADMIN
   * (mismo criterio que storage/orphans más abajo) en vez de intentar acotarlo. */
  @UseGuards()
  @Roles(Role.SUPER_ADMIN)
  @Get('storage')
  storage() {
    return this.service.getStorage();
  }

  /**
   * Bug real encontrado 2026-11-11 (reportado en vivo por un COMPLEX_ADMIN que, parado en "Videos
   * por cámara" de SU complejo, veía y podía reproducir los videos de OTRO complejo): mismo
   * patrón que el ya corregido en CamerasService.list — esto devolvía los videos de TODOS los
   * complejos a cualquier COMPLEX_ADMIN, ignorando `managedComplexId`. Ver
   * AdminService.getAllVideos para el acotado.
   */
  @Get('videos')
  videos(@Req() req: any, @Query('complexId') complexId?: string) {
    return this.service.getAllVideos(complexId, req.user);
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

  /**
   * Reconciliador de storage huérfano (2026-10-27, no forma parte del flujo normal): compara el
   * bucket real contra la base y lista carpetas de video sin ningún registro vivo — restos de
   * partidos borrados a mano antes del fix de MatchesService.remove() que ahora también limpia
   * storage. Dry-run: no borra nada. Ver AdminService.listOrphanVideoStorage.
   */
  @UseGuards()
  @Roles(Role.SUPER_ADMIN)
  @Get('storage/orphans')
  listOrphanStorage() {
    return this.service.listOrphanVideoStorage();
  }

  /**
   * Borra de verdad lo que devuelve GET /admin/storage/orphans — irreversible. Ver
   * AdminService.purgeOrphanVideoStorage.
   */
  @UseGuards()
  @Roles(Role.SUPER_ADMIN)
  @Post('storage/orphans/purge')
  purgeOrphanStorage() {
    return this.service.purgeOrphanVideoStorage();
  }
}
