import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";

type MeasurementOrderStatus = "ABERTA" | "FECHADA" | "CANCELADA";
type ProgrammingMatchStatus = "PROGRAMADA" | "NAO_PROGRAMADA";
type ProgrammingWorkCompletionStatus = "CONCLUIDO" | "PARCIAL" | null;
type MeasurementKind = "COM_PRODUCAO" | "SEM_PRODUCAO";

type MeasurementOrderRow = {
  id: string;
  order_number: string;
  programming_id: string | null;
  project_id: string;
  team_id: string;
  execution_date: string;
  measurement_date: string;
  voice_point: number | string;
  manual_rate: number | string;
  measurement_kind: MeasurementKind;
  no_production_reason_id: string | null;
  no_production_reason_name_snapshot: string | null;
  status: MeasurementOrderStatus;
  notes: string | null;
  project_code_snapshot: string;
  team_name_snapshot: string;
  foreman_name_snapshot: string | null;
  is_active: boolean;
  cancellation_reason: string | null;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  programming_completion_status_snapshot: string | null;
  programming_completion_status_snapshot_at: string | null;
};

type MeasurementOrderItemRow = {
  id: string;
  measurement_order_id: string;
  service_activity_id: string;
  programming_activity_id: string | null;
  project_activity_forecast_id: string | null;
  activity_code: string;
  activity_description: string;
  activity_unit: string;
  quantity: number | string;
  mva_quantity: number | string | null;
  worked_hours: number | string | null;
  voice_point: number | string;
  manual_rate: number | string;
  unit_value: number | string;
  total_value: number | string;
  observation: string | null;
  is_active: boolean;
  updated_at: string;
};

type MeasurementHistoryRow = {
  id: string;
  action_type: string;
  reason: string | null;
  changes: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
};

type AppUserRow = {
  id: string;
  display: string | null;
  login_name: string | null;
};

type MeasurementOrderAggregateItem = {
  measurement_order_id: string;
  total_value: number | string;
  quantity: number | string;
};

type ProgrammingMatchRow = {
  id: string;
  project_id: string;
  team_id: string;
  execution_date: string;
  status: string;
  work_completion_status: string | null;
  updated_at: string;
};

type SaveMeasurementPayload = {
  action?: string;
  id?: string;
  programmingId?: string;
  projectId?: string;
  teamId?: string;
  executionDate?: string;
  measurementDate?: string;
  voicePoint?: string | number;
  manualRate?: string | number;
  measurementKind?: string;
  noProductionReasonId?: string;
  notes?: string;
  expectedUpdatedAt?: string;
  items?: Array<{
    activityId?: string;
    programmingActivityId?: string;
    projectActivityForecastId?: string;
    quantity?: string | number;
    mvaQuantity?: string | number;
    workedHours?: string | number;
    unitValue?: string | number;
    voicePoint?: string | number;
    manualRate?: string | number;
    observation?: string;
  }>;
};

type SaveMeasurementBatchRowPayload = {
  rowNumbers?: number[];
  programmingId?: string;
  projectId?: string;
  teamId?: string;
  executionDate?: string;
  measurementDate?: string;
  voicePoint?: string | number;
  manualRate?: string | number;
  measurementKind?: string;
  noProductionReasonId?: string;
  notes?: string;
  items?: SaveMeasurementPayload["items"];
};

type SaveMeasurementBatchPayload = {
  action?: "BATCH_IMPORT_PARTIAL";
  rows?: SaveMeasurementBatchRowPayload[];
};

type UpdateStatusPayload = {
  id?: string;
  action?: "FECHAR" | "CANCELAR" | "ABRIR";
  reason?: string;
  expectedUpdatedAt?: string;
};

type SaveMeasurementRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  measurement_order_id?: string;
  updated_at?: string;
};

type SaveMeasurementBatchRpcItemResult = {
  rowIndex?: number;
  rowNumbers?: number[];
  success?: boolean;
  alreadyRegistered?: boolean;
  reason?: string | null;
  message?: string;
  measurementOrderId?: string;
};

type SaveMeasurementBatchRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  savedCount?: number;
  errorCount?: number;
  alreadyRegisteredCount?: number;
  alreadyRegisteredRows?: number;
  results?: SaveMeasurementBatchRpcItemResult[];
};

type SetMeasurementStatusRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  measurement_order_id?: string;
  updated_at?: string;
  measurement_status?: MeasurementOrderStatus;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeUuid(value: unknown) {
  const normalized = normalizeText(value);
  return /^[0-9a-f-]{36}$/i.test(normalized) ? normalized : null;
}

