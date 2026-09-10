import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

/**
 * Servicio de email. Si se configuran SMTP_HOST/SMTP_USER/SMTP_PASS envía correo real;
 * si no, cae a un transporte que solo imprime el mail por consola (capa MOCK, claramente
 * separada) para que el flujo de verificación/recupero de contraseña se pueda probar sin
 * depender de un proveedor de correo real (§3, §38 — dejar clara la capa mock).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter;
  private readonly isMock: boolean;
  private readonly from: string;

  constructor(private config: ConfigService) {
    const host = config.get<string>('SMTP_HOST');
    this.isMock = !host;
    this.from = config.get<string>('MAIL_FROM', 'LivePlay <no-reply@liveplay.com>');
    this.transporter = this.isMock
      ? nodemailer.createTransport({ jsonTransport: true })
      : nodemailer.createTransport({
          host,
          port: config.get<number>('SMTP_PORT', 587),
          // Resend (y otros proveedores) exigen STARTTLS explícito en el 587; `secure` solo
          // debe ser `true` cuando se usa el puerto 465 (TLS directo).
          secure: config.get<number>('SMTP_PORT', 587) === 465,
          auth: { user: config.get<string>('SMTP_USER'), pass: config.get<string>('SMTP_PASS') },
        });
  }

  /** Expuesto para que AuthService pueda devolver el link de verificación en la respuesta
   * cuando no hay SMTP real configurado (modo demo) — así se puede probar el flujo de
   * confirmación por email sin depender de una casilla de correo real. */
  isMockMode() {
    return this.isMock;
  }

  async send(to: string, subject: string, html: string) {
    const info = await this.transporter.sendMail({ from: this.from, to, subject, html });
    if (this.isMock) {
      this.logger.log(`[MOCK EMAIL] to=${to} subject="${subject}"\n${html}`);
    }
    return info;
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
