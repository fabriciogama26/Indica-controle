import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";

type AsbuiltMeasurementStatus = "ABERTA" | "FECHADA" | "CANCELADA";
type AsbuiltMeasurementKind = "COM_PRODUCAO" | "SEM_PRODUCAO";

type AsbuiltMeasurementOrderRow = {
  id: string;
  asbuilt_number: string;
  project_id: string;
  asbuilt_kind: AsbuiltMeasurementKind;
  no_production_reason_id: string | null;
  no_production_reason_name_snapshot: string | null;
  status: AsbuiltMeasurementStatus;
  notes: string | null;
  project_code_snapshot: string;
  is_active: boolean;
  cancellation_reason: string | null;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

type AsbuiltMeasurementOrderItemRow = {
  id: string;
  asbuilt_measurement_order_id: string;
  service_activity_id: string;
  activity_code: string;
  activity_description: string;
  activity_unit: string;
  voice_point: number | string;
  quantity: number | string;
  rate: number | string;
  unit_value: number | string;
  activity_active_snapshot?: boolean | null;
  total_value: number | string;
  observation: string | null;
  is_active: boolean;
  updated_at: string;
};

type AsbuiltMeasurementHistoryRow = {
  id: string;
  action_type: string;
  reason: string | null;
  changes: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
};

type AsbuiltMeasurementAggregateItem = {
  asbuilt_measurement_order_id: string;
  total_value: number | string;
};

type AppUserRow = {
  id: string;
  display: string | null;
  login_name: string | null;
};

type ActiveProjectRow = {
  id: string;
};

type SaveAsbuiltMeasurementPayload = {
  action?: string;
  id?: string;
  projectId?: string;
  asbuiltMeasurementKind?: string;
  noProductionReasonId?: string;
  notes?: string;
  expectedUpdatedAt?: string;
  items?: Array<{
    activityId?: string;
    quantity?: string | number;
    rate?: string | number;
    observation?: string;
  }>;
};

type SaveAsbuiltMeasurementBatchPayload = {
  action?: "BATCH_IMPORT_PARTIAL";
  rows?: Array<Omit<SaveAsbuiltMeasurementPayload, "action" | "id" | "expectedUpdatedAt"> & {
    rowNumbers?: number[];
  }>;
};

type UpdateStatusPayload = {
  id?: string;
  action?: "FECHAR" | "CANCELAR" | "ABRIR";
  reason?: string;
  expectedUpdatedAt?: string;
};

type SaveAsbuiltMeasurementRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  asbuilt_measurement_order_id?: string;
  updated_at?: string;
  currentUpdatedAt?: string;
};

type SaveAsbuiltMeasurementBatchRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  savedCount?: number;
  errorCount?: number;
  results?: Array<{
    rowNumbers?: number[];
    success?: boolean;
    reason?: string | null;
    message?: string;
    asbuiltMeasurementOrderId?: string;
  }>;
};

type SetAsbuiltMeasurementStatusRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  asbuilt_measurement_order_id?: string;
  updated_at?: string;
  asbuilt_status?: AsbuiltMeasurementStatus;
  currentUpdatedAt?: string;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeUuid(value: unknown) {
  const normalized = normalizeText(value);
  return /^[0-9a-f-]{36}$/i.test(normalized) ? normalized : null;
}

function normalizeAsbuiltMeasurementKind(value: unknown): AsbuiltMeasurementKind {
  const normalized = normalizeText(value).toUpperCase();
  return normalized === "SEM_PRODUCAO" ? "SEM_PRODUCAO" : "COM_PRODUCAO";
}

function normalizePositiveDecimal(value: unknown) {
  const normalized = normalizeDecimalText(value);
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Number(parsed.toFixed(6));
}

function normalizeDecimalText(value: unknown) {
  const raw = String(value ?? "").trim().replace(/\s/g, "");
  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    return raw.split(thousandsSeparator).join("").replace(decimalSeparator, ".");
  }

  if (lastComma >= 0) {
    return raw.replace(/\./g, "").replace(",", ".");
  }

  return raw.replace(/,/g, "");
}

