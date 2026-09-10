/** Roles de la plataforma (espejo del enum `role` de la base de datos). */
export const Role = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  COMPLEX_ADMIN: 'COMPLEX_ADMIN',
  PLAYER: 'PLAYER',
} as const;

export type Role = (typeof Role)[keyof typeof Role];
