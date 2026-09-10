import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { eq } from 'drizzle-orm';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto, LoginDto, RefreshDto, ForgotPasswordDto, ResetPasswordDto, ChangePasswordDto } from './dto/auth.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { DbService } from '../db/db.service';
import { users } from '../db/schema';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService, private dbService: DbService) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  logout(@CurrentUser() user: AuthUser, @Body() dto: RefreshDto) {
    return this.authService.logout(user.userId, dto.refreshToken);
  }

  @Post('forgot-password')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Post('resend-verification')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  resendVerification(@Body() dto: ForgotPasswordDto) {
    return this.authService.resendVerification(dto.email);
  }

  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(user.userId, dto.currentPassword, dto.newPassword);
  }

  @Get('verify-email/:token')
  verifyEmail(@Req() req: Request) {
    return this.authService.verifyEmail(req.params.token);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const fullUser = await this.dbService.db.query.users.findFirst({ where: eq(users.id, user.userId) });
    if (!fullUser) return null;
    const { passwordHash, passwordResetToken, emailVerifyToken, ...rest } = fullUser;
    return rest;
  }
}