function normalizeIsoDate(value: unknown) {
  const normalized = normalizeText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function normalizeMeasurementKind(value: unknown): MeasurementKind {
  const normalized = normalizeText(value).toUpperCase();
  return normalized === "SEM_PRODUCAO" ? "SEM_PRODUCAO" : "COM_PRODUCAO";
}

function normalizePositiveNumber(value: unknown) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Number(parsed.toFixed(6));
}

function normalizeOptionalNonNegativeNumber(value: unknown) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!normalized) {
    return null;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Number(parsed.toFixed(6));
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
  const normalized = values
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0)
    .map((item) => Number(item));
  return Array.from(new Set(normalized));
}

function normalizeMeasurementItems(itemsInput: SaveMeasurementPayload["items"] | undefined) {
  const source = Array.isArray(itemsInput) ? itemsInput : [];
  return source
    .map((item) => ({
      activityId: normalizeUuid(item.activityId),
      programmingActivityId: normalizeUuid(item.programmingActivityId),
      projectActivityForecastId: normalizeUuid(item.projectActivityForecastId),
      quantity: normalizePositiveNumber(item.quantity),
      mvaQuantity: normalizePositiveNumber(item.mvaQuantity),
      workedHours: normalizePositiveNumber(item.workedHours),
      unitValue: normalizeOptionalNonNegativeNumber(item.unitValue),
      voicePoint: normalizeOptionalNonNegativeNumber(item.voicePoint),
      observation: normalizeText(item.observation) || null,
    }))
    .filter((item) => item.activityId && (item.quantity !== null || (item.mvaQuantity !== null && item.workedHours !== null)))
    .map((item) => ({
      activityId: item.activityId as string,
      programmingActivityId: item.programmingActivityId,
      projectActivityForecastId: item.projectActivityForecastId,
      quantity: item.quantity,
      mvaQuantity: item.mvaQuantity,
      workedHours: item.workedHours,
      unitValue: item.unitValue,
      voicePoint: item.voicePoint,
      observation: item.observation,
    }));
}

function findDuplicateMeasurementActivityId(
  items: Array<{
    activityId: string;
  }>,
) {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.activityId)) {
      return item.activityId;
    }
    seen.add(item.activityId);
  }
  return null;
}

function resolveAppUserName(user: AppUserRow | undefined) {
  if (!user) {
    return "Nao identificado";
  }

  return normalizeText(user.login_name) || normalizeText(user.display) || "Nao identificado";
}

function normalizeProgrammingWorkCompletionStatus(value: unknown): ProgrammingWorkCompletionStatus {
  const normalized = normalizeText(value).toUpperCase();
  if (normalized === "CONCLUIDO" || normalized === "PARCIAL") {
    return normalized;
  }
  return null;
}

function programmingStatusPriority(status: unknown) {
  const normalized = normalizeText(status).toUpperCase();
  if (normalized === "PROGRAMADA") return 0;
  if (normalized === "REPROGRAMADA") return 1;
  if (normalized === "ADIADA") return 2;
  if (normalized === "CANCELADA") return 3;
  return 4;
}

function buildProgrammingMatchKey(projectId: string, teamId: string, executionDate: string) {
  return `${projectId}|${teamId}|${executionDate}`;
}

function selectBestProgrammingMatch(candidates: ProgrammingMatchRow[]) {
  if (!candidates.length) {
    return null;
  }

  return [...candidates].sort((left, right) => {
    const byStatus = programmingStatusPriority(left.status) - programmingStatusPriority(right.status);
    if (byStatus !== 0) {
      return byStatus;
    }
    return String(right.updated_at).localeCompare(String(left.updated_at));
  })[0];
}

