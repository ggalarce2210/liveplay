'use client';

import { useEffect } from 'react';

/**
 * Registra el service worker (public/sw.js) en el cliente. Es un componente aparte
 * (en vez de ponerlo directo en layout.tsx) porque layout.tsx es un server component que
 * exporta `metadata` — necesita quedar como server component para que Next sirva el
 * `<head>` estático, así que el único pedacito que toca `window`/`navigator` vive acá.
 * No rompe nada si el browser no soporta service workers (Safari viejo, etc.): el `if`
 * simplemente no hace nada.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    // Registrar después del load para no competir con los recursos críticos del primer render.
    const onLoad = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Si falla (por ejemplo en dev con HTTP sin TLS en algunos browsers), la app
        // sigue funcionando normal — el service worker es una mejora, no un requisito.
      });
    };
    window.addEventListener('load', onLoad);
    return () => window.removeEventListener('load', onLoad);
  }, []);

  return null;
}
