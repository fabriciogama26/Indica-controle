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

type ActivityGroupRow = {
  id: string;
  name: string;
  unit_value: number | string;
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

type ActivityGroupHistoryRow = {
  id: string;
  change_type: "UPDATE" | "CANCEL" | "ACTIVATE";
  reason: string | null;
  changes: unknown;
  created_at: string;
  created_by: string | null;
};

type SaveActivityGroupPayload = {
  id?: string | null;
  name?: string | null;
  unitValue?: string | number | null;
  expectedUpdatedAt?: string | null;
};

type UpdateActivityGroupStatusPayload = {
  id?: string | null;
  reason?: string | null;
  action?: "cancel" | "activate";
  expectedUpdatedAt?: string | null;
};

type ActivityGroupSaveRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  activity_group_id?: string;
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

function normalizeDecimal(value: unknown) {
  const raw = String(value ?? "").trim().replace(",", ".");
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }
  return Number(numeric.toFixed(2));
}

async function fetchActivityGroupById(
  supabase: SupabaseClient,
  tenantId: string,
  activityGroupId: string,
) {
  const { data, error } = await supabase
    .from("activity_groups")
    .select("id, name, unit_value, ativo, created_by, updated_by, created_at, updated_at")
    .eq("tenant_id", tenantId)
    .eq("id", activityGroupId)
    .maybeSingle<ActivityGroupRow>();

  if (error || !data) {
    return null;
  }

  return data;
}

async function saveActivityGroupViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  activityGroupId: string | null;
  name: string;
  unitValue: number;
  expectedUpdatedAt: string | null;
}) {
  const { data, error } = await params.supabase.rpc("save_activity_group_record", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_activity_group_id: params.activityGroupId,
    p_name: params.name,
    p_unit_value: params.unitValue,
    p_expected_updated_at: params.expectedUpdatedAt,
  });

  if (error) {
    return { ok: false, status: 500, message: "Falha ao salvar grupo de atividade.", reason: null } as const;
  }

  const result = (data ?? {}) as ActivityGroupSaveRpcResult;
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao salvar grupo de atividade.",
      reason: result.reason ?? null,
    } as const;
  }

  return {
    ok: true,
    activityGroupId: result.activity_group_id ?? null,
    updatedAt: result.updated_at ?? null,
    message: result.message ?? "Grupo de atividade salvo com sucesso.",
  } as const;
}

