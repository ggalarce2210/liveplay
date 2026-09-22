/**
 * Isotipo de LIVEPLAY: insignia en degradé verde césped con un triángulo de "play" en blanco,
 * una línea de cancha sutil de fondo, y un punto rojo tipo "REC/en vivo" — resume en un solo
 * ícono la idea de "video + deporte en vivo" sin depender de texto (§18, diseño premium/minimalista).
 * El punto es rojo (no ámbar) a propósito: en el resto de la app el ámbar ya significa
 * "procesando/atención" (ver MatchCard: PROCESSING, y los bookmarks/marcadores del timeline) y
 * el rojo es el color que usamos para "grabando" (MatchCard: RECORDING) — este punto sigue esa
 * misma convención en vez de introducir un tercer color con un significado distinto (2026-09-22).
 */
export default function LogoMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="lp-badge" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2f9a52" />
          <stop offset="1" stopColor="#0d2e19" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill="url(#lp-badge)" />
      <path d="M4 29 Q20 21 36 29" stroke="#ffffff" strokeOpacity="0.16" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M16.2 12.3 L27.4 20 L16.2 27.7 Z" fill="#ffffff" />
      <circle cx="31" cy="9" r="4.5" fill="#ef4444" stroke="#0d2e19" strokeWidth="1.5" />
    </svg>
  );
}
