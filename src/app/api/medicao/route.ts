import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";

type MeasurementOrderStatus = "ABERTA" | "FECHADA" | "CANCELADA";
type ProgrammingMatchStatus = "PROGRAMADA" | "NAO_PROGRAMADA";
type ProgrammingWorkCompletionStatus = string | null;
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
  minimum_billing_amount: number | string;
  minimum_billing_team_type_id: string | null;
  minimum_billing_team_type_name_snapshot: string | null;
  minimum_billing_score_target_id: string | null;
  minimum_billing_target_points: number | string | null;
  minimum_billing_unit_value_source_activity_id: string | null;
  minimum_billing_unit_value_group_snapshot: string | null;
  minimum_billing_unit_value: number | string | null;
  minimum_billing_calculated_at: string | null;
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
  voice_point: number | string;
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

type ProgrammingWorkCompletionHistoryRow = {
  id: string;
  programming_id: string;
  project_id: string | null;
  from_execution_date: string | null;
  to_execution_date: string | null;
  changes: Record<string, unknown> | null;
  created_at: string;
};

type MeasurementOrderActivityFilterRow = {
  measurement_order_id: string;
};

type TeamCompositionContextRow = {
  project_id: string;
  team_id: string;
  composition_date: string;
};

type ProjectTestRow = {
  id: string;
  is_test: boolean | null;
};

type ProjectServiceCenterRow = {
  id: string;
  service_center?: string | null;
  service_center_text: string | null;
};

type ProjectServiceCenterLookupRow = {
  id: string;
  name: string | null;
};

type ProjectServiceTypeProjectRow = {
  id: string;
};

type TeamRow = {
  id: string;
  team_type_id: string | null;
};

type TeamTypeRow = {
  id: string;
  name: string | null;
};

type TeamTypeHistoryRow = {
  team_id: string;
  team_type_id: string | null;
  team_type_name_snapshot: string | null;
  valid_from: string;
  valid_to: string | null;
};

type MeasurementScoreTargetRow = {
  team_type_id: string;
  target_points: number | string;
};

type MeasurementTeamTypeTargetRow = {
  team_type_id: string;
  daily_value: number | string;
};

type CycleWorkdaysRow = {
  id: string;
  cycle_start: string;
};

type CycleTargetItemRow = {
  cycle_id: string;
  team_type_id: string;
  daily_value: number | string;
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

const SUPABASE_LIST_PAGE_SIZE = 1000;
const MEASUREMENT_ORDER_SELECT = "id, order_number, programming_id, project_id, team_id, execution_date, measurement_date, voice_point, manual_rate, measurement_kind, no_production_reason_id, no_production_reason_name_snapshot, status, notes, project_code_snapshot, team_name_snapshot, foreman_name_snapshot, is_active, cancellation_reason, canceled_at, created_at, updated_at, created_by, updated_by, programming_completion_status_snapshot, programming_completion_status_snapshot_at, minimum_billing_amount, minimum_billing_team_type_id, minimum_billing_team_type_name_snapshot, minimum_billing_score_target_id, minimum_billing_target_points, minimum_billing_unit_value_source_activity_id, minimum_billing_unit_value_group_snapshot, minimum_billing_unit_value, minimum_billing_calculated_at";

type SupabasePageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
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

function createUtcDate(year: number, monthIndex: number, day: number) {
  return new Date(Date.UTC(year, monthIndex, day));
}

function parseIsoDate(value: string) {
  const [year, month, day] = value.split("-").map((item) => Number(item));
  return createUtcDate(year, month - 1, day);
}

function toUtcIsoDate(value: Date) {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addMonths(value: Date, months: number) {
  return createUtcDate(value.getUTCFullYear(), value.getUTCMonth() + months, value.getUTCDate());
}

function resolveCycleStart(reference: Date) {
  const year = reference.getUTCFullYear();
  const monthIndex = reference.getUTCMonth();
  const day = reference.getUTCDate();
  return day >= 21 ? createUtcDate(year, monthIndex, 21) : createUtcDate(year, monthIndex - 1, 21);
}

function buildMeasurementCycleStart(value: string) {
  const measurementDate = parseIsoDate(value);
  const start = resolveCycleStart(measurementDate);
  const end = addMonths(start, 1);
  end.setUTCDate(20);
  return toUtcIsoDate(start);
}

function normalizeTeamTypeToken(value: unknown) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function measurementScoreTypeLabel(value: unknown) {
  const original = normalizeText(value);
  const token = normalizeTeamTypeToken(original);
  if (token === "MK" || token === "LM" || token === "LINHA_MORTA") return "MK";
  if (token === "LV" || token === "LINHA_VIVA") return "LV";
  if (token === "CESTO" || token === "CETO") return "CESTO";
  return original || "Nao identificado";
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

function normalizeWorkCompletionStatusToken(value: unknown) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, "_");
}

function resolveMeasurementWorkCompletionStatus(value: unknown): ProgrammingWorkCompletionStatus {
  const token = normalizeWorkCompletionStatusToken(value);
  if (!token || token === "NAO_INFORMADO") {
    return null;
  }

  if (
    token === "CONCLUIDO"
    || token === "COMPLETO"
    || token.startsWith("CONCLUIDO")
  ) {
    return "CONCLUIDO";
  }

  if (token === "PARCIAL_PLANEJADO_BENEFICIO_ATINGIDO" || token === "PARCIAL_PLANEJADO_BENFICIO_ATINGIDO") {
    return "PARCIAL_PLANEJADO_BENEFICIO_ATINGIDO";
  }

  if (token === "PARCIAL" || token.startsWith("PARCIAL")) {
    return "PARCIAL";
  }

  return token;
}

function programmingStatusPriority(status: unknown) {
  const normalized = normalizeText(status).toUpperCase();
  if (normalized === "PROGRAMADA") return 0;
  if (normalized === "REPROGRAMADA") return 1;
  if (normalized === "ADIADA") return 2;
  if (normalized === "CANCELADA") return 3;
  return 4;
}

function isCanceledProgrammingStatus(status: unknown) {
  return normalizeText(status).toUpperCase() === "CANCELADA";
}

function buildProgrammingMatchKey(projectId: string, teamId: string, executionDate: string) {
  return `${projectId}|${teamId}|${executionDate}`;
}

function buildProgrammingProjectDateKey(projectId: string, executionDate: string) {
  return `${projectId}|${executionDate}`;
}

async function fetchTeamCompositionContextSet(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  orders: Array<Pick<MeasurementOrderRow, "project_id" | "team_id" | "execution_date">>;
}) {
  if (!params.orders.length) {
    return { data: new Set<string>(), error: null };
  }

  const projectIds = Array.from(new Set(params.orders.map((item) => item.project_id)));
  const teamIds = Array.from(new Set(params.orders.map((item) => item.team_id)));
  const executionDates = params.orders.map((item) => item.execution_date).sort();
  const result = await fetchPagedSupabaseRows<TeamCompositionContextRow>((from, to) =>
    params.supabase
      .from("team_compositions")
      .select("project_id, team_id, composition_date")
      .eq("tenant_id", params.tenantId)
      .eq("is_active", true)
      .in("project_id", projectIds)
      .in("team_id", teamIds)
      .gte("composition_date", executionDates[0])
      .lte("composition_date", executionDates[executionDates.length - 1])
      .range(from, to)
      .returns<TeamCompositionContextRow[]>(),
  );

  return {
    data: new Set(
      (result.data ?? []).map((item) => buildProgrammingMatchKey(item.project_id, item.team_id, item.composition_date)),
    ),
    error: result.error,
  };
}

