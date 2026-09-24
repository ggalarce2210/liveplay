'use client';

import Link from 'next/link';
import { Match } from '@/types';
import { formatDate, formatTime, formatDuration } from '@/lib/format';

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  SCHEDULED: { label: 'Programado', className: 'bg-ink-700 text-ink-200' },
  RECORDING: { label: 'Grabando', className: 'bg-red-500/20 text-red-400' },
  PROCESSING: { label: 'Procesando', className: 'bg-amber-500/20 text-amber-400' },
  READY: { label: 'Disponible', className: 'bg-pitch-500/20 text-pitch-400' },
  FAILED: { label: 'Error', className: 'bg-red-500/20 text-red-400' },
};

function resultLine(match: Match): string | null {
  if (match.sportType === 'FUTBOL5' && match.teams?.length === 2) {
    return `${match.teams[0].label} ${match.teams[0].score ?? 0} — ${match.teams[1].score ?? 0} ${match.teams[1].label}`;
  }
  if (match.sportType === 'PADEL' && match.resultSummary?.sets) {
    return (match.resultSummary.sets as string[]).join(' / ');
  }
  return null;
}

export default function MatchCard({ match }: { match: Match }) {
  const status = STATUS_LABEL[match.status] ?? STATUS_LABEL.SCHEDULED;
  const playersCount = match.players?.length ?? 0;
  const result = resultLine(match);

  return (
    <div className="card group flex flex-col overflow-hidden transition hover:border-pitch-500/50">
      <div
        className="relative flex aspect-video items-center justify-center bg-gradient-to-br from-ink-800 via-ink-800 to-ink-900 bg-cover bg-center"
        style={match.video?.posterUrl ? { backgroundImage: `url(${match.video.posterUrl})` } : undefined}
      >
        {/* Sin poster (todavía procesando, o no se pudo generar): ícono genérico como antes. */}
        {!match.video?.posterUrl && <span className="text-4xl opacity-30">{match.sportType === 'FUTBOL5' ? '⚽' : '🎾'}</span>}
        <span className={`badge absolute left-3 top-3 ${status.className}`}>{status.label}</span>
        {match.video?.durationSeconds ? (
          <span className="badge absolute bottom-3 right-3 bg-black/60 text-white">{formatDuration(match.video.durationSeconds)}</span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-white">{match.sportType === 'FUTBOL5' ? 'Fútbol 5' : 'Pádel'}</h3>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-ink-300">
          <span>📅 {formatDate(match.date)}</span>
          <span>⏰ {formatTime(match.startTime)}</span>
          <span className="col-span-2 truncate">📍 {match.complex?.name ?? '—'}</span>
          <span className="col-span-2">🏟 {match.court?.name ?? '—'}</span>
          <span>👥 {playersCount} jugadores</span>
        </div>
        {result && <p className="mt-1 text-xs font-medium text-ink-200">{result}</p>}

        <Link
          href={`/matches/${match.id}`}
          className={`btn-primary mt-3 w-full ${match.status !== 'READY' ? 'pointer-events-none opacity-40' : ''}`}
        >
          {match.status === 'READY' ? '▶ Ver partido' : status.label}
        </Link>
      </div>
    </div>
  );
}
