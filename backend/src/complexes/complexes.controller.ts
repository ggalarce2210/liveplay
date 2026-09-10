import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/roles';
import { ComplexesService } from './complexes.service';
import { Audit } from '../common/interceptors/audit-log.interceptor';

@Controller('complexes')
export class ComplexesController {
  constructor(private service: ComplexesService) {}

  /** Buscador público (§5.1): sin filtros devuelve todo, igual que antes. */
  @Get()
  list(@Query('city') city?: string, @Query('sportType') sportType?: 'FUTBOL5' | 'PADEL') {
    return this.service.list({ city, sportType });
  }

  /** Alimenta el paso "elegí tu ciudad" del buscador — debe ir antes de ":id" para que
   * "cities" no se interprete como un id de complejo. */
  @Get('cities')
  cities(@Query('sportType') sportType?: 'FUTBOL5' | 'PADEL') {
    return this.service.cities(sportType);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(id);
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