async function fetchPagedSupabaseRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<SupabasePageResult<T>>,
) {
  const rows: T[] = [];
  let from = 0;

  while (true) {
    const to = from + SUPABASE_LIST_PAGE_SIZE - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) {
      return { data: rows, error };
    }

    const pageRows = data ?? [];
    rows.push(...pageRows);

    if (pageRows.length < SUPABASE_LIST_PAGE_SIZE) {
      break;
    }

    from += SUPABASE_LIST_PAGE_SIZE;
  }

  return { data: rows, error: null };
}

function buildProjectWorkCompletionTimeline(
  rows: Array<Pick<ProgrammingMatchRow, "project_id" | "execution_date" | "work_completion_status" | "updated_at">>,
) {
  const result = new Map<string, Array<{ executionDate: string; completionStatus: ProgrammingWorkCompletionStatus; updatedAt: string }>>();
  for (const row of rows) {
    const completionStatus = resolveMeasurementWorkCompletionStatus(row.work_completion_status);
    const executionDate = normalizeIsoDate(row.execution_date);
    if (!completionStatus || !executionDate) {
      continue;
    }

    const current = result.get(row.project_id) ?? [];
    current.push({
      executionDate,
      completionStatus,
      updatedAt: String(row.updated_at),
    });
    result.set(row.project_id, current);
  }

  for (const items of result.values()) {
    items.sort((left, right) => {
      const byExecutionDate = String(right.executionDate).localeCompare(String(left.executionDate));
      if (byExecutionDate !== 0) {
        return byExecutionDate;
      }

      return String(right.updatedAt).localeCompare(String(left.updatedAt));
    });
  }

  return result;
}

function resolveProjectWorkCompletionAtWindowEnd(
  timeline: Map<string, Array<{ executionDate: string; completionStatus: ProgrammingWorkCompletionStatus; updatedAt: string }>>,
  projectId: string,
  windowEndDate: string,
) {
  const normalizedWindowEndDate = normalizeIsoDate(windowEndDate);
  if (!normalizedWindowEndDate) {
    return null;
  }

  for (const item of timeline.get(projectId) ?? []) {
    if (item.executionDate <= normalizedWindowEndDate) {
      return item;
    }
  }

  return null;
}

function resolveProgrammingHistoryProjectDateKey(
  row: ProgrammingWorkCompletionHistoryRow,
  programmingProjectDateMap: Map<string, string>,
) {
  const projectId = normalizeUuid(row.project_id);
  if (!projectId) {
    return null;
  }

  const historyExecutionDate = normalizeIsoDate(row.to_execution_date)
    ?? normalizeIsoDate(row.from_execution_date);
  if (historyExecutionDate) {
    return buildProgrammingProjectDateKey(projectId, historyExecutionDate);
  }

  return programmingProjectDateMap.get(row.programming_id) ?? null;
}

