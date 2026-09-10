'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { Complex, Court, PublicMatchSummary, SportType } from '@/types';
import { formatDate, formatTime } from '@/lib/format';

type Step = 'sport' | 'city' | 'court' | 'matches';

type DatePreset = 'today' | 'yesterday' | 'week' | 'month' | '';

const SPORTS: { value: SportType; label: string; icon: string; desc: string }[] = [
  { value: 'FUTBOL5', label: 'Fútbol 5', icon: '⚽', desc: 'Encontrá tu cancha y tu partido grabado.' },
  { value: 'PADEL', label: 'Pádel', icon: '🎾', desc: 'Encontrá tu cancha y tu partido grabado.' },
];

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'today', label: 'Hoy' },
  { value: 'yesterday', label: 'Ayer' },
  { value: 'week', label: 'Esta semana' },
  { value: 'month', label: 'Este mes' },
];

/**
 * Buscador público "deporte → ciudad → cancha → fecha" (§5.1) para la landing: pensado para que
 * cualquier visitante (logueado o no) encuentre la cancha de su complejo y revise qué partidos
 * hay grabados ahí, sin depender de tener ya una cuenta. Mirar un partido puntual (`/matches/:id`)
 * sigue exigiendo login y ser parte de ese partido — este componente solo navega hasta ahí.
 */
