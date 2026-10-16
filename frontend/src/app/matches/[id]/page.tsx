'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import AuthGuard from '@/components/AuthGuard';
import VideoPlayer, { VideoPlayerHandle } from '@/components/VideoPlayer';
import EventsList from '@/components/EventsList';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { Match, PlaybackUrls, Bookmark } from '@/types';
import { formatClock, formatDate, formatTime } from '@/lib/format';

/** Forma del body de error 409 CLIP_LIMIT_REACHED que manda ClipsController.create(). */
interface OldestClip {
  id: string;
  title: string;
  status: 'PENDING' | 'READY' | 'FAILED';
  createdAt: string;
}

export default function MatchDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const playerRef = useRef<VideoPlayerHandle>(null);
  const { user } = useAuthStore();
  const canDeleteMatch = user?.role === 'SUPER_ADMIN' || user?.role === 'COMPLEX_ADMIN';

  const [match, setMatch] = useState<Match | null>(null);
  const [playback, setPlayback] = useState<PlaybackUrls | null>(null);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deletingMatch, setDeletingMatch] = useState(false);
  const [deleteMatchError, setDeleteMatchError] = useState<string | null>(null);

  const [clipStart, setClipStart] = useState<number | null>(null);
  const [clipEnd, setClipEnd] = useState<number | null>(null);
  const [clipTitle, setClipTitle] = useState('');
  const [clipMessage, setClipMessage] = useState<string | null>(null);

  // Tope de 10 clips por usuario (pedido 2026-10-05): si el backend lo rechaza con 409
  // CLIP_LIMIT_REACHED, mostramos acá mismo los 3 clips más viejos del usuario para que pueda
  // tildar y borrar los que quiera, sin tener que ir a "Mis momentos" aparte.
  const [clipLimitInfo, setClipLimitInfo] = useState<{ message: string; oldestClips: OldestClip[] } | null>(null);
  const [selectedToDelete, setSelectedToDelete] = useState<Set<string>>(new Set());
  const [deletingClips, setDeletingClips] = useState(false);

  const [shareUrl, setShareUrl] = useState<string | null>(null);

  async function load() {
    try {
      const m = await api.get<Match>(`/matches/${params.id}`);
      setMatch(m);
      if (m.video) {
        const pb = await api.get<PlaybackUrls>(`/videos/${m.video.id}/playback`);
        setPlayback(pb);
      }
      const bm = await api.get<Bookmark[]>(`/matches/${params.id}/bookmarks`);
      setBookmarks(bm);
    } catch (err) {
      setError('No pudimos cargar este partido (¿no te corresponde, o no existe?)');
    }
  }

  useEffect(() => {
    load();
  }, [params.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function createBookmark(time: number, label: string) {
    const created = await api.post<Bookmark>(`/matches/${params.id}/bookmarks`, { timestampSeconds: time, label });
    setBookmarks((prev) => [...prev, created].sort((a, b) => a.timestampSeconds - b.timestampSeconds));
  }

  async function deleteBookmark(id: string) {
    await api.delete(`/bookmarks/${id}`);
    setBookmarks((prev) => prev.filter((b) => b.id !== id));
  }

  function seek(t: number) {
    playerRef.current?.seek(t);
  }

  /** Intenta crear el clip con los valores marcados ahora mismo. Separado de `createClip` (el
   *  handler del form) para poder reintentarlo solo, sin un evento de submit real, después de
   *  que el usuario borre clips viejos desde el modal del tope de 10. */
  async function submitClip() {
    if (clipStart === null || clipEnd === null || clipEnd <= clipStart) {
      setClipMessage('Marcá primero el inicio y el fin de la jugada.');
      return;
    }
    try {
      await api.post('/clips', { matchId: params.id, title: clipTitle || 'Mi clip', startSeconds: clipStart, endSeconds: clipEnd });
      setClipMessage('¡Clip en camino! Lo vas a encontrar en "Mis mejores momentos" en unos segundos.');
      setClipStart(null);
      setClipEnd(null);
      setClipTitle('');
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { code?: string; message?: string; oldestClips?: OldestClip[] } | null) : null;
      if (err instanceof ApiError && err.status === 409 && body?.code === 'CLIP_LIMIT_REACHED') {
        setClipLimitInfo({ message: body.message ?? err.message, oldestClips: body.oldestClips ?? [] });
        setSelectedToDelete(new Set());
        return;
      }
      setClipMessage(err instanceof ApiError ? err.message : 'No pudimos crear el clip.');
    }
  }

  function createClip(e: React.FormEvent) {
    e.preventDefault();
    void submitClip();
  }

  function toggleClipToDelete(id: string, checked: boolean) {
    setSelectedToDelete((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /** Borra los clips tildados y, si quedó alguno borrado, reintenta guardar el clip nuevo. */
  async function deleteSelectedAndRetry() {
    if (selectedToDelete.size === 0) return;
    setDeletingClips(true);
    try {
      await Promise.all(Array.from(selectedToDelete).map((id) => api.delete(`/clips/${id}`)));
      setClipLimitInfo(null);
      setSelectedToDelete(new Set());
      await submitClip();
    } catch (err) {
      setClipMessage(err instanceof ApiError ? err.message : 'No pudimos borrar esos clips.');
    } finally {
      setDeletingClips(false);
    }
  }

  async function shareMatch() {
    const res = await api.post<{ url: string }>('/share-links', { matchId: params.id, visibility: 'PRIVATE', expiresInHours: 48 });
    setShareUrl(`${window.location.origin}${res.url}`);
  }

  /** Borra el partido (y su video grabado) — solo SUPER_ADMIN/COMPLEX_ADMIN. */
  async function deleteMatch() {
    if (!window.confirm('¿Eliminar este partido y su video grabado? No se puede deshacer.')) return;
    setDeletingMatch(true);
    setDeleteMatchError(null);
    try {
      await api.delete(`/matches/${params.id}`);
      router.push('/dashboard');
    } catch (err) {
      setDeleteMatchError(err instanceof ApiError ? err.message : 'No pudimos eliminar el partido');
      setDeletingMatch(false);
    }
  }

  if (error) {
    return (
      <AuthGuard>
        <div className="mx-auto max-w-2xl px-6 py-16 text-center">
          <p className="text-lg text-white">{error}</p>
          <Link href="/dashboard" className="btn-secondary mt-4 inline-flex">
            Volver a mis partidos
          </Link>
        </div>
      </AuthGuard>
    );
  }

  if (!match) {
    return (
      <AuthGuard>
        <div className="flex min-h-screen items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-pitch-500 border-t-transparent" />
        </div>
      </AuthGuard>
    );
  }

  return (
    <AuthGuard>
      <div className="mx-auto max-w-6xl px-6 py-8">
        <button onClick={() => router.push('/dashboard')} className="mb-4 text-sm text-ink-400 hover:text-white">
          ← Volver a mis partidos
        </button>

        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-white">
              {match.sportType === 'FUTBOL5' ? 'Fútbol 5' : 'Pádel'} · {match.court?.name}
            </h1>
            <p className="text-sm text-ink-400">
              📅 {formatDate(match.date)} · ⏰ {formatTime(match.startTime)} · 📍 {match.complex?.name}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={shareMatch} className="btn-secondary text-sm">
              🔗 Compartir partido
            </button>
            {canDeleteMatch && (
              <button onClick={deleteMatch} disabled={deletingMatch} className="btn-secondary text-sm text-red-400 hover:text-red-300 disabled:opacity-60">
                {deletingMatch ? 'Eliminando...' : '🗑 Eliminar partido'}
              </button>
            )}
          </div>
        </div>

        {shareUrl && (
          <div className="mb-4 rounded-lg border border-pitch-500/40 bg-pitch-500/10 px-4 py-3 text-sm text-pitch-300">
            Enlace privado (vence en 48hs): <span className="font-mono">{shareUrl}</span>
          </div>
        )}
        {deleteMatchError && (
          <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{deleteMatchError}</div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-5">
            {playback?.manifestUrl ? (
              <VideoPlayer
                ref={playerRef}
                manifestUrl={playback.manifestUrl}
                thumbnailsVttUrl={playback.thumbnailsVttUrl}
                durationSeconds={playback.durationSeconds ?? 0}
                matchStartTime={match.startTime}
                events={match.events ?? []}
                bookmarks={bookmarks}
                onCreateBookmark={createBookmark}
              />
            ) : (
              <div className="card flex aspect-video items-center justify-center">
                <p className="text-ink-400">
                  {match.status === 'PROCESSING' ? 'Tu partido se está procesando, ya casi está listo…' : 'El video todavía no está disponible.'}
                </p>
              </div>
            )}

            {/* Creación de clips (§16) */}
            <div className="card p-5">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-300">Crear clip / mejor momento</h3>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                <button
                  onClick={() => setClipStart(playerRef.current?.getCurrentTime() ?? 0)}
                  className="btn-secondary !py-1.5 text-xs"
                >
                  Marcar inicio {clipStart !== null && `(${formatClock(clipStart)})`}
                </button>
                <button onClick={() => setClipEnd(playerRef.current?.getCurrentTime() ?? 0)} className="btn-secondary !py-1.5 text-xs">
                  Marcar fin {clipEnd !== null && `(${formatClock(clipEnd)})`}
                </button>
              </div>
              <form onSubmit={createClip} className="flex flex-wrap items-center gap-2">
                <input value={clipTitle} onChange={(e) => setClipTitle(e.target.value)} placeholder="Nombre del clip (ej: Mi gol)" className="input-field max-w-xs text-sm" />
                <button type="submit" className="btn-primary !py-2 text-sm">
                  Crear clip
                </button>
              </form>
            </div>
          </div>

          <div className="space-y-5">
            <EventsList events={match.events ?? []} bookmarks={bookmarks} onSeek={seek} onDeleteBookmark={deleteBookmark} />

            <div className="card p-5">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-300">Jugadores</h3>
              <div className="space-y-1 text-sm text-ink-200">
                {(match.players ?? []).map((p) => (
                  <div key={p.id} className="flex items-center justify-between">
                    <span>{p.user ? `${p.user.firstName} ${p.user.lastName}` : p.guestName}</span>
                    {p.team && <span className="text-xs text-ink-400">{p.team.label}</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal de aviso al crear un clip (reemplaza el texto inline que quedaba perdido debajo
          del formulario y nunca se cerraba solo — ahora requiere un OK explícito del usuario). */}
      {clipMessage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          onClick={() => setClipMessage(null)}
        >
          <div className="card max-w-sm p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-ink-200">{clipMessage}</p>
            <button onClick={() => setClipMessage(null)} className="btn-primary mt-4 w-full">
              OK
            </button>
          </div>
        </div>
      )}

      {/* Tope de 10 clips (2026-10-05): en vez de solo bloquear, le mostramos acá mismo los 3
          momentos más viejos del usuario para que pueda tildar y borrar los que quiera, y
          reintentamos guardar el clip nuevo apenas borra alguno. */}
      {clipLimitInfo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          onClick={() => !deletingClips && setClipLimitInfo(null)}
        >
          <div className="card max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-ink-200">{clipLimitInfo.message}</p>
            {clipLimitInfo.oldestClips.length > 0 ? (
              <>
                <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-ink-400">
                  Tus momentos más viejos
                </p>
                <div className="space-y-2">
                  {clipLimitInfo.oldestClips.map((c) => (
                    <label
                      key={c.id}
                      className="flex cursor-pointer items-center gap-2 rounded-lg border border-ink-700 px-3 py-2 text-sm text-ink-200"
                    >
                      <input
                        type="checkbox"
                        checked={selectedToDelete.has(c.id)}
                        onChange={(e) => toggleClipToDelete(c.id, e.target.checked)}
                      />
                      <span className="truncate">{c.title}</span>
                    </label>
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-3 text-sm text-ink-400">
                Andá a &quot;Mis momentos&quot; para elegir cuál borrar.
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setClipLimitInfo(null)}
                disabled={deletingClips}
                className="btn-secondary flex-1 !py-2 text-sm disabled:opacity-60"
              >
                Cancelar
              </button>
              {clipLimitInfo.oldestClips.length > 0 && (
                <button
                  onClick={deleteSelectedAndRetry}
                  disabled={selectedToDelete.size === 0 || deletingClips}
                  className="btn-primary flex-1 !py-2 text-sm disabled:opacity-60"
                >
                  {deletingClips ? 'Borrando...' : 'Borrar y guardar este clip'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </AuthGuard>
  );
}