function extractWorkCompletionStatusFromChanges(changes: Record<string, unknown> | null) {
  const change = changes?.workCompletionStatus;
  if (!change || typeof change !== "object") {
    return null;
  }

  return resolveMeasurementWorkCompletionStatus((change as { to?: unknown }).to);
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
  windowEndDate: string;
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
  const executionDates = params.orders.map((item) => item.execution_date).sort();
  const startDate = executionDates[0];
  const endDate = executionDates[executionDates.length - 1];

  const [preferred, canceledProgrammingRows, projectCompletionRows, projectCompletionHistoryRows] = await Promise.all([
    fetchPagedSupabaseRows<ProgrammingMatchRow>((from, to) =>
      params.supabase
        .from("project_programming")
        .select("id, project_id, team_id, execution_date, status, work_completion_status, updated_at")
        .eq("tenant_id", params.tenantId)
        .in("project_id", projectIds)
        .gte("execution_date", startDate)
        .lte("execution_date", endDate)
        .range(from, to)
        .returns<ProgrammingMatchRow[]>(),
    ),
    fetchPagedSupabaseRows<Pick<ProgrammingMatchRow, "id">>((from, to) =>
      params.supabase
        .from("project_programming")
        .select("id")
        .eq("tenant_id", params.tenantId)
        .in("project_id", projectIds)
        .eq("status", "CANCELADA")
        .range(from, to)
        .returns<Array<Pick<ProgrammingMatchRow, "id">>>(),
    ),
    fetchPagedSupabaseRows<Pick<ProgrammingMatchRow, "project_id" | "execution_date" | "work_completion_status" | "updated_at">>((from, to) =>
      params.supabase
        .from("project_programming")
        .select("project_id, execution_date, work_completion_status, updated_at")
        .eq("tenant_id", params.tenantId)
        .in("project_id", projectIds)
        .lte("execution_date", params.windowEndDate)
        .neq("status", "CANCELADA")
        .not("work_completion_status", "is", null)
        .range(from, to)
        .returns<Array<Pick<ProgrammingMatchRow, "project_id" | "execution_date" | "work_completion_status" | "updated_at">>>(),
    ),
    fetchPagedSupabaseRows<ProgrammingWorkCompletionHistoryRow>((from, to) =>
      params.supabase
        .from("project_programming_history")
        .select("id, programming_id, project_id, from_execution_date, to_execution_date, changes, created_at")
        .eq("tenant_id", params.tenantId)
        .in("project_id", projectIds)
        .contains("changes", { workCompletionStatus: {} })
        .order("created_at", { ascending: false })
        .range(from, to)
        .returns<ProgrammingWorkCompletionHistoryRow[]>(),
    ),
  ]);

  const fallback = preferred.error
    ? await fetchPagedSupabaseRows<Omit<ProgrammingMatchRow, "work_completion_status">>((from, to) =>
        params.supabase
          .from("project_programming")
          .select("id, project_id, team_id, execution_date, status, updated_at")
          .eq("tenant_id", params.tenantId)
          .in("project_id", projectIds)
          .gte("execution_date", startDate)
          .lte("execution_date", endDate)
          .range(from, to)
          .returns<Array<Omit<ProgrammingMatchRow, "work_completion_status">>>(),
      )
    : null;

  const data = preferred.error
    ? (fallback?.data ?? []).map((item) => ({ ...item, work_completion_status: null }))
    : preferred.data;

  const programmingProjectDateMap = new Map<string, string>();
  const programmingStatusMap = new Map<string, string>();
  for (const row of data ?? []) {
    programmingProjectDateMap.set(row.id, buildProgrammingProjectDateKey(row.project_id, row.execution_date));
    programmingStatusMap.set(row.id, row.status);
  }

  const canceledProgrammingIds = new Set((canceledProgrammingRows.data ?? []).map((item) => item.id));
  const projectWorkCompletionTimeline = buildProjectWorkCompletionTimeline(projectCompletionRows.data ?? []);

  const projectDateWorkCompletionStatusMap = new Map<string, { completionStatus: ProgrammingWorkCompletionStatus; updatedAt: string }>();
  for (const row of data ?? []) {
    if (isCanceledProgrammingStatus(row.status)) {
      continue;
    }

    const projectDateKey = buildProgrammingProjectDateKey(row.project_id, row.execution_date);
    const completionStatus = resolveMeasurementWorkCompletionStatus(row.work_completion_status);
    if (!completionStatus) {
      continue;
    }

    const current = projectDateWorkCompletionStatusMap.get(projectDateKey);
    if (!current || String(row.updated_at) > String(current.updatedAt)) {
      projectDateWorkCompletionStatusMap.set(projectDateKey, {
        completionStatus,
        updatedAt: String(row.updated_at),
      });
    }
  }

  const projectDateWorkCompletionHistoryMap = new Map<string, { completionStatus: ProgrammingWorkCompletionStatus; updatedAt: string }>();
  for (const row of projectCompletionHistoryRows.data ?? []) {
    if (canceledProgrammingIds.has(row.programming_id) || isCanceledProgrammingStatus(programmingStatusMap.get(row.programming_id))) {
      continue;
    }

    const projectDateKey = resolveProgrammingHistoryProjectDateKey(row, programmingProjectDateMap);
    if (!projectDateKey || projectDateWorkCompletionHistoryMap.has(projectDateKey)) {
      continue;
    }

    projectDateWorkCompletionHistoryMap.set(projectDateKey, {
      completionStatus: extractWorkCompletionStatusFromChanges(row.changes),
      updatedAt: String(row.created_at),
    });
  }

  const grouped = new Map<string, ProgrammingMatchRow[]>();
  const groupedByProjectDate = new Map<string, ProgrammingMatchRow[]>();
  for (const row of data ?? []) {
    const key = buildProgrammingMatchKey(row.project_id, row.team_id, row.execution_date);
    const current = grouped.get(key) ?? [];
    current.push(row);
    grouped.set(key, current);

    const projectDateKey = buildProgrammingProjectDateKey(row.project_id, row.execution_date);
    const projectDateCurrent = groupedByProjectDate.get(projectDateKey) ?? [];
    projectDateCurrent.push(row);
    groupedByProjectDate.set(projectDateKey, projectDateCurrent);
  }

  const result = new Map<string, {
    status: ProgrammingMatchStatus;
    programmingId: string | null;
    completionStatus: ProgrammingWorkCompletionStatus;
    completionStatusChangedAfterMeasurement: boolean;
  }>();

  for (const order of params.orders) {
    const teamKey = buildProgrammingMatchKey(order.project_id, order.team_id, order.execution_date);
    const exactMatch = selectBestProgrammingMatch(grouped.get(teamKey) ?? []);
    const projectDateKey = buildProgrammingProjectDateKey(order.project_id, order.execution_date);
    const projectDateMatch = selectBestProgrammingMatch(groupedByProjectDate.get(projectDateKey) ?? []);
    const completionMatch = exactMatch ?? projectDateMatch;

    const projectDateWorkCompletionStatus = projectDateWorkCompletionHistoryMap.get(projectDateKey)
      ?? projectDateWorkCompletionStatusMap.get(projectDateKey)
      ?? null;
    const projectWorkCompletionStatus = resolveProjectWorkCompletionAtWindowEnd(
      projectWorkCompletionTimeline,
      order.project_id,
      params.windowEndDate,
    );
    const currentCompletion = isCanceledProgrammingStatus(completionMatch?.status)
      ? null
      : resolveMeasurementWorkCompletionStatus(completionMatch?.work_completion_status);
    const snapshotCompletion = resolveMeasurementWorkCompletionStatus(order.programming_completion_status_snapshot);
    const programmingCompletion = projectWorkCompletionStatus?.completionStatus
      ?? currentCompletion
      ?? (projectDateWorkCompletionStatus ? projectDateWorkCompletionStatus.completionStatus : null);
    const programmingCompletionUpdatedAt = projectWorkCompletionStatus?.updatedAt
      ?? (currentCompletion
        ? (completionMatch?.updated_at ?? null)
        : (projectDateWorkCompletionStatus?.updatedAt ?? null));
    const effectiveCompletion = programmingCompletion
      ?? snapshotCompletion
      ?? null;
    const changedBySnapshot = Boolean(
      snapshotCompletion
      && programmingCompletion
      && snapshotCompletion !== programmingCompletion,
    );

    const changedAfterMeasurementWithoutSnapshot = Boolean(
      !snapshotCompletion
      && effectiveCompletion
      && programmingCompletionUpdatedAt
      && new Date(programmingCompletionUpdatedAt).getTime() > new Date(order.created_at).getTime(),
    );

    result.set(order.id, {
      status: exactMatch ? "PROGRAMADA" : "NAO_PROGRAMADA",
      programmingId: exactMatch?.id ?? null,
      completionStatus: effectiveCompletion,
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
    || normalized.includes("minimum_billing_")
  ) {
    return " Verifique se as migrations 112_create_measurement_order_module.sql, 115_allow_historical_programming_in_measurement_save.sql, 116_measurement_programming_match_and_completion_alert.sql, 117_allow_measurement_context_edit_and_history_details.sql, 119_create_measurement_batch_import_partial_rpc.sql, 120_unify_measurement_with_service_activities.sql, 122_protect_duplicate_measurement_items_in_rpc.sql, 123_support_measurement_without_production.sql, 124_add_measurement_reopen_status_action.sql, 125_require_closed_before_measurement_cancel.sql, 126_allow_measurement_cancel_when_open.sql, 127_add_mva_hour_composed_quantity_to_measurement_items.sql e 212_measurement_minimum_billing_guarantee.sql foram aplicadas.";
  }
  return "";
}

function isMissingProjectTestColumn(message: string | undefined) {
  return normalizeText(message).toLowerCase().includes("is_test");
}

async function fetchProjectIsTestMap(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  projectIds: string[];
}) {
  if (!params.projectIds.length) {
    return new Map<string, boolean>();
  }

  const uniqueProjectIds = Array.from(new Set(params.projectIds.filter(Boolean)));
  const primary = await params.supabase
    .from("project")
    .select("id, is_test")
    .eq("tenant_id", params.tenantId)
    .in("id", uniqueProjectIds)
    .returns<ProjectTestRow[]>();

  if (!primary.error) {
    return new Map((primary.data ?? []).map((item) => [item.id, Boolean(item.is_test)]));
  }

  if (!isMissingProjectTestColumn(primary.error.message)) {
    return new Map<string, boolean>();
  }

  const fallback = await params.supabase
    .from("project")
    .select("id")
    .eq("tenant_id", params.tenantId)
    .in("id", uniqueProjectIds)
    .returns<Array<{ id: string }>>();

  return new Map((fallback.data ?? []).map((item) => [item.id, false]));
}

async function fetchProjectServiceCenterMap(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  projectIds: string[];
}) {
  if (!params.projectIds.length) {
    return new Map<string, string>();
  }

  const uniqueProjectIds = Array.from(new Set(params.projectIds.filter(Boolean)));
  const labeled = await params.supabase
    .from("project_with_labels")
    .select("id, service_center_text")
    .eq("tenant_id", params.tenantId)
    .in("id", uniqueProjectIds)
    .returns<ProjectServiceCenterRow[]>();

  if (!labeled.error) {
    return new Map((labeled.data ?? []).map((item) => [item.id, normalizeText(item.service_center_text) || "Sem base"]));
  }

  const { data, error } = await params.supabase
    .from("project")
    .select("id, service_center, service_center_text")
    .eq("tenant_id", params.tenantId)
    .in("id", uniqueProjectIds)
    .returns<ProjectServiceCenterRow[]>();

  if (error) {
    return new Map<string, string>();
  }

  const serviceCenterMap = new Map<string, string>();
  const lookupIds = Array.from(
    new Set(
      (data ?? [])
        .filter((item) => !normalizeText(item.service_center_text))
        .map((item) => normalizeUuid(item.service_center))
        .filter((item): item is string => Boolean(item)),
    ),
  );

  if (lookupIds.length) {
    const { data: lookups } = await params.supabase
      .from("project_service_centers")
      .select("id, name")
      .eq("tenant_id", params.tenantId)
      .in("id", lookupIds)
      .returns<ProjectServiceCenterLookupRow[]>();

    for (const item of lookups ?? []) {
      serviceCenterMap.set(item.id, normalizeText(item.name) || "Sem base");
    }
  }

  return new Map((data ?? []).map((item) => {
    const textValue = normalizeText(item.service_center_text);
    const lookupValue = normalizeUuid(item.service_center)
      ? serviceCenterMap.get(normalizeUuid(item.service_center) ?? "")
      : "";
    return [item.id, textValue || lookupValue || "Sem base"];
  }));
}

