'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { Match, Complex } from '@/types';
import MatchCard from '@/components/MatchCard';
import SearchFilters, { Filters } from '@/components/SearchFilters';
import ComplexGate, { SelectedComplex } from '@/components/ComplexGate';

const DEFAULT_FILTERS: Filters = { datePreset: '' };

/**
 * "Mis partidos" (2026-10-22, pedido del cliente): antes arrancaba con el filtro "Complejo:
 * Todos" y mostraba de una las miniaturas de TODOS los complejos/ciudades — confuso para un
 * jugador que siempre juega en el mismo lugar, y de paso exponía partidos de complejos ajenos
 * sin que el usuario pidiera verlos. Ahora, hasta que el usuario no elige ciudad + complejo (acá
 * o antes, guardado como su "cancha habitual"), no se pide ni se muestra ningún partido.
 *
 * La elección se guarda en `users.homeComplexId` (campo que ya existía en el schema desde el
 * registro, pero no se usaba para nada hasta ahora) en vez de localStorage: así es la cuenta, no
 * el navegador, la que recuerda la cancha — si el usuario entra desde el celu y la compu ve lo
 * mismo en los dos. "Cambiar cancha" vuelve a mostrar el selector sin borrar todavía la cancha
 * guardada (por si el usuario se arrepiente y no termina de elegir una nueva).
 */
export default function DashboardPage() {
  const { user, updateUser } = useAuthStore();

  const [homeComplexId, setHomeComplexId] = useState<string | null>(user?.homeComplexId ?? null);
  const [showGate, setShowGate] = useState(!user?.homeComplexId);
  const [savingComplex, setSavingComplex] = useState(false);

  const [complex, setComplex] = useState<Complex | null>(null);
  const [complexError, setComplexError] = useState<string | null>(null);

  const [matches, setMatches] = useState<Match[] | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [error, setError] = useState<string | null>(null);

  // Detalle del complejo elegido (trae las canchas anidadas para el filtro de "Cancha").
  useEffect(() => {
    if (!homeComplexId) {
      setComplex(null);
      return;
    }
    let cancelled = false;
    setComplexError(null);
    api
      .get<Complex>(`/complexes/${homeComplexId}`)
      .then((data) => !cancelled && setComplex(data))
      .catch(() => !cancelled && setComplexError('No pudimos cargar los datos de tu complejo.'));
    return () => {
      cancelled = true;
    };
  }, [homeComplexId]);

  const queryString = useMemo(() => {
    if (!homeComplexId) return null;
    const params = new URLSearchParams();
    params.set('complexId', homeComplexId);
    if (filters.datePreset) params.set('datePreset', filters.datePreset);
    if (filters.sportType) params.set('sportType', filters.sportType);
    if (filters.courtId) params.set('courtId', filters.courtId);
    if (filters.timeFrom) params.set('timeFrom', filters.timeFrom);
    if (filters.timeTo) params.set('timeTo', filters.timeTo);
    return params.toString();
  }, [homeComplexId, filters]);

  useEffect(() => {
    if (queryString === null) {
      setMatches(null);
      return;
    }
    let cancelled = false;
    setError(null);
    api
      .get<Match[]>(`/matches?${queryString}`)
      .then((data) => !cancelled && setMatches(data))
      .catch(() => !cancelled && setError('No pudimos cargar tus partidos.'));
    return () => {
      cancelled = true;
    };
  }, [queryString]);

  async function handleSelectComplex(selected: SelectedComplex) {
    setSavingComplex(true);
    try {
      await api.patch('/users/me', { homeComplexId: selected.id });
      updateUser({ homeComplexId: selected.id });
      setFilters(DEFAULT_FILTERS);
      setHomeComplexId(selected.id);
      setShowGate(false);
    } catch {
      setComplexError('No pudimos guardar tu complejo. Probá de nuevo.');
    } finally {
      setSavingComplex(false);
    }
  }

  if (showGate) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">Mis partidos</h1>
          <p className="text-sm text-ink-400">Elegí tu cancha habitual para ver los partidos grabados ahí.</p>
        </div>
        <ComplexGate onSelect={handleSelectComplex} saving={savingComplex} />
        {homeComplexId && (
          <button onClick={() => setShowGate(false)} className="mt-4 text-sm text-ink-400 hover:text-white">
            ← Volver a {complex?.name ?? 'mi complejo'}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Mis partidos</h1>
          <p className="text-sm text-ink-400">
            📍 {complex ? (
              <>
                {complex.city ? `${complex.city} · ` : ''}
                {complex.name}
              </>
            ) : (
              'Cargando tu complejo...'
            )}
          </p>
        </div>
        <button onClick={() => setShowGate(true)} className="shrink-0 text-sm font-medium text-pitch-400 hover:text-pitch-300">
          Cambiar cancha
        </button>
      </div>

      {complexError && <p className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">{complexError}</p>}

      <div className="mb-6">
        <SearchFilters filters={filters} onChange={setFilters} courts={complex?.courts ?? []} />
      </div>

      {error && <p className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>}

      {matches === null && !error && (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card aspect-[4/5] animate-pulse bg-ink-800/50" />
          ))}
        </div>
      )}

      {matches && matches.length === 0 && (
        <div className="card flex flex-col items-center justify-center gap-2 py-16 text-center">
          <span className="text-4xl">🔍</span>
          <p className="font-medium text-white">No encontramos partidos con esos filtros</p>
          <p className="text-sm text-ink-400">Probá cambiar la fecha o el deporte.</p>
        </div>
      )}

      {matches && matches.length > 0 && (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {matches.map((m) => (
            <MatchCard key={m.id} match={m} />
          ))}
        </div>
      )}
    </div>
  );
}
