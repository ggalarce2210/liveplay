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
   * Dispositivos que Imou ya reconoce como vinculados/compartidos a nuestra appId — para que el
   * panel de admin ofrezca "elegí una cámara" en vez de pedir el número de serie a ciegas.
   */
  @Get('imou/devices')
  listImouDevices() {
    return this.service.listImouDevices();
  }

  /**
   * Alta de una cámara cloud Imou (o Dahua ya emparejada con la app Imou Life — ver nota en
   * ImouCloudClient.bindDevice). `code` es la contraseña del dispositivo o el código de 6
   * dígitos de su etiqueta/QR; se puede omitir si el dispositivo no tiene ninguno de los dos.
   */
  @Audit('CAMERA_CREATE', 'Camera')
  @Post('imou')
  linkImouCamera(
    @Body() body: { courtId: string; name: string; deviceId: string; channelId?: string; code?: string },
  ) {
    return this.service.linkImouCamera(body);
  }

  /** URL HLS de streaming en vivo actual de una cámara IMOU_CLOUD — para probar la vinculación. */
  @Get(':id/imou/live-url')
  getImouLiveUrl(@Param('id') id: string) {
    return this.service.getImouLiveUrl(id).then((url) => ({ url }));
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

  /**
   * Genera el código corto de instalación para esta cámara (ver CamerasService.
   * generateEnrollmentCode) — reemplaza tener que copiar el token de agente a mano. El TV box lo
   * canjea contra el endpoint público `POST /agent/enroll` (agent/agent-enroll.controller.ts,
   * sin JWT ni X-Agent-Key, a propósito: el box todavía no tiene ninguna credencial en ese
   * momento). Vence en 10 minutos y es de un solo uso.
   */
  @Audit('CAMERA_ENROLLMENT_CODE_ISSUE', 'Camera')
  @Post(':id/enrollment-code')
  generateEnrollmentCode(@Param('id') id: string) {
    return this.service.generateEnrollmentCode(id);
  }
}
