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
 * filesystem (sin tildes raras ni barras) y siempre terminado en .mp4. */
function clipFileName(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'clip'}.mp4`;
}

/** Estado del modal de descarga (ver `onDownload` más abajo). `blobUrl` solo existe en
 * `ready` — es un object URL del propio navegador (same-origin), por eso "Ver"/compartir
 * pueden usarlo directo sin volver a pegarle al storage. */
type DownloadState =
  | { clipId: string; status: 'downloading'; progress: number }
  | { clipId: string; status: 'ready'; progress: 100; blobUrl: string; fileName: string }
  | { clipId: string; status: 'error'; progress: 0; error: string };

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

  // Modal de descarga (2026-10-21): antes "Descargar video" armaba un <a download> apuntando
  // directo a la URL firmada de R2/S3 — pero el atributo `download` de un <a> SOLO lo respeta
  // el navegador si el link es same-origin; contra una URL cross-origin (como cualquier URL
  // firmada de storage) el navegador lo trata como una navegación común, así que Chrome abría
  // una pestaña nueva y reproducía el video en vez de bajarlo. Fix real: traer el archivo con
  // `fetch` (sí autorizado por la CORS Policy del bucket, ver resumen del proyecto) y armar un
  // Blob/object URL propio — ESE sí es same-origin (`blob:`) y el `download` funciona de
  // verdad. De paso, leer la respuesta de a poco permite mostrar progreso real.
  const [downloadState, setDownloadState] = useState<DownloadState | null>(null);

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
   * pero con clipId en vez de matchId) y lo manda por el share sheet nativo si existe
   * (navigator.share, lo normal en el celular), o lo copia al portapapeles si no. */
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

  /** Cierra el modal de descarga y libera el object URL (si lo hubiera) — sin esto, cada
   * descarga dejaría un Blob entero vivo en memoria hasta recargar la página. */
  function closeDownloadModal() {
    setDownloadState((prev) => {
      if (prev?.status === 'ready') URL.revokeObjectURL(prev.blobUrl);
      return null;
    });
  }

  /** Descarga el archivo del clip de verdad (ver comentario de `DownloadState` más arriba):
   * trae el video con `fetch`, arma un Blob propio con progreso real, dispara el guardado al
   * dispositivo con un `<a download>` sobre ESE blob (same-origin, por eso ahora sí funciona), y
   * deja el modal en estado "ready" con accesos directos a "Ver" y "Enviar por WhatsApp". */
  async function onDownload(clip: Clip) {
    setShareMenuId(null);
    setDownloadState({ clipId: clip.id, status: 'downloading', progress: 0 });
    try {
      const planRes = await api.get<{ status: string; url: string | null }>(`/clips/${clip.id}/playback`);
      if (!planRes.url) throw new Error('El clip todavia no tiene un archivo para descargar.');

      const response = await fetch(planRes.url);
      if (!response.ok || !response.body) throw new Error('No pudimos descargar este clip.');

      const totalBytes = Number(response.headers.get('content-length')) || 0;
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let receivedBytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          receivedBytes += value.length;
          const progress = totalBytes ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100)) : 0;
          setDownloadState((prev) => (prev && prev.clipId === clip.id && prev.status === 'downloading' ? { ...prev, progress } : prev));
        }
      }

      const blob = new Blob(chunks, { type: response.headers.get('content-type') || 'video/mp4' });
      const blobUrl = URL.createObjectURL(blob);
      const fileName = clipFileName(clip.title);

      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();

      setDownloadState({ clipId: clip.id, status: 'ready', progress: 100, blobUrl, fileName });
    } catch (err) {
      setDownloadState({ clipId: clip.id, status: 'error', progress: 0, error: errorMessage(err, 'No pudimos descargar este clip') });
    }
  }

  /** Comparte el video YA descargado (ver `onDownload`) directo por WhatsApp. En celular, con
   * soporte del navegador para compartir archivos (`navigator.canShare({ files })`), abre el
   * share sheet nativo con el video adjunto de verdad — el usuario elige WhatsApp ahí mismo. En
   * desktop (o un navegador sin ese soporte) no hay forma de adjuntar un archivo a WhatsApp Web
   * desde la página, así que el fallback comparte el mismo link privado de "Enviar link" directo
   * a `wa.me` (abre WhatsApp Web/la app con el mensaje ya armado). */
  async function shareDownloadedToWhatsApp(clip: Clip) {
    if (downloadState?.status === 'ready' && downloadState.clipId === clip.id) {
      try {
        const fileRes = await fetch(downloadState.blobUrl);
        const blob = await fileRes.blob();
        const file = new File([blob], downloadState.fileName, { type: blob.type || 'video/mp4' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: clip.title });
          return;
        }
      } catch {
        // Cancelado por el usuario, o el navegador no soporta compartir archivos — seguimos al
        // fallback de abajo en vez de mostrar un error.
      }
    }
    try {
      const res = await api.post<{ url: string }>('/share-links', { clipId: clip.id, visibility: 'PRIVATE', expiresInHours: 48 });
      const fullUrl = `${window.location.origin}${res.url}`;
      window.open(`https://wa.me/?text=${encodeURIComponent(fullUrl)}`, '_blank');
    } catch (err) {
      flashFeedback(clip.id, errorMessage(err, 'No pudimos compartir por WhatsApp'));
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
                    disabled={shareBusyId === clip.id || downloadState?.clipId === clip.id}
                    className="btn-secondary !py-2 text-sm disabled:opacity-60"
                    aria-label="Compartir clip"
                  >
                    {shareBusyId === clip.id ? (
                      '...'
                    ) : (
                      <>
                        {/* Icono propio (clásico ícono "compartir" de Android, 3 puntos conectados) en el
                        verde "pitch" de la marca, en vez del emoji 📤 original — pedido del usuario
                        2026-10-07, eligió esta variante entre 5 opciones probadas. */}
                        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
                          <circle cx="18" cy="5" r="2.6" fill="#2f9a52" />
                          <circle cx="6" cy="12" r="2.6" fill="#2f9a52" />
                          <circle cx="18" cy="19" r="2.6" fill="#2f9a52" />
                          <path
                            d="M8.3 10.6 15.7 6.4M8.3 13.4l7.4 4.2"
                            stroke="#2f9a52"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                          />
                        </svg>
                        Compartir
                      </>
                    )}
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

      {/* Modal de descarga: progreso real mientras se trae el archivo, y al terminar accesos
      directos a "Ver" el video ya bajado o mandarlo por WhatsApp — ver `onDownload` y
      `shareDownloadedToWhatsApp` más arriba para el detalle técnico de por qué hacía falta. */}
      {downloadState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={() => downloadState.status !== 'downloading' && closeDownloadModal()}>
          <div className="card max-w-sm p-6 text-center" onClick={(e) => e.stopPropagation()}>
            {downloadState.status === 'downloading' && (
              <>
                <p className="mb-3 text-sm text-ink-200">Descargando video...</p>
                <div className="h-2 w-full overflow-hidden rounded-full bg-ink-700">
                  <div className="h-full bg-pitch-500 transition-all" style={{ width: `${downloadState.progress}%` }} />
                </div>
                <p className="mt-2 text-xs text-ink-400">{downloadState.progress > 0 ? `${downloadState.progress}%` : 'Empezando...'}</p>
              </>
            )}
            {downloadState.status === 'ready' && (
              <>
                <p className="mb-4 text-sm text-pitch-400">✓ Video descargado</p>
                <div className="flex flex-col gap-2">
                  <button onClick={() => window.open(downloadState.blobUrl, '_blank')} className="btn-secondary w-full !py-2 text-sm">
                    👁 Ver
                  </button>
                  <button
                    onClick={() => {
                      const clip = clips?.find((c) => c.id === downloadState.clipId);
                      if (clip) void shareDownloadedToWhatsApp(clip);
                    }}
                    className="btn-primary w-full !py-2 text-sm"
                  >
                    💬 Enviar por WhatsApp
                  </button>
                </div>
                <button onClick={closeDownloadModal} className="mt-3 text-xs text-ink-400 hover:text-white">
                  Cerrar
                </button>
              </>
            )}
            {downloadState.status === 'error' && (
              <>
                <p className="text-sm text-red-400">{downloadState.error}</p>
                <button onClick={closeDownloadModal} className="btn-secondary mt-4 w-full !py-2 text-sm">
                  Cerrar
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