async function loadProgrammingMatchMap(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  orders: Array<Pick<MeasurementOrderRow, "id" | "project_id" | "team_id" | "execution_date" | "created_at" | "programming_completion_status_snapshot">>;
}) {
  if (!params.orders.length) {
    return new Map<string, {
      status: ProgrammingMatchStatus;
      programmingId: string | null;
      completionStatus: ProgrammingWorkCompletionStatus;
      completionStatusChangedAfterMeasurement: boolean;
    }>();
  }

  const projectIds = Array.from(new Set(params.orders.map((item) => item.project_id)));
  const teamIds = Array.from(new Set(params.orders.map((item) => item.team_id)));
  const executionDates = params.orders.map((item) => item.execution_date).sort();
  const startDate = executionDates[0];
  const endDate = executionDates[executionDates.length - 1];

  const preferred = await params.supabase
    .from("project_programming")
    .select("id, project_id, team_id, execution_date, status, work_completion_status, updated_at")
    .eq("tenant_id", params.tenantId)
    .in("project_id", projectIds)
    .in("team_id", teamIds)
    .gte("execution_date", startDate)
    .lte("execution_date", endDate)
    .returns<ProgrammingMatchRow[]>();

  const { data } = preferred.error
    ? await params.supabase
        .from("project_programming")
        .select("id, project_id, team_id, execution_date, status, updated_at")
        .eq("tenant_id", params.tenantId)
        .in("project_id", projectIds)
        .in("team_id", teamIds)
        .gte("execution_date", startDate)
        .lte("execution_date", endDate)
        .returns<Array<Omit<ProgrammingMatchRow, "work_completion_status">>>()
        .then((fallback) => ({
          data: (fallback.data ?? []).map((item) => ({ ...item, work_completion_status: null })),
        }))
    : { data: preferred.data ?? [] };

  const grouped = new Map<string, ProgrammingMatchRow[]>();
  for (const row of data ?? []) {
    const key = buildProgrammingMatchKey(row.project_id, row.team_id, row.execution_date);
    const current = grouped.get(key) ?? [];
    current.push(row);
    grouped.set(key, current);
  }

  const result = new Map<string, {
    status: ProgrammingMatchStatus;
    programmingId: string | null;
    completionStatus: ProgrammingWorkCompletionStatus;
    completionStatusChangedAfterMeasurement: boolean;
  }>();

  for (const order of params.orders) {
    const key = buildProgrammingMatchKey(order.project_id, order.team_id, order.execution_date);
    const bestMatch = selectBestProgrammingMatch(grouped.get(key) ?? []);
    if (!bestMatch) {
      result.set(order.id, {
        status: "NAO_PROGRAMADA",
        programmingId: null,
        completionStatus: null,
        completionStatusChangedAfterMeasurement: false,
      });
      continue;
    }

    const currentCompletion = normalizeProgrammingWorkCompletionStatus(bestMatch.work_completion_status);
    const snapshotCompletion = normalizeProgrammingWorkCompletionStatus(order.programming_completion_status_snapshot);
    const changedBySnapshot = Boolean(snapshotCompletion && currentCompletion && snapshotCompletion !== currentCompletion);

    const changedAfterMeasurementWithoutSnapshot = Boolean(
      !snapshotCompletion
      && currentCompletion
      && new Date(bestMatch.updated_at).getTime() > new Date(order.created_at).getTime(),
    );

    result.set(order.id, {
      status: "PROGRAMADA",
      programmingId: bestMatch.id,
      completionStatus: currentCompletion,
      completionStatusChangedAfterMeasurement: changedBySnapshot || changedAfterMeasurementWithoutSnapshot,
    });
  }

  return result;
}

