import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";

import { resolveAdminOperator } from "@/lib/server/appUsersAdmin";

type PermissionPayload = {
  pageKey: string;
  enabled: boolean;
};

type TargetUserRow = {
  id: string;
  tenant_id: string;
  matricula: string | null;
  login_name: string;
  ativo: boolean;
  role_id: string | null;
};

type RoleRow = {
  id?: string | null;
  role_key?: string | null;
  name?: string | null;
} | null;

type SavedPermissionRow = {
  page_key: string;
  can_access: boolean;
};

function normalizeRoleKey(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeStatus(value: unknown) {
  return String(value ?? "").trim().toLowerCase() === "inativo" ? "Inativo" : "Ativo";
}

function normalizePermissions(value: unknown): PermissionPayload[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const record = item as Record<string, unknown>;
      const pageKey = String(record.pageKey ?? "").trim();
      if (!pageKey) {
        return null;
      }

      return {
        pageKey,
        enabled: Boolean(record.enabled),
      };
    })
    .filter((item): item is PermissionPayload => item !== null);
}

async function resolveTargetUser(userId: string, tenantId: string, supabase: SupabaseClient) {
  const { data: targetUser, error: targetUserError } = await supabase
    .from("app_users")
    .select("id, tenant_id, matricula, login_name, ativo, role_id")
    .eq("id", userId)
    .eq("tenant_id", tenantId)
    .maybeSingle<TargetUserRow>();

  if (targetUserError || !targetUser) {
    return null;
  }

  return targetUser;
}

export async function GET(request: NextRequest, context: { params: Promise<{ userId: string }> }) {
  try {
    const resolution = await resolveAdminOperator(request);
    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { userId } = await context.params;
    const { supabase, operator } = resolution;

    const targetUser = await resolveTargetUser(userId, operator.tenantId, supabase);
    if (!targetUser) {
      return NextResponse.json({ message: "Usuario nao encontrado no tenant atual." }, { status: 404 });
    }

    const { data: role, error: roleError } = targetUser.role_id
      ? await supabase.from("app_roles").select("id, role_key, name").eq("id", targetUser.role_id).maybeSingle<RoleRow>()
      : { data: null, error: null };

    if (roleError) {
      return NextResponse.json({ message: "Falha ao buscar perfil do usuario." }, { status: 500 });
    }

    const { data: permissions, error: permissionsError } = await supabase
      .from("app_user_page_permissions")
      .select("page_key, can_access")
      .eq("tenant_id", operator.tenantId)
      .eq("user_id", targetUser.id)
      .returns<SavedPermissionRow[]>();

    if (permissionsError) {
      return NextResponse.json({ message: "Falha ao buscar permissoes do usuario." }, { status: 500 });
    }

    return NextResponse.json({
      user: {
        id: targetUser.id,
        tenantId: targetUser.tenant_id,
        loginName: targetUser.login_name,
        matricula: targetUser.matricula,
        status: targetUser.ativo ? "Ativo" : "Inativo",
        role: String(role?.role_key ?? "user"),
        roleLabel: String(role?.name ?? "User"),
      },
      permissions: (permissions ?? []).map((item) => ({
        pageKey: item.page_key,
        enabled: item.can_access,
      })),
    });
  } catch {
    return NextResponse.json({ message: "Falha ao carregar credenciais do usuario." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ userId: string }> }) {
  try {
    const resolution = await resolveAdminOperator(request);
    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { userId } = await context.params;
    const { supabase, operator } = resolution;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const roleKey = normalizeRoleKey(body.role);
    const status = normalizeStatus(body.status);
    const permissions = normalizePermissions(body.permissions);

    if (!roleKey) {
      return NextResponse.json({ message: "Informe o role do usuario." }, { status: 400 });
    }

    const targetUser = await resolveTargetUser(userId, operator.tenantId, supabase);
    if (!targetUser) {
      return NextResponse.json({ message: "Usuario nao encontrado no tenant atual." }, { status: 404 });
    }

    const { data: role, error: roleError } = await supabase
      .from("app_roles")
      .select("id, role_key, name")
      .eq("role_key", roleKey)
      .eq("ativo", true)
      .maybeSingle<RoleRow>();

    if (roleError || !role?.id) {
      return NextResponse.json({ message: "Role invalido para o usuario selecionado." }, { status: 422 });
    }

    const pageKeys = Array.from(new Set(permissions.map((item) => item.pageKey)));
    const { data: validPages, error: validPagesError } = pageKeys.length
      ? await supabase.from("app_pages").select("page_key").eq("ativo", true).in("page_key", pageKeys)
      : { data: [], error: null };

    if (validPagesError) {
      return NextResponse.json({ message: "Falha ao validar as telas selecionadas." }, { status: 500 });
    }

    const validPageKeys = new Set((validPages ?? []).map((item) => String((item as Record<string, unknown>).page_key)));
    const normalizedPermissions = permissions.filter((item) => validPageKeys.has(item.pageKey));

    const { error: updateUserError } = await supabase
      .from("app_users")
      .update({
        role_id: role.id,
        ativo: status === "Ativo",
        updated_by: operator.appUserId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", targetUser.id)
      .eq("tenant_id", operator.tenantId);

    if (updateUserError) {
      return NextResponse.json({ message: "Falha ao atualizar o usuario selecionado." }, { status: 500 });
    }

    if (normalizedPermissions.length > 0) {
      const permissionRows = normalizedPermissions.map((item) => ({
        tenant_id: operator.tenantId,
        user_id: targetUser.id,
        page_key: item.pageKey,
        can_access: item.enabled,
        can_select: item.enabled,
        can_insert: item.enabled,
        can_update: item.enabled,
        created_by: operator.appUserId,
        updated_by: operator.appUserId,
      }));

      const { error: upsertPermissionsError } = await supabase
        .from("app_user_page_permissions")
        .upsert(permissionRows, {
          onConflict: "tenant_id,user_id,page_key",
        });

      if (upsertPermissionsError) {
        return NextResponse.json({ message: "Falha ao salvar as permissoes do usuario." }, { status: 500 });
      }
    }

    return NextResponse.json({
      success: true,
      message: "Credencial atualizada com sucesso.",
    });
  } catch {
    return NextResponse.json({ message: "Falha ao salvar as credenciais do usuario." }, { status: 500 });
  }
}
