import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../roles';
import { ROLES_KEY } from '../decorators/roles.decorator';

/** Autoriza según el/los rol(es) requerido(s) por @Roles(). Debe ir después de JwtAuthGuard. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) throw new ForbiddenException('No autenticado');
    const allowed = requiredRoles.includes(user.role);
    if (!allowed) {
      throw new ForbiddenException('No tenés permisos para realizar esta acción');
    }
    return true;
  }
}