function normalizePositiveInteger(value: unknown, fallback: number, max = 200) {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function normalizePositiveIntegerArray(values: unknown) {
  if (!Array.isArray(values)) return [] as number[];
  return Array.from(new Set(values.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0)));
}

function normalizeAsbuiltMeasurementItems(itemsInput: SaveAsbuiltMeasurementPayload["items"] | undefined) {
  const source = Array.isArray(itemsInput) ? itemsInput : [];
  return source
    .map((item) => ({
      activityId: normalizeUuid(item.activityId),
      quantity: normalizePositiveDecimal(item.quantity),
      rate: normalizePositiveDecimal(item.rate),
      observation: normalizeText(item.observation) || null,
    }))
    .filter((item) => item.activityId && item.quantity !== null && item.rate !== null)
    .map((item) => ({
      activityId: item.activityId as string,
      quantity: item.quantity as number,
      rate: item.rate as number,
      observation: item.observation,
    }));
}

function hasInvalidAsbuiltMeasurementItemValues(itemsInput: SaveAsbuiltMeasurementPayload["items"] | undefined) {
  const source = Array.isArray(itemsInput) ? itemsInput : [];
  return source.some((item) => (
    normalizePositiveDecimal(item.quantity) === null
    || normalizePositiveDecimal(item.rate) === null
  ));
}

function findDuplicateActivityId(items: Array<{ activityId: string }>) {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.activityId)) return item.activityId;
    seen.add(item.activityId);
  }
  return null;
}

function resolveAppUserName(user: AppUserRow | undefined) {
  if (!user) return "Nao identificado";
  return normalizeText(user.login_name) || normalizeText(user.display) || "Nao identificado";
}

function buildAsbuiltMeasurementAggregateMap(items: AsbuiltMeasurementAggregateItem[] | null | undefined) {
  const aggregateMap = new Map<string, { totalAmount: number; itemCount: number }>();
  for (const item of items ?? []) {
    const current = aggregateMap.get(item.asbuilt_measurement_order_id) ?? { totalAmount: 0, itemCount: 0 };
    current.totalAmount += Number(item.total_value ?? 0);
    current.itemCount += 1;
    aggregateMap.set(item.asbuilt_measurement_order_id, current);
  }
  return aggregateMap;
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function loadActiveProjectIdSet(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  projectIds: Array<string | null>;
}) {
  const activeProjectIds = new Set<string>();
  const projectIds = Array.from(new Set(params.projectIds.filter((item): item is string => Boolean(item))));

  for (const projectIdChunk of chunk(projectIds, 500)) {
    const { data, error } = await params.supabase
      .from("project")
      .select("id")
      .eq("tenant_id", params.tenantId)
      .eq("is_active", true)
      .in("id", projectIdChunk)
      .returns<ActiveProjectRow[]>();

    if (error) {
      throw new Error("Falha ao validar projetos ativos do medicao-asbuilt.");
    }

    for (const project of data ?? []) {
      activeProjectIds.add(project.id);
    }
  }

  return activeProjectIds;
}

function asbuiltMeasurementModuleMigrationHint(message: string | undefined) {
  const normalized = String(message ?? "").toLowerCase();
  if (
    normalized.includes("project_asbuilt_measurement_orders")
    || normalized.includes("project_asbuilt_measurement_order_items")
    || normalized.includes("project_asbuilt_measurement_order_history")
    || normalized.includes("save_project_asbuilt_measurement_order")
    || normalized.includes("set_project_asbuilt_measurement_order_status")
  ) {
    return " Verifique se a migration 177_create_measurement_asbuilt_page.sql foi aplicada.";
  }
  return "";
}

