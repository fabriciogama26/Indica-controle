import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";

import { resolveAdminOperator } from "@/lib/server/appUsersAdmin";
import {
  buildConcurrencyConflictResponse,
  hasUpdatedAtConflict,
  normalizeExpectedUpdatedAt,
} from "@/lib/server/concurrency";

type PermissionPayload = {
  pageKey: string;
  enabled: boolean;
};

type TargetUserRow = {
  id: string;
  tenant_id: string;
  matricula: string | null;
  login_name: string;
  email: string | null;
  auth_user_id: string | null;
  ativo: boolean;
  role_id: string | null;
  updated_at: string;
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

type HistoryInsertRow = {
  tenant_id: string;
  target_user_id: string;
  page_key?: string | null;
  change_type: string;
  previous_can_access?: boolean | null;
  new_can_access?: boolean | null;
  previous_role_id?: string | null;
  new_role_id?: string | null;
  previous_ativo?: boolean | null;
  new_ativo?: boolean | null;
  metadata?: Record<string, unknown>;
  created_by: string;
};

type PermissionsSaveRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  updated_at?: string;
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
    .select("id, tenant_id, matricula, login_name, email, auth_user_id, ativo, role_id, updated_at")
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
        canInvite: Boolean(targetUser.email && !targetUser.auth_user_id),
        updatedAt: targetUser.updated_at,
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
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(body.expectedUpdatedAt);

    if (!roleKey) {
      return NextResponse.json({ message: "Informe o role do usuario." }, { status: 400 });
    }

    if (!expectedUpdatedAt) {
      return NextResponse.json({ message: "Recarregue as credenciais do usuario antes de salvar." }, { status: 400 });
    }

    const targetUser = await resolveTargetUser(userId, operator.tenantId, supabase);
    if (!targetUser) {
      return NextResponse.json({ message: "Usuario nao encontrado no tenant atual." }, { status: 404 });
    }

    if (hasUpdatedAtConflict(expectedUpdatedAt, targetUser.updated_at)) {
      return buildConcurrencyConflictResponse(
        `As credenciais do usuario ${targetUser.login_name} foram alteradas por outro administrador. Recarregue os dados antes de salvar novamente.`,
      );
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
    const invalidPageKeys = pageKeys.filter((pageKey) => !validPageKeys.has(pageKey));
    if (invalidPageKeys.length > 0) {
      return NextResponse.json(
        {
          message: `As telas ${invalidPageKeys.join(", ")} nao estao cadastradas em app_pages.`,
        },
        { status: 422 },
      );
    }

    const normalizedPermissions = permissions.filter((item) => validPageKeys.has(item.pageKey));
    const { data, error } = await supabase.rpc("save_user_permissions", {
      p_tenant_id: operator.tenantId,
      p_actor_user_id: operator.appUserId,
      p_target_user_id: targetUser.id,
      p_role_id: role.id,
      p_ativo: status === "Ativo",
      p_permissions: normalizedPermissions.map((item) => ({
        pageKey: item.pageKey,
        enabled: item.enabled,
      })),
      p_expected_updated_at: expectedUpdatedAt,
    });

    if (error) {
      return NextResponse.json({ message: "Falha ao salvar as credenciais do usuario." }, { status: 500 });
    }

    const result = (data ?? {}) as PermissionsSaveRpcResult;
    if (result.success !== true) {
      return NextResponse.json(
        { message: result.message ?? "Falha ao salvar as credenciais do usuario.", code: result.reason ?? undefined },
        { status: Number(result.status ?? 500) },
      );
    }

    return NextResponse.json({
      success: true,
      message: "Credencial atualizada com sucesso.",
      updatedAt: result.updated_at ?? null,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao salvar as credenciais do usuario." }, { status: 500 });
  }
}
