'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { Clip } from '@/types';
import { formatDate, formatTime } from '@/lib/format';

const STATUS_LABEL: Record<string, string> = { PENDING: 'Generando...', READY: 'Listo', FAILED: 'Error' };

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export default function ClipsPage() {
  const [clips, setClips] = useState<Clip[] | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const data = await api.get<Clip[]>('/clips');
    setClips(data);
  }

  useEffect(() => {
    load();
  }, []);

  // Mientras haya algun clip generandose, refrescamos la lista solos cada pocos segundos: antes
  // habia que recargar la pagina a mano para ver si ya habia terminado (o si habia fallado).
  useEffect(() => {
    const hasPending = clips?.some((c) => c.status === 'PENDING') ?? false;
    if (!hasPending) return;
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
  }, [clips]);

  async function onWatch(clip: Clip) {
    setPlayError(null);
    setPlayingUrl(null);
    setPlayingId(clip.id);
    try {
      const res = await api.get<{ status: string; url: string | null }>(`/clips/${clip.id}/playback`);
      if (!res.url) throw new Error('El clip todavia no tiene una URL de reproduccion.');
      setPlayingUrl(res.url);
    } catch (err) {
      setPlayError(errorMessage(err, 'No pudimos abrir este clip'));
    }
  }

  async function onRetry(clip: Clip) {
    setBusyId(clip.id);
    try {
      await api.post(`/clips/${clip.id}/retry`);
      await load();
    } catch {
      // el error se ve reflejado en el status/errorMessage del clip al recargar la lista
    } finally {
      setBusyId(null);
    }
  }

  async function onDelete(clip: Clip) {
    if (!window.confirm(`¿Eliminar el clip "${clip.title}"?`)) return;
    setBusyId(clip.id);
    try {
      await api.delete(`/clips/${clip.id}`);
      setClips((prev) => prev?.filter((c) => c.id !== clip.id) ?? null);
    } catch {
      /* noop */
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-2xl font-bold text-white">Mis mejores momentos</h1>
      <p className="mb-6 text-sm text-ink-400">Clips que generaste a partir de tus partidos (§16).</p>

      {clips === null && <p className="text-ink-400">Cargando...</p>}
      {clips?.length === 0 && (
        <div className="card flex flex-col items-center justify-center gap-2 py-16 text-center">
          <span className="text-4xl">⭐</span>
          <p className="font-medium text-white">Todavia no creaste ningun clip</p>
          <p className="text-sm text-ink-400">Abri un partido, marca el inicio y el fin de una jugada, y crea tu primer clip.</p>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {clips?.map((clip) => (
          <div key={clip.id} className="card p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="truncate font-semibold text-white">{clip.title}</h3>
              <span
                className={`badge shrink-0 ${
                  clip.status === 'READY' ? 'bg-pitch-500/15 text-pitch-400' : clip.status === 'FAILED' ? 'bg-red-500/15 text-red-400' : 'bg-ink-700 text-ink-200'
                }`}
              >
                {STATUS_LABEL[clip.status]}
              </span>
            </div>
            {clip.match ? (
              <p className="text-sm text-ink-400">
                {formatDate(clip.match.date)} · {formatTime(clip.match.startTime)} · {clip.match.court?.name}
              </p>
            ) : (
              <p className="text-sm text-ink-500">Partido original vencido (se guarda igual, no tiene límite de tiempo)</p>
            )}
            <p className="mt-1 text-xs text-ink-500">
              {clip.startSeconds.toFixed(0)}s → {clip.endSeconds.toFixed(0)}s ({(clip.endSeconds - clip.startSeconds).toFixed(0)}s)
            </p>
            {clip.status === 'FAILED' && clip.errorMessage && <p className="mt-1 text-xs text-red-400">{clip.errorMessage}</p>}

            {playingId === clip.id && (
              <div className="mt-3">
                {playError && <p className="text-xs text-red-400">{playError}</p>}
                {playingUrl && <video src={playingUrl} controls autoPlay className="w-full rounded-lg bg-black" />}
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              {clip.status === 'READY' && (
                <button onClick={() => onWatch(clip)} className="btn-primary !py-2 text-sm">
                  ▶ Ver clip
                </button>
              )}
              {clip.status === 'FAILED' && (
                <button onClick={() => onRetry(clip)} disabled={busyId === clip.id} className="btn-secondary !py-2 text-sm">
                  {busyId === clip.id ? 'Reintentando...' : '↻ Reintentar'}
                </button>
              )}
              {clip.matchId && (
                <Link href={`/matches/${clip.matchId}`} className="btn-secondary !py-2 text-sm">
                  Ver partido
                </Link>
              )}
              <button
                onClick={() => onDelete(clip)}
                disabled={busyId === clip.id}
                className="ml-auto text-xs font-semibold text-red-400 hover:text-red-300 disabled:opacity-60"
              >
                🗑
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