function measurementModuleMigrationHint(message: string | undefined) {
  const normalized = String(message ?? "").toLowerCase();
  if (
    normalized.includes("project_measurement_orders")
    || normalized.includes("project_measurement_order_items")
    || normalized.includes("project_measurement_order_history")
    || normalized.includes("save_project_measurement_order")
    || normalized.includes("set_project_measurement_order_status")
    || normalized.includes("save_project_measurement_order_batch_partial")
  ) {
    return " Verifique se as migrations 112_create_measurement_order_module.sql, 115_allow_historical_programming_in_measurement_save.sql, 116_measurement_programming_match_and_completion_alert.sql, 117_allow_measurement_context_edit_and_history_details.sql, 119_create_measurement_batch_import_partial_rpc.sql, 120_unify_measurement_with_service_activities.sql, 122_protect_duplicate_measurement_items_in_rpc.sql, 123_support_measurement_without_production.sql, 124_add_measurement_reopen_status_action.sql, 125_require_closed_before_measurement_cancel.sql, 126_allow_measurement_cancel_when_open.sql e 127_add_mva_hour_composed_quantity_to_measurement_items.sql foram aplicadas.";
  }
  return "";
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

async function fetchMeasurementOrderDetail(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  orderId: string;
}) {
  const { data: order, error: orderError } = await params.supabase
    .from("project_measurement_orders")
    .select("id, order_number, programming_id, project_id, team_id, execution_date, measurement_date, voice_point, manual_rate, measurement_kind, no_production_reason_id, no_production_reason_name_snapshot, status, notes, project_code_snapshot, team_name_snapshot, foreman_name_snapshot, is_active, cancellation_reason, canceled_at, created_at, updated_at, created_by, updated_by, programming_completion_status_snapshot, programming_completion_status_snapshot_at")
    .eq("tenant_id", params.tenantId)
    .eq("id", params.orderId)
    .maybeSingle<MeasurementOrderRow>();

  if (orderError || !order) {
    return null;
  }

  const { data: items } = await params.supabase
    .from("project_measurement_order_items")
    .select("id, measurement_order_id, service_activity_id, programming_activity_id, project_activity_forecast_id, activity_code, activity_description, activity_unit, quantity, mva_quantity, worked_hours, voice_point, manual_rate, unit_value, total_value, observation, is_active, updated_at")
    .eq("tenant_id", params.tenantId)
    .eq("measurement_order_id", params.orderId)
    .eq("is_active", true)
    .order("activity_code", { ascending: true })
    .returns<MeasurementOrderItemRow[]>();

  const userIds = [order.created_by, order.updated_by].filter((item): item is string => Boolean(item));
  const userMap = await fetchAppUserMap({
    supabase: params.supabase,
    tenantId: params.tenantId,
    ids: Array.from(new Set(userIds)),
  });

  const normalizedItems = (items ?? []).map((item) => ({
    id: item.id,
    activityId: item.service_activity_id,
    programmingActivityId: item.programming_activity_id,
    projectActivityForecastId: item.project_activity_forecast_id,
    code: normalizeText(item.activity_code),
    description: normalizeText(item.activity_description),
    unit: normalizeText(item.activity_unit),
    quantity: Number(item.quantity ?? 0),
    mvaQuantity: item.mva_quantity === null || item.mva_quantity === undefined ? null : Number(item.mva_quantity),
    workedHours: item.worked_hours === null || item.worked_hours === undefined ? null : Number(item.worked_hours),
    voicePoint: Number(item.voice_point ?? 0),
    manualRate: Number(item.manual_rate ?? 0),
    unitValue: Number(item.unit_value ?? 0),
    totalValue: Number(item.total_value ?? 0),
    observation: normalizeText(item.observation),
  }));

  const programmingMatchMap = await loadProgrammingMatchMap({
    supabase: params.supabase,
    tenantId: params.tenantId,
    orders: [order],
  });
  const programmingMatch = programmingMatchMap.get(order.id) ?? {
    status: "NAO_PROGRAMADA" as ProgrammingMatchStatus,
    programmingId: null,
    completionStatus: null,
    completionStatusChangedAfterMeasurement: false,
  };

  return {
    id: order.id,
    orderNumber: normalizeText(order.order_number),
    programmingId: order.programming_id,
    projectId: order.project_id,
    teamId: order.team_id,
    executionDate: order.execution_date,
    measurementDate: order.measurement_date,
    voicePoint: Number(order.voice_point ?? 0),
    manualRate: Number(order.manual_rate ?? 0),
    measurementKind: normalizeMeasurementKind(order.measurement_kind),
    noProductionReasonId: order.no_production_reason_id,
    noProductionReasonName: normalizeText(order.no_production_reason_name_snapshot),
    status: order.status,
    notes: normalizeText(order.notes),
    projectCode: normalizeText(order.project_code_snapshot),
    teamName: normalizeText(order.team_name_snapshot),
    foremanName: normalizeText(order.foreman_name_snapshot),
    isActive: Boolean(order.is_active),
    cancellationReason: normalizeText(order.cancellation_reason),
    canceledAt: order.canceled_at,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    createdByName: resolveAppUserName(userMap.get(order.created_by ?? "")),
    updatedByName: resolveAppUserName(userMap.get(order.updated_by ?? "")),
    programmingMatchStatus: programmingMatch.status,
    matchedProgrammingId: programmingMatch.programmingId,
    programmingCompletionStatus: programmingMatch.completionStatus,
    programmingCompletionStatusChangedAfterMeasurement: programmingMatch.completionStatusChangedAfterMeasurement,
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
    .from("project_measurement_order_history")
    .select("id, action_type, reason, changes, metadata, created_by, created_at")
    .eq("tenant_id", params.tenantId)
    .eq("measurement_order_id", params.orderId)
    .order("created_at", { ascending: false })
    .returns<MeasurementHistoryRow[]>();

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
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para consultar ordens de medicao.",
    inactiveMessage: "Usuario inativo.",
  });

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
      return NextResponse.json({ message: "Falha ao carregar historico da ordem de medicao." }, { status: 500 });
    }

    return NextResponse.json({ history });
  }

  const orderId = normalizeUuid(request.nextUrl.searchParams.get("orderId"));
  if (orderId) {
    const detail = await fetchMeasurementOrderDetail({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      orderId,
    });

    if (!detail) {
      return NextResponse.json({ message: "Ordem de medicao nao encontrada." }, { status: 404 });
    }

    return NextResponse.json({ order: detail });
  }

  const startDate = normalizeIsoDate(request.nextUrl.searchParams.get("startDate"));
  const endDate = normalizeIsoDate(request.nextUrl.searchParams.get("endDate"));
  const projectId = normalizeUuid(request.nextUrl.searchParams.get("projectId"));
  const statusFilter = normalizeText(request.nextUrl.searchParams.get("status")).toUpperCase();
  const measurementKindFilter = normalizeText(request.nextUrl.searchParams.get("measurementKind")).toUpperCase();
  const noProductionReasonIdFilter = normalizeUuid(request.nextUrl.searchParams.get("noProductionReasonId"));
  const programmingMatchFilter = normalizeText(request.nextUrl.searchParams.get("programmingMatch")).toUpperCase();
  const completionAlertFilter = normalizeText(request.nextUrl.searchParams.get("completionAlert")).toUpperCase();
  const page = normalizePositiveInteger(request.nextUrl.searchParams.get("page"), 1, 10_000);
  const pageSize = normalizePositiveInteger(request.nextUrl.searchParams.get("pageSize"), 20, 500);

  if (!startDate || !endDate) {
    return NextResponse.json({ message: "startDate e endDate sao obrigatorios." }, { status: 400 });
  }

  let query = resolution.supabase
    .from("project_measurement_orders")
    .select("id, order_number, programming_id, project_id, team_id, execution_date, measurement_date, voice_point, manual_rate, measurement_kind, no_production_reason_id, no_production_reason_name_snapshot, status, notes, project_code_snapshot, team_name_snapshot, foreman_name_snapshot, is_active, cancellation_reason, canceled_at, created_at, updated_at, created_by, updated_by, programming_completion_status_snapshot, programming_completion_status_snapshot_at")
    .eq("tenant_id", resolution.appUser.tenant_id)
    .gte("execution_date", startDate)
    .lte("execution_date", endDate)
    .order("execution_date", { ascending: false })
    .order("updated_at", { ascending: false });

  if (projectId) {
    query = query.eq("project_id", projectId);
  }
  if (statusFilter && statusFilter !== "TODOS") {
    query = query.eq("status", statusFilter);
  }

  const { data: orders, error } = await query.returns<MeasurementOrderRow[]>();
  if (error) {
    const hint = measurementModuleMigrationHint(error.message);
    return NextResponse.json({ message: `Falha ao listar ordens de medicao.${hint}`.trim() }, { status: 500 });
  }

  const userIds = Array.from(
    new Set(
      (orders ?? [])
        .flatMap((item) => [item.created_by, item.updated_by])
        .filter((item): item is string => Boolean(item)),
    ),
  );
  const userMap = await fetchAppUserMap({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    ids: userIds,
  });

  const programmingMatchMap = await loadProgrammingMatchMap({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    orders: orders ?? [],
  });

  const baseOrders = (orders ?? []).map((item) => {
      const programmingMatch = programmingMatchMap.get(item.id) ?? {
        status: "NAO_PROGRAMADA" as ProgrammingMatchStatus,
        programmingId: null,
        completionStatus: null,
        completionStatusChangedAfterMeasurement: false,
      };
      return {
        id: item.id,
        orderNumber: normalizeText(item.order_number),
        programmingId: item.programming_id,
        projectId: item.project_id,
        teamId: item.team_id,
        executionDate: item.execution_date,
        measurementDate: item.measurement_date,
        voicePoint: Number(item.voice_point ?? 0),
        manualRate: Number(item.manual_rate ?? 0),
        measurementKind: normalizeMeasurementKind(item.measurement_kind),
        noProductionReasonId: item.no_production_reason_id,
        noProductionReasonName: normalizeText(item.no_production_reason_name_snapshot),
        status: item.status,
        notes: normalizeText(item.notes),
        projectCode: normalizeText(item.project_code_snapshot),
        teamName: normalizeText(item.team_name_snapshot),
        foremanName: normalizeText(item.foreman_name_snapshot),
        cancellationReason: normalizeText(item.cancellation_reason),
        canceledAt: item.canceled_at,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        createdByName: resolveAppUserName(userMap.get(item.created_by ?? "")),
        updatedByName: resolveAppUserName(userMap.get(item.updated_by ?? "")),
        programmingMatchStatus: programmingMatch.status,
        matchedProgrammingId: programmingMatch.programmingId,
        programmingCompletionStatus: programmingMatch.completionStatus,
        programmingCompletionStatusChangedAfterMeasurement: programmingMatch.completionStatusChangedAfterMeasurement,
      };
    });

  const filteredByProgrammingMatch = (programmingMatchFilter === "PROGRAMADA" || programmingMatchFilter === "NAO_PROGRAMADA")
    ? baseOrders.filter((item) => item.programmingMatchStatus === programmingMatchFilter)
    : baseOrders;

  const filteredByCompletionAlert = (completionAlertFilter === "SIM" || completionAlertFilter === "NAO")
    ? filteredByProgrammingMatch.filter((item) =>
        completionAlertFilter === "SIM"
          ? item.programmingCompletionStatusChangedAfterMeasurement
          : !item.programmingCompletionStatusChangedAfterMeasurement)
    : filteredByProgrammingMatch;

  const filteredByMeasurementKind = (measurementKindFilter === "COM_PRODUCAO" || measurementKindFilter === "SEM_PRODUCAO")
    ? filteredByCompletionAlert.filter((item) => item.measurementKind === measurementKindFilter)
    : filteredByCompletionAlert;

  const filteredByNoProductionReason = noProductionReasonIdFilter
    ? filteredByMeasurementKind.filter((item) => item.noProductionReasonId === noProductionReasonIdFilter)
    : filteredByMeasurementKind;

  const total = filteredByNoProductionReason.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const pagedBaseOrders = filteredByNoProductionReason.slice(startIndex, startIndex + pageSize);
  const pagedOrderIds = pagedBaseOrders.map((item) => item.id);

  const { data: aggregateItems } = pagedOrderIds.length
    ? await resolution.supabase
        .from("project_measurement_order_items")
        .select("measurement_order_id, total_value, quantity")
        .eq("tenant_id", resolution.appUser.tenant_id)
        .eq("is_active", true)
        .in("measurement_order_id", pagedOrderIds)
        .returns<MeasurementOrderAggregateItem[]>()
    : { data: [] as MeasurementOrderAggregateItem[] };

  const aggregateMap = new Map<string, { totalAmount: number; itemCount: number }>();
  for (const item of aggregateItems ?? []) {
    const current = aggregateMap.get(item.measurement_order_id) ?? { totalAmount: 0, itemCount: 0 };
    current.totalAmount += Number(item.total_value ?? 0);
    current.itemCount += 1;
    aggregateMap.set(item.measurement_order_id, current);
  }

  const pagedOrders = pagedBaseOrders.map((item) => {
    const aggregate = aggregateMap.get(item.id) ?? { totalAmount: 0, itemCount: 0 };
    return {
      ...item,
      totalAmount: Number(aggregate.totalAmount ?? 0),
      itemCount: Number(aggregate.itemCount ?? 0),
    };
  });

  return NextResponse.json({
    orders: pagedOrders,
    pagination: {
      page: safePage,
      pageSize,
      total,
    },
  });
}

