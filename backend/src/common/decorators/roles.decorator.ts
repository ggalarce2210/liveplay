import { SetMetadata } from '@nestjs/common';
import { Role } from '../roles';

export const ROLES_KEY = 'roles';
/** Restringe un endpoint a uno o más roles. Ej: @Roles(Role.SUPER_ADMIN, Role.COMPLEX_ADMIN) */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
