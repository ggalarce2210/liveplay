'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { Match, Complex } from '@/types';
import MatchCard from '@/components/MatchCard';
import SearchFilters, { Filters } from '@/components/SearchFilters';

const DEFAULT_FILTERS: Filters = { datePreset: '', useCustomDate: false, useRange: false };

export default function DashboardPage() {
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [complexes, setComplexes] = useState<Complex[]>([]);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [error, setError] = useState<string | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.useCustomDate && filters.date) params.set('date', filters.date);
    else if (filters.useRange) {
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.set('dateTo', filters.dateTo);
    } else if (filters.datePreset) params.set('datePreset', filters.datePreset);

    if (filters.sportType) params.set('sportType', filters.sportType);
    if (filters.complexId) params.set('complexId', filters.complexId);
    if (filters.courtId) params.set('courtId', filters.courtId);
    if (filters.timeFrom) params.set('timeFrom', filters.timeFrom);
    if (filters.timeTo) params.set('timeTo', filters.timeTo);
    return params.toString();
  }, [filters]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .get<Match[]>(`/matches${queryString ? `?${queryString}` : ''}`)
      .then((data) => !cancelled && setMatches(data))
      .catch(() => !cancelled && setError('No pudimos cargar tus partidos.'));
    return () => {
      cancelled = true;
    };
  }, [queryString]);

  // Complejos (con sus canchas ya anidadas) para los selects de "Complejo"/"Cancha" del
  // filtro — se piden aparte de /matches, filtrados por deporte, en vez de deducirlos de los
  // resultados: así el filtro siempre puede elegir cualquier complejo/cancha existente, no
  // solo los que ya tienen partidos cargados en la búsqueda actual.
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (filters.sportType) params.set('sportType', filters.sportType);
    api
      .get<Complex[]>(`/complexes${params.toString() ? `?${params.toString()}` : ''}`)
      .then((data) => !cancelled && setComplexes(data))
      .catch(() => !cancelled && setComplexes([]));
    return () => {
      cancelled = true;
    };
  }, [filters.sportType]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Mis partidos</h1>
          <p className="text-sm text-ink-400">Buscá, filtrá y reproducí tus partidos grabados.</p>
        </div>
      </div>

      <div className="mb-6">
        <SearchFilters filters={filters} onChange={setFilters} complexes={complexes} />
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
