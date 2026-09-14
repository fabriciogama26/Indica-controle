import { NextRequest } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

import { AUTH_UNAVAILABLE_MESSAGE, isTransientAuthError, isTransientHttpStatus } from "@/lib/auth/authErrors";

// --- Singleton: um único cliente admin por processo ---
let _adminClient: SupabaseClient | null = null;

// --- Timeout das chamadas ao Supabase Auth (`/auth/v1/*`) ---
// Sem limite, um Auth degradado prendia a funcao ate a resposta de erro do gateway: no incidente
// de 2026-09-14 o `getUser` do `/api/dash-estoque` levou 79s para falhar. `getUser` normal
// responde em menos de 1s. So o Auth recebe o limite: consultas e RPCs do PostgREST podem
// legitimamente passar disso (exportacoes, importacao em massa) e seguem sem timeout aqui.
const AUTH_REQUEST_TIMEOUT_MS = 10_000;

// Resposta unica para falha de infraestrutura durante a resolucao da sessao. Nao e 401/403:
// a sessao pode estar valida, e o cliente nao deve tratar como login expirado ou acesso negado.
const AUTH_UNAVAILABLE_ERROR = {
  error: {
    status: 503,
    message: AUTH_UNAVAILABLE_MESSAGE,
  },
} as const;

function fetchWithAuthTimeout(input: RequestInfo | URL, init?: RequestInit) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes("/auth/v1/") || init?.signal) {
    return fetch(input, init);
  }
  return fetch(input, { ...init, signal: AbortSignal.timeout(AUTH_REQUEST_TIMEOUT_MS) });
}

// --- Cache de auth por token+tenant com TTL de 45s ---
const AUTH_CACHE_TTL_MS = 45_000;
const ACTIVE_TENANT_COOKIE_NAME = "INDICA.activeTenantId";

type AuthCacheEntry = {
  result: AuthenticatedAppUserContext;
  expiresAt: number;
};

const _authCache = new Map<string, AuthCacheEntry>();

// --- Resolucoes em andamento, por token+tenant+mensagens ---
// O cache acima so e preenchido quando a primeira resolucao TERMINA. Requisicoes que chegam
// juntas (ex.: a tela dispara varias APIs ao abrir) passavam todas pelo cache vazio e cada
// uma refazia getUser + app_users + app_roles + app_user_tenants. Com este mapa, as
// simultaneas aguardam a mesma promise: N requisicoes, uma resolucao.
const _authInFlight = new Map<string, Promise<AuthenticatedAppUserResolution>>();

function getCachedAuth(key: string): AuthenticatedAppUserContext | null {
  const entry = _authCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    _authCache.delete(key);
    return null;
  }
  return entry.result;
}

function setCachedAuth(key: string, result: AuthenticatedAppUserContext): void {
  if (_authCache.size > 500) {
    const now = Date.now();
    for (const [k, e] of _authCache) {
      if (now > e.expiresAt) _authCache.delete(k);
    }
  }
  _authCache.set(key, { result, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });
}

type CurrentUserRow = {
  id: string;
  tenant_id: string;
  role_id: string | null;
  login_name: string;
  display: string | null;
  ativo: boolean;
};

type CurrentUserTenantLinkRow = {
  tenant_id: string;
  is_default: boolean;
  ativo: boolean;
};

type CurrentRoleRow = {
  role_key?: string | null;
  name?: string | null;
  is_admin?: boolean | null;
  ativo?: boolean | null;
} | null;

type ResolveAuthenticatedAppUserOptions = {
  invalidSessionMessage?: string;
  inactiveMessage?: string;
  ignoreActiveTenantCookie?: boolean;
  allowAdminWithoutActiveTenant?: boolean;
  allowTenantHeader?: boolean;
};

export type AdminOperatorContext = {
  supabase: SupabaseClient;
  operator: {
    appUserId: string;
    authUserId: string;
    tenantId: string;
    roleId: string;
    roleKey: string;
  };
};

export type AuthenticatedAppUserContext = {
  supabase: SupabaseClient;
  authUserId: string;
  appUser: CurrentUserRow;
  tenantAccess: {
    activeTenantId: string;
    availableTenantIds: string[];
    hasSelectedActiveTenant: boolean;
    hasInvalidActiveTenantCookie: boolean;
  };
  role: {
    roleKey: string;
    roleName: string;
    isAdmin: boolean;
  };
};

export type AdminOperatorResolution =
  | AdminOperatorContext
  | {
      error: {
        status: number;
        message: string;
      };
    };

