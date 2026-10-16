import { Body, Controller, Delete, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/roles';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Audit } from '../common/interceptors/audit-log.interceptor';
import { MercadopagoService } from './mercadopago.service';

/**
 * Rutas de Mercado Pago (modelo marketplace — ver el comentario grande en
 * MercadopagoService). `@Controller()` sin prefijo a propósito, mismo criterio que
 * ShareController: estas rutas no cuelgan todas de un único recurso REST, van mezcladas bajo
 * /complexes/:id/mercadopago/* (gestión, dueño del complejo) y /payments/mercadopago/* (OAuth
 * callback y webhook, ambas públicas — las llama Mercado Pago, no nuestro frontend).
 */
@Controller()
export class MercadopagoController {
  constructor(private service: MercadopagoService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPLEX_ADMIN)
  @Get('complexes/:id/mercadopago/connect-url')
  async getConnectUrl(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.service.assertCanManageComplex(user, id);
    return { url: this.service.buildAuthorizationUrl(id) };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPLEX_ADMIN)
  @Get('complexes/:id/mercadopago/status')
  async getStatus(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.service.assertCanManageComplex(user, id);
    return this.service.getConnectionStatus(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPLEX_ADMIN)
  @Audit('COMPLEX_MP_DISCONNECT', 'Complex')
  @Delete('complexes/:id/mercadopago')
  async disconnect(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.service.assertCanManageComplex(user, id);
    await this.service.disconnect(id);
    return { ok: true };
  }

  /** Historial de pases vendidos — lo ve el admin del complejo (o SUPER_ADMIN) para saber quién
   * pagó y cuánto entró. `from`/`to` son fechas "YYYY-MM-DD" opcionales (ver VideoAccessPaymentsCard
   * en el frontend). */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPLEX_ADMIN)
  @Get('complexes/:id/video-access/payments')
  async listPayments(@Param('id') id: string, @CurrentUser() user: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    await this.service.assertCanManageComplex(user, id);
    return this.service.listPasses(id, from, to);
  }

  /** Redirect de Mercado Pago después de que el dueño del complejo aprueba la vinculación —
   * esto lo pega el NAVEGADOR del usuario (no un fetch del frontend), por eso responde con un
   * 302 a una página del panel admin en vez de JSON. Público: no hay sesión de LivePlay en ese
   * momento del flujo, la identidad del complejo viaja en `state` (ver buildAuthorizationUrl). */
  @Get('payments/mercadopago/oauth/callback')
  async oauthCallback(@Query('code') code: string | undefined, @Query('state') state: string | undefined, @Res() res: Response) {
    const redirectTo = await this.service.handleOAuthCallback(code, state);
    res.redirect(302, redirectTo);
  }

  @UseGuards(JwtAuthGuard)
  @Post('complexes/:id/video-access/checkout')
  checkout(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() body: { matchId?: string }) {
    return this.service.createCheckoutPreference(id, user, body?.matchId);
  }

  /** Público: lo llama Mercado Pago, no un usuario logueado. Siempre responde 200 — incluso
   * ante una notificación que no podemos procesar — para que Mercado Pago no la siga
   * reintentando indefinidamente; los errores quedan solo en el log del servidor. */
  @Post('payments/mercadopago/webhook')
  async webhook(@Query() query: Record<string, string>) {
    try {
      await this.service.handleWebhook(query);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Error procesando webhook de Mercado Pago:', err);
    }
    return { ok: true };
  }
}
