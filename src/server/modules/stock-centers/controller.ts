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

type StockCenterRow = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  center_type: "OWN" | "THIRD_PARTY";
  controls_balance: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

type TeamStockCenterRow = {
  stock_center_id: string | null;
};

type AppUserRow = {
  id: string;
  display: string | null;
  login_name: string | null;
};

type StockCenterHistoryRow = {
  id: string;
  change_type: "UPDATE" | "CANCEL" | "ACTIVATE";
  reason: string | null;
  changes: unknown;
  created_at: string;
  created_by: string | null;
};

type SaveStockCenterPayload = {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  expectedUpdatedAt?: string | null;
};

type UpdateStockCenterStatusPayload = {
  id?: string | null;
  reason?: string | null;
  action?: "cancel" | "activate";
  expectedUpdatedAt?: string | null;
};

type StockCenterSaveRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  stock_center_id?: string;
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

async function fetchTeamStockCenterIds(supabase: SupabaseClient, tenantId: string) {
  const { data, error } = await supabase
    .from("teams")
    .select("stock_center_id")
    .eq("tenant_id", tenantId)
    .not("stock_center_id", "is", null)
    .returns<TeamStockCenterRow[]>();

  if (error) {
    return null;
  }

  return Array.from(
    new Set((data ?? []).map((row) => String(row.stock_center_id ?? "").trim()).filter(Boolean)),
  );
}

function excludeTeamStockCenters<T>(query: T, teamStockCenterIds: string[]) {
  if (teamStockCenterIds.length === 0) {
    return query;
  }

  return (query as { not: (column: string, operator: string, value: string) => T })
    .not("id", "in", `(${teamStockCenterIds.join(",")})`);
}

async function fetchStockCenterById(
  supabase: SupabaseClient,
  tenantId: string,
  stockCenterId: string,
) {
  const teamStockCenterIds = await fetchTeamStockCenterIds(supabase, tenantId);
  if (teamStockCenterIds === null || teamStockCenterIds.includes(stockCenterId)) {
    return null;
  }

  const { data, error } = await supabase
    .from("stock_centers")
    .select("id, name, description, is_active, center_type, controls_balance, created_by, updated_by, created_at, updated_at")
    .eq("tenant_id", tenantId)
    .eq("id", stockCenterId)
    .eq("center_type", "OWN")
    .eq("controls_balance", true)
    .maybeSingle<StockCenterRow>();

  if (error || !data) {
    return null;
  }

  return data;
}

async function saveStockCenterViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  stockCenterId: string | null;
  name: string;
  description: string | null;
  expectedUpdatedAt: string | null;
}) {
  const { data, error } = await params.supabase.rpc("save_stock_center_record", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_stock_center_id: params.stockCenterId,
    p_name: params.name,
    p_description: params.description,
    p_expected_updated_at: params.expectedUpdatedAt,
  });

  if (error) {
    return { ok: false, status: 500, message: "Falha ao salvar centro de estoque.", reason: null } as const;
  }

  const result = (data ?? {}) as StockCenterSaveRpcResult;
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao salvar centro de estoque.",
      reason: result.reason ?? null,
    } as const;
  }

  return {
    ok: true,
    stockCenterId: result.stock_center_id ?? null,
    updatedAt: result.updated_at ?? null,
    message: result.message ?? "Centro de estoque salvo com sucesso.",
  } as const;
}

