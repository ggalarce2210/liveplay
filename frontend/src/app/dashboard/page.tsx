'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { Match, Complex } from '@/types';
import MatchCard from '@/components/MatchCard';
import SearchFilters, { Filters } from '@/components/SearchFilters';
import ComplexGate, { SelectedComplex } from '@/components/ComplexGate';

const DEFAULT_FILTERS: Filters = { datePreset: '' };

/**
 * "Mis partidos" (2026-10-22, pedido del cliente): antes arrancaba con el filtro "Complejo:
 * Todos" y mostraba de una las miniaturas de TODOS los complejos/ciudades — confuso para un
 * jugador que siempre juega en el mismo lugar, y de paso exponía partidos de complejos ajenos
 * sin que el usuario pidiera verlos. Ahora, hasta que el usuario no elige ciudad + complejo, no
 * se pide ni se muestra ningún partido.
 *
 * Segunda vuelta, misma fecha (pedido del cliente: "si en el filtro pongo padel me dice que no
 * hay nada.. si apreto cambiar cancha ahi recien la encuentro... deberiamos poner un agregar
 * como favorito"): la primera versión de este gate guardaba UN solo complejo fijo
 * (`users.homeComplexId`) — un jugador que juega Fútbol 5 en un complejo y Pádel en otro nunca
 * encontraba el segundo deporte salvo que tocara "Cambiar cancha" para saltar al otro complejo a
 * mano. Se reemplazó por una lista de canchas FAVORITAS (`GET/POST/DELETE
 * /users/me/favorite-complexes`, ver `UsersService` en el backend): "Mis partidos" busca en
 * TODOS los complejos favoritos a la vez, así el filtro de deporte encuentra el partido sin
 * importar en cuál de ellos quedó grabado. "Cambiar cancha" pasó a ser "+ Agregar cancha" (suma
 * un favorito más, no reemplaza el actual) + un botón "✕" por favorito para sacarlo de la lista.
 */
export default function DashboardPage() {
  const [favorites, setFavorites] = useState<Complex[] | null>(null);
  const [showAddGate, setShowAddGate] = useState(false);
  const [savingComplex, setSavingComplex] = useState(false);
  const [complexError, setComplexError] = useState<string | null>(null);

  const [matches, setMatches] = useState<Match[] | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [error, setError] = useState<string | null>(null);

  // Carga las canchas favoritas del usuario (ya vienen con sus canchas anidadas, para el filtro
  // de "Cancha"/"Deporte" de SearchFilters, sin otra ida y vuelta).
  useEffect(() => {
    let cancelled = false;
    api
      .get<Complex[]>('/users/me/favorite-complexes')
      .then((data) => !cancelled && setFavorites(data))
      .catch(() => !cancelled && setFavorites([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const queryString = useMemo(() => {
    if (!favorites || favorites.length === 0) return null;
    const params = new URLSearchParams();
    params.set('complexIds', favorites.map((f) => f.id).join(','));
    if (filters.datePreset) params.set('datePreset', filters.datePreset);
    if (filters.sportType) params.set('sportType', filters.sportType);
    if (filters.courtId) params.set('courtId', filters.courtId);
    if (filters.timeFrom) params.set('timeFrom', filters.timeFrom);
    if (filters.timeTo) params.set('timeTo', filters.timeTo);
    return params.toString();
  }, [favorites, filters]);

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

  // Deporte/cancha de TODOS los favoritos juntos (no solo del primero) — con más de un favorito,
  // se antepone el nombre del complejo a cada cancha en el desplegable, para no confundir dos
  // canchas que se llamen igual en complejos distintos (ver SearchFilters).
  const courtOptions = useMemo(() => {
    if (!favorites) return [];
    const multiple = favorites.length > 1;
    return favorites.flatMap((f) =>
      (f.courts ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        sportType: c.sportType,
        complexName: multiple ? f.name : undefined,
      })),
    );
  }, [favorites]);

  async function handleAddFavorite(selected: SelectedComplex) {
    setSavingComplex(true);
    setComplexError(null);
    try {
      const updated = await api.post<Complex[]>('/users/me/favorite-complexes', { complexId: selected.id });
      setFavorites(updated);
      setShowAddGate(false);
      setFilters(DEFAULT_FILTERS);
    } catch {
      setComplexError('No pudimos agregar esa cancha a tus favoritos. Probá de nuevo.');
    } finally {
      setSavingComplex(false);
    }
  }

  async function handleRemoveFavorite(complexId: string) {
    if (!window.confirm('¿Quitar esta cancha de tus favoritos?')) return;
    setComplexError(null);
    try {
      const updated = await api.delete<Complex[]>(`/users/me/favorite-complexes/${complexId}`);
      setFavorites(updated);
    } catch {
      setComplexError('No pudimos quitar esa cancha de tus favoritos. Probá de nuevo.');
    }
  }

  // Todavía cargando la lista de favoritos: ni el gate obligatorio ni el dashboard, para no
  // mostrar un parpadeo del gate justo antes de saber si ya hay favoritos guardados.
  if (favorites === null) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card aspect-[4/5] animate-pulse bg-ink-800/50" />
          ))}
        </div>
      </div>
    );
  }

  // Sin ningún favorito todavía: gate obligatorio (sin `onCancel`, no hay nada que cancelar).
  if (favorites.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">Mis partidos</h1>
          <p className="text-sm text-ink-400">Elegí tu cancha habitual para ver los partidos grabados ahí. Después podés agregar más de una.</p>
        </div>
        <ComplexGate onSelect={handleAddFavorite} saving={savingComplex} />
        {complexError && <p className="mt-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">{complexError}</p>}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Mis partidos</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {favorites.map((f) => (
            <span key={f.id} className="badge flex items-center gap-1.5 bg-ink-800 text-ink-200">
              📍 {f.city ? `${f.city} · ` : ''}
              {f.name}
              <button
                onClick={() => handleRemoveFavorite(f.id)}
                title="Quitar de favoritos"
                className="ml-1 text-ink-400 hover:text-red-400"
              >
                ✕
              </button>
            </span>
          ))}
          <button
            onClick={() => setShowAddGate((v) => !v)}
            className="rounded-full border border-dashed border-ink-600 px-3 py-1 text-xs font-medium text-pitch-400 hover:border-pitch-500/60 hover:text-pitch-300"
          >
            + Agregar cancha
          </button>
        </div>
      </div>

      {showAddGate && (
        <div className="mb-6">
          <ComplexGate
            onSelect={handleAddFavorite}
            onCancel={() => setShowAddGate(false)}
            excludeComplexIds={favorites.map((f) => f.id)}
            saving={savingComplex}
          />
        </div>
      )}

      {complexError && <p className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">{complexError}</p>}

      <div className="mb-6">
        <SearchFilters filters={filters} onChange={setFilters} courts={courtOptions} />
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
