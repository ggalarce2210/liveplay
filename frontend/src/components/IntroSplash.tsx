'use client';

import { useEffect, useState } from 'react';
import LogoMark from './LogoMark';

/**
 * Pantalla de inicio animada, con temática deportiva, que se muestra una vez antes del
 * formulario de login (pedido explícito del usuario: "pantalla de inicio con el logo antes
 * del login"). El isotipo entra con un efecto de "pique" (como una pelota picando al centro
 * de la pantalla), seguido del wordmark y un barrido de reflector de estadio de fondo. Se
 * puede saltear con un click/tap en cualquier lugar, y se retira sola a los ~2s.
 */
export default function IntroSplash({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const leaveTimer = setTimeout(() => setLeaving(true), 1700);
    const doneTimer = setTimeout(onDone, 2050);
    return () => {
      clearTimeout(leaveTimer);
      clearTimeout(doneTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function skip() {
    setLeaving(true);
    setTimeout(onDone, 300);
  }

  return (
    <div
      onClick={skip}
      role="button"
      aria-label="Continuar"
      className={`fixed inset-0 z-50 flex cursor-pointer select-none flex-col items-center justify-center overflow-hidden bg-ink-950 transition-opacity duration-300 ease-out ${
        leaving ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(55% 45% at 50% 42%, rgba(47,154,82,0.28) 0%, rgba(4,18,10,0) 65%)',
        }}
      />

      {/* Barrido tipo reflector de estadio */}
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <div
          className="absolute inset-y-0 w-1/4 skew-x-[-20deg] bg-gradient-to-r from-transparent via-white/10 to-transparent"
          style={{ animation: 'lp-sweep 2.4s ease-in-out infinite' }}
        />
      </div>

      <div style={{ animation: 'lp-kick-in 0.85s cubic-bezier(.22,1.4,.36,1) both' }}>
        <LogoMark className="h-20 w-20 drop-shadow-[0_0_34px_rgba(47,154,82,0.55)] sm:h-24 sm:w-24" />
      </div>

      <div
        className="mt-5 text-3xl font-black tracking-tight text-white sm:text-4xl"
        style={{ animation: 'lp-fade-up 0.5s ease-out 0.5s both' }}
      >
        Live<span className="text-pitch-400">Play</span>
      </div>

      <div
        className="mt-2 text-xs font-medium tracking-[0.35em] text-ink-300 sm:text-sm"
        style={{ animation: 'lp-fade-up 0.5s ease-out 0.7s both' }}
      >
        JUGÁ · GRABÁ · REVIVÍ
      </div>

      <div
        className="mt-9 h-0.5 w-40 overflow-hidden rounded-full bg-ink-800"
        style={{ animation: 'lp-fade-up 0.4s ease-out 0.85s both' }}
      >
        <div className="h-full bg-gradient-to-r from-pitch-500 to-pitch-400" style={{ animation: 'lp-fill 1.3s ease-in-out 0.35s both' }} />
      </div>

      <p
        className="mt-6 text-[11px] text-ink-500"
        style={{ animation: 'lp-fade-up 0.4s ease-out 1s both' }}
      >
        Tocá para continuar
      </p>
    </div>
  );
}
