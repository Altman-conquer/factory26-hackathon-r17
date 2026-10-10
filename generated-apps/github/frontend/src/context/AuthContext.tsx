import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import apiClient from '../api';

type Account = {
  id: number;
  username: string;
  email: string;
  verified: boolean;
};

type AuthContextValue = {
  account: Account | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await apiClient.get('/auth/me');
      setAccount(response.data.account);
    } catch {
      setAccount(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await apiClient.post('/auth/signout');
    } catch {
      // The server is authoritative; clearing the local view is sufficient here.
    }
    setAccount(null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ account, loading, refresh, signOut }),
    [account, loading, refresh, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}
