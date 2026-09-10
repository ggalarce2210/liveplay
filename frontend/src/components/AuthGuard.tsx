'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/auth-store';
import { getAccessToken } from '@/lib/api';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, initialized, fetchMe } = useAuthStore();

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace('/login');
      return;
    }
    if (!initialized) fetchMe();
  }, [initialized]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (initialized && !user) router.replace('/login');
  }, [initialized, user]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!initialized || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-950">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-pitch-500 border-t-transparent" />
      </div>
    );
  }

  return <>{children}</>;
}
