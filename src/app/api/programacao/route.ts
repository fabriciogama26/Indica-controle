import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";

type BoardProjectRow = {
  id: string;
  sob: string;
  service_center_text: string | null;
  service_type_text: string | null;
  city_text: string | null;
  priority_text: string | null;
  partner_text: string | null;
  utility_responsible_text: string | null;
  utility_field_manager_text: string | null;
  street: string | null;
  neighborhood: string | null;
  service_description: string | null;
  observation: string | null;
  has_locacao: boolean | null;
  is_active: boolean;
};

type TeamRow = {
  id: string;
  name: string;
  service_center_id: string | null;
  team_type_id: string;
  foreman_person_id: string;
  ativo: boolean;
};

type TeamTypeRow = {
  id: string;
  name: string;
};

type PersonRow = {
  id: string;
  nome: string;
};

type ServiceCenterRow = {
  id: string;
  name: string;
};

type SupportOptionRow = {
  id: string;
  description: string;
  location_support_item_id: string | null;
  is_active: boolean;
};

type ProgrammingSgdTypeRow = {
  id: string;
  description: string;
  export_column: "SGD_AT_MT_VYP" | "SGD_BT" | "SGD_TET";
  is_active: boolean;
};

type LocationPlanSupportRow = {
  project_id: string;
  questionnaire_answers: Record<string, unknown> | null;
};

type TeamWeekSummaryRow = {
  team_id: string;
  week_start: string;
  week_end: string;
  worked_days: number | string;
  capacity_days: number | string;
  free_days: number | string;
  load_percent: number | string;
  load_status: "FREE" | "NORMAL" | "WARNING" | "OVERLOAD";
};

type ProgrammingRow = {
  id: string;
  project_id: string;
  team_id: string;
  status: "PROGRAMADA" | "ADIADA" | "CANCELADA";
  execution_date: string;
  period: "INTEGRAL" | "PARCIAL";
  start_time: string;
  end_time: string;
  expected_minutes: number;
  outage_start_time: string | null;
  outage_end_time: string | null;
  feeder: string | null;
  support: string | null;
  support_item_id: string | null;
  note: string | null;
  service_description: string | null;
  poste_qty: number | null;
  estrutura_qty: number | null;
  trafo_qty: number | null;
  rede_qty: number | null;
  etapa_number: number | null;
  work_completion_status: "CONCLUIDO" | "PARCIAL" | null;
  affected_customers: number | null;
  sgd_type_id: string | null;
  sgd_number: string | null;
  sgd_included_at: string | null;
  sgd_delivered_at: string | null;
  pi_number: string | null;
  pi_included_at: string | null;
  pi_delivered_at: string | null;
  pep_number: string | null;
  pep_included_at: string | null;
  pep_delivered_at: string | null;
  cancellation_reason: string | null;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
};

type ProgrammingActivityRow = {
  id: string;
  programming_id: string;
  service_activity_id: string;
  activity_code: string;
  activity_description: string;
  activity_unit: string;
  quantity: number | string;
  is_active: boolean;
};

type ProgrammingHistoryRow = {
  id: string;
  entity_id: string;
  reason: string | null;
  changes: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type HistoryChange = {
  from: string | null;
  to: string | null;
};

type SaveProgrammingPayload = {
  id?: string;
  projectId?: string;
  teamId?: string;
  date?: string;
  period?: string;
  startTime?: string;
  endTime?: string;
  expectedMinutes?: number | string;
  outageStartTime?: string;
  outageEndTime?: string;
  feeder?: string;
  support?: string;
  supportItemId?: string;
  note?: string;
  serviceDescription?: string;
  posteQty?: number | string;
  estruturaQty?: number | string;
  trafoQty?: number | string;
  redeQty?: number | string;
  etapaNumber?: number | string;
  workCompletionStatus?: string;
  affectedCustomers?: number | string;
  sgdTypeId?: string;
  changeReason?: string;
  expectedUpdatedAt?: string;
  documents?: {
    sgd?: { number?: string; approvedAt?: string; requestedAt?: string; includedAt?: string; deliveredAt?: string };
    pi?: { number?: string; approvedAt?: string; requestedAt?: string; includedAt?: string; deliveredAt?: string };
    pep?: { number?: string; approvedAt?: string; requestedAt?: string; includedAt?: string; deliveredAt?: string };
  };
  activities?: Array<{
    catalogId?: string;
    quantity?: number | string;
  }>;
};

type CopyProgrammingPayload = {
  action?: "COPY";
  sourceTeamId?: string;
  targetTeamIds?: string[];
  startDate?: string;
  endDate?: string;
};

type BatchCreateProgrammingPayload = {
  action?: "BATCH_CREATE";
  projectId?: string;
  teamIds?: string[];
  date?: string;
  period?: string;
  startTime?: string;
  endTime?: string;
  expectedMinutes?: number | string;
  outageStartTime?: string;
  outageEndTime?: string;
  feeder?: string;
  support?: string;
  supportItemId?: string;
  note?: string;
  serviceDescription?: string;
  posteQty?: number | string;
  estruturaQty?: number | string;
  trafoQty?: number | string;
  redeQty?: number | string;
  etapaNumber?: number | string;
  workCompletionStatus?: string;
  affectedCustomers?: number | string;
  sgdTypeId?: string;
  documents?: {
    sgd?: { number?: string; approvedAt?: string; requestedAt?: string; includedAt?: string; deliveredAt?: string };
    pi?: { number?: string; approvedAt?: string; requestedAt?: string; includedAt?: string; deliveredAt?: string };
    pep?: { number?: string; approvedAt?: string; requestedAt?: string; includedAt?: string; deliveredAt?: string };
  };
  activities?: Array<{
    catalogId?: string;
    quantity?: number | string;
  }>;
};

type CancelProgrammingPayload = {
  id?: string;
  action?: string;
  reason?: string;
  newDate?: string;
  expectedUpdatedAt?: string;
};

type SaveProgrammingRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  action?: "INSERT" | "UPDATE";
  programming_id?: string;
  project_code?: string;
  updated_at?: string;
};

type CopyProgrammingResponse = {
  success?: boolean;
  copiedCount?: number;
  message?: string;
};

type BatchCreateProgrammingResponse = {
  success?: boolean;
  insertedCount?: number;
  message?: string;
};

type BatchProgrammingRpcItem = {
  teamId?: string;
  programmingId?: string;
};

type BatchProgrammingRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  project_code?: string;
  inserted_count?: number;
  items?: BatchProgrammingRpcItem[];
};

type ProgrammingHistoryListResponse = {
  history: Array<{
    id: string;
    changedAt: string;
    reason: string;
    action: string;
    changes: Record<string, unknown>;
    metadata: Record<string, unknown>;
  }>;
};

type CancelProgrammingRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  programming_id?: string;
  project_code?: string;
  updated_at?: string;
  programming_status?: "ADIADA" | "CANCELADA";
};

type PostponeProgrammingRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  programming_id?: string;
  new_programming_id?: string;
  project_code?: string;
  updated_at?: string;
};

type AppendProgrammingHistoryRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  skipped?: boolean;
};

function isMissingRpcFunctionError(errorMessage: string, functionName: string) {
  const normalizedError = normalizeText(errorMessage).toLowerCase();
  return (
    normalizedError.includes(functionName.toLowerCase())
    || normalizedError.includes("function") && normalizedError.includes("does not exist")
    || normalizedError.includes("could not find")
  );
}

const PROGRAMMING_SELECT_BASE =
  "id, project_id, team_id, status, execution_date, period, start_time, end_time, expected_minutes, feeder, support, support_item_id, note, sgd_number, sgd_included_at, sgd_delivered_at, pi_number, pi_included_at, pi_delivered_at, pep_number, pep_included_at, pep_delivered_at, cancellation_reason, canceled_at, created_at, updated_at";

const PROGRAMMING_SELECT_WITH_STRUCTURE =
  "id, project_id, team_id, status, execution_date, period, start_time, end_time, expected_minutes, feeder, support, support_item_id, note, poste_qty, estrutura_qty, trafo_qty, rede_qty, sgd_number, sgd_included_at, sgd_delivered_at, pi_number, pi_included_at, pi_delivered_at, pep_number, pep_included_at, pep_delivered_at, cancellation_reason, canceled_at, created_at, updated_at";

const PROGRAMMING_SELECT_WITH_STRUCTURE_AND_ENEL =
  "id, project_id, team_id, status, execution_date, period, start_time, end_time, expected_minutes, feeder, support, support_item_id, note, poste_qty, estrutura_qty, trafo_qty, rede_qty, etapa_number, work_completion_status, affected_customers, sgd_type_id, sgd_number, sgd_included_at, sgd_delivered_at, pi_number, pi_included_at, pi_delivered_at, pep_number, pep_included_at, pep_delivered_at, cancellation_reason, canceled_at, created_at, updated_at";

const PROGRAMMING_SELECT_WITH_OUTAGE_STRUCTURE_AND_ENEL =
  "id, project_id, team_id, status, execution_date, period, start_time, end_time, expected_minutes, outage_start_time, outage_end_time, feeder, support, support_item_id, note, service_description, poste_qty, estrutura_qty, trafo_qty, rede_qty, etapa_number, work_completion_status, affected_customers, sgd_type_id, sgd_number, sgd_included_at, sgd_delivered_at, pi_number, pi_included_at, pi_delivered_at, pep_number, pep_included_at, pep_delivered_at, cancellation_reason, canceled_at, created_at, updated_at";

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeNullableText(value: unknown) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeIsoDate(value: unknown) {
  const normalized = normalizeText(value);
  return isIsoDate(normalized) ? normalized : null;
}

function normalizeTime(value: unknown) {
  const normalized = normalizeText(value);
  if (/^\d{2}:\d{2}$/.test(normalized)) {
    return `${normalized}:00`;
  }

  if (/^\d{2}:\d{2}:\d{2}$/.test(normalized)) {
    return normalized;
  }

  return null;
}

function normalizeOptionalTime(value: unknown) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  return normalizeTime(normalized);
}

function normalizeWorkCompletionStatus(value: unknown) {
  const normalized = normalizeText(value).toUpperCase();
  if (normalized === "CONCLUIDO" || normalized === "PARCIAL") {
    return normalized as "CONCLUIDO" | "PARCIAL";
  }

  return null;
}

function formatTime(value: string | null) {
  return normalizeText(value).slice(0, 5);
}

function normalizePositiveInteger(value: unknown) {
  const parsed = Number(value ?? "");
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function normalizePositiveNumber(value: unknown) {
  const raw = String(value ?? "").trim().replace(",", ".");
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Number(parsed.toFixed(2));
}

function normalizeQuestionnaireAnswers(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => normalizeText(item)).filter(Boolean);
}

function normalizeProgrammingStructureFields<T extends Record<string, unknown>>(row: T): ProgrammingRow {
  const normalized = {
    ...row,
    outage_start_time: normalizeNullableText(row.outage_start_time),
    outage_end_time: normalizeNullableText(row.outage_end_time),
    service_description: normalizeNullableText(row.service_description),
    poste_qty: Number(row.poste_qty ?? 0),
    estrutura_qty: Number(row.estrutura_qty ?? 0),
    trafo_qty: Number(row.trafo_qty ?? 0),
    rede_qty: Number(row.rede_qty ?? 0),
    etapa_number: row.etapa_number === null || row.etapa_number === undefined ? null : Number(row.etapa_number),
    work_completion_status: normalizeWorkCompletionStatus(row.work_completion_status),
    affected_customers: Number(row.affected_customers ?? 0),
    sgd_type_id: normalizeNullableText(row.sgd_type_id),
  };

  return normalized as unknown as ProgrammingRow;
}

function normalizeNonNegativeInteger(value: unknown) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return 0;
  }

  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

function normalizeUniqueTextArray(value: unknown) {
  return Array.from(new Set(normalizeStringArray(value)));
}

