import { NextRequest } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// --- Singleton: um único cliente admin por processo ---
let _adminClient: SupabaseClient | null = null;

// --- Cache de auth por token+tenant com TTL de 45s ---
const AUTH_CACHE_TTL_MS = 45_000;

type AuthCacheEntry = {
  result: AuthenticatedAppUserContext;
  expiresAt: number;
};

const _authCache = new Map<string, AuthCacheEntry>();

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

  const requestedTenantId = normalizeHeaderTenantId(request.headers.get("x-tenant-id"));
  const cacheKey = `${token}:${requestedTenantId ?? ""}`;
  const cached = getCachedAuth(cacheKey);
  if (cached) return cached;

  const supabase = getSupabaseAdmin();
  const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return {
      error: {
        status: 401,
        message: options.invalidSessionMessage ?? "Sessao invalida para operar permissoes do tenant.",
      },
    };
  }

  const { data: currentUser, error: currentUserError } = await supabase
    .from("app_users")
    .select("id, tenant_id, role_id, login_name, display, ativo")
    .eq("auth_user_id", user.id)
    .maybeSingle<CurrentUserRow>();

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

  const { data: currentRole, error: currentRoleError } = await supabase
    .from("app_roles")
    .select("role_key, name, is_admin, ativo")
    .eq("id", currentUser.role_id)
    .maybeSingle<CurrentRoleRow>();

  if (currentRoleError || !currentRole?.ativo) {
    return {
      error: {
        status: 403,
        message: "Acesso negado para pesquisar usuarios do tenant.",
      },
    };
  }

  let availableTenantIds = [currentUser.tenant_id];
  let activeTenantId = currentUser.tenant_id;

  const { data: tenantLinks, error: tenantLinksError } = await supabase
    .from("app_user_tenants")
    .select("tenant_id, is_default, ativo")
    .eq("user_id", currentUser.id)
    .eq("ativo", true)
    .returns<CurrentUserTenantLinkRow[]>();

  if (!tenantLinksError && (tenantLinks ?? []).length > 0) {
    const uniqueTenantIds = Array.from(new Set((tenantLinks ?? []).map((item) => item.tenant_id).filter(Boolean)));
    if (uniqueTenantIds.length > 0) {
      availableTenantIds = uniqueTenantIds;
      const defaultTenant = (tenantLinks ?? []).find((item) => item.is_default) ?? null;
      activeTenantId = defaultTenant?.tenant_id ?? uniqueTenantIds[0];
    }
  }

  if (requestedTenantId) {
    if (!availableTenantIds.includes(requestedTenantId)) {
      return {
        error: {
          status: 403,
          message: "Tenant nao permitido para o usuario autenticado.",
        },
      };
    }
    activeTenantId = requestedTenantId;
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
    },
    role: {
      roleKey: String(currentRole.role_key ?? "user"),
      roleName: String(currentRole.name ?? "User"),
      isAdmin: Boolean(currentRole.is_admin),
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
