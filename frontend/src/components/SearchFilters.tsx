'use client';

import clsx from 'clsx';

export interface Filters {
  datePreset?: 'today' | 'yesterday' | 'week' | '';
  sportType?: 'FUTBOL5' | 'PADEL' | '';
  courtId?: string;
  timeFrom?: string;
  timeTo?: string;
}

interface CourtOption {
  id: string;
  name: string;
  sportType?: string;
}

const DATE_PRESETS: { value: Filters['datePreset']; label: string }[] = [
  { value: '', label: 'Todas' },
  { value: 'today', label: 'Hoy' },
  { value: 'yesterday', label: 'Ayer' },
  { value: 'week', label: 'Esta semana' },
];

// El selector de "Complejo" vivía acá antes (2026-10-22): se sacó porque ahora el complejo se
// elige una sola vez en el gate de `/dashboard` (`ComplexGate`) y queda fijo — este componente
// ya solo filtra DENTRO de ese complejo (deporte, cancha, horario, fecha). Ver DashboardPage.
export default function SearchFilters({
  filters,
  onChange,
  courts,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  courts: CourtOption[];
}) {
  function update(patch: Partial<Filters>) {
    onChange({ ...filters, ...patch });
  }

  // Al cambiar de deporte, la cancha elegida antes puede dejar de pertenecer a ese deporte.
  function onSportTypeChange(sportType: Filters['sportType']) {
    update({ sportType, courtId: '' });
  }

  const courtsForSport = sportTypeFilter(courts, filters.sportType);

  return (
    <div className="card space-y-5 p-5">
      <div>
        <label className="label-field">Fecha</label>
        {/* Se sacaron "Fecha específica" y "Rango de fechas" (además de "Este mes"): con los
            partidos disponibles solo 1 semana (ver MatchesService.search), esas opciones ya no
            aportaban nada útil y en mobile hacían que el filtro se viera muy apretado. */}
        <div className="flex flex-wrap gap-2">
          {DATE_PRESETS.map((p) => (
            <button
              key={p.value}
              onClick={() => update({ datePreset: p.value })}
              className={clsx(
                'rounded-full px-3.5 py-1.5 text-sm font-medium transition',
                filters.datePreset === p.value ? 'bg-pitch-500 text-white' : 'bg-ink-800 text-ink-300 hover:bg-ink-700',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className="label-field">Deporte</label>
          <select value={filters.sportType ?? ''} onChange={(e) => onSportTypeChange(e.target.value as Filters['sportType'])} className="input-field">
            <option value="">Todos</option>
            <option value="FUTBOL5">Fútbol 5</option>
            <option value="PADEL">Pádel</option>
          </select>
        </div>
        {courtsForSport.length > 1 && (
          <div>
            <label className="label-field">Cancha</label>
            <select value={filters.courtId ?? ''} onChange={(e) => update({ courtId: e.target.value })} className="input-field">
              <option value="">Todas</option>
              {courtsForSport.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="label-field">Horario</label>
          <div className="flex items-center gap-2">
            <input type="time" value={filters.timeFrom ?? ''} onChange={(e) => update({ timeFrom: e.target.value })} className="input-field" />
            <span className="text-ink-400">a</span>
            <input type="time" value={filters.timeTo ?? ''} onChange={(e) => update({ timeTo: e.target.value })} className="input-field" />
          </div>
        </div>
      </div>
    </div>
  );
}

function sportTypeFilter(courts: CourtOption[], sportType: Filters['sportType']): CourtOption[] {
  if (!sportType) return courts;
  return courts.filter((c) => c.sportType === sportType);
}