async function setActivityGroupStatusViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  activityGroupId: string;
  action: "ACTIVATE" | "CANCEL";
  reason: string;
  expectedUpdatedAt: string | null;
}) {
  const { data, error } = await params.supabase.rpc("set_activity_group_record_status", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_activity_group_id: params.activityGroupId,
    p_action: params.action,
    p_reason: params.reason,
    p_expected_updated_at: params.expectedUpdatedAt,
  });

  if (error) {
    return {
      ok: false,
      status: 500,
      message: "Falha ao atualizar status do grupo de atividade.",
      reason: null,
    } as const;
  }

  const result = (data ?? {}) as ActivityGroupSaveRpcResult;
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao atualizar status do grupo de atividade.",
      reason: result.reason ?? null,
    } as const;
  }

  return {
    ok: true,
    activityGroupId: result.activity_group_id ?? null,
    updatedAt: result.updated_at ?? null,
    message: result.message ?? "Status do grupo de atividade atualizado com sucesso.",
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

export async function handleGetActivityGroups(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para consultar grupos de atividade.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const params = request.nextUrl.searchParams;
    const historyActivityGroupId = normalizeText(params.get("historyActivityGroupId"));
    const isExport = normalizeText(params.get("mode")).toLowerCase() === "export";
    const authorizationError = await authorizePageAction(
      resolution,
      "grupo-atividade",
      isExport ? "export" : "read",
    );

    if (authorizationError) {
      return authorizationError;
    }

    const { supabase, appUser } = resolution;

    if (historyActivityGroupId) {
      const activityGroup = await fetchActivityGroupById(
        supabase,
        appUser.tenant_id,
        historyActivityGroupId,
      );
      if (!activityGroup) {
        return NextResponse.json({ message: "Grupo de atividade nao encontrado." }, { status: 404 });
      }

      const historyPage = parsePositiveInteger(params.get("historyPage"), 1);
      const historyPageSize = Math.min(parsePositiveInteger(params.get("historyPageSize"), 5), 30);
      const historyFrom = (historyPage - 1) * historyPageSize;
      const historyTo = historyFrom + historyPageSize - 1;

      const { data: historyData, error: historyError, count: historyCount } = await supabase
        .from("app_entity_history")
        .select("id, change_type, reason, changes, created_at, created_by", { count: "exact" })
        .eq("tenant_id", appUser.tenant_id)
        .eq("module_key", "grupo-atividade")
        .eq("entity_table", "activity_groups")
        .eq("entity_id", historyActivityGroupId)
        .order("created_at", { ascending: false })
        .range(historyFrom, historyTo)
        .returns<ActivityGroupHistoryRow[]>();

      if (historyError) {
        return NextResponse.json(
          { message: "Falha ao carregar historico do grupo de atividade." },
          { status: 500 },
        );
      }

      const userIds = Array.from(
        new Set((historyData ?? []).map((entry) => entry.created_by).filter((value): value is string => Boolean(value))),
      );
      const users = await fetchUsersByIds(supabase, appUser.tenant_id, userIds);
      const userDisplayMap = buildUserDisplayMap(users);

      return NextResponse.json({
        activityGroup: {
          id: activityGroup.id,
          name: activityGroup.name,
          unitValue: Number(activityGroup.unit_value ?? 0),
          isActive: activityGroup.ativo,
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
      .from("activity_groups")
      .select("id, name, unit_value, ativo, created_by, updated_by, created_at, updated_at", { count: "exact" })
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
      .returns<ActivityGroupRow[]>();

    if (error) {
      return NextResponse.json({ message: "Falha ao listar grupos de atividade." }, { status: 500 });
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
      activityGroups: (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        unitValue: Number(row.unit_value ?? 0),
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
    return NextResponse.json({ message: "Falha ao listar grupos de atividade." }, { status: 500 });
  }
}

export async function handleCreateActivityGroup(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para cadastrar grupo de atividade.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const authorizationError = await authorizePageAction(resolution, "grupo-atividade", "create");
    if (authorizationError) {
      return authorizationError;
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as SaveActivityGroupPayload;
    const name = normalizeText(body.name);
    const unitValue = normalizeDecimal(body.unitValue);

    if (!name || unitValue === null) {
      return NextResponse.json({ message: "Informe o nome e o valor do grupo de atividade." }, { status: 400 });
    }

    const saveResult = await saveActivityGroupViaRpc({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      activityGroupId: null,
      name,
      unitValue,
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
      activityGroupId: saveResult.activityGroupId,
      updatedAt: saveResult.updatedAt,
      message: saveResult.message,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao cadastrar grupo de atividade." }, { status: 500 });
  }
}

export async function handleUpdateActivityGroup(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para editar grupo de atividade.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const authorizationError = await authorizePageAction(resolution, "grupo-atividade", "update");
    if (authorizationError) {
      return authorizationError;
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as SaveActivityGroupPayload;
    const activityGroupId = normalizeText(body.id);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(body.expectedUpdatedAt);
    const name = normalizeText(body.name);
    const unitValue = normalizeDecimal(body.unitValue);

    if (!activityGroupId) {
      return NextResponse.json({ message: "Grupo de atividade invalido para edicao." }, { status: 400 });
    }

    if (!expectedUpdatedAt) {
      return NextResponse.json(
        { message: "Atualize a lista antes de editar a grupo de atividade." },
        { status: 400 },
      );
    }

    if (!name || unitValue === null) {
      return NextResponse.json({ message: "Informe o nome e o valor do grupo de atividade." }, { status: 400 });
    }

    const saveResult = await saveActivityGroupViaRpc({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      activityGroupId,
      name,
      unitValue,
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
      activityGroupId: saveResult.activityGroupId,
      updatedAt: saveResult.updatedAt,
      message: saveResult.message,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao editar grupo de atividade." }, { status: 500 });
  }
}

export async function handleUpdateActivityGroupStatus(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para atualizar status do grupo de atividade.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as UpdateActivityGroupStatusPayload;
    const activityGroupId = normalizeText(body.id);
    const reason = normalizeText(body.reason);
    const action = normalizeText(body.action).toLowerCase() === "activate" ? "ACTIVATE" : "CANCEL";

    const authorizationError = await authorizePageAction(
      resolution,
      "grupo-atividade",
      action === "ACTIVATE" ? "update" : "cancel",
    );

    if (authorizationError) {
      return authorizationError;
    }

    const expectedUpdatedAt = normalizeExpectedUpdatedAt(body.expectedUpdatedAt);

    if (!activityGroupId) {
      return NextResponse.json(
        { message: "Grupo de atividade invalido para atualizar status." },
        { status: 400 },
      );
    }

    if (!expectedUpdatedAt) {
      return NextResponse.json(
        { message: "Atualize a lista antes de alterar o status do grupo de atividade." },
        { status: 400 },
      );
    }

    if (!reason) {
      return NextResponse.json(
        { message: action === "ACTIVATE" ? "Informe o motivo da ativacao." : "Informe o motivo do cancelamento." },
        { status: 400 },
      );
    }

    const statusResult = await setActivityGroupStatusViaRpc({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      activityGroupId,
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
      activityGroupId: statusResult.activityGroupId,
      updatedAt: statusResult.updatedAt,
      message: statusResult.message,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao atualizar status do grupo de atividade." }, { status: 500 });
  }
}
