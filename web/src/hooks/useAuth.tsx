import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { setUnauthorizedHandler, tokenStore } from '../api/client';
import { authApi } from '../api/endpoints';
import type { Member } from '../types/api';

interface AuthState {
  token: string | null;
  leader: Member | null;
  loading: boolean;
  signIn: (token: string) => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [token, setToken] = useState<string | null>(() => tokenStore.get());

  const signOut = useCallback(() => {
    tokenStore.clear();
    setToken(null);
    qc.clear();
  }, [qc]);

  const signIn = useCallback(
    (t: string) => {
      tokenStore.set(t);
      qc.clear();
      setToken(t);
    },
    [qc],
  );

  useEffect(() => setUnauthorizedHandler(signOut), [signOut]);

  const me = useQuery({ queryKey: ['me', token], queryFn: authApi.me, enabled: Boolean(token), retry: false });

  const value = useMemo<AuthState>(
    () => ({ token, leader: me.data?.member ?? null, loading: Boolean(token) && me.isLoading, signIn, signOut }),
    [token, me.data, me.isLoading, signIn, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