export type AuthenticatedAppUserResolution =
  | AuthenticatedAppUserContext
  | {
      error: {
        status: number;
        message: string;
      };
    };

function getSupabaseAdmin(): SupabaseClient {
  if (_adminClient) return _adminClient;

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing for tenant admin routes.");
  }

  _adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      fetch: fetchWithAuthTimeout,
    },
  });

  return _adminClient;
}

function extractBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  return authorization.slice(7).trim() || null;
}

function normalizeHeaderTenantId(value: string | null) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

export async function resolveAuthenticatedAppUser(
  request: NextRequest,
  options: ResolveAuthenticatedAppUserOptions = {},
): Promise<AuthenticatedAppUserResolution> {
  const token = extractBearerToken(request);
  if (!token) {
    return {
      error: {
        status: 401,
        message: "Missing authorization header.",
      },
    };
  }

  const headerTenantId = normalizeHeaderTenantId(request.headers.get("x-tenant-id"));
  const cookieTenantId = options.ignoreActiveTenantCookie
    ? null
    : normalizeHeaderTenantId(request.cookies.get(ACTIVE_TENANT_COOKIE_NAME)?.value ?? null);
  const cacheKey = [
    token,
    headerTenantId ?? "",
    cookieTenantId ?? "",
    options.allowAdminWithoutActiveTenant ? "admin-optional" : "strict",
    options.allowTenantHeader ? "header-ok" : "header-blocked",
  ].join(":");
  const cached = getCachedAuth(cacheKey);
  if (cached) return cached;

  // As mensagens entram na chave porque as respostas de erro usam as mensagens de quem
  // chamou; compartilhar entre rotas diferentes devolveria o texto de outra rota.
  const inFlightKey = [cacheKey, options.invalidSessionMessage ?? "", options.inactiveMessage ?? ""].join(":");
  const inFlight = _authInFlight.get(inFlightKey);
  if (inFlight) return inFlight;

  const resolution = resolveAuthenticatedAppUserUncached({
    token,
    headerTenantId,
    cookieTenantId,
    cacheKey,
    options,
  }).finally(() => {
    _authInFlight.delete(inFlightKey);
  });
  _authInFlight.set(inFlightKey, resolution);
  return resolution;
}

