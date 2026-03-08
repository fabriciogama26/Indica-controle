import { supabase } from "@/lib/supabase/client";
import { AuthMode, AuthSession, LoginPayload, LoginResponse } from "@/types/auth";

const STORAGE_KEY = "rqm.saas.auth";
type PasswordLinkType = "invite" | "recovery";

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
      displayName: data.display_name ? String(data.display_name) : null,
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
      displayName: data.display_name ? String(data.display_name) : String(data.login_name ?? payload.loginName),
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

export async function clearPersistedSession() {
  const session = readPersistedSession();
  let logoutAuditError: string | null = null;

  if (session?.source === "remote" && (session.user.loginAuditId || session.user.sessionRef)) {
    const response = await fetch(`${baseUrl()}/functions/v1/logout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify({
        login_audit_id: session.user.loginAuditId,
        session_ref: session.user.sessionRef,
        reason: "USER_LOGOUT",
        source: "SITE",
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

  if (session?.source === "remote" && !session.user.loginAuditId && !session.user.sessionRef) {
    logoutAuditError = "Sessao sem referencia para registrar logout.";
  }

  if (session?.source === "remote" && supabase) {
    await supabase.auth.signOut();
  }

  if (typeof window !== "undefined") {
    window.localStorage.removeItem(STORAGE_KEY);
  }

  return {
    success: !logoutAuditError,
    message: logoutAuditError,
  };
}
