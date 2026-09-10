import { BadRequestException, ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { eq, and, isNull, gt } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { DbService } from '../db/db.service';
import { users, refreshTokens, auditLogs } from '../db/schema';
import { MailService } from '../common/mail.service';
import { RegisterDto, LoginDto } from './dto/auth.dto';

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_DAYS = 30;

@Injectable()
export class AuthService {
  constructor(
    private dbService: DbService,
    private jwt: JwtService,
    private config: ConfigService,
    private mail: MailService,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  private hashToken(token: string) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private async issueTokens(user: { id: string; email: string; role: string }) {
    const accessToken = this.jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      { secret: this.config.get('JWT_ACCESS_SECRET', 'dev-access-secret-change-me'), expiresIn: ACCESS_TOKEN_TTL },
    );
    const refreshTokenRaw = crypto.randomBytes(48).toString('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
    await this.db.insert(refreshTokens).values({ userId: user.id, tokenHash: this.hashToken(refreshTokenRaw), expiresAt });
    return { accessToken, refreshToken: refreshTokenRaw };
  }

  async register(dto: RegisterDto) {
    const existing = await this.db.query.users.findFirst({ where: eq(users.email, dto.email) });
    if (existing) throw new ConflictException('Ya existe una cuenta con ese email');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const emailVerifyToken = crypto.randomBytes(32).toString('hex');

    const [user] = await this.db
      .insert(users)
      .values({
        email: dto.email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        homeComplexId: dto.homeComplexId,
        emailVerifyToken,
        role: 'PLAYER',
      })
      .returning();

    const appUrl = this.config.get('APP_PUBLIC_URL', 'http://localhost:3000');
    await this.mail.sendVerificationEmail(user.email, emailVerifyToken, appUrl);

    // No emitimos tokens acá: la cuenta queda creada pero sin poder iniciar sesión hasta
    // confirmar el email (§3/§38 — "el login tiene que confirmar vía mail"). En modo mock
    // (sin SMTP real, como en este entorno de desarrollo) devolvemos el link de verificación
    // en la propia respuesta para poder probar el flujo completo sin una casilla de correo
    // real — en producción, con SMTP configurado, este campo nunca se incluye.
    return {
      user: this.toPublicUser(user),
      requiresEmailVerification: true,
      ...(this.mail.isMockMode() ? { devVerifyUrl: `${appUrl}/verify-email?token=${emailVerifyToken}` } : {}),
    };
  }

  async login(dto: LoginDto) {
    const user = await this.db.query.users.findFirst({ where: eq(users.email, dto.email) });
    if (!user) throw new UnauthorizedException('Email o contraseña incorrectos');
    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Email o contraseña incorrectos');
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException('Confirmá tu cuenta desde el email que te enviamos antes de iniciar sesión.');
    }

    await this.db.insert(auditLogs).values({ userId: user.id, action: 'LOGIN' });
    const tokens = await this.issueTokens(user);
    return { user: this.toPublicUser(user), ...tokens };
  }

  async resendVerification(email: string) {
    const user = await this.db.query.users.findFirst({ where: eq(users.email, email) });
    // No revelamos si el email existe o ya está verificado (evita enumeración de usuarios).
    if (!user || user.emailVerifiedAt) return { success: true };

    const emailVerifyToken = crypto.randomBytes(32).toString('hex');
    await this.db.update(users).set({ emailVerifyToken }).where(eq(users.id, user.id));
    const appUrl = this.config.get('APP_PUBLIC_URL', 'http://localhost:3000');
    await this.mail.sendVerificationEmail(user.email, emailVerifyToken, appUrl);

    return { success: true, ...(this.mail.isMockMode() ? { devVerifyUrl: `${appUrl}/verify-email?token=${emailVerifyToken}` } : {}) };
  }

  async logout(userId: string, refreshToken: string) {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), eq(refreshTokens.tokenHash, this.hashToken(refreshToken)), isNull(refreshTokens.revokedAt)));
    await this.db.insert(auditLogs).values({ userId, action: 'LOGOUT' });
    return { success: true };
  }

  async refresh(refreshToken: string) {
    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.db.query.refreshTokens.findFirst({ where: eq(refreshTokens.tokenHash, tokenHash) });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token inválido o expirado');
    }
    const user = await this.db.query.users.findFirst({ where: eq(users.id, stored.userId) });
    if (!user) throw new UnauthorizedException('Usuario no encontrado');

    // Rotación: se invalida el usado y se emite uno nuevo (mitiga robo de refresh tokens)
    await this.db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, stored.id));
    const tokens = await this.issueTokens(user);
    return { user: this.toPublicUser(user), ...tokens };
  }

  async forgotPassword(email: string) {
    const user = await this.db.query.users.findFirst({ where: eq(users.email, email) });
    // No revelamos si el email existe o no (evita enumeración de usuarios)
    if (!user) return { success: true };
    const token = crypto.randomBytes(32).toString('hex');
    await this.db
      .update(users)
      .set({ passwordResetToken: token, passwordResetExpiresAt: new Date(Date.now() + 60 * 60 * 1000) })
      .where(eq(users.id, user.id));
    await this.mail.sendPasswordResetEmail(user.email, token, this.config.get('APP_PUBLIC_URL', 'http://localhost:3000'));
    return { success: true };
  }

  async resetPassword(token: string, newPassword: string) {
    const user = await this.db.query.users.findFirst({ where: eq(users.passwordResetToken, token) });
    if (!user || !user.passwordResetExpiresAt || user.passwordResetExpiresAt < new Date()) {
      throw new BadRequestException('Enlace inválido o expirado');
    }
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.db
      .update(users)
      .set({ passwordHash, passwordResetToken: null, passwordResetExpiresAt: null })
      .where(eq(users.id, user.id));
    await this.db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, user.id), isNull(refreshTokens.revokedAt)));
    return { success: true };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw new UnauthorizedException();
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new UnauthorizedException('La contraseña actual no es correcta');
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.db.update(users).set({ passwordHash }).where(eq(users.id, userId));
    return { success: true };
  }

  async verifyEmail(token: string) {
    const user = await this.db.query.users.findFirst({ where: eq(users.emailVerifyToken, token) });
    if (!user) throw new BadRequestException('Token de verificación inválido o ya usado');
    const [updated] = await this.db
      .update(users)
      .set({ emailVerifiedAt: new Date(), emailVerifyToken: null })
      .where(eq(users.id, user.id))
      .returning();

    // Confirmar el email también inicia sesión directamente (mejor UX: un solo click desde
    // el mail y ya quedás adentro, sin tener que volver a tipear usuario/contraseña).
    const tokens = await this.issueTokens(updated);
    return { success: true, user: this.toPublicUser(updated), ...tokens };
  }

  private toPublicUser(user: any) {
    const { passwordHash, passwordResetToken, emailVerifyToken, ...rest } = user;
    return rest;
  }
}
