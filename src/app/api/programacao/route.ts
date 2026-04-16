import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";

type BoardProjectRow = {
  id: string;
  sob: string;
  execution_deadline: string | null;
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
  is_test: boolean;
};

type BoardProjectBaseRow = Omit<BoardProjectRow, "is_test"> & {
  is_test?: boolean | null;
};

type TeamRow = {
  id: string;
  name: string;
  vehicle_plate: string | null;
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
  export_column: string;
  is_active: boolean;
};

type ProgrammingEqCatalogRow = {
  id: string;
  code: string;
  label_pt: string;
  is_active: boolean;
  sort_order: number;
};

type ProgrammingReasonCatalogRow = {
  code: string;
  label_pt: string;
  requires_notes: boolean;
  is_active: boolean;
  sort_order: number;
};

type ProgrammingWorkCompletionCatalogRow = {
  id: string;
  code: string;
  label_pt: string;
  is_active: boolean;
  sort_order: number;
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
  status: "PROGRAMADA" | "REPROGRAMADA" | "ADIADA" | "CANCELADA";
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
  campo_eletrico: string | null;
  service_description: string | null;
  poste_qty: number | null;
  estrutura_qty: number | null;
  trafo_qty: number | null;
  rede_qty: number | null;
  etapa_number: number | null;
  etapa_unica: boolean | null;
  etapa_final: boolean | null;
  work_completion_status: string | null;
  affected_customers: number | null;
  sgd_type_id: string | null;
  electrical_eq_catalog_id: string | null;
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
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

type AppUserLookupRow = {
  id: string;
  display: string | null;
  login_name: string | null;
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
  created_by: string | null;
  changed_by_name: string;
  reason: string | null;
  changes: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type ProgrammingOperationalHistoryRow = {
  id: string;
  programming_id: string;
  related_programming_id: string | null;
  created_by: string | null;
  action_type: string;
  reason: string | null;
  changes: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
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
  electricalField?: string;
  serviceDescription?: string;
  posteQty?: number | string;
  estruturaQty?: number | string;
  trafoQty?: number | string;
  redeQty?: number | string;
  etapaNumber?: number | string;
  etapaUnica?: boolean;
  etapaFinal?: boolean;
  workCompletionStatus?: string;
  affectedCustomers?: number | string;
  sgdTypeId?: string;
  electricalEqCatalogId?: string;
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
  electricalField?: string;
  serviceDescription?: string;
  posteQty?: number | string;
  estruturaQty?: number | string;
  trafoQty?: number | string;
  redeQty?: number | string;
  etapaNumber?: number | string;
  etapaUnica?: boolean;
  etapaFinal?: boolean;
  workCompletionStatus?: string;
  affectedCustomers?: number | string;
  sgdTypeId?: string;
  electricalEqCatalogId?: string;
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

type ProgrammingConflictRecord = {
  id: string;
  projectId: string;
  teamId: string;
  status: string;
  executionDate: string;
  startTime: string;
  endTime: string;
  updatedAt: string;
};

type ProgrammingConflictPayload = {
  error: "conflict";
  message: string;
  currentRecord: ProgrammingConflictRecord | null;
  currentUpdatedAt: string | null;
  updatedBy: string | null;
  changedFields: string[];
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
  warning?: string | null;
  enteredEtapaNumber?: number;
  hasConflict?: boolean;
  highestStage?: number;
  teams?: ProgrammingStageValidationTeamSummary[];
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

type ProgrammingStageValidationTeamSummary = {
  teamId: string;
  teamName: string;
  highestStage: number;
  existingStages: number[];
  existingDates: string[];
};

type ProgrammingStageValidationResponse = {
  enteredEtapaNumber: number;
  hasConflict: boolean;
  highestStage: number;
  teams: ProgrammingStageValidationTeamSummary[];
  message: string;
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
  detail?: string;
  programming_id?: string;
  new_programming_id?: string;
  project_code?: string;
  updated_at?: string;
};

type ProgrammingTimeConflictLookupRow = {
  id: string;
  team_id: string;
  project_id: string;
  start_time: string;
  end_time: string;
};

type TeamConflictLookupRow = {
  id: string;
  name: string | null;
  foreman_person_id: string | null;
};

type ForemanConflictLookupRow = {
  id: string;
  nome: string | null;
};

type ProjectConflictLookupRow = {
  id: string;
  sob: string | null;
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
  "id, project_id, team_id, status, execution_date, period, start_time, end_time, expected_minutes, feeder, support, support_item_id, note, sgd_number, sgd_included_at, sgd_delivered_at, pi_number, pi_included_at, pi_delivered_at, pep_number, pep_included_at, pep_delivered_at, cancellation_reason, canceled_at, created_by, updated_by, created_at, updated_at";

const PROGRAMMING_SELECT_WITH_STRUCTURE =
  "id, project_id, team_id, status, execution_date, period, start_time, end_time, expected_minutes, feeder, support, support_item_id, note, poste_qty, estrutura_qty, trafo_qty, rede_qty, sgd_number, sgd_included_at, sgd_delivered_at, pi_number, pi_included_at, pi_delivered_at, pep_number, pep_included_at, pep_delivered_at, cancellation_reason, canceled_at, created_by, updated_by, created_at, updated_at";

const PROGRAMMING_SELECT_WITH_STRUCTURE_AND_ENEL =
  "id, project_id, team_id, status, execution_date, period, start_time, end_time, expected_minutes, feeder, support, support_item_id, note, campo_eletrico, poste_qty, estrutura_qty, trafo_qty, rede_qty, etapa_number, etapa_unica, etapa_final, work_completion_status, affected_customers, sgd_type_id, electrical_eq_catalog_id, sgd_number, sgd_included_at, sgd_delivered_at, pi_number, pi_included_at, pi_delivered_at, pep_number, pep_included_at, pep_delivered_at, cancellation_reason, canceled_at, created_by, updated_by, created_at, updated_at";

const PROGRAMMING_SELECT_WITH_OUTAGE_STRUCTURE_AND_ENEL =
  "id, project_id, team_id, status, execution_date, period, start_time, end_time, expected_minutes, outage_start_time, outage_end_time, feeder, support, support_item_id, note, campo_eletrico, service_description, poste_qty, estrutura_qty, trafo_qty, rede_qty, etapa_number, etapa_unica, etapa_final, work_completion_status, affected_customers, sgd_type_id, electrical_eq_catalog_id, sgd_number, sgd_included_at, sgd_delivered_at, pi_number, pi_included_at, pi_delivered_at, pep_number, pep_included_at, pep_delivered_at, cancellation_reason, canceled_at, created_by, updated_by, created_at, updated_at";

const PROGRAMMING_SELECT_WITH_STRUCTURE_AND_ENEL_LEGACY_ETAPA_FINAL =
  "id, project_id, team_id, status, execution_date, period, start_time, end_time, expected_minutes, feeder, support, support_item_id, note, campo_eletrico, poste_qty, estrutura_qty, trafo_qty, rede_qty, etapa_number, etapa_unica, work_completion_status, affected_customers, sgd_type_id, electrical_eq_catalog_id, sgd_number, sgd_included_at, sgd_delivered_at, pi_number, pi_included_at, pi_delivered_at, pep_number, pep_included_at, pep_delivered_at, cancellation_reason, canceled_at, created_by, updated_by, created_at, updated_at";

const PROGRAMMING_SELECT_WITH_OUTAGE_STRUCTURE_AND_ENEL_LEGACY_ETAPA_FINAL =
  "id, project_id, team_id, status, execution_date, period, start_time, end_time, expected_minutes, outage_start_time, outage_end_time, feeder, support, support_item_id, note, campo_eletrico, service_description, poste_qty, estrutura_qty, trafo_qty, rede_qty, etapa_number, etapa_unica, work_completion_status, affected_customers, sgd_type_id, electrical_eq_catalog_id, sgd_number, sgd_included_at, sgd_delivered_at, pi_number, pi_included_at, pi_delivered_at, pep_number, pep_included_at, pep_delivered_at, cancellation_reason, canceled_at, created_by, updated_by, created_at, updated_at";

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function isMissingEtapaFinalColumnError(errorMessage: unknown) {
  const normalizedError = normalizeText(errorMessage).toLowerCase();
  return (
    normalizedError.includes("etapa_final")
    && (
      normalizedError.includes("does not exist")
      || normalizedError.includes("could not find")
      || normalizedError.includes("schema cache")
    )
  );
}

function resolveAppUserName(user: AppUserLookupRow | undefined) {
  if (!user) {
    return "Nao identificado";
  }

  return normalizeText(user.login_name) || normalizeText(user.display) || "Nao identificado";
}

async function resolveTeamTimeConflictDetailedMessage(params: {
  supabase: SupabaseClient;
  tenantId: string;
  executionDate: string;
  startTime: string;
  endTime: string;
  teamIds: string[];
  excludeProgrammingId?: string | null;
}) {
  const uniqueTeamIds = Array.from(new Set(params.teamIds.map((value) => normalizeText(value)).filter(Boolean)));
  if (!uniqueTeamIds.length) {
    return null;
  }

  let conflictQuery = params.supabase
    .from("project_programming")
    .select("id, team_id, project_id, start_time, end_time")
    .eq("tenant_id", params.tenantId)
    .eq("execution_date", params.executionDate)
    .in("team_id", uniqueTeamIds)
    .in("status", ["PROGRAMADA", "REPROGRAMADA"])
    .lt("start_time", params.endTime)
    .gt("end_time", params.startTime)
    .order("team_id", { ascending: true })
    .order("start_time", { ascending: true })
    .limit(1);

  if (params.excludeProgrammingId) {
    conflictQuery = conflictQuery.neq("id", params.excludeProgrammingId);
  }

  const { data: conflictRows, error: conflictError } = await conflictQuery;
  if (conflictError || !Array.isArray(conflictRows) || !conflictRows.length) {
    return null;
  }

  const conflict = conflictRows[0] as ProgrammingTimeConflictLookupRow;

  const [{ data: teamRows }, { data: projectRows }] = await Promise.all([
    params.supabase
      .from("teams")
      .select("id, name, foreman_person_id")
      .eq("tenant_id", params.tenantId)
      .eq("id", conflict.team_id)
      .limit(1),
    params.supabase
      .from("project")
      .select("id, sob")
      .eq("tenant_id", params.tenantId)
      .eq("id", conflict.project_id)
      .limit(1),
  ]);

  const team = (Array.isArray(teamRows) && teamRows.length ? teamRows[0] : null) as TeamConflictLookupRow | null;
  const project = (Array.isArray(projectRows) && projectRows.length ? projectRows[0] : null) as ProjectConflictLookupRow | null;

  let foremanName = "Nao informado";
  const foremanId = normalizeText(team?.foreman_person_id);
  if (foremanId) {
    const { data: foremanRows } = await params.supabase
      .from("people")
      .select("id, nome")
      .eq("tenant_id", params.tenantId)
      .eq("id", foremanId)
      .limit(1);

    const foreman = (Array.isArray(foremanRows) && foremanRows.length ? foremanRows[0] : null) as ForemanConflictLookupRow | null;
    foremanName = normalizeText(foreman?.nome) || "Nao informado";
  }

  const teamName = normalizeText(team?.name) || conflict.team_id;
  const projectCode = normalizeText(project?.sob) || "informada";
  const conflictInterval = `${formatTime(conflict.start_time)} - ${formatTime(conflict.end_time)}`;

  return `Conflito de horario na equipe ${teamName} (Encarregado: ${foremanName}) com a obra ${projectCode}, no intervalo ${conflictInterval}.`;
}

function isNegativeNumericLikeText(value: string | null) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return false;
  }

  return /^-\d+([.,]\d+)?$/.test(normalized);
}

function getInvalidRequestedDateLabel(
  documents: SaveProgrammingPayload["documents"] | BatchCreateProgrammingPayload["documents"] | undefined,
) {
  const entries: Array<{ key: "sgd" | "pi" | "pep"; label: string }> = [
    { key: "sgd", label: "SGD" },
    { key: "pi", label: "PI" },
    { key: "pep", label: "PEP" },
  ];

  for (const entry of entries) {
    const approvedAt = normalizeIsoDate(documents?.[entry.key]?.approvedAt ?? documents?.[entry.key]?.includedAt);
    const requestedAt = normalizeIsoDate(documents?.[entry.key]?.requestedAt ?? documents?.[entry.key]?.deliveredAt);
    if (approvedAt && requestedAt && requestedAt > approvedAt) {
      return entry.label;
    }
  }

  return null;
}

function normalizeNullableText(value: unknown) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizeBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return null;
  }

  if (["true", "1", "sim", "yes"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "nao", "não", "no"].includes(normalized)) {
    return false;
  }

  return null;
}

function normalizeElectricalEqNumber(value: unknown) {
  const normalized = normalizeText(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!normalized) {
    return null;
  }

  return /^[A-Z0-9]+$/.test(normalized) ? normalized : null;
}

function normalizeSgdNumber(value: unknown) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  const segments = normalized
    .split("/")
    .map((segment) => normalizeText(segment))
    .filter(Boolean);

  if (!segments.length) {
    return null;
  }

  return segments.join(" / ");
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
  return normalized || null;
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
    campo_eletrico: normalizeNullableText(row.campo_eletrico),
    service_description: normalizeNullableText(row.service_description),
    poste_qty: Number(row.poste_qty ?? 0),
    estrutura_qty: Number(row.estrutura_qty ?? 0),
    trafo_qty: Number(row.trafo_qty ?? 0),
    rede_qty: Number(row.rede_qty ?? 0),
    etapa_number: row.etapa_number === null || row.etapa_number === undefined ? null : Number(row.etapa_number),
    etapa_unica: Boolean(row.etapa_unica ?? false),
    etapa_final: Boolean((row as { etapa_final?: unknown }).etapa_final ?? false),
    work_completion_status: normalizeWorkCompletionStatus(row.work_completion_status),
    affected_customers: Number(row.affected_customers ?? 0),
    sgd_type_id: normalizeNullableText(row.sgd_type_id),
    electrical_eq_catalog_id: normalizeNullableText(row.electrical_eq_catalog_id),
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

function normalizeProgrammingDocuments(
  documents: SaveProgrammingPayload["documents"] | BatchCreateProgrammingPayload["documents"] | undefined,
) {
  return {
    sgd: {
      number: normalizeSgdNumber(documents?.sgd?.number) ?? undefined,
      approvedAt: normalizeIsoDate(documents?.sgd?.approvedAt ?? documents?.sgd?.includedAt) ?? undefined,
      requestedAt: normalizeIsoDate(documents?.sgd?.requestedAt ?? documents?.sgd?.deliveredAt) ?? undefined,
    },
    pi: {
      number: normalizeNullableText(documents?.pi?.number) ?? undefined,
      approvedAt: normalizeIsoDate(documents?.pi?.approvedAt ?? documents?.pi?.includedAt) ?? undefined,
      requestedAt: normalizeIsoDate(documents?.pi?.requestedAt ?? documents?.pi?.deliveredAt) ?? undefined,
    },
    pep: {
      number: normalizeNullableText(documents?.pep?.number) ?? undefined,
      approvedAt: normalizeIsoDate(documents?.pep?.approvedAt ?? documents?.pep?.includedAt) ?? undefined,
      requestedAt: normalizeIsoDate(documents?.pep?.requestedAt ?? documents?.pep?.deliveredAt) ?? undefined,
    },
  };
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
  if (normalized === "INTEGRAL") {
    return "INTEGRAL";
  }

  if (normalized === "PARCIAL" || normalized === "PARTIAL") {
    return "PARCIAL";
  }

  return null;
}

function buildHistoryChangesWithDerivedExecutionDate(
  changes: Record<string, unknown> | null,
  metadata: Record<string, unknown> | null,
) {
  const normalizedChanges = { ...(changes ?? {}) };
  const action = normalizeText(metadata?.action).toUpperCase();

  if (action === "ADIADA" && !normalizedChanges.executionDate) {
    const fromDate = normalizeIsoDate(metadata?.executionDate);
    const toDate = normalizeIsoDate(metadata?.newExecutionDate);

    if (fromDate && toDate && fromDate !== toDate) {
      normalizedChanges.executionDate = {
        from: fromDate,
        to: toDate,
      };
    }
  }

  return normalizedChanges;
}

const BOARD_PROJECT_SELECT_WITH_TEST =
  "id, sob, execution_deadline, service_center_text, service_type_text, city_text, priority_text, partner_text, utility_responsible_text, utility_field_manager_text, street, neighborhood, service_description, observation, has_locacao, is_active, is_test";

const BOARD_PROJECT_SELECT_LEGACY =
  "id, sob, execution_deadline, service_center_text, service_type_text, city_text, priority_text, partner_text, utility_responsible_text, utility_field_manager_text, street, neighborhood, service_description, observation, has_locacao, is_active";

function isMissingProjectTestColumn(message: string) {
  return normalizeText(message).toLowerCase().includes("is_test");
}

async function fetchProjects(
  supabase: SupabaseClient,
  tenantId: string,
) {
  const primary = await supabase
    .from("project_with_labels")
    .select(BOARD_PROJECT_SELECT_WITH_TEST)
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .eq("is_test", false)
    .order("execution_deadline", { ascending: true })
    .returns<BoardProjectBaseRow[]>();

  if (!primary.error) {
    return (primary.data ?? []).map((item) => ({
      ...item,
      is_test: Boolean(item.is_test),
    })) as BoardProjectRow[];
  }

  if (!isMissingProjectTestColumn(primary.error.message ?? "")) {
    return [] as BoardProjectRow[];
  }

  const fallback = await supabase
    .from("project_with_labels")
    .select(BOARD_PROJECT_SELECT_LEGACY)
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("execution_deadline", { ascending: true })
    .returns<BoardProjectBaseRow[]>();

  if (fallback.error) {
    return [] as BoardProjectRow[];
  }

  return (fallback.data ?? []).map((item) => ({
    ...item,
    is_test: false,
  })) as BoardProjectRow[];
}

async function fetchTeams(
  supabase: SupabaseClient,
  tenantId: string,
) {
  const { data: teams, error } = await supabase
    .from("teams")
    .select("id, name, vehicle_plate, service_center_id, team_type_id, foreman_person_id, ativo")
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
    vehiclePlate: normalizeText(team.vehicle_plate),
    serviceCenterId: team.service_center_id,
    serviceCenterName: team.service_center_id ? serviceCenterMap.get(team.service_center_id) ?? "Sem base" : "Sem base",
    teamTypeName: teamTypeMap.get(team.team_type_id) ?? "Sem tipo",
    foremanName: foremanMap.get(team.foreman_person_id) ?? "Sem encarregado",
  }));
}

