'use client';

import { useState } from 'react';
import Sidebar from './Sidebar';
import LogoMark from './LogoMark';

/**
 * Layout responsive del dashboard (§18/§31/§32). En desktop el sidebar queda fijo a la
 * izquierda; en mobile/tablet se oculta detrás de un botón de menú y se muestra como un
 * panel deslizable superpuesto, para que el contenido principal nunca quede apretado.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-ink-950">
      {/* Sidebar fijo — solo desktop */}
      <div className="hidden md:block">
        <Sidebar />
      </div>

      {/* Drawer mobile */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className="min-w-0 flex-1 overflow-y-auto">
        {/* Barra superior — solo mobile/tablet */}
        <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-ink-800 bg-ink-950/95 px-4 py-3 backdrop-blur md:hidden">
          <button onClick={() => setMobileOpen(true)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-ink-700 text-white">
            ☰
          </button>
          <LogoMark className="h-7 w-7 shrink-0" />
          <span className="text-sm font-bold tracking-tight text-white">
            Live<span className="text-pitch-400">Play</span>
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
