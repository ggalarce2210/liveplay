import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

type MailMode = 'RESEND_API' | 'SMTP' | 'MOCK';

/**
 * Servicio de email con tres modos, elegidos automáticamente según qué haya configurado:
 *
 * 1. RESEND_API — si hay `RESEND_API_KEY`, se manda por la API HTTP de Resend
 *    (https://api.resend.com/emails). Es el modo recomendado: varios hosts (Render incluido)
 *    bloquean o cuelgan las conexiones SMTP salientes por políticas anti-spam, así que un
 *    envío por SMTP puede quedar colgado el pedido entero en vez de fallar rápido.
 * 2. SMTP — si no hay `RESEND_API_KEY` pero sí `SMTP_HOST`, se usa nodemailer con SMTP
 *    normal (útil para otros proveedores que no tengan API HTTP).
 * 3. MOCK — si no hay ninguno de los dos, cae a un transporte que solo imprime el mail por
 *    consola, para poder probar el flujo de verificación/recupero de contraseña sin depender
 *    de un proveedor de correo real (§3, §38 — dejar clara la capa mock).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly mode: MailMode;
  private readonly from: string;
  private readonly resendApiKey?: string;
  private smtpTransporter?: nodemailer.Transporter;

  constructor(private config: ConfigService) {
    this.from = config.get<string>('MAIL_FROM', 'LivePlay <no-reply@liveplay.com>');
    this.resendApiKey = config.get<string>('RESEND_API_KEY');
    const smtpHost = config.get<string>('SMTP_HOST');

    if (this.resendApiKey) {
      this.mode = 'RESEND_API';
    } else if (smtpHost) {
      this.mode = 'SMTP';
      this.smtpTransporter = nodemailer.createTransport({
        host: smtpHost,
        port: this.config.get<number>('SMTP_PORT', 587),
        // `secure` solo debe ser `true` cuando se usa el puerto 465 (TLS directo); el 587
        // usa STARTTLS explícito.
        secure: this.config.get<number>('SMTP_PORT', 587) === 465,
        auth: { user: this.config.get<string>('SMTP_USER'), pass: this.config.get<string>('SMTP_PASS') },
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        socketTimeout: 10000,
      });
    } else {
      this.mode = 'MOCK';
    }
  }

  /** Expuesto para que AuthService pueda devolver el link de verificación en la respuesta
   * cuando no hay proveedor de email real configurado (modo demo) — así se puede probar el
   * flujo de confirmación por email sin depender de una casilla de correo real. */
  isMockMode() {
    return this.mode === 'MOCK';
  }

  async send(to: string, subject: string, html: string) {
    if (this.mode === 'RESEND_API') {
      return this.sendViaResendApi(to, subject, html);
    }
    if (this.mode === 'SMTP') {
      return this.smtpTransporter!.sendMail({ from: this.from, to, subject, html });
    }
    this.logger.log(`[MOCK EMAIL] to=${to} subject="${subject}"\n${html}`);
    return { mocked: true };
  }

  /** Envío por la API HTTP de Resend, con timeout corto: si la red no responde rápido
   * preferimos fallar explícito antes que colgar el request de registro/login del usuario. */
  private async sendViaResendApi(to: string, subject: string, html: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: this.from, to, subject, html }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Resend API respondió ${res.status}: ${body}`);
      }
      return res.json();
    } catch (err) {
      this.logger.error(`Fallo al enviar email vía Resend a ${to}: ${(err as Error).message}`);
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async sendVerificationEmail(to: string, token: string, baseUrl: string) {
    return this.send(
      to,
      'Confirmá tu cuenta en LivePlay',
      `<p>Hacé click para verificar tu cuenta:</p><p><a href="${baseUrl}/verify-email?token=${token}">${baseUrl}/verify-email?token=${token}</a></p>`,
    );
  }

  async sendPasswordResetEmail(to: string, token: string, baseUrl: string) {
    return this.send(
      to,
      'Recuperar contraseña — LivePlay',
      `<p>Hacé click para elegir una nueva contraseña (válido por 1 hora):</p><p><a href="${baseUrl}/reset-password?token=${token}">${baseUrl}/reset-password?token=${token}</a></p>`,
    );
  }
}
