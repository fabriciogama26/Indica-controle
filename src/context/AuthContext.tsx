"use client";

import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { supabase } from "@/lib/supabase/client";
import {
  clearPersistedSession,
  login as loginService,
  readPersistedSession,
} from "@/services/auth/auth.service";
import { AuthSession, LoginPayload } from "@/types/auth";

type AuthContextValue = {
  session: AuthSession | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (payload: LoginPayload) => Promise<{ success: boolean; message: string }>;
  logout: () => Promise<{ success: boolean; message: string | null }>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function hydrate() {
      const persisted = readPersistedSession();

      if (persisted?.source === "remote" && persisted.accessToken && persisted.refreshToken && supabase) {
        await supabase.auth
          .setSession({
            access_token: persisted.accessToken,
            refresh_token: persisted.refreshToken,
          })
          .catch(() => null);
      }

      if (active) {
        setSession(persisted);
        setIsLoading(false);
      }
    }

    hydrate();

    if (!supabase) {
      return () => {
        active = false;
      };
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      if (!currentSession && active) {
        setSession((current) => (current?.source === "remote" ? null : current));
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const login = useCallback(async (payload: LoginPayload) => {
    const result = await loginService(payload);
    if (result.success && result.session) {
      setSession(result.session);
    }
    return { success: result.success, message: result.message };
  }, []);

  const logout = useCallback(async () => {
    const result = await clearPersistedSession();
    setSession(null);
    return result;
  }, []);

  const value = useMemo(
    () => ({
      session,
      isAuthenticated: Boolean(session?.user.userId),
      isLoading,
      login,
      logout,
    }),
    [isLoading, login, logout, session],
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
