'use client';

import clsx from 'clsx';

export interface Filters {
  datePreset?: 'today' | 'yesterday' | 'week' | '';
  sportType?: 'FUTBOL5' | 'PADEL' | '';
  complexId?: string;
  courtId?: string;
  timeFrom?: string;
  timeTo?: string;
}

interface ComplexOption {
  id: string;
  name: string;
  courts?: { id: string; name: string }[];
}

const DATE_PRESETS: { value: Filters['datePreset']; label: string }[] = [
  { value: '', label: 'Todas' },
  { value: 'today', label: 'Hoy' },
  { value: 'yesterday', label: 'Ayer' },
  { value: 'week', label: 'Esta semana' },
];

export default function SearchFilters({
  filters,
  onChange,
  complexes,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  complexes: ComplexOption[];
}) {
  function update(patch: Partial<Filters>) {
    onChange({ ...filters, ...patch });
  }

  // Al cambiar de deporte, la lista de complejos/canchas que llega por props cambia (se
  // vuelve a pedir filtrada por deporte), así que la cancha/complejo elegidos antes ya no
  // tienen por qué seguir siendo válidos.
  function onSportTypeChange(sportType: Filters['sportType']) {
    update({ sportType, complexId: '', courtId: '' });
  }

  const selectedComplex = complexes.find((c) => c.id === filters.complexId);
  const courtsOfComplex = selectedComplex?.courts ?? [];

  // Si el complejo elegido tiene una sola cancha, se usa esa directamente sin pedirle al
  // usuario que elija — el select de "Cancha" solo aparece cuando hay más de una.
  function onComplexChange(complexId: string) {
    const complex = complexes.find((c) => c.id === complexId);
    const onlyCourtId = complex?.courts?.length === 1 ? complex.courts[0].id : '';
    update({ complexId, courtId: onlyCourtId });
  }

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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label-field">Deporte</label>
          <select value={filters.sportType ?? ''} onChange={(e) => onSportTypeChange(e.target.value as Filters['sportType'])} className="input-field">
            <option value="">Todos</option>
            <option value="FUTBOL5">Fútbol 5</option>
            <option value="PADEL">Pádel</option>
          </select>
        </div>
        <div>
          <label className="label-field">Complejo</label>
          <select value={filters.complexId ?? ''} onChange={(e) => onComplexChange(e.target.value)} className="input-field">
            <option value="">Todos</option>
            {complexes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        {courtsOfComplex.length > 1 && (
          <div>
            <label className="label-field">Cancha</label>
            <select value={filters.courtId ?? ''} onChange={(e) => update({ courtId: e.target.value })} className="input-field">
              <option value="">Todas</option>
              {courtsOfComplex.map((c) => (
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
