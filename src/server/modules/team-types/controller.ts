import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { normalizeExpectedUpdatedAt } from "@/lib/server/concurrency";
import {
  buildUserDisplayMap,
  buildUserLoginNameMap,
  normalizeHistoryChanges,
  normalizeText,
  parsePagination,
  parsePositiveInteger,
} from "@/lib/server/apiHelpers";
import { authorizePageAction } from "@/lib/server/routeAuthorization";

type ActivityTypeRow = {
  id: string;
  name: string;
  ativo: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

type AppUserRow = {
  id: string;
  display: string | null;
  login_name: string | null;
};

type ActivityTypeHistoryRow = {
  id: string;
  change_type: "UPDATE" | "CANCEL" | "ACTIVATE";
  reason: string | null;
  changes: unknown;
  created_at: string;
  created_by: string | null;
};

type SaveActivityTypePayload = {
  id?: string | null;
  name?: string | null;
  expectedUpdatedAt?: string | null;
};

type UpdateActivityTypeStatusPayload = {
  id?: string | null;
  reason?: string | null;
  action?: "cancel" | "activate";
  expectedUpdatedAt?: string | null;
};

type ActivityTypeSaveRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  team_type_id?: string;
  updated_at?: string;
};

function parseStatusFilter(value: string | null) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "ativo") {
    return true;
  }
  if (normalized === "inativo") {
    return false;
  }
  return null;
}

async function fetchActivityTypeById(
  supabase: SupabaseClient,
  tenantId: string,
  activityTypeId: string,
) {
  const { data, error } = await supabase
    .from("team_types")
    .select("id, name, ativo, created_by, updated_by, created_at, updated_at")
    .eq("tenant_id", tenantId)
    .eq("id", activityTypeId)
    .maybeSingle<ActivityTypeRow>();

  if (error || !data) {
    return null;
  }

  return data;
}

async function saveActivityTypeViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  activityTypeId: string | null;
  name: string;
  expectedUpdatedAt: string | null;
}) {
  const { data, error } = await params.supabase.rpc("save_team_type_record", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_team_type_id: params.activityTypeId,
    p_name: params.name,
    p_expected_updated_at: params.expectedUpdatedAt,
  });

  if (error) {
    return { ok: false, status: 500, message: "Falha ao salvar tipo de atividade.", reason: null } as const;
  }

  const result = (data ?? {}) as ActivityTypeSaveRpcResult;
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao salvar tipo de atividade.",
      reason: result.reason ?? null,
    } as const;
  }

  return {
    ok: true,
    activityTypeId: result.team_type_id ?? null,
    updatedAt: result.updated_at ?? null,
    message: result.message ?? "Tipo de atividade salvo com sucesso.",
  } as const;
}

async function setActivityTypeStatusViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  activityTypeId: string;
  action: "ACTIVATE" | "CANCEL";
  reason: string;
  expectedUpdatedAt: string | null;
}) {
  const { data, error } = await params.supabase.rpc("set_team_type_record_status", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_team_type_id: params.activityTypeId,
    p_action: params.action,
    p_reason: params.reason,
    p_expected_updated_at: params.expectedUpdatedAt,
  });

  if (error) {
    return { ok: false, status: 500, message: "Falha ao atualizar status do tipo de atividade.", reason: null } as const;
  }

  const result = (data ?? {}) as ActivityTypeSaveRpcResult;
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao atualizar status do tipo de atividade.",
      reason: result.reason ?? null,
    } as const;
  }

  return {
    ok: true,
    activityTypeId: result.team_type_id ?? null,
    updatedAt: result.updated_at ?? null,
    message: result.message ?? "Status do tipo de atividade atualizado com sucesso.",
  } as const;
}

async function fetchUsersByIds(supabase: SupabaseClient, tenantId: string, userIds: string[]) {
  if (userIds.length === 0) {
    return [] as AppUserRow[];
  }

  const { data, error } = await supabase
    .from("app_users")
    .select("id, display, login_name")
    .eq("tenant_id", tenantId)
    .in("id", userIds)
    .returns<AppUserRow[]>();

  if (error) {
    return [] as AppUserRow[];
  }

  return data ?? [];
}

