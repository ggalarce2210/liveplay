'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuthStore } from '@/lib/auth-store';
import { ApiError } from '@/lib/api';
import LogoMark from '@/components/LogoMark';

export default function RegisterPage() {
  const register = useAuthStore((s) => s.register);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [devVerifyUrl, setDevVerifyUrl] = useState<string | null>(null);
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await register(form);
      // Ya no queda logueado: el backend exige confirmar el email antes de poder entrar.
      setRegisteredEmail(res.user.email);
      setDevVerifyUrl(res.devVerifyUrl ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No pudimos crear tu cuenta');
    } finally {
      setLoading(false);
    }
  }

  if (registeredEmail) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-ink-950 px-6 py-12">
        <div className="w-full max-w-md text-center">
          <Link href="/" className="mb-8 inline-flex items-center gap-2 text-lg font-bold tracking-tight text-white">
            <LogoMark className="h-8 w-8" />
            <span>Live<span className="text-pitch-400">Play</span></span>
          </Link>
          <div className="card p-6">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-pitch-500/15 text-2xl">📩</div>
            <h1 className="text-lg font-bold text-white">¡Ya casi! Confirmá tu cuenta</h1>
            <p className="mt-2 text-sm text-ink-300">
              Te enviamos un email a <span className="font-semibold text-white">{registeredEmail}</span>. Hacé click en el link para
              activar tu cuenta — recién ahí vas a poder iniciar sesión.
            </p>
            {devVerifyUrl && (
              <div className="mt-4 rounded-lg border border-pitch-500/30 bg-pitch-500/10 p-3 text-xs text-ink-300">
                <p className="mb-1 font-semibold text-pitch-400">Modo demo — no hay SMTP configurado</p>
                <p>
                  En esta demo el email no se envía de verdad; usá este link para confirmar la cuenta ahora:{' '}
                  <Link href={devVerifyUrl.replace(/^https?:\/\/[^/]+/, '')} className="break-all text-pitch-400 underline">
                    {devVerifyUrl.replace(/^https?:\/\/[^/]+/, '')}
                  </Link>
                </p>
              </div>
            )}
            <Link href="/login" className="btn-secondary mt-5 w-full">Ir a iniciar sesión</Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-950 px-6 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-flex items-center gap-2 text-lg font-bold tracking-tight text-white">
            <LogoMark className="h-8 w-8" />
            <span>Live<span className="text-pitch-400">Play</span></span>
          </Link>
          <p className="mt-2 text-sm text-ink-300">Creá tu cuenta de jugador</p>
        </div>

        <form onSubmit={onSubmit} className="card space-y-4 p-6">
          {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-field">Nombre</label>
              <input required value={form.firstName} onChange={(e) => update('firstName', e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="label-field">Apellido</label>
              <input required value={form.lastName} onChange={(e) => update('lastName', e.target.value)} className="input-field" />
            </div>
          </div>
          <div>
            <label className="label-field">Email</label>
            <input type="email" required value={form.email} onChange={(e) => update('email', e.target.value)} className="input-field" placeholder="vos@email.com" />
          </div>
          <div>
            <label className="label-field">Teléfono (opcional)</label>
            <input value={form.phone} onChange={(e) => update('phone', e.target.value)} className="input-field" placeholder="+54 9 11 ..." />
          </div>
          <div>
            <label className="label-field">Contraseña</label>
            <input type="password" required minLength={8} value={form.password} onChange={(e) => update('password', e.target.value)} className="input-field" placeholder="Mínimo 8 caracteres" />
          </div>
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? 'Creando cuenta...' : 'Registrarme'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-ink-400">
          ¿Ya tenés cuenta?{' '}
          <Link href="/login" className="font-semibold text-pitch-400 hover:text-pitch-300">Iniciá sesión</Link>
        </p>
      </div>
    </main>
  );
}