async function saveMeasurementOrder(request: NextRequest, method: "POST" | "PUT") {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para salvar ordem de medicao.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const payload = (await request.json().catch(() => null)) as SaveMeasurementPayload | null;
  const orderId = normalizeUuid(payload?.id);
  const programmingId = normalizeUuid(payload?.programmingId);
  const projectId = normalizeUuid(payload?.projectId);
  const teamId = normalizeUuid(payload?.teamId);
  const executionDate = normalizeIsoDate(payload?.executionDate);
  const measurementDate = normalizeIsoDate(payload?.measurementDate);
  const voicePoint = normalizePositiveNumber(payload?.voicePoint);
  const manualRate = normalizePositiveNumber(payload?.manualRate);
  const measurementKind = normalizeMeasurementKind(payload?.measurementKind);
  const noProductionReasonId = normalizeUuid(payload?.noProductionReasonId);
  const notes = normalizeText(payload?.notes) || null;
  const expectedUpdatedAt = normalizeText(payload?.expectedUpdatedAt) || null;

  if (method === "PUT" && !orderId) {
    return NextResponse.json({ message: "Ordem de medicao invalida para edicao." }, { status: 400 });
  }

  if (method === "PUT" && (!projectId || !teamId || !executionDate)) {
    return NextResponse.json({ message: "Na edicao, Projeto, Equipe e Data de execucao sao obrigatorios." }, { status: 400 });
  }

  if (method === "POST" && !programmingId && (!projectId || !teamId || !executionDate)) {
    return NextResponse.json({ message: "Informe Projeto, Equipe e Data de execucao para cadastrar a medicao sem programacao." }, { status: 400 });
  }

  if (!measurementDate) {
    return NextResponse.json({ message: "Data da medicao e obrigatoria." }, { status: 400 });
  }

  const items = normalizeMeasurementItems(payload?.items);

  if (measurementKind === "COM_PRODUCAO") {
    if (noProductionReasonId) {
      return NextResponse.json({ message: "Motivo sem producao so pode ser informado para tipo Sem producao." }, { status: 400 });
    }

    if (voicePoint === null || manualRate === null) {
      return NextResponse.json({ message: "Para medicao com producao, pontos e taxa manual sao obrigatorios." }, { status: 400 });
    }

    if (!items.length) {
      return NextResponse.json({ message: "Informe ao menos uma atividade valida na ordem de medicao." }, { status: 400 });
    }
  }

  if (measurementKind === "SEM_PRODUCAO") {
    if (!noProductionReasonId) {
      return NextResponse.json({ message: "Selecione o motivo de sem producao." }, { status: 400 });
    }

    if (items.length) {
      return NextResponse.json({ message: "Medicao sem producao nao pode conter atividades." }, { status: 400 });
    }
  }

  if (findDuplicateMeasurementActivityId(items)) {
    return NextResponse.json(
      { message: "A mesma atividade nao pode ser repetida na ordem de medicao.", reason: "DUPLICATE_MEASUREMENT_ACTIVITY" },
      { status: 400 },
    );
  }

  const { data, error } = await resolution.supabase.rpc("save_project_measurement_order", {
    p_tenant_id: resolution.appUser.tenant_id,
    p_actor_user_id: resolution.appUser.id,
    p_measurement_order_id: method === "PUT" ? orderId : null,
    p_programming_id: programmingId,
    p_project_id: projectId,
    p_team_id: teamId,
    p_execution_date: executionDate,
    p_measurement_date: measurementDate,
    p_voice_point: voicePoint ?? 1,
    p_manual_rate: manualRate ?? 1,
    p_notes: notes,
    p_measurement_kind: measurementKind,
    p_no_production_reason_id: measurementKind === "SEM_PRODUCAO" ? noProductionReasonId : null,
    p_items: items,
    p_expected_updated_at: expectedUpdatedAt,
  });

  if (error) {
    const hint = measurementModuleMigrationHint(error.message);
    return NextResponse.json({ message: `Falha ao salvar ordem de medicao.${hint}`.trim() }, { status: 500 });
  }

  const result = (data ?? {}) as SaveMeasurementRpcResult;
  if (result.success !== true) {
    return NextResponse.json({ message: result.message ?? "Falha ao salvar ordem de medicao.", reason: result.reason ?? null }, { status: Number(result.status ?? 400) });
  }

  const persistedOrderId = normalizeUuid(result.measurement_order_id ?? "");
  if (!persistedOrderId) {
    return NextResponse.json({ message: "Ordem salva, mas nao foi possivel retornar o identificador." }, { status: 500 });
  }

  const detail = await fetchMeasurementOrderDetail({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    orderId: persistedOrderId,
  });

  return NextResponse.json({
    success: true,
    id: persistedOrderId,
    updatedAt: result.updated_at ?? null,
    order: detail,
    message: result.message ?? "Ordem de medicao salva com sucesso.",
  });
}

