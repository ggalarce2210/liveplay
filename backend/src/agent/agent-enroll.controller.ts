import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { CamerasService } from '../cameras/cameras.service';

/**
 * Canje del código de enrolamiento (ver `CamerasService.generateEnrollmentCode`/
 * `redeemEnrollmentCode` y `local-agent/enroll.sh`) — a propósito es un controller SEPARADO de
 * `AgentController` (que vive en este mismo módulo) porque ese tiene `@UseGuards(AgentAuthGuard)`
 * a nivel de clase, y acá el TV box todavía no tiene ningún token: el código de un solo uso ES
 * la credencial para esta única llamada. No lleva `@UseGuards` de ningún tipo — la protección es
 * el propio código (corto, vence en 10 minutos, un solo uso, ver CamerasService).
 */
@Controller('agent')
export class AgentEnrollController {
  constructor(private camerasService: CamerasService) {}

  @Post('enroll')
  redeem(@Body() body: { code?: string }) {
    if (!body?.code) throw new BadRequestException('Falta el código');
    const apiPublicUrl = process.env.API_PUBLIC_URL ?? 'http://localhost:3001';
    return this.camerasService.redeemEnrollmentCode(body.code, apiPublicUrl);
  }
}
