import { NextRequest } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

type CurrentUserRow = {
  id: string;
  tenant_id: string;
  role_id: string | null;
  login_name: string;
  display: string | null;
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

function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing for tenant admin routes.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function extractBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  return authorization.slice(7).trim() || null;
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

  return {
    supabase,
    authUserId: user.id,
    appUser: currentUser,
    role: {
      roleKey: String(currentRole.role_key ?? "user"),
      roleName: String(currentRole.name ?? "User"),
      isAdmin: Boolean(currentRole.is_admin),
    },
  };
}

export async function resolveAdminOperator(request: NextRequest): Promise<AdminOperatorResolution> {
  const resolution = await resolveAuthenticatedAppUser(request);
  if ("error" in resolution) {
    return resolution;
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
      roleId: resolution.appUser.role_id,
      roleKey: resolution.role.roleKey,
    },
  };
}
