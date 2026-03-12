import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";

type PermissionRow = {
  page_key: string;
  can_access: boolean;
};

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
} as const;

export async function GET(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para carregar permissoes.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json(
        { message: resolution.error.message },
        { status: resolution.error.status, headers: NO_STORE_HEADERS },
      );
    }

    const { supabase, appUser, role, tenantAccess } = resolution;

    const { data: permissions, error: permissionsError } = await supabase
      .from("app_user_page_permissions")
      .select("page_key, can_access")
      .eq("tenant_id", appUser.tenant_id)
      .eq("user_id", appUser.id)
      .returns<PermissionRow[]>();

    if (permissionsError) {
      return NextResponse.json(
        { message: "Falha ao carregar permissoes da sessao." },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json(
      {
        user: {
          userId: appUser.id,
          tenantId: appUser.tenant_id,
          activeTenantId: tenantAccess.activeTenantId,
          availableTenantIds: tenantAccess.availableTenantIds,
          role: role.roleKey,
          roleId: appUser.role_id,
          loginName: appUser.login_name,
          displayName: appUser.display,
          status: appUser.ativo ? "Ativo" : "Inativo",
        },
        pageAccess: (permissions ?? []).filter((item) => item.can_access).map((item) => item.page_key),
        hasCustomPermissions: (permissions ?? []).length > 0,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch {
    return NextResponse.json(
      { message: "Falha ao carregar permissoes da sessao." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
