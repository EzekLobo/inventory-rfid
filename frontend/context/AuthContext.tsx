"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { CurrentUser } from "@/lib/types";

type AuthContextValue = {
  user: CurrentUser | null;
  authenticated: boolean;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<CurrentUser | null>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const hasAuth = api.isAuthenticated();
      if (!hasAuth) {
        if (!cancelled) {
          setUser(null);
          setAuthenticated(false);
          setLoading(false);
        }
        return;
      }

      const storedUser = api.currentUser();
      if (storedUser) {
        if (!cancelled) {
          setUser(storedUser);
          setAuthenticated(true);
          setLoading(false);
        }
        return;
      }

      try {
        const current = await api.me();
        if (!cancelled) {
          setUser(current);
          api.rememberUser(current);
          setAuthenticated(true);
        }
      } catch {
        api.logout();
        if (!cancelled) {
          setUser(null);
          setAuthenticated(false);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    init();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = async (username: string, password: string) => {
    await api.login(username, password);
    setUser(api.currentUser());
    setAuthenticated(true);
  };

  const logout = () => {
    api.logout();
    setUser(null);
    setAuthenticated(false);
  };

  const refreshUser = async () => {
    const current = await api.me();
    setUser(current);
    api.rememberUser(current);
    setAuthenticated(true);
    return current;
  };

  const value = useMemo(
    () => ({ user, authenticated, loading, login, logout, refreshUser }),
    [user, authenticated, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