async function saveMeasurementOrderBatchPartial(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para importar medicao em lote.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const payload = (await request.json().catch(() => null)) as SaveMeasurementBatchPayload | null;
  const rowsInput = Array.isArray(payload?.rows) ? payload.rows : [];
  if (!rowsInput.length) {
    return NextResponse.json({ message: "Nenhuma linha valida enviada para importacao em massa." }, { status: 400 });
  }

  const rows = rowsInput.map((row, index) => {
    const executionDate = normalizeIsoDate(row.executionDate);
    const measurementDate = normalizeIsoDate(row.measurementDate) ?? executionDate;
    const rowNumbers = normalizePositiveIntegerArray(row.rowNumbers);
    return {
      rowNumbers: rowNumbers.length ? rowNumbers : [index + 2],
      programmingId: normalizeUuid(row.programmingId),
      projectId: normalizeUuid(row.projectId),
      teamId: normalizeUuid(row.teamId),
      executionDate,
      measurementDate,
      voicePoint: normalizePositiveNumber(row.voicePoint) ?? 1,
      manualRate: normalizePositiveNumber(row.manualRate) ?? null,
      measurementKind: normalizeMeasurementKind(row.measurementKind),
      noProductionReasonId: normalizeUuid(row.noProductionReasonId),
      notes: normalizeText(row.notes) || null,
      items: normalizeMeasurementItems(row.items),
    };
  });

  const { data, error } = await resolution.supabase.rpc("save_project_measurement_order_batch_partial", {
    p_tenant_id: resolution.appUser.tenant_id,
    p_actor_user_id: resolution.appUser.id,
    p_rows: rows,
  });

  if (error) {
    const hint = measurementModuleMigrationHint(error.message);
    return NextResponse.json({ message: `Falha ao importar medicao em lote.${hint}`.trim() }, { status: 500 });
  }

  const result = (data ?? {}) as SaveMeasurementBatchRpcResult;
  if (result.success !== true) {
    return NextResponse.json(
      { message: result.message ?? "Falha ao importar medicao em lote.", reason: result.reason ?? null },
      { status: Number(result.status ?? 400) },
    );
  }

  const normalizedResults = (Array.isArray(result.results) ? result.results : []).map((item) => ({
    rowIndex: Number(item.rowIndex ?? 0) || null,
    rowNumbers: normalizePositiveIntegerArray(item.rowNumbers),
    success: item.success === true,
    alreadyRegistered: item.alreadyRegistered === true,
    reason: normalizeText(item.reason) || null,
    message: normalizeText(item.message) || "Falha ao processar linha do lote.",
    measurementOrderId: normalizeUuid(item.measurementOrderId ?? "") ?? null,
  }));

  return NextResponse.json({
    success: true,
    status: Number(result.status ?? 200),
    savedCount: Number(result.savedCount ?? 0),
    errorCount: Number(result.errorCount ?? 0),
    alreadyRegisteredCount: Number(result.alreadyRegisteredCount ?? 0),
    alreadyRegisteredRows: Number(result.alreadyRegisteredRows ?? 0),
    results: normalizedResults,
    message: normalizeText(result.message) || "Importacao parcial da medicao concluida.",
  });
}

