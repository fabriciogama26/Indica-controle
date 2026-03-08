import { Session as SupabaseSession } from "@supabase/supabase-js";

import { resolveDefaultPageAccess } from "@/lib/auth/authorization";
import { supabase } from "@/lib/supabase/client";
import { AuthMode, AuthSession, LoginPayload, LoginResponse } from "@/types/auth";

const STORAGE_KEY = "INDICA.saas.auth";
const AUTH_FEEDBACK_KEY = "INDICA.saas.auth.feedback";

type PasswordLinkType = "invite" | "recovery";

type ClearSessionOptions = {
  reason?: string;
  source?: string;
  feedbackMessage?: string | null;
  skipRemoteLogout?: boolean;
  skipSupabaseSignOut?: boolean;
};

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

function toExpiresAt(expiresIn: number, expiresAt?: unknown) {
  if (typeof expiresAt === "number" && Number.isFinite(expiresAt)) {
    return expiresAt;
  }

  if (typeof expiresAt === "string" && expiresAt.trim()) {
    const parsed = Number(expiresAt);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  if (Number.isFinite(expiresIn) && expiresIn > 0) {
    return Math.floor(Date.now() / 1000) + expiresIn;
  }

  return null;
}

async function fetchSessionAccess(accessToken: string) {
  const response = await fetch("/api/auth/session-access", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || !data.user) {
    return null;
  }

  return {
    user: data.user as Record<string, unknown>,
    pageAccess: Array.isArray(data.pageAccess) ? data.pageAccess.map((value) => String(value)) : [],
    hasCustomPermissions: Boolean(data.hasCustomPermissions),
  };
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

  const expiresIn = Number(data.expires_in ?? 0);
  const access = await fetchSessionAccess(String(data.access_token ?? ""));
  const resolvedRole = String(access?.user.role ?? data.role ?? "");
  const resolvedRoleId = access?.user.roleId ? String(access.user.roleId) : data.role_id ? String(data.role_id) : null;
  const resolvedLoginName = String(access?.user.loginName ?? data.login_name ?? payload.loginName);
  const resolvedDisplayName = access?.user.displayName ? String(access.user.displayName) : data.display_name ? String(data.display_name) : null;
  const session: AuthSession = {
    source: "remote",
    accessToken: String(data.access_token ?? ""),
    refreshToken: String(data.refresh_token ?? ""),
    expiresIn,
    expiresAt: toExpiresAt(expiresIn, data.expires_at),
    tokenType: String(data.token_type ?? "bearer"),
    user: {
      userId: String(data.user_id ?? ""),
      role: resolvedRole,
      roleId: resolvedRoleId,
      tenantId: String(access?.user.tenantId ?? data.tenant_id ?? ""),
      loginName: resolvedLoginName,
      displayName: resolvedDisplayName,
      pageAccess: access?.pageAccess ?? resolveDefaultPageAccess(resolvedRole),
      hasCustomPermissions: access?.hasCustomPermissions ?? false,
      loginAuditId: data.login_audit_id ? String(data.login_audit_id) : null,
      sessionRef: data.session_ref ? String(data.session_ref) : null,
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

  const expiresIn = Number(data.expires_in ?? 43_200);
  const role = String(data.role ?? "admin");
  const session: AuthSession = {
    source: "local",
    accessToken: String(data.access_token ?? "local-token"),
    refreshToken: String(data.refresh_token ?? "local-refresh"),
    expiresIn,
    expiresAt: toExpiresAt(expiresIn, data.expires_at),
    tokenType: String(data.token_type ?? "bearer"),
    user: {
      userId: String(data.user_id ?? "local-user"),
      role,
      roleId: data.role_id ? String(data.role_id) : null,
      tenantId: String(data.tenant_id ?? "local-tenant"),
      loginName: String(data.login_name ?? payload.loginName),
      displayName: data.display_name ? String(data.display_name) : String(data.login_name ?? payload.loginName),
      pageAccess: resolveDefaultPageAccess(role),
      hasCustomPermissions: false,
      loginAuditId: data.login_audit_id ? String(data.login_audit_id) : null,
      sessionRef: data.session_ref ? String(data.session_ref) : null,
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

function parseErrorMessage(data: Record<string, unknown>, fallback: string) {
  const nestedError =
    typeof data.error === "object" && data.error !== null ? (data.error as Record<string, unknown>) : null;

  return String(nestedError?.message ?? data.message ?? fallback);
}

function normalizePasswordLinkType(value: string | null): PasswordLinkType | null {
  if (value === "invite" || value === "recovery") {
    return value;
  }

  return null;
}

function clearLocalAppSessionStorage() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

function writeAuthFeedback(message: string | null | undefined) {
  if (typeof window === "undefined") return;

  if (!message) {
    window.localStorage.removeItem(AUTH_FEEDBACK_KEY);
    return;
  }

  window.localStorage.setItem(AUTH_FEEDBACK_KEY, message);
}

export function consumeAuthFeedback() {
  if (typeof window === "undefined") return null;

  const message = window.localStorage.getItem(AUTH_FEEDBACK_KEY);
  if (!message) {
    return null;
  }

  window.localStorage.removeItem(AUTH_FEEDBACK_KEY);
  return message;
}

export function syncRemoteSessionTokens(currentSession: SupabaseSession, currentAppSession: AuthSession | null) {
  if (!currentAppSession || currentAppSession.source !== "remote") {
    return currentAppSession;
  }

  const nextSession: AuthSession = {
    ...currentAppSession,
    accessToken: currentSession.access_token,
    refreshToken: currentSession.refresh_token,
    expiresIn: Number(currentSession.expires_in ?? currentAppSession.expiresIn),
    expiresAt: toExpiresAt(
      Number(currentSession.expires_in ?? currentAppSession.expiresIn),
      currentSession.expires_at ?? currentAppSession.expiresAt,
    ),
    tokenType: currentSession.token_type ?? currentAppSession.tokenType,
  };

  persistSession(nextSession);
  return nextSession;
}

export async function hydrateSessionAccess(currentAppSession: AuthSession) {
  if (currentAppSession.source !== "remote") {
    return currentAppSession;
  }

  const access = await fetchSessionAccess(currentAppSession.accessToken);
  if (!access) {
    return {
      ...currentAppSession,
      user: {
        ...currentAppSession.user,
        pageAccess: currentAppSession.user.pageAccess?.length
          ? currentAppSession.user.pageAccess
          : resolveDefaultPageAccess(currentAppSession.user.role),
        hasCustomPermissions: currentAppSession.user.hasCustomPermissions ?? false,
      },
    };
  }

  const nextSession: AuthSession = {
    ...currentAppSession,
    user: {
      ...currentAppSession.user,
      userId: String(access.user.userId ?? currentAppSession.user.userId),
      role: String(access.user.role ?? currentAppSession.user.role),
      roleId: access.user.roleId ? String(access.user.roleId) : currentAppSession.user.roleId,
      tenantId: String(access.user.tenantId ?? currentAppSession.user.tenantId),
      loginName: String(access.user.loginName ?? currentAppSession.user.loginName),
      displayName: access.user.displayName ? String(access.user.displayName) : currentAppSession.user.displayName,
      pageAccess: access.pageAccess,
      hasCustomPermissions: access.hasCustomPermissions,
    },
  };

  persistSession(nextSession);
  return nextSession;
}

export async function requestPasswordRecovery(loginName: string) {
  if (authMode() === "local") {
    return {
      success: false,
      message: "Recuperacao de senha indisponivel em modo local.",
    };
  }

  const response = await fetch(`${baseUrl()}/functions/v1/auth-recover`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    },
    body: JSON.stringify({
      login_name: loginName,
    }),
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || !data.ok) {
    return {
      success: false,
      message: parseErrorMessage(data, "Falha ao solicitar a recuperacao de senha."),
    };
  }

  return {
    success: true,
    message: "Se o login estiver cadastrado, voce recebera um email com instrucoes.",
  };
}

function cleanupAuthCallbackUrl() {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  url.searchParams.delete("code");
  url.searchParams.delete("type");
  url.searchParams.delete("token_hash");
  url.hash = "";
  window.history.replaceState({}, document.title, url.toString());
}

export async function resolvePasswordFlow(): Promise<{
  success: boolean;
  mode: "request" | "update";
  message: string | null;
}> {
  if (!supabase) {
    return {
      success: false,
      mode: "request",
      message: "Supabase nao configurado no frontend.",
    };
  }

  const url = typeof window !== "undefined" ? new URL(window.location.href) : null;
  const tokenHash = url?.searchParams.get("token_hash");
  const linkType = normalizePasswordLinkType(url?.searchParams.get("type") ?? null);
  const code = url?.searchParams.get("code");

  if (tokenHash && linkType) {
    clearLocalAppSessionStorage();

    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: linkType,
    });

    if (error) {
      return {
        success: false,
        mode: "request",
        message: "Link invalido ou expirado. Solicite um novo acesso.",
      };
    }

    cleanupAuthCallbackUrl();
    return {
      success: true,
      mode: "update",
      message: null,
    };
  }

  if (code) {
    clearLocalAppSessionStorage();

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return {
        success: false,
        mode: "request",
        message: "Link invalido ou expirado. Solicite uma nova recuperacao.",
      };
    }

    cleanupAuthCallbackUrl();
    return {
      success: true,
      mode: "update",
      message: null,
    };
  }

  const hashParams =
    typeof window !== "undefined" ? new URLSearchParams(window.location.hash.replace(/^#/, "")) : null;
  const accessToken = hashParams?.get("access_token");
  const refreshToken = hashParams?.get("refresh_token");
  const type = hashParams?.get("type");

  if (accessToken && refreshToken && (type === "recovery" || type === "invite")) {
    clearLocalAppSessionStorage();

    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (error) {
      return {
        success: false,
        mode: "request",
        message: "Nao foi possivel validar o link recebido. Solicite um novo acesso.",
      };
    }

    cleanupAuthCallbackUrl();
    return {
      success: true,
      mode: "update",
      message: null,
    };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session) {
    return {
      success: true,
      mode: "update",
      message: null,
    };
  }

  return {
    success: true,
    mode: "request",
    message: null,
  };
}

export async function updatePassword(password: string) {
  if (!supabase) {
    return {
      success: false,
      message: "Supabase nao configurado no frontend.",
    };
  }

  const { error } = await supabase.auth.updateUser({
    password,
  });

  if (error) {
    return {
      success: false,
      message: error.message || "Falha ao atualizar a senha.",
    };
  }

  clearLocalAppSessionStorage();
  await supabase.auth.signOut().catch(() => null);

  return {
    success: true,
    message: "Senha atualizada com sucesso. Voce ja pode entrar no sistema.",
  };
}

export async function clearPersistedSession(options: ClearSessionOptions = {}) {
  const session = readPersistedSession();
  const reason = options.reason ?? "USER_LOGOUT";
  const source = options.source ?? "SITE";
  let logoutAuditError: string | null = null;

  if (!options.skipRemoteLogout && session?.source === "remote" && (session.user.loginAuditId || session.user.sessionRef)) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    };

    if (session.accessToken) {
      headers.Authorization = `Bearer ${session.accessToken}`;
    }

    const response = await fetch(`${baseUrl()}/functions/v1/logout`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        login_audit_id: session.user.loginAuditId,
        session_ref: session.user.sessionRef,
        reason,
        source,
      }),
    }).catch(() => null);

    if (response) {
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok || data.success === false) {
        logoutAuditError = String(data.message ?? "Falha ao registrar logout.");
      }
    } else {
      logoutAuditError = "Falha ao registrar logout.";
    }
  }

  if (!options.skipRemoteLogout && session?.source === "remote" && !session.user.loginAuditId && !session.user.sessionRef) {
    logoutAuditError = "Sessao sem referencia para registrar logout.";
  }

  if (session?.source === "remote" && supabase && !options.skipSupabaseSignOut) {
    await supabase.auth.signOut().catch(() => null);
  }

  clearLocalAppSessionStorage();
  writeAuthFeedback(options.feedbackMessage);

  return {
    success: !logoutAuditError,
    message: logoutAuditError,
  };
}
