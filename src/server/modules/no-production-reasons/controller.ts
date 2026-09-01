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

type NoProductionReasonRow = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  sort_order: number | null;
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

type NoProductionReasonHistoryRow = {
  id: string;
  change_type: "UPDATE" | "CANCEL" | "ACTIVATE";
  reason: string | null;
  changes: unknown;
  created_at: string;
  created_by: string | null;
};

type SaveNoProductionReasonPayload = {
  id?: string | null;
  code?: string | null;
  name?: string | null;
  sortOrder?: number | string | null;
  expectedUpdatedAt?: string | null;
};

type UpdateNoProductionReasonStatusPayload = {
  id?: string | null;
  reason?: string | null;
  action?: "cancel" | "activate";
  expectedUpdatedAt?: string | null;
};

type NoProductionReasonSaveRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  no_production_reason_id?: string;
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

function normalizeCode(value: string | null | undefined) {
  return normalizeText(value).toUpperCase().replace(/\s+/g, "_");
}

function parseSortOrder(value: number | string | null | undefined) {
  const numeric = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isInteger(numeric) || numeric < 0) {
    return null;
  }
  return numeric;
}

function hasSortOrderValue(value: number | string | null | undefined) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

async function fetchNoProductionReasonById(
  supabase: SupabaseClient,
  tenantId: string,
  reasonId: string,
) {
  const { data, error } = await supabase
    .from("measurement_no_production_reasons")
    .select("id, code, name, is_active, sort_order, created_by, updated_by, created_at, updated_at")
    .eq("tenant_id", tenantId)
    .eq("id", reasonId)
    .maybeSingle<NoProductionReasonRow>();

  if (error || !data) {
    return null;
  }

  return data;
}

async function saveNoProductionReasonViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  reasonId: string | null;
  code: string;
  name: string;
  sortOrder: number | null;
  expectedUpdatedAt: string | null;
}) {
  const { data, error } = await params.supabase.rpc("save_no_production_reason_record", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_no_production_reason_id: params.reasonId,
    p_code: params.code,
    p_name: params.name,
    p_sort_order: params.sortOrder,
    p_expected_updated_at: params.expectedUpdatedAt,
  });

  if (error) {
    return { ok: false, status: 500, message: "Falha ao salvar motivo sem producao.", reason: null } as const;
  }

  const result = (data ?? {}) as NoProductionReasonSaveRpcResult;
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao salvar motivo sem producao.",
      reason: result.reason ?? null,
    } as const;
  }

  return {
    ok: true,
    reasonId: result.no_production_reason_id ?? null,
    updatedAt: result.updated_at ?? null,
    message: result.message ?? "Motivo sem producao salvo com sucesso.",
  } as const;
}

async function setNoProductionReasonStatusViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  reasonId: string;
  action: "ACTIVATE" | "CANCEL";
  reason: string;
  expectedUpdatedAt: string | null;
}) {
  const { data, error } = await params.supabase.rpc("set_no_production_reason_record_status", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_no_production_reason_id: params.reasonId,
    p_action: params.action,
    p_reason: params.reason,
    p_expected_updated_at: params.expectedUpdatedAt,
  });

  if (error) {
    return { ok: false, status: 500, message: "Falha ao atualizar status do motivo sem producao.", reason: null } as const;
  }

  const result = (data ?? {}) as NoProductionReasonSaveRpcResult;
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao atualizar status do motivo sem producao.",
      reason: result.reason ?? null,
    } as const;
  }

  return {
    ok: true,
    reasonId: result.no_production_reason_id ?? null,
    updatedAt: result.updated_at ?? null,
    message: result.message ?? "Status do motivo sem producao atualizado com sucesso.",
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

export async function handleGetNoProductionReasons(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para consultar motivos sem producao.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const params = request.nextUrl.searchParams;
    const historyReasonId = normalizeText(params.get("historyNoProductionReasonId"));
    const isExport = normalizeText(params.get("mode")).toLowerCase() === "export";
    const authorizationError = await authorizePageAction(
      resolution,
      "motivo-sem-producao",
      isExport ? "export" : "read",
    );

    if (authorizationError) {
      return authorizationError;
    }

    const { supabase, appUser } = resolution;

    if (historyReasonId) {
      const reason = await fetchNoProductionReasonById(supabase, appUser.tenant_id, historyReasonId);
      if (!reason) {
        return NextResponse.json({ message: "Motivo sem producao nao encontrado." }, { status: 404 });
      }

      const historyPage = parsePositiveInteger(params.get("historyPage"), 1);
      const historyPageSize = Math.min(parsePositiveInteger(params.get("historyPageSize"), 5), 30);
      const historyFrom = (historyPage - 1) * historyPageSize;
      const historyTo = historyFrom + historyPageSize - 1;

      const { data: historyData, error: historyError, count: historyCount } = await supabase
        .from("app_entity_history")
        .select("id, change_type, reason, changes, created_at, created_by", { count: "exact" })
        .eq("tenant_id", appUser.tenant_id)
        .eq("module_key", "motivo-sem-producao")
        .eq("entity_table", "measurement_no_production_reasons")
        .eq("entity_id", historyReasonId)
        .order("created_at", { ascending: false })
        .range(historyFrom, historyTo)
        .returns<NoProductionReasonHistoryRow[]>();

      if (historyError) {
        return NextResponse.json({ message: "Falha ao carregar historico do motivo sem producao." }, { status: 500 });
      }

      const userIds = Array.from(
        new Set((historyData ?? []).map((entry) => entry.created_by).filter((value): value is string => Boolean(value))),
      );
      const users = await fetchUsersByIds(supabase, appUser.tenant_id, userIds);
      const userDisplayMap = buildUserDisplayMap(users);

      return NextResponse.json({
        noProductionReason: {
          id: reason.id,
          code: reason.code,
          name: reason.name,
          sortOrder: reason.sort_order ?? 0,
          isActive: reason.is_active,
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

    const code = normalizeText(params.get("code"));
    const name = normalizeText(params.get("name"));
    const statusFilter = parseStatusFilter(params.get("status"));
    const { page, pageSize, from, to } = parsePagination(params, { maxPageSize: 100 });

    let query = supabase
      .from("measurement_no_production_reasons")
      .select("id, code, name, is_active, sort_order, created_by, updated_by, created_at, updated_at", { count: "exact" })
      .eq("tenant_id", appUser.tenant_id);

    if (code) {
      query = query.ilike("code", `%${code}%`);
    }

    if (name) {
      query = query.ilike("name", `%${name}%`);
    }

    if (statusFilter !== null) {
      query = query.eq("is_active", statusFilter);
    }

    const { data, error, count } = await query
      .order("is_active", { ascending: false })
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
      .range(from, to)
      .returns<NoProductionReasonRow[]>();

    if (error) {
      return NextResponse.json({ message: "Falha ao listar motivos sem producao." }, { status: 500 });
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
      noProductionReasons: (data ?? []).map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        sortOrder: row.sort_order ?? 0,
        isActive: Boolean(row.is_active),
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
    return NextResponse.json({ message: "Falha ao listar motivos sem producao." }, { status: 500 });
  }
}

export async function handleCreateNoProductionReason(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para cadastrar motivo sem producao.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const authorizationError = await authorizePageAction(resolution, "motivo-sem-producao", "create");
    if (authorizationError) {
      return authorizationError;
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as SaveNoProductionReasonPayload;
    const code = normalizeCode(body.code);
    const name = normalizeText(body.name);
    const hasExplicitOrder = hasSortOrderValue(body.sortOrder);
    const sortOrder = hasExplicitOrder ? parseSortOrder(body.sortOrder) : null;

    if (!code) {
      return NextResponse.json({ message: "Informe o codigo do motivo sem producao." }, { status: 400 });
    }

    if (!name) {
      return NextResponse.json({ message: "Informe o nome do motivo sem producao." }, { status: 400 });
    }

    if (hasExplicitOrder && sortOrder === null) {
      return NextResponse.json({ message: "Informe a ordem do motivo sem producao com numero inteiro maior ou igual a zero." }, { status: 400 });
    }

    const saveResult = await saveNoProductionReasonViaRpc({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      reasonId: null,
      code,
      name,
      sortOrder,
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
      noProductionReasonId: saveResult.reasonId,
      updatedAt: saveResult.updatedAt,
      message: saveResult.message,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao cadastrar motivo sem producao." }, { status: 500 });
  }
}

export async function handleUpdateNoProductionReason(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para editar motivo sem producao.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const authorizationError = await authorizePageAction(resolution, "motivo-sem-producao", "update");
    if (authorizationError) {
      return authorizationError;
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as SaveNoProductionReasonPayload;
    const reasonId = normalizeText(body.id);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(body.expectedUpdatedAt);
    const code = normalizeCode(body.code);
    const name = normalizeText(body.name);
    const sortOrder = parseSortOrder(body.sortOrder);

    if (!reasonId) {
      return NextResponse.json({ message: "Motivo sem producao invalido para edicao." }, { status: 400 });
    }

    if (!expectedUpdatedAt) {
      return NextResponse.json({ message: "Atualize a lista antes de editar o motivo sem producao." }, { status: 400 });
    }

    if (!code) {
      return NextResponse.json({ message: "Informe o codigo do motivo sem producao." }, { status: 400 });
    }

    if (!name) {
      return NextResponse.json({ message: "Informe o nome do motivo sem producao." }, { status: 400 });
    }

    if (sortOrder === null) {
      return NextResponse.json({ message: "Informe a ordem do motivo sem producao com numero inteiro maior ou igual a zero." }, { status: 400 });
    }

    const saveResult = await saveNoProductionReasonViaRpc({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      reasonId,
      code,
      name,
      sortOrder,
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
      noProductionReasonId: saveResult.reasonId,
      updatedAt: saveResult.updatedAt,
      message: saveResult.message,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao editar motivo sem producao." }, { status: 500 });
  }
}

export async function handleUpdateNoProductionReasonStatus(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para atualizar status do motivo sem producao.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as UpdateNoProductionReasonStatusPayload;
    const reasonId = normalizeText(body.id);
    const reason = normalizeText(body.reason);
    const action = normalizeText(body.action).toLowerCase() === "activate" ? "ACTIVATE" : "CANCEL";

    const authorizationError = await authorizePageAction(
      resolution,
      "motivo-sem-producao",
      action === "ACTIVATE" ? "update" : "cancel",
    );

    if (authorizationError) {
      return authorizationError;
    }

    const expectedUpdatedAt = normalizeExpectedUpdatedAt(body.expectedUpdatedAt);

    if (!reasonId) {
      return NextResponse.json({ message: "Motivo sem producao invalido para atualizar status." }, { status: 400 });
    }

    if (!expectedUpdatedAt) {
      return NextResponse.json({ message: "Atualize a lista antes de alterar o status do motivo sem producao." }, { status: 400 });
    }

    if (!reason) {
      return NextResponse.json(
        { message: action === "ACTIVATE" ? "Informe o motivo da ativacao." : "Informe o motivo do cancelamento." },
        { status: 400 },
      );
    }

    const statusResult = await setNoProductionReasonStatusViaRpc({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      reasonId,
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
      noProductionReasonId: statusResult.reasonId,
      updatedAt: statusResult.updatedAt,
      message: statusResult.message,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao atualizar status do motivo sem producao." }, { status: 500 });
  }
}
