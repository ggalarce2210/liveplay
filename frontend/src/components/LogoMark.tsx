/**
 * Isotipo de LIVEPLAY: insignia en degradé verde césped con un triángulo de "play" en blanco y
 * una línea de cancha sutil de fondo — resume en un solo ícono la idea de "video + deporte en
 * vivo" sin depender de texto (§18, diseño premium/minimalista).
 * Antes tenía un punto rojo tipo "REC" en la esquina, pero a este tamaño quedaba como una
 * notificación pegada encima del ícono en vez de un detalle de marca (feedback del cliente,
 * 2026-09-22) — se sacó. La idea de "en vivo" ahora se transmite con movimiento (el glow rojo
 * animado del logo del header en la home, ver page.tsx) en vez de con un elemento fijo que hay
 * que renderizar bien en cualquier tamaño, incluido el favicon.
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
    </svg>
  );
}
