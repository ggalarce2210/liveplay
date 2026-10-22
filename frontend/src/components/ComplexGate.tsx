'use client';

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { Complex } from '@/types';

type Step = 'city' | 'complex';

export interface SelectedComplex {
  id: string;
  name: string;
  city: string | null;
}

/**
 * Selector "ciudad → complejo" que se muestra en "Mis partidos" (`/dashboard`) para elegir una
 * cancha favorita — pedido del cliente (2026-10-22): antes el dashboard arrancaba mostrando los
 * partidos de TODOS los complejos (filtro "Complejo: Todos" por default), lo cual no tiene
 * sentido para un jugador que siempre juega en el mismo lugar y confunde además al mostrar
 * partidos de complejos/ciudades ajenas. Mismo patrón de 2 pasos que ya usa el buscador público
 * (`CourtExplorer`, pasos "ciudad" → "cancha"), pero sin los pasos de deporte/fecha: acá el
 * deporte se sigue filtrando después, ya adentro de los complejos favoritos elegidos, con
 * `SearchFilters`.
 *
 * Este mismo componente sirve para dos casos (2026-10-22, segunda vuelta: "deberiamos poner un
 * agregar como favorito" — un jugador puede tener más de un complejo favorito, ej. uno de
 * Fútbol 5 y otro de Pádel, y "Mis partidos" busca en todos a la vez):
 *   1. Elegir la PRIMERA cancha favorita (obligatorio, sin `onCancel` — no hay nada que cancelar
 *      porque todavía no hay ningún favorito).
 *   2. Agregar OTRA cancha favorita a una lista que ya tiene al menos una (`onCancel` presente,
 *      y `excludeComplexIds` para no mostrar de nuevo un complejo que ya es favorito).
 */
export default function ComplexGate({
  onSelect,
  onCancel,
  excludeComplexIds,
  saving,
}: {
  onSelect: (complex: SelectedComplex) => void;
  /** Si viene, se muestra un link para cerrar el selector sin elegir nada (caso "agregar otra
   * cancha" con al menos un favorito ya guardado). */
  onCancel?: () => void;
  /** Ids de complejos a ocultar en el paso 2 (los que ya son favoritos) — evita que el usuario
   * "elija" de nuevo uno que ya tiene y no vea pasar nada. */
  excludeComplexIds?: string[];
  saving?: boolean;
}) {
  const [step, setStep] = useState<Step>('city');
  const [cities, setCities] = useState<string[] | null>(null);
  const [citySearch, setCitySearch] = useState('');
  const [city, setCity] = useState<string | null>(null);
  const [complexes, setComplexes] = useState<Complex[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<string[]>('/complexes/cities')
      .then((data) => !cancelled && setCities(data))
      .catch(() => !cancelled && setCities([]));
    return () => {
      cancelled = true;
    };
  }, []);

  function chooseCity(c: string) {
    setCity(c);
    setComplexes(null);
    setError(null);
    setStep('complex');
  }

  useEffect(() => {
    if (step !== 'complex' || !city) return;
    let cancelled = false;
    api
      .get<Complex[]>(`/complexes?city=${encodeURIComponent(city)}`)
      .then((data) => !cancelled && setComplexes(data))
      .catch(() => !cancelled && setComplexes([]));
    return () => {
      cancelled = true;
    };
  }, [step, city]);

  const filteredCities = useMemo(() => {
    if (!cities) return null;
    if (!citySearch.trim()) return cities;
    const q = citySearch.trim().toLowerCase();
    return cities.filter((c) => c.toLowerCase().includes(q));
  }, [cities, citySearch]);

  const visibleComplexes = useMemo(() => {
    if (!complexes) return complexes;
    if (!excludeComplexIds?.length) return complexes;
    return complexes.filter((c) => !excludeComplexIds.includes(c.id));
  }, [complexes, excludeComplexIds]);

  function chooseComplex(c: Complex) {
    setError(null);
    onSelect({ id: c.id, name: c.name, city: c.city ?? city ?? null });
  }

  return (
    <div className="card p-6 sm:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-400">
          <Crumb active={step === 'city'} onClick={() => setStep('city')}>
            1. Ciudad{city ? `: ${city}` : ''}
          </Crumb>
          {city && (
            <>
              <span>›</span>
              <Crumb active={step === 'complex'} onClick={() => setStep('complex')}>
                2. Complejo
              </Crumb>
            </>
          )}
        </div>
        {onCancel && (
          <button onClick={onCancel} className="text-sm text-ink-400 hover:text-white">
            ✕ Cancelar
          </button>
        )}
      </div>

      {step === 'city' && (
        <div>
          <h2 className="text-xl font-bold text-white">¿En qué ciudad jugás?</h2>
          <p className="mt-1 text-sm text-ink-400">Elegí la ciudad de tu cancha para ver sus partidos grabados.</p>
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
              <p className="text-sm text-ink-400">No encontramos ciudades con complejos cargados todavía.</p>
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

      {step === 'complex' && city && (
        <div>
          <h2 className="text-xl font-bold text-white">Elegí tu complejo en {city}</h2>
          <p className="mt-1 text-sm text-ink-400">A partir de acá vas a ver los partidos grabados en ese complejo.</p>

          {complexes === null && <p className="mt-5 text-sm text-ink-400">Buscando complejos...</p>}
          {complexes !== null && complexes.length === 0 && (
            <p className="mt-5 text-sm text-ink-400">Todavía no hay complejos cargados en {city}.</p>
          )}
          {complexes !== null && complexes.length > 0 && visibleComplexes?.length === 0 && (
            <p className="mt-5 text-sm text-ink-400">Ya tenés como favoritos todos los complejos de {city}.</p>
          )}

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {visibleComplexes?.map((cx) => (
              <button
                key={cx.id}
                disabled={saving}
                onClick={() => chooseComplex(cx)}
                className="rounded-xl border border-ink-700/60 p-4 text-left transition hover:border-pitch-500/60 hover:bg-ink-800/60 disabled:opacity-60"
              >
                <h3 className="font-semibold text-white">{cx.name}</h3>
                {cx.address && <p className="mt-1 text-xs text-ink-400">{cx.address}</p>}
                <p className="mt-2 text-xs text-ink-500">{(cx.courts?.length ?? 0)} cancha{(cx.courts?.length ?? 0) === 1 ? '' : 's'}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <p className="mt-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>}
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
