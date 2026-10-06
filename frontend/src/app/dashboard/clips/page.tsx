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

/** Nombre de archivo para la descarga: el título del clip, pasado a algo seguro para un
 *  filesystem (sin tildes raras ni barras) y siempre terminado en .mp4. */
function clipFileName(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'clip'}.mp4`;
}

export default function ClipsPage() {
  const [clips, setClips] = useState<Clip[] | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Menú "Compartir" (pedido explícito del usuario 2026-10-06): un ícono al lado de "Ver
  // partido" que al tocarlo despliega dos opciones, enviar link o descargar el video, en vez de
  // tener dos botones sueltos ocupando lugar en cada tarjeta.
  const [shareMenuId, setShareMenuId] = useState<string | null>(null);
  const [shareBusyId, setShareBusyId] = useState<string | null>(null);
  const [shareFeedback, setShareFeedback] = useState<{ id: string; message: string } | null>(null);

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

  function flashFeedback(id: string, message: string) {
    setShareFeedback({ id, message });
    setTimeout(() => setShareFeedback((prev) => (prev?.id === id ? null : prev)), 3000);
  }

  /** Crea un enlace privado para el clip (mismo endpoint /share-links que "Compartir partido",
   *  pero con clipId en vez de matchId) y lo manda por el share sheet nativo si existe
   *  (navigator.share, lo normal en el celular), o lo copia al portapapeles si no. */
  async function onSendLink(clip: Clip) {
    setShareMenuId(null);
    setShareBusyId(clip.id);
    try {
      const res = await api.post<{ url: string }>('/share-links', { clipId: clip.id, visibility: 'PRIVATE', expiresInHours: 48 });
      const fullUrl = `${window.location.origin}${res.url}`;
      if (navigator.share) {
        try {
          await navigator.share({ title: clip.title, url: fullUrl });
          return;
        } catch {
          // Si el usuario cancela el share sheet no es un error - simplemente no hacemos nada mas.
          return;
        }
      }
      await navigator.clipboard.writeText(fullUrl);
      flashFeedback(clip.id, 'Enlace copiado ✓');
    } catch (err) {
      flashFeedback(clip.id, errorMessage(err, 'No pudimos generar el enlace'));
    } finally {
      setShareBusyId(null);
    }
  }

  /** Descarga el archivo del clip. Reusa el mismo endpoint de playback que "Ver clip" (URL
   *  firmada, valida 30 min) y fuerza la descarga con un <a download> en vez de abrir el video. */
  async function onDownload(clip: Clip) {
    setShareMenuId(null);
    setShareBusyId(clip.id);
    try {
      const res = await api.get<{ status: string; url: string | null }>(`/clips/${clip.id}/playback`);
      if (!res.url) throw new Error('El clip todavia no tiene un archivo para descargar.');
      const a = document.createElement('a');
      a.href = res.url;
      a.download = clipFileName(clip.title);
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      flashFeedback(clip.id, errorMessage(err, 'No pudimos descargar este clip'));
    } finally {
      setShareBusyId(null);
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
            {shareFeedback?.id === clip.id && <p className="mt-1 text-xs text-pitch-400">{shareFeedback.message}</p>}

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
              {clip.status === 'READY' && (
                <div className="relative">
                  <button
                    onClick={() => setShareMenuId((prev) => (prev === clip.id ? null : clip.id))}
                    disabled={shareBusyId === clip.id}
                    className="btn-secondary !py-2 text-sm disabled:opacity-60"
                    aria-label="Compartir clip"
                  >
                    {shareBusyId === clip.id ? '...' : '📤'}
                  </button>
                  {shareMenuId === clip.id && (
                    <div className="absolute bottom-full left-0 z-10 mb-2 w-44 overflow-hidden rounded-lg border border-ink-700 bg-ink-800 shadow-lg">
                      <button
                        onClick={() => onSendLink(clip)}
                        className="block w-full px-3 py-2 text-left text-sm text-white hover:bg-ink-700"
                      >
                        🔗 Enviar link
                      </button>
                      <button
                        onClick={() => onDownload(clip)}
                        className="block w-full px-3 py-2 text-left text-sm text-white hover:bg-ink-700"
                      >
                        ⬇ Descargar video
                      </button>
                    </div>
                  )}
                </div>
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
