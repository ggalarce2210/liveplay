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
   * Dispositivos que Imou ya reconoce como vinculados/compartidos a nuestra appId - para que el
   * panel de admin ofrezca "elegi una camara" en vez de pedir el numero de serie a ciegas.
   */
  @Get('imou/devices')
  listImouDevices() {
    return this.service.listImouDevices();
  }

  /**
   * Alta de una camara cloud Imou (o Dahua ya emparejada con la app Imou Life - ver nota en
   * ImouCloudClient.bindDevice). `code` es la contrasena del dispositivo o el codigo de 6
   * digitos de su etiqueta/QR; se puede omitir si el dispositivo no tiene ninguno de los dos.
   */
  @Audit('CAMERA_CREATE', 'Camera')
  @Post('imou')
  linkImouCamera(
    @Body() body: { courtId: string; name: string; deviceId: string; channelId?: string; code?: string },
  ) {
    return this.service.linkImouCamera(body);
  }

  /** URL HLS de streaming en vivo actual de una camara IMOU_CLOUD - para probar la vinculacion. */
  @Get(':id/imou/live-url')
  getImouLiveUrl(@Param('id') id: string) {
    return this.service.getImouLiveUrl(id).then((url) => ({ url }));
  }

  /**
   * Genera (o rota) el token de agente de esta camara - ver CamerasService.issueAgentToken.
   * El valor de `token` en la respuesta es la unica vez que viaja en texto plano: hay que
   * copiarlo directo a la config del agente local (backend/AGENTE.md), no queda guardado aca.
   */
  @Audit('CAMERA_AGENT_TOKEN_ISSUE', 'Camera')
  @Post(':id/agent-token')
  issueAgentToken(@Param('id') id: string) {
    return this.service.issueAgentToken(id);
  }
      }
