import { supabase } from "@/lib/supabase/client";
import { AuthMode, AuthSession, LoginPayload, LoginResponse } from "@/types/auth";

const STORAGE_KEY = "rqm.saas.auth";

function authMode(): AuthMode {
  return process.env.NEXT_PUBLIC_AUTH_MODE?.toLowerCase() === "local" ? "local" : "remote";
}

function baseUrl() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  }
  return url;
}

async function remoteLogin(payload: LoginPayload): Promise<LoginResponse> {
  const response = await fetch(`${baseUrl()}/functions/v1/auth-login-web`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    },
    body: JSON.stringify({
      login_name: payload.loginName,
      password: payload.password,
      source: "SITE",
    }),
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || !data.success) {
    return {
      success: false,
      message: String(data.message ?? "Falha ao autenticar."),
    };
  }

  const session: AuthSession = {
    source: "remote",
    accessToken: String(data.access_token ?? ""),
    refreshToken: String(data.refresh_token ?? ""),
    expiresIn: Number(data.expires_in ?? 0),
    tokenType: String(data.token_type ?? "bearer"),
    user: {
      userId: String(data.user_id ?? ""),
      role: String(data.role ?? ""),
      tenantId: String(data.tenant_id ?? ""),
      loginName: String(data.login_name ?? payload.loginName),
      loginAuditId: data.login_audit_id ? String(data.login_audit_id) : null,
    },
  };

  if (supabase) {
    await supabase.auth.setSession({
      access_token: session.accessToken,
      refresh_token: session.refreshToken,
    });
  }

  persistSession(session);

  return {
    success: true,
    message: String(data.message ?? "OK"),
    session,
  };
}

async function localLogin(payload: LoginPayload): Promise<LoginResponse> {
  const response = await fetch("/api/auth/local-login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      login_name: payload.loginName,
      password: payload.password,
    }),
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || !data.success) {
    return {
      success: false,
      message: String(data.message ?? "Falha ao autenticar localmente."),
    };
  }

  const session: AuthSession = {
    source: "local",
    accessToken: String(data.access_token ?? "local-token"),
    refreshToken: String(data.refresh_token ?? "local-refresh"),
    expiresIn: Number(data.expires_in ?? 43_200),
    tokenType: String(data.token_type ?? "bearer"),
    user: {
      userId: String(data.user_id ?? "local-user"),
      role: String(data.role ?? "admin"),
      tenantId: String(data.tenant_id ?? "local-tenant"),
      loginName: String(data.login_name ?? payload.loginName),
      loginAuditId: data.login_audit_id ? String(data.login_audit_id) : null,
    },
  };

  persistSession(session);

  return {
    success: true,
    message: String(data.message ?? "OK"),
    session,
  };
}

export async function login(payload: LoginPayload): Promise<LoginResponse> {
  return authMode() === "local" ? localLogin(payload) : remoteLogin(payload);
}

export function persistSession(session: AuthSession) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function readPersistedSession(): AuthSession | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

export async function clearPersistedSession() {
  const session = readPersistedSession();
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(STORAGE_KEY);
  }

  if (session?.source === "remote" && session.user.loginAuditId) {
    await fetch(`${baseUrl()}/functions/v1/logout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify({
        login_audit_id: session.user.loginAuditId,
        reason: "USER_LOGOUT",
        source: "SITE",
      }),
    }).catch(() => null);
  }

  if (session?.source === "remote" && supabase) {
    await supabase.auth.signOut();
  }
}