function startOfWeekMonday(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const dayOfWeek = date.getDay();
  const offset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  date.setDate(date.getDate() + offset);
  const nextYear = date.getFullYear();
  const nextMonth = String(date.getMonth() + 1).padStart(2, "0");
  const nextDay = String(date.getDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

function normalizePeriod(value: unknown) {
  const normalized = normalizeText(value).toUpperCase();
  if (normalized === "INTEGRAL" || normalized === "PARCIAL") {
    return normalized;
  }

  return null;
}

function formatComparableValue(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toFixed(2) : null;
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  const normalized = String(value).trim();
  return normalized || null;
}

function addChange(
  changes: Record<string, HistoryChange>,
  field: string,
  previousValue: unknown,
  nextValue: unknown,
) {
  const from = formatComparableValue(previousValue);
  const to = formatComparableValue(nextValue);

  if (from === to) {
    return;
  }

  changes[field] = { from, to };
}

function toActivitySnapshot(items: Array<{ code: string; quantity: number }>) {
  return JSON.stringify(
    [...items]
      .map((item) => ({
        code: normalizeText(item.code),
        quantity: Number(item.quantity.toFixed(2)),
      }))
      .sort((left, right) => left.code.localeCompare(right.code)),
  );
}

async function fetchProjects(
  supabase: SupabaseClient,
  tenantId: string,
) {
  const { data, error } = await supabase
    .from("project_with_labels")
    .select("id, sob, service_center_text, service_type_text, city_text, priority_text, partner_text, utility_responsible_text, utility_field_manager_text, street, neighborhood, service_description, observation, has_locacao, is_active")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("execution_deadline", { ascending: true })
    .returns<BoardProjectRow[]>();

  if (error) {
    return [] as BoardProjectRow[];
  }

  return data ?? [];
}

async function fetchTeams(
  supabase: SupabaseClient,
  tenantId: string,
) {
  const { data: teams, error } = await supabase
    .from("teams")
    .select("id, name, service_center_id, team_type_id, foreman_person_id, ativo")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .order("name", { ascending: true })
    .returns<TeamRow[]>();

  if (error || !teams?.length) {
    return [];
  }

  const teamTypeIds = Array.from(new Set(teams.map((item) => item.team_type_id).filter(Boolean)));
  const foremanIds = Array.from(new Set(teams.map((item) => item.foreman_person_id).filter(Boolean)));
  const serviceCenterIds = Array.from(new Set(teams.map((item) => item.service_center_id).filter(Boolean)));

  const [{ data: teamTypes }, { data: people }, { data: serviceCenters }] = await Promise.all([
    teamTypeIds.length
      ? supabase
          .from("team_types")
          .select("id, name")
          .eq("tenant_id", tenantId)
          .in("id", teamTypeIds)
          .returns<TeamTypeRow[]>()
      : Promise.resolve({ data: [] as TeamTypeRow[] }),
    foremanIds.length
      ? supabase
          .from("people")
          .select("id, nome")
          .eq("tenant_id", tenantId)
          .in("id", foremanIds)
          .returns<PersonRow[]>()
      : Promise.resolve({ data: [] as PersonRow[] }),
    serviceCenterIds.length
      ? supabase
          .from("project_service_centers")
          .select("id, name")
          .eq("tenant_id", tenantId)
          .in("id", serviceCenterIds)
          .returns<ServiceCenterRow[]>()
      : Promise.resolve({ data: [] as ServiceCenterRow[] }),
  ]);

  const teamTypeMap = new Map((teamTypes ?? []).map((item) => [item.id, normalizeText(item.name)]));
  const foremanMap = new Map((people ?? []).map((item) => [item.id, normalizeText(item.nome)]));
  const serviceCenterMap = new Map((serviceCenters ?? []).map((item) => [item.id, normalizeText(item.name)]));

  return teams.map((team) => ({
    id: team.id,
    name: normalizeText(team.name),
    serviceCenterId: team.service_center_id,
    serviceCenterName: team.service_center_id ? serviceCenterMap.get(team.service_center_id) ?? "Sem base" : "Sem base",
    teamTypeName: teamTypeMap.get(team.team_type_id) ?? "Sem tipo",
    foremanName: foremanMap.get(team.foreman_person_id) ?? "Sem encarregado",
  }));
}

async function fetchSupportOptions(
  supabase: SupabaseClient,
  tenantId: string,
) {
  const { data, error } = await supabase
    .from("programming_support_items")
    .select("id, description, location_support_item_id, is_active")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("description", { ascending: true })
    .returns<SupportOptionRow[]>();

  if (error) {
    return [] as SupportOptionRow[];
  }

  return data ?? [];
}

async function fetchProjectSupportDefaults(params: {
  supabase: SupabaseClient;
  tenantId: string;
  projectIds: string[];
  supportOptions: SupportOptionRow[];
}) {
  if (!params.projectIds.length || !params.supportOptions.length) {
    return new Map<string, { supportItemId: string; supportLabel: string }>();
  }

  const linkedTransitOption =
    params.supportOptions.find((item) => item.location_support_item_id === "90e570df-732f-43dd-9851-8fd8178ce1fc") ?? null;

  if (!linkedTransitOption) {
    return new Map<string, { supportItemId: string; supportLabel: string }>();
  }

  const { data, error } = await params.supabase
    .from("project_location_plans")
    .select("project_id, questionnaire_answers")
    .eq("tenant_id", params.tenantId)
    .in("project_id", params.projectIds)
    .returns<LocationPlanSupportRow[]>();

  if (error) {
    return new Map<string, { supportItemId: string; supportLabel: string }>();
  }

  const defaults = new Map<string, { supportItemId: string; supportLabel: string }>();
  for (const plan of data ?? []) {
    const questionnaireAnswers = normalizeQuestionnaireAnswers(plan.questionnaire_answers);
    const executionForecast = normalizeQuestionnaireAnswers(questionnaireAnswers.executionForecast);
    const removedSupportItemIds = new Set(normalizeStringArray(executionForecast.removedSupportItemIds));

    if (!removedSupportItemIds.has("90e570df-732f-43dd-9851-8fd8178ce1fc")) {
      defaults.set(plan.project_id, {
        supportItemId: linkedTransitOption.id,
        supportLabel: normalizeText(linkedTransitOption.description),
      });
    }
  }

  return defaults;
}

async function fetchProgrammingRows(
  supabase: SupabaseClient,
  tenantId: string,
  startDate: string,
  endDate: string,
) {
  const withOutageStructureAndEnelAttempt = await supabase
    .from("project_programming")
    .select(PROGRAMMING_SELECT_WITH_OUTAGE_STRUCTURE_AND_ENEL)
    .eq("tenant_id", tenantId)
    .gte("execution_date", startDate)
    .lte("execution_date", endDate)
    .order("execution_date", { ascending: true })
    .order("start_time", { ascending: true })
    .returns<ProgrammingRow[]>();

  if (!withOutageStructureAndEnelAttempt.error) {
    return (withOutageStructureAndEnelAttempt.data ?? []).map((item) =>
      normalizeProgrammingStructureFields(item as unknown as Record<string, unknown>),
    );
  }

  const withStructureAndEnelAttempt = await supabase
    .from("project_programming")
    .select(PROGRAMMING_SELECT_WITH_STRUCTURE_AND_ENEL)
    .eq("tenant_id", tenantId)
    .gte("execution_date", startDate)
    .lte("execution_date", endDate)
    .order("execution_date", { ascending: true })
    .order("start_time", { ascending: true })
    .returns<ProgrammingRow[]>();

  if (!withStructureAndEnelAttempt.error) {
    return (withStructureAndEnelAttempt.data ?? []).map((item) =>
      normalizeProgrammingStructureFields(item as unknown as Record<string, unknown>),
    );
  }

  const withStructureAttempt = await supabase
    .from("project_programming")
    .select(PROGRAMMING_SELECT_WITH_STRUCTURE)
    .eq("tenant_id", tenantId)
    .gte("execution_date", startDate)
    .lte("execution_date", endDate)
    .order("execution_date", { ascending: true })
    .order("start_time", { ascending: true })
    .returns<ProgrammingRow[]>();

  if (!withStructureAttempt.error) {
    return (withStructureAttempt.data ?? []).map((item) =>
      normalizeProgrammingStructureFields(item as unknown as Record<string, unknown>),
    );
  }

  // Compatibilidade com ambientes que ainda nao aplicaram a migration 085.
  const legacyAttempt = await supabase
    .from("project_programming")
    .select(PROGRAMMING_SELECT_BASE)
    .eq("tenant_id", tenantId)
    .gte("execution_date", startDate)
    .lte("execution_date", endDate)
    .order("execution_date", { ascending: true })
    .order("start_time", { ascending: true })
    .returns<Array<Record<string, unknown>>>();

  if (legacyAttempt.error) {
    return [] as ProgrammingRow[];
  }

  return (legacyAttempt.data ?? []).map((item) => normalizeProgrammingStructureFields(item));
}

async function fetchProgrammingWeekSummary(
  supabase: SupabaseClient,
  tenantId: string,
  weekStart: string,
) {
  const { data, error } = await supabase.rpc("get_programming_week_summary", {
    p_tenant_id: tenantId,
    p_week_start: weekStart,
  });

  if (error) {
    return [] as TeamWeekSummaryRow[];
  }

  return (data ?? []) as TeamWeekSummaryRow[];
}

async function fetchProgrammingActivities(
  supabase: SupabaseClient,
  tenantId: string,
  programmingIds: string[],
) {
  if (!programmingIds.length) {
    return new Map<string, ProgrammingActivityRow[]>();
  }

  const { data, error } = await supabase
    .from("project_programming_activities")
    .select("id, programming_id, service_activity_id, activity_code, activity_description, activity_unit, quantity, is_active")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .in("programming_id", programmingIds)
    .order("activity_code", { ascending: true })
    .returns<ProgrammingActivityRow[]>();

  if (error) {
    return new Map<string, ProgrammingActivityRow[]>();
  }

  const activityMap = new Map<string, ProgrammingActivityRow[]>();
  for (const item of data ?? []) {
    const current = activityMap.get(item.programming_id) ?? [];
    current.push(item);
    activityMap.set(item.programming_id, current);
  }

  return activityMap;
}

async function fetchRescheduledProgrammingIds(
  supabase: SupabaseClient,
  tenantId: string,
  programmingIds: string[],
) {
  if (!programmingIds.length) {
    return new Map<
      string,
      {
        historyId: string;
        changedAt: string;
        reason: string;
        fromDate: string;
        toDate: string;
      }
    >();
  }

  const { data, error } = await supabase
    .from("app_entity_history")
    .select("id, entity_id, reason, changes, metadata, created_at")
    .eq("tenant_id", tenantId)
    .eq("module_key", "programacao")
    .eq("entity_table", "project_programming")
    .in("entity_id", programmingIds)
    .order("created_at", { ascending: false })
    .returns<ProgrammingHistoryRow[]>();

  if (error) {
    return new Map<
      string,
      {
        historyId: string;
        changedAt: string;
        reason: string;
        fromDate: string;
        toDate: string;
      }
    >();
  }

  const latestReschedules = new Map<
    string,
    {
      historyId: string;
      changedAt: string;
      reason: string;
      fromDate: string;
      toDate: string;
    }
  >();

  for (const item of data ?? []) {
    if (latestReschedules.has(item.entity_id)) {
      continue;
    }

    if (normalizeText(item.metadata?.action).toUpperCase() !== "RESCHEDULE") {
      continue;
    }

    const executionDateChange = item.changes?.executionDate as
      | { from?: string | null; to?: string | null }
      | undefined;

    latestReschedules.set(item.entity_id, {
      historyId: item.id,
      changedAt: item.created_at,
      reason: normalizeText(item.reason),
      fromDate: normalizeText(executionDateChange?.from),
      toDate: normalizeText(executionDateChange?.to),
    });
  }

  return latestReschedules;
}

async function fetchProgrammingHistory(
  supabase: SupabaseClient,
  tenantId: string,
  programmingId: string,
) {
  const { data, error } = await supabase
    .from("app_entity_history")
    .select("id, entity_id, reason, changes, metadata, created_at")
    .eq("tenant_id", tenantId)
    .eq("module_key", "programacao")
    .eq("entity_table", "project_programming")
    .eq("entity_id", programmingId)
    .order("created_at", { ascending: false })
    .returns<ProgrammingHistoryRow[]>();

  if (error) {
    return [] as ProgrammingHistoryRow[];
  }

  return data ?? [];
}

async function fetchProgrammingSgdTypes(
  supabase: SupabaseClient,
  tenantId: string,
) {
  const { data, error } = await supabase
    .from("programming_sgd_types")
    .select("id, description, export_column, is_active")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("description", { ascending: true })
    .returns<ProgrammingSgdTypeRow[]>();

  if (error) {
    return [] as ProgrammingSgdTypeRow[];
  }

  return data ?? [];
}

async function fetchProgrammingById(
  supabase: SupabaseClient,
  tenantId: string,
  programmingId: string,
) {
  const withOutageStructureAndEnelAttempt = await supabase
    .from("project_programming")
    .select(PROGRAMMING_SELECT_WITH_OUTAGE_STRUCTURE_AND_ENEL)
    .eq("tenant_id", tenantId)
    .eq("id", programmingId)
    .maybeSingle<ProgrammingRow>();

  if (!withOutageStructureAndEnelAttempt.error && withOutageStructureAndEnelAttempt.data) {
    return normalizeProgrammingStructureFields(
      withOutageStructureAndEnelAttempt.data as unknown as Record<string, unknown>,
    );
  }

  const withStructureAndEnelAttempt = await supabase
    .from("project_programming")
    .select(PROGRAMMING_SELECT_WITH_STRUCTURE_AND_ENEL)
    .eq("tenant_id", tenantId)
    .eq("id", programmingId)
    .maybeSingle<ProgrammingRow>();

  if (!withStructureAndEnelAttempt.error && withStructureAndEnelAttempt.data) {
    return normalizeProgrammingStructureFields(
      withStructureAndEnelAttempt.data as unknown as Record<string, unknown>,
    );
  }

  const withStructureAttempt = await supabase
    .from("project_programming")
    .select(PROGRAMMING_SELECT_WITH_STRUCTURE)
    .eq("tenant_id", tenantId)
    .eq("id", programmingId)
    .maybeSingle<ProgrammingRow>();

  if (!withStructureAttempt.error && withStructureAttempt.data) {
    return normalizeProgrammingStructureFields(
      withStructureAttempt.data as unknown as Record<string, unknown>,
    );
  }

  const legacyAttempt = await supabase
    .from("project_programming")
    .select(PROGRAMMING_SELECT_BASE)
    .eq("tenant_id", tenantId)
    .eq("id", programmingId)
    .maybeSingle<Record<string, unknown>>();

  if (legacyAttempt.error || !legacyAttempt.data) {
    return null;
  }

  return normalizeProgrammingStructureFields(legacyAttempt.data);
}

async function saveProgrammingViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  programmingId?: string | null;
  projectId: string;
  teamId: string;
  executionDate: string;
  period: "INTEGRAL" | "PARCIAL";
  startTime: string;
  endTime: string;
  expectedMinutes: number;
  outageStartTime?: string | null;
  outageEndTime?: string | null;
  feeder?: string | null;
  support?: string | null;
  supportItemId?: string | null;
  note?: string | null;
  documents: NonNullable<SaveProgrammingPayload["documents"]>;
  activities: Array<{ catalogId: string; quantity: number }>;
  expectedUpdatedAt?: string | null;
}) {
  const { data, error } = await params.supabase.rpc("save_project_programming", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_project_id: params.projectId,
    p_team_id: params.teamId,
    p_execution_date: params.executionDate,
    p_period: params.period,
    p_start_time: params.startTime,
    p_end_time: params.endTime,
    p_expected_minutes: params.expectedMinutes,
    p_feeder: params.feeder ?? null,
    p_support: params.support ?? null,
    p_note: params.note ?? null,
    p_documents: params.documents,
    p_activities: params.activities.map((item) => ({
      catalogId: item.catalogId,
      quantity: item.quantity,
    })),
    p_programming_id: params.programmingId ?? null,
    p_expected_updated_at: params.expectedUpdatedAt ?? null,
    p_support_item_id: params.supportItemId ?? null,
  });

  if (error) {
    return {
      ok: false,
      status: 500,
      message: "Falha ao salvar programacao via RPC.",
    } as const;
  }

  const result = (data ?? {}) as SaveProgrammingRpcResult;
  if (result.success !== true || !result.programming_id) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao salvar programacao.",
      reason: result.reason ?? null,
    } as const;
  }

  return {
    ok: true,
    action: result.action ?? null,
    programmingId: result.programming_id,
    projectCode: normalizeText(result.project_code),
    updatedAt: normalizeText(result.updated_at),
    message: result.message ?? "Programacao salva com sucesso.",
  } as const;
}

