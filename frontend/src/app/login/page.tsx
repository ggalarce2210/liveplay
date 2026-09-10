'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/lib/auth-store';
import { ApiError, api } from '@/lib/api';
import LogoMark from '@/components/LogoMark';
import IntroSplash from '@/components/IntroSplash';

export default function LoginPage() {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);
  const [showIntro, setShowIntro] = useState(true);
  const [email, setEmail] = useState('juan@demo.com');
  const [password, setPassword] = useState('demo1234');
  const [error, setError] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [devVerifyUrl, setDevVerifyUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNeedsVerification(false);
    setDevVerifyUrl(null);
    setLoading(true);
    try {
      await login(email, password);
      router.push('/dashboard');
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setNeedsVerification(true);
        setError(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : 'No pudimos iniciar sesión');
      }
    } finally {
      setLoading(false);
    }
  }

  async function onResend() {
    setResendState('sending');
    try {
      const res = await api.post<{ success: boolean; devVerifyUrl?: string }>('/auth/resend-verification', { email });
      setResendState('sent');
      if (res.devVerifyUrl) setDevVerifyUrl(res.devVerifyUrl);
    } catch {
      setResendState('idle');
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-950 px-6">
      {showIntro && <IntroSplash onDone={() => setShowIntro(false)} />}

      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-flex items-center gap-2 text-lg font-bold tracking-tight text-white">
            <LogoMark className="h-8 w-8" />
            <span>Live<span className="text-pitch-400">Play</span></span>
          </Link>
          <p className="mt-2 text-sm text-ink-300">Iniciá sesión para ver tus partidos</p>
        </div>

        <form onSubmit={onSubmit} className="card space-y-4 p-6">
          {error && (
            <div className="space-y-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
              <p>{error}</p>
              {needsVerification && (
                <div className="space-y-2 border-t border-red-500/20 pt-2">
                  <button
                    type="button"
                    onClick={onResend}
                    disabled={resendState !== 'idle'}
                    className="font-semibold text-pitch-400 hover:text-pitch-300 disabled:opacity-60"
                  >
                    {resendState === 'sent' ? '✓ Te reenviamos el email' : resendState === 'sending' ? 'Enviando...' : 'Reenviar email de confirmación'}
                  </button>
                  {devVerifyUrl && (
                    <p className="text-xs text-ink-400">
                      Modo demo (sin SMTP real):{' '}
                      <Link href={devVerifyUrl.replace(/^https?:\/\/[^/]+/, '')} className="text-pitch-400 underline">
                        confirmar cuenta acá
                      </Link>
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          <div>
            <label className="label-field">Email</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="input-field" placeholder="vos@email.com" />
          </div>
          <div>
            <label className="label-field">Contraseña</label>
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="input-field" placeholder="••••••••" />
          </div>
          <div className="flex items-center justify-between text-sm">
            <Link href="/forgot-password" className="text-ink-400 hover:text-pitch-400">¿Olvidaste tu contraseña?</Link>
          </div>
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? 'Ingresando...' : 'Iniciar sesión'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-ink-400">
          ¿No tenés cuenta?{' '}
          <Link href="/register" className="font-semibold text-pitch-400 hover:text-pitch-300">Registrate</Link>
        </p>
      </div>
    </main>
  );
}
