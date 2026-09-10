'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Notification {
  id: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

export default function NotificationsPage() {
  const [items, setItems] = useState<Notification[] | null>(null);

  useEffect(() => {
    api.get<Notification[]>('/notifications').then(setItems);
  }, []);

  async function markRead(id: string) {
    await api.patch(`/notifications/${id}/read`);
    setItems((prev) => prev?.map((n) => (n.id === id ? { ...n, read: true } : n)) ?? null);
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-bold text-white">Notificaciones</h1>
      <p className="mb-6 text-sm text-ink-400">Te avisamos cuando un partido tuyo queda disponible para reproducir.</p>

      {items?.length === 0 && <p className="text-ink-400">No tenés notificaciones todavía.</p>}

      <div className="space-y-3">
        {items?.map((n) => (
          <button
            key={n.id}
            onClick={() => markRead(n.id)}
            className={`card w-full p-4 text-left transition hover:border-pitch-500/40 ${n.read ? 'opacity-60' : ''}`}
          >
            <div className="flex items-center justify-between">
              <p className="font-medium text-white">{n.title}</p>
              {!n.read && <span className="h-2 w-2 rounded-full bg-pitch-400" />}
            </div>
            <p className="mt-1 text-sm text-ink-300">{n.body}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
