import Link from 'next/link';
import LogoMark from '@/components/LogoMark';
import CourtExplorer from '@/components/CourtExplorer';

const FEATURES = [
  { icon: '⚽', title: 'Fútbol 5', desc: 'Goles, tarjetas y jugadas asociadas al minuto exacto del video de tu partido.' },
  { icon: '🎾', title: 'Pádel', desc: 'Parejas, sets y resultado — encontrá el punto que ganó el partido en segundos.' },
  { icon: '📺', title: 'Reproducción HD', desc: 'Streaming adaptativo por HLS: arranca al instante y no se corta, juegues donde juegues.' },
  { icon: '⏱', title: 'Timeslice', desc: 'Timeline con miniaturas en vivo: arrastrá el cursor y encontrá la jugada al segundo.' },
  { icon: '⭐', title: 'Mejores momentos', desc: 'Marcá y nombrá tus jugadas favoritas. Quedan ancladas sobre la timeline para siempre.' },
  { icon: '🔁', title: 'Repeticiones', desc: 'Replay de -10s con un click, cámara lenta a 0.25x o acelerá hasta 8x.' },
  { icon: '🔗', title: 'Compartir jugadas', desc: 'Generá un enlace privado y con vencimiento para mandarle tu golazo a quien quieras.' },
  { icon: '🔒', title: 'Privado y seguro', desc: 'Solo vos accedés a tus partidos. Nunca se exponen los archivos originales.' },
];

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-ink-950">
      <div
        className="pointer-events-none fixed inset-0 opacity-60"
        style={{
          background:
            'radial-gradient(60% 50% at 50% 0%, rgba(47,154,82,0.20) 0%, rgba(4,18,10,0) 60%), radial-gradient(40% 30% at 85% 15%, rgba(245,158,11,0.10) 0%, rgba(4,18,10,0) 60%)',
        }}
      />

      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <LogoMark className="h-9 w-9 shrink-0 shadow-glow" />
          <span className="text-lg font-bold tracking-tight text-white">
            Live<span className="text-pitch-400">Play</span>
          </span>
        </div>
        <nav className="hidden items-center gap-8 text-sm text-ink-300 md:flex">
          <a href="#buscar" className="hover:text-white">Buscar mi partido</a>
          <a href="#deportes" className="hover:text-white">Deportes</a>
          <a href="#funciones" className="hover:text-white">Funciones</a>
          <a href="#reproductor" className="hover:text-white">Reproductor</a>
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/login" className="btn-secondary !px-4 !py-2 text-sm">Iniciar sesión</Link>
          <Link href="/register" className="btn-primary !px-4 !py-2 text-sm">Registrarme</Link>
        </div>
      </header>

      <section className="relative z-10 mx-auto flex max-w-4xl flex-col items-center px-6 pb-20 pt-16 text-center sm:pt-24">
        <span className="badge border border-pitch-500/40 bg-pitch-500/10 text-pitch-400">Jugá. Grabá. Reviví.</span>
        <h1 className="mt-6 text-4xl font-black tracking-tight text-white sm:text-6xl">
          REVIVÍ <span className="text-pitch-400">CADA PARTIDO</span>
        </h1>
        <p className="mt-5 max-w-xl text-balance text-lg text-ink-300">
          Guardamos tus partidos de Fútbol 5 y Pádel para que puedas volver a vivir cada jugada, desde el celular o la computadora.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Link href="/login" className="btn-primary px-7 py-3 text-base">Iniciar sesión</Link>
          <Link href="/register" className="btn-secondary px-7 py-3 text-base">Registrarme</Link>
        </div>
        {/* Credenciales de la demo — quitar en producción */}
        <p className="mt-4 text-xs text-ink-400">Demo: juan@demo.com · contraseña demo1234</p>
      </section>

      <section id="buscar" className="relative z-10 mx-auto max-w-4xl px-6 pb-20">
        <div className="mx-auto mb-8 max-w-2xl text-center">
          <h2 className="text-2xl font-bold text-white sm:text-3xl">Buscá tu partido, sin necesidad de cuenta</h2>
          <p className="mt-2 text-ink-300">
            Elegí tu deporte, tu ciudad y la cancha donde jugaste — cada cancha tiene su propia cámara IP grabando. Para ver el video hace falta iniciar sesión y haber participado del partido.
          </p>
        </div>
        <CourtExplorer />
      </section>

      <section id="reproductor" className="relative z-10 mx-auto max-w-5xl px-6 pb-20">
        <div className="card overflow-hidden shadow-2xl">
          <div className="flex aspect-video items-center justify-center bg-gradient-to-br from-ink-800 to-ink-950">
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-white/10 text-3xl">▶</div>
              <p className="text-sm text-ink-300">Fútbol 5 · Cancha 3 · Deportivo San Martín</p>
            </div>
          </div>
          <div className="flex flex-col gap-3 border-t border-ink-700/60 bg-ink-900/80 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3 text-ink-300">
              <span>▶</span><span>🔊</span><span className="rounded bg-ink-700 px-2 py-0.5 text-xs">1x</span><span>⛶</span>
            </div>
            <div className="h-1.5 flex-1 rounded-full bg-ink-700 sm:mx-6">
              <div className="h-1.5 w-1/3 rounded-full bg-pitch-400" />
            </div>
            <div className="flex items-center gap-2 text-xs text-ink-400">
              <span>21:00</span><span>—</span><span>22:00</span>
            </div>
          </div>
        </div>
      </section>

      <section id="deportes" className="relative z-10 mx-auto max-w-6xl px-6 pb-8">
        <h2 className="text-center text-2xl font-bold text-white">Un sistema, dos deportes</h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div className="card p-6">
            <div className="mb-2 text-3xl">⚽</div>
            <h3 className="text-lg font-semibold text-white">Fútbol 5</h3>
            <p className="mt-2 text-sm text-ink-300">Equipo Azul vs. Equipo Rojo, goles, tarjetas y jugadas destacadas ancladas al video.</p>
          </div>
          <div className="card p-6">
            <div className="mb-2 text-3xl">🎾</div>
            <h3 className="text-lg font-semibold text-white">Pádel</h3>
            <p className="mt-2 text-sm text-ink-300">Pareja A vs. Pareja B, sets y resultado final — 6-4 / 4-6 / 10-8.</p>
          </div>
        </div>
      </section>

      <section id="funciones" className="relative z-10 mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-center text-2xl font-bold text-white">Todo lo que necesitás para revivir tu partido</h2>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="card p-5">
              <div className="mb-3 text-2xl">{f.icon}</div>
              <h3 className="font-semibold text-white">{f.title}</h3>
              <p className="mt-1.5 text-sm text-ink-300">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="relative z-10 border-t border-ink-800 py-10 text-center text-sm text-ink-400">
        © {new Date().getFullYear()} LivePlay — Plataforma de video para complejos deportivos.
      </footer>
    </main>
  );
}