async function saveProgrammingFullViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  programmingId?: string | null;
  projectId: string;
  teamId: string;
  executionDate: string;
  period: "INTEGRAL" | "PARCIAL";
  startTime: string;
  endTime: string;
  expectedMinutes: number;
  outageStartTime?: string | null;
  outageEndTime?: string | null;
  feeder?: string | null;
  support?: string | null;
  supportItemId?: string | null;
  note?: string | null;
  serviceDescription?: string | null;
  posteQty: number;
  estruturaQty: number;
  trafoQty: number;
  redeQty: number;
  etapaNumber: number | null;
  workCompletionStatus: "CONCLUIDO" | "PARCIAL" | null;
  affectedCustomers: number;
  sgdTypeId: string;
  documents: NonNullable<SaveProgrammingPayload["documents"]>;
  activities: Array<{ catalogId: string; quantity: number }>;
  expectedUpdatedAt?: string | null;
}) {
  const { data, error } = await params.supabase.rpc("save_project_programming_full", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_project_id: params.projectId,
    p_team_id: params.teamId,
    p_execution_date: params.executionDate,
    p_period: params.period,
    p_start_time: params.startTime,
    p_end_time: params.endTime,
    p_expected_minutes: params.expectedMinutes,
    p_feeder: params.feeder ?? null,
    p_support: params.support ?? null,
    p_note: params.note ?? null,
    p_documents: params.documents,
    p_activities: params.activities.map((item) => ({
      catalogId: item.catalogId,
      quantity: item.quantity,
    })),
    p_programming_id: params.programmingId ?? null,
    p_expected_updated_at: params.expectedUpdatedAt ?? null,
    p_support_item_id: params.supportItemId ?? null,
    p_poste_qty: params.posteQty,
    p_estrutura_qty: params.estruturaQty,
    p_trafo_qty: params.trafoQty,
    p_rede_qty: params.redeQty,
    p_etapa_number: params.etapaNumber,
    p_work_completion_status: params.workCompletionStatus,
    p_affected_customers: params.affectedCustomers,
    p_sgd_type_id: params.sgdTypeId,
    p_outage_start_time: params.outageStartTime ?? null,
    p_outage_end_time: params.outageEndTime ?? null,
    p_service_description: params.serviceDescription ?? null,
  });

  if (error) {
    if (isMissingRpcFunctionError(error.message, "save_project_programming_full")) {
      return {
        ok: false,
        status: 409,
        reason: "FULL_RPC_NOT_AVAILABLE",
        message: "RPC transacional full indisponivel no ambiente atual.",
      } as const;
    }

    return {
      ok: false,
      status: 500,
      message: error.message
        ? `Falha ao salvar programacao via RPC full: ${error.message}`
        : "Falha ao salvar programacao via RPC full.",
    } as const;
  }

  const result = (data ?? {}) as SaveProgrammingRpcResult;
  if (result.success !== true || !result.programming_id) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao salvar programacao.",
      reason: result.reason ?? null,
    } as const;
  }

  return {
    ok: true,
    action: result.action ?? null,
    programmingId: result.programming_id,
    projectCode: normalizeText(result.project_code),
    updatedAt: normalizeText(result.updated_at),
    message: result.message ?? "Programacao salva com sucesso.",
  } as const;
}

async function saveProgrammingBatchViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  projectId: string;
  teamIds: string[];
  executionDate: string;
  period: "INTEGRAL" | "PARCIAL";
  startTime: string;
  endTime: string;
  expectedMinutes: number;
  outageStartTime?: string | null;
  outageEndTime?: string | null;
  feeder?: string | null;
  support?: string | null;
  supportItemId?: string | null;
  note?: string | null;
  serviceDescription?: string | null;
  posteQty: number;
  estruturaQty: number;
  trafoQty: number;
  redeQty: number;
  etapaNumber?: number | null;
  workCompletionStatus?: "CONCLUIDO" | "PARCIAL" | null;
  documents: NonNullable<BatchCreateProgrammingPayload["documents"]>;
  activities: Array<{ catalogId: string; quantity: number }>;
}) {
  const structureRequested = params.posteQty > 0 || params.estruturaQty > 0 || params.trafoQty > 0 || params.redeQty > 0;
  const basePayload = {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_project_id: params.projectId,
    p_team_ids: params.teamIds,
    p_execution_date: params.executionDate,
    p_period: params.period,
    p_start_time: params.startTime,
    p_end_time: params.endTime,
    p_expected_minutes: params.expectedMinutes,
    p_feeder: params.feeder ?? null,
    p_support: params.support ?? null,
    p_note: params.note ?? null,
    p_documents: params.documents,
    p_activities: params.activities.map((item) => ({
      catalogId: item.catalogId,
      quantity: item.quantity,
    })),
    p_support_item_id: params.supportItemId ?? null,
  };

  const withStructureAttempt = await params.supabase.rpc("save_project_programming_batch", {
    ...basePayload,
    p_poste_qty: params.posteQty,
    p_estrutura_qty: params.estruturaQty,
    p_trafo_qty: params.trafoQty,
    p_rede_qty: params.redeQty,
  });

  let data = withStructureAttempt.data;
  let error = withStructureAttempt.error;
  let usedLegacyRpc = false;

  if (error) {
    const legacyAttempt = await params.supabase.rpc("save_project_programming_batch", basePayload);
    if (!legacyAttempt.error) {
      data = legacyAttempt.data;
      error = null;
      usedLegacyRpc = true;
    } else {
      error = legacyAttempt.error;
    }
  }

  if (error) {
    return {
      ok: false,
      status: 500,
      message: error.message
        ? `Falha ao salvar programacao em lote via RPC: ${error.message}`
        : "Falha ao salvar programacao em lote via RPC.",
    } as const;
  }

  const result = (data ?? {}) as BatchProgrammingRpcResult;
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao salvar programacao em lote.",
      reason: result.reason ?? null,
    } as const;
  }

  if (usedLegacyRpc && structureRequested) {
    return {
      ok: false,
      status: 409,
      message:
        "Seu ambiente ainda nao suporta os campos estruturais (POSTE/ESTRUTURA/TRAFO/REDE). Aplique a migration 085 e tente novamente.",
      reason: "STRUCTURE_FIELDS_NOT_AVAILABLE",
    } as const;
  }

  const items = Array.isArray(result.items)
    ? result.items
        .map((item) => ({
          teamId: normalizeText(item.teamId),
          programmingId: normalizeText(item.programmingId),
        }))
        .filter((item) => item.teamId && item.programmingId)
    : [];

  return {
    ok: true,
    insertedCount: Number(result.inserted_count ?? items.length),
    projectCode: normalizeText(result.project_code),
    message: result.message ?? "Programacao em lote salva com sucesso.",
    items,
  } as const;
}

async function saveProgrammingBatchFullViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  projectId: string;
  teamIds: string[];
  executionDate: string;
  period: "INTEGRAL" | "PARCIAL";
  startTime: string;
  endTime: string;
  expectedMinutes: number;
  outageStartTime?: string | null;
  outageEndTime?: string | null;
  feeder?: string | null;
  support?: string | null;
  supportItemId?: string | null;
  note?: string | null;
  serviceDescription?: string | null;
  posteQty: number;
  estruturaQty: number;
  trafoQty: number;
  redeQty: number;
  etapaNumber: number | null;
  workCompletionStatus: "CONCLUIDO" | "PARCIAL" | null;
  affectedCustomers: number;
  sgdTypeId: string;
  documents: NonNullable<BatchCreateProgrammingPayload["documents"]>;
  activities: Array<{ catalogId: string; quantity: number }>;
}) {
  const { data, error } = await params.supabase.rpc("save_project_programming_batch_full", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_project_id: params.projectId,
    p_team_ids: params.teamIds,
    p_execution_date: params.executionDate,
    p_period: params.period,
    p_start_time: params.startTime,
    p_end_time: params.endTime,
    p_expected_minutes: params.expectedMinutes,
    p_feeder: params.feeder ?? null,
    p_support: params.support ?? null,
    p_note: params.note ?? null,
    p_documents: params.documents,
    p_activities: params.activities.map((item) => ({
      catalogId: item.catalogId,
      quantity: item.quantity,
    })),
    p_support_item_id: params.supportItemId ?? null,
    p_poste_qty: params.posteQty,
    p_estrutura_qty: params.estruturaQty,
    p_trafo_qty: params.trafoQty,
    p_rede_qty: params.redeQty,
    p_etapa_number: params.etapaNumber,
    p_work_completion_status: params.workCompletionStatus,
    p_affected_customers: params.affectedCustomers,
    p_sgd_type_id: params.sgdTypeId,
    p_outage_start_time: params.outageStartTime ?? null,
    p_outage_end_time: params.outageEndTime ?? null,
    p_service_description: params.serviceDescription ?? null,
  });

  if (error) {
    if (isMissingRpcFunctionError(error.message, "save_project_programming_batch_full")) {
      return {
        ok: false,
        status: 409,
        reason: "FULL_RPC_NOT_AVAILABLE",
        message: "RPC transacional full de lote indisponivel no ambiente atual.",
      } as const;
    }

    return {
      ok: false,
      status: 500,
      message: error.message
        ? `Falha ao salvar programacao em lote via RPC full: ${error.message}`
        : "Falha ao salvar programacao em lote via RPC full.",
    } as const;
  }

  const result = (data ?? {}) as BatchProgrammingRpcResult;
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao salvar programacao em lote.",
      reason: result.reason ?? null,
    } as const;
  }

  const items = Array.isArray(result.items)
    ? result.items
        .map((item) => ({
          teamId: normalizeText(item.teamId),
          programmingId: normalizeText(item.programmingId),
        }))
        .filter((item) => item.teamId && item.programmingId)
    : [];

  return {
    ok: true,
    insertedCount: Number(result.inserted_count ?? items.length),
    projectCode: normalizeText(result.project_code),
    message: result.message ?? "Programacao em lote salva com sucesso.",
    items,
  } as const;
}

async function setProgrammingStructureQuantitiesViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  programmingId: string;
  posteQty: number;
  estruturaQty: number;
  trafoQty: number;
  redeQty: number;
  force?: boolean;
}) {
  const structureRequested = Boolean(params.force) || params.posteQty > 0 || params.estruturaQty > 0 || params.trafoQty > 0 || params.redeQty > 0;
  if (!structureRequested) {
    return { ok: true } as const;
  }

  const { data, error } = await params.supabase.rpc("set_project_programming_structure_quantities", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_programming_id: params.programmingId,
    p_poste_qty: params.posteQty,
    p_estrutura_qty: params.estruturaQty,
    p_trafo_qty: params.trafoQty,
    p_rede_qty: params.redeQty,
  });

  if (error) {
    const isMissingRpc = isMissingRpcFunctionError(error.message, "set_project_programming_structure_quantities");

    if (isMissingRpc) {
      return {
        ok: false,
        status: 409,
        message:
          "Seu ambiente ainda nao suporta os campos estruturais (POSTE/ESTRUTURA/TRAFO/REDE). Aplique a migration 085 e tente novamente.",
      } as const;
    }

    return {
      ok: false,
      status: 500,
      message: error.message
        ? `Falha ao salvar quantidades estruturais da programacao: ${error.message}`
        : "Falha ao salvar quantidades estruturais da programacao.",
    } as const;
  }

  const result = (data ?? {}) as { success?: boolean; status?: number; message?: string };
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao salvar quantidades estruturais da programacao.",
    } as const;
  }

  return { ok: true } as const;
}

async function setProgrammingServiceDescriptionViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  programmingId: string;
  serviceDescription: string | null;
  force?: boolean;
}) {
  const shouldPersist = Boolean(params.force) || Boolean(params.serviceDescription);
  if (!shouldPersist) {
    return { ok: true } as const;
  }

  const { data, error } = await params.supabase.rpc("set_project_programming_service_description", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_programming_id: params.programmingId,
    p_service_description: params.serviceDescription,
  });

  if (error) {
    const isMissingRpc = isMissingRpcFunctionError(error.message, "set_project_programming_service_description");

    if (isMissingRpc) {
      return {
        ok: false,
        status: 409,
        message:
          "Seu ambiente ainda nao suporta o campo Descricao do servico da programacao. Aplique a migration 090 e tente novamente.",
      } as const;
    }

    return {
      ok: false,
      status: 500,
      message: error.message
        ? `Falha ao salvar descricao do servico da programacao: ${error.message}`
        : "Falha ao salvar descricao do servico da programacao.",
    } as const;
  }

  const result = (data ?? {}) as { success?: boolean; status?: number; message?: string };
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao salvar descricao do servico da programacao.",
    } as const;
  }

  return { ok: true } as const;
}

async function setProgrammingOutageWindowViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  programmingId: string;
  outageStartTime: string | null;
  outageEndTime: string | null;
  force?: boolean;
}) {
  const shouldPersist = Boolean(params.force) || Boolean(params.outageStartTime) || Boolean(params.outageEndTime);
  if (!shouldPersist) {
    return { ok: true } as const;
  }

  const { data, error } = await params.supabase.rpc("set_project_programming_outage_window", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_programming_id: params.programmingId,
    p_outage_start_time: params.outageStartTime,
    p_outage_end_time: params.outageEndTime,
  });

  if (error) {
    const isMissingRpc = isMissingRpcFunctionError(error.message, "set_project_programming_outage_window");

    if (isMissingRpc) {
      return {
        ok: false,
        status: 409,
        message:
          "Seu ambiente ainda nao suporta os campos Inicio/Termino de desligamento. Aplique a migration 089 e tente novamente.",
      } as const;
    }

    return {
      ok: false,
      status: 500,
      message: error.message
        ? `Falha ao salvar janela de desligamento da programacao: ${error.message}`
        : "Falha ao salvar janela de desligamento da programacao.",
    } as const;
  }

  const result = (data ?? {}) as { success?: boolean; status?: number; message?: string };
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao salvar janela de desligamento da programacao.",
    } as const;
  }

  return { ok: true } as const;
}

function normalizeDocumentsForPersistence(documents: NonNullable<SaveProgrammingPayload["documents"]>) {
  return {
    sgd: {
      approvedAt: normalizeIsoDate(documents?.sgd?.approvedAt ?? documents?.sgd?.includedAt),
      requestedAt: normalizeIsoDate(documents?.sgd?.requestedAt ?? documents?.sgd?.deliveredAt),
    },
    pi: {
      approvedAt: normalizeIsoDate(documents?.pi?.approvedAt ?? documents?.pi?.includedAt),
      requestedAt: normalizeIsoDate(documents?.pi?.requestedAt ?? documents?.pi?.deliveredAt),
    },
    pep: {
      approvedAt: normalizeIsoDate(documents?.pep?.approvedAt ?? documents?.pep?.includedAt),
      requestedAt: normalizeIsoDate(documents?.pep?.requestedAt ?? documents?.pep?.deliveredAt),
    },
  };
}

async function setProgrammingDocumentDatesViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  programmingId: string;
  documents: NonNullable<SaveProgrammingPayload["documents"]>;
  force?: boolean;
}) {
  const normalizedDocuments = normalizeDocumentsForPersistence(params.documents);
  const shouldPersist = Boolean(params.force)
    || Boolean(normalizedDocuments.sgd.approvedAt)
    || Boolean(normalizedDocuments.sgd.requestedAt)
    || Boolean(normalizedDocuments.pi.approvedAt)
    || Boolean(normalizedDocuments.pi.requestedAt)
    || Boolean(normalizedDocuments.pep.approvedAt)
    || Boolean(normalizedDocuments.pep.requestedAt);

  if (!shouldPersist) {
    return { ok: true } as const;
  }

  const { data, error } = await params.supabase.rpc("set_project_programming_document_dates", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_programming_id: params.programmingId,
    p_documents: normalizedDocuments,
  });

  if (error) {
    const isMissingRpc = isMissingRpcFunctionError(error.message, "set_project_programming_document_dates");

    if (isMissingRpc) {
      return {
        ok: false,
        status: 409,
        message:
          "Seu ambiente ainda nao suporta Data Aprovada/Data Pedido dos documentos. Aplique a migration 089 e tente novamente.",
      } as const;
    }

    return {
      ok: false,
      status: 500,
      message: error.message
        ? `Falha ao salvar datas de documentos da programacao: ${error.message}`
        : "Falha ao salvar datas de documentos da programacao.",
    } as const;
  }

  const result = (data ?? {}) as { success?: boolean; status?: number; message?: string };
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao salvar datas de documentos da programacao.",
    } as const;
  }

  return { ok: true } as const;
}

async function resolveProgrammingSgdType(params: {
  supabase: SupabaseClient;
  tenantId: string;
  sgdTypeId: string;
}) {
  const { data, error } = await params.supabase
    .from("programming_sgd_types")
    .select("id, description, export_column, is_active")
    .eq("tenant_id", params.tenantId)
    .eq("id", params.sgdTypeId)
    .eq("is_active", true)
    .maybeSingle<ProgrammingSgdTypeRow>();

  if (error || !data) {
    return null;
  }

  return data;
}

async function setProgrammingEnelFieldsViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  programmingId: string;
  affectedCustomers: number;
  sgdTypeId: string;
}) {
  const { data, error } = await params.supabase.rpc("set_project_programming_enel_fields", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_programming_id: params.programmingId,
    p_affected_customers: params.affectedCustomers,
    p_sgd_type_id: params.sgdTypeId,
  });

  if (error) {
    const isMissingRpc = isMissingRpcFunctionError(error.message, "set_project_programming_enel_fields");

    if (isMissingRpc) {
      return {
        ok: false,
        status: 409,
        message:
          "Seu ambiente ainda nao suporta os campos ENEL obrigatorios (Tipo de SGD e Nº Clientes Afetados). Aplique a migration 089 e tente novamente.",
      } as const;
    }

    return {
      ok: false,
      status: 500,
      message: error.message
        ? `Falha ao salvar campos ENEL da programacao: ${error.message}`
        : "Falha ao salvar campos ENEL da programacao.",
    } as const;
  }

  const result = (data ?? {}) as { success?: boolean; status?: number; message?: string };
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao salvar campos ENEL da programacao.",
    } as const;
  }

  return { ok: true } as const;
}

async function setProgrammingExecutionResultViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  programmingId: string;
  etapaNumber: number | null;
  workCompletionStatus: "CONCLUIDO" | "PARCIAL" | null;
  force?: boolean;
}) {
  const shouldPersist = Boolean(params.force)
    || params.etapaNumber !== null
    || params.workCompletionStatus !== null;

  if (!shouldPersist) {
    return { ok: true } as const;
  }

  const { data, error } = await params.supabase.rpc("set_project_programming_execution_result", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_programming_id: params.programmingId,
    p_etapa_number: params.etapaNumber,
    p_work_completion_status: params.workCompletionStatus,
  });

  if (error) {
    const isMissingRpc = isMissingRpcFunctionError(error.message, "set_project_programming_execution_result");

    if (isMissingRpc) {
      return {
        ok: false,
        status: 409,
        message:
          "Seu ambiente ainda nao suporta os campos ETAPA/Estado Trabalho da programacao. Aplique a migration 094 e tente novamente.",
      } as const;
    }

    return {
      ok: false,
      status: 500,
      message: error.message
        ? `Falha ao salvar ETAPA/Estado Trabalho da programacao: ${error.message}`
        : "Falha ao salvar ETAPA/Estado Trabalho da programacao.",
    } as const;
  }

  const result = (data ?? {}) as { success?: boolean; status?: number; message?: string };
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao salvar ETAPA/Estado Trabalho da programacao.",
    } as const;
  }

  return { ok: true } as const;
}

