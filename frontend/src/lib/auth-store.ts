'use client';

import { create } from 'zustand';
import { User } from '@/types';
import { api, setTokens, clearTokens } from './api';

interface RegisterResult {
  user: User;
  requiresEmailVerification: true;
  devVerifyUrl?: string;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  initialized: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { email: string; password: string; firstName: string; lastName: string; phone?: string }) => Promise<RegisterResult>;
  logout: () => Promise<void>;
  fetchMe: () => Promise<void>;
  setSession: (user: User, accessToken: string, refreshToken: string) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  loading: false,
  initialized: false,

  async login(email, password) {
    set({ loading: true });
    try {
      const data = await api.post<{ user: User; accessToken: string; refreshToken: string }>('/auth/login', { email, password });
      setTokens(data.accessToken, data.refreshToken);
      set({ user: data.user, loading: false, initialized: true });
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  async register(data) {
    set({ loading: true });
    try {
      // El registro YA NO deja logueado: el backend exige confirmar el email antes de poder
      // iniciar sesión (§3/§38). No hay tokens que guardar todavía.
      const res = await api.post<RegisterResult>('/auth/register', data);
      set({ loading: false });
      return res;
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  async logout() {
    clearTokens();
    set({ user: null });
  },

  async fetchMe() {
    if (get().loading) return;
    set({ loading: true });
    try {
      const user = await api.get<User | null>('/auth/me');
      set({ user, loading: false, initialized: true });
    } catch {
      set({ user: null, loading: false, initialized: true });
    }
  },

  setSession(user, accessToken, refreshToken) {
    setTokens(accessToken, refreshToken);
    set({ user, loading: false, initialized: true });
  },
}));