export async function POST(request: NextRequest) {
  const preview = (await request.clone().json().catch(() => null)) as { action?: string } | null;
  const action = normalizeText(preview?.action).toUpperCase();
  if (action === "BATCH_IMPORT_PARTIAL") {
    return saveMeasurementOrderBatchPartial(request);
  }
  return saveMeasurementOrder(request, "POST");
}

export async function PUT(request: NextRequest) {
  return saveMeasurementOrder(request, "PUT");
}

export async function PATCH(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para alterar status da ordem de medicao.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const payload = (await request.json().catch(() => null)) as UpdateStatusPayload | null;
  const orderId = normalizeUuid(payload?.id);
  const action = normalizeText(payload?.action).toUpperCase();
  const expectedUpdatedAt = normalizeText(payload?.expectedUpdatedAt) || null;
  const reason = normalizeText(payload?.reason) || null;

  if (!orderId || (action !== "FECHAR" && action !== "CANCELAR" && action !== "ABRIR")) {
    return NextResponse.json({ message: "Informe ordem e acao valida para atualizar o status." }, { status: 400 });
  }

  if (!expectedUpdatedAt) {
    return NextResponse.json({ message: "Atualize a lista antes de alterar o status da ordem." }, { status: 409 });
  }

  if ((action === "CANCELAR" || action === "ABRIR") && (!reason || reason.length < 10)) {
    return NextResponse.json({ message: action === "ABRIR" ? "Informe motivo da reabertura com no minimo 10 caracteres." : "Informe motivo do cancelamento com no minimo 10 caracteres." }, { status: 400 });
  }

  const { data, error } = await resolution.supabase.rpc("set_project_measurement_order_status", {
    p_tenant_id: resolution.appUser.tenant_id,
    p_actor_user_id: resolution.appUser.id,
    p_measurement_order_id: orderId,
    p_action: action,
    p_reason: reason,
    p_expected_updated_at: expectedUpdatedAt,
  });

  if (error) {
    return NextResponse.json({ message: "Falha ao alterar status da ordem de medicao." }, { status: 500 });
  }

  const result = (data ?? {}) as SetMeasurementStatusRpcResult;
  if (result.success !== true) {
    return NextResponse.json({ message: result.message ?? "Falha ao alterar status da ordem de medicao.", reason: result.reason ?? null }, { status: Number(result.status ?? 400) });
  }

  const detail = await fetchMeasurementOrderDetail({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    orderId,
  });

  return NextResponse.json({
    success: true,
    id: orderId,
    updatedAt: result.updated_at ?? null,
    status: result.measurement_status ?? null,
    order: detail,
    message: result.message ?? "Status da ordem de medicao atualizado com sucesso.",
  });
}
