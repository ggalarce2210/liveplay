'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/AppShell';
import { api } from '@/lib/api';
import { formatDate, formatTime, formatDuration, formatBytes } from '@/lib/format';
import type { Match, Video } from '@/types';

type MatchWithVideo = Match & { video: Video };

interface CourtGroup {
  id: string;
  name: string;
  sportType?: string;
  camera?: { id: string; name: string; status: string } | null;
  matches: MatchWithVideo[];
}

interface ComplexGroup {
  id: string;
  name: string;
  courts: CourtGroup[];
}

const STATUS_LABEL: Record<string, string> = {
  READY: 'Listo',
  PROCESSING: 'Procesando',
  PENDING: 'Pendiente',
  FAILED: 'Error',
};

const STATUS_CLASS: Record<string, string> = {
  READY: 'text-pitch-400',
  PROCESSING: 'text-amber-400',
  PENDING: 'text-ink-400',
  FAILED: 'text-red-400',
};

const SPORT_ICON: Record<string, string> = {
  FUTBOL5: '⚽',
  PADEL: '🎾',
};

/**
 * Panel "Videos por complejo y cámara" (2026-10-08, pedido del cliente): hoy con un solo
 * complejo y una sola cámara da lo mismo mirar cualquier lista plana, pero apenas haya varios
 * complejos con varias canchas cada uno, una lista de videos sin agrupar no alcanza para saber
 * de un vistazo a quién pertenece cada uno. Esta pantalla arma el árbol
 * complejo → cancha/cámara → partido del lado del cliente (`GET /admin/videos` ya trae todo
 * embebido, ver AdminService.getAllVideos) y, a diferencia de las listas del dashboard
 * (`/admin`, que solo muestran "los 10 más pesados" o "los que fallaron"), acá entran TODOS los
 * videos alguna vez procesados, para poder ubicar cualquiera sin importar la antigüedad.
 */
