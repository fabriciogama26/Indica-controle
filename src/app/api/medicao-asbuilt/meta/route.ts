import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";

type ProjectRow = {
  id: string;
  sob: string | null;
  is_active: boolean;
};

type NoProductionReasonRow = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  sort_order: number | null;
};

async function ensureAsbuiltMeasurementPageAccess(resolution: AuthenticatedAppUserContext) {
  if (resolution.role.isAdmin) return true;

  const userPermission = await resolution.supabase
    .from("app_user_page_permissions")
    .select("can_access")
    .eq("tenant_id", resolution.appUser.tenant_id)
    .eq("user_id", resolution.appUser.id)
    .eq("page_key", "medicao-asbuilt")
    .maybeSingle<{ can_access: boolean }>();

  if (!userPermission.error && userPermission.data) return Boolean(userPermission.data.can_access);
  if (!resolution.appUser.role_id) return false;

  const rolePermission = await resolution.supabase
    .from("role_page_permissions")
    .select("can_access")
    .eq("tenant_id", resolution.appUser.tenant_id)
    .eq("role_id", resolution.appUser.role_id)
    .eq("page_key", "medicao-asbuilt")
    .maybeSingle<{ can_access: boolean }>();

  return !rolePermission.error && Boolean(rolePermission.data?.can_access);
}

export async function GET(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para carregar metadados do medicao-asbuilt.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  if (!(await ensureAsbuiltMeasurementPageAccess(resolution))) {
    return NextResponse.json({ message: "Acesso negado para carregar metadados do medicao-asbuilt." }, { status: 403 });
  }

  const [projectResult, noProductionReasonResult] = await Promise.all([
    resolution.supabase
      .from("project")
      .select("id, sob, is_active")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("is_active", true)
      .order("sob", { ascending: true })
      .returns<ProjectRow[]>(),
    resolution.supabase
      .from("measurement_no_production_reasons")
      .select("id, code, name, is_active, sort_order")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
      .returns<NoProductionReasonRow[]>(),
  ]);

  if (projectResult.error) {
    return NextResponse.json({ message: "Falha ao carregar projetos do medicao-asbuilt." }, { status: 500 });
  }

  if (noProductionReasonResult.error) {
    return NextResponse.json({ message: "Falha ao carregar motivos de sem producao do medicao-asbuilt." }, { status: 500 });
  }

  return NextResponse.json({
    projects: (projectResult.data ?? []).map((item) => {
      const code = String(item.sob ?? "").trim();
      return {
        id: item.id,
        code,
        label: code || item.id,
      };
    }),
    noProductionReasons: (noProductionReasonResult.data ?? []).map((item) => ({
      id: item.id,
      code: String(item.code ?? "").trim(),
      name: String(item.name ?? "").trim(),
    })),
  });
}

