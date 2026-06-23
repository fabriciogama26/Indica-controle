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
        status: 403 | 500;
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

function failPagePermissionLookup(pageKey: string, action: PageAction): PageActionAuthorization {
  return {
    allowed: false,
    pageKey,
    action,
    error: {
      status: 500,
      code: "PAGE_PERMISSION_LOOKUP_FAILED",
      message: "Nao foi possivel validar a permissao desta operacao.",
    },
  };
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
    return failPagePermissionLookup(normalizedPageKey, action);
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
    return failPagePermissionLookup(normalizedPageKey, action);
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
    return failPagePermissionLookup(normalizedPageKey, action);
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