async function cancelProgrammingViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  programmingId: string;
  action: "ADIADA" | "CANCELADA";
  reason: string;
  expectedUpdatedAt?: string | null;
}) {
  const { data, error } = await params.supabase.rpc("set_project_programming_status", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_programming_id: params.programmingId,
    p_status: params.action,
    p_reason: params.reason,
    p_expected_updated_at: params.expectedUpdatedAt ?? null,
  });

  if (error) {
    return {
      ok: false,
      status: 500,
      message: "Falha ao cancelar programacao via RPC.",
    } as const;
  }

  const result = (data ?? {}) as CancelProgrammingRpcResult;
  if (result.success !== true || !result.programming_id) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao cancelar programacao.",
      reason: result.reason ?? null,
    } as const;
  }

  return {
    ok: true,
    programmingId: result.programming_id,
    projectCode: normalizeText(result.project_code),
    updatedAt: normalizeText(result.updated_at),
    programmingStatus: result.programming_status ?? params.action,
    message: result.message ?? (params.action === "ADIADA" ? "Programacao adiada com sucesso." : "Programacao cancelada com sucesso."),
  } as const;
}

async function postponeProgrammingViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  programmingId: string;
  newExecutionDate: string;
  reason: string;
  expectedUpdatedAt?: string | null;
}) {
  const { data, error } = await params.supabase.rpc("postpone_project_programming", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_programming_id: params.programmingId,
    p_new_execution_date: params.newExecutionDate,
    p_reason: params.reason,
    p_expected_updated_at: params.expectedUpdatedAt ?? null,
  });

  if (error) {
    const isMissingRpc = isMissingRpcFunctionError(error.message, "postpone_project_programming");

    if (isMissingRpc) {
      return {
        ok: false,
        status: 409,
        message:
          "Seu ambiente ainda nao suporta adiamento com nova data. Aplique a migration 088 e tente novamente.",
      } as const;
    }

    return {
      ok: false,
      status: 500,
      message: error.message
        ? `Falha ao adiar programacao via RPC: ${error.message}`
        : "Falha ao adiar programacao via RPC.",
    } as const;
  }

  const result = (data ?? {}) as PostponeProgrammingRpcResult;
  if (result.success !== true || !result.programming_id || !result.new_programming_id) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: result.message ?? "Falha ao adiar programacao.",
      reason: result.reason ?? null,
    } as const;
  }

  return {
    ok: true,
    programmingId: result.programming_id,
    newProgrammingId: result.new_programming_id,
    projectCode: normalizeText(result.project_code),
    updatedAt: normalizeText(result.updated_at),
    message: result.message ?? "Programacao adiada com sucesso.",
  } as const;
}

async function registerProgrammingHistory(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  programmingId: string;
  projectCode: string;
  changes: Record<string, HistoryChange>;
  metadata: Record<string, unknown>;
  reason?: string | null;
  force?: boolean;
}) {
  const { data, error } = await params.supabase.rpc("append_programming_history", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_programming_id: params.programmingId,
    p_project_code: params.projectCode,
    p_reason: params.reason ?? null,
    p_changes: params.changes,
    p_metadata: params.metadata,
    p_change_type: "UPDATE",
    p_force: params.force ?? false,
  });

  if (error) {
    return;
  }

  const result = (data ?? {}) as AppendProgrammingHistoryRpcResult;
  if (result.success !== true) {
    return;
  }
}

async function copyProgramming(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para copiar programacao.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const payload = (await request.json().catch(() => null)) as CopyProgrammingPayload | null;
  const sourceTeamId = normalizeText(payload?.sourceTeamId);
  const startDate = normalizeIsoDate(payload?.startDate);
  const endDate = normalizeIsoDate(payload?.endDate);
  const targetTeamIds = Array.from(
    new Set((Array.isArray(payload?.targetTeamIds) ? payload?.targetTeamIds : []).map((item) => normalizeText(item)).filter(Boolean)),
  );

  if (!sourceTeamId || !targetTeamIds.length) {
    return NextResponse.json({ message: "Informe a equipe de origem e ao menos uma equipe de destino." }, { status: 400 });
  }

  if (!startDate || !endDate) {
    return NextResponse.json({ message: "Informe o periodo visivel para copiar a linha da equipe." }, { status: 400 });
  }

  const { data, error } = await resolution.supabase.rpc("copy_team_programming_period", {
    p_tenant_id: resolution.appUser.tenant_id,
    p_actor_user_id: resolution.appUser.id,
    p_source_team_id: sourceTeamId,
    p_target_team_ids: targetTeamIds,
    p_visible_start_date: startDate,
    p_visible_end_date: endDate,
  });

  if (error) {
    return NextResponse.json({ message: "Falha ao copiar a linha da equipe no periodo visivel." }, { status: 500 });
  }

  const result = (data ?? {}) as CopyProgrammingResponse & { success?: boolean; status?: number };
  if (result.success !== true) {
    return NextResponse.json(
      { message: result.message ?? "Falha ao copiar a linha da equipe no periodo visivel." },
      { status: Number(result.status ?? 400) },
    );
  }

  return NextResponse.json({
    success: true,
    copiedCount: result.copiedCount ?? 0,
    message: result.message ?? "Programacao copiada com sucesso.",
  } satisfies CopyProgrammingResponse);
}

export async function GET(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para consultar programacao.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const historyProgrammingId = normalizeText(request.nextUrl.searchParams.get("historyProgrammingId"));
    if (historyProgrammingId) {
      const historyRows = await fetchProgrammingHistory(
        resolution.supabase,
        resolution.appUser.tenant_id,
        historyProgrammingId,
      );

      return NextResponse.json({
        history: historyRows.map((item) => ({
          id: item.id,
          changedAt: item.created_at,
          reason: normalizeText(item.reason),
          action: normalizeText(item.metadata?.action),
          changes: item.changes ?? {},
          metadata: item.metadata ?? {},
        })),
      } satisfies ProgrammingHistoryListResponse);
    }

    const startDate = normalizeIsoDate(request.nextUrl.searchParams.get("startDate"));
    const endDate = normalizeIsoDate(request.nextUrl.searchParams.get("endDate"));

    if (!startDate || !endDate) {
      return NextResponse.json({ message: "startDate e endDate sao obrigatorios." }, { status: 400 });
    }

    const weekStart = startOfWeekMonday(startDate);
    const [projects, teams, programmingRows, supportOptions, teamSummaries, sgdTypes] = await Promise.all([
      fetchProjects(resolution.supabase, resolution.appUser.tenant_id),
      fetchTeams(resolution.supabase, resolution.appUser.tenant_id),
      fetchProgrammingRows(resolution.supabase, resolution.appUser.tenant_id, startDate, endDate),
      fetchSupportOptions(resolution.supabase, resolution.appUser.tenant_id),
      fetchProgrammingWeekSummary(resolution.supabase, resolution.appUser.tenant_id, weekStart),
      fetchProgrammingSgdTypes(resolution.supabase, resolution.appUser.tenant_id),
    ]);

    const projectMap = new Map(projects.map((item) => [item.id, item]));
    const sgdTypeMap = new Map(sgdTypes.map((item) => [item.id, item]));
    const supportDefaults = await fetchProjectSupportDefaults({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      projectIds: projects.map((item) => item.id),
      supportOptions,
    });
    const activitiesMap = await fetchProgrammingActivities(
      resolution.supabase,
      resolution.appUser.tenant_id,
      programmingRows.map((item) => item.id),
    );
    const rescheduleHistoryMap = await fetchRescheduledProgrammingIds(
      resolution.supabase,
      resolution.appUser.tenant_id,
      programmingRows.map((item) => item.id),
    );

    return NextResponse.json({
      projects: projects.map((item) => ({
          id: item.id,
          code: normalizeText(item.sob),
          serviceName: normalizeText(item.service_description) || normalizeText(item.service_type_text) || "Sem descricao",
          city: normalizeText(item.city_text) || "Sem municipio",
          base: normalizeText(item.service_center_text) || "Sem base",
          serviceType: normalizeText(item.service_type_text) || "Sem tipo",
          priority: normalizeText(item.priority_text) || "Sem prioridade",
          partner: normalizeText(item.partner_text),
          utilityResponsible: normalizeText(item.utility_responsible_text),
          utilityFieldManager: normalizeText(item.utility_field_manager_text),
          street: normalizeText(item.street),
          district: normalizeText(item.neighborhood),
          note: normalizeText(item.observation) || normalizeText(item.service_description),
          hasLocacao: Boolean(item.has_locacao),
          defaultSupportItemId: supportDefaults.get(item.id)?.supportItemId ?? null,
          defaultSupportLabel: supportDefaults.get(item.id)?.supportLabel ?? null,
        })),
      teams,
      supportOptions: supportOptions.map((item) => ({
        id: item.id,
        description: normalizeText(item.description),
      })),
      sgdTypes: sgdTypes.map((item) => ({
        id: item.id,
        description: normalizeText(item.description),
        exportColumn: normalizeText(item.export_column),
      })),
      teamSummaries: teamSummaries.map((item) => ({
        teamId: item.team_id,
        weekStart: item.week_start,
        weekEnd: item.week_end,
        workedDays: Number(item.worked_days ?? 0),
        capacityDays: Number(item.capacity_days ?? 5),
        freeDays: Number(item.free_days ?? 0),
        loadPercent: Number(item.load_percent ?? 0),
        loadStatus: item.load_status ?? "FREE",
      })),
      schedules: programmingRows.map((item) => {
        const project = projectMap.get(item.project_id);
        const sgdType = item.sgd_type_id ? sgdTypeMap.get(item.sgd_type_id) : null;
        const scheduleActivities = activitiesMap.get(item.id) ?? [];

        return {
          id: item.id,
          projectId: item.project_id,
          teamId: item.team_id,
          status: item.status,
          date: item.execution_date,
          period: item.period === "INTEGRAL" ? "integral" : "partial",
          startTime: formatTime(item.start_time),
          endTime: formatTime(item.end_time),
          outageStartTime: formatTime(item.outage_start_time),
          outageEndTime: formatTime(item.outage_end_time),
          updatedAt: item.updated_at,
          expectedMinutes: Number(item.expected_minutes ?? 0),
          posteQty: Number(item.poste_qty ?? 0),
          estruturaQty: Number(item.estrutura_qty ?? 0),
          trafoQty: Number(item.trafo_qty ?? 0),
          redeQty: Number(item.rede_qty ?? 0),
          etapaNumber: item.etapa_number === null ? null : Number(item.etapa_number),
          workCompletionStatus: normalizeWorkCompletionStatus(item.work_completion_status),
          affectedCustomers: Number(item.affected_customers ?? 0),
          sgdTypeId: item.sgd_type_id,
          sgdTypeDescription: normalizeText(sgdType?.description),
          sgdExportColumn: normalizeText(sgdType?.export_column),
          feeder: normalizeText(item.feeder),
          support: normalizeText(item.support),
          supportItemId: item.support_item_id,
          note: normalizeText(item.note),
          serviceDescription: normalizeText(item.service_description),
          projectBase: normalizeText(project?.service_center_text) || "Sem base",
          statusReason: normalizeText(item.cancellation_reason),
          statusChangedAt: item.canceled_at ?? "",
          wasRescheduled: rescheduleHistoryMap.has(item.id),
          lastReschedule: rescheduleHistoryMap.get(item.id)
            ? {
                id: rescheduleHistoryMap.get(item.id)?.historyId ?? "",
                changedAt: rescheduleHistoryMap.get(item.id)?.changedAt ?? "",
                reason: rescheduleHistoryMap.get(item.id)?.reason ?? "",
                fromDate: rescheduleHistoryMap.get(item.id)?.fromDate ?? "",
                toDate: rescheduleHistoryMap.get(item.id)?.toDate ?? "",
              }
            : null,
          activities: scheduleActivities.map((activity) => ({
            catalogId: activity.service_activity_id,
            code: normalizeText(activity.activity_code),
            description: normalizeText(activity.activity_description),
            quantity: Number(activity.quantity ?? 0),
            unit: normalizeText(activity.activity_unit),
          })),
          documents: {
            sgd: {
              number: normalizeText(item.sgd_number),
              approvedAt: item.sgd_included_at ?? "",
              requestedAt: item.sgd_delivered_at ?? "",
              includedAt: item.sgd_included_at ?? "",
              deliveredAt: item.sgd_delivered_at ?? "",
            },
            pi: {
              number: normalizeText(item.pi_number),
              approvedAt: item.pi_included_at ?? "",
              requestedAt: item.pi_delivered_at ?? "",
              includedAt: item.pi_included_at ?? "",
              deliveredAt: item.pi_delivered_at ?? "",
            },
            pep: {
              number: normalizeText(item.pep_number),
              approvedAt: item.pep_included_at ?? "",
              requestedAt: item.pep_delivered_at ?? "",
              includedAt: item.pep_included_at ?? "",
              deliveredAt: item.pep_delivered_at ?? "",
            },
          },
        };
      }),
    });
  } catch {
    return NextResponse.json({ message: "Falha ao consultar programacao." }, { status: 500 });
  }
}

