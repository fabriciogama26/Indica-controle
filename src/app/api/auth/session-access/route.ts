import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";

type PermissionRow = {
  page_key: string;
  can_access: boolean;
};

type TenantRow = {
  name: string | null;
};

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
} as const;
const ACTIVE_TENANT_COOKIE_NAME = "INDICA.activeTenantId";

export async function GET(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para carregar permissoes.",
      inactiveMessage: "Usuario inativo.",
      allowAdminWithoutActiveTenant: true,
    });

    if ("error" in resolution) {
      return NextResponse.json(
        { message: resolution.error.message },
        { status: resolution.error.status, headers: NO_STORE_HEADERS },
      );
    }

    const { supabase, appUser, role, tenantAccess } = resolution;

    const [permissionsResult, tenantResult] = await Promise.all([
      supabase
        .from("app_user_page_permissions")
        .select("page_key, can_access")
        .eq("tenant_id", appUser.tenant_id)
        .eq("user_id", appUser.id)
        .returns<PermissionRow[]>(),
      supabase.from("tenants").select("name").eq("id", appUser.tenant_id).maybeSingle<TenantRow>(),
    ]);

    if (permissionsResult.error) {
      return NextResponse.json(
        { message: "Falha ao carregar permissoes da sessao." },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    if (tenantResult.error) {
      return NextResponse.json(
        { message: "Falha ao carregar contrato da sessao." },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    const permissions = permissionsResult.data;
    const tenantName = tenantResult.data?.name?.trim() || null;

    const response = NextResponse.json(
      {
        user: {
          userId: appUser.id,
          tenantId: appUser.tenant_id,
          tenantName,
          activeTenantId: role.isAdmin && !tenantAccess.hasSelectedActiveTenant ? null : tenantAccess.activeTenantId,
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
    if (tenantAccess.hasInvalidActiveTenantCookie) {
      response.cookies.set(ACTIVE_TENANT_COOKIE_NAME, "", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 0,
      });
    }
    return response;
  } catch {
    return NextResponse.json(
      { message: "Falha ao carregar permissoes da sessao." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