async function ensureAsbuiltMeasurementPageAccess(resolution: AuthenticatedAppUserContext) {
  if (resolution.role.isAdmin) {
    return true;
  }

  const userPermission = await resolution.supabase
    .from("app_user_page_permissions")
    .select("can_access")
    .eq("tenant_id", resolution.appUser.tenant_id)
    .eq("user_id", resolution.appUser.id)
    .eq("page_key", "medicao-asbuilt")
    .maybeSingle<{ can_access: boolean }>();

  if (!userPermission.error && userPermission.data) {
    return Boolean(userPermission.data.can_access);
  }

  if (!resolution.appUser.role_id) {
    return false;
  }

  const rolePermission = await resolution.supabase
    .from("role_page_permissions")
    .select("can_access")
    .eq("tenant_id", resolution.appUser.tenant_id)
    .eq("role_id", resolution.appUser.role_id)
    .eq("page_key", "medicao-asbuilt")
    .maybeSingle<{ can_access: boolean }>();

  return !rolePermission.error && Boolean(rolePermission.data?.can_access);
}

async function resolveAsbuiltMeasurementContext(request: NextRequest, invalidSessionMessage: string) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage,
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return resolution;
  }

  const canAccess = await ensureAsbuiltMeasurementPageAccess(resolution);
  if (!canAccess) {
    return {
      error: {
        status: 403,
        message: "Acesso negado para operar medicao-asbuilt.",
      },
    };
  }

  return resolution;
}

async function fetchAppUserMap(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  ids: string[];
}) {
  if (!params.ids.length) {
    return new Map<string, AppUserRow>();
  }

  const { data } = await params.supabase
    .from("app_users")
    .select("id, display, login_name")
    .eq("tenant_id", params.tenantId)
    .in("id", params.ids)
    .returns<AppUserRow[]>();

  return new Map((data ?? []).map((item) => [item.id, item]));
}

async function fetchAsbuiltMeasurementOrderDetail(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  orderId: string;
}) {
  const { data: order, error: orderError } = await params.supabase
    .from("project_asbuilt_measurement_orders")
    .select("id, asbuilt_number, project_id, asbuilt_kind, no_production_reason_id, no_production_reason_name_snapshot, status, notes, project_code_snapshot, is_active, cancellation_reason, canceled_at, created_at, updated_at, created_by, updated_by")
    .eq("tenant_id", params.tenantId)
    .eq("id", params.orderId)
    .maybeSingle<AsbuiltMeasurementOrderRow>();

  if (orderError || !order) {
    return null;
  }

  let { data: items, error: itemsError } = await params.supabase
    .from("project_asbuilt_measurement_order_items")
    .select("id, asbuilt_measurement_order_id, service_activity_id, activity_code, activity_description, activity_unit, voice_point, quantity, rate, unit_value, activity_active_snapshot, total_value, observation, is_active, updated_at")
    .eq("tenant_id", params.tenantId)
    .eq("asbuilt_measurement_order_id", params.orderId)
    .eq("is_active", true)
    .order("activity_code", { ascending: true })
    .returns<AsbuiltMeasurementOrderItemRow[]>();

  if (itemsError && String(itemsError.message ?? "").includes("activity_active_snapshot")) {
    const fallback = await params.supabase
      .from("project_asbuilt_measurement_order_items")
      .select("id, asbuilt_measurement_order_id, service_activity_id, activity_code, activity_description, activity_unit, voice_point, quantity, rate, unit_value, total_value, observation, is_active, updated_at")
      .eq("tenant_id", params.tenantId)
      .eq("asbuilt_measurement_order_id", params.orderId)
      .eq("is_active", true)
      .order("activity_code", { ascending: true })
      .returns<AsbuiltMeasurementOrderItemRow[]>();
    items = fallback.data ?? [];
    itemsError = fallback.error;
  }

  if (itemsError) {
    return null;
  }

  const userIds = [order.created_by, order.updated_by].filter((item): item is string => Boolean(item));
  const userMap = await fetchAppUserMap({
    supabase: params.supabase,
    tenantId: params.tenantId,
    ids: Array.from(new Set(userIds)),
  });

  const normalizedItems = (items ?? []).map((item) => ({
    id: item.id,
    activityId: item.service_activity_id,
    code: normalizeText(item.activity_code),
    description: normalizeText(item.activity_description),
    unit: normalizeText(item.activity_unit),
    voicePoint: Number(item.voice_point ?? 0),
    unitValue: Number(item.unit_value ?? 0),
    activityIsActive: item.activity_active_snapshot !== false,
    quantity: Number(item.quantity ?? 0),
    rate: Number(item.rate ?? 0),
    totalValue: Number(item.total_value ?? 0),
    observation: normalizeText(item.observation),
  }));

  return {
    id: order.id,
    asbuiltMeasurementNumber: normalizeText(order.asbuilt_number),
    projectId: order.project_id,
    projectCode: normalizeText(order.project_code_snapshot),
    asbuiltMeasurementKind: normalizeAsbuiltMeasurementKind(order.asbuilt_kind),
    noProductionReasonId: order.no_production_reason_id,
    noProductionReasonName: normalizeText(order.no_production_reason_name_snapshot),
    status: order.status,
    notes: normalizeText(order.notes),
    cancellationReason: normalizeText(order.cancellation_reason),
    canceledAt: order.canceled_at,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    createdByName: resolveAppUserName(userMap.get(order.created_by ?? "")),
    updatedByName: resolveAppUserName(userMap.get(order.updated_by ?? "")),
    itemCount: normalizedItems.length,
    totalAmount: normalizedItems.reduce((sum, item) => sum + item.totalValue, 0),
    items: normalizedItems,
  };
}

