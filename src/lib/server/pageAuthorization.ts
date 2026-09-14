import { AUTH_UNAVAILABLE_MESSAGE, isTransientHttpStatus } from "@/lib/auth/authErrors";
import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";

export type PageAction = "read" | "create" | "update" | "cancel" | "reverse" | "import" | "export";

type PagePermissionRow = {
  can_access: boolean;
  can_create: boolean;
  can_update: boolean;
  can_cancel: boolean;
  can_reverse: boolean;
  can_import: boolean;
  can_export: boolean;
};

const ACTION_COLUMN: Record<PageAction, keyof PagePermissionRow> = {
  read:    "can_access",
  create:  "can_create",
  update:  "can_update",
  cancel:  "can_cancel",
  reverse: "can_reverse",
  import:  "can_import",
  export:  "can_export",
};

type PageDefaultAccessRow = {
  default_user_access: boolean | null;
};

export type PageActionAuthorization =
  | {
      allowed: true;
      action: PageAction;
      pageKey: string;
      source: "admin" | "user" | "role";
    }
  | {
      allowed: false;
      action: PageAction;
      pageKey: string;
      error: {
        status: 403 | 500 | 503;
        code: "PAGE_ACTION_FORBIDDEN" | "PAGE_PERMISSION_LOOKUP_FAILED";
        message: string;
      };
    };

type RequirePageActionInput = {
  context: AuthenticatedAppUserContext;
  pageKey: string;
  action: PageAction;
};

function denyPageAction(pageKey: string, action: PageAction): PageActionAuthorization {
  return {
    allowed: false,
    pageKey,
    action,
    error: {
      status: 403,
      code: "PAGE_ACTION_FORBIDDEN",
      message: `Acesso negado para executar ${action} em ${pageKey}.`,
    },
  };
}

// `responseStatus` e o status HTTP da consulta ao Supabase que falhou. Falha de infraestrutura
// (rede, timeout, 5xx) vira 503: a permissao pode existir, so nao foi possivel conferir agora.
function failPagePermissionLookup(pageKey: string, action: PageAction, responseStatus?: number): PageActionAuthorization {
  const unavailable = responseStatus !== undefined && isTransientHttpStatus(responseStatus);
  return {
    allowed: false,
    pageKey,
    action,
    error: {
      status: unavailable ? 503 : 500,
      code: "PAGE_PERMISSION_LOOKUP_FAILED",
      message: unavailable ? AUTH_UNAVAILABLE_MESSAGE : "Nao foi possivel validar a permissao desta operacao.",
    },
  };
}

export type PageReadAccessCheck = "allowed" | "denied" | "unavailable";

/**
 * Acesso de leitura a uma tela, na regra das rotas que ainda nao usam `requirePageAction`:
 * admin libera; senao `app_user_page_permissions.can_access`; sem linha do usuario,
 * `role_page_permissions.can_access`.
 *
 * Substitui 8 copias identicas de `ensure*PageAccess` (dash-estoque, dash-operacional-faturamento,
 * consumo-projeto, estornos, estoque-equipes e 3 rotas de medicao-asbuilt). Elas devolviam
 * `false` quando a consulta falhava, e a rota respondia 403 "Acesso negado" com o Supabase fora
 * do ar. Aqui essa falha vira `"unavailable"` (503).
 *
 * DIVERGENCIA CONHECIDA com `requirePageAction`: esta regra NAO aplica o gate
 * `app_pages.default_user_access = true and ativo = true` antes do fallback por role. Foi mantida
 * de proposito para nao mudar quem acessa essas telas. Migrar cada tela para `requirePageAction`
 * so depois de conferir `default_user_access` da pagina, como feito no Faturamento
 * (`src/server/modules/faturamento/authorization.ts`).
 */
export async function checkPageReadAccess(
  context: AuthenticatedAppUserContext,
  pageKey: string,
): Promise<PageReadAccessCheck> {
  if (context.role.isAdmin) return "allowed";

  const userPermission = await context.supabase
    .from("app_user_page_permissions")
    .select("can_access")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("user_id", context.appUser.id)
    .eq("page_key", pageKey)
    .maybeSingle<{ can_access: boolean }>();

  if (userPermission.error && isTransientHttpStatus(userPermission.status)) return "unavailable";
  if (!userPermission.error && userPermission.data) {
    return userPermission.data.can_access ? "allowed" : "denied";
  }

  if (!context.appUser.role_id) return "denied";

  const rolePermission = await context.supabase
    .from("role_page_permissions")
    .select("can_access")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("role_id", context.appUser.role_id)
    .eq("page_key", pageKey)
    .maybeSingle<{ can_access: boolean }>();

  if (rolePermission.error && isTransientHttpStatus(rolePermission.status)) return "unavailable";
  return !rolePermission.error && Boolean(rolePermission.data?.can_access) ? "allowed" : "denied";
}

export async function requirePageAction({
  context,
  pageKey,
  action,
}: RequirePageActionInput): Promise<PageActionAuthorization> {
  const normalizedPageKey = pageKey.trim();
  if (!normalizedPageKey) {
    return failPagePermissionLookup(pageKey, action);
  }

  if (context.role.isAdmin) {
    return {
      allowed: true,
      pageKey: normalizedPageKey,
      action,
      source: "admin",
    };
  }

  const userPermission = await context.supabase
    .from("app_user_page_permissions")
    .select("can_access, can_create, can_update, can_cancel, can_reverse, can_import, can_export")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("user_id", context.appUser.id)
    .eq("page_key", normalizedPageKey)
    .maybeSingle<PagePermissionRow>();

  if (userPermission.error) {
    return failPagePermissionLookup(normalizedPageKey, action, userPermission.status);
  }

  if (userPermission.data) {
    const column = ACTION_COLUMN[action];
    const granted = userPermission.data.can_access && userPermission.data[column];
    return granted
      ? {
          allowed: true,
          pageKey: normalizedPageKey,
          action,
          source: "user",
        }
      : denyPageAction(normalizedPageKey, action);
  }

  const pageDefaultAccess = await context.supabase
    .from("app_pages")
    .select("default_user_access")
    .eq("page_key", normalizedPageKey)
    .eq("ativo", true)
    .maybeSingle<PageDefaultAccessRow>();

  if (pageDefaultAccess.error) {
    return failPagePermissionLookup(normalizedPageKey, action, pageDefaultAccess.status);
  }

  if (pageDefaultAccess.data?.default_user_access !== true) {
    return denyPageAction(normalizedPageKey, action);
  }

  if (!context.appUser.role_id) {
    return denyPageAction(normalizedPageKey, action);
  }

  const rolePermission = await context.supabase
    .from("role_page_permissions")
    .select("can_access, can_create, can_update, can_cancel, can_reverse, can_import, can_export")
    .eq("tenant_id", context.appUser.tenant_id)
    .eq("role_id", context.appUser.role_id)
    .eq("page_key", normalizedPageKey)
    .maybeSingle<PagePermissionRow>();

  if (rolePermission.error) {
    return failPagePermissionLookup(normalizedPageKey, action, rolePermission.status);
  }

  if (!rolePermission.data) {
    return denyPageAction(normalizedPageKey, action);
  }

  const roleColumn = ACTION_COLUMN[action];
  const roleGranted = rolePermission.data.can_access && rolePermission.data[roleColumn];
  return roleGranted
    ? {
        allowed: true,
        pageKey: normalizedPageKey,
        action,
        source: "role",
      }
    : denyPageAction(normalizedPageKey, action);
}