async function fetchTeamTypeResolutionMaps(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  orders: Array<{ team_id?: string; teamId?: string }>;
}) {
  const teamIds = Array.from(new Set(params.orders.map((item) => item.team_id ?? item.teamId ?? "").filter(Boolean)));
  if (!teamIds.length) {
    return {
      teamTypeByTeam: new Map<string, string | null>(),
      teamTypeNameById: new Map<string, string>(),
      historyByTeam: new Map<string, TeamTypeHistoryRow[]>(),
    };
  }

  const [teamsResult, historyResult] = await Promise.all([
    params.supabase
      .from("teams")
      .select("id, team_type_id")
      .eq("tenant_id", params.tenantId)
      .in("id", teamIds)
      .returns<TeamRow[]>(),
    params.supabase
      .from("team_type_history")
      .select("team_id, team_type_id, team_type_name_snapshot, valid_from, valid_to")
      .eq("tenant_id", params.tenantId)
      .in("team_id", teamIds)
      .returns<TeamTypeHistoryRow[]>(),
  ]);

  const teamTypeByTeam = new Map((teamsResult.data ?? []).map((item) => [item.id, item.team_type_id]));
  const historyByTeam = new Map<string, TeamTypeHistoryRow[]>();
  for (const entry of historyResult.data ?? []) {
    const entries = historyByTeam.get(entry.team_id) ?? [];
    entries.push(entry);
    historyByTeam.set(entry.team_id, entries);
  }
  for (const entries of historyByTeam.values()) {
    entries.sort((left, right) => right.valid_from.localeCompare(left.valid_from));
  }

  const teamTypeIds = Array.from(
    new Set([
      ...(teamsResult.data ?? []).map((item) => item.team_type_id),
      ...(historyResult.data ?? []).map((item) => item.team_type_id),
    ].filter((item): item is string => Boolean(item))),
  );
  const teamTypesResult = teamTypeIds.length
    ? await params.supabase
        .from("team_types")
        .select("id, name")
        .eq("tenant_id", params.tenantId)
        .in("id", teamTypeIds)
        .returns<TeamTypeRow[]>()
    : { data: [] as TeamTypeRow[] };

  return {
    teamTypeByTeam,
    teamTypeNameById: new Map((teamTypesResult.data ?? []).map((item) => [item.id, normalizeText(item.name)])),
    historyByTeam,
  };
}