export async function handleGetActivityTypes(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para consultar tipos de atividade.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const params = request.nextUrl.searchParams;
    const historyActivityTypeId = normalizeText(params.get("historyActivityTypeId"));
    const isExport = normalizeText(params.get("mode")).toLowerCase() === "export";
    const authorizationError = await authorizePageAction(
      resolution,
      "tipo-atividade",
      isExport ? "export" : "read",
    );

    if (authorizationError) {
      return authorizationError;
    }

    const { supabase, appUser } = resolution;

    if (historyActivityTypeId) {
      const activityType = await fetchActivityTypeById(supabase, appUser.tenant_id, historyActivityTypeId);
      if (!activityType) {
        return NextResponse.json({ message: "Tipo de atividade nao encontrado." }, { status: 404 });
      }

      const historyPage = parsePositiveInteger(params.get("historyPage"), 1);
      const historyPageSize = Math.min(parsePositiveInteger(params.get("historyPageSize"), 5), 30);
      const historyFrom = (historyPage - 1) * historyPageSize;
      const historyTo = historyFrom + historyPageSize - 1;

      const { data: historyData, error: historyError, count: historyCount } = await supabase
        .from("app_entity_history")
        .select("id, change_type, reason, changes, created_at, created_by", { count: "exact" })
        .eq("tenant_id", appUser.tenant_id)
        .eq("module_key", "tipo-atividade")
        .eq("entity_table", "team_types")
        .eq("entity_id", historyActivityTypeId)
        .order("created_at", { ascending: false })
        .range(historyFrom, historyTo)
        .returns<ActivityTypeHistoryRow[]>();

      if (historyError) {
        return NextResponse.json({ message: "Falha ao carregar historico do tipo de atividade." }, { status: 500 });
      }

      const userIds = Array.from(
        new Set((historyData ?? []).map((entry) => entry.created_by).filter((value): value is string => Boolean(value))),
      );
      const users = await fetchUsersByIds(supabase, appUser.tenant_id, userIds);
      const userDisplayMap = buildUserDisplayMap(users);

      return NextResponse.json({
        activityType: {
          id: activityType.id,
          name: activityType.name,
          isActive: activityType.ativo,
        },
        history: (historyData ?? []).map((entry) => ({
          id: entry.id,
          changeType: entry.change_type,
          reason: entry.reason,
          changes: normalizeHistoryChanges(entry.changes),
          createdAt: entry.created_at,
          createdByName: userDisplayMap.get(entry.created_by ?? "") ?? "Nao identificado",
        })),
        pagination: {
          page: historyPage,
          pageSize: historyPageSize,
          total: historyCount ?? 0,
        },
      });
    }

    const name = normalizeText(params.get("name"));
    const statusFilter = parseStatusFilter(params.get("status"));
    const { page, pageSize, from, to } = parsePagination(params, { maxPageSize: 100 });

    let query = supabase
      .from("team_types")
      .select("id, name, ativo, created_by, updated_by, created_at, updated_at", { count: "exact" })
      .eq("tenant_id", appUser.tenant_id);

    if (name) {
      query = query.ilike("name", `%${name}%`);
    }

    if (statusFilter !== null) {
      query = query.eq("ativo", statusFilter);
    }

    const { data, error, count } = await query
      .order("ativo", { ascending: false })
      .order("name", { ascending: true })
      .range(from, to)
      .returns<ActivityTypeRow[]>();

    if (error) {
      return NextResponse.json({ message: "Falha ao listar tipos de atividade." }, { status: 500 });
    }

    const userIds = Array.from(
      new Set(
        (data ?? [])
          .flatMap((item) => [item.created_by, item.updated_by])
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const users = await fetchUsersByIds(supabase, appUser.tenant_id, userIds);
    const userDisplayMap = buildUserDisplayMap(users);
    const userLoginNameMap = buildUserLoginNameMap(users);

    return NextResponse.json({
      activityTypes: (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        isActive: Boolean(row.ativo),
        createdByName: row.created_by ? userLoginNameMap.get(row.created_by) ?? "Nao identificado" : "Nao identificado",
        updatedByName: row.updated_by ? userDisplayMap.get(row.updated_by) ?? "Nao identificado" : "Nao identificado",
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      pagination: {
        page,
        pageSize,
        total: count ?? 0,
      },
    });
  } catch {
    return NextResponse.json({ message: "Falha ao listar tipos de atividade." }, { status: 500 });
  }
}

export async function handleCreateActivityType(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para cadastrar tipo de atividade.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const authorizationError = await authorizePageAction(resolution, "tipo-atividade", "create");
    if (authorizationError) {
      return authorizationError;
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as SaveActivityTypePayload;
    const name = normalizeText(body.name);

    if (!name) {
      return NextResponse.json({ message: "Informe o nome do tipo de atividade." }, { status: 400 });
    }

    const saveResult = await saveActivityTypeViaRpc({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      activityTypeId: null,
      name,
      expectedUpdatedAt: null,
    });

    if (!saveResult.ok) {
      return NextResponse.json(
        { message: saveResult.message, reason: saveResult.reason, code: saveResult.reason },
        { status: saveResult.status },
      );
    }

    return NextResponse.json({
      success: true,
      activityTypeId: saveResult.activityTypeId,
      updatedAt: saveResult.updatedAt,
      message: saveResult.message,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao cadastrar tipo de atividade." }, { status: 500 });
  }
}

export async function handleUpdateActivityType(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para editar tipo de atividade.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const authorizationError = await authorizePageAction(resolution, "tipo-atividade", "update");
    if (authorizationError) {
      return authorizationError;
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as SaveActivityTypePayload;
    const activityTypeId = normalizeText(body.id);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(body.expectedUpdatedAt);
    const name = normalizeText(body.name);

    if (!activityTypeId) {
      return NextResponse.json({ message: "Tipo de atividade invalido para edicao." }, { status: 400 });
    }

    if (!expectedUpdatedAt) {
      return NextResponse.json({ message: "Atualize a lista antes de editar o tipo de atividade." }, { status: 400 });
    }

    if (!name) {
      return NextResponse.json({ message: "Informe o nome do tipo de atividade." }, { status: 400 });
    }

    const saveResult = await saveActivityTypeViaRpc({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      activityTypeId,
      name,
      expectedUpdatedAt,
    });

    if (!saveResult.ok) {
      return NextResponse.json(
        { message: saveResult.message, reason: saveResult.reason, code: saveResult.reason },
        { status: saveResult.status },
      );
    }

    return NextResponse.json({
      success: true,
      activityTypeId: saveResult.activityTypeId,
      updatedAt: saveResult.updatedAt,
      message: saveResult.message,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao editar tipo de atividade." }, { status: 500 });
  }
}

export async function handleUpdateActivityTypeStatus(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para atualizar status do tipo de atividade.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as UpdateActivityTypeStatusPayload;
    const activityTypeId = normalizeText(body.id);
    const reason = normalizeText(body.reason);
    const action = normalizeText(body.action).toLowerCase() === "activate" ? "ACTIVATE" : "CANCEL";

    const authorizationError = await authorizePageAction(
      resolution,
      "tipo-atividade",
      action === "ACTIVATE" ? "update" : "cancel",
    );

    if (authorizationError) {
      return authorizationError;
    }

    const expectedUpdatedAt = normalizeExpectedUpdatedAt(body.expectedUpdatedAt);

    if (!activityTypeId) {
      return NextResponse.json({ message: "Tipo de atividade invalido para atualizar status." }, { status: 400 });
    }

    if (!expectedUpdatedAt) {
      return NextResponse.json(
        { message: "Atualize a lista antes de alterar o status do tipo de atividade." },
        { status: 400 },
      );
    }

    if (!reason) {
      return NextResponse.json(
        { message: action === "ACTIVATE" ? "Informe o motivo da ativacao." : "Informe o motivo do cancelamento." },
        { status: 400 },
      );
    }

    const statusResult = await setActivityTypeStatusViaRpc({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      activityTypeId,
      reason,
      action,
      expectedUpdatedAt,
    });

    if (!statusResult.ok) {
      return NextResponse.json(
        { message: statusResult.message, reason: statusResult.reason, code: statusResult.reason },
        { status: statusResult.status },
      );
    }

    return NextResponse.json({
      success: true,
      activityTypeId: statusResult.activityTypeId,
      updatedAt: statusResult.updatedAt,
      message: statusResult.message,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao atualizar status do tipo de atividade." }, { status: 500 });
  }
}
