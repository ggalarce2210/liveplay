import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/roles';
import { ComplexesService } from './complexes.service';
import { Audit } from '../common/interceptors/audit-log.interceptor';

@Controller('complexes')
export class ComplexesController {
  constructor(
    private service: ComplexesService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  /**
   * Buscador público (§5.1): sin JWT (jugador anónimo) sigue devolviendo todo, igual que
   * siempre. Pero el panel de admin reutiliza esta misma ruta para poblar su combo de
   * complejos — bug real encontrado 2026-11-01: un COMPLEX_ADMIN veía y podía entrar a
   * complejos de otros dueños. Si quien llama manda el JWT de un COMPLEX_ADMIN, acotamos la
   * respuesta a solo su complejo; un SUPER_ADMIN (o nadie logueado) sigue viendo todo.
   */
  @Get()
  list(@Req() req: any, @Query('city') city?: string, @Query('sportType') sportType?: 'FUTBOL5' | 'PADEL') {
    const onlyComplexId = this.getScopedComplexId(req) ?? undefined;
    return this.service.list({ city, sportType, onlyComplexId });
  }

  /** Alimenta el paso "elegí tu ciudad" del buscador — debe ir antes de ":id" para que
   * "cities" no se interprete como un id de complejo. */
  @Get('cities')
  cities(@Query('sportType') sportType?: 'FUTBOL5' | 'PADEL') {
    return this.service.cities(sportType);
  }

  /** Mismo acotado que en `list()`: un COMPLEX_ADMIN no puede pedir el detalle de un complejo
   * que no es el suyo (antes sí podía, viendo canchas/cámaras ajenas). */
  @Get(':id')
  get(@Req() req: any, @Param('id') id: string) {
    const onlyComplexId = this.getScopedComplexId(req);
    if (onlyComplexId && onlyComplexId !== id) {
      throw new ForbiddenException('No tenés permisos para ver este complejo');
    }
    return this.service.get(id);
  }

  /**
   * Decodifica el JWT a mano (sin `@UseGuards`, para no romper el acceso público al buscador)
   * y, si es un `COMPLEX_ADMIN`, devuelve el id del complejo al que hay que acotar la
   * respuesta. Token ausente, inválido, vencido, o de un `SUPER_ADMIN`/jugador: se ignora y la
   * ruta sigue pública/sin acotar, igual que antes de este fix.
   */
  private getScopedComplexId(req: any): string | null {
    const header = req?.headers?.authorization as string | undefined;
    if (!header?.startsWith('Bearer ')) return null;
    try {
      const payload: any = this.jwt.verify(header.slice('Bearer '.length), {
        secret: this.config.get('JWT_ACCESS_SECRET', 'dev-access-secret-change-me'),
      });
      return payload?.role === Role.COMPLEX_ADMIN ? payload.managedComplexId ?? null : null;
    } catch {
      return null;
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @Audit('COMPLEX_CREATE', 'Complex')
  @Post()
  create(@Body() body: any) {
    return this.service.create(body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPLEX_ADMIN)
  @Audit('COMPLEX_UPDATE', 'Complex')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.service.update(id, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @Audit('COMPLEX_DELETE', 'Complex')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