async function loadHistory(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  orderId: string;
}) {
  const { data, error } = await params.supabase
    .from("project_asbuilt_measurement_order_history")
    .select("id, action_type, reason, changes, metadata, created_by, created_at")
    .eq("tenant_id", params.tenantId)
    .eq("asbuilt_measurement_order_id", params.orderId)
    .order("created_at", { ascending: false })
    .returns<AsbuiltMeasurementHistoryRow[]>();

  if (error) {
    return null;
  }

  const userIds = Array.from(new Set((data ?? []).map((item) => item.created_by).filter((item): item is string => Boolean(item))));
  const userMap = await fetchAppUserMap({
    supabase: params.supabase,
    tenantId: params.tenantId,
    ids: userIds,
  });

  return (data ?? []).map((item) => ({
    id: item.id,
    action: normalizeText(item.action_type),
    reason: normalizeText(item.reason),
    changes: item.changes ?? {},
    metadata: item.metadata ?? {},
    changedAt: item.created_at,
    changedByName: resolveAppUserName(userMap.get(item.created_by ?? "")),
  }));
}

export async function GET(request: NextRequest) {
  const resolution = await resolveAsbuiltMeasurementContext(request, "Sessao invalida para consultar medicao-asbuilt.");
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const historyOrderId = normalizeUuid(request.nextUrl.searchParams.get("historyOrderId"));
  if (historyOrderId) {
    const history = await loadHistory({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      orderId: historyOrderId,
    });

    if (history === null) {
      return NextResponse.json({ message: "Falha ao carregar historico do medicao-asbuilt." }, { status: 500 });
    }

    return NextResponse.json({ history });
  }

  const orderId = normalizeUuid(request.nextUrl.searchParams.get("orderId"));
  if (orderId) {
    const detail = await fetchAsbuiltMeasurementOrderDetail({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      orderId,
    });

    if (!detail) {
      return NextResponse.json({ message: "Medicao Asbuilt nao encontrado." }, { status: 404 });
    }

    return NextResponse.json({ order: detail });
  }

  const projectId = normalizeUuid(request.nextUrl.searchParams.get("projectId"));
  const statusFilter = normalizeText(request.nextUrl.searchParams.get("status")).toUpperCase();
  const asbuiltMeasurementKindFilter = normalizeText(request.nextUrl.searchParams.get("asbuiltMeasurementKind")).toUpperCase();
  const noProductionReasonIdFilter = normalizeUuid(request.nextUrl.searchParams.get("noProductionReasonId"));
  const page = normalizePositiveInteger(request.nextUrl.searchParams.get("page"), 1, 10_000);
  const pageSize = normalizePositiveInteger(request.nextUrl.searchParams.get("pageSize"), 20, 500);

  let query = resolution.supabase
    .from("project_asbuilt_measurement_orders")
    .select("id, asbuilt_number, project_id, asbuilt_kind, no_production_reason_id, no_production_reason_name_snapshot, status, notes, project_code_snapshot, is_active, cancellation_reason, canceled_at, created_at, updated_at, created_by, updated_by")
    .eq("tenant_id", resolution.appUser.tenant_id)
    .order("updated_at", { ascending: false });

  if (projectId) query = query.eq("project_id", projectId);
  if (statusFilter && statusFilter !== "TODOS") query = query.eq("status", statusFilter);
  if (asbuiltMeasurementKindFilter === "COM_PRODUCAO" || asbuiltMeasurementKindFilter === "SEM_PRODUCAO") query = query.eq("asbuilt_kind", asbuiltMeasurementKindFilter);
  if (noProductionReasonIdFilter) query = query.eq("no_production_reason_id", noProductionReasonIdFilter);

  const { data: orders, error } = await query.returns<AsbuiltMeasurementOrderRow[]>();
  if (error) {
    const hint = asbuiltMeasurementModuleMigrationHint(error.message);
    return NextResponse.json({ message: `Falha ao listar medicoes asbuilt.${hint}`.trim() }, { status: 500 });
  }

  const total = (orders ?? []).length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const pagedBaseOrders = (orders ?? []).slice(startIndex, startIndex + pageSize);
  const allOrderIds = (orders ?? []).map((item) => item.id);

  const { data: aggregateItems, error: aggregateError } = allOrderIds.length
    ? await resolution.supabase
      .from("project_asbuilt_measurement_order_items")
        .select("asbuilt_measurement_order_id, total_value")
        .eq("tenant_id", resolution.appUser.tenant_id)
        .eq("is_active", true)
        .in("asbuilt_measurement_order_id", allOrderIds)
        .returns<AsbuiltMeasurementAggregateItem[]>()
    : { data: [] as AsbuiltMeasurementAggregateItem[], error: null };

  if (aggregateError) {
    return NextResponse.json({ message: "Falha ao calcular totais das medicoes asbuilt." }, { status: 500 });
  }

  const userIds = Array.from(new Set((orders ?? []).flatMap((item) => [item.created_by, item.updated_by]).filter((item): item is string => Boolean(item))));
  const userMap = await fetchAppUserMap({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    ids: userIds,
  });

  const aggregateMap = buildAsbuiltMeasurementAggregateMap(aggregateItems);
  const summary = Array.from(aggregateMap.values()).reduce(
    (current, item) => ({
      totalAmount: current.totalAmount + item.totalAmount,
      itemCount: current.itemCount + item.itemCount,
    }),
    { totalAmount: 0, itemCount: 0 },
  );

  const pagedOrders = pagedBaseOrders.map((item) => {
    const aggregate = aggregateMap.get(item.id) ?? { totalAmount: 0, itemCount: 0 };
    return {
      id: item.id,
      asbuiltMeasurementNumber: normalizeText(item.asbuilt_number),
      projectId: item.project_id,
      projectCode: normalizeText(item.project_code_snapshot),
      asbuiltMeasurementKind: normalizeAsbuiltMeasurementKind(item.asbuilt_kind),
      noProductionReasonId: item.no_production_reason_id,
      noProductionReasonName: normalizeText(item.no_production_reason_name_snapshot),
      status: item.status,
      notes: normalizeText(item.notes),
      cancellationReason: normalizeText(item.cancellation_reason),
      canceledAt: item.canceled_at,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      createdByName: resolveAppUserName(userMap.get(item.created_by ?? "")),
      updatedByName: resolveAppUserName(userMap.get(item.updated_by ?? "")),
      totalAmount: aggregate.totalAmount,
      itemCount: aggregate.itemCount,
    };
  });

  return NextResponse.json({
    orders: pagedOrders,
    summary,
    pagination: {
      page: safePage,
      pageSize,
      total,
    },
  });
}

