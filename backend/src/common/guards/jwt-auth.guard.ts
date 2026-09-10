import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Requiere un access token JWT válido en el header Authorization: Bearer <token>. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