async function saveProgrammingBatch(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para registrar programacao em lote.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const payload = (await request.json().catch(() => null)) as BatchCreateProgrammingPayload | null;
  const projectId = normalizeText(payload?.projectId);
  const teamIds = normalizeUniqueTextArray(payload?.teamIds);
  const executionDate = normalizeIsoDate(payload?.date);
  const period = normalizePeriod(payload?.period);
  const startTime = normalizeTime(payload?.startTime);
  const endTime = normalizeTime(payload?.endTime);
  const outageStartTime = normalizeOptionalTime(payload?.outageStartTime);
  const outageEndTime = normalizeOptionalTime(payload?.outageEndTime);
  const expectedMinutes = normalizePositiveInteger(payload?.expectedMinutes);
  const feeder = normalizeNullableText(payload?.feeder);
  const support = normalizeNullableText(payload?.support);
  const supportItemId = normalizeNullableText(payload?.supportItemId);
  const note = normalizeNullableText(payload?.note);
  const serviceDescription = normalizeNullableText(payload?.serviceDescription);
  const posteQty = normalizeNonNegativeInteger(payload?.posteQty);
  const estruturaQty = normalizeNonNegativeInteger(payload?.estruturaQty);
  const trafoQty = normalizeNonNegativeInteger(payload?.trafoQty);
  const redeQty = normalizeNonNegativeInteger(payload?.redeQty);
  const etapaNumberRaw = normalizeText(payload?.etapaNumber);
  const etapaNumber = etapaNumberRaw ? normalizePositiveInteger(etapaNumberRaw) : null;
  const workCompletionStatusRaw = normalizeText(payload?.workCompletionStatus);
  const affectedCustomers = normalizeNonNegativeInteger(payload?.affectedCustomers);
  const sgdTypeId = normalizeNullableText(payload?.sgdTypeId);
  const documents = payload?.documents ?? {};
  const activitiesInput = Array.isArray(payload?.activities) ? payload.activities : [];
  const activities = activitiesInput
    .map((item) => ({
      catalogId: normalizeText(item.catalogId),
      quantity: normalizePositiveNumber(item.quantity),
    }))
    .filter((item): item is { catalogId: string; quantity: number } => Boolean(item.catalogId) && item.quantity !== null);

  if (!projectId || !teamIds.length || !executionDate || !period || !startTime || !endTime || !expectedMinutes) {
    return NextResponse.json({ message: "Preencha os campos obrigatorios da programacao em lote." }, { status: 400 });
  }

  if ((outageStartTime && !outageEndTime) || (!outageStartTime && outageEndTime)) {
    return NextResponse.json(
      { message: "Informe inicio e termino de desligamento." },
      { status: 400 },
    );
  }

  if (outageStartTime && outageEndTime && outageEndTime <= outageStartTime) {
    return NextResponse.json(
      { message: "Termino de desligamento deve ser maior que inicio." },
      { status: 400 },
    );
  }

  if (posteQty === null || estruturaQty === null || trafoQty === null || redeQty === null) {
    return NextResponse.json(
      { message: "As quantidades de POSTE, ESTRUTURA, TRAFO e REDE devem ser inteiros maiores ou iguais a zero." },
      { status: 400 },
    );
  }

  if (!etapaNumberRaw) {
    return NextResponse.json(
      { message: "O campo ETAPA e obrigatorio." },
      { status: 400 },
    );
  }

  if (etapaNumber === null) {
    return NextResponse.json(
      { message: "O campo ETAPA deve ser um numero inteiro maior que zero." },
      { status: 400 },
    );
  }

  if (workCompletionStatusRaw) {
    return NextResponse.json(
      { message: "Estado Trabalho so pode ser informado na edicao da programacao." },
      { status: 400 },
    );
  }

  if (affectedCustomers === null) {
    return NextResponse.json(
      { message: "O campo Numero de Clientes Afetados deve ser um inteiro maior ou igual a zero." },
      { status: 400 },
    );
  }

  if (!sgdTypeId) {
    return NextResponse.json(
      { message: "Tipo de SGD e obrigatorio para salvar a programacao." },
      { status: 400 },
    );
  }

  const selectedSgdType = await resolveProgrammingSgdType({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    sgdTypeId,
  });

  if (!selectedSgdType) {
    return NextResponse.json(
      { message: "Tipo de SGD invalido para o tenant atual." },
      { status: 400 },
    );
  }

  const [{ data: project }, { data: teamRows }] = await Promise.all([
    resolution.supabase
      .from("project_with_labels")
      .select("id, sob, is_active")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("id", projectId)
      .eq("is_active", true)
      .maybeSingle<{ id: string; sob: string; is_active: boolean }>(),
    resolution.supabase
      .from("teams")
      .select("id, name, ativo")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .in("id", teamIds)
      .returns<Array<{ id: string; name: string; ativo: boolean }>>(),
  ]);

  const teamNameMap = new Map((teamRows ?? []).map((item) => [item.id, normalizeText(item.name)]));
  const fullBatchSaveResult = await saveProgrammingBatchFullViaRpc({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    actorUserId: resolution.appUser.id,
    projectId,
    teamIds,
    executionDate,
    period,
    startTime,
    endTime,
    expectedMinutes,
    outageStartTime,
    outageEndTime,
    feeder,
    support,
    supportItemId,
    note,
    serviceDescription,
    posteQty,
    estruturaQty,
    trafoQty,
    redeQty,
    etapaNumber,
    workCompletionStatus: null,
    affectedCustomers: affectedCustomers ?? 0,
    sgdTypeId,
    documents,
    activities,
  });

  let saveResult: Awaited<ReturnType<typeof saveProgrammingBatchViaRpc>>;
  let usedFullBatchRpc = false;

  if (fullBatchSaveResult.ok) {
    saveResult = {
      ok: true,
      insertedCount: fullBatchSaveResult.insertedCount,
      projectCode: fullBatchSaveResult.projectCode,
      message: fullBatchSaveResult.message,
      items: fullBatchSaveResult.items,
    } as const;
    usedFullBatchRpc = true;
  } else if (fullBatchSaveResult.reason === "FULL_RPC_NOT_AVAILABLE") {
    saveResult = await saveProgrammingBatchViaRpc({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      actorUserId: resolution.appUser.id,
      projectId,
      teamIds,
      executionDate,
      period,
      startTime,
      endTime,
      expectedMinutes,
      outageStartTime,
      outageEndTime,
      feeder,
      support,
      supportItemId,
      note,
      serviceDescription,
      posteQty,
      estruturaQty,
      trafoQty,
      redeQty,
      etapaNumber,
      workCompletionStatus: null,
      documents,
      activities,
    });
  } else {
    return NextResponse.json({ message: fullBatchSaveResult.message }, { status: fullBatchSaveResult.status });
  }

  if (!saveResult.ok) {
    return NextResponse.json({ message: saveResult.message }, { status: saveResult.status });
  }

  const projectCode = normalizeText(project?.sob) || normalizeText(saveResult.projectCode) || projectId;
  const activitiesSnapshot = JSON.stringify(
    activities.map((item) => ({ code: item.catalogId, quantity: Number(item.quantity.toFixed(2)) })),
  );

  for (const item of saveResult.items) {
    if (!usedFullBatchRpc) {
      const outageWindowResult = await setProgrammingOutageWindowViaRpc({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        actorUserId: resolution.appUser.id,
        programmingId: item.programmingId,
        outageStartTime,
        outageEndTime,
      });
      if (!outageWindowResult.ok) {
        return NextResponse.json({ message: outageWindowResult.message }, { status: outageWindowResult.status });
      }

      const serviceDescriptionResult = await setProgrammingServiceDescriptionViaRpc({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        actorUserId: resolution.appUser.id,
        programmingId: item.programmingId,
        serviceDescription,
      });
      if (!serviceDescriptionResult.ok) {
        return NextResponse.json({ message: serviceDescriptionResult.message }, { status: serviceDescriptionResult.status });
      }

      const enelFieldResult = await setProgrammingEnelFieldsViaRpc({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        actorUserId: resolution.appUser.id,
        programmingId: item.programmingId,
        affectedCustomers: affectedCustomers ?? 0,
        sgdTypeId,
      });

      if (!enelFieldResult.ok) {
        return NextResponse.json({ message: enelFieldResult.message }, { status: enelFieldResult.status });
      }

      const executionResult = await setProgrammingExecutionResultViaRpc({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        actorUserId: resolution.appUser.id,
        programmingId: item.programmingId,
        etapaNumber,
        workCompletionStatus: null,
      });
      if (!executionResult.ok) {
        return NextResponse.json({ message: executionResult.message }, { status: executionResult.status });
      }

      const documentDatesResult = await setProgrammingDocumentDatesViaRpc({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        actorUserId: resolution.appUser.id,
        programmingId: item.programmingId,
        documents,
      });

      if (!documentDatesResult.ok) {
        return NextResponse.json({ message: documentDatesResult.message }, { status: documentDatesResult.status });
      }
    }

    await registerProgrammingHistory({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      actorUserId: resolution.appUser.id,
      programmingId: item.programmingId,
      projectCode,
      changes: {
        project: { from: null, to: projectCode },
        team: { from: null, to: teamNameMap.get(item.teamId) ?? item.teamId },
        executionDate: { from: null, to: executionDate },
        period: { from: null, to: period },
        startTime: { from: null, to: formatTime(startTime) },
        endTime: { from: null, to: formatTime(endTime) },
        outageStartTime: { from: null, to: formatTime(outageStartTime) },
        outageEndTime: { from: null, to: formatTime(outageEndTime) },
        expectedMinutes: { from: null, to: String(expectedMinutes) },
        feeder: { from: null, to: feeder },
        support: { from: null, to: support },
        note: { from: null, to: note },
        serviceDescription: { from: null, to: serviceDescription },
        posteQty: { from: null, to: String(posteQty) },
        estruturaQty: { from: null, to: String(estruturaQty) },
        trafoQty: { from: null, to: String(trafoQty) },
        redeQty: { from: null, to: String(redeQty) },
        etapaNumber: { from: null, to: etapaNumber === null ? null : String(etapaNumber) },
        affectedCustomers: { from: null, to: String(affectedCustomers ?? 0) },
        sgdType: { from: null, to: selectedSgdType ? normalizeText(selectedSgdType.description) : null },
        sgdApprovedAt: { from: null, to: normalizeIsoDate(documents?.sgd?.approvedAt ?? documents?.sgd?.includedAt) },
        sgdRequestedAt: { from: null, to: normalizeIsoDate(documents?.sgd?.requestedAt ?? documents?.sgd?.deliveredAt) },
        piApprovedAt: { from: null, to: normalizeIsoDate(documents?.pi?.approvedAt ?? documents?.pi?.includedAt) },
        piRequestedAt: { from: null, to: normalizeIsoDate(documents?.pi?.requestedAt ?? documents?.pi?.deliveredAt) },
        pepApprovedAt: { from: null, to: normalizeIsoDate(documents?.pep?.approvedAt ?? documents?.pep?.includedAt) },
        pepRequestedAt: { from: null, to: normalizeIsoDate(documents?.pep?.requestedAt ?? documents?.pep?.deliveredAt) },
        activities: { from: null, to: activitiesSnapshot },
      },
      metadata: {
        action: "BATCH_CREATE",
        source: "programacao-simples",
        projectId,
        teamId: item.teamId,
        executionDate,
      },
    });
  }

  return NextResponse.json({
    success: true,
    insertedCount: saveResult.insertedCount,
    message: saveResult.message,
  } satisfies BatchCreateProgrammingResponse);
}

