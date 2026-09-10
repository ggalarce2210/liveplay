'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import LogoMark from '@/components/LogoMark';
import { User } from '@/types';

type Status = 'checking' | 'success' | 'error';

function VerifyEmailInner() {
  const router = useRouter();
  const params = useSearchParams();
  const setSession = useAuthStore((s) => s.setSession);
  const [status, setStatus] = useState<Status>('checking');
  const [message, setMessage] = useState('Confirmando tu cuenta...');

  useEffect(() => {
    const token = params.get('token');
    if (!token) {
      setStatus('error');
      setMessage('Falta el token de confirmación en el link.');
      return;
    }
    (async () => {
      try {
        const res = await api.get<{ success: boolean; user: User; accessToken: string; refreshToken: string }>(
          `/auth/verify-email/${encodeURIComponent(token)}`,
        );
        setSession(res.user, res.accessToken, res.refreshToken);
        setStatus('success');
        setTimeout(() => router.push('/dashboard'), 1200);
      } catch (err) {
        setStatus('error');
        setMessage(err instanceof ApiError ? err.message : 'No pudimos confirmar la cuenta');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-950 px-6">
      <div className="w-full max-w-md text-center">
        <Link href="/" className="mb-8 inline-flex items-center gap-2 text-lg font-bold tracking-tight text-white">
          <LogoMark className="h-8 w-8" />
          <span>Live<span className="text-pitch-400">Play</span></span>
        </Link>
        <div className="card p-6">
          {status === 'checking' && (
            <>
              <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-pitch-500/30 border-t-pitch-400" />
              <p className="text-sm text-ink-300">{message}</p>
            </>
          )}
          {status === 'success' && (
            <>
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-pitch-500/15 text-2xl">✅</div>
              <h1 className="text-lg font-bold text-white">¡Cuenta confirmada!</h1>
              <p className="mt-2 text-sm text-ink-300">Ya iniciaste sesión. Te llevamos a tus partidos...</p>
            </>
          )}
          {status === 'error' && (
            <>
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-500/15 text-2xl">⚠️</div>
              <h1 className="text-lg font-bold text-white">No pudimos confirmar tu cuenta</h1>
              <p className="mt-2 text-sm text-ink-300">{message}</p>
              <Link href="/login" className="btn-secondary mt-5 w-full">Volver a iniciar sesión</Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailInner />
    </Suspense>
  );
}
