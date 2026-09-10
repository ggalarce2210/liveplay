'use client';

import { useMemo, useRef, useState } from 'react';
import { MatchEvent, Bookmark } from '@/types';
import { ThumbnailCue, findCueAt } from '@/lib/vtt';
import { formatClock } from '@/lib/format';

const EVENT_ICON: Record<string, string> = {
  GOAL: '⚽',
  YELLOW_CARD: '🟨',
  RED_CARD: '🟥',
  GREAT_SAVE: '🧤',
  HIGHLIGHT: '✨',
  SET_POINT: '🎾',
  CUSTOM: '📍',
};

const ZOOM_LEVELS = [1, 2, 4, 8];

interface Props {
  duration: number;
  currentTime: number;
  matchStartTime: string;
  events: MatchEvent[];
  bookmarks: Bookmark[];
  thumbnailCues: ThumbnailCue[];
  spriteUrl: string | null;
  onSeek: (time: number) => void;
}

function realClockLabel(matchStartTime: string, offsetSeconds: number): string {
  const start = new Date(matchStartTime);
  const t = new Date(start.getTime() + offsetSeconds * 1000);
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
}

export default function Timeline({ duration, currentTime, matchStartTime, events, bookmarks, thumbnailCues, spriteUrl, onSeek }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [zoomIndex, setZoomIndex] = useState(0);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const zoom = ZOOM_LEVELS[zoomIndex];

  // Ventana visible cuando hay zoom: se centra en el playhead actual (§33 — zoom temporal).
  const windowStart = useMemo(() => {
    if (zoom === 1) return 0;
    const windowSize = duration / zoom;
    const start = Math.max(0, Math.min(duration - windowSize, currentTime - windowSize / 2));
    return start;
  }, [zoom, duration, currentTime]);
  const windowSize = duration / zoom;
  const windowEnd = Math.min(duration, windowStart + windowSize);

  function timeFromClientX(clientX: number): number {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return windowStart + fraction * windowSize;
  }

  function handlePointerMove(e: React.PointerEvent) {
    setHoverX(e.clientX);
    if (dragging) onSeek(timeFromClientX(e.clientX));
  }
  function handlePointerDown(e: React.PointerEvent) {
    setDragging(true);
    onSeek(timeFromClientX(e.clientX));
  }
  function handlePointerUp() {
    setDragging(false);
  }

  const hoverTime = hoverX !== null ? timeFromClientX(hoverX) : null;
  const hoverCue = hoverTime !== null ? findCueAt(thumbnailCues, hoverTime) : null;

  const visibleEvents = events.filter((e) => e.timestampSeconds >= windowStart && e.timestampSeconds <= windowEnd);
  const visibleBookmarks = bookmarks.filter((b) => b.timestampSeconds >= windowStart && b.timestampSeconds <= windowEnd);

  function pct(t: number) {
    return ((t - windowStart) / windowSize) * 100;
  }

  return (
    <div className="select-none">
      {/* Preview del thumbnail al pasar/arrastrar el cursor (§12) */}
      {hoverX !== null && hoverCue && spriteUrl && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 overflow-hidden rounded-lg border border-ink-600 bg-black shadow-2xl"
          style={{ left: hoverX, top: (trackRef.current?.getBoundingClientRect().top ?? 0) - 100, width: hoverCue.w, height: hoverCue.h }}
        >
          <div
            style={{
              width: 1600,
              height: 900,
              backgroundImage: `url(${spriteUrl})`,
              backgroundPosition: `-${hoverCue.x}px -${hoverCue.y}px`,
            }}
          />
          <span className="absolute bottom-0.5 right-1 rounded bg-black/70 px-1 text-[10px] text-white">{formatClock(hoverTime ?? 0)}</span>
        </div>
      )}

      <div
        ref={trackRef}
        onPointerMove={handlePointerMove}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => setHoverX(null)}
        className="relative h-3 w-full cursor-pointer rounded-full bg-ink-700"
      >
        <div className="absolute inset-y-0 left-0 rounded-full bg-pitch-500" style={{ width: `${pct(currentTime)}%` }} />
        <div
          className="absolute top-1/2 h-4 w-4 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-white bg-pitch-400 shadow"
          style={{ left: `${pct(currentTime)}%` }}
        />

        {visibleBookmarks.map((b) => (
          <div key={b.id} className="group absolute -top-1.5 h-6 w-0.5 -translate-x-1/2 bg-amber-400" style={{ left: `${pct(b.timestampSeconds)}%` }}>
            <span className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/80 px-1.5 py-0.5 text-[10px] text-amber-300 opacity-0 group-hover:opacity-100">
              ★ {b.label}
            </span>
          </div>
        ))}

        {visibleEvents.map((ev) => (
          <button
            key={ev.id}
            onPointerDown={(e) => {
              e.stopPropagation();
              onSeek(ev.timestampSeconds);
            }}
            className="group absolute top-1/2 -translate-y-1/2 -translate-x-1/2 text-sm"
            style={{ left: `${pct(ev.timestampSeconds)}%` }}
            title={ev.label ?? ev.type}
          >
            <span className="drop-shadow">{EVENT_ICON[ev.type] ?? '📍'}</span>
            <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/80 px-1.5 py-0.5 text-[10px] text-white opacity-0 group-hover:opacity-100">
              {ev.label ?? ev.type}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-1.5 flex items-center justify-between text-xs text-ink-400">
        <span>{realClockLabel(matchStartTime, windowStart)}</span>
        <div className="flex items-center gap-1.5">
          <span className="mr-2 text-ink-500">Zoom</span>
          {ZOOM_LEVELS.map((z, i) => (
            <button
              key={z}
              onClick={() => setZoomIndex(i)}
              className={`rounded px-1.5 py-0.5 text-[11px] ${zoomIndex === i ? 'bg-pitch-500 text-white' : 'bg-ink-800 text-ink-400 hover:bg-ink-700'}`}
            >
              {z}x
            </button>
          ))}
        </div>
        <span>{realClockLabel(matchStartTime, windowEnd)}</span>
      </div>
    </div>
  );
}