export default function AdminVideosPage() {
  const [matches, setMatches] = useState<MatchWithVideo[] | null>(null);
  const [complexFilter, setComplexFilter] = useState<string>('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function load() {
    api.get<MatchWithVideo[]>('/admin/videos').then(setMatches);
  }

  useEffect(() => {
    load();
  }, []);

  async function onDeleteVideo(id: string) {
    if (!confirm('Borrar este video? Esta accion no se puede deshacer - el partido queda sin video.')) return;
    setDeletingId(id);
    try {
      await api.delete(`/videos/${id}`);
      load();
    } catch {
      alert('No se pudo borrar el video.');
    } finally {
      setDeletingId(null);
    }
  }

  const complexOptions = useMemo(() => {
    if (!matches) return [] as { id: string; name: string }[];
    const seen = new Map<string, string>();
    for (const m of matches) {
      const id = m.complex?.id ?? m.complexId;
      if (id) seen.set(id, m.complex?.name ?? 'Complejo desconocido');
    }
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [matches]);

  const groups = useMemo<ComplexGroup[]>(() => {
    if (!matches) return [];
    const filtered = complexFilter ? matches.filter((m) => (m.complex?.id ?? m.complexId) === complexFilter) : matches;

    const complexMap = new Map<string, { id: string; name: string; courts: Map<string, CourtGroup> }>();

    for (const m of filtered) {
      const complexId = m.complex?.id ?? m.complexId;
      const complexName = m.complex?.name ?? 'Complejo desconocido';
      if (!complexMap.has(complexId)) {
        complexMap.set(complexId, { id: complexId, name: complexName, courts: new Map() });
      }
      const complexEntry = complexMap.get(complexId)!;

      const courtId = m.court?.id ?? m.courtId;
      const courtName = m.court?.name ?? 'Cancha desconocida';
      if (!complexEntry.courts.has(courtId)) {
        complexEntry.courts.set(courtId, {
          id: courtId,
          name: courtName,
          sportType: m.court?.sportType,
          camera: m.court?.camera ?? null,
          matches: [],
        });
      }
      complexEntry.courts.get(courtId)!.matches.push(m);
    }

    return Array.from(complexMap.values())
      .map((c) => ({
        id: c.id,
        name: c.name,
        courts: Array.from(c.courts.values())
          .map((court) => ({ ...court, matches: court.matches.slice().sort((a, b) => b.startTime.localeCompare(a.startTime)) }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [matches, complexFilter]);

  const totalVideos = matches?.length ?? 0;

  return (
    <AuthGuard>
      <AppShell>
        <div className="mx-auto max-w-6xl px-6 py-8">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-white">Videos por complejo y cámara</h1>
              <p className="text-sm text-ink-400">
                {totalVideos} video{totalVideos === 1 ? '' : 's'} en total, agrupados por complejo y cancha/cámara.
              </p>
            </div>
            <Link href="/admin" className="btn-secondary">
              ← Panel admin
            </Link>
          </div>

          {complexOptions.length > 1 && (
            <div className="mb-6 flex items-center gap-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-ink-400">Complejo</label>
              <select
                value={complexFilter}
                onChange={(e) => setComplexFilter(e.target.value)}
                className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-sm text-white"
              >
                <option value="">Todos</option>
                {complexOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!matches && <p className="text-sm text-ink-400">Cargando…</p>}
          {matches && groups.length === 0 && <p className="text-sm text-ink-400">Todavía no hay videos procesados.</p>}

          <div className="space-y-6">
            {groups.map((complex) => (
              <details key={complex.id} open className="card overflow-hidden p-0">
                <summary className="cursor-pointer select-none bg-ink-800/40 px-5 py-3 text-sm font-semibold uppercase tracking-wide text-white">
                  🏢 {complex.name}
                  <span className="ml-2 font-normal normal-case text-ink-400">
                    ({complex.courts.reduce((sum, c) => sum + c.matches.length, 0)} videos · {complex.courts.length} cancha
                    {complex.courts.length === 1 ? '' : 's'})
                  </span>
                </summary>

                <div className="divide-y divide-ink-800">
                  {complex.courts.map((court) => (
                    <div key={court.id} className="p-5">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-white">
                          {SPORT_ICON[court.sportType ?? ''] ?? '🏟'} {court.name}
                        </h3>
                        {court.camera ? (
                          <span className="flex items-center gap-1 text-xs text-ink-400">
                            📷 {court.camera.name}
                            <span className={court.camera.status === 'ONLINE' ? 'text-pitch-400' : 'text-red-400'}>
                              {court.camera.status === 'ONLINE' ? '🟢 Online' : court.camera.status === 'OFFLINE' ? '🔴 Offline' : '⚪ Desconocido'}
                            </span>
                          </span>
                        ) : (
                          <span className="text-xs text-red-400">⚠ Sin cámara asignada</span>
                        )}
                        <span className="text-xs text-ink-500">· {court.matches.length} video{court.matches.length === 1 ? '' : 's'}</span>
                      </div>

                      <div className="space-y-1">
                        {court.matches.map((m) => (
                          <div
                            key={m.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-ink-800/50 px-3 py-2 text-sm"
                          >
                            <Link href={`/matches/${m.id}`} className="text-white hover:underline">
                              {formatDate(m.date)} {formatTime(m.startTime)}
                            </Link>
                            <div className="flex items-center gap-3 text-xs">
                              <span className={STATUS_CLASS[m.video.status] ?? 'text-ink-400'}>
                                {STATUS_LABEL[m.video.status] ?? m.video.status}
                              </span>
                              {m.video.durationWarning && (
                                <span className="text-amber-400" title="La duración procesada quedó muy por debajo de la esperada para el turno — posible corte de conexión durante la grabación.">
                                  ⚠ incompleto
                                </span>
                              )}
                              <span className="text-ink-400">{formatDuration(m.video.durationSeconds)}</span>
                              {m.video.sizeBytes != null && <span className="text-ink-500">{formatBytes(m.video.sizeBytes)}</span>}
                              <button
                                type="button"
                                onClick={() => onDeleteVideo(m.video.id)}
                                disabled={deletingId === m.video.id}
                                className="text-red-400 hover:text-red-300 disabled:opacity-50"
                                title="Borrar video"
                              >
                                {deletingId === m.video.id ? '…' : '🗑'}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </div>
      </AppShell>
    </AuthGuard>
  );
}
