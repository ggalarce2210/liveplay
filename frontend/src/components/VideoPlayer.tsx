'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import Hls from 'hls.js';
import { MatchEvent, Bookmark } from '@/types';
import Timeline from './Timeline';
import { parseThumbnailVtt, ThumbnailCue } from '@/lib/vtt';
import { formatClock } from '@/lib/format';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 4, 8];

export interface VideoPlayerHandle {
  seek: (time: number) => void;
  getCurrentTime: () => number;
  play: () => void;
}

interface Props {
  manifestUrl: string;
  thumbnailsVttUrl: string | null;
  durationSeconds: number;
  matchStartTime: string;
  events: MatchEvent[];
  bookmarks: Bookmark[];
  onTimeUpdate?: (t: number) => void;
  onCreateBookmark: (time: number, label: string) => void;
}

const VideoPlayer = forwardRef<VideoPlayerHandle, Props>(function VideoPlayer(
  { manifestUrl, thumbnailsVttUrl, durationSeconds, matchStartTime, events, bookmarks, onTimeUpdate, onCreateBookmark },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationSeconds);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [thumbnailCues, setThumbnailCues] = useState<ThumbnailCue[]>([]);
  const [bookmarkDraft, setBookmarkDraft] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Pantalla completa "de respaldo" hecha con CSS (position:fixed cubriendo toda la
  // ventana), para cuando la Fullscreen API del navegador no está disponible. Esto pasa
  // siempre en Safari de iPhone (ahí `Element.requestFullscreen` no existe para nada que
  // no sea el <video> nativo) y también en navegadores embebidos como el de WhatsApp o
  // Instagram al abrir un link compartido (reporte real de usuario: el botón no hacía
  // nada en el celular, en iPhone y en Android). No depende de ninguna API del navegador,
  // así que funciona en cualquier lado.
  const [pseudoFullscreen, setPseudoFullscreen] = useState(false);

  useImperativeHandle(ref, () => ({
    seek: (time: number) => {
      if (videoRef.current) videoRef.current.currentTime = Math.max(0, Math.min(duration, time));
    },
    getCurrentTime: () => videoRef.current?.currentTime ?? 0,
    play: () => videoRef.current?.play(),
  }));

  // Adjunta HLS.js (o HLS nativo en Safari/iOS) al <video> — streaming adaptativo real (§11).
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !manifestUrl) return;

    if (Hls.isSupported()) {
      const hls = new Hls({ maxBufferLength: 30 });
      hlsRef.current = hls;
      hls.loadSource(manifestUrl);
      hls.attachMedia(video);
      return () => hls.destroy();
    }
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = manifestUrl;
    }
  }, [manifestUrl]);

  useEffect(() => {
    if (!thumbnailsVttUrl) return;
    fetch(thumbnailsVttUrl)
      .then((r) => r.text())
      .then((text) => setThumbnailCues(parseThumbnailVtt(text)));
  }, [thumbnailsVttUrl]);

  // Atajos de teclado: ← retroceder, → avanzar, espacio play/pause (§8)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowLeft') {
        seekBy(-5);
      } else if (e.code === 'ArrowRight') {
        seekBy(5);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play();
    else video.pause();
  }

  function seekBy(delta: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(duration, video.currentTime + delta));
  }

  function seekTo(t: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(duration, t));
  }

  function changeSpeed(s: number) {
    setSpeed(s);
    if (videoRef.current) videoRef.current.playbackRate = s;
    setSpeedMenuOpen(false);
  }

  useEffect(() => {
    function onFullscreenChange() {
      const fsEl = document.fullscreenElement || (document as any).webkitFullscreenElement;
      setIsFullscreen(!!fsEl);
      // Si el usuario sale de la pantalla completa nativa con el botón del propio
      // navegador (no con nuestro botón), hay que sincronizar el estado igual.
      if (!fsEl) setPseudoFullscreen(false);
    }
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
    };
  }, []);

  // Salir de la pantalla completa "de respaldo" con Escape, igual que la nativa.
  useEffect(() => {
    if (!pseudoFullscreen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === 'Escape') setPseudoFullscreen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pseudoFullscreen]);

  async function toggleFullscreen() {
    const el = containerRef.current as any;
    if (!el) return;

    if (pseudoFullscreen) {
      setPseudoFullscreen(false);
      return;
    }
    if (document.fullscreenElement || (document as any).webkitFullscreenElement) {
      if (document.exitFullscreen) await document.exitFullscreen().catch(() => {});
      else if ((document as any).webkitExitFullscreen) (document as any).webkitExitFullscreen();
      return;
    }

    const request = el.requestFullscreen || el.webkitRequestFullscreen || el.webkitRequestFullScreen || el.mozRequestFullScreen || el.msRequestFullscreen;
    if (request) {
      try {
        await request.call(el);
        return;
      } catch {
        // La API existe pero el navegador la rechazó (pasa en algunos navegadores
        // embebidos) — seguimos abajo con el respaldo de CSS.
      }
    }
    // Sin Fullscreen API disponible (iPhone Safari, navegadores embebidos): respaldo de CSS.
    setPseudoFullscreen(true);
  }

  const spriteUrl = thumbnailCues[0]?.imageUrl ?? null;

  return (
    <div
      ref={containerRef}
      className={
        pseudoFullscreen
          ? 'fixed inset-0 z-50 flex flex-col overflow-y-auto bg-black'
          : 'overflow-hidden rounded-2xl border border-ink-700/60 bg-black'
      }
    >
      <div className={pseudoFullscreen ? 'relative w-full flex-shrink-0 bg-black' : 'relative aspect-video w-full bg-black'}>
        <video
          ref={videoRef}
          className={pseudoFullscreen ? 'max-h-[70vh] w-full' : 'h-full w-full'}
          playsInline
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || durationSeconds)}
          onTimeUpdate={(e) => {
            const t = e.currentTarget.currentTime;
            setCurrentTime(t);
            onTimeUpdate?.(t);
          }}
          onClick={togglePlay}
        />
        {!playing && (
          <button onClick={togglePlay} className="absolute inset-0 flex items-center justify-center bg-black/20 transition hover:bg-black/10">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 text-2xl text-black shadow-lg">▶</span>
          </button>
        )}
      </div>

      {/* Barra de controles principal */}
      <div className="space-y-3 bg-ink-950 px-4 py-3">
        <Timeline
          duration={duration}
          currentTime={currentTime}
          matchStartTime={matchStartTime}
          events={events}
          bookmarks={bookmarks}
          thumbnailCues={thumbnailCues}
          spriteUrl={spriteUrl}
          onSeek={seekTo}
        />

        <div className="flex flex-wrap items-center gap-3">
          <button onClick={togglePlay} className="text-lg text-white" title="Play/Pause (Espacio)">
            {playing ? '⏸' : '▶'}
          </button>

          <div className="flex items-center gap-1.5">
            <button onClick={() => setMuted((m) => { if (videoRef.current) videoRef.current.muted = !m; return !m; })} className="text-white">
              {muted || volume === 0 ? '🔇' : '🔊'}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setVolume(v);
                setMuted(false);
                if (videoRef.current) {
                  videoRef.current.volume = v;
                  videoRef.current.muted = false;
                }
              }}
              className="w-20 accent-pitch-500"
            />
          </div>

          <span className="font-mono text-xs text-ink-300">
            {formatClock(currentTime)} / {formatClock(duration)}
          </span>

          <div className="relative ml-auto flex items-center gap-2">
            <div className="relative">
              <button onClick={() => setSpeedMenuOpen((o) => !o)} className="rounded bg-ink-800 px-2.5 py-1 text-xs font-semibold text-white hover:bg-ink-700">
                {speed}x ⚙
              </button>
              {speedMenuOpen && (
                <div className="absolute bottom-full right-0 mb-2 grid grid-cols-4 gap-1 rounded-lg border border-ink-700 bg-ink-900 p-2 shadow-xl">
                  {SPEEDS.map((s) => (
                    <button
                      key={s}
                      onClick={() => changeSpeed(s)}
                      className={`rounded px-2 py-1 text-xs ${s === speed ? 'bg-pitch-500 text-white' : 'text-ink-300 hover:bg-ink-700'}`}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Antes acá había el caracter Unicode "⛶" (U+26F6) como ícono de pantalla
                completa. En la fuente real de la app (Inter) ese caracter no tiene glifo
                propio, así que el navegador lo reemplazaba por el de alguna fuente de
                respaldo del sistema — en varios dispositivos termina pareciendo un ícono
                sin relación (ej. unas rayitas), no algo reconocible como "expandir a
                pantalla completa" (reporte real de un usuario: no veía ninguna opción de
                pantalla completa). Fix: un SVG propio, inline, que se ve igual en cualquier
                navegador/dispositivo sin depender de qué glifos tenga instalados. */}
            <button
              onClick={toggleFullscreen}
              className="text-white"
              title={isFullscreen || pseudoFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
            >
              {isFullscreen || pseudoFullscreen ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3v3a2 2 0 0 1-2 2H3" />
                  <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
                  <path d="M3 16h3a2 2 0 0 1 2 2v3" />
                  <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3" />
                  <path d="M16 3h3a2 2 0 0 1 2 2v3" />
                  <path d="M21 16v3a2 2 0 0 1-2 2h-3" />
                  <path d="M3 16v3a2 2 0 0 0 2 2h3" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Los botones -30s/-10s/-5s/REPLAY/+5s/+10s/+30s se sacaron (2026-11-14, pedido del
            usuario): en el celular empujaban "Crear clip" muy abajo. Para moverse alcanza con la
            barra; en compu siguen las flechas del teclado (±5s). */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="ml-auto flex items-center gap-2">
            {bookmarkDraft === null ? (
              <button onClick={() => setBookmarkDraft('')} className="btn-secondary !px-3 !py-1.5 text-xs">
                ★ Marcar este momento
              </button>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (bookmarkDraft.trim()) onCreateBookmark(currentTime, bookmarkDraft.trim());
                  setBookmarkDraft(null);
                }}
                className="flex items-center gap-2"
              >
                <input
                  autoFocus
                  value={bookmarkDraft}
                  onChange={(e) => setBookmarkDraft(e.target.value)}
                  placeholder={`Nombre (ej: "Gol de Juan") — ${formatClock(currentTime)}`}
                  className="input-field !py-1.5 text-xs"
                />
                <button type="submit" className="btn-primary !px-3 !py-1.5 text-xs">
                  Guardar
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

export default VideoPlayer;
