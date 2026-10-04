'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import clsx from 'clsx';
import { useAuthStore } from '@/lib/auth-store';
import LogoMark from './LogoMark';

const PLAYER_LINKS = [
  { href: '/dashboard', label: 'Mis partidos', icon: '🏠' },
  { href: '/dashboard/clips', label: 'Mis momentos', icon: '⭐' },
  { href: '/dashboard/notifications', label: 'Notificaciones', icon: '🔔' },
  { href: '/dashboard/profile', label: 'Mi perfil', icon: '👤' },
];

const ADMIN_LINKS = [
  { href: '/admin', label: 'Panel admin', icon: '📊' },
  { href: '/admin/canchas', label: 'Canchas y cámaras', icon: '🎥' },
];

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuthStore();

  const links = [...PLAYER_LINKS, ...(user?.role === 'SUPER_ADMIN' || user?.role === 'COMPLEX_ADMIN' ? ADMIN_LINKS : [])];

  async function onLogout() {
    await logout();
    router.push('/login');
  }

  return (
    // `h-full` (no `h-screen`/100vh): en el drawer mobile este <aside> vive dentro de un
    // contenedor `fixed inset-0` (ver AppShell) cuya altura real ya está resuelta contra el
    // viewport visible; si el aside pedía su propio 100vh podía terminar más alto que ese
    // contenedor en navegadores mobile (la barra de Chrome/Safari colapsa y cambia la altura
    // visible), empujando el botón "Cerrar sesión" (mt-auto) fuera de la pantalla. En desktop
    // el wrapper de AppShell le da `h-screen` explícito, así que `h-full` sigue llenando toda
    // la altura ahí también.
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-ink-800 bg-ink-950 px-4 py-6">
      <Link href="/dashboard" className="mb-8 flex items-center gap-2 px-2" onClick={onNavigate}>
        <LogoMark className="h-8 w-8 shrink-0" />
        <span className="text-sm font-bold tracking-tight text-white">
          Live<span className="text-pitch-400">Play</span>
        </span>
      </Link>

      <nav className="flex-1 space-y-1 overflow-y-auto">
        {links.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              onClick={onNavigate}
              className={clsx(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition',
                active ? 'bg-pitch-500/15 text-pitch-400' : 'text-ink-300 hover:bg-ink-800/60 hover:text-white',
              )}
            >
              <span>{link.icon}</span>
              {link.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-ink-800 pt-4">
        <div className="mb-3 flex items-center gap-3 px-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-700 text-sm font-semibold text-ink-100">
            {user?.firstName?.[0]}
            {user?.lastName?.[0]}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="truncate text-xs text-ink-400">{user?.email}</p>
          </div>
        </div>
        <button onClick={onLogout} className="w-full rounded-lg px-3 py-2 text-left text-sm text-ink-400 hover:bg-ink-800/60 hover:text-white">
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