function resolveOrderTeamType(params: {
  teamId: string;
  executionDate: string;
  teamTypeByTeam: Map<string, string | null>;
  teamTypeNameById: Map<string, string>;
  historyByTeam: Map<string, TeamTypeHistoryRow[]>;
}) {
  const history = params.historyByTeam.get(params.teamId) ?? [];
  const effectiveEntry = history.find((entry) => (
    entry.valid_from <= params.executionDate
    && (!entry.valid_to || entry.valid_to >= params.executionDate)
  ));

  if (effectiveEntry) {
    const teamTypeId = effectiveEntry.team_type_id;
    return {
      teamTypeId,
      teamTypeName: teamTypeId
        ? params.teamTypeNameById.get(teamTypeId) ?? normalizeText(effectiveEntry.team_type_name_snapshot)
        : normalizeText(effectiveEntry.team_type_name_snapshot),
    };
  }

  const teamTypeId = params.teamTypeByTeam.get(params.teamId) ?? null;
  return {
    teamTypeId,
    teamTypeName: teamTypeId ? params.teamTypeNameById.get(teamTypeId) ?? "" : "",
  };
}

async function fetchPointTargetMap(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  teamTypeIds: string[];
}) {
  const teamTypeIds = Array.from(new Set(params.teamTypeIds.filter(Boolean)));
  if (!teamTypeIds.length) {
    return new Map<string, number>();
  }

  const { data } = await params.supabase
    .from("measurement_score_targets")
    .select("team_type_id, target_points")
    .eq("tenant_id", params.tenantId)
    .eq("ativo", true)
    .in("team_type_id", teamTypeIds)
    .returns<MeasurementScoreTargetRow[]>();

  return new Map((data ?? []).map((item) => [item.team_type_id, Number(item.target_points ?? 0)]));
}

