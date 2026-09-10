import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/roles';
import { CamerasService } from './cameras.service';
import { Audit } from '../common/interceptors/audit-log.interceptor';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.COMPLEX_ADMIN)
@Controller('cameras')
export class CamerasController {
  constructor(private service: CamerasService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Audit('CAMERA_CREATE', 'Camera')
  @Post()
  create(@Body() body: any) {
    return this.service.create(body);
  }

  @Audit('CAMERA_UPDATE', 'Camera')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.service.update(id, body);
  }

  @Audit('CAMERA_DELETE', 'Camera')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Post(':id/heartbeat')
  heartbeat(@Param('id') id: string, @Body() body: { status: 'ONLINE' | 'OFFLINE' }) {
    return this.service.markHeartbeat(id, body.status);
  }

  /**
   * Genera (o rota) el token de agente de esta cámara — ver CamerasService.issueAgentToken.
   * El valor de `token` en la respuesta es la única vez que viaja en texto plano: hay que
   * copiarlo directo a la config del agente local (backend/AGENTE.md), no queda guardado acá.
   */
  @Audit('CAMERA_AGENT_TOKEN_ISSUE', 'Camera')
  @Post(':id/agent-token')
  issueAgentToken(@Param('id') id: string) {
    return this.service.issueAgentToken(id);
  }
}
