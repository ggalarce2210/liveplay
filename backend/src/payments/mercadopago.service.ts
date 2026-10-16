import { randomUUID } from 'crypto';
import { BadGatewayException, BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { and, eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { complexes, complexMercadoPagoAccounts, users, videoAccessPasses } from '../db/schema';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/roles';

const MP_AUTHORIZE_URL = 'https://auth.mercadopago.com/authorization';
const MP_API_BASE = 'https://api.mercadopago.com';
/** Margen de seguridad antes de que venza el access_token del complejo: lo renovamos si falta
 * menos de esto, nunca esperamos a que una creación de preferencia falle por token vencido. */
const TOKEN_REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000; // 24hs

class MercadoPagoApiError extends BadGatewayException {
  constructor(method: string, status: number, body: string) {
    super(`Mercado Pago API: ${method} devolvió HTTP ${status}: ${body.slice(0, 500)}`);
  }
}

interface OAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  user_id: number | string;
  public_key?: string;
  expires_in: number; // segundos
}

/**
 * Integración con Mercado Pago en modo MARKETPLACE (decisión 2026-10-16, ver conversación con
 * el cliente): cada complejo conecta SU PROPIA cuenta de Mercado Pago vía OAuth, y los pagos
 * entran directo ahí — nunca a una cuenta central de LivePlay. LivePlay se queda con una
 * comisión al vuelo vía `marketplace_fee` en cada preferencia (ver `createCheckoutPreference`).
 *
 * Para que esto funcione hace falta UNA aplicación de Mercado Pago creada a nombre de LivePlay
 * (panel de desarrolladores de Mercado Pago → "Tus integraciones" → crear aplicación), que da
 * un Client ID/Client Secret (env vars `MP_CLIENT_ID`/`MP_CLIENT_SECRET`) — esos identifican a
 * LivePlay como marketplace, no son credenciales de ningún complejo en particular. Cada complejo
 * se conecta DESPUÉS, individualmente, vía `buildAuthorizationUrl`/`handleOAuthCallback`.
 *
 * Documentación: https://www.mercadopago.com.ar/developers/es/docs/security/oauth/creation y
 * https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/how-tos/integrate-marketplace
 * (no se pudo re-confirmar contra la doc en vivo al escribir esto por una restricción de red del
 * entorno — está implementado contra el flujo estándar de OAuth marketplace de Mercado Pago, que
 * es estable desde hace años; conviene probar el flujo completo con una cuenta de prueba antes
 * de darlo por bueno en producción).
 */
@Injectable()
export class MercadopagoService {
  private readonly logger = new Logger(MercadopagoService.name);

  constructor(
    private dbService: DbService,
    private config: ConfigService,
  ) {}
  private get db() {
    return this.dbService.db;
  }

  private get clientId() {
    return this.requireConfig('MP_CLIENT_ID');
  }
  private get clientSecret() {
    return this.requireConfig('MP_CLIENT_SECRET');
  }
  private requireConfig(key: string): string {
    const value = this.config.get<string>(key);
    if (!value) {
      throw new BadGatewayException(
        `Falta configurar ${key} — todavía no se creó/cargó la aplicación de Mercado Pago de LivePlay.`,
      );
    }
    return value;
  }

  /** Base pública del backend TAL COMO la usan stream-token.service.ts/agent-enroll.controller.ts
   * — ojo, hay que agregar "/api" a mano (ver el bug histórico documentado en esos archivos: el
   * valor de API_PUBLIC_URL en sí nunca lo incluye). */
  private get apiBaseUrl() {
    return `${this.config.get<string>('API_PUBLIC_URL', 'http://localhost:3001')}/api`;
  }
  private get appBaseUrl() {
    return this.config.get<string>('APP_PUBLIC_URL', 'http://localhost:3000');
  }
  private get oauthStateSecret() {
    return this.config.get<string>('JWT_ACCESS_SECRET', 'dev-access-secret-change-me');
  }
  /** % de comisión que se queda LivePlay sobre cada pase vendido (configurable, default 0 — o
   * sea sin comisión hasta que se cargue explícitamente). */
  private get marketplaceFeePercent(): number {
    const raw = this.config.get<string>('MP_MARKETPLACE_FEE_PERCENT', '0');
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  /** SUPER_ADMIN puede todo; COMPLEX_ADMIN solo sobre el complejo que gestiona (campo
   * `users.managedComplexId`) — a diferencia del resto de ComplexesController (que no lo
   * valida, deuda técnica preexistente), ACÁ sí importa: estos endpoints tocan plata real. */
  async assertCanManageComplex(requester: AuthUser, complexId: string): Promise<void> {
    if (requester.role === Role.SUPER_ADMIN) return;
    if (requester.role !== Role.COMPLEX_ADMIN) {
      throw new ForbiddenException('No tenés permisos para gestionar el cobro de videos de este complejo');
    }
    const user = await this.db.query.users.findFirst({ where: eq(users.id, requester.userId), columns: { managedComplexId: true } });
    if (!user || user.managedComplexId !== complexId) {
      throw new ForbiddenException('No tenés permisos para gestionar el cobro de videos de este complejo');
    }
  }

  buildAuthorizationUrl(complexId: string): string {
    const state = jwt.sign({ complexId }, this.oauthStateSecret, { expiresIn: '15m' });
    const redirectUri = `${this.apiBaseUrl}/payments/mercadopago/oauth/callback`;
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      platform_id: 'mp',
      state,
      redirect_uri: redirectUri,
    });
    return `${MP_AUTHORIZE_URL}?${params.toString()}`;
  }

  /**
   * Maneja el redirect que hace Mercado Pago al navegador del dueño del complejo después de que
   * aprueba la vinculación. Devuelve a dónde redirigir ese navegador (panel admin), nunca JSON
   * — esto lo pega el navegador del usuario, no nuestro frontend vía fetch.
   */
  async handleOAuthCallback(code: string | undefined, state: string | undefined): Promise<string> {
    const adminUrl = `${this.appBaseUrl}/admin/canchas`;
    if (!code || !state) return `${adminUrl}?mp=error`;

    let complexId: string;
    try {
      const payload = jwt.verify(state, this.oauthStateSecret) as { complexId: string };
      complexId = payload.complexId;
    } catch {
      return `${adminUrl}?mp=error`;
    }

    try {
      const redirectUri = `${this.apiBaseUrl}/payments/mercadopago/oauth/callback`;
      const tokenRes = await this.mpFetch<OAuthTokenResponse>('POST', '/oauth/token', undefined, {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      });

      const tokenExpiresAt = new Date(Date.now() + tokenRes.expires_in * 1000);
      const existing = await this.db.query.complexMercadoPagoAccounts.findFirst({
        where: eq(complexMercadoPagoAccounts.complexId, complexId),
      });
      const values = {
        complexId,
        mpUserId: String(tokenRes.user_id),
        accessToken: tokenRes.access_token,
        refreshToken: tokenRes.refresh_token,
        publicKey: tokenRes.public_key ?? null,
        tokenExpiresAt,
      };
      if (existing) {
        await this.db.update(complexMercadoPagoAccounts).set({ ...values, updatedAt: new Date() }).where(eq(complexMercadoPagoAccounts.complexId, complexId));
      } else {
        await this.db.insert(complexMercadoPagoAccounts).values(values);
      }
      return `${adminUrl}?mp=connected`;
    } catch (err) {
      this.logger.error(`OAuth callback de Mercado Pago falló para complejo ${complexId}: ${err}`);
      return `${adminUrl}?mp=error`;
    }
  }

  async getConnectionStatus(complexId: string) {
    const account = await this.db.query.complexMercadoPagoAccounts.findFirst({
      where: eq(complexMercadoPagoAccounts.complexId, complexId),
      columns: { mpUserId: true, connectedAt: true },
    });
    return { connected: !!account, mpUserId: account?.mpUserId ?? null, connectedAt: account?.connectedAt ?? null };
  }

  async disconnect(complexId: string): Promise<void> {
    await this.db.delete(complexMercadoPagoAccounts).where(eq(complexMercadoPagoAccounts.complexId, complexId));
  }

  /** Devuelve un access_token vigente para ESE complejo, renovándolo primero si está por vencer. */
  private async getValidAccessToken(complexId: string): Promise<string> {
    const account = await this.db.query.complexMercadoPagoAccounts.findFirst({ where: eq(complexMercadoPagoAccounts.complexId, complexId) });
    if (!account) throw new BadRequestException('Este complejo todavía no conectó su cuenta de Mercado Pago');

    if (account.tokenExpiresAt.getTime() - Date.now() > TOKEN_REFRESH_MARGIN_MS) {
      return account.accessToken;
    }

    this.logger.log(`Renovando access_token de Mercado Pago del complejo ${complexId} (vence ${account.tokenExpiresAt.toISOString()})`);
    const refreshed = await this.mpFetch<OAuthTokenResponse>('POST', '/oauth/token', undefined, {
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: account.refreshToken,
    });
    const tokenExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
    await this.db
      .update(complexMercadoPagoAccounts)
      .set({ accessToken: refreshed.access_token, refreshToken: refreshed.refresh_token, tokenExpiresAt, updatedAt: new Date() })
      .where(eq(complexMercadoPagoAccounts.complexId, complexId));
    return refreshed.access_token;
  }

  /**
   * Crea el pase PENDING + la preferencia de Checkout Pro en la cuenta del complejo (con
   * `marketplace_fee` para la comisión de LivePlay) y devuelve el link de pago. `returnMatchId`
   * es opcional, solo para que `back_urls` mande de vuelta al partido puntual que el usuario
   * estaba mirando en vez de a una página genérica.
   */
  async createCheckoutPreference(complexId: string, requester: AuthUser, returnMatchId?: string) {
    const complex = await this.db.query.complexes.findFirst({ where: eq(complexes.id, complexId) });
    if (!complex) throw new NotFoundException('Complejo no encontrado');
    if (!complex.chargesForVideoAccess || !complex.videoAccessPriceArs || !complex.videoAccessPassDays) {
      throw new BadRequestException('Este complejo no tiene configurado el cobro por ver videos');
    }

    const accessToken = await this.getValidAccessToken(complexId);
    const externalReference = randomUUID();

    const [pass] = await this.db
      .insert(videoAccessPasses)
      .values({
        complexId,
        userId: requester.userId,
        status: 'PENDING',
        amountArs: complex.videoAccessPriceArs,
        passDaysSnapshot: complex.videoAccessPassDays,
        externalReference,
      })
      .returning();

    const returnUrl = returnMatchId ? `${this.appBaseUrl}/matches/${returnMatchId}` : `${this.appBaseUrl}/dashboard`;
    const notificationUrl = `${this.apiBaseUrl}/payments/mercadopago/webhook?complexId=${complexId}`;
    const feeAmount = Math.round(complex.videoAccessPriceArs * (this.marketplaceFeePercent / 100) * 100) / 100;

    try {
      const preference = await this.mpFetch<{ id: string; init_point: string; sandbox_init_point?: string }>(
        'POST',
        '/checkout/preferences',
        accessToken,
        {
          items: [
            {
              id: pass.id,
              title: `Acceso a videos de ${complex.name} (${complex.videoAccessPassDays} días)`,
              quantity: 1,
              currency_id: 'ARS',
              unit_price: complex.videoAccessPriceArs,
            },
          ],
          marketplace_fee: feeAmount,
          external_reference: externalReference,
          notification_url: notificationUrl,
          back_urls: { success: returnUrl, pending: returnUrl, failure: returnUrl },
          auto_return: 'approved',
        },
      );
      await this.db.update(videoAccessPasses).set({ mpPreferenceId: preference.id, updatedAt: new Date() }).where(eq(videoAccessPasses.id, pass.id));
      return { initPoint: preference.init_point, passId: pass.id };
    } catch (err) {
      // No dejamos un pase PENDING huérfano si ni siquiera se pudo crear la preferencia — sin
      // esto, cada intento fallido de pago va acumulando filas PENDING inútiles para siempre.
      await this.db.delete(videoAccessPasses).where(eq(videoAccessPasses.id, pass.id));
      throw err;
    }
  }

  /**
   * Notificación de Mercado Pago (webhook). Soporta el formato nuevo (`type`/`data.id`) y el
   * legacy (`topic`/`id`) — Mercado Pago todavía manda ambos según el canal de integración.
   * `complexId` viaja en la URL del webhook (lo pusimos nosotros al crear la preferencia, ver
   * `createCheckoutPreference`) porque la notificación en sí solo trae el id del pago, nunca de
   * qué complejo es — sin esto no sabríamos con qué access_token consultarlo.
   */
  async handleWebhook(query: Record<string, string>): Promise<void> {
    const type = query.type ?? query.topic;
    const paymentId = query['data.id'] ?? query.id;
    const complexId = query.complexId;

    if (type !== 'payment' || !paymentId || !complexId) return; // no es una notificación de pago, o falta contexto: no hay nada que hacer

    const accessToken = await this.getValidAccessToken(complexId);
    const payment = await this.mpFetch<{ status: string; external_reference: string; id: number }>(
      'GET',
      `/v1/payments/${paymentId}`,
      accessToken,
    );

    const pass = await this.db.query.videoAccessPasses.findFirst({
      where: and(eq(videoAccessPasses.externalReference, payment.external_reference), eq(videoAccessPasses.complexId, complexId)),
    });
    if (!pass) {
      this.logger.warn(`Webhook de Mercado Pago: no se encontró el pase para external_reference=${payment.external_reference} (complejo ${complexId})`);
      return;
    }
    if (pass.status !== 'PENDING') return; // ya procesado (webhook duplicado) — no pisar un pase ya resuelto

    if (payment.status === 'approved') {
      const purchasedAt = new Date();
      const expiresAt = new Date(purchasedAt.getTime() + pass.passDaysSnapshot * 24 * 60 * 60 * 1000);
      await this.db
        .update(videoAccessPasses)
        .set({ status: 'APPROVED', mpPaymentId: String(payment.id), purchasedAt, expiresAt, updatedAt: new Date() })
        .where(eq(videoAccessPasses.id, pass.id));
    } else if (payment.status === 'rejected' || payment.status === 'cancelled') {
      await this.db
        .update(videoAccessPasses)
        .set({ status: 'REJECTED', mpPaymentId: String(payment.id), updatedAt: new Date() })
        .where(eq(videoAccessPasses.id, pass.id));
    }
    // cualquier otro status ("pending", "in_process", etc.) lo dejamos PENDING — va a llegar
    // otra notificación cuando cambie de estado.
  }

  private async mpFetch<T>(method: 'GET' | 'POST', path: string, accessToken: string | undefined, body?: unknown): Promise<T> {
    const res = await fetch(`${MP_API_BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new MercadoPagoApiError(`${method} ${path}`, res.status, text);
    return text ? JSON.parse(text) : ({} as T);
  }
}
