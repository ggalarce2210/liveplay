'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import LogoMark from '@/components/LogoMark';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
    } finally {
      setLoading(false);
      setSent(true);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-950 px-6">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-flex items-center gap-2 text-lg font-bold tracking-tight text-white">
            <LogoMark className="h-8 w-8" />
            <span>Live<span className="text-pitch-400">Play</span></span>
          </Link>
          <p className="mt-2 text-sm text-ink-300">Recuperar contraseña</p>
        </div>
        <div className="card p-6">
          {sent ? (
            <p className="text-sm text-ink-200">
              Si existe una cuenta con ese email, te enviamos un link para elegir una nueva contraseña. (En esta demo, el email se
              muestra en la consola del backend — no hay un proveedor SMTP real configurado.)
            </p>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="label-field">Email</label>
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="input-field" />
              </div>
              <button type="submit" disabled={loading} className="btn-primary w-full">
                {loading ? 'Enviando...' : 'Enviar enlace de recuperación'}
              </button>
            </form>
          )}
        </div>
        <p className="mt-6 text-center text-sm text-ink-400">
          <Link href="/login" className="font-semibold text-pitch-400 hover:text-pitch-300">Volver a iniciar sesión</Link>
        </p>
      </div>
    </main>
  );
}