async function saveProgramming(request: NextRequest, method: "POST" | "PUT") {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: method === "POST" ? "Sessao invalida para registrar programacao." : "Sessao invalida para editar programacao.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const payload = (await request.json().catch(() => null)) as SaveProgrammingPayload | null;
  const programmingId = normalizeText(payload?.id);
  const projectId = normalizeText(payload?.projectId);
  const teamId = normalizeText(payload?.teamId);
  const executionDate = normalizeIsoDate(payload?.date);
  const period = normalizePeriod(payload?.period);
  const startTime = normalizeTime(payload?.startTime);
  const endTime = normalizeTime(payload?.endTime);
  const outageStartTime = normalizeOptionalTime(payload?.outageStartTime);
  const outageEndTime = normalizeOptionalTime(payload?.outageEndTime);
  const expectedMinutes = normalizePositiveInteger(payload?.expectedMinutes);
  const feeder = normalizeNullableText(payload?.feeder);
  const support = normalizeNullableText(payload?.support);
  const supportItemId = normalizeNullableText(payload?.supportItemId);
  const note = normalizeNullableText(payload?.note);
  const serviceDescription = normalizeNullableText(payload?.serviceDescription);
  const posteQty = normalizeNonNegativeInteger(payload?.posteQty);
  const estruturaQty = normalizeNonNegativeInteger(payload?.estruturaQty);
  const trafoQty = normalizeNonNegativeInteger(payload?.trafoQty);
  const redeQty = normalizeNonNegativeInteger(payload?.redeQty);
  const etapaNumberRaw = normalizeText(payload?.etapaNumber);
  const etapaNumber = etapaNumberRaw ? normalizePositiveInteger(etapaNumberRaw) : null;
  const workCompletionStatusRaw = normalizeText(payload?.workCompletionStatus);
  const workCompletionStatus = normalizeWorkCompletionStatus(workCompletionStatusRaw);
  const affectedCustomers = normalizeNonNegativeInteger(payload?.affectedCustomers);
  const sgdTypeId = normalizeNullableText(payload?.sgdTypeId);
  const changeReason = normalizeNullableText(payload?.changeReason);
  const expectedUpdatedAt = normalizeText(payload?.expectedUpdatedAt) || null;
  const activitiesInput = Array.isArray(payload?.activities) ? payload.activities : [];
  const activities = activitiesInput
    .map((item) => ({
      catalogId: normalizeText(item.catalogId),
      quantity: normalizePositiveNumber(item.quantity),
    }))
    .filter((item): item is { catalogId: string; quantity: number } => Boolean(item.catalogId) && item.quantity !== null);
  const documents = payload?.documents ?? {};

  if (method === "PUT" && !programmingId) {
    return NextResponse.json({ message: "Programacao invalida para edicao." }, { status: 400 });
  }

  if (!projectId || !teamId || !executionDate || !period || !startTime || !endTime || !expectedMinutes) {
    return NextResponse.json({ message: "Preencha os campos obrigatorios da programacao." }, { status: 400 });
  }

  if ((outageStartTime && !outageEndTime) || (!outageStartTime && outageEndTime)) {
    return NextResponse.json(
      { message: "Informe inicio e termino de desligamento." },
      { status: 400 },
    );
  }

  if (outageStartTime && outageEndTime && outageEndTime <= outageStartTime) {
    return NextResponse.json(
      { message: "Termino de desligamento deve ser maior que inicio." },
      { status: 400 },
    );
  }

  if (posteQty === null || estruturaQty === null || trafoQty === null || redeQty === null) {
    return NextResponse.json(
      { message: "As quantidades de POSTE, ESTRUTURA, TRAFO e REDE devem ser inteiros maiores ou iguais a zero." },
      { status: 400 },
    );
  }

  if (!etapaNumberRaw) {
    return NextResponse.json(
      { message: "O campo ETAPA e obrigatorio." },
      { status: 400 },
    );
  }

  if (etapaNumber === null) {
    return NextResponse.json(
      { message: "O campo ETAPA deve ser um numero inteiro maior que zero." },
      { status: 400 },
    );
  }

  if (method === "PUT" && !workCompletionStatus) {
    return NextResponse.json(
      { message: "Estado Trabalho e obrigatorio na edicao da programacao." },
      { status: 400 },
    );
  }

  if (workCompletionStatusRaw && !workCompletionStatus) {
    return NextResponse.json(
      { message: "Estado Trabalho invalido. Use apenas CONCLUIDO ou PARCIAL." },
      { status: 400 },
    );
  }

  if (affectedCustomers === null) {
    return NextResponse.json(
      { message: "O campo Numero de Clientes Afetados deve ser um inteiro maior ou igual a zero." },
      { status: 400 },
    );
  }

  if (!sgdTypeId) {
    return NextResponse.json(
      { message: "Tipo de SGD e obrigatorio para salvar a programacao." },
      { status: 400 },
    );
  }

  const selectedSgdType = await resolveProgrammingSgdType({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    sgdTypeId,
  });

  if (!selectedSgdType) {
    return NextResponse.json(
      { message: "Tipo de SGD invalido para o tenant atual." },
      { status: 400 },
    );
  }

  const currentProgramming = programmingId
    ? await fetchProgrammingById(resolution.supabase, resolution.appUser.tenant_id, programmingId)
    : null;

  if (programmingId && !currentProgramming) {
    return NextResponse.json({ message: "Programacao nao encontrada." }, { status: 404 });
  }

  const normalizedWorkCompletionStatus =
    method === "PUT"
      ? workCompletionStatus
      : null;

  const isPotentialReschedule = currentProgramming
    ? (
      currentProgramming.execution_date !== executionDate
      || currentProgramming.team_id !== teamId
      || formatTime(currentProgramming.start_time) !== formatTime(startTime)
      || formatTime(currentProgramming.end_time) !== formatTime(endTime)
    )
    : false;

  if (isPotentialReschedule && (!changeReason || changeReason.length < 10)) {
    return NextResponse.json({ message: "Informe um motivo de reprogramacao com no minimo 10 caracteres." }, { status: 400 });
  }

  const currentTeamNamePromise = currentProgramming?.team_id
    ? resolution.supabase
        .from("teams")
        .select("name")
        .eq("tenant_id", resolution.appUser.tenant_id)
        .eq("id", currentProgramming.team_id)
        .maybeSingle<{ name: string }>()
    : Promise.resolve({ data: null as { name: string } | null });

  const [{ data: project }, { data: team }, { data: currentTeamLabel }] = await Promise.all([
    resolution.supabase
      .from("project_with_labels")
      .select("id, sob, is_active")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("id", projectId)
      .eq("is_active", true)
      .maybeSingle<{ id: string; sob: string; is_active: boolean }>(),
    resolution.supabase
      .from("teams")
      .select("id, name, ativo")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("id", teamId)
      .eq("ativo", true)
      .maybeSingle<{ id: string; name: string; ativo: boolean }>(),
    currentTeamNamePromise,
  ]);

  const fullSaveResult = await saveProgrammingFullViaRpc({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    actorUserId: resolution.appUser.id,
    programmingId: programmingId || null,
    projectId,
    teamId,
    executionDate,
    period,
    startTime,
    endTime,
    expectedMinutes,
    outageStartTime,
    outageEndTime,
    feeder,
    support,
    supportItemId,
    note,
    serviceDescription,
    posteQty: posteQty ?? 0,
    estruturaQty: estruturaQty ?? 0,
    trafoQty: trafoQty ?? 0,
    redeQty: redeQty ?? 0,
    etapaNumber,
    workCompletionStatus: normalizedWorkCompletionStatus,
    affectedCustomers: affectedCustomers ?? 0,
    sgdTypeId,
    documents,
    activities,
    expectedUpdatedAt,
  });

  let saveResult: Awaited<ReturnType<typeof saveProgrammingViaRpc>>;
  let usedFullSaveRpc = false;

  if (fullSaveResult.ok) {
    saveResult = {
      ok: true,
      action: fullSaveResult.action,
      programmingId: fullSaveResult.programmingId,
      projectCode: fullSaveResult.projectCode,
      updatedAt: fullSaveResult.updatedAt,
      message: fullSaveResult.message,
    } as const;
    usedFullSaveRpc = true;
  } else if (fullSaveResult.reason === "FULL_RPC_NOT_AVAILABLE") {
    saveResult = await saveProgrammingViaRpc({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      actorUserId: resolution.appUser.id,
      programmingId: programmingId || null,
      projectId,
      teamId,
      executionDate,
      period,
      startTime,
      endTime,
      expectedMinutes,
      outageStartTime,
      outageEndTime,
      feeder,
      support,
      supportItemId,
      note,
      documents,
      activities,
      expectedUpdatedAt,
    });
  } else {
    return NextResponse.json({ message: fullSaveResult.message }, { status: fullSaveResult.status });
  }

  if (!saveResult.ok) {
    return NextResponse.json({ message: saveResult.message }, { status: saveResult.status });
  }

  const persistedProgrammingId = saveResult.programmingId;

  if (!usedFullSaveRpc) {
    const structureResult = await setProgrammingStructureQuantitiesViaRpc({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      actorUserId: resolution.appUser.id,
      programmingId: persistedProgrammingId,
      posteQty: posteQty ?? 0,
      estruturaQty: estruturaQty ?? 0,
      trafoQty: trafoQty ?? 0,
      redeQty: redeQty ?? 0,
      force: Boolean(currentProgramming),
    });
    if (!structureResult.ok) {
      return NextResponse.json({ message: structureResult.message }, { status: structureResult.status });
    }

    const outageWindowResult = await setProgrammingOutageWindowViaRpc({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      actorUserId: resolution.appUser.id,
      programmingId: persistedProgrammingId,
      outageStartTime,
      outageEndTime,
      force: Boolean(currentProgramming) && (
        formatTime(currentProgramming?.outage_start_time ?? null) !== formatTime(outageStartTime)
        || formatTime(currentProgramming?.outage_end_time ?? null) !== formatTime(outageEndTime)
      ),
    });
    if (!outageWindowResult.ok) {
      return NextResponse.json({ message: outageWindowResult.message }, { status: outageWindowResult.status });
    }

    const serviceDescriptionResult = await setProgrammingServiceDescriptionViaRpc({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      actorUserId: resolution.appUser.id,
      programmingId: persistedProgrammingId,
      serviceDescription,
      force: Boolean(currentProgramming) && (
        (currentProgramming?.service_description ?? null) !== (serviceDescription ?? null)
      ),
    });
    if (!serviceDescriptionResult.ok) {
      return NextResponse.json({ message: serviceDescriptionResult.message }, { status: serviceDescriptionResult.status });
    }

    const enelFieldResult = await setProgrammingEnelFieldsViaRpc({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      actorUserId: resolution.appUser.id,
      programmingId: persistedProgrammingId,
      affectedCustomers: affectedCustomers ?? 0,
      sgdTypeId,
    });
    if (!enelFieldResult.ok) {
      return NextResponse.json({ message: enelFieldResult.message }, { status: enelFieldResult.status });
    }

    const executionResult = await setProgrammingExecutionResultViaRpc({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      actorUserId: resolution.appUser.id,
      programmingId: persistedProgrammingId,
      etapaNumber,
      workCompletionStatus: normalizedWorkCompletionStatus,
      force: Boolean(currentProgramming) && (
        (currentProgramming?.etapa_number ?? null) !== etapaNumber
        || normalizeWorkCompletionStatus(currentProgramming?.work_completion_status ?? null) !== normalizedWorkCompletionStatus
      ),
    });
    if (!executionResult.ok) {
      return NextResponse.json({ message: executionResult.message }, { status: executionResult.status });
    }

    const documentDatesResult = await setProgrammingDocumentDatesViaRpc({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      actorUserId: resolution.appUser.id,
      programmingId: persistedProgrammingId,
      documents,
      force: Boolean(currentProgramming),
    });
    if (!documentDatesResult.ok) {
      return NextResponse.json({ message: documentDatesResult.message }, { status: documentDatesResult.status });
    }
  }

  const nextProgramming = await fetchProgrammingById(resolution.supabase, resolution.appUser.tenant_id, persistedProgrammingId);
  if (!nextProgramming) {
    return NextResponse.json({ message: "Falha ao recarregar programacao salva." }, { status: 500 });
  }

  const nextActivitiesMap = await fetchProgrammingActivities(
    resolution.supabase,
    resolution.appUser.tenant_id,
    [persistedProgrammingId],
  );
  const nextActivities = (nextActivitiesMap.get(persistedProgrammingId) ?? []).map((item) => ({
    code: normalizeText(item.activity_code),
    quantity: Number(item.quantity ?? 0),
  }));

  const previousActivitiesMap = currentProgramming
    ? await fetchProgrammingActivities(resolution.supabase, resolution.appUser.tenant_id, [currentProgramming.id])
    : new Map<string, ProgrammingActivityRow[]>();
  const previousActivities = currentProgramming
    ? (previousActivitiesMap.get(currentProgramming.id) ?? []).map((item) => ({
        code: normalizeText(item.activity_code),
        quantity: Number(item.quantity ?? 0),
      }))
    : [];

  const changes: Record<string, HistoryChange> = {};
  addChange(changes, "project", currentProgramming ? project?.sob ?? null : null, project?.sob ?? null);
  addChange(
    changes,
    "team",
    currentProgramming ? normalizeText(currentTeamLabel?.name) || currentProgramming.team_id : null,
    team?.name ?? teamId,
  );
  addChange(changes, "executionDate", currentProgramming?.execution_date ?? null, nextProgramming.execution_date);
  addChange(changes, "period", currentProgramming?.period ?? null, nextProgramming.period);
  addChange(changes, "startTime", currentProgramming ? formatTime(currentProgramming.start_time) : null, formatTime(nextProgramming.start_time));
  addChange(changes, "endTime", currentProgramming ? formatTime(currentProgramming.end_time) : null, formatTime(nextProgramming.end_time));
  addChange(changes, "outageStartTime", currentProgramming ? formatTime(currentProgramming.outage_start_time) : null, formatTime(nextProgramming.outage_start_time));
  addChange(changes, "outageEndTime", currentProgramming ? formatTime(currentProgramming.outage_end_time) : null, formatTime(nextProgramming.outage_end_time));
  addChange(changes, "expectedMinutes", currentProgramming?.expected_minutes ?? null, nextProgramming.expected_minutes);
  addChange(changes, "feeder", currentProgramming?.feeder ?? null, nextProgramming.feeder);
  addChange(changes, "support", currentProgramming?.support ?? null, nextProgramming.support);
  addChange(changes, "note", currentProgramming?.note ?? null, nextProgramming.note);
  addChange(changes, "serviceDescription", currentProgramming?.service_description ?? null, nextProgramming.service_description);
  addChange(changes, "posteQty", currentProgramming?.poste_qty ?? null, nextProgramming.poste_qty);
  addChange(changes, "estruturaQty", currentProgramming?.estrutura_qty ?? null, nextProgramming.estrutura_qty);
  addChange(changes, "trafoQty", currentProgramming?.trafo_qty ?? null, nextProgramming.trafo_qty);
  addChange(changes, "redeQty", currentProgramming?.rede_qty ?? null, nextProgramming.rede_qty);
  addChange(changes, "etapaNumber", currentProgramming?.etapa_number ?? null, nextProgramming.etapa_number);
  addChange(
    changes,
    "workCompletionStatus",
    normalizeWorkCompletionStatus(currentProgramming?.work_completion_status ?? null),
    normalizeWorkCompletionStatus(nextProgramming.work_completion_status),
  );
  addChange(changes, "affectedCustomers", currentProgramming?.affected_customers ?? null, nextProgramming.affected_customers);
  addChange(changes, "sgdType", currentProgramming?.sgd_type_id ?? null, nextProgramming.sgd_type_id);
  addChange(changes, "sgdNumber", currentProgramming?.sgd_number ?? null, nextProgramming.sgd_number);
  addChange(changes, "sgdApprovedAt", currentProgramming?.sgd_included_at ?? null, nextProgramming.sgd_included_at);
  addChange(changes, "sgdRequestedAt", currentProgramming?.sgd_delivered_at ?? null, nextProgramming.sgd_delivered_at);
  addChange(changes, "piNumber", currentProgramming?.pi_number ?? null, nextProgramming.pi_number);
  addChange(changes, "piApprovedAt", currentProgramming?.pi_included_at ?? null, nextProgramming.pi_included_at);
  addChange(changes, "piRequestedAt", currentProgramming?.pi_delivered_at ?? null, nextProgramming.pi_delivered_at);
  addChange(changes, "pepNumber", currentProgramming?.pep_number ?? null, nextProgramming.pep_number);
  addChange(changes, "pepApprovedAt", currentProgramming?.pep_included_at ?? null, nextProgramming.pep_included_at);
  addChange(changes, "pepRequestedAt", currentProgramming?.pep_delivered_at ?? null, nextProgramming.pep_delivered_at);
  addChange(changes, "activities", toActivitySnapshot(previousActivities), toActivitySnapshot(nextActivities));
  const isReschedule =
    Boolean(currentProgramming) &&
    (
      currentProgramming?.execution_date !== nextProgramming.execution_date ||
      currentProgramming?.team_id !== nextProgramming.team_id ||
      formatTime(currentProgramming?.start_time ?? null) !== formatTime(nextProgramming.start_time) ||
      formatTime(currentProgramming?.end_time ?? null) !== formatTime(nextProgramming.end_time)
    );

  const responseMessage = currentProgramming
    ? isReschedule
      ? `Programacao do projeto ${project?.sob ?? saveResult.projectCode ?? projectId} reagendada com sucesso.`
      : saveResult.message
    : saveResult.message;

  await registerProgrammingHistory({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    actorUserId: resolution.appUser.id,
    programmingId: persistedProgrammingId,
    projectCode: project?.sob ?? saveResult.projectCode ?? projectId,
    reason: isReschedule ? changeReason : null,
    changes,
    metadata: {
      action: !currentProgramming ? "CREATE" : isReschedule ? "RESCHEDULE" : "UPDATE",
      projectId,
      teamId,
      executionDate,
    },
  });

  return NextResponse.json({
    success: true,
    id: persistedProgrammingId,
    message: responseMessage,
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const normalizedAction = normalizeText(body?.action).toUpperCase();

  if (normalizedAction === "COPY") {
    const clonedRequest = new NextRequest(request.url, {
      method: request.method,
      headers: request.headers,
      body: JSON.stringify(body),
    });

    return copyProgramming(clonedRequest);
  }

  if (normalizedAction === "BATCH_CREATE") {
    const clonedRequest = new NextRequest(request.url, {
      method: request.method,
      headers: request.headers,
      body: JSON.stringify(body),
    });

    return saveProgrammingBatch(clonedRequest);
  }

  const clonedRequest = new NextRequest(request.url, {
    method: request.method,
    headers: request.headers,
    body: JSON.stringify(body),
  });

  return saveProgramming(clonedRequest, "POST");
}

export async function PUT(request: NextRequest) {
  return saveProgramming(request, "PUT");
}

export async function PATCH(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para cancelar programacao.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const payload = (await request.json().catch(() => null)) as CancelProgrammingPayload | null;
  const programmingId = normalizeText(payload?.id);
  const action = normalizeText(payload?.action).toUpperCase() === "ADIAR" ? "ADIADA" : "CANCELADA";
  const reason = normalizeNullableText(payload?.reason);
  const newDate = normalizeIsoDate(payload?.newDate);
  const expectedUpdatedAt = normalizeText(payload?.expectedUpdatedAt) || null;

  if (!programmingId || !reason) {
    return NextResponse.json({ message: "Informe a programacao e o motivo da alteracao." }, { status: 400 });
  }

  if (!expectedUpdatedAt) {
    return NextResponse.json({ message: "Atualize a grade antes de alterar o status da programacao." }, { status: 409 });
  }

  if (reason.length < 10) {
    return NextResponse.json({ message: "Informe um motivo com no minimo 10 caracteres." }, { status: 400 });
  }

  if (action === "ADIADA" && !newDate) {
    return NextResponse.json(
      { message: "Informe a nova data da programacao para concluir o adiamento." },
      { status: 400 },
    );
  }

  const currentProgramming = await fetchProgrammingById(resolution.supabase, resolution.appUser.tenant_id, programmingId);
  if (!currentProgramming) {
    return NextResponse.json({ message: "Programacao nao encontrada." }, { status: 404 });
  }

  const { data: project } = await resolution.supabase
    .from("project_with_labels")
    .select("id, sob")
    .eq("tenant_id", resolution.appUser.tenant_id)
    .eq("id", currentProgramming.project_id)
    .maybeSingle<{ id: string; sob: string }>();

  if (action === "ADIADA") {
    if (!newDate) {
      return NextResponse.json(
        { message: "Informe a nova data da programacao para concluir o adiamento." },
        { status: 400 },
      );
    }

    if (newDate === currentProgramming.execution_date) {
      return NextResponse.json(
        { message: "Informe uma nova data diferente da data atual da programacao." },
        { status: 400 },
      );
    }

    const postponeResult = await postponeProgrammingViaRpc({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      actorUserId: resolution.appUser.id,
      programmingId,
      newExecutionDate: newDate,
      reason,
      expectedUpdatedAt,
    });

    if (!postponeResult.ok) {
      return NextResponse.json({ message: postponeResult.message }, { status: postponeResult.status });
    }

    await registerProgrammingHistory({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      actorUserId: resolution.appUser.id,
      programmingId,
      projectCode: project?.sob ?? postponeResult.projectCode ?? currentProgramming.project_id,
      reason,
      force: true,
      changes: {
        status: { from: currentProgramming.status, to: "ADIADA" },
        isActive: { from: "true", to: "false" },
        cancellationReason: { from: null, to: reason },
      },
      metadata: {
        action: "ADIADA",
        projectId: currentProgramming.project_id,
        teamId: currentProgramming.team_id,
        executionDate: currentProgramming.execution_date,
        newExecutionDate: newDate,
        newProgrammingId: postponeResult.newProgrammingId,
      },
    });

    await registerProgrammingHistory({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      actorUserId: resolution.appUser.id,
      programmingId: postponeResult.newProgrammingId,
      projectCode: project?.sob ?? postponeResult.projectCode ?? currentProgramming.project_id,
      reason,
      changes: {
        project: { from: null, to: project?.sob ?? currentProgramming.project_id },
        executionDate: { from: null, to: newDate },
      },
      metadata: {
        action: "CREATE",
        source: "programacao-postpone",
        projectId: currentProgramming.project_id,
        teamId: currentProgramming.team_id,
        executionDate: newDate,
        sourceProgrammingId: programmingId,
      },
    });

    return NextResponse.json({
      success: true,
      id: programmingId,
      newId: postponeResult.newProgrammingId,
      message: postponeResult.message,
    });
  }

  const cancelResult = await cancelProgrammingViaRpc({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    actorUserId: resolution.appUser.id,
    programmingId,
    action,
    reason,
    expectedUpdatedAt,
  });

  if (!cancelResult.ok) {
    return NextResponse.json({ message: cancelResult.message }, { status: cancelResult.status });
  }

  await registerProgrammingHistory({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    actorUserId: resolution.appUser.id,
    programmingId,
    projectCode: project?.sob ?? cancelResult.projectCode ?? currentProgramming.project_id,
    reason,
    force: true,
    changes: {
      status: { from: currentProgramming.status, to: action },
      isActive: { from: "true", to: "false" },
      cancellationReason: { from: null, to: reason },
    },
    metadata: {
      action,
      projectId: currentProgramming.project_id,
      teamId: currentProgramming.team_id,
      executionDate: currentProgramming.execution_date,
    },
  });

  return NextResponse.json({
    success: true,
    id: programmingId,
    message: cancelResult.message,
  });
}
