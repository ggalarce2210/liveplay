'use client';

import { useState } from 'react';
import { useAuthStore } from '@/lib/auth-store';
import { api } from '@/lib/api';

export default function ProfilePage() {
  const { user } = useAuthStore();
  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [lastName, setLastName] = useState(user?.lastName ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [saved, setSaved] = useState(false);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    await api.patch('/users/me', { firstName, lastName, phone });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-2xl font-bold text-white">Mi perfil</h1>
      <p className="mb-6 text-sm text-ink-400">{user?.email}</p>

      <form onSubmit={onSave} className="card space-y-4 p-6">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label-field">Nombre</label>
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className="input-field" />
          </div>
          <div>
            <label className="label-field">Apellido</label>
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} className="input-field" />
          </div>
        </div>
        <div>
          <label className="label-field">Teléfono</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className="input-field" />
        </div>
        <button type="submit" className="btn-primary">
          {saved ? '✓ Guardado' : 'Guardar cambios'}
        </button>
      </form>
    </div>
  );
}