async function setStockCenterStatusViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  stockCenterId: string;
  action: "ACTIVATE" | "CANCEL";
  reason: string;
  expectedUpdatedAt: string | null;
}) {
  const { data, error } = await params.supabase.rpc("set_stock_center_record_status", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_stock_center_id: params.stockCenterId,
    p_action: params.action,
    p_reason: params.reason,
    p_expected_updated_at: params.expectedUpdatedAt,
  });

  if (error) {
    return { ok: false, status: 500, message: "Falha ao atualizar status do centro de estoque.", reason: null } as const;
  }

  const result = (data ?? {}) as StockCenterSaveRpcResult;
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao atualizar status do centro de estoque.",
      reason: result.reason ?? null,
    } as const;
  }

  return {
    ok: true,
    stockCenterId: result.stock_center_id ?? null,
    updatedAt: result.updated_at ?? null,
    message: result.message ?? "Status do centro de estoque atualizado com sucesso.",
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

export async function handleGetStockCenters(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para consultar centros de estoque.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const params = request.nextUrl.searchParams;
    const historyStockCenterId = normalizeText(params.get("historyStockCenterId"));
    const isExport = normalizeText(params.get("mode")).toLowerCase() === "export";
    const authorizationError = await authorizePageAction(
      resolution,
      "centro-estoque",
      isExport ? "export" : "read",
    );

    if (authorizationError) {
      return authorizationError;
    }

    const { supabase, appUser } = resolution;

    if (historyStockCenterId) {
      const center = await fetchStockCenterById(supabase, appUser.tenant_id, historyStockCenterId);
      if (!center) {
        return NextResponse.json({ message: "Centro de estoque nao encontrado." }, { status: 404 });
      }

      const historyPage = parsePositiveInteger(params.get("historyPage"), 1);
      const historyPageSize = Math.min(parsePositiveInteger(params.get("historyPageSize"), 5), 30);
      const historyFrom = (historyPage - 1) * historyPageSize;
      const historyTo = historyFrom + historyPageSize - 1;

      const { data: historyData, error: historyError, count: historyCount } = await supabase
        .from("app_entity_history")
        .select("id, change_type, reason, changes, created_at, created_by", { count: "exact" })
        .eq("tenant_id", appUser.tenant_id)
        .eq("module_key", "centro-estoque")
        .eq("entity_table", "stock_centers")
        .eq("entity_id", historyStockCenterId)
        .order("created_at", { ascending: false })
        .range(historyFrom, historyTo)
        .returns<StockCenterHistoryRow[]>();

      if (historyError) {
        return NextResponse.json({ message: "Falha ao carregar historico do centro de estoque." }, { status: 500 });
      }

      const userIds = Array.from(
        new Set((historyData ?? []).map((entry) => entry.created_by).filter((value): value is string => Boolean(value))),
      );
      const users = await fetchUsersByIds(supabase, appUser.tenant_id, userIds);
      const userDisplayMap = buildUserDisplayMap(users);

      return NextResponse.json({
        stockCenter: {
          id: center.id,
          name: center.name,
          description: center.description,
          isActive: center.is_active,
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

    const teamStockCenterIds = await fetchTeamStockCenterIds(supabase, appUser.tenant_id);
    if (teamStockCenterIds === null) {
      return NextResponse.json({ message: "Falha ao listar centros de estoque." }, { status: 500 });
    }

    const name = normalizeText(params.get("name"));
    const statusFilter = parseStatusFilter(params.get("status"));
    const { page, pageSize, from, to } = parsePagination(params, { maxPageSize: 100 });

    let query = supabase
      .from("stock_centers")
      .select("id, name, description, is_active, center_type, controls_balance, created_by, updated_by, created_at, updated_at", { count: "exact" })
      .eq("tenant_id", appUser.tenant_id)
      .eq("center_type", "OWN")
      .eq("controls_balance", true);

    query = excludeTeamStockCenters(query, teamStockCenterIds);

    if (name) {
      query = query.ilike("name", `%${name}%`);
    }

    if (statusFilter !== null) {
      query = query.eq("is_active", statusFilter);
    }

    const { data, error, count } = await query
      .order("is_active", { ascending: false })
      .order("name", { ascending: true })
      .range(from, to)
      .returns<StockCenterRow[]>();

    if (error) {
      return NextResponse.json({ message: "Falha ao listar centros de estoque." }, { status: 500 });
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
      stockCenters: (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
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
    return NextResponse.json({ message: "Falha ao listar centros de estoque." }, { status: 500 });
  }
}

export async function handleCreateStockCenter(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para cadastrar centro de estoque.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const authorizationError = await authorizePageAction(resolution, "centro-estoque", "create");
    if (authorizationError) {
      return authorizationError;
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as SaveStockCenterPayload;
    const name = normalizeText(body.name);
    const description = normalizeText(body.description) || null;

    if (!name) {
      return NextResponse.json({ message: "Informe o nome do centro de estoque." }, { status: 400 });
    }

    const saveResult = await saveStockCenterViaRpc({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      stockCenterId: null,
      name,
      description,
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
      stockCenterId: saveResult.stockCenterId,
      updatedAt: saveResult.updatedAt,
      message: saveResult.message,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao cadastrar centro de estoque." }, { status: 500 });
  }
}

export async function handleUpdateStockCenter(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para editar centro de estoque.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const authorizationError = await authorizePageAction(resolution, "centro-estoque", "update");
    if (authorizationError) {
      return authorizationError;
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as SaveStockCenterPayload;
    const stockCenterId = normalizeText(body.id);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(body.expectedUpdatedAt);
    const name = normalizeText(body.name);
    const description = normalizeText(body.description) || null;

    if (!stockCenterId) {
      return NextResponse.json({ message: "Centro de estoque invalido para edicao." }, { status: 400 });
    }

    if (!expectedUpdatedAt) {
      return NextResponse.json({ message: "Atualize a lista antes de editar o centro de estoque." }, { status: 400 });
    }

    if (!name) {
      return NextResponse.json({ message: "Informe o nome do centro de estoque." }, { status: 400 });
    }

    const saveResult = await saveStockCenterViaRpc({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      stockCenterId,
      name,
      description,
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
      stockCenterId: saveResult.stockCenterId,
      updatedAt: saveResult.updatedAt,
      message: saveResult.message,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao editar centro de estoque." }, { status: 500 });
  }
}

export async function handleUpdateStockCenterStatus(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para atualizar status do centro de estoque.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as UpdateStockCenterStatusPayload;
    const stockCenterId = normalizeText(body.id);
    const reason = normalizeText(body.reason);
    const action = normalizeText(body.action).toLowerCase() === "activate" ? "ACTIVATE" : "CANCEL";

    const authorizationError = await authorizePageAction(
      resolution,
      "centro-estoque",
      action === "ACTIVATE" ? "update" : "cancel",
    );

    if (authorizationError) {
      return authorizationError;
    }

    const expectedUpdatedAt = normalizeExpectedUpdatedAt(body.expectedUpdatedAt);

    if (!stockCenterId) {
      return NextResponse.json({ message: "Centro de estoque invalido para atualizar status." }, { status: 400 });
    }

    if (!expectedUpdatedAt) {
      return NextResponse.json({ message: "Atualize a lista antes de alterar o status do centro de estoque." }, { status: 400 });
    }

    if (!reason) {
      return NextResponse.json(
        { message: action === "ACTIVATE" ? "Informe o motivo da ativacao." : "Informe o motivo do cancelamento." },
        { status: 400 },
      );
    }

    const statusResult = await setStockCenterStatusViaRpc({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      stockCenterId,
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
      stockCenterId: statusResult.stockCenterId,
      updatedAt: statusResult.updatedAt,
      message: statusResult.message,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao atualizar status do centro de estoque." }, { status: 500 });
  }
}