async function saveAsbuiltMeasurementOrder(request: NextRequest, method: "POST" | "PUT") {
  const resolution = await resolveAsbuiltMeasurementContext(request, "Sessao invalida para salvar medicao-asbuilt.");
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const payload = (await request.json().catch(() => null)) as SaveAsbuiltMeasurementPayload | null;
  const orderId = normalizeUuid(payload?.id);
  const projectId = normalizeUuid(payload?.projectId);
  const asbuiltMeasurementKind = normalizeAsbuiltMeasurementKind(payload?.asbuiltMeasurementKind);
  const noProductionReasonId = normalizeUuid(payload?.noProductionReasonId);
  const notes = normalizeText(payload?.notes) || null;
  const expectedUpdatedAt = normalizeText(payload?.expectedUpdatedAt) || null;
  const invalidItemValues = hasInvalidAsbuiltMeasurementItemValues(payload?.items);
  const items = normalizeAsbuiltMeasurementItems(payload?.items);

  if (method === "PUT" && !orderId) {
    return NextResponse.json({ message: "Medicao Asbuilt invalido para edicao." }, { status: 400 });
  }

  if (method === "PUT" && !expectedUpdatedAt) {
    return NextResponse.json({ message: "Atualize a lista antes de editar o medicao-asbuilt." }, { status: 409 });
  }

  if (!projectId) {
    return NextResponse.json({ message: "Projeto e obrigatorio para cadastrar medicao-asbuilt." }, { status: 400 });
  }

  const activeProjectIds = await loadActiveProjectIdSet({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    projectIds: [projectId],
  });

  if (!activeProjectIds.has(projectId)) {
    return NextResponse.json({
      message: "Projeto inativo nao pode ser usado no medicao-asbuilt.",
      reason: "PROJECT_INACTIVE",
    }, { status: 400 });
  }

  if (asbuiltMeasurementKind === "SEM_PRODUCAO" && !noProductionReasonId) {
    return NextResponse.json({ message: "Selecione o motivo de sem producao." }, { status: 400 });
  }

  if (asbuiltMeasurementKind === "COM_PRODUCAO" && noProductionReasonId) {
    return NextResponse.json({ message: "Motivo sem producao so pode ser informado para tipo Sem producao." }, { status: 400 });
  }

  if (invalidItemValues) {
    return NextResponse.json({ message: "Revise quantidades e taxas do medicao-asbuilt." }, { status: 400 });
  }

  if (!items.length) {
    return NextResponse.json({ message: "Informe ao menos uma atividade com quantidade e taxa." }, { status: 400 });
  }

  if (findDuplicateActivityId(items)) {
    return NextResponse.json({ message: "A mesma atividade nao pode ser repetida no medicao-asbuilt.", reason: "DUPLICATE_ASBUILT_MEASUREMENT_ACTIVITY" }, { status: 400 });
  }

  const { data, error } = await resolution.supabase.rpc("save_project_asbuilt_measurement_order", {
    p_tenant_id: resolution.appUser.tenant_id,
    p_actor_user_id: resolution.appUser.id,
    p_asbuilt_measurement_order_id: method === "PUT" ? orderId : null,
    p_project_id: projectId,
    p_asbuilt_kind: asbuiltMeasurementKind,
    p_no_production_reason_id: asbuiltMeasurementKind === "SEM_PRODUCAO" ? noProductionReasonId : null,
    p_notes: notes,
    p_items: items,
    p_expected_updated_at: expectedUpdatedAt,
  });

  if (error) {
    const hint = asbuiltMeasurementModuleMigrationHint(error.message);
    return NextResponse.json({ message: `Falha ao salvar medicao-asbuilt.${hint}`.trim() }, { status: 500 });
  }

  const result = (data ?? {}) as SaveAsbuiltMeasurementRpcResult;
  if (result.success !== true) {
    return NextResponse.json(
      {
        message: result.message ?? "Falha ao salvar medicao-asbuilt.",
        reason: result.reason ?? null,
        currentUpdatedAt: result.currentUpdatedAt ?? null,
      },
      { status: Number(result.status ?? 400) },
    );
  }

  const persistedOrderId = normalizeUuid(result.asbuilt_measurement_order_id ?? "");
  if (!persistedOrderId) {
    return NextResponse.json({ message: "Medicao Asbuilt salvo, mas sem identificador de retorno." }, { status: 500 });
  }

  const detail = await fetchAsbuiltMeasurementOrderDetail({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    orderId: persistedOrderId,
  });

  return NextResponse.json({
    success: true,
    id: persistedOrderId,
    updatedAt: result.updated_at ?? null,
    order: detail,
    message: result.message ?? "Medicao Asbuilt salvo com sucesso.",
  });
}