async function fetchFinancialTargetMap(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  orders: Array<{ execution_date?: string; executionDate?: string }>;
  teamTypeIds: string[];
}) {
  const teamTypeIds = Array.from(new Set(params.teamTypeIds.filter(Boolean)));
  if (!teamTypeIds.length) {
    return {
      cycleTargetMap: new Map<string, number>(),
      fallbackTargetMap: new Map<string, number>(),
    };
  }

  const cycleStarts = Array.from(new Set(params.orders.map((item) => buildMeasurementCycleStart(item.execution_date ?? item.executionDate ?? ""))));
  const cyclesResult = cycleStarts.length
    ? await params.supabase
        .from("measurement_cycle_workdays")
        .select("id, cycle_start")
        .eq("tenant_id", params.tenantId)
        .in("cycle_start", cycleStarts)
        .returns<CycleWorkdaysRow[]>()
    : { data: [] as CycleWorkdaysRow[] };

  const cycleById = new Map((cyclesResult.data ?? []).map((item) => [item.id, item.cycle_start]));
  const cycleIds = Array.from(cycleById.keys());
  const cycleItemsResult = cycleIds.length
    ? await params.supabase
        .from("measurement_cycle_target_items")
        .select("cycle_id, team_type_id, daily_value")
        .eq("tenant_id", params.tenantId)
        .in("cycle_id", cycleIds)
        .in("team_type_id", teamTypeIds)
        .returns<CycleTargetItemRow[]>()
    : { data: [] as CycleTargetItemRow[] };

  const cycleTargetMap = new Map<string, number>();
  for (const item of cycleItemsResult.data ?? []) {
    const cycleStart = cycleById.get(item.cycle_id);
    if (!cycleStart) continue;
    cycleTargetMap.set(`${cycleStart}:${item.team_type_id}`, Number(item.daily_value ?? 0));
  }

  const fallbackResult = await params.supabase
    .from("measurement_team_type_targets")
    .select("team_type_id, daily_value")
    .eq("tenant_id", params.tenantId)
    .eq("ativo", true)
    .in("team_type_id", teamTypeIds)
    .returns<MeasurementTeamTypeTargetRow[]>();

  return {
    cycleTargetMap,
    fallbackTargetMap: new Map((fallbackResult.data ?? []).map((item) => [item.team_type_id, Number(item.daily_value ?? 0)])),
  };
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
  windowEndDate?: string | null;
}) {
  const { data: order, error: orderError } = await params.supabase
    .from("project_measurement_orders")
    .select(MEASUREMENT_ORDER_SELECT)
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
  const minimumBillingAmount = Number(order.minimum_billing_amount ?? 0);

  const programmingMatchMap = await loadProgrammingMatchMap({
    supabase: params.supabase,
    tenantId: params.tenantId,
    windowEndDate: params.windowEndDate ?? order.execution_date,
    orders: [order],
  });
  const projectServiceCenterMap = await fetchProjectServiceCenterMap({
    supabase: params.supabase,
    tenantId: params.tenantId,
    projectIds: [order.project_id],
  });
  const teamCompositionContexts = await fetchTeamCompositionContextSet({
    supabase: params.supabase,
    tenantId: params.tenantId,
    orders: [order],
  });
  if (teamCompositionContexts.error) {
    return null;
  }
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
    projectServiceCenter: projectServiceCenterMap.get(order.project_id) ?? "Sem base",
    teamName: normalizeText(order.team_name_snapshot),
    foremanName: normalizeText(order.foreman_name_snapshot),
    isActive: Boolean(order.is_active),
    cancellationReason: normalizeText(order.cancellation_reason),
    canceledAt: order.canceled_at,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    createdByName: resolveAppUserName(userMap.get(order.created_by ?? "")),
    updatedByName: resolveAppUserName(userMap.get(order.updated_by ?? "")),
    hasTeamComposition: teamCompositionContexts.data.has(buildProgrammingMatchKey(order.project_id, order.team_id, order.execution_date)),
    programmingMatchStatus: programmingMatch.status,
    matchedProgrammingId: programmingMatch.programmingId,
    programmingCompletionStatus: programmingMatch.completionStatus,
    programmingCompletionStatusChangedAfterMeasurement: programmingMatch.completionStatusChangedAfterMeasurement,
    itemCount: normalizedItems.length,
    totalAmount: normalizedItems.reduce((sum, item) => sum + item.totalValue, 0) + minimumBillingAmount,
    minimumBillingAmount,
    minimumBillingTeamTypeId: order.minimum_billing_team_type_id,
    minimumBillingTeamTypeName: normalizeText(order.minimum_billing_team_type_name_snapshot),
    minimumBillingScoreTargetId: order.minimum_billing_score_target_id,
    minimumBillingTargetPoints: Number(order.minimum_billing_target_points ?? 0),
    minimumBillingUnitValueSourceActivityId: order.minimum_billing_unit_value_source_activity_id,
    minimumBillingUnitValueGroup: normalizeText(order.minimum_billing_unit_value_group_snapshot),
    minimumBillingUnitValue: Number(order.minimum_billing_unit_value ?? 0),
    minimumBillingCalculatedAt: order.minimum_billing_calculated_at,
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
    const detailWindowEndDate = normalizeIsoDate(request.nextUrl.searchParams.get("endDate"));
    const detail = await fetchMeasurementOrderDetail({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      orderId,
      windowEndDate: detailWindowEndDate,
    });

    if (!detail) {
      return NextResponse.json({ message: "Ordem de medicao nao encontrada." }, { status: 404 });
    }

    return NextResponse.json({ order: detail });
  }

  const startDate = normalizeIsoDate(request.nextUrl.searchParams.get("startDate"));
  const endDate = normalizeIsoDate(request.nextUrl.searchParams.get("endDate"));
  const projectId = normalizeUuid(request.nextUrl.searchParams.get("projectId"));
  const teamId = normalizeUuid(request.nextUrl.searchParams.get("teamId"));
  const serviceTypeIdRaw = normalizeText(request.nextUrl.searchParams.get("serviceTypeId"));
  const serviceTypeId = normalizeUuid(serviceTypeIdRaw);
  const activityIdRaw = normalizeText(request.nextUrl.searchParams.get("activityId"));
  const activityId = normalizeUuid(activityIdRaw);
  const statusFilter = normalizeText(request.nextUrl.searchParams.get("status")).toUpperCase();
  const measurementKindFilter = normalizeText(request.nextUrl.searchParams.get("measurementKind")).toUpperCase();
  const noProductionReasonIdFilter = normalizeUuid(request.nextUrl.searchParams.get("noProductionReasonId"));
  const programmingMatchFilter = normalizeText(request.nextUrl.searchParams.get("programmingMatch")).toUpperCase();
  const workCompletionStatusFilterRaw = normalizeText(request.nextUrl.searchParams.get("workCompletionStatus")).toUpperCase();
  const workCompletionStatusFilter = workCompletionStatusFilterRaw === "NAO_INFORMADO"
    ? workCompletionStatusFilterRaw
    : resolveMeasurementWorkCompletionStatus(workCompletionStatusFilterRaw) ?? workCompletionStatusFilterRaw;
  const completionAlertFilter = normalizeText(request.nextUrl.searchParams.get("completionAlert")).toUpperCase();
  const page = normalizePositiveInteger(request.nextUrl.searchParams.get("page"), 1, 10_000);
  const pageSize = normalizePositiveInteger(request.nextUrl.searchParams.get("pageSize"), 20, 500);

  if (!startDate || !endDate) {
    return NextResponse.json({ message: "startDate e endDate sao obrigatorios." }, { status: 400 });
  }

  if (serviceTypeIdRaw && !serviceTypeId) {
    return NextResponse.json({ message: "Tipo de Servico invalido." }, { status: 400 });
  }

  if (activityIdRaw && !activityId) {
    return NextResponse.json({ message: "Atividade invalida." }, { status: 400 });
  }

  let serviceTypeProjectIdSet: Set<string> | null = null;
  if (serviceTypeId) {
    const serviceTypeProjectsResult = await fetchPagedSupabaseRows<ProjectServiceTypeProjectRow>((from, to) =>
      resolution.supabase
        .from("project")
        .select("id")
        .eq("tenant_id", resolution.appUser.tenant_id)
        .eq("service_type", serviceTypeId)
        .range(from, to)
        .returns<ProjectServiceTypeProjectRow[]>(),
    );

    if (serviceTypeProjectsResult.error) {
      return NextResponse.json({ message: "Falha ao filtrar projetos por Tipo de Servico." }, { status: 500 });
    }

    serviceTypeProjectIdSet = new Set(serviceTypeProjectsResult.data.map((item) => item.id));
  }

  let activityOrderIdSet: Set<string> | null = null;
  if (activityId) {
    const activityOrdersResult = await fetchPagedSupabaseRows<MeasurementOrderActivityFilterRow>((from, to) =>
      resolution.supabase
        .from("project_measurement_order_items")
        .select("measurement_order_id")
        .eq("tenant_id", resolution.appUser.tenant_id)
        .eq("service_activity_id", activityId)
        .eq("is_active", true)
        .range(from, to)
        .returns<MeasurementOrderActivityFilterRow[]>(),
    );

    if (activityOrdersResult.error) {
      return NextResponse.json({ message: "Falha ao filtrar ordens por atividade." }, { status: 500 });
    }

    activityOrderIdSet = new Set(activityOrdersResult.data.map((item) => item.measurement_order_id));

    if (activityOrderIdSet.size === 0) {
      return NextResponse.json({ orders: [], pagination: { page, pageSize, total: 0 } });
    }
  }

  const startIndex = ((page ?? 1) - 1) * (pageSize ?? 20);

    let pagedQuery = resolution.supabase
      .from("project_measurement_orders")
      .select(MEASUREMENT_ORDER_SELECT, { count: "exact" })
      .eq("tenant_id", resolution.appUser.tenant_id)
      .gte("execution_date", startDate)
      .lte("execution_date", endDate)
      .order("execution_date", { ascending: false })
      .order("updated_at", { ascending: false });

    if (projectId) pagedQuery = pagedQuery.eq("project_id", projectId);
    if (teamId) pagedQuery = pagedQuery.eq("team_id", teamId);
    if (statusFilter && statusFilter !== "TODOS") pagedQuery = pagedQuery.eq("status", statusFilter);
    if (serviceTypeProjectIdSet && serviceTypeProjectIdSet.size > 0) {
      pagedQuery = pagedQuery.in("project_id", Array.from(serviceTypeProjectIdSet));
    }
    if (measurementKindFilter === "COM_PRODUCAO" || measurementKindFilter === "SEM_PRODUCAO") {
      pagedQuery = pagedQuery.eq("measurement_kind", measurementKindFilter);
    }
    if (noProductionReasonIdFilter) {
      pagedQuery = pagedQuery.eq("no_production_reason_id", noProductionReasonIdFilter);
    }
    if (activityOrderIdSet && activityOrderIdSet.size > 0) {
      pagedQuery = pagedQuery.in("id", Array.from(activityOrderIdSet));
    }

    const { data: pagedData, count: pagedCount, error: pagedError } = await pagedQuery
      .range(startIndex, startIndex + (pageSize ?? 20) - 1)
      .returns<MeasurementOrderRow[]>();

    if (pagedError) {
      const hint = measurementModuleMigrationHint(pagedError.message);
      return NextResponse.json({ message: `Falha ao listar ordens de medicao.${hint}`.trim() }, { status: 500 });
    }

    const simpleOrders = pagedData ?? [];
    const simpleTotal = pagedCount ?? 0;

    const simpleProjectIds = Array.from(new Set(simpleOrders.map((item) => item.project_id)));
    const simpleUserIds = Array.from(
      new Set(
        simpleOrders
          .flatMap((item) => [item.created_by, item.updated_by])
          .filter((item): item is string => Boolean(item)),
      ),
    );

    const [
      simpleUserMap,
      simpleProgrammingMatchMap,
      simpleProjectIsTestMap,
      simpleProjectServiceCenterMap,
      simpleTeamCompositionContexts,
    ] = await Promise.all([
      fetchAppUserMap({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        ids: simpleUserIds,
      }),
      loadProgrammingMatchMap({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        windowEndDate: endDate,
        orders: simpleOrders,
      }),
      fetchProjectIsTestMap({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        projectIds: simpleProjectIds,
      }),
      fetchProjectServiceCenterMap({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        projectIds: simpleProjectIds,
      }),
      fetchTeamCompositionContextSet({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        orders: simpleOrders,
      }),
    ]);

    if (simpleTeamCompositionContexts.error) {
      return NextResponse.json({ message: "Falha ao carregar composicoes de equipe das ordens de medicao." }, { status: 500 });
    }

    const simpleBaseOrders = simpleOrders.map((item) => {
      const programmingMatch = simpleProgrammingMatchMap.get(item.id) ?? {
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
        projectServiceCenter: simpleProjectServiceCenterMap.get(item.project_id) ?? "Sem base",
        teamName: normalizeText(item.team_name_snapshot),
        foremanName: normalizeText(item.foreman_name_snapshot),
        cancellationReason: normalizeText(item.cancellation_reason),
        canceledAt: item.canceled_at,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        createdByName: resolveAppUserName(simpleUserMap.get(item.created_by ?? "")),
        updatedByName: resolveAppUserName(simpleUserMap.get(item.updated_by ?? "")),
        projectIsTest: Boolean(simpleProjectIsTestMap.get(item.project_id)),
        hasTeamComposition: simpleTeamCompositionContexts.data.has(
          buildProgrammingMatchKey(item.project_id, item.team_id, item.execution_date),
        ),
        programmingMatchStatus: programmingMatch.status,
        matchedProgrammingId: programmingMatch.programmingId,
        programmingCompletionStatus: programmingMatch.completionStatus,
        programmingCompletionStatusChangedAfterMeasurement: programmingMatch.completionStatusChangedAfterMeasurement,
        minimumBillingAmount: Number(item.minimum_billing_amount ?? 0),
        minimumBillingTeamTypeId: item.minimum_billing_team_type_id,
        minimumBillingTeamTypeName: normalizeText(item.minimum_billing_team_type_name_snapshot),
        minimumBillingScoreTargetId: item.minimum_billing_score_target_id,
        minimumBillingTargetPoints: Number(item.minimum_billing_target_points ?? 0),
        minimumBillingUnitValueSourceActivityId: item.minimum_billing_unit_value_source_activity_id,
        minimumBillingUnitValueGroup: normalizeText(item.minimum_billing_unit_value_group_snapshot),
        minimumBillingUnitValue: Number(item.minimum_billing_unit_value ?? 0),
        minimumBillingCalculatedAt: item.minimum_billing_calculated_at,
      };
    });

    const simpleNonTestOrders = simpleBaseOrders.filter((item) => !item.projectIsTest);

    const simpleFilteredByProgramming = (programmingMatchFilter === "PROGRAMADA" || programmingMatchFilter === "NAO_PROGRAMADA")
      ? simpleNonTestOrders.filter((item) => item.programmingMatchStatus === programmingMatchFilter)
      : simpleNonTestOrders;

    const simpleFilteredByWorkCompletion = workCompletionStatusFilter === "NAO_INFORMADO"
      ? simpleFilteredByProgramming.filter((item) => !item.programmingCompletionStatus)
      : (workCompletionStatusFilter && workCompletionStatusFilter !== "TODOS"
          ? simpleFilteredByProgramming.filter((item) => item.programmingCompletionStatus === workCompletionStatusFilter)
          : simpleFilteredByProgramming);

    const simplePagedBaseOrders = (completionAlertFilter === "SIM" || completionAlertFilter === "NAO")
      ? simpleFilteredByWorkCompletion.filter((item) =>
          completionAlertFilter === "SIM"
            ? item.programmingCompletionStatusChangedAfterMeasurement
            : !item.programmingCompletionStatusChangedAfterMeasurement)
      : simpleFilteredByWorkCompletion;

    const simpleTeamTypeResolutionMaps = await fetchTeamTypeResolutionMaps({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      orders: simplePagedBaseOrders,
    });
    const simpleOrderTeamTypeMap = new Map<string, { teamTypeId: string | null; teamTypeName: string; typeLabel: string }>();
    for (const item of simplePagedBaseOrders) {
      const resolvedTeamType = resolveOrderTeamType({
        teamId: item.teamId,
        executionDate: item.executionDate,
        teamTypeByTeam: simpleTeamTypeResolutionMaps.teamTypeByTeam,
        teamTypeNameById: simpleTeamTypeResolutionMaps.teamTypeNameById,
        historyByTeam: simpleTeamTypeResolutionMaps.historyByTeam,
      });
      simpleOrderTeamTypeMap.set(item.id, {
        ...resolvedTeamType,
        typeLabel: measurementScoreTypeLabel(resolvedTeamType.teamTypeName),
      });
    }
    const simpleScoreTeamTypeIds = Array.from(
      new Set(
        Array.from(simpleOrderTeamTypeMap.values())
          .map((item) => item.teamTypeId)
          .filter((item): item is string => Boolean(item)),
      ),
    );
    const [simplePointTargetMap, simpleFinancialTargets] = await Promise.all([
      fetchPointTargetMap({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        teamTypeIds: simpleScoreTeamTypeIds,
      }),
      fetchFinancialTargetMap({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        orders: simplePagedBaseOrders,
        teamTypeIds: simpleScoreTeamTypeIds,
      }),
    ]);

    const simplePagedOrderIds = simplePagedBaseOrders.map((item) => item.id);
    const simpleAggregateItemsResult = simplePagedOrderIds.length
      ? await fetchPagedSupabaseRows<MeasurementOrderAggregateItem>((from, to) =>
          resolution.supabase
            .from("project_measurement_order_items")
            .select("measurement_order_id, total_value, quantity, voice_point")
            .eq("tenant_id", resolution.appUser.tenant_id)
            .eq("is_active", true)
            .in("measurement_order_id", simplePagedOrderIds)
            .range(from, to)
            .returns<MeasurementOrderAggregateItem[]>(),
        )
      : { data: [] as MeasurementOrderAggregateItem[], error: null };

    if (simpleAggregateItemsResult.error) {
      return NextResponse.json({ message: "Falha ao consolidar totais das ordens de medicao." }, { status: 500 });
    }

    const simpleAggregateMap = new Map<string, { totalAmount: number; itemCount: number; scorePoints: number }>();
    for (const item of simpleAggregateItemsResult.data ?? []) {
      const current = simpleAggregateMap.get(item.measurement_order_id) ?? { totalAmount: 0, itemCount: 0, scorePoints: 0 };
      current.totalAmount += Number(item.total_value ?? 0);
      current.itemCount += 1;
      current.scorePoints += Number(item.voice_point ?? 0) * Number(item.quantity ?? 0);
      simpleAggregateMap.set(item.measurement_order_id, current);
    }

    const simplePagedOrders = simplePagedBaseOrders.map((item) => {
      const aggregate = simpleAggregateMap.get(item.id) ?? { totalAmount: 0, itemCount: 0, scorePoints: 0 };
      const teamType = simpleOrderTeamTypeMap.get(item.id) ?? { teamTypeId: null, teamTypeName: "", typeLabel: "Nao identificado" };
      const cycleStart = buildMeasurementCycleStart(item.executionDate);
      const financialTarget = teamType.teamTypeId
        ? simpleFinancialTargets.cycleTargetMap.get(`${cycleStart}:${teamType.teamTypeId}`)
          ?? simpleFinancialTargets.fallbackTargetMap.get(teamType.teamTypeId)
          ?? 0
        : 0;
      return {
        ...item,
        totalAmount: Number(aggregate.totalAmount ?? 0) + Number(item.minimumBillingAmount ?? 0),
        itemCount: Number(aggregate.itemCount ?? 0),
        scorePoints: Number(aggregate.scorePoints ?? 0) + Number(item.minimumBillingTargetPoints ?? 0),
        teamTypeId: teamType.teamTypeId,
        teamTypeName: teamType.typeLabel,
        pointTarget: teamType.teamTypeId ? simplePointTargetMap.get(teamType.teamTypeId) ?? 0 : 0,
        financialTarget,
      };
    });

    return NextResponse.json({
      orders: simplePagedOrders,
      pagination: {
        page: page ?? 1,
        pageSize: pageSize ?? 20,
        total: simpleTotal,
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
