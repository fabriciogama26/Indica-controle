"use client";

import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { supabase } from "@/lib/supabase/client";
import {
  clearPersistedSession,
  hydrateSessionAccess,
  login as loginService,
  readPersistedSession,
  syncRemoteSessionTokens,
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
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "mousemove", "touchstart", "scroll"] as const;

function resolveIdleTimeoutMs() {
  const configuredMinutes = Number(process.env.NEXT_PUBLIC_SESSION_IDLE_TIMEOUT_MINUTES ?? 30);
  if (!Number.isFinite(configuredMinutes) || configuredMinutes <= 0) {
    return 30 * 60_000;
  }

  return configuredMinutes * 60_000;
}

const SESSION_IDLE_TIMEOUT_MS = resolveIdleTimeoutMs();

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const logoutInProgressRef = useRef(false);
  const lastActivityRef = useRef(0);

  const expireSession = useCallback(async (reason: string, feedbackMessage: string) => {
    logoutInProgressRef.current = true;

    await clearPersistedSession({
      reason,
      feedbackMessage,
      skipSupabaseSignOut: reason === "TOKEN_EXPIRED",
    }).catch(() => null);

    setSession(null);
  }, []);

  useEffect(() => {
    let active = true;

    async function hydrate() {
      const persisted = readPersistedSession();
      if (!persisted) {
        if (active) {
          setSession(null);
          setIsLoading(false);
        }
        return;
      }

      if (persisted.source === "remote" && persisted.accessToken && persisted.refreshToken && supabase) {
        const { data, error } = await supabase.auth.setSession({
          access_token: persisted.accessToken,
          refresh_token: persisted.refreshToken,
        });

        if (error) {
          await clearPersistedSession({
            reason: "TOKEN_EXPIRED",
            feedbackMessage: "Sua sessao expirou. Entre novamente.",
            skipSupabaseSignOut: true,
          }).catch(() => null);

          if (active) {
            setSession(null);
            setIsLoading(false);
          }
          return;
        }

        const syncedSession = data.session ? syncRemoteSessionTokens(data.session, persisted) : persisted;
        const hydratedSession = await hydrateSessionAccess(syncedSession);

        if (active) {
          setSession(hydratedSession);
          setIsLoading(false);
        }
        return;
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
    } = supabase.auth.onAuthStateChange((event, currentSession) => {
      if (!active) {
        return;
      }

      if ((event === "TOKEN_REFRESHED" || event === "SIGNED_IN") && currentSession) {
        setSession((current) => {
          const nextSession = syncRemoteSessionTokens(currentSession, current);
          return nextSession ?? current;
        });
        return;
      }

      if (!currentSession) {
        if (logoutInProgressRef.current) {
          logoutInProgressRef.current = false;
          return;
        }

        void expireSession("TOKEN_EXPIRED", "Sua sessao expirou. Entre novamente.");
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [expireSession]);

  useEffect(() => {
    if (!session) {
      return;
    }

    lastActivityRef.current = Date.now();

    function touchSession() {
      lastActivityRef.current = Date.now();
    }

    ACTIVITY_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, touchSession, { passive: true });
    });

    const intervalId = window.setInterval(() => {
      if (logoutInProgressRef.current) {
        return;
      }

      if (Date.now() - lastActivityRef.current < SESSION_IDLE_TIMEOUT_MS) {
        return;
      }

      void expireSession("IDLE_TIMEOUT", "Sua sessao expirou por inatividade. Entre novamente.");
    }, 15_000);

    return () => {
      ACTIVITY_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, touchSession);
      });
      window.clearInterval(intervalId);
    };
  }, [expireSession, session]);

  const login = useCallback(async (payload: LoginPayload) => {
    const result = await loginService(payload);
    if (result.success && result.session) {
      lastActivityRef.current = Date.now();
      logoutInProgressRef.current = false;
      setSession(result.session);
    }
    return { success: result.success, message: result.message };
  }, []);

  const logout = useCallback(async () => {
    logoutInProgressRef.current = true;
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