async function saveAsbuiltMeasurementOrderBatchPartial(request: NextRequest) {
  const resolution = await resolveAsbuiltMeasurementContext(request, "Sessao invalida para importar medicao-asbuilt em lote.");
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const payload = (await request.json().catch(() => null)) as SaveAsbuiltMeasurementBatchPayload | null;
  const rowsInput = Array.isArray(payload?.rows) ? payload.rows : [];
  if (!rowsInput.length) {
    return NextResponse.json({ message: "Nenhuma linha valida enviada para importacao em massa." }, { status: 400 });
  }

  const rows = rowsInput.map((row, index) => ({
    rowNumbers: normalizePositiveIntegerArray(row.rowNumbers).length ? normalizePositiveIntegerArray(row.rowNumbers) : [index + 2],
    projectId: normalizeUuid(row.projectId),
    asbuiltMeasurementKind: normalizeAsbuiltMeasurementKind(row.asbuiltMeasurementKind),
    noProductionReasonId: normalizeUuid(row.noProductionReasonId),
    notes: normalizeText(row.notes) || null,
    items: hasInvalidAsbuiltMeasurementItemValues(row.items) ? [] : normalizeAsbuiltMeasurementItems(row.items),
  }));

  const activeProjectIds = await loadActiveProjectIdSet({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    projectIds: rows.map((row) => row.projectId),
  });
  const inactiveProjectResults = rows
    .filter((row) => row.projectId && !activeProjectIds.has(row.projectId))
    .map((row) => ({
      rowNumbers: row.rowNumbers,
      success: false,
      reason: "PROJECT_INACTIVE",
      message: "Projeto inativo nao pode ser usado no medicao-asbuilt.",
      asbuiltMeasurementOrderId: null,
    }));
  const rowsWithActiveProjects = rows.filter((row) => !row.projectId || activeProjectIds.has(row.projectId));

  if (!rowsWithActiveProjects.length) {
    return NextResponse.json({
      success: true,
      savedCount: 0,
      errorCount: inactiveProjectResults.length,
      results: inactiveProjectResults,
      message: "Importacao parcial de medicao-asbuilt concluida.",
    });
  }

  const { data, error } = await resolution.supabase.rpc("save_project_asbuilt_measurement_order_batch_partial", {
    p_tenant_id: resolution.appUser.tenant_id,
    p_actor_user_id: resolution.appUser.id,
    p_rows: rowsWithActiveProjects,
  });

  if (error) {
    const hint = asbuiltMeasurementModuleMigrationHint(error.message);
    return NextResponse.json({ message: `Falha ao importar medicao-asbuilt em lote.${hint}`.trim() }, { status: 500 });
  }

  const result = (data ?? {}) as SaveAsbuiltMeasurementBatchRpcResult;
  if (result.success !== true) {
    return NextResponse.json({ message: result.message ?? "Falha ao importar medicao-asbuilt em lote.", reason: result.reason ?? null }, { status: Number(result.status ?? 400) });
  }

  return NextResponse.json({
    success: true,
    savedCount: Number(result.savedCount ?? 0),
    errorCount: Number(result.errorCount ?? 0) + inactiveProjectResults.length,
    results: [
      ...inactiveProjectResults,
      ...(Array.isArray(result.results) ? result.results : []).map((item) => ({
        rowNumbers: normalizePositiveIntegerArray(item.rowNumbers),
        success: item.success === true,
        reason: normalizeText(item.reason) || null,
        message: normalizeText(item.message) || "Falha ao processar linha do lote.",
        asbuiltMeasurementOrderId: normalizeUuid(item.asbuiltMeasurementOrderId ?? "") ?? null,
      })),
    ],
    message: normalizeText(result.message) || "Importacao parcial de medicao-asbuilt concluida.",
  });
}