async function resolveAuthenticatedAppUserUncached(params: {
  token: string;
  headerTenantId: string | null;
  cookieTenantId: string | null;
  cacheKey: string;
  options: ResolveAuthenticatedAppUserOptions;
}): Promise<AuthenticatedAppUserResolution> {
  const { token, headerTenantId, cookieTenantId, cacheKey, options } = params;
  const supabase = getSupabaseAdmin();
  const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

  if (authError && isTransientAuthError(authError)) {
    return AUTH_UNAVAILABLE_ERROR;
  }

  if (authError || !user) {
    return {
      error: {
        status: 401,
        message: options.invalidSessionMessage ?? "Sessao invalida para operar permissoes do tenant.",
      },
    };
  }

  const { data: currentUser, error: currentUserError, status: currentUserStatus } = await supabase
    .from("app_users")
    .select("id, tenant_id, role_id, login_name, display, ativo")
    .eq("auth_user_id", user.id)
    .maybeSingle<CurrentUserRow>();

  if (currentUserError && isTransientHttpStatus(currentUserStatus)) {
    return AUTH_UNAVAILABLE_ERROR;
  }

  if (currentUserError || !currentUser || !currentUser.role_id) {
    return {
      error: {
        status: 403,
        message: "Acesso negado para pesquisar usuarios do tenant.",
      },
    };
  }

  if (!currentUser.ativo) {
    return {
      error: {
        status: 403,
        message: options.inactiveMessage ?? "Usuario inativo.",
      },
    };
  }

  const { data: currentRole, error: currentRoleError, status: currentRoleStatus } = await supabase
    .from("app_roles")
    .select("role_key, name, is_admin, ativo")
    .eq("id", currentUser.role_id)
    .maybeSingle<CurrentRoleRow>();

  if (currentRoleError && isTransientHttpStatus(currentRoleStatus)) {
    return AUTH_UNAVAILABLE_ERROR;
  }

  if (currentRoleError || !currentRole?.ativo) {
    return {
      error: {
        status: 403,
        message: "Acesso negado para pesquisar usuarios do tenant.",
      },
    };
  }

  const { data: tenantLinks, error: tenantLinksError, status: tenantLinksStatus } = await supabase
    .from("app_user_tenants")
    .select("tenant_id, is_default, ativo")
    .eq("user_id", currentUser.id)
    .eq("ativo", true)
    .returns<CurrentUserTenantLinkRow[]>();

  if (tenantLinksError && isTransientHttpStatus(tenantLinksStatus)) {
    return AUTH_UNAVAILABLE_ERROR;
  }

  if (tenantLinksError) {
    return {
      error: {
        status: 403,
        message: "Falha ao carregar contratos vinculados ao usuario.",
      },
    };
  }

  const linkedTenantIds = Array.from(new Set((tenantLinks ?? []).map((item) => item.tenant_id).filter(Boolean)));
  const roleKey = String(currentRole.role_key ?? "user");
  const roleName = String(currentRole.name ?? "User");
  const isAdmin = Boolean(currentRole.is_admin);
  let availableTenantIds = [currentUser.tenant_id];
  let activeTenantId = currentUser.tenant_id;
  let hasSelectedActiveTenant = false;
  let hasInvalidActiveTenantCookie = false;

  if (isAdmin) {
    if (linkedTenantIds.length === 0) {
      return {
        error: {
          status: 403,
          message: "Administrador sem contrato ativo vinculado.",
        },
      };
    }

    availableTenantIds = linkedTenantIds;
    const defaultTenant = (tenantLinks ?? []).find((item) => item.is_default && linkedTenantIds.includes(item.tenant_id));
    activeTenantId = defaultTenant?.tenant_id ?? linkedTenantIds[0] ?? "";
  } else if (linkedTenantIds.length > 0) {
    availableTenantIds = linkedTenantIds;
    const defaultTenant = (tenantLinks ?? []).find((item) => item.is_default && linkedTenantIds.includes(item.tenant_id));
    activeTenantId = defaultTenant?.tenant_id ?? linkedTenantIds[0] ?? currentUser.tenant_id;
  }

  if (headerTenantId && !options.allowTenantHeader) {
    return {
      error: {
        status: 403,
        message: "Troca de tenant por header nao permitida para esta rota.",
      },
    };
  }

  if (headerTenantId && options.allowTenantHeader) {
    if (!availableTenantIds.includes(headerTenantId)) {
      return {
        error: {
          status: 403,
          message: "Tenant nao permitido para o usuario autenticado.",
        },
      };
    }
    activeTenantId = headerTenantId;
    hasSelectedActiveTenant = true;
  } else if (cookieTenantId && isAdmin && availableTenantIds.includes(cookieTenantId)) {
    activeTenantId = cookieTenantId;
    hasSelectedActiveTenant = true;
  } else if (cookieTenantId) {
    hasInvalidActiveTenantCookie = true;
    if (isAdmin && !options.allowAdminWithoutActiveTenant) {
      return {
        error: {
          status: 428,
          message: "Selecione um contrato antes de operar como administrador.",
        },
      };
    }
  } else if (isAdmin && !options.allowAdminWithoutActiveTenant) {
    return {
      error: {
        status: 428,
        message: "Selecione um contrato antes de operar como administrador.",
      },
    };
  }

  const result: AuthenticatedAppUserContext = {
    supabase,
    authUserId: user.id,
    appUser: {
      ...currentUser,
      tenant_id: activeTenantId,
    },
    tenantAccess: {
      activeTenantId,
      availableTenantIds,
      hasSelectedActiveTenant,
      hasInvalidActiveTenantCookie,
    },
    role: {
      roleKey,
      roleName,
      isAdmin,
    },
  };

  setCachedAuth(cacheKey, result);
  return result;
}

export async function resolveAdminOperator(request: NextRequest): Promise<AdminOperatorResolution> {
  const resolution = await resolveAuthenticatedAppUser(request);
  if ("error" in resolution) {
    return resolution;
  }

  const roleId = resolution.appUser.role_id;
  if (!roleId) {
    return {
      error: {
        status: 403,
        message: "Acesso negado para pesquisar usuarios do tenant.",
      },
    };
  }

  if (!resolution.role.isAdmin) {
    return {
      error: {
        status: 403,
        message: "Acesso negado para pesquisar usuarios do tenant.",
      },
    };
  }

  return {
    supabase: resolution.supabase,
    operator: {
      appUserId: resolution.appUser.id,
      authUserId: resolution.authUserId,
      tenantId: resolution.appUser.tenant_id,
      roleId,
      roleKey: resolution.role.roleKey,
    },
  };
}
