'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getAccessToken } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/**
 * La landing (`/`, que es el `start_url` de la PWA — ver manifest.ts) nunca miraba si ya había
 * una sesión guardada: un usuario que ya se había logueado antes veía igual la página de
 * marketing y tenía que tocar "Iniciar sesión" a mano cada vez, aunque tuviera un access/refresh
 * token válido en localStorage. Esto se notaba sobre todo abriendo la PWA desde el ícono del
 * celular (pedido 2026-11-09: "q entre directamente una vez logueado").
 *
 * Este componente no renderiza nada visible en el caso común (visitante sin sesión, que es la
 * mayoría de las visitas a "/" vía buscadores, etc. — no le agrega ninguna demora). Si encuentra
 * un access token guardado, valida la sesión contra `/auth/me` reusando el mismo `fetchMe()` que
 * usa `AuthGuard` (con su reintento automático vía refresh token ante un 401 — ver `api.ts`), y
 * si es válida manda directo a `/dashboard`. Si no hay token, o el token/refresh resultan
 * inválidos o expirados, no hace nada — se queda mostrando la landing normal.
 */
export default function HomeAuthRedirect() {
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const fetchMe = useAuthStore((s) => s.fetchMe);
  const user = useAuthStore((s) => s.user);
  const initialized = useAuthStore((s) => s.initialized);

  useEffect(() => {
    if (!getAccessToken()) return;
    setChecking(true);
    fetchMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!checking || !initialized) return;
    if (user) {
      router.replace('/dashboard');
    } else {
      // Token guardado pero inválido/expirado (y el refresh también falló): mostramos la landing.
      setChecking(false);
    }
  }, [checking, initialized, user, router]);

  if (!checking) return null;

  // Tapa la landing con un loader breve mientras se confirma la sesión, para no mostrar
  // un parpadeo de "Iniciar sesión" / "Registrarme" justo antes de mandar a /dashboard.
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-pitch-500 border-t-transparent" />
    </div>
  );
}