export async function POST(request: NextRequest) {
  const preview = (await request.clone().json().catch(() => null)) as { action?: string } | null;
  const action = normalizeText(preview?.action).toUpperCase();
  if (action === "BATCH_IMPORT_PARTIAL") {
    return saveAsbuiltMeasurementOrderBatchPartial(request);
  }
  return saveAsbuiltMeasurementOrder(request, "POST");
}

export async function PUT(request: NextRequest) {
  return saveAsbuiltMeasurementOrder(request, "PUT");
}

export async function PATCH(request: NextRequest) {
  const resolution = await resolveAsbuiltMeasurementContext(request, "Sessao invalida para alterar status do medicao-asbuilt.");
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const payload = (await request.json().catch(() => null)) as UpdateStatusPayload | null;
  const orderId = normalizeUuid(payload?.id);
  const action = normalizeText(payload?.action).toUpperCase();
  const expectedUpdatedAt = normalizeText(payload?.expectedUpdatedAt) || null;
  const reason = normalizeText(payload?.reason) || null;

  if (!orderId || (action !== "FECHAR" && action !== "CANCELAR" && action !== "ABRIR")) {
    return NextResponse.json({ message: "Informe medicao-asbuilt e acao valida para atualizar o status." }, { status: 400 });
  }

  if (!expectedUpdatedAt) {
    return NextResponse.json({ message: "Atualize a lista antes de alterar o status do medicao-asbuilt." }, { status: 409 });
  }

  if ((action === "CANCELAR" || action === "ABRIR") && (!reason || reason.length < 10)) {
    return NextResponse.json({ message: action === "ABRIR" ? "Informe motivo da reabertura com no minimo 10 caracteres." : "Informe motivo do cancelamento com no minimo 10 caracteres." }, { status: 400 });
  }

  const { data, error } = await resolution.supabase.rpc("set_project_asbuilt_measurement_order_status", {
    p_tenant_id: resolution.appUser.tenant_id,
    p_actor_user_id: resolution.appUser.id,
    p_asbuilt_measurement_order_id: orderId,
    p_action: action,
    p_reason: reason,
    p_expected_updated_at: expectedUpdatedAt,
  });

  if (error) {
    const hint = asbuiltMeasurementModuleMigrationHint(error.message);
    return NextResponse.json({ message: `Falha ao alterar status do medicao-asbuilt.${hint}`.trim() }, { status: 500 });
  }

  const result = (data ?? {}) as SetAsbuiltMeasurementStatusRpcResult;
  if (result.success !== true) {
    return NextResponse.json(
      {
        message: result.message ?? "Falha ao alterar status do medicao-asbuilt.",
        reason: result.reason ?? null,
        currentUpdatedAt: result.currentUpdatedAt ?? null,
      },
      { status: Number(result.status ?? 400) },
    );
  }

  const detail = await fetchAsbuiltMeasurementOrderDetail({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    orderId,
  });

  return NextResponse.json({
    success: true,
    id: orderId,
    updatedAt: result.updated_at ?? null,
    status: result.asbuilt_status ?? null,
    order: detail,
    message: result.message ?? "Status do medicao-asbuilt atualizado com sucesso.",
  });
}