async function fetchTeamsByIds(
  supabase: SupabaseClient,
  tenantId: string,
  teamIds: string[],
) {
  if (!teamIds.length) {
    return [] as Array<{
      id: string;
      name: string;
      vehiclePlate: string;
      serviceCenterId: string | null;
      serviceCenterName: string;
      teamTypeName: string;
      foremanName: string;
    }>;
  }

  const { data: teams, error } = await supabase
    .from("teams")
    .select("id, name, vehicle_plate, service_center_id, team_type_id, foreman_person_id, ativo")
    .eq("tenant_id", tenantId)
    .in("id", teamIds)
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
    vehiclePlate: normalizeText(team.vehicle_plate),
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

  if (isMissingEtapaFinalColumnError(withOutageStructureAndEnelAttempt.error?.message)) {
    const withOutageStructureAndEnelLegacyEtapaFinalAttempt = await supabase
      .from("project_programming")
      .select(PROGRAMMING_SELECT_WITH_OUTAGE_STRUCTURE_AND_ENEL_LEGACY_ETAPA_FINAL)
      .eq("tenant_id", tenantId)
      .gte("execution_date", startDate)
      .lte("execution_date", endDate)
      .order("execution_date", { ascending: true })
      .order("start_time", { ascending: true })
      .returns<Array<Record<string, unknown>>>();

    if (!withOutageStructureAndEnelLegacyEtapaFinalAttempt.error) {
      return (withOutageStructureAndEnelLegacyEtapaFinalAttempt.data ?? []).map((item) =>
        normalizeProgrammingStructureFields(item),
      );
    }
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

  if (isMissingEtapaFinalColumnError(withStructureAndEnelAttempt.error?.message)) {
    const withStructureAndEnelLegacyEtapaFinalAttempt = await supabase
      .from("project_programming")
      .select(PROGRAMMING_SELECT_WITH_STRUCTURE_AND_ENEL_LEGACY_ETAPA_FINAL)
      .eq("tenant_id", tenantId)
      .gte("execution_date", startDate)
      .lte("execution_date", endDate)
      .order("execution_date", { ascending: true })
      .order("start_time", { ascending: true })
      .returns<Array<Record<string, unknown>>>();

    if (!withStructureAndEnelLegacyEtapaFinalAttempt.error) {
      return (withStructureAndEnelLegacyEtapaFinalAttempt.data ?? []).map((item) =>
        normalizeProgrammingStructureFields(item),
      );
    }
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
    return {
      activityMap: new Map<string, ProgrammingActivityRow[]>(),
      hasError: false,
    };
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
    return {
      activityMap: new Map<string, ProgrammingActivityRow[]>(),
      hasError: true,
    };
  }

  const activityMap = new Map<string, ProgrammingActivityRow[]>();
  for (const item of data ?? []) {
    const current = activityMap.get(item.programming_id) ?? [];
    current.push(item);
    activityMap.set(item.programming_id, current);
  }

  return {
    activityMap,
    hasError: false,
  };
}

async function fetchProgrammingActivitiesForSave(params: {
  supabase: SupabaseClient;
  tenantId: string;
  programmingId: string;
}) {
  const { data, error } = await params.supabase
    .from("project_programming_activities")
    .select("service_activity_id, quantity")
    .eq("tenant_id", params.tenantId)
    .eq("programming_id", params.programmingId)
    .eq("is_active", true)
    .returns<Array<{ service_activity_id: string; quantity: number }>>();

  if (error) {
    return null;
  }

  return (data ?? [])
    .map((item) => ({
      catalogId: normalizeText(item.service_activity_id),
      quantity: normalizePositiveNumber(item.quantity),
    }))
    .filter((item): item is { catalogId: string; quantity: number } => Boolean(item.catalogId) && item.quantity !== null);
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
    .from("project_programming_history")
    .select("id, programming_id, created_by, reason, changes, metadata, created_at, action_type")
    .eq("tenant_id", tenantId)
    .eq("action_type", "RESCHEDULE")
    .in("programming_id", programmingIds)
    .order("created_at", { ascending: false })
    .returns<Array<ProgrammingOperationalHistoryRow & { action_type: string }>>();

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

  const normalizedData: ProgrammingHistoryRow[] = (data ?? []).map((item) => ({
    id: item.id,
    entity_id: item.programming_id,
    created_by: item.created_by ?? null,
    changed_by_name: "",
    reason: item.reason,
    changes: item.changes,
    metadata: {
      ...(item.metadata ?? {}),
      action: normalizeText(item.action_type) || normalizeText(item.metadata?.action),
    },
    created_at: item.created_at,
  }));

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

  for (const item of normalizedData) {
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
    .from("project_programming_history")
    .select("id, programming_id, created_by, reason, changes, metadata, created_at, action_type")
    .eq("tenant_id", tenantId)
    .eq("programming_id", programmingId)
    .order("created_at", { ascending: false })
    .returns<Array<ProgrammingOperationalHistoryRow & { action_type: string }>>();

  if (error) {
    return [] as ProgrammingHistoryRow[];
  }

  const historyRows = data ?? [];
  const historyAuthorIds = Array.from(
    new Set(historyRows.map((item) => item.created_by).filter((value): value is string => Boolean(value))),
  );

  let historyUsers: AppUserLookupRow[] = [];
  if (historyAuthorIds.length > 0) {
    const usersResult = await supabase
      .from("app_users")
      .select("id, display, login_name")
      .eq("tenant_id", tenantId)
      .in("id", historyAuthorIds)
      .returns<AppUserLookupRow[]>();

    if (!usersResult.error) {
      historyUsers = usersResult.data ?? [];
    }
  }

  const historyUserMap = new Map(historyUsers.map((item) => [item.id, item]));

  return historyRows.map((item) => ({
    id: item.id,
    entity_id: item.programming_id,
    created_by: item.created_by ?? null,
    changed_by_name: resolveAppUserName(historyUserMap.get(item.created_by ?? "")),
    reason: item.reason,
    changes: item.changes,
    metadata: {
      ...(item.metadata ?? {}),
      action: normalizeText(item.action_type) || normalizeText(item.metadata?.action),
    },
    created_at: item.created_at,
  }));
}

async function fetchNextProgrammingStage(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  teamIds: string[],
  executionDate: string,
) {
  if (!projectId || !teamIds.length || !executionDate) {
    return 1;
  }

  const { data, error } = await supabase
    .from("project_programming")
    .select("etapa_number")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .in("team_id", teamIds)
    .lt("execution_date", executionDate)
    .not("etapa_number", "is", null)
    .order("etapa_number", { ascending: false })
    .limit(1)
    .returns<Array<{ etapa_number: number | null }>>();

  if (error) {
    return 1;
  }

  const highestStage = Number(data?.[0]?.etapa_number ?? 0);
  if (!Number.isFinite(highestStage) || highestStage < 1) {
    return 1;
  }

  return highestStage + 1;
}

async function fetchProgrammingStageValidation(params: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  teamIds: string[];
  enteredEtapaNumber: number;
  excludeProgrammingId?: string | null;
  currentEditingStage?: number | null;
  currentEditingDate?: string | null;
  currentEditingTeamId?: string | null;
}) {
  const { data, error } = await params.supabase
    .from("project_programming")
    .select("id, team_id, etapa_number, execution_date")
    .eq("tenant_id", params.tenantId)
    .eq("project_id", params.projectId)
    .in("team_id", params.teamIds)
    .not("etapa_number", "is", null)
    .returns<Array<{ id: string; team_id: string; etapa_number: number | null; execution_date: string }>>();

  if (error) {
    return [];
  }

  const relevantRows = (data ?? []).filter((item) => {
    if (!item.etapa_number || item.etapa_number < 1) {
      return false;
    }

    if (params.excludeProgrammingId && item.id === params.excludeProgrammingId) {
      return false;
    }

    return item.etapa_number >= params.enteredEtapaNumber;
  });

  const relevantTeamIds = new Set(relevantRows.map((item) => item.team_id));
  if (
    params.currentEditingTeamId
    && params.currentEditingStage
    && params.currentEditingStage > params.enteredEtapaNumber
  ) {
    relevantTeamIds.add(params.currentEditingTeamId);
  }

  if (!relevantRows.length && !relevantTeamIds.size) {
    return [];
  }

  const uniqueTeamIds = Array.from(relevantTeamIds);
  const { data: teamRows } = await params.supabase
    .from("teams")
    .select("id, name")
    .eq("tenant_id", params.tenantId)
    .in("id", uniqueTeamIds)
    .returns<Array<{ id: string; name: string }>>();

  const teamNameMap = new Map((teamRows ?? []).map((item) => [item.id, normalizeText(item.name)]));

  return uniqueTeamIds
    .map((teamId) => {
      const teamItems = relevantRows.filter((item) => item.team_id === teamId);
      let existingStages = Array.from(
        new Set(
          teamItems
            .map((item) => Number(item.etapa_number ?? 0))
            .filter((stage) => Number.isFinite(stage) && stage >= params.enteredEtapaNumber),
        ),
      ).sort((left, right) => left - right);

      let existingDates = Array.from(new Set(teamItems.map((item) => item.execution_date))).sort();

      if (
        params.currentEditingTeamId === teamId
        && params.currentEditingStage
        && params.currentEditingStage > params.enteredEtapaNumber
      ) {
        if (!existingStages.includes(params.currentEditingStage)) {
          existingStages = [...existingStages, params.currentEditingStage].sort((left, right) => left - right);
        }

        if (params.currentEditingDate && !existingDates.includes(params.currentEditingDate)) {
          existingDates = [...existingDates, params.currentEditingDate].sort();
        }
      }

      const highestStage = existingStages.length ? Math.max(...existingStages) : 0;

      return {
        teamId,
        teamName: teamNameMap.get(teamId) ?? teamId,
        highestStage,
        existingStages,
        existingDates,
      } satisfies ProgrammingStageValidationTeamSummary;
    })
    .filter((item) => item.existingStages.length > 0)
    .sort((left, right) => left.teamName.localeCompare(right.teamName));
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

async function fetchProgrammingEqCatalog(
  supabase: SupabaseClient,
  tenantId: string,
) {
  const { data, error } = await supabase
    .from("programming_eq_catalog")
    .select("id, code, label_pt, is_active, sort_order")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("label_pt", { ascending: true })
    .returns<ProgrammingEqCatalogRow[]>();

  if (error) {
    return [] as ProgrammingEqCatalogRow[];
  }

  return data ?? [];
}

async function fetchProgrammingReasonCatalog(
  supabase: SupabaseClient,
  tenantId: string,
) {
  const { data, error } = await supabase
    .from("programming_reason_catalog")
    .select("code, label_pt, requires_notes, is_active, sort_order")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("label_pt", { ascending: true })
    .returns<ProgrammingReasonCatalogRow[]>();

  if (error) {
    return [] as ProgrammingReasonCatalogRow[];
  }

  return data ?? [];
}

async function fetchProgrammingWorkCompletionCatalog(
  supabase: SupabaseClient,
  tenantId: string,
) {
  const { data, error } = await supabase
    .from("programming_work_completion_catalog")
    .select("id, code, label_pt, is_active, sort_order")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("label_pt", { ascending: true })
    .returns<ProgrammingWorkCompletionCatalogRow[]>();

  if (error) {
    return [] as ProgrammingWorkCompletionCatalogRow[];
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

async function fetchProgrammingConflictPayload(params: {
  supabase: SupabaseClient;
  tenantId: string;
  programmingId: string;
  requested?: {
    executionDate?: string | null;
    teamId?: string | null;
    startTime?: string | null;
    endTime?: string | null;
    status?: string | null;
  };
}) {
  const { data: currentRow, error } = await params.supabase
    .from("project_programming")
    .select("id, project_id, team_id, status, execution_date, start_time, end_time, updated_at, updated_by")
    .eq("tenant_id", params.tenantId)
    .eq("id", params.programmingId)
    .maybeSingle<{
      id: string;
      project_id: string;
      team_id: string;
      status: string;
      execution_date: string;
      start_time: string;
      end_time: string;
      updated_at: string;
      updated_by: string | null;
    }>();

  if (error || !currentRow) {
    return null;
  }

  let updatedBy: string | null = null;
  if (currentRow.updated_by) {
    const { data: actor } = await params.supabase
      .from("app_users")
      .select("login_name, email, matricula")
      .eq("tenant_id", params.tenantId)
      .eq("id", currentRow.updated_by)
      .maybeSingle<{ login_name: string | null; email: string | null; matricula: string | null }>();

    updatedBy =
      normalizeText(actor?.login_name)
      || normalizeText(actor?.email)
      || normalizeText(actor?.matricula)
      || null;
  }

  const changedFields: string[] = [];
  const requested = params.requested ?? {};
  if (requested.executionDate && requested.executionDate !== currentRow.execution_date) {
    changedFields.push("executionDate");
  }
  if (requested.teamId && requested.teamId !== currentRow.team_id) {
    changedFields.push("teamId");
  }
  if (requested.startTime && requested.startTime !== formatTime(currentRow.start_time)) {
    changedFields.push("startTime");
  }
  if (requested.endTime && requested.endTime !== formatTime(currentRow.end_time)) {
    changedFields.push("endTime");
  }
  if (requested.status && requested.status !== currentRow.status) {
    changedFields.push("status");
  }

  return {
    error: "conflict" as const,
    message: "Esta programacao foi alterada por outro usuario.",
    currentRecord: {
      id: currentRow.id,
      projectId: currentRow.project_id,
      teamId: currentRow.team_id,
      status: currentRow.status,
      executionDate: currentRow.execution_date,
      startTime: formatTime(currentRow.start_time),
      endTime: formatTime(currentRow.end_time),
      updatedAt: currentRow.updated_at,
    },
    currentUpdatedAt: currentRow.updated_at,
    updatedBy,
    changedFields,
  } satisfies ProgrammingConflictPayload;
}

async function fetchProgrammingResponseItem(
  supabase: SupabaseClient,
  tenantId: string,
  programmingId: string,
) {
  const row = await fetchProgrammingById(supabase, tenantId, programmingId);
  if (!row) {
    return null;
  }

  const [activitiesMap, projectRows, sgdTypes, eqCatalog, rescheduleHistoryMap, teamRows] = await Promise.all([
    fetchProgrammingActivities(supabase, tenantId, [programmingId]),
    supabase
      .from("project_with_labels")
      .select("id, service_center_text")
      .eq("tenant_id", tenantId)
      .eq("id", row.project_id)
      .returns<Array<{ id: string; service_center_text: string | null }>>(),
    fetchProgrammingSgdTypes(supabase, tenantId),
    fetchProgrammingEqCatalog(supabase, tenantId),
    fetchRescheduledProgrammingIds(supabase, tenantId, [programmingId]),
    fetchTeamsByIds(supabase, tenantId, [row.team_id]),
  ]);

  const projectBase =
    normalizeText(projectRows.data?.[0]?.service_center_text) || "Sem base";
  const sgdType = row.sgd_type_id ? sgdTypes.find((item) => item.id === row.sgd_type_id) ?? null : null;
  const eqType = row.electrical_eq_catalog_id
    ? eqCatalog.find((item) => item.id === row.electrical_eq_catalog_id) ?? null
    : null;
  const team = teamRows[0] ?? null;
  const scheduleActivities = activitiesMap.activityMap.get(programmingId) ?? [];

  return {
    id: row.id,
    projectId: row.project_id,
    teamId: row.team_id,
    status: row.status,
    isReprogrammed: row.status === "REPROGRAMADA",
    date: row.execution_date,
    period: row.period === "INTEGRAL" ? "integral" : "partial",
    startTime: formatTime(row.start_time),
    endTime: formatTime(row.end_time),
    outageStartTime: formatTime(row.outage_start_time),
    outageEndTime: formatTime(row.outage_end_time),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expectedMinutes: Number(row.expected_minutes ?? 0),
    posteQty: Number(row.poste_qty ?? 0),
    estruturaQty: Number(row.estrutura_qty ?? 0),
    trafoQty: Number(row.trafo_qty ?? 0),
    redeQty: Number(row.rede_qty ?? 0),
    etapaNumber: row.etapa_number === null ? null : Number(row.etapa_number),
    etapaUnica: Boolean(row.etapa_unica ?? false),
    etapaFinal: Boolean(row.etapa_final ?? false),
    workCompletionStatus: normalizeWorkCompletionStatus(row.work_completion_status),
    affectedCustomers: Number(row.affected_customers ?? 0),
    sgdTypeId: row.sgd_type_id,
    electricalEqCatalogId: row.electrical_eq_catalog_id,
    electricalEqCode: normalizeText(eqType?.code),
    sgdTypeDescription: normalizeText(sgdType?.description),
    sgdExportColumn: normalizeText(sgdType?.export_column),
    feeder: normalizeText(row.feeder),
    support: normalizeText(row.support),
    supportItemId: row.support_item_id,
    note: normalizeText(row.note),
    electricalField: normalizeText(row.campo_eletrico),
    serviceDescription: normalizeText(row.service_description),
    activitiesLoaded: !activitiesMap.hasError,
    teamName: normalizeText(team?.name) || row.team_id,
    teamVehiclePlate: normalizeText(team?.vehiclePlate),
    teamServiceCenterName: normalizeText(team?.serviceCenterName),
    teamTypeName: normalizeText(team?.teamTypeName),
    teamForemanName: normalizeText(team?.foremanName),
    projectBase,
    statusReason: normalizeText(row.cancellation_reason),
    statusChangedAt: row.canceled_at ?? "",
    wasRescheduled: row.status === "REPROGRAMADA" || rescheduleHistoryMap.has(row.id),
    lastReschedule: rescheduleHistoryMap.get(row.id)
      ? {
          id: rescheduleHistoryMap.get(row.id)?.historyId ?? "",
          changedAt: rescheduleHistoryMap.get(row.id)?.changedAt ?? "",
          reason: rescheduleHistoryMap.get(row.id)?.reason ?? "",
          fromDate: rescheduleHistoryMap.get(row.id)?.fromDate ?? "",
          toDate: rescheduleHistoryMap.get(row.id)?.toDate ?? "",
        }
      : null,
    activities: scheduleActivities.map((activity) => ({
      id: activity.id,
      catalogId: activity.service_activity_id,
      code: normalizeText(activity.activity_code),
      description: normalizeText(activity.activity_description),
      quantity: Number(activity.quantity ?? 0),
      unit: normalizeText(activity.activity_unit),
    })),
    documents: {
      sgd: {
        number: normalizeSgdNumber(row.sgd_number) ?? "",
        approvedAt: row.sgd_included_at ?? "",
        requestedAt: row.sgd_delivered_at ?? "",
        includedAt: row.sgd_included_at ?? "",
        deliveredAt: row.sgd_delivered_at ?? "",
      },
      pi: {
        number: normalizeText(row.pi_number),
        approvedAt: row.pi_included_at ?? "",
        requestedAt: row.pi_delivered_at ?? "",
        includedAt: row.pi_included_at ?? "",
        deliveredAt: row.pi_delivered_at ?? "",
      },
      pep: {
        number: normalizeText(row.pep_number),
        approvedAt: row.pep_included_at ?? "",
        requestedAt: row.pep_delivered_at ?? "",
        includedAt: row.pep_included_at ?? "",
        deliveredAt: row.pep_delivered_at ?? "",
      },
    },
  };
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
  electricalField: string | null;
  serviceDescription?: string | null;
  posteQty: number;
  estruturaQty: number;
  trafoQty: number;
  redeQty: number;
  etapaNumber: number | null;
  etapaUnica: boolean;
  etapaFinal: boolean;
  workCompletionStatus: string | null;
  affectedCustomers: number;
  sgdTypeId: string;
  electricalEqCatalogId: string | null;
  documents: NonNullable<SaveProgrammingPayload["documents"]>;
  activities: Array<{ catalogId: string; quantity: number }>;
  expectedUpdatedAt?: string | null;
  historyActionOverride?: string | null;
  historyReason?: string | null;
  historyMetadata?: Record<string, unknown> | null;
}) {
  const rpcName = "save_project_programming_full_with_electrical_and_eq";
  const rpcPayload = {
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
    p_history_action_override: params.historyActionOverride ?? null,
    p_history_reason: params.historyReason ?? null,
    p_history_metadata: params.historyMetadata ?? {},
    p_campo_eletrico: params.electricalField ?? null,
    p_electrical_eq_catalog_id: params.electricalEqCatalogId ?? null,
    p_etapa_unica: params.etapaUnica,
    p_etapa_final: params.etapaFinal,
  };

  let { data, error } = await params.supabase.rpc(rpcName, rpcPayload);
  let usedEmbeddedEtapaFlags = true;

  if (error) {
    if (isMissingRpcFunctionError(error.message, rpcName)) {
      const legacyPayload = {
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
        p_history_action_override: params.historyActionOverride ?? null,
        p_history_reason: params.historyReason ?? null,
        p_history_metadata: params.historyMetadata ?? {},
        p_campo_eletrico: params.electricalField ?? null,
        p_electrical_eq_catalog_id: params.electricalEqCatalogId ?? null,
      };

      const legacyAttempt = await params.supabase.rpc(rpcName, legacyPayload);
      data = legacyAttempt.data;
      error = legacyAttempt.error;
      usedEmbeddedEtapaFlags = false;

      if (error && isMissingRpcFunctionError(error.message, rpcName)) {
        return {
          ok: false,
          status: 409,
          reason: "FULL_RPC_NOT_AVAILABLE",
          message: "RPC transacional full da Programacao indisponivel no ambiente atual.",
        } as const;
      }
    }
  }

  if (error) {
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
    flagsEmbedded: usedEmbeddedEtapaFlags,
    action: result.action ?? null,
    programmingId: result.programming_id,
    projectCode: normalizeText(result.project_code),
    updatedAt: normalizeText(result.updated_at),
    message: result.message ?? "Programacao salva com sucesso.",
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
  electricalField: string | null;
  serviceDescription?: string | null;
  posteQty: number;
  estruturaQty: number;
  trafoQty: number;
  redeQty: number;
  etapaNumber: number | null;
  etapaUnica: boolean;
  etapaFinal: boolean;
  workCompletionStatus: string | null;
  affectedCustomers: number;
  sgdTypeId: string;
  electricalEqCatalogId: string | null;
  documents: NonNullable<BatchCreateProgrammingPayload["documents"]>;
  activities: Array<{ catalogId: string; quantity: number }>;
}) {
  const rpcName = "save_project_programming_batch_full_with_electrical_and_eq";
  const rpcPayload = {
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
    p_campo_eletrico: params.electricalField ?? null,
    p_electrical_eq_catalog_id: params.electricalEqCatalogId ?? null,
    p_etapa_unica: params.etapaUnica,
    p_etapa_final: params.etapaFinal,
  };

  let { data, error } = await params.supabase.rpc(rpcName, rpcPayload);
  let usedEmbeddedEtapaFlags = true;

  if (error) {
    if (isMissingRpcFunctionError(error.message, rpcName)) {
      const legacyPayload = {
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
        p_campo_eletrico: params.electricalField ?? null,
        p_electrical_eq_catalog_id: params.electricalEqCatalogId ?? null,
      };

      const legacyAttempt = await params.supabase.rpc(rpcName, legacyPayload);
      data = legacyAttempt.data;
      error = legacyAttempt.error;
      usedEmbeddedEtapaFlags = false;

      if (error && isMissingRpcFunctionError(error.message, rpcName)) {
        return {
          ok: false,
          status: 409,
          reason: "FULL_RPC_NOT_AVAILABLE",
          message: "RPC transacional full de lote da Programacao indisponivel no ambiente atual.",
        } as const;
      }
    }
  }

  if (error) {
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
    flagsEmbedded: usedEmbeddedEtapaFlags,
    insertedCount: Number(result.inserted_count ?? items.length),
    projectCode: normalizeText(result.project_code),
    message: result.message ?? "Programacao em lote salva com sucesso.",
    items,
  } as const;
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

async function resolveProgrammingWorkCompletionStatus(params: {
  supabase: SupabaseClient;
  tenantId: string;
  workCompletionStatus: string;
}) {
  const { data, error } = await params.supabase
    .from("programming_work_completion_catalog")
    .select("code, label_pt, is_active")
    .eq("tenant_id", params.tenantId)
    .eq("code", params.workCompletionStatus)
    .eq("is_active", true)
    .maybeSingle<{ code: string; label_pt: string; is_active: boolean }>();

  if (error || !data) {
    return null;
  }

  return data;
}

async function resolveProgrammingEqCatalog(params: {
  supabase: SupabaseClient;
  tenantId: string;
  electricalEqCatalogId: string;
}) {
  const { data, error } = await params.supabase
    .from("programming_eq_catalog")
    .select("id, code, label_pt, is_active, sort_order")
    .eq("tenant_id", params.tenantId)
    .eq("id", params.electricalEqCatalogId)
    .eq("is_active", true)
    .maybeSingle<ProgrammingEqCatalogRow>();

  if (error || !data) {
    return null;
  }

  return data;
}

// Legacy compatibility helper kept for staged rollback support in partially migrated environments.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
          "Seu ambiente ainda nao suporta os campos ENEL obrigatorios (Tipo de SGD e NÂº Clientes Afetados). Aplique a migration 089 e tente novamente.",
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

// Legacy compatibility helper kept for staged rollback support in partially migrated environments.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function setProgrammingExecutionResultViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  programmingId: string;
  etapaNumber: number | null;
  workCompletionStatus: string | null;
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

async function setProgrammingEtapaFlagsValue(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  programmingIds: string[];
  etapaUnica: boolean;
  etapaFinal: boolean;
}) {
  if (!params.programmingIds.length) {
    return { ok: true } as const;
  }

  const { error } = await params.supabase
    .from("project_programming")
    .update({
      etapa_unica: params.etapaUnica,
      etapa_final: params.etapaFinal,
      updated_by: params.actorUserId,
    })
    .eq("tenant_id", params.tenantId)
    .in("id", params.programmingIds);

  if (error) {
    if (normalizeText(error.message).toLowerCase().includes("etapa_final")) {
      return {
        ok: false,
        status: 409,
        message: "Programacao salva, mas o ambiente ainda nao suporta ETAPA FINAL. Aplique a migration 156 e tente novamente.",
      } as const;
    }

    return {
      ok: false,
      status: 500,
      message: "Programacao salva, mas houve falha ao salvar os campos ETAPA.",
    } as const;
  }

  return { ok: true } as const;
}

// Legacy compatibility helper kept for staged rollback support in partially migrated environments.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function setProgrammingElectricalFieldViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  programmingId: string;
  electricalField: string;
  historyAction?: string | null;
  historyReason?: string | null;
  historyMetadata?: Record<string, unknown> | null;
}) {
  const { data, error } = await params.supabase.rpc("set_project_programming_campo_eletrico", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_programming_id: params.programmingId,
    p_campo_eletrico: params.electricalField,
    p_history_action: params.historyAction ?? null,
    p_history_reason: params.historyReason ?? null,
    p_history_metadata: params.historyMetadata ?? {},
  });

  if (error) {
    const isMissingRpc = isMissingRpcFunctionError(error.message, "set_project_programming_campo_eletrico");

    if (isMissingRpc) {
      return {
        ok: false,
        status: 409,
        reason: "ELECTRICAL_FIELD_RPC_NOT_AVAILABLE",
        message:
          "Seu ambiente ainda nao suporta o campo Ponto eletrico da Programacao. Aplique a migration 110 e tente novamente.",
      } as const;
    }

    return {
      ok: false,
      status: 500,
      reason: "ELECTRICAL_FIELD_RPC_FAILED",
      message: error.message
        ? `Falha ao salvar Ponto eletrico da programacao: ${error.message}`
        : "Falha ao salvar Ponto eletrico da programacao.",
    } as const;
  }

  const result = (data ?? {}) as { success?: boolean; status?: number; message?: string; reason?: string };
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 400),
      reason: result.reason ?? "ELECTRICAL_FIELD_SAVE_FAILED",
      message: result.message ?? "Falha ao salvar Ponto eletrico da programacao.",
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
    const fallbackMessage = result.detail
      ? `Falha ao adiar programacao: ${result.detail}`
      : result.message ?? "Falha ao adiar programacao.";

    return {
      ok: false,
      status: Number(result.status ?? 400),
      message: fallbackMessage,
      reason: result.reason ?? null,
      detail: result.detail ?? null,
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
          changedByName: item.changed_by_name,
          reason: normalizeText(item.reason),
          action: normalizeText(item.metadata?.action),
          changes: buildHistoryChangesWithDerivedExecutionDate(item.changes ?? {}, item.metadata ?? {}),
          metadata: item.metadata ?? {},
        })),
      } satisfies ProgrammingHistoryListResponse);
    }

    const nextEtapaProjectId = normalizeText(request.nextUrl.searchParams.get("nextEtapaProjectId"));
    if (nextEtapaProjectId) {
      const nextEtapaDate = normalizeIsoDate(request.nextUrl.searchParams.get("nextEtapaDate"));
      const nextEtapaTeamIds = normalizeText(request.nextUrl.searchParams.get("nextEtapaTeamIds"))
        .split(",")
        .map((item) => normalizeText(item))
        .filter(Boolean);

      if (!nextEtapaDate || !nextEtapaTeamIds.length) {
        return NextResponse.json(
          { message: "Informe projeto, data de execucao e ao menos uma equipe para calcular a proxima etapa." },
          { status: 400 },
        );
      }

      const nextEtapaNumber = await fetchNextProgrammingStage(
        resolution.supabase,
        resolution.appUser.tenant_id,
        nextEtapaProjectId,
        nextEtapaTeamIds,
        nextEtapaDate,
      );

      return NextResponse.json({
        nextEtapaNumber,
        message: "Proxima etapa calculada com sucesso.",
      });
    }

    const etapaValidationProjectId = normalizeText(request.nextUrl.searchParams.get("etapaValidationProjectId"));
    if (etapaValidationProjectId) {
      const etapaValidationTeamIds = normalizeText(request.nextUrl.searchParams.get("etapaValidationTeamIds"))
        .split(",")
        .map((item) => normalizeText(item))
        .filter(Boolean);
      const etapaValidationNumber = normalizePositiveInteger(
        request.nextUrl.searchParams.get("etapaValidationNumber"),
      );
      const etapaValidationExcludeProgrammingId = normalizeNullableText(
        request.nextUrl.searchParams.get("etapaValidationExcludeProgrammingId"),
      );
      const etapaValidationCurrentStage = normalizePositiveInteger(
        request.nextUrl.searchParams.get("etapaValidationCurrentStage"),
      );
      const etapaValidationCurrentDate = normalizeIsoDate(
        request.nextUrl.searchParams.get("etapaValidationCurrentDate"),
      );
      const etapaValidationCurrentTeamId = normalizeNullableText(
        request.nextUrl.searchParams.get("etapaValidationCurrentTeamId"),
      );

      if (!etapaValidationTeamIds.length || etapaValidationNumber === null) {
        return NextResponse.json(
          { message: "Informe projeto, equipes e etapa valida para validar o historico da programacao." },
          { status: 400 },
        );
      }

      const teamSummaries = await fetchProgrammingStageValidation({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        projectId: etapaValidationProjectId,
        teamIds: etapaValidationTeamIds,
        enteredEtapaNumber: etapaValidationNumber,
        excludeProgrammingId: etapaValidationExcludeProgrammingId,
        currentEditingStage: etapaValidationCurrentStage,
        currentEditingDate: etapaValidationCurrentDate,
        currentEditingTeamId: etapaValidationCurrentTeamId,
      });

      const highestStage = teamSummaries.reduce(
        (current, item) => Math.max(current, item.highestStage),
        0,
      );

      return NextResponse.json({
        enteredEtapaNumber: etapaValidationNumber,
        hasConflict: teamSummaries.length > 0,
        highestStage,
        teams: teamSummaries,
        message: teamSummaries.length
          ? "Ja existem etapas iguais ou maiores para este projeto nas equipes selecionadas."
          : "Nenhum conflito de etapa encontrado para as equipes selecionadas.",
      } satisfies ProgrammingStageValidationResponse);
    }

    const startDate = normalizeIsoDate(request.nextUrl.searchParams.get("startDate"));
    const endDate = normalizeIsoDate(request.nextUrl.searchParams.get("endDate"));

    if (!startDate || !endDate) {
      return NextResponse.json({ message: "startDate e endDate sao obrigatorios." }, { status: 400 });
    }

    const weekStart = startOfWeekMonday(startDate);
    const [projects, teams, programmingRows, supportOptions, teamSummaries, sgdTypes, reasonOptions, eqCatalog, workCompletionCatalog] = await Promise.all([
      fetchProjects(resolution.supabase, resolution.appUser.tenant_id),
      fetchTeams(resolution.supabase, resolution.appUser.tenant_id),
      fetchProgrammingRows(resolution.supabase, resolution.appUser.tenant_id, startDate, endDate),
      fetchSupportOptions(resolution.supabase, resolution.appUser.tenant_id),
      fetchProgrammingWeekSummary(resolution.supabase, resolution.appUser.tenant_id, weekStart),
      fetchProgrammingSgdTypes(resolution.supabase, resolution.appUser.tenant_id),
      fetchProgrammingReasonCatalog(resolution.supabase, resolution.appUser.tenant_id),
      fetchProgrammingEqCatalog(resolution.supabase, resolution.appUser.tenant_id),
      fetchProgrammingWorkCompletionCatalog(resolution.supabase, resolution.appUser.tenant_id),
    ]);

    const activeTeamIds = new Set(teams.map((item) => item.id));
    const missingScheduledTeamIds = Array.from(
      new Set(
        programmingRows
          .map((item) => item.team_id)
          .filter((teamId) => !activeTeamIds.has(teamId)),
      ),
    );
    const extraTeamsForSchedules = await fetchTeamsByIds(
      resolution.supabase,
      resolution.appUser.tenant_id,
      missingScheduledTeamIds,
    );
    const teamLookupMap = new Map(
      [...teams, ...extraTeamsForSchedules].map((item) => [item.id, item]),
    );

    const projectMap = new Map(projects.map((item) => [item.id, item]));
    const filteredProgrammingRows = programmingRows.filter((item) => projectMap.has(item.project_id));
    const sgdTypeMap = new Map(sgdTypes.map((item) => [item.id, item]));
    const eqCatalogMap = new Map(eqCatalog.map((item) => [item.id, item]));
    const supportDefaults = await fetchProjectSupportDefaults({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      projectIds: projects.map((item) => item.id),
      supportOptions,
    });
    const activitiesResult = await fetchProgrammingActivities(
      resolution.supabase,
      resolution.appUser.tenant_id,
      filteredProgrammingRows.map((item) => item.id),
    );
    const programmingIds = filteredProgrammingRows.map((item) => item.id);
    const [rescheduleHistoryMap] = await Promise.all([
      fetchRescheduledProgrammingIds(
        resolution.supabase,
        resolution.appUser.tenant_id,
        programmingIds,
      ),
    ]);
    const programmingUserIds = Array.from(
      new Set(
        filteredProgrammingRows
          .flatMap((item) => [item.created_by, item.updated_by])
          .filter((value): value is string => Boolean(value)),
      ),
    );

    let programmingUsers: AppUserLookupRow[] = [];
    if (programmingUserIds.length > 0) {
      const usersResult = await resolution.supabase
        .from("app_users")
        .select("id, display, login_name")
        .eq("tenant_id", resolution.appUser.tenant_id)
        .in("id", programmingUserIds)
        .returns<AppUserLookupRow[]>();

      if (!usersResult.error) {
        programmingUsers = usersResult.data ?? [];
      }
    }

    const programmingUserMap = new Map(programmingUsers.map((item) => [item.id, item]));

    return NextResponse.json({
      projects: projects.map((item) => ({
          id: item.id,
          code: normalizeText(item.sob),
          executionDeadline: item.execution_deadline,
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
      electricalEqCatalog: eqCatalog.map((item) => ({
        id: item.id,
        code: normalizeText(item.code),
        label: normalizeText(item.label_pt) || normalizeText(item.code),
      })),
      reasonOptions: reasonOptions.map((item) => ({
        code: normalizeText(item.code),
        label: normalizeText(item.label_pt),
        requiresNotes: Boolean(item.requires_notes),
      })),
      workCompletionCatalog: workCompletionCatalog.map((item) => ({
        code: normalizeText(item.code),
        label: normalizeText(item.label_pt) || normalizeText(item.code),
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
      activitiesLoadError: activitiesResult.hasError,
      schedules: filteredProgrammingRows.map((item) => {
        const project = projectMap.get(item.project_id);
        const sgdType = item.sgd_type_id ? sgdTypeMap.get(item.sgd_type_id) : null;
        const eqCatalog = item.electrical_eq_catalog_id ? eqCatalogMap.get(item.electrical_eq_catalog_id) : null;
        const team = teamLookupMap.get(item.team_id);
        const scheduleActivities = activitiesResult.activityMap.get(item.id) ?? [];

        return {
          id: item.id,
          projectId: item.project_id,
          teamId: item.team_id,
          status: item.status,
          isReprogrammed: item.status === "REPROGRAMADA",
          date: item.execution_date,
          period: item.period === "INTEGRAL" ? "integral" : "partial",
          startTime: formatTime(item.start_time),
          endTime: formatTime(item.end_time),
          outageStartTime: formatTime(item.outage_start_time),
          outageEndTime: formatTime(item.outage_end_time),
          createdAt: item.created_at,
          updatedAt: item.updated_at,
          createdByName: resolveAppUserName(programmingUserMap.get(item.created_by ?? "")),
          updatedByName: resolveAppUserName(programmingUserMap.get(item.updated_by ?? "")),
          expectedMinutes: Number(item.expected_minutes ?? 0),
          posteQty: Number(item.poste_qty ?? 0),
          estruturaQty: Number(item.estrutura_qty ?? 0),
          trafoQty: Number(item.trafo_qty ?? 0),
          redeQty: Number(item.rede_qty ?? 0),
          etapaNumber: item.etapa_number === null ? null : Number(item.etapa_number),
          etapaUnica: Boolean(item.etapa_unica ?? false),
          etapaFinal: Boolean(item.etapa_final ?? false),
          workCompletionStatus: normalizeWorkCompletionStatus(item.work_completion_status),
          affectedCustomers: Number(item.affected_customers ?? 0),
          sgdTypeId: item.sgd_type_id,
          electricalEqCatalogId: item.electrical_eq_catalog_id,
          electricalEqCode: normalizeText(eqCatalog?.code),
          sgdTypeDescription: normalizeText(sgdType?.description),
          sgdExportColumn: normalizeText(sgdType?.export_column),
          feeder: normalizeText(item.feeder),
          support: normalizeText(item.support),
          supportItemId: item.support_item_id,
          note: normalizeText(item.note),
          electricalField: normalizeText(item.campo_eletrico),
          serviceDescription: normalizeText(item.service_description),
          activitiesLoaded: !activitiesResult.hasError,
          teamName: normalizeText(team?.name) || item.team_id,
          teamVehiclePlate: normalizeText(team?.vehiclePlate),
          teamServiceCenterName: normalizeText(team?.serviceCenterName),
          teamTypeName: normalizeText(team?.teamTypeName),
          teamForemanName: normalizeText(team?.foremanName),
          projectBase: normalizeText(project?.service_center_text) || "Sem base",
          statusReason: normalizeText(item.cancellation_reason),
          statusChangedAt: item.canceled_at ?? "",
          wasRescheduled: item.status === "REPROGRAMADA" || rescheduleHistoryMap.has(item.id),
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
            id: activity.id,
            catalogId: activity.service_activity_id,
            code: normalizeText(activity.activity_code),
            description: normalizeText(activity.activity_description),
            quantity: Number(activity.quantity ?? 0),
            unit: normalizeText(activity.activity_unit),
          })),
          documents: {
            sgd: {
              number: normalizeSgdNumber(item.sgd_number) ?? "",
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

  try {
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
    const electricalFieldRaw = normalizeNullableText(payload?.electricalField);
    const electricalField = normalizeElectricalEqNumber(payload?.electricalField);
    const serviceDescription = normalizeNullableText(payload?.serviceDescription);
    const posteQty = normalizeNonNegativeInteger(payload?.posteQty);
    const estruturaQty = normalizeNonNegativeInteger(payload?.estruturaQty);
    const trafoQty = normalizeNonNegativeInteger(payload?.trafoQty);
    const redeQty = normalizeNonNegativeInteger(payload?.redeQty);
    const etapaNumberRaw = normalizeText(payload?.etapaNumber);
    const parsedEtapaNumber = etapaNumberRaw ? normalizePositiveInteger(etapaNumberRaw) : null;
    const etapaUnica = normalizeBoolean(payload?.etapaUnica) ?? false;
    const etapaFinal = normalizeBoolean(payload?.etapaFinal) ?? false;
    const workCompletionStatusRaw = normalizeText(payload?.workCompletionStatus);
    const affectedCustomers = normalizeNonNegativeInteger(payload?.affectedCustomers);
    const sgdTypeId = normalizeNullableText(payload?.sgdTypeId);
    const electricalEqCatalogId = normalizeNullableText(payload?.electricalEqCatalogId);
    const documents = normalizeProgrammingDocuments(payload?.documents);
    const activitiesInput = Array.isArray(payload?.activities) ? payload.activities : [];
    const activities = activitiesInput
      .map((item) => ({
        catalogId: normalizeText(item.catalogId),
        quantity: normalizePositiveNumber(item.quantity),
      }))
      .filter((item): item is { catalogId: string; quantity: number } => Boolean(item.catalogId) && item.quantity !== null);

    if (!projectId) {
      return NextResponse.json({ message: "Selecione um Projeto (SOB) valido da lista." }, { status: 400 });
    }

    if (!teamIds.length) {
      return NextResponse.json({ message: "Selecione ao menos uma equipe para cadastrar a programacao." }, { status: 400 });
    }

    if (etapaUnica && etapaFinal) {
      return NextResponse.json(
        { message: "Selecione apenas uma opcao: ETAPA UNICA ou ETAPA FINAL." },
        { status: 400 },
      );
    }

    if (!executionDate) {
      return NextResponse.json({ message: "Informe a Data execucao da programacao." }, { status: 400 });
    }

    if (!period) {
      return NextResponse.json({ message: "Selecione o Periodo da programacao." }, { status: 400 });
    }

    if (!startTime) {
      return NextResponse.json({ message: "Informe a Hora inicio da programacao." }, { status: 400 });
    }

    if (!endTime) {
      return NextResponse.json({ message: "Informe a Hora termino da programacao." }, { status: 400 });
    }

    if (!expectedMinutes) {
      return NextResponse.json({ message: "Hora termino deve ser maior que hora inicio." }, { status: 400 });
    }

    if (endTime <= startTime) {
      return NextResponse.json(
        { message: "Hora termino deve ser maior que hora inicio." },
        { status: 400 },
      );
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

    const invalidRequestedDateLabel = getInvalidRequestedDateLabel(documents);
    if (invalidRequestedDateLabel) {
      return NextResponse.json(
        { message: `Data pedido do ${invalidRequestedDateLabel} nao pode ser maior que a data aprovada.` },
        { status: 400 },
      );
    }

    if (isNegativeNumericLikeText(feeder)) {
      return NextResponse.json(
        { message: "Alimentador nao pode receber valor negativo." },
        { status: 400 },
      );
    }

    if (posteQty === null || estruturaQty === null || trafoQty === null || redeQty === null) {
      return NextResponse.json(
        { message: "As quantidades de POSTE, ESTRUTURA, TRAFO e REDE devem ser inteiros maiores ou iguais a zero." },
        { status: 400 },
      );
    }

    if (!etapaUnica && !etapaFinal && !etapaNumberRaw) {
      return NextResponse.json(
        { message: "O campo ETAPA e obrigatorio." },
        { status: 400 },
      );
    }

    if (!etapaUnica && !etapaFinal && parsedEtapaNumber === null) {
      return NextResponse.json(
        { message: "O campo ETAPA deve ser um numero inteiro maior que zero." },
        { status: 400 },
      );
    }

    const etapaNumber = etapaUnica || etapaFinal ? null : parsedEtapaNumber;
    if (!etapaUnica && !etapaFinal && etapaNumber !== null) {
      const batchStageConflictSummaries = await fetchProgrammingStageValidation({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        projectId,
        teamIds,
        enteredEtapaNumber: etapaNumber,
      });

      if (batchStageConflictSummaries.length) {
        return NextResponse.json(
          {
            enteredEtapaNumber: etapaNumber,
            hasConflict: true,
            highestStage: batchStageConflictSummaries.reduce((current, item) => Math.max(current, item.highestStage), 0),
            teams: batchStageConflictSummaries,
            message: "A ETAPA informada ja existe ou esta abaixo do historico encontrado para este projeto nas equipes selecionadas.",
          } satisfies BatchCreateProgrammingResponse,
          { status: 409 },
        );
      }
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

    if (!electricalFieldRaw) {
      return NextResponse.json(
        { message: "Informe o numero do Nº EQ (RE, CO, CF, CC ou TR)." },
        { status: 400 },
      );
    }

    if (!electricalField) {
      return NextResponse.json(
        { message: "O numero do Nº EQ deve conter apenas letras e numeros." },
        { status: 400 },
      );
    }

    if (!electricalEqCatalogId) {
      return NextResponse.json(
        { message: "Selecione o tipo do Nº EQ (RE, CO, CF, CC ou TR)." },
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

    const selectedEqCatalog = await resolveProgrammingEqCatalog({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      electricalEqCatalogId,
    });

    if (!selectedEqCatalog) {
      return NextResponse.json(
        { message: "Nº EQ invalido para o tenant atual." },
        { status: 400 },
      );
    }

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
      electricalField,
      serviceDescription,
      posteQty,
      estruturaQty,
      trafoQty,
      redeQty,
      etapaNumber,
      etapaUnica,
      etapaFinal,
      workCompletionStatus: null,
      affectedCustomers: affectedCustomers ?? 0,
      sgdTypeId,
      electricalEqCatalogId,
      documents,
      activities,
    });

    if (!fullBatchSaveResult.ok) {
      if (fullBatchSaveResult.reason === "TEAM_TIME_CONFLICT") {
        const detailedConflictMessage = await resolveTeamTimeConflictDetailedMessage({
          supabase: resolution.supabase,
          tenantId: resolution.appUser.tenant_id,
          executionDate,
          startTime,
          endTime,
          teamIds,
        });

        return NextResponse.json(
          { message: detailedConflictMessage ?? fullBatchSaveResult.message },
          { status: 409 },
        );
      }

      if (fullBatchSaveResult.reason === "FULL_RPC_NOT_AVAILABLE") {
        return NextResponse.json(
          {
            message:
              "Seu ambiente ainda nao suporta o cadastro transacional completo da programacao em lote. Verifique se as RPCs base e wrappers estao atualizadas (migrations 091, 094, 095, 099, 100, 106, 111, 151, 152, 158 e 159).",
          },
          { status: 409 },
        );
      }

      if (
        (fullBatchSaveResult.reason === "BATCH_FULL_CREATE_FAILED"
          || fullBatchSaveResult.reason === "SAVE_PROGRAMMING_FULL_FAILED")
        && (
          fullBatchSaveResult.message === "Falha ao cadastrar programacao em lote."
          || fullBatchSaveResult.message === "Falha ao salvar programacao em transacao unica."
        )
      ) {
        return NextResponse.json(
          {
            message:
              "Falha ao cadastrar programacao em lote no banco. O ambiente pode estar com RPC full inconsistente. Verifique as migrations 091, 094, 095, 099, 100, 106, 111, 151, 152, 158 e 159.",
          },
          { status: 409 },
        );
      }

      return NextResponse.json({ message: fullBatchSaveResult.message }, { status: fullBatchSaveResult.status });
    }

    if (!fullBatchSaveResult.flagsEmbedded) {
      const batchProgrammingIds = fullBatchSaveResult.items.map((item) => item.programmingId);
      const etapaFlagsResult = await setProgrammingEtapaFlagsValue({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        actorUserId: resolution.appUser.id,
        programmingIds: batchProgrammingIds,
        etapaUnica,
        etapaFinal,
      });

      if (!etapaFlagsResult.ok) {
        return NextResponse.json({ message: etapaFlagsResult.message }, { status: etapaFlagsResult.status });
      }
    }

    return NextResponse.json({
      success: true,
      insertedCount: fullBatchSaveResult.insertedCount,
      message: fullBatchSaveResult.message,
    } satisfies BatchCreateProgrammingResponse);
  } catch (error) {
    console.error("saveProgrammingBatch_unhandled", error);
    const detailedMessage = error instanceof Error && error.message
      ? `Falha ao cadastrar programacao em lote: ${error.message}`
      : "Falha ao cadastrar programacao em lote.";

    return NextResponse.json({ message: detailedMessage }, { status: 500 });
  }
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
  const electricalFieldRaw = normalizeNullableText(payload?.electricalField);
  const electricalField = normalizeElectricalEqNumber(payload?.electricalField);
  const serviceDescription = normalizeNullableText(payload?.serviceDescription);
  const posteQty = normalizeNonNegativeInteger(payload?.posteQty);
  const estruturaQty = normalizeNonNegativeInteger(payload?.estruturaQty);
  const trafoQty = normalizeNonNegativeInteger(payload?.trafoQty);
  const redeQty = normalizeNonNegativeInteger(payload?.redeQty);
  const etapaNumberRaw = normalizeText(payload?.etapaNumber);
  const parsedEtapaNumber = etapaNumberRaw ? normalizePositiveInteger(etapaNumberRaw) : null;
  const etapaUnica = normalizeBoolean(payload?.etapaUnica) ?? false;
  const etapaFinal = normalizeBoolean(payload?.etapaFinal) ?? false;
  const workCompletionStatusRaw = normalizeText(payload?.workCompletionStatus);
  const workCompletionStatus = normalizeWorkCompletionStatus(workCompletionStatusRaw);
  const affectedCustomers = normalizeNonNegativeInteger(payload?.affectedCustomers);
  const sgdTypeId = normalizeNullableText(payload?.sgdTypeId);
  const electricalEqCatalogId = normalizeNullableText(payload?.electricalEqCatalogId);
  const changeReason = normalizeNullableText(payload?.changeReason);
  const expectedUpdatedAt = normalizeText(payload?.expectedUpdatedAt) || null;
  const hasActivitiesPayload = Array.isArray(payload?.activities);
  const activitiesInput = hasActivitiesPayload ? payload?.activities ?? [] : [];
  let activities = activitiesInput
    .map((item) => ({
      catalogId: normalizeText(item.catalogId),
      quantity: normalizePositiveNumber(item.quantity),
    }))
    .filter((item): item is { catalogId: string; quantity: number } => Boolean(item.catalogId) && item.quantity !== null);
  const documents = normalizeProgrammingDocuments(payload?.documents);

  if (method === "PUT" && !programmingId) {
    return NextResponse.json({ message: "Programacao invalida para edicao." }, { status: 400 });
  }

  if (!projectId || !teamId || !executionDate || !period || !startTime || !endTime || !expectedMinutes) {
    return NextResponse.json({ message: "Preencha os campos obrigatorios da programacao." }, { status: 400 });
  }

  if (etapaUnica && etapaFinal) {
    return NextResponse.json(
      { message: "Selecione apenas uma opcao: ETAPA UNICA ou ETAPA FINAL." },
      { status: 400 },
    );
  }

  if (endTime <= startTime) {
    return NextResponse.json(
      { message: "Hora termino deve ser maior que hora inicio." },
      { status: 400 },
    );
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

  const invalidRequestedDateLabel = getInvalidRequestedDateLabel(documents);
  if (invalidRequestedDateLabel) {
    return NextResponse.json(
      { message: `Data pedido do ${invalidRequestedDateLabel} nao pode ser maior que a data aprovada.` },
      { status: 400 },
    );
  }

  if (isNegativeNumericLikeText(feeder)) {
    return NextResponse.json(
      { message: "Alimentador nao pode receber valor negativo." },
      { status: 400 },
    );
  }

  if (posteQty === null || estruturaQty === null || trafoQty === null || redeQty === null) {
    return NextResponse.json(
      { message: "As quantidades de POSTE, ESTRUTURA, TRAFO e REDE devem ser inteiros maiores ou iguais a zero." },
      { status: 400 },
    );
  }

  if (method === "POST" && !etapaUnica && !etapaFinal && !etapaNumberRaw) {
    return NextResponse.json(
      { message: "O campo ETAPA e obrigatorio." },
      { status: 400 },
    );
  }

  if (!etapaUnica && !etapaFinal && etapaNumberRaw && parsedEtapaNumber === null) {
    return NextResponse.json(
      { message: "O campo ETAPA deve ser um numero inteiro maior que zero." },
      { status: 400 },
    );
  }

  const currentProgramming = programmingId
    ? await fetchProgrammingById(resolution.supabase, resolution.appUser.tenant_id, programmingId)
    : null;

  if (programmingId && !currentProgramming) {
    return NextResponse.json({ message: "Programacao nao encontrada." }, { status: 404 });
  }

  if (method === "PUT" && programmingId && !hasActivitiesPayload) {
    const currentActivities = await fetchProgrammingActivitiesForSave({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      programmingId,
    });

    if (currentActivities === null) {
      return NextResponse.json(
        { message: "Falha ao carregar atividades atuais da programacao para salvar com seguranca." },
        { status: 500 },
      );
    }

    activities = currentActivities;
  }

  const existingEtapaNumber = currentProgramming?.etapa_number ?? null;
  const etapaNumber = etapaUnica || etapaFinal
    ? null
    : (
      method === "PUT" && !etapaNumberRaw
        ? existingEtapaNumber
        : parsedEtapaNumber
    );

  const shouldValidateStageConflict = !etapaUnica
    && !etapaFinal
    && etapaNumber !== null
    && (
      method === "POST"
      || etapaNumber !== existingEtapaNumber
    );

  if (shouldValidateStageConflict && etapaNumber !== null) {
    const saveStageConflictSummaries = await fetchProgrammingStageValidation({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      projectId,
      teamIds: [teamId],
      enteredEtapaNumber: etapaNumber,
      excludeProgrammingId: programmingId || null,
      currentEditingStage: currentProgramming?.etapa_number ?? null,
      currentEditingDate: currentProgramming?.execution_date ?? null,
      currentEditingTeamId: currentProgramming?.team_id ?? null,
    });

    if (saveStageConflictSummaries.length) {
      return NextResponse.json(
        {
          enteredEtapaNumber: etapaNumber,
          hasConflict: true,
          highestStage: saveStageConflictSummaries.reduce((current, item) => Math.max(current, item.highestStage), 0),
          teams: saveStageConflictSummaries,
          message: "A ETAPA informada ja existe ou esta abaixo do historico encontrado para este projeto na equipe selecionada.",
        },
        { status: 409 },
      );
    }
  }

  if (workCompletionStatusRaw && !workCompletionStatus) {
    return NextResponse.json(
      { message: "Estado Trabalho invalido." },
      { status: 400 },
    );
  }

  if (workCompletionStatus) {
    const selectedWorkCompletionStatus = await resolveProgrammingWorkCompletionStatus({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      workCompletionStatus,
    });

    if (!selectedWorkCompletionStatus) {
      return NextResponse.json(
        { message: "Estado do Projeto invalido para o tenant atual." },
        { status: 400 },
      );
    }
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

  if (!electricalFieldRaw) {
    return NextResponse.json(
      { message: "Informe o numero do Nº EQ (RE, CO, CF, CC ou TR)." },
      { status: 400 },
    );
  }

  if (!electricalField) {
    return NextResponse.json(
      { message: "O numero do Nº EQ deve conter apenas letras e numeros." },
      { status: 400 },
    );
  }

  if (!electricalEqCatalogId) {
    return NextResponse.json(
      { message: "Selecione o tipo do Nº EQ (RE, CO, CF, CC ou TR)." },
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

  const selectedEqCatalog = await resolveProgrammingEqCatalog({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    electricalEqCatalogId,
  });

  if (!selectedEqCatalog) {
    return NextResponse.json(
      { message: "Nº EQ invalido para o tenant atual." },
      { status: 400 },
    );
  }

  const normalizedWorkCompletionStatus =
    method === "PUT"
      ? workCompletionStatus
      : null;

  const isPotentialReschedule = currentProgramming
    ? (
      currentProgramming.project_id !== projectId
      || currentProgramming.execution_date !== executionDate
      || currentProgramming.team_id !== teamId
      || normalizePeriod(currentProgramming.period) !== period
      || formatTime(currentProgramming.start_time) !== formatTime(startTime)
      || formatTime(currentProgramming.end_time) !== formatTime(endTime)
    )
    : false;

  if (isPotentialReschedule && !changeReason) {
    return NextResponse.json({ message: "Selecione um motivo de reprogramacao." }, { status: 400 });
  }

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
    electricalField,
    serviceDescription,
    posteQty: posteQty ?? 0,
    estruturaQty: estruturaQty ?? 0,
    trafoQty: trafoQty ?? 0,
    redeQty: redeQty ?? 0,
    etapaNumber,
    etapaUnica,
    etapaFinal,
    workCompletionStatus: normalizedWorkCompletionStatus,
    affectedCustomers: affectedCustomers ?? 0,
    sgdTypeId,
    electricalEqCatalogId,
    documents,
    activities,
    expectedUpdatedAt,
    historyReason: isPotentialReschedule ? changeReason : null,
    historyMetadata: {
      source: "programacao-api",
    },
  });

  if (!fullSaveResult.ok) {
    if (fullSaveResult.reason === "TEAM_TIME_CONFLICT") {
      const detailedConflictMessage = await resolveTeamTimeConflictDetailedMessage({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        executionDate,
        startTime,
        endTime,
        teamIds: [teamId],
        excludeProgrammingId: programmingId || null,
      });

      return NextResponse.json(
        { message: detailedConflictMessage ?? fullSaveResult.message },
        { status: 409 },
      );
    }

    if (fullSaveResult.reason === "PROGRAMMING_CONFLICT" && programmingId) {
      const conflictPayload = await fetchProgrammingConflictPayload({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        programmingId,
        requested: {
          executionDate,
          teamId,
          startTime,
          endTime,
        },
      });

      return NextResponse.json(
        conflictPayload ?? { error: "conflict", message: fullSaveResult.message },
        { status: 409 },
      );
    }

    if (fullSaveResult.reason === "FULL_RPC_NOT_AVAILABLE") {
      return NextResponse.json(
        {
          message:
            "Seu ambiente ainda nao suporta o salvamento transacional completo da programacao. Aplique as migrations 091, 094, 095, 100, 106, 111, 151 e 152 e tente novamente.",
        },
        { status: 409 },
      );
    }

    if (
      fullSaveResult.reason === "SAVE_PROGRAMMING_FULL_FAILED"
      && fullSaveResult.message === "Falha ao salvar programacao em transacao unica."
    ) {
      return NextResponse.json(
        {
          message:
            "Falha ao salvar programacao no banco. O ambiente pode estar com a RPC full desatualizada. Aplique as migrations 091, 094, 095, 100, 106, 111, 151 e 152 e tente novamente.",
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ message: fullSaveResult.message }, { status: fullSaveResult.status });
  }

  const saveResult = {
    ok: true,
    action: fullSaveResult.action,
    programmingId: fullSaveResult.programmingId,
    projectCode: fullSaveResult.projectCode,
    updatedAt: fullSaveResult.updatedAt,
    message: fullSaveResult.message,
  } as const;

  const persistedProgrammingId = saveResult.programmingId;

  if (!fullSaveResult.flagsEmbedded) {
    const etapaFlagsResult = await setProgrammingEtapaFlagsValue({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      actorUserId: resolution.appUser.id,
      programmingIds: [persistedProgrammingId],
      etapaUnica,
      etapaFinal,
    });

    if (!etapaFlagsResult.ok) {
      return NextResponse.json({ message: etapaFlagsResult.message }, { status: etapaFlagsResult.status });
    }
  }

  if (method === "PUT" && !electricalField) {
    const { error: clearElectricalFieldError } = await resolution.supabase
      .from("project_programming")
      .update({
        campo_eletrico: null,
        updated_by: resolution.appUser.id,
      })
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("id", persistedProgrammingId);

    if (clearElectricalFieldError) {
      return NextResponse.json(
        { message: "Programacao salva, mas houve falha ao limpar o campo Ponto eletrico." },
        { status: 500 },
      );
    }
  }

  const savedSchedule = await fetchProgrammingResponseItem(
    resolution.supabase,
    resolution.appUser.tenant_id,
    persistedProgrammingId,
  );
  const responseWarning = !savedSchedule
    ? "Programacao salva com sucesso, mas houve falha ao atualizar a visualizacao."
    : null;

  return NextResponse.json({
    success: true,
    id: persistedProgrammingId,
    updatedAt: saveResult.updatedAt,
    schedule: savedSchedule,
    warning: responseWarning,
    message: responseWarning ? `${saveResult.message} ${responseWarning}` : saveResult.message,
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

  if (!reason) {
    return NextResponse.json({ message: "Selecione um motivo para continuar." }, { status: 400 });
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

  if (action === "ADIADA") {
    if (!newDate) {
      return NextResponse.json(
        { message: "Informe a nova data da programacao para concluir o adiamento." },
        { status: 400 },
      );
    }

    if (newDate <= currentProgramming.execution_date) {
      return NextResponse.json(
        { message: "Informe uma nova data posterior a data atual da programacao." },
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
      if (postponeResult.reason === "PROGRAMMING_CONFLICT") {
        const conflictPayload = await fetchProgrammingConflictPayload({
          supabase: resolution.supabase,
          tenantId: resolution.appUser.tenant_id,
          programmingId,
          requested: {
            executionDate: newDate,
            teamId: currentProgramming.team_id,
            startTime: formatTime(currentProgramming.start_time),
            endTime: formatTime(currentProgramming.end_time),
            status: "ADIADA",
          },
        });

      return NextResponse.json(
          conflictPayload ?? { error: "conflict", message: postponeResult.message, reason: postponeResult.reason ?? null },
          { status: 409 },
        );
      }

      return NextResponse.json(
        {
          message: postponeResult.message,
          reason: postponeResult.reason ?? null,
          detail: "detail" in postponeResult ? (postponeResult.detail ?? null) : null,
        },
        { status: postponeResult.status },
      );
    }

    let updatedSchedule: Awaited<ReturnType<typeof fetchProgrammingResponseItem>> = null;
    let newSchedule: Awaited<ReturnType<typeof fetchProgrammingResponseItem>> = null;
    let warning: string | null = null;

    try {
      [updatedSchedule, newSchedule] = await Promise.all([
        fetchProgrammingResponseItem(resolution.supabase, resolution.appUser.tenant_id, programmingId),
        fetchProgrammingResponseItem(resolution.supabase, resolution.appUser.tenant_id, postponeResult.newProgrammingId),
      ]);

      if (!updatedSchedule || !newSchedule) {
        warning = "Programacao salva com sucesso, mas houve falha ao atualizar a visualizacao.";
      }
    } catch {
      warning = "Programacao salva com sucesso, mas houve falha ao atualizar a visualizacao.";
    }

    return NextResponse.json({
      success: true,
      id: programmingId,
      newId: postponeResult.newProgrammingId,
      updatedAt: postponeResult.updatedAt,
      schedule: updatedSchedule,
      newSchedule,
      warning,
      message: warning ? `${postponeResult.message} ${warning}` : postponeResult.message,
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
    if (cancelResult.reason === "PROGRAMMING_CONFLICT") {
      const conflictPayload = await fetchProgrammingConflictPayload({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        programmingId,
        requested: {
          executionDate: currentProgramming.execution_date,
          teamId: currentProgramming.team_id,
          startTime: formatTime(currentProgramming.start_time),
          endTime: formatTime(currentProgramming.end_time),
          status: action,
        },
      });

      return NextResponse.json(
        conflictPayload ?? { error: "conflict", message: cancelResult.message, reason: cancelResult.reason ?? null },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { message: cancelResult.message, reason: cancelResult.reason ?? null },
      { status: cancelResult.status },
    );
  }

  let updatedSchedule: Awaited<ReturnType<typeof fetchProgrammingResponseItem>> = null;
  let warning: string | null = null;

  try {
    updatedSchedule = await fetchProgrammingResponseItem(
      resolution.supabase,
      resolution.appUser.tenant_id,
      programmingId,
    );
    if (!updatedSchedule) {
      warning = "Programacao salva com sucesso, mas houve falha ao atualizar a visualizacao.";
    }
  } catch {
    warning = "Programacao salva com sucesso, mas houve falha ao atualizar a visualizacao.";
  }

  return NextResponse.json({
    success: true,
    id: programmingId,
    updatedAt: cancelResult.updatedAt,
    schedule: updatedSchedule,
    warning,
    message: warning ? `${cancelResult.message} ${warning}` : cancelResult.message,
  });
}
