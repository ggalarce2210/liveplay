'use client';

import { MatchEvent, Bookmark } from '@/types';
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

export default function EventsList({
  events,
  bookmarks,
  onSeek,
  onDeleteBookmark,
}: {
  events: MatchEvent[];
  bookmarks: Bookmark[];
  onSeek: (t: number) => void;
  onDeleteBookmark: (id: string) => void;
}) {
  return (
    <div className="card p-5">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-300">Eventos del partido</h3>
      <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
        {events.length === 0 && <p className="text-sm text-ink-500">Sin eventos cargados.</p>}
        {events.map((ev) => (
          <button key={ev.id} onClick={() => onSeek(ev.timestampSeconds)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm hover:bg-ink-800/70">
            <span className="text-lg">{EVENT_ICON[ev.type] ?? '📍'}</span>
            <span className="font-mono text-xs text-ink-400">{formatClock(ev.timestampSeconds)}</span>
            <span className="text-ink-100">{ev.label ?? ev.type}</span>
          </button>
        ))}
      </div>

      <h3 className="mb-3 mt-6 text-sm font-semibold uppercase tracking-wide text-ink-300">Mis marcadores</h3>
      <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
        {bookmarks.length === 0 && <p className="text-sm text-ink-500">Todavía no marcaste ningún momento.</p>}
        {bookmarks.map((b) => (
          <div key={b.id} className="group flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-ink-800/70">
            <button onClick={() => onSeek(b.timestampSeconds)} className="flex flex-1 items-center gap-3 text-left">
              <span className="text-lg text-amber-400">★</span>
              <span className="font-mono text-xs text-ink-400">{formatClock(b.timestampSeconds)}</span>
              <span className="text-ink-100">{b.label}</span>
            </button>
            <button onClick={() => onDeleteBookmark(b.id)} className="hidden text-xs text-ink-500 hover:text-red-400 group-hover:block">
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