export default function CourtExplorer() {
  const [step, setStep] = useState<Step>('sport');

  const [sportType, setSportType] = useState<SportType | null>(null);

  const [cities, setCities] = useState<string[] | null>(null);
  const [citySearch, setCitySearch] = useState('');
  const [city, setCity] = useState<string | null>(null);

  const [complexes, setComplexes] = useState<Complex[] | null>(null);
  const [court, setCourt] = useState<Court | null>(null);
  const [complexOfCourt, setComplexOfCourt] = useState<Complex | null>(null);

  const [datePreset, setDatePreset] = useState<DatePreset>('today');
  const [customDate, setCustomDate] = useState('');
  const [matches, setMatches] = useState<PublicMatchSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function chooseSport(sport: SportType) {
    setSportType(sport);
    setCity(null);
    setCitySearch('');
    setCities(null);
    setStep('city');
  }

  useEffect(() => {
    if (step !== 'city' || !sportType) return;
    let cancelled = false;
    api
      .get<string[]>(`/complexes/cities?sportType=${sportType}`)
      .then((data) => !cancelled && setCities(data))
      .catch(() => !cancelled && setCities([]));
    return () => {
      cancelled = true;
    };
  }, [step, sportType]);

  function chooseCity(c: string) {
    setCity(c);
    setComplexes(null);
    setStep('court');
  }

  useEffect(() => {
    if (step !== 'court' || !sportType || !city) return;
    let cancelled = false;
    api
      .get<Complex[]>(`/complexes?city=${encodeURIComponent(city)}&sportType=${sportType}`)
      .then((data) => !cancelled && setComplexes(data))
      .catch(() => !cancelled && setComplexes([]));
    return () => {
      cancelled = true;
    };
  }, [step, sportType, city]);

  function chooseCourt(c: Court, complex: Complex) {
    setCourt(c);
    setComplexOfCourt(complex);
    setDatePreset('today');
    setCustomDate('');
    setStep('matches');
  }

  const matchesQuery = useMemo(() => {
    if (!court) return null;
    const params = new URLSearchParams({ courtId: court.id });
    if (customDate) params.set('date', customDate);
    else if (datePreset) params.set('datePreset', datePreset);
    return params.toString();
  }, [court, datePreset, customDate]);

  useEffect(() => {
    if (step !== 'matches' || !matchesQuery) return;
    let cancelled = false;
    setError(null);
    setMatches(null);
    api
      .get<PublicMatchSummary[]>(`/discovery/matches?${matchesQuery}`)
      .then((data) => !cancelled && setMatches(data))
      .catch(() => !cancelled && setError('No pudimos cargar los partidos de esta cancha.'));
    return () => {
      cancelled = true;
    };
  }, [step, matchesQuery]);

  const filteredCities = useMemo(() => {
    if (!cities) return null;
    if (!citySearch.trim()) return cities;
    const q = citySearch.trim().toLowerCase();
    return cities.filter((c) => c.toLowerCase().includes(q));
  }, [cities, citySearch]);

  return (
    <div className="card p-6 sm:p-8">
      {/* Breadcrumb / navegación entre pasos */}
      <div className="mb-6 flex flex-wrap items-center gap-2 text-sm text-ink-400">
        <Crumb active={step === 'sport'} onClick={() => setStep('sport')}>
          1. Deporte{sportType ? `: ${sportType === 'FUTBOL5' ? 'Fútbol 5' : 'Pádel'}` : ''}
        </Crumb>
        {sportType && (
          <>
            <span>›</span>
            <Crumb active={step === 'city'} onClick={() => setStep('city')}>
              2. Ciudad{city ? `: ${city}` : ''}
            </Crumb>
          </>
        )}
        {city && (
          <>
            <span>›</span>
            <Crumb active={step === 'court'} onClick={() => setStep('court')}>
              3. Cancha{court ? `: ${court.name}` : ''}
            </Crumb>
          </>
        )}
        {court && (
          <>
            <span>›</span>
            <Crumb active={step === 'matches'} onClick={() => setStep('matches')}>
              4. Partidos
            </Crumb>
          </>
        )}
      </div>

      {step === 'sport' && (
        <div>
          <h2 className="text-xl font-bold text-white">¿Qué deporte jugaste?</h2>
          <p className="mt-1 text-sm text-ink-400">Elegí tu deporte para buscar tu cancha y tu partido.</p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {SPORTS.map((s) => (
              <button
                key={s.value}
                onClick={() => chooseSport(s.value)}
                className="card flex flex-col items-center gap-2 border-ink-700 p-8 text-center transition hover:border-pitch-500/60 hover:bg-ink-800/60"
              >
                <span className="text-5xl">{s.icon}</span>
                <span className="text-lg font-semibold text-white">{s.label}</span>
                <span className="text-sm text-ink-400">{s.desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 'city' && sportType && (
        <div>
          <h2 className="text-xl font-bold text-white">¿En qué ciudad?</h2>
          <p className="mt-1 text-sm text-ink-400">Buscá la ciudad donde está tu cancha de {sportType === 'FUTBOL5' ? 'Fútbol 5' : 'Pádel'}.</p>
          <input
            type="text"
            value={citySearch}
            onChange={(e) => setCitySearch(e.target.value)}
            placeholder="Escribí tu ciudad..."
            className="input-field mt-4 max-w-sm"
          />

          <div className="mt-5">
            {cities === null && <p className="text-sm text-ink-400">Buscando ciudades...</p>}
            {cities !== null && filteredCities?.length === 0 && (
              <p className="text-sm text-ink-400">No encontramos ciudades con canchas de este deporte todavía.</p>
            )}
            <div className="flex flex-wrap gap-2">
              {filteredCities?.map((c) => (
                <button
                  key={c}
                  onClick={() => chooseCity(c)}
                  className={clsx(
                    'rounded-full px-4 py-2 text-sm font-medium transition',
                    city === c ? 'bg-pitch-500 text-white' : 'bg-ink-800 text-ink-200 hover:bg-ink-700',
                  )}
                >
                  📍 {c}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === 'court' && sportType && city && (
        <div>
          <h2 className="text-xl font-bold text-white">Elegí tu cancha en {city}</h2>
          <p className="mt-1 text-sm text-ink-400">Cada cancha tiene su propia cámara IP grabando los partidos.</p>

          {complexes === null && <p className="mt-5 text-sm text-ink-400">Buscando complejos...</p>}
          {complexes !== null && complexes.length === 0 && (
            <p className="mt-5 text-sm text-ink-400">Todavía no hay complejos de {sportType === 'FUTBOL5' ? 'Fútbol 5' : 'Pádel'} cargados en {city}.</p>
          )}

          <div className="mt-5 space-y-4">
            {complexes?.map((cx) => (
              <div key={cx.id} className="rounded-xl border border-ink-700/60 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-white">{cx.name}</h3>
                    {cx.address && <p className="text-xs text-ink-400">{cx.address}</p>}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(cx.courts ?? []).map((ct) => (
                    <button
                      key={ct.id}
                      onClick={() => chooseCourt(ct, cx)}
                      className="rounded-lg bg-ink-800 px-3.5 py-2 text-sm font-medium text-ink-200 transition hover:bg-pitch-500 hover:text-white"
                    >
                      🎥 {ct.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 'matches' && court && (
        <div>
          <h2 className="text-xl font-bold text-white">
            {court.name} — {complexOfCourt?.name}
          </h2>
          <p className="mt-1 text-sm text-ink-400">Buscá el día y encontrá tu partido grabado.</p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {DATE_PRESETS.map((p) => (
              <button
                key={p.value}
                onClick={() => {
                  setDatePreset(p.value);
                  setCustomDate('');
                }}
                className={clsx(
                  'rounded-full px-3.5 py-1.5 text-sm font-medium transition',
                  !customDate && datePreset === p.value ? 'bg-pitch-500 text-white' : 'bg-ink-800 text-ink-300 hover:bg-ink-700',
                )}
              >
                {p.label}
              </button>
            ))}
            <input
              type="date"
              value={customDate}
              onChange={(e) => {
                setCustomDate(e.target.value);
                setDatePreset('');
              }}
              className="input-field !w-auto"
            />
          </div>

          <div className="mt-6">
            {error && <p className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>}
            {!error && matches === null && (
              <div className="grid gap-4 sm:grid-cols-2">
                {[1, 2].map((i) => (
                  <div key={i} className="h-24 animate-pulse rounded-xl bg-ink-800/50" />
                ))}
              </div>
            )}
            {!error && matches !== null && matches.length === 0 && (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-ink-700/60 py-12 text-center">
                <span className="text-3xl">🔍</span>
                <p className="font-medium text-white">No encontramos partidos con esos filtros</p>
                <p className="text-sm text-ink-400">Probá otro día — cada cancha graba automáticamente con su cámara IP.</p>
              </div>
            )}
            {!error && matches && matches.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-2">
                {matches.map((m) => (
                  <PublicMatchTile key={m.id} match={m} />
                ))}
              </div>
            )}
          </div>

          <p className="mt-6 text-xs text-ink-500">
            ¿Es tu partido? Iniciá sesión para verlo — solo lo pueden reproducir los jugadores que participaron.
          </p>
        </div>
      )}
    </div>
  );
}

function Crumb({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={clsx('rounded px-1.5 py-0.5 transition hover:text-white', active && 'font-semibold text-pitch-400')}>
      {children}
    </button>
  );
}

function PublicMatchTile({ match }: { match: PublicMatchSummary }) {
  const teamsLine = match.teams.length === 2 ? `${match.teams[0].label} vs. ${match.teams[1].label}` : null;
  return (
    <Link
      href={`/matches/${match.id}`}
      className="flex items-center justify-between rounded-xl border border-ink-700/60 p-4 transition hover:border-pitch-500/60 hover:bg-ink-800/40"
    >
      <div>
        <p className="text-sm text-ink-300">
          📅 {formatDate(match.date)} · ⏰ {formatTime(match.startTime)}
        </p>
        {teamsLine && <p className="mt-1 font-medium text-white">{teamsLine}</p>}
      </div>
      <span className={clsx('badge', match.hasVideo ? 'bg-pitch-500/20 text-pitch-400' : 'bg-ink-700 text-ink-300')}>
        {match.hasVideo ? '▶ Ver' : 'Sin video aún'}
      </span>
    </Link>
  );
}
