"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  loginWithToken: (accessToken: string, refreshToken: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchMe() {
    try {
      const me = await api.get<User>("/auth/me");
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (typeof window !== "undefined" && window.localStorage.getItem("beep_access_token")) {
      fetchMe();
    } else {
      setLoading(false);
    }
  }, []);

  async function loginWithToken(accessToken: string, refreshToken: string) {
    window.localStorage.setItem("beep_access_token", accessToken);
    window.localStorage.setItem("beep_refresh_token", refreshToken);
    await fetchMe();
  }

  function logout() {
    window.localStorage.removeItem("beep_access_token");
    window.localStorage.removeItem("beep_refresh_token");
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, loginWithToken, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de <AuthProvider>");
  return ctx;
}
