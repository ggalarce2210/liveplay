'use client';

import { useEffect, useState } from 'react';
import AuthGuard from '@/components/AuthGuard';
import AppShell from '@/components/AppShell';
import { api } from '@/lib/api';
import { formatBytes } from '@/lib/format';

interface Stats {
  totalUsers: number;
  totalMatches: number;
  recordedHours: number;
  activeCourts: number;
  camerasOnline: number;
  camerasTotal: number;
  totalClips: number;
}

interface Storage {
  quotaBytes: number;
  usedBytes: number;
  availableBytes: number;
  heaviestVideos: any[];
  failedVideos: any[];
  oldMatchesCount: number;
}

interface Camera {
  id: string;
  name: string;
  status: 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
  lastSeenAt: string | null;
  court: { name: string; complex: { name: string } };
}

const STAT_CARDS: { key: keyof Stats; label: string; icon: string }[] = [
  { key: 'totalUsers', label: 'Usuarios registrados', icon: '👥' },
  { key: 'totalMatches', label: 'Partidos grabados', icon: '🎬' },
  { key: 'recordedHours', label: 'Horas grabadas', icon: '⏱' },
  { key: 'activeCourts', label: 'Canchas activas', icon: '🏟' },
  { key: 'camerasOnline', label: 'Camaras online', icon: '📷' },
  { key: 'totalClips', label: 'Clips generados', icon: '⭐' },
];

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [storage, setStorage] = useState<Storage | null>(null);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function loadStorage() {
    api.get<Storage>('/admin/storage').then(setStorage);
  }

  useEffect(() => {
    api.get<Stats>('/admin/stats').then(setStats);
    loadStorage();
    api.get<Camera[]>('/cameras').then(setCameras);
  }, []);

  async function onDeleteVideo(id: string) {
    if (!confirm('Borrar este video? Esta accion no se puede deshacer - el partido queda sin video.')) return;
    setDeletingId(id);
    try {
      await api.delete(`/videos/${id}`);
      loadStorage();
    } catch {
      alert('No se pudo borrar el video.');
    } finally {
      setDeletingId(null);
    }
  }

  const usedPct = storage ? (storage.usedBytes / storage.quotaBytes) * 100 : 0;

  return (
    <AuthGuard>
      <AppShell>
        <div>
          <div className="mx-auto max-w-6xl px-6 py-8">
            <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-bold text-white">Panel de administracion</h1>
                <p className="text-sm text-ink-400">Estadisticas generales, camaras y almacenamiento.</p>
              </div>
              <a href="/admin/canchas" className="btn-secondary">
                🎥 Canchas y camaras
              </a>
            </div>

            <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {STAT_CARDS.map((c) => (
                <div key={c.key} className="card p-5">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{c.icon}</span>
                    <div>
                      <p className="text-2xl font-bold text-white">{stats ? stats[c.key] : '-'}</p>
                      <p className="text-xs text-ink-400">{c.label}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mb-8 grid gap-6 lg:grid-cols-2">
              <div className="card p-5">
                <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink-300">Estado de camaras</h2>
                <div className="space-y-2">
                  {cameras.map((cam) => (
                    <div key={cam.id} className="flex items-center justify-between rounded-lg bg-ink-800/50 px-3 py-2 text-sm">
                      <div>
                        <p className="text-white">{cam.name}</p>
                        <p className="text-xs text-ink-400">
                          {cam.court?.complex?.name} · {cam.court?.name}
                        </p>
                      </div>
                      <span className={cam.status === 'ONLINE' ? 'text-pitch-400' : 'text-red-400'}>
                        {cam.status === 'ONLINE' ? '🟢 Online' : '🔴 Offline'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card p-5">
                <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink-300">Almacenamiento</h2>
                {storage && (
                  <>
                    <div className="mb-2 h-3 w-full overflow-hidden rounded-full bg-ink-800">
                      <div className="h-full bg-pitch-500" style={{ width: `${Math.min(100, usedPct)}%` }} />
                    </div>
                    <p className="text-sm text-ink-300">
                      {formatBytes(storage.usedBytes)} / {formatBytes(storage.quotaBytes)}
                    </p>
                    <p className="mt-3 text-xs text-ink-400">{storage.oldMatchesCount} partidos con mas de 90 dias (candidatos a politica de retencion).</p>
                    <h3 className="mb-2 mt-4 text-xs font-semibold uppercase text-ink-400">Videos mas pesados</h3>
                    <div className="space-y-1 text-xs text-ink-300">
                      {storage.heaviestVideos.slice(0, 5).map((v: any) => (
                        <div key={v.id} className="flex items-center justify-between gap-2">
                          <span>
                            {v.match?.court?.name} · {v.match?.date}
                          </span>
                          <span className="flex items-center gap-2">
                            {formatBytes(v.sizeBytes ?? 0)}
                            <button
                              type="button"
                              onClick={() => onDeleteVideo(v.id)}
                              disabled={deletingId === v.id}
                              className="text-red-400 hover:text-red-300 disabled:opacity-50"
                              title="Borrar video"
                            >
                              {deletingId === v.id ? '…' : '🗑'}
                            </button>
                          </span>
                        </div>
                      ))}
                    </div>

                    {storage.failedVideos.length > 0 && (
                      <>
                        <h3 className="mb-2 mt-4 text-xs font-semibold uppercase text-ink-400">
                          Videos con error ({storage.failedVideos.length})
                        </h3>
                        <div className="space-y-1 text-xs text-ink-300">
                          {storage.failedVideos.map((v: any) => (
                            <div key={v.id} className="flex items-center justify-between gap-2">
                              <span>
                                {v.match?.court?.name} · {v.match?.date}
                              </span>
                              <span className="flex items-center gap-2">
                                <span className="text-red-400">Error</span>
                                <button
                                  type="button"
                                  onClick={() => onDeleteVideo(v.id)}
                                  disabled={deletingId === v.id}
                                  className="text-red-400 hover:text-red-300 disabled:opacity-50"
                                  title="Borrar video"
                                >
                                  {deletingId === v.id ? '…' : '🗑'}
                                </button>
                              </span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </AppShell>
    </AuthGuard>
  );
}
