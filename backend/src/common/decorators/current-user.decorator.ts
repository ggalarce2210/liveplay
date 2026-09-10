import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthUser {
  userId: string;
  email: string;
  role: string;
}

/** Extrae el usuario autenticado adjuntado por JwtAuthGuard/JwtStrategy. */
export const CurrentUser = createParamDecorator((data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  const user = request.user as AuthUser;
  return data ? user?.[data] : user;
});
