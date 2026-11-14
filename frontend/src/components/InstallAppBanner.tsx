'use client';

import { useEffect, useState } from 'react';
import LogoMark from './LogoMark';

/**
 * Botón "Instalar aplicación" para celulares.
 *
 * - Android (Chrome, Edge, Samsung Internet): captura el evento `beforeinstallprompt` y,
 *   al tocar el botón, abre el cartel nativo de instalación de la PWA.
 * - iPhone/iPad: Safari no tiene ese evento, así que el botón abre unas instrucciones
 *   cortas ("Compartir" → "Agregar a pantalla de inicio").
 * - Android sin evento (navegadores que no lo soportan): mismas instrucciones, pero con el
 *   menú ⋮ del navegador.
 *
 * No se muestra en computadora, ni si la app ya está instalada (abierta en modo
 * standalone), ni durante 7 días después de que el usuario lo cierra con la ✕.
 */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const DISMISS_KEY = 'lp_install_dismissed_at';
const DISMISS_DAYS = 7;

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function recentlyDismissed() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return at > 0 && Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

export default function InstallAppBanner() {
  const [platform, setPlatform] = useState<'ios' | 'android' | null>(null);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent;
    // iPadOS se presenta como Mac: se distingue por la pantalla táctil.
    const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
    const android = /Android/i.test(ua);
    if (!ios && !android) return;
    if (isStandalone() || recentlyDismissed()) return;

    setPlatform(ios ? 'ios' : 'android');
    setVisible(true);

    const onPrompt = (e: Event) => {
      e.preventDefault(); // evita el mini-cartel automático de Chrome; lo abrimos desde nuestro botón
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setVisible(false);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* modo privado: no pasa nada, solo no se recuerda */
    }
    setVisible(false);
    setShowHelp(false);
  }

  async function install() {
    if (deferred) {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      setDeferred(null);
      if (outcome === 'accepted') setVisible(false);
      return;
    }
    setShowHelp(true);
  }

  if (!visible || !platform) return null;

  return (
    <>
      <div className="fixed inset-x-3 bottom-3 z-50 flex items-center gap-3 rounded-2xl border border-ink-700/60 bg-ink-900/95 p-3 shadow-glow backdrop-blur-sm"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <LogoMark className="h-10 w-10 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">Instalá LivePlay</p>
          <p className="truncate text-xs text-ink-300">Tus partidos a un toque.</p>
        </div>
        <button type="button" onClick={install} className="btn-primary !px-3.5 !py-2 text-xs">
          Instalar
        </button>
        <button type="button" onClick={dismiss} aria-label="Cerrar" className="p-1.5 text-ink-400 hover:text-ink-100">
          ✕
        </button>
      </div>

      {showHelp && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-3" onClick={() => setShowHelp(false)}>
          <div className="card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-bold text-white">Instalá LivePlay en tu celular</h2>
            {platform === 'ios' ? (
              <ol className="mt-3 space-y-2 text-sm text-ink-200">
                <li>1. Tocá el botón <b className="text-white">Compartir</b> (el cuadrado con la flecha hacia arriba), abajo o arriba de la pantalla.</li>
                <li>2. Bajá y tocá <b className="text-white">Agregar a pantalla de inicio</b>.</li>
                <li>3. Tocá <b className="text-white">Agregar</b>. El ícono de LivePlay aparece con tus otras apps.</li>
              </ol>
            ) : (
              <ol className="mt-3 space-y-2 text-sm text-ink-200">
                <li>1. Tocá el menú <b className="text-white">⋮</b> del navegador (arriba a la derecha).</li>
                <li>2. Tocá <b className="text-white">Instalar aplicación</b> o <b className="text-white">Agregar a pantalla principal</b>.</li>
                <li>3. Confirmá. El ícono de LivePlay aparece con tus otras apps.</li>
              </ol>
            )}
            <button type="button" onClick={() => setShowHelp(false)} className="btn-primary mt-4 w-full">
              Entendido
            </button>
          </div>
        </div>
      )}
    </>
  );
}
