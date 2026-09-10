import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/roles';
import { CourtsService } from './courts.service';
import { Audit } from '../common/interceptors/audit-log.interceptor';

@Controller('courts')
export class CourtsController {
  constructor(private service: CourtsService) {}

  @Get()
  list(@Query('complexId') complexId: string) {
    return this.service.listByComplex(complexId);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPLEX_ADMIN)
  @Audit('COURT_CREATE', 'Court')
  @Post()
  create(@Body() body: any) {
    return this.service.create(body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPLEX_ADMIN)
  @Audit('COURT_UPDATE', 'Court')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.service.update(id, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPLEX_ADMIN)
  @Audit('COURT_DELETE', 'Court')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
