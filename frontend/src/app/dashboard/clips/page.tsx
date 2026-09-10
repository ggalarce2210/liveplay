'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Clip } from '@/types';
import { formatDate, formatTime } from '@/lib/format';

const STATUS_LABEL: Record<string, string> = { PENDING: 'Generando…', READY: 'Listo', FAILED: 'Error' };

export default function ClipsPage() {
  const [clips, setClips] = useState<Clip[] | null>(null);

  useEffect(() => {
    api.get<Clip[]>('/clips').then(setClips);
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-2xl font-bold text-white">Mis mejores momentos</h1>
      <p className="mb-6 text-sm text-ink-400">Clips que generaste a partir de tus partidos (§16).</p>

      {clips === null && <p className="text-ink-400">Cargando...</p>}
      {clips?.length === 0 && (
        <div className="card flex flex-col items-center justify-center gap-2 py-16 text-center">
          <span className="text-4xl">⭐</span>
          <p className="font-medium text-white">Todavía no creaste ningún clip</p>
          <p className="text-sm text-ink-400">Abrí un partido, marcá el inicio y el fin de una jugada, y creá tu primer clip.</p>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {clips?.map((clip) => (
          <div key={clip.id} className="card p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-semibold text-white">{clip.title}</h3>
              <span className="badge bg-ink-700 text-ink-200">{STATUS_LABEL[clip.status]}</span>
            </div>
            {clip.match && (
              <p className="text-sm text-ink-400">
                {formatDate(clip.match.date)} · {formatTime(clip.match.startTime)} · {clip.match.court?.name}
              </p>
            )}
            <p className="mt-1 text-xs text-ink-500">
              {clip.startSeconds.toFixed(0)}s → {clip.endSeconds.toFixed(0)}s ({(clip.endSeconds - clip.startSeconds).toFixed(0)}s)
            </p>
            <Link href={`/matches/${clip.matchId}`} className="btn-secondary mt-3 w-full !py-2 text-sm">
              Ver partido
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
