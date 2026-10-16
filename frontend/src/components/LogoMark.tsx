/**
 * Isotipo de LIVEPLAY: insignia en degradé verde césped con un triángulo de "play" en blanco,
 * un punto ámbar tipo REC/en vivo y una línea de cancha sutil de fondo — resume en un solo ícono
 * la idea de "video + deporte en vivo" sin depender de texto (§18, diseño premium/minimalista).
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
      <circle cx="31" cy="9" r="4.5" fill="#ffb020" stroke="#0d2e19" strokeWidth="1.5" />
    </svg>
  );
}
