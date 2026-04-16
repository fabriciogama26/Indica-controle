
import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import {
  buildConcurrencyConflictResponse,
  hasUpdatedAtConflict,
  normalizeExpectedUpdatedAt,
} from "@/lib/server/concurrency";

type ProjectRow = {
  id: string;
  sob: string;
  fob: string | null;
  service_center: string;
  service_center_text: string | null;
  partner: string;
  partner_text: string | null;
  service_type: string;
  service_type_text: string | null;
  execution_deadline: string;
  priority: string;
  priority_text: string | null;
  estimated_value: number;
  voltage_level: string | null;
  voltage_level_text: string | null;
  project_size: string | null;
  project_size_text: string | null;
  contractor_responsible: string;
  contractor_responsible_text: string | null;
  utility_responsible: string;
  utility_responsible_text: string | null;
  utility_field_manager: string;
  utility_field_manager_text: string | null;
  street: string;
  neighborhood: string;
  city: string;
  city_text: string | null;
  service_description: string | null;
  observation: string | null;
  is_active: boolean;
  is_test: boolean;
  has_locacao: boolean;
  cancellation_reason: string | null;
  canceled_at: string | null;
  canceled_by: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

type ProjectBaseRow = Omit<ProjectRow, "has_locacao" | "fob" | "is_test"> & {
  has_locacao?: boolean | null;
  fob?: string | null;
  is_test?: boolean | null;
};

type ProjectListSummary = {
  totalProjects: number;
  completed: number;
};

type ProjectUserRow = {
  id: string;
  display: string | null;
  login_name: string | null;
};

type ProjectLookupRow = {
  id: string;
  name: string;
  name_normalized: string;
  ativo: boolean;
};

type JobTitleIdRow = {
  id: string;
};

type PersonNameRow = {
  id: string;
  name: string;
};

type ContractRow = {
  id: string;
  name: string;
};

type CreateProjectPayload = {
  sob: string;
  serviceCenter: string;
  serviceType: string;
  executionDeadline: string;
  priority: string;
  estimatedValue: string | number;
  voltageLevel?: string | null;
  projectSize?: string | null;
  contractorResponsible: string;
  utilityResponsible: string;
  utilityFieldManager: string;
  street: string;
  neighborhood: string;
  city: string;
  serviceDescription?: string | null;
  observation?: string | null;
  isTest?: boolean;
};

type UpdateProjectPayload = CreateProjectPayload & {
  id: string;
  expectedUpdatedAt?: string | null;
};

type CancelProjectPayload = {
  id: string;
  reason: string;
  action?: "cancel" | "activate";
  expectedUpdatedAt?: string | null;
};

type ProjectHistoryRow = {
  id: string;
  change_type: "UPDATE" | "CANCEL" | "ACTIVATE";
  changes: unknown;
  created_at: string;
  created_by: string | null;
};

type HistoryChange = {
  from: string | null;
  to: string | null;
};

type ProjectInput = {
  sob: string;
  serviceCenter: string;
  serviceType: string;
  executionDeadline: string;
  priority: string;
  estimatedValue: number | null;
  voltageLevel: string | null;
  projectSize: string | null;
  contractorResponsible: string;
  utilityResponsible: string;
  utilityFieldManager: string;
  street: string;
  neighborhood: string;
  city: string;
  serviceDescription: string | null;
  observation: string | null;
  isTest: boolean;
};

type ProjectWorkCompletionStatusFilter = "TODOS" | "NAO_INFORMADO" | string;

type ResolvedProjectLookups = {
  partner: ContractRow;
  priority: ProjectLookupRow;
  serviceCenter: ProjectLookupRow;
  serviceType: ProjectLookupRow;
  voltageLevel: ProjectLookupRow | null;
  projectSize: ProjectLookupRow | null;
  municipality: ProjectLookupRow;
  contractorResponsible: PersonNameRow;
  utilityResponsible: ProjectLookupRow;
  utilityFieldManager: ProjectLookupRow;
};

type ProjectSaveRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  project_id?: string;
  updated_at?: string;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeNullableText(value: unknown) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizeSob(value: unknown) {
  return normalizeText(value).toUpperCase();
}

function normalizePriority(value: unknown) {
  return normalizeText(value).toUpperCase();
}

function normalizeEstimatedValue(value: unknown) {
  const raw = String(value ?? "")
    .trim()
    .replace(",", ".");

  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }

  return numeric;
}

function normalizeBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = normalizeText(value).toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "sim";
}

function normalizeProjectWorkCompletionStatusFilter(value: unknown): ProjectWorkCompletionStatusFilter {
  const normalized = normalizeText(value).toUpperCase();
  if (!normalized || normalized === "TODOS") {
    return "TODOS";
  }
  if (normalized === "NAO_INFORMADO") {
    return "NAO_INFORMADO";
  }
  return normalized;
}

function normalizeUuid(value: unknown) {
  const normalized = normalizeText(value);
  return /^[0-9a-f-]{36}$/i.test(normalized) ? normalized : null;
}

function normalizeStatusCatalogCode(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
}

function isMissingWorkCompletionStatusIdColumnError(message: string) {
  const normalized = normalizeText(message).toLowerCase();
  return (
    normalized.includes("work_completion_status_id")
    && (
      normalized.includes("does not exist")
      || normalized.includes("could not find")
      || normalized.includes("schema cache")
    )
  );
}

async function fetchCompletedProgrammingProjectIdsCompat(params: {
  supabase: SupabaseClient;
  tenantId: string;
  projectIds?: string[];
}) {
  const resultIds = new Set<string>();

  const { data: workCompletionCatalogRows } = await params.supabase
    .from("programming_work_completion_catalog")
    .select("id, code")
    .eq("tenant_id", params.tenantId)
    .eq("is_active", true)
    .returns<Array<{ id: string; code: string }>>();

  const concludedCatalogIds = (workCompletionCatalogRows ?? [])
    .filter((item) => normalizeStatusCatalogCode(item.code) === "CONCLUIDO")
    .map((item) => normalizeText(item.id))
    .filter(Boolean);

  if (concludedCatalogIds.length) {
    let statusIdQuery = params.supabase
      .from("project_programming")
      .select("project_id")
      .eq("tenant_id", params.tenantId)
      .in("work_completion_status_id", concludedCatalogIds);

    if (params.projectIds?.length) {
      statusIdQuery = statusIdQuery.in("project_id", params.projectIds);
    }

    const { data: statusIdRows, error: statusIdError } = await statusIdQuery
      .returns<Array<{ project_id: string }>>();

    if (statusIdError && !isMissingWorkCompletionStatusIdColumnError(String(statusIdError.message ?? ""))) {
      return { projectIds: [] as string[], error: statusIdError };
    }

    for (const row of statusIdRows ?? []) {
      const projectId = normalizeText(row.project_id);
      if (projectId) {
        resultIds.add(projectId);
      }
    }
  }

  let legacyStatusQuery = params.supabase
    .from("project_programming")
    .select("project_id")
    .eq("tenant_id", params.tenantId)
    .in("work_completion_status", ["CONCLUIDO", "CONCLUÍDO"]);

  if (params.projectIds?.length) {
    legacyStatusQuery = legacyStatusQuery.in("project_id", params.projectIds);
  }

  const { data: legacyStatusRows, error: legacyStatusError } = await legacyStatusQuery
    .returns<Array<{ project_id: string }>>();

  if (legacyStatusError) {
    return { projectIds: [] as string[], error: legacyStatusError };
  }

  for (const row of legacyStatusRows ?? []) {
    const projectId = normalizeText(row.project_id);
    if (projectId) {
      resultIds.add(projectId);
    }
  }

  return { projectIds: Array.from(resultIds), error: null };
}

async function fetchProjectIdsByProgrammingFiltersCompat(params: {
  supabase: SupabaseClient;
  tenantId: string;
  workCompletionStatus: ProjectWorkCompletionStatusFilter;
  sgdTypeId: string | null;
}) {
  const hasWorkCompletionFilter = params.workCompletionStatus !== "TODOS";
  const hasSgdTypeFilter = Boolean(params.sgdTypeId);

  if (!hasWorkCompletionFilter && !hasSgdTypeFilter) {
    return { projectIds: null as string[] | null, error: null };
  }

  const normalizedStatusCode = hasWorkCompletionFilter
    ? normalizeStatusCatalogCode(params.workCompletionStatus)
    : "";

  let statusCatalogIds: string[] = [];
  if (hasWorkCompletionFilter && params.workCompletionStatus !== "NAO_INFORMADO") {
    const { data: catalogRows, error: catalogError } = await params.supabase
      .from("programming_work_completion_catalog")
      .select("id, code")
      .eq("tenant_id", params.tenantId)
      .eq("is_active", true)
      .returns<Array<{ id: string; code: string }>>();

    if (catalogError) {
      return { projectIds: [] as string[], error: catalogError };
    }

    statusCatalogIds = (catalogRows ?? [])
      .filter((item) => normalizeStatusCatalogCode(item.code) === normalizedStatusCode)
      .map((item) => normalizeText(item.id))
      .filter(Boolean);
  }

  const collectProjectIds = (rows: Array<{ project_id: string }> | null | undefined) =>
    Array.from(new Set((rows ?? []).map((item) => normalizeText(item.project_id)).filter(Boolean)));

  let query = params.supabase
    .from("project_programming")
    .select("project_id")
    .eq("tenant_id", params.tenantId);

  if (hasSgdTypeFilter && params.sgdTypeId) {
    query = query.eq("sgd_type_id", params.sgdTypeId);
  }

  if (hasWorkCompletionFilter) {
    if (params.workCompletionStatus === "NAO_INFORMADO") {
      query = query.is("work_completion_status_id", null);
    } else if (statusCatalogIds.length > 0) {
      query = query.in("work_completion_status_id", statusCatalogIds);
    } else {
      return { projectIds: [] as string[], error: null };
    }
  }

  const { data, error } = await query.returns<Array<{ project_id: string }>>();
  if (!error) {
    return { projectIds: collectProjectIds(data), error: null };
  }

  if (!(hasWorkCompletionFilter && isMissingWorkCompletionStatusIdColumnError(String(error.message ?? "")))) {
    return { projectIds: [] as string[], error };
  }

  let legacyQuery = params.supabase
    .from("project_programming")
    .select("project_id")
    .eq("tenant_id", params.tenantId);

  if (hasSgdTypeFilter && params.sgdTypeId) {
    legacyQuery = legacyQuery.eq("sgd_type_id", params.sgdTypeId);
  }

  if (params.workCompletionStatus === "NAO_INFORMADO") {
    legacyQuery = legacyQuery.or("work_completion_status.is.null,work_completion_status.eq.");
  } else {
    legacyQuery = legacyQuery.ilike("work_completion_status", params.workCompletionStatus);
  }

  const { data: legacyData, error: legacyError } = await legacyQuery
    .returns<Array<{ project_id: string }>>();

  if (legacyError) {
    return { projectIds: [] as string[], error: legacyError };
  }

  return { projectIds: collectProjectIds(legacyData), error: null };
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseProjectInput(payload: Partial<CreateProjectPayload>): ProjectInput {
  return {
    sob: normalizeSob(payload.sob),
    serviceCenter: normalizeText(payload.serviceCenter),
    serviceType: normalizeText(payload.serviceType),
    executionDeadline: normalizeText(payload.executionDeadline),
    priority: normalizePriority(payload.priority),
    estimatedValue: normalizeEstimatedValue(payload.estimatedValue),
    voltageLevel: normalizeNullableText(payload.voltageLevel),
    projectSize: normalizeNullableText(payload.projectSize),
    contractorResponsible: normalizeText(payload.contractorResponsible),
    utilityResponsible: normalizeText(payload.utilityResponsible),
    utilityFieldManager: normalizeText(payload.utilityFieldManager),
    street: normalizeText(payload.street),
    neighborhood: normalizeText(payload.neighborhood),
    city: normalizeText(payload.city),
    serviceDescription: normalizeNullableText(payload.serviceDescription),
    observation: normalizeNullableText(payload.observation),
    isTest: normalizeBoolean(payload.isTest),
  };
}

function validateRequiredProjectFields(input: ProjectInput) {
  if (
    !input.sob ||
    !input.serviceCenter ||
    !input.serviceType ||
    !input.executionDeadline ||
    !input.priority ||
    input.estimatedValue === null ||
    !input.contractorResponsible ||
    !input.utilityResponsible ||
    !input.utilityFieldManager ||
    !input.street ||
    !input.neighborhood ||
    !input.city
  ) {
    return "Preencha todos os campos obrigatorios do projeto.";
  }

  if (!isIsoDate(input.executionDeadline)) {
    return "Data limite invalida.";
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

function normalizeHistoryChanges(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, HistoryChange>;
  }

  const result: Record<string, HistoryChange> = {};
  for (const [field, rawChange] of Object.entries(value as Record<string, unknown>)) {
    if (!rawChange || typeof rawChange !== "object" || Array.isArray(rawChange)) {
      continue;
    }

    const from = formatComparableValue((rawChange as { from?: unknown }).from);
    const to = formatComparableValue((rawChange as { to?: unknown }).to);
    result[field] = { from, to };
  }

  return result;
}

function buildUserDisplayMap(users: ProjectUserRow[]) {
  return new Map(
    users.map((user) => [
      user.id,
      String(user.display ?? user.login_name ?? "").trim() || "Nao identificado",
    ]),
  );
}

function buildUserLoginNameMap(users: ProjectUserRow[]) {
  return new Map(
    users.map((user) => [user.id, String(user.login_name ?? "").trim() || "Nao identificado"]),
  );
}

const PROJECT_SELECT_WITH_LOCATION =
  "id, sob, fob, service_center, service_center_text, partner, partner_text, service_type, service_type_text, execution_deadline, priority, priority_text, estimated_value, voltage_level, voltage_level_text, project_size, project_size_text, contractor_responsible, contractor_responsible_text, utility_responsible, utility_responsible_text, utility_field_manager, utility_field_manager_text, street, neighborhood, city, city_text, service_description, observation, is_active, is_test, has_locacao, cancellation_reason, canceled_at, canceled_by, created_by, updated_by, created_at, updated_at";

const PROJECT_SELECT_LEGACY =
  "id, sob, service_center, service_center_text, partner, partner_text, service_type, service_type_text, execution_deadline, priority, priority_text, estimated_value, voltage_level, voltage_level_text, project_size, project_size_text, contractor_responsible, contractor_responsible_text, utility_responsible, utility_responsible_text, utility_field_manager, utility_field_manager_text, street, neighborhood, city, city_text, service_description, observation, is_active, cancellation_reason, canceled_at, canceled_by, created_by, updated_by, created_at, updated_at";

function isMissingOptionalProjectColumns(message: string) {
  const normalized = normalizeText(message).toLowerCase();
  return normalized.includes("has_locacao") || normalized.includes("fob") || normalized.includes("is_test");
}

async function fetchProjectByIdCompat(supabase: SupabaseClient, tenantId: string, projectId: string) {
  const primary = await supabase
    .from("project_with_labels")
    .select(PROJECT_SELECT_WITH_LOCATION)
    .eq("tenant_id", tenantId)
    .eq("id", projectId)
    .maybeSingle<ProjectBaseRow>();

  if (!primary.error && primary.data) {
    return {
      data: {
        ...primary.data,
        fob: normalizeNullableText(primary.data.fob),
        is_test: Boolean(primary.data.is_test),
        has_locacao: Boolean(primary.data.has_locacao),
      } as ProjectRow,
      error: null,
    };
  }

  if (!isMissingOptionalProjectColumns(String(primary.error?.message ?? ""))) {
    return { data: null, error: primary.error };
  }

  const fallback = await supabase
    .from("project_with_labels")
    .select(PROJECT_SELECT_LEGACY)
    .eq("tenant_id", tenantId)
    .eq("id", projectId)
    .maybeSingle<ProjectBaseRow>();

  if (fallback.error || !fallback.data) {
    return { data: null, error: fallback.error };
  }

  return {
    data: {
      ...fallback.data,
      fob: null,
      is_test: false,
      has_locacao: false,
    } as ProjectRow,
    error: null,
  };
}

async function fetchProjectsPageCompat(params: {
  supabase: SupabaseClient;
  tenantId: string;
  sob: string;
  executionDate: string;
  priority: string;
  city: string;
  programmingFilteredProjectIds: string[] | null;
  from: number;
  to: number;
}) {
  const runQuery = async (selectClause: string) => {
    let query = params.supabase
      .from("project_with_labels")
      .select(selectClause, { count: "exact" })
      .eq("tenant_id", params.tenantId);

    if (params.sob) {
      query = query.ilike("sob", `%${params.sob}%`);
    }
    if (params.executionDate && isIsoDate(params.executionDate)) {
      query = query.eq("execution_deadline", params.executionDate);
    }
    if (params.priority) {
      query = query.eq("priority_text", params.priority);
    }
    if (params.city) {
      query = query.eq("city_text", params.city);
    }
    if (params.programmingFilteredProjectIds) {
      query = query.in(
        "id",
        params.programmingFilteredProjectIds.length > 0
          ? params.programmingFilteredProjectIds
          : ["00000000-0000-0000-0000-000000000000"],
      );
    }

    return query
      .order("is_active", { ascending: false })
      .order("execution_deadline", { ascending: true })
      .order("created_at", { ascending: false })
      .range(params.from, params.to);
  };

  const primary = await runQuery(PROJECT_SELECT_WITH_LOCATION);
  if (!primary.error) {
    const primaryRows = (primary.data ?? []) as unknown as ProjectBaseRow[];
    return {
      data: primaryRows.map((item) => ({
        ...item,
        fob: normalizeNullableText(item.fob),
        is_test: Boolean(item.is_test),
        has_locacao: Boolean(item.has_locacao),
      })) as ProjectRow[],
      count: primary.count ?? 0,
      error: null,
    };
  }

  if (!isMissingOptionalProjectColumns(String(primary.error.message ?? ""))) {
    return { data: [] as ProjectRow[], count: 0, error: primary.error };
  }

  const fallback = await runQuery(PROJECT_SELECT_LEGACY);
  if (fallback.error) {
    return { data: [] as ProjectRow[], count: 0, error: fallback.error };
  }

  const fallbackRows = (fallback.data ?? []) as unknown as ProjectBaseRow[];
  return {
    data: fallbackRows.map((item) => ({ ...item, fob: null, is_test: false, has_locacao: false })) as ProjectRow[],
    count: fallback.count ?? 0,
    error: null,
  };
}

async function fetchProjectsSummaryCompat(params: {
  supabase: SupabaseClient;
  tenantId: string;
  sob: string;
  executionDate: string;
  priority: string;
  city: string;
  programmingFilteredProjectIds: string[] | null;
}) {
  const projectIds: string[] = [];
  const projectSobById = new Map<string, string>();
  const totalSobKeys = new Set<string>();
  const pageSize = 1000;
  let from = 0;

  while (true) {
    let projectIdsQuery = params.supabase
      .from("project_with_labels")
      .select("id, sob")
      .eq("tenant_id", params.tenantId)
      .eq("is_test", false)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (params.sob) {
      projectIdsQuery = projectIdsQuery.ilike("sob", `%${params.sob}%`);
    }
    if (params.executionDate && isIsoDate(params.executionDate)) {
      projectIdsQuery = projectIdsQuery.eq("execution_deadline", params.executionDate);
    }
    if (params.priority) {
      projectIdsQuery = projectIdsQuery.eq("priority_text", params.priority);
    }
    if (params.city) {
      projectIdsQuery = projectIdsQuery.eq("city_text", params.city);
    }
    projectIdsQuery = projectIdsQuery.eq("is_active", true);
    if (params.programmingFilteredProjectIds) {
      projectIdsQuery = projectIdsQuery.in(
        "id",
        params.programmingFilteredProjectIds.length > 0
          ? params.programmingFilteredProjectIds
          : ["00000000-0000-0000-0000-000000000000"],
      );
    }

    let { data: projectRows, error: projectRowsError } = await projectIdsQuery.returns<{ id: string; sob: string | null }[]>();
    if (projectRowsError && isMissingOptionalProjectColumns(String(projectRowsError.message ?? ""))) {
      let fallbackQuery = params.supabase
        .from("project_with_labels")
        .select("id, sob")
        .eq("tenant_id", params.tenantId)
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);

      if (params.sob) {
        fallbackQuery = fallbackQuery.ilike("sob", `%${params.sob}%`);
      }
      if (params.executionDate && isIsoDate(params.executionDate)) {
        fallbackQuery = fallbackQuery.eq("execution_deadline", params.executionDate);
      }
      if (params.priority) {
        fallbackQuery = fallbackQuery.eq("priority_text", params.priority);
      }
      if (params.city) {
        fallbackQuery = fallbackQuery.eq("city_text", params.city);
      }
      fallbackQuery = fallbackQuery.eq("is_active", true);
      if (params.programmingFilteredProjectIds) {
        fallbackQuery = fallbackQuery.in(
          "id",
          params.programmingFilteredProjectIds.length > 0
            ? params.programmingFilteredProjectIds
            : ["00000000-0000-0000-0000-000000000000"],
        );
      }

      const fallbackResult = await fallbackQuery.returns<{ id: string; sob: string | null }[]>();
      projectRows = fallbackResult.data;
      projectRowsError = fallbackResult.error;
    }

    if (projectRowsError) {
      return { data: null, error: projectRowsError };
    }

    for (const item of projectRows ?? []) {
      const projectId = normalizeText(item.id);
      if (!projectId) {
        continue;
      }

      projectIds.push(projectId);
      const sobKey = normalizeSob(item.sob);
      const normalizedSobKey = sobKey || projectId;
      projectSobById.set(projectId, normalizedSobKey);
      totalSobKeys.add(normalizedSobKey);
    }

    if ((projectRows ?? []).length < pageSize) {
      break;
    }
    from += pageSize;
  }

  if (projectIds.length === 0) {
    return {
      data: {
        totalProjects: 0,
        completed: 0,
      } as ProjectListSummary,
      error: null,
    };
  }

  const completedSobKeys = new Set<string>();
  const chunkSize = 200;

  for (let index = 0; index < projectIds.length; index += chunkSize) {
    const chunk = projectIds.slice(index, index + chunkSize);
    const completedProjectIdsResult = await fetchCompletedProgrammingProjectIdsCompat({
      supabase: params.supabase,
      tenantId: params.tenantId,
      projectIds: chunk,
    });

    if (completedProjectIdsResult.error) {
      return { data: null, error: completedProjectIdsResult.error };
    }

    for (const projectId of completedProjectIdsResult.projectIds) {
      if (!projectId) {
        continue;
      }

      const sobKey = projectSobById.get(projectId);
      completedSobKeys.add(sobKey ?? projectId);
    }
  }

  return {
    data: {
      totalProjects: totalSobKeys.size,
      completed: completedSobKeys.size,
    } as ProjectListSummary,
    error: null,
  };
}
async function resolveLookupByName(
  supabase: SupabaseClient,
  table: string,
  tenantId: string,
  value: string,
  required: boolean,
  fieldLabel: string,
) {
  const normalized = normalizeText(value).toUpperCase();
  if (!normalized) {
    return required
      ? { data: null, message: `Selecione ${fieldLabel}.` }
      : { data: null, message: null };
  }

  const { data, error } = await supabase
    .from(table)
    .select("id, name, name_normalized, ativo")
    .eq("tenant_id", tenantId)
    .eq("name_normalized", normalized)
    .eq("ativo", true)
    .maybeSingle<ProjectLookupRow>();

  if (error || !data) {
    return { data: null, message: `${fieldLabel} invalido(a).` };
  }

  return { data, message: null };
}

async function resolveContractorResponsibleSupervisorByName(
  supabase: SupabaseClient,
  tenantId: string,
  value: string,
  required: boolean,
  fieldLabel: string,
) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return required
      ? { data: null, message: `Selecione ${fieldLabel}.` }
      : { data: null, message: null };
  }

  const { data: supervisorJobTitles, error: supervisorJobTitlesError } = await supabase
    .from("job_titles")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .ilike("code", "SUPERVISOR")
    .returns<JobTitleIdRow[]>();

  if (supervisorJobTitlesError) {
    return { data: null, message: `Falha ao validar ${fieldLabel}.` };
  }

  const supervisorJobTitleIds = (supervisorJobTitles ?? []).map((item) => item.id).filter(Boolean);
  if (supervisorJobTitleIds.length === 0) {
    return { data: null, message: `${fieldLabel} invalido(a).` };
  }

  const { data: peopleRows, error: peopleError } = await supabase
    .from("people")
    .select("id, name:nome")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .in("job_title_id", supervisorJobTitleIds)
    .returns<PersonNameRow[]>();

  if (peopleError) {
    return { data: null, message: `${fieldLabel} invalido(a).` };
  }

  const normalizedInput = normalized.toUpperCase();
  const person = (peopleRows ?? []).find((item) => normalizeText(item.name).toUpperCase() === normalizedInput);

  if (!person) {
    return { data: null, message: `${fieldLabel} invalido(a).` };
  }

  return { data: person, message: null };
}

async function resolveContractPartnerName(supabase: SupabaseClient, tenantId: string) {
  const { data, error } = await supabase
    .from("contract")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .maybeSingle<ContractRow>();

  const contractId = String(data?.id ?? "").trim();
  const partnerName = String(data?.name ?? "").trim();
  if (error || !contractId || !partnerName) {
    return {
      data: null,
      message: "Nao foi encontrado contrato ativo com campo name para preencher Parceira automaticamente.",
    };
  }

  return {
    data: {
      id: contractId,
      name: partnerName,
    },
    message: null,
  };
}

async function resolveProjectLookups(
  supabase: SupabaseClient,
  tenantId: string,
  input: ProjectInput,
): Promise<{ data: ResolvedProjectLookups | null; message: string | null }> {
  const [
    partnerFromContract,
    priorityLookup,
    serviceCenterLookup,
    serviceTypeLookup,
    voltageLevelLookup,
    projectSizeLookup,
    municipalityLookup,
    contractorResponsibleLookup,
    utilityResponsibleLookup,
    utilityFieldManagerLookup,
  ] = await Promise.all([
    resolveContractPartnerName(supabase, tenantId),
    resolveLookupByName(supabase, "project_priorities", tenantId, input.priority, true, "a Prioridade"),
    resolveLookupByName(supabase, "project_service_centers", tenantId, input.serviceCenter, true, "o Centro de Servico"),
    resolveLookupByName(supabase, "project_service_types", tenantId, input.serviceType, true, "o Tipo de Servico"),
    resolveLookupByName(supabase, "project_voltage_levels", tenantId, input.voltageLevel ?? "", false, "o Nivel de Tensao"),
    resolveLookupByName(supabase, "project_sizes", tenantId, input.projectSize ?? "", false, "o Porte"),
    resolveLookupByName(supabase, "project_municipalities", tenantId, input.city, true, "o Municipio"),
    resolveContractorResponsibleSupervisorByName(
      supabase,
      tenantId,
      input.contractorResponsible,
      true,
      "o Responsavel Contratada (Supervisor)",
    ),
    resolveLookupByName(
      supabase,
      "project_utility_responsibles",
      tenantId,
      input.utilityResponsible,
      true,
      "o Responsavel Distribuidora",
    ),
    resolveLookupByName(
      supabase,
      "project_utility_field_managers",
      tenantId,
      input.utilityFieldManager,
      true,
      "o Gestor de campo Distribuidora",
    ),
  ]);

  const lookupMessage =
    partnerFromContract.message ??
    priorityLookup.message ??
    serviceCenterLookup.message ??
    serviceTypeLookup.message ??
    voltageLevelLookup.message ??
    projectSizeLookup.message ??
    municipalityLookup.message ??
    contractorResponsibleLookup.message ??
    utilityResponsibleLookup.message ??
    utilityFieldManagerLookup.message;

  if (lookupMessage) {
    return { data: null, message: lookupMessage };
  }

  return {
    data: {
      partner: partnerFromContract.data as ContractRow,
      priority: priorityLookup.data as ProjectLookupRow,
      serviceCenter: serviceCenterLookup.data as ProjectLookupRow,
      serviceType: serviceTypeLookup.data as ProjectLookupRow,
      voltageLevel: (voltageLevelLookup.data as ProjectLookupRow | null) ?? null,
      projectSize: (projectSizeLookup.data as ProjectLookupRow | null) ?? null,
      municipality: municipalityLookup.data as ProjectLookupRow,
      contractorResponsible: contractorResponsibleLookup.data as PersonNameRow,
      utilityResponsible: utilityResponsibleLookup.data as ProjectLookupRow,
      utilityFieldManager: utilityFieldManagerLookup.data as ProjectLookupRow,
    },
    message: null,
  };
}

function buildProjectWritePayload(
  input: ProjectInput,
  lookups: ResolvedProjectLookups,
) {
  return {
    sob: input.sob,
    fob: null,
    priority: lookups.priority.id,
    service_center: lookups.serviceCenter.id,
    partner: lookups.partner.id,
    service_type: lookups.serviceType.id,
    execution_deadline: input.executionDeadline,
    estimated_value: input.estimatedValue,
    voltage_level: lookups.voltageLevel ? lookups.voltageLevel.id : null,
    project_size: lookups.projectSize ? lookups.projectSize.id : null,
    contractor_responsible: lookups.contractorResponsible.id,
    utility_responsible: lookups.utilityResponsible.id,
    utility_field_manager: lookups.utilityFieldManager.id,
    street: input.street,
    neighborhood: input.neighborhood,
    city: lookups.municipality.id,
    service_description: input.serviceDescription,
    observation: input.observation,
    is_test: input.isTest,
  };
}

function buildProjectUpdateChanges(current: ProjectRow, input: ProjectInput, lookups: ResolvedProjectLookups) {
  const changes: Record<string, HistoryChange> = {};

  addChange(changes, "priority", current.priority_text, lookups.priority.name);
  addChange(changes, "sob", current.sob, input.sob);
  addChange(changes, "serviceCenter", current.service_center_text, lookups.serviceCenter.name);
  addChange(changes, "serviceType", current.service_type_text, lookups.serviceType.name);
  addChange(changes, "executionDeadline", current.execution_deadline, input.executionDeadline);
  addChange(changes, "estimatedValue", current.estimated_value, input.estimatedValue);
  addChange(changes, "voltageLevel", current.voltage_level_text, lookups.voltageLevel?.name ?? null);
  addChange(changes, "projectSize", current.project_size_text, lookups.projectSize?.name ?? null);
  addChange(changes, "contractorResponsible", current.contractor_responsible_text, lookups.contractorResponsible.name);
  addChange(changes, "utilityResponsible", current.utility_responsible_text, lookups.utilityResponsible.name);
  addChange(changes, "utilityFieldManager", current.utility_field_manager_text, lookups.utilityFieldManager.name);
  addChange(changes, "city", current.city_text, lookups.municipality.name);
  addChange(changes, "street", current.street, input.street);
  addChange(changes, "neighborhood", current.neighborhood, input.neighborhood);
  addChange(changes, "serviceDescription", current.service_description, input.serviceDescription);
  addChange(changes, "observation", current.observation, input.observation);
  addChange(changes, "partner", current.partner_text, lookups.partner.name);
  addChange(changes, "isTest", current.is_test, input.isTest);

  return changes;
}

async function fetchProjectById(supabase: SupabaseClient, tenantId: string, projectId: string) {
  const { data, error } = await fetchProjectByIdCompat(supabase, tenantId, projectId);

  if (error || !data) {
    return null;
  }

  return data;
}

async function saveProjectViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  projectId: string | null;
  payload: ReturnType<typeof buildProjectWritePayload>;
  changes?: Record<string, HistoryChange>;
  expectedUpdatedAt?: string | null;
}) {
  const rpcPayload = {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_project_id: params.projectId,
    p_sob: params.payload.sob,
    p_fob: params.payload.fob,
    p_service_center: params.payload.service_center,
    p_partner: params.payload.partner,
    p_service_type: params.payload.service_type,
    p_execution_deadline: params.payload.execution_deadline,
    p_priority: params.payload.priority,
    p_estimated_value: params.payload.estimated_value,
    p_voltage_level: params.payload.voltage_level,
    p_project_size: params.payload.project_size,
    p_contractor_responsible: params.payload.contractor_responsible,
    p_utility_responsible: params.payload.utility_responsible,
    p_utility_field_manager: params.payload.utility_field_manager,
    p_street: params.payload.street,
    p_neighborhood: params.payload.neighborhood,
    p_city: params.payload.city,
    p_service_description: params.payload.service_description,
    p_observation: params.payload.observation,
    p_is_test: params.payload.is_test,
    p_changes: params.changes ?? {},
    p_expected_updated_at: params.expectedUpdatedAt ?? null,
  };

  const executeSaveProjectRpc = async (payload: Record<string, unknown>) =>
    params.supabase.rpc("save_project_record", payload);

  let { data, error } = await executeSaveProjectRpc(rpcPayload);
  if (error) {
    const legacyPayload = Object.fromEntries(
      Object.entries(rpcPayload).filter(([key]) => key !== "p_fob" && key !== "p_is_test"),
    );

    const legacyAttempt = await executeSaveProjectRpc(legacyPayload);
    if (!legacyAttempt.error) {
      data = legacyAttempt.data;
      error = null;
    }
  }

  if (error) {
    const errorMessage = normalizeText(error.message);
    const errorHint = normalizeText((error as { hint?: string | null }).hint);
    const errorDetails = normalizeText((error as { details?: string | null }).details);

    if (errorMessage.toLowerCase().includes("save_project_record") && errorMessage.toLowerCase().includes("function")) {
      return {
        ok: false,
        status: 500,
        message:
          "RPC save_project_record indisponivel no banco. Aplique as migrations administrativas (especialmente 077_create_admin_write_rpcs.sql).",
      } as const;
    }

    const detailParts = [errorMessage, errorHint, errorDetails].filter(Boolean);
    return {
      ok: false,
      status: 500,
      message: detailParts.length > 0 ? `Falha ao salvar projeto. ${detailParts.join(" | ")}` : "Falha ao salvar projeto.",
    } as const;
  }

  const result = (data ?? {}) as ProjectSaveRpcResult;
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 500),
      message: result.message ?? "Falha ao salvar projeto.",
      reason: result.reason ?? null,
    } as const;
  }

  return { ok: true, updatedAt: result.updated_at ?? null } as const;
}

async function setProjectStatusViaRpc(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  projectId: string;
  action: "ACTIVATE" | "CANCEL";
  reason: string;
  expectedUpdatedAt: string | null;
}) {
  const { data, error } = await params.supabase.rpc("set_project_record_status", {
    p_tenant_id: params.tenantId,
    p_actor_user_id: params.actorUserId,
    p_project_id: params.projectId,
    p_action: params.action,
    p_reason: params.reason,
    p_expected_updated_at: params.expectedUpdatedAt,
  });

  if (error) {
    return { ok: false, status: 500, message: "Falha ao atualizar status do projeto." } as const;
  }

  const result = (data ?? {}) as ProjectSaveRpcResult;
  if (result.success !== true) {
    return {
      ok: false,
      status: Number(result.status ?? 500),
      message: result.message ?? "Falha ao atualizar status do projeto.",
      reason: result.reason ?? null,
    } as const;
  }

  return { ok: true, updatedAt: result.updated_at ?? null } as const;
}
export async function GET(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para consultar projetos.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const params = request.nextUrl.searchParams;

    const historyProjectId = normalizeText(params.get("historyProjectId"));
    if (historyProjectId) {
      const historyPage = Math.max(1, Number(params.get("historyPage") ?? 1));
      const historyPageSize = Math.min(20, Math.max(1, Number(params.get("historyPageSize") ?? 5)));
      const historyFrom = (historyPage - 1) * historyPageSize;
      const historyTo = historyFrom + historyPageSize - 1;

      const project = await fetchProjectById(supabase, appUser.tenant_id, historyProjectId);
      if (!project) {
        return NextResponse.json({ message: "Projeto nao encontrado." }, { status: 404 });
      }

      const { data: historyRows, error: historyError, count: historyCount } = await supabase
        .from("project_history")
        .select("id, change_type, changes, created_at, created_by", { count: "exact" })
        .eq("tenant_id", appUser.tenant_id)
        .eq("project_id", historyProjectId)
        .order("created_at", { ascending: false })
        .range(historyFrom, historyTo)
        .returns<ProjectHistoryRow[]>();

      if (historyError) {
        return NextResponse.json({ message: "Falha ao carregar historico do projeto." }, { status: 500 });
      }

      const creatorIds = Array.from(
        new Set((historyRows ?? []).map((item) => item.created_by).filter((value): value is string => Boolean(value))),
      );

      const { data: creators } = creatorIds.length
        ? await supabase
            .from("app_users")
            .select("id, display, login_name")
            .eq("tenant_id", appUser.tenant_id)
            .in("id", creatorIds)
            .returns<ProjectUserRow[]>()
        : { data: [] as ProjectUserRow[] };

      const creatorMap = buildUserDisplayMap(creators ?? []);

      return NextResponse.json({
        project: {
          id: project.id,
          sob: project.sob,
          isActive: project.is_active,
        },
        history: (historyRows ?? []).map((item) => ({
          id: item.id,
          changeType: item.change_type,
          createdAt: item.created_at,
          createdByName: item.created_by ? creatorMap.get(item.created_by) ?? "Nao identificado" : "Nao identificado",
          changes: normalizeHistoryChanges(item.changes),
        })),
        pagination: {
          page: historyPage,
          pageSize: historyPageSize,
          total: historyCount ?? 0,
        },
      });
    }

    const sob = normalizeText(params.get("sob"));
    const executionDate = normalizeText(params.get("executionDate"));
    const priority = normalizeText(params.get("priority"));
    const city = normalizeText(params.get("city"));
    const workCompletionStatus = normalizeProjectWorkCompletionStatusFilter(params.get("workCompletionStatus"));
    const sgdTypeId = normalizeUuid(params.get("sgdTypeId"));
    const page = Math.max(1, Number(params.get("page") ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(params.get("pageSize") ?? 20)));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const programmingFilteredProjectIdsResult = await fetchProjectIdsByProgrammingFiltersCompat({
      supabase,
      tenantId: appUser.tenant_id,
      workCompletionStatus,
      sgdTypeId,
    });

    if (programmingFilteredProjectIdsResult.error) {
      return NextResponse.json({ message: "Falha ao aplicar filtros de Programacao nos projetos." }, { status: 500 });
    }

    const { data, error, count } = await fetchProjectsPageCompat({
      supabase,
      tenantId: appUser.tenant_id,
      sob,
      executionDate,
      priority,
      city,
      programmingFilteredProjectIds: programmingFilteredProjectIdsResult.projectIds,
      from,
      to,
    });

    if (error) {
      return NextResponse.json({ message: "Falha ao listar projetos." }, { status: 500 });
    }

    const summaryResult = await fetchProjectsSummaryCompat({
      supabase,
      tenantId: appUser.tenant_id,
      sob,
      executionDate,
      priority,
      city,
      programmingFilteredProjectIds: programmingFilteredProjectIdsResult.projectIds,
    });

    if (summaryResult.error || !summaryResult.data) {
      return NextResponse.json({ message: "Falha ao consolidar resumo de projetos." }, { status: 500 });
    }

    const userIds = Array.from(
      new Set(
        (data ?? [])
          .flatMap((item) => [item.created_by, item.updated_by, item.canceled_by])
          .filter((value): value is string => Boolean(value)),
      ),
    );

    const { data: users } = userIds.length
      ? await supabase
          .from("app_users")
          .select("id, display, login_name")
          .eq("tenant_id", appUser.tenant_id)
          .in("id", userIds)
          .returns<ProjectUserRow[]>()
      : { data: [] as ProjectUserRow[] };

    const userMap = buildUserDisplayMap(users ?? []);
    const userLoginNameMap = buildUserLoginNameMap(users ?? []);

    return NextResponse.json({
      projects: (data ?? []).map((item) => ({
        id: item.id,
        sob: item.sob,
        fob: item.fob,
        serviceCenter: item.service_center_text ?? "Nao identificado",
        partner: item.partner_text ?? "Nao identificado",
        serviceType: item.service_type_text ?? "Nao identificado",
        executionDeadline: item.execution_deadline,
        priority: item.priority_text ?? "Nao identificado",
        estimatedValue: Number(item.estimated_value ?? 0),
        voltageLevel: item.voltage_level_text,
        projectSize: item.project_size_text,
        contractorResponsible: item.contractor_responsible_text ?? "Nao identificado",
        utilityResponsible: item.utility_responsible_text ?? "Nao identificado",
        utilityFieldManager: item.utility_field_manager_text ?? "Nao identificado",
        street: item.street,
        neighborhood: item.neighborhood,
        city: item.city_text ?? "Nao identificado",
        serviceDescription: item.service_description,
        observation: item.observation,
        isActive: Boolean(item.is_active),
        isTest: Boolean(item.is_test),
        hasLocacao: Boolean(item.has_locacao),
        cancellationReason: item.cancellation_reason,
        canceledAt: item.canceled_at,
        canceledByName: item.canceled_by ? userMap.get(item.canceled_by) ?? "Nao identificado" : null,
        createdByName: item.created_by
          ? userLoginNameMap.get(item.created_by) ?? "Nao identificado"
          : "Nao identificado",
        updatedByName: item.updated_by ? userMap.get(item.updated_by) ?? "Nao identificado" : "Nao identificado",
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      })),
      pagination: {
        page,
        pageSize,
        total: count ?? 0,
      },
      summary: summaryResult.data,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao listar projetos." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para registrar projetos.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as Partial<CreateProjectPayload>;
    const input = parseProjectInput(body);

    const requiredError = validateRequiredProjectFields(input);
    if (requiredError) {
      return NextResponse.json({ message: requiredError }, { status: 400 });
    }

    const lookupResolution = await resolveProjectLookups(supabase, appUser.tenant_id, input);
    if (lookupResolution.message || !lookupResolution.data) {
      return NextResponse.json({ message: lookupResolution.message ?? "Falha ao validar cadastro." }, { status: 422 });
    }

    const insertPayload = buildProjectWritePayload(input, lookupResolution.data);

    const saveResult = await saveProjectViaRpc({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      projectId: null,
      payload: insertPayload,
    });

    if (!saveResult.ok) {
      return NextResponse.json({ message: saveResult.message, code: saveResult.reason ?? undefined }, { status: saveResult.status });
    }

    return NextResponse.json({
      success: true,
      message: `Projeto ${input.sob} registrado com sucesso.`,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao registrar projeto." }, { status: 500 });
  }
}
export async function PUT(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para editar projetos.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as Partial<UpdateProjectPayload>;
    const projectId = normalizeText(body.id);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(body.expectedUpdatedAt);

    if (!projectId) {
      return NextResponse.json({ message: "Projeto invalido para edicao." }, { status: 400 });
    }

    if (!expectedUpdatedAt) {
      return NextResponse.json({ message: "Atualize a lista antes de editar o projeto." }, { status: 400 });
    }

    const currentProject = await fetchProjectById(supabase, appUser.tenant_id, projectId);
    if (!currentProject) {
      return NextResponse.json({ message: "Projeto nao encontrado." }, { status: 404 });
    }

    if (!currentProject.is_active) {
      return buildConcurrencyConflictResponse("Projeto inativo nao pode ser editado.", "RECORD_INACTIVE");
    }

    if (hasUpdatedAtConflict(expectedUpdatedAt, currentProject.updated_at)) {
      return buildConcurrencyConflictResponse(
        `O projeto ${currentProject.sob} foi alterado por outro usuario. Recarregue os dados antes de salvar novamente.`,
      );
    }

    const input = parseProjectInput(body);
    const requiredError = validateRequiredProjectFields(input);
    if (requiredError) {
      return NextResponse.json({ message: requiredError }, { status: 400 });
    }

    const lookupResolution = await resolveProjectLookups(supabase, appUser.tenant_id, input);
    if (lookupResolution.message || !lookupResolution.data) {
      return NextResponse.json({ message: lookupResolution.message ?? "Falha ao validar edicao." }, { status: 422 });
    }

    const updatePayload = buildProjectWritePayload(input, lookupResolution.data);
    const changes = buildProjectUpdateChanges(currentProject, input, lookupResolution.data);

    if (Object.keys(changes).length === 0) {
      return NextResponse.json({ success: true, message: `Nenhuma alteracao detectada no projeto ${currentProject.sob}.` });
    }

    const saveResult = await saveProjectViaRpc({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      projectId,
      payload: updatePayload,
      changes,
      expectedUpdatedAt,
    });

    if (!saveResult.ok) {
      return NextResponse.json({ message: saveResult.message, code: saveResult.reason ?? undefined }, { status: saveResult.status });
    }

    return NextResponse.json({
      success: true,
      message: `Projeto ${updatePayload.sob} atualizado com sucesso.`,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao editar projeto." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para atualizar status de projetos.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as Partial<CancelProjectPayload>;
    const projectId = normalizeText(body.id);
    const reason = normalizeText(body.reason);
    const action = normalizeText(body.action).toUpperCase() === "ACTIVATE" ? "ACTIVATE" : "CANCEL";
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(body.expectedUpdatedAt);

    if (!projectId) {
      return NextResponse.json({ message: "Projeto invalido para atualizar status." }, { status: 400 });
    }

    if (!expectedUpdatedAt) {
      return NextResponse.json({ message: "Atualize a lista antes de alterar o status do projeto." }, { status: 400 });
    }

    if (!reason) {
      return NextResponse.json(
        { message: action === "ACTIVATE" ? "Informe o motivo da ativacao." : "Informe o motivo do cancelamento." },
        { status: 400 },
      );
    }

    const currentProject = await fetchProjectById(supabase, appUser.tenant_id, projectId);
    if (!currentProject) {
      return NextResponse.json({ message: "Projeto nao encontrado." }, { status: 404 });
    }

    if (action === "CANCEL" && !currentProject.is_active) {
      return buildConcurrencyConflictResponse(`Projeto ${currentProject.sob} ja esta inativo.`, "STATUS_ALREADY_CHANGED");
    }

    if (action === "ACTIVATE" && currentProject.is_active) {
      return buildConcurrencyConflictResponse(`Projeto ${currentProject.sob} ja esta ativo.`, "STATUS_ALREADY_CHANGED");
    }

    if (hasUpdatedAtConflict(expectedUpdatedAt, currentProject.updated_at)) {
      return buildConcurrencyConflictResponse(
        `O projeto ${currentProject.sob} foi alterado por outro usuario. Recarregue os dados antes de alterar o status.`,
      );
    }

    if (action === "CANCEL") {
      const { count: programmingCount, error: programmingGuardError } = await supabase
        .from("project_programming")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", appUser.tenant_id)
        .eq("project_id", projectId)
        .in("status", ["PROGRAMADA", "REPROGRAMADA", "ADIADA"]);

      if (programmingGuardError) {
        return NextResponse.json({ message: "Falha ao validar programacoes vinculadas ao projeto." }, { status: 500 });
      }

      if ((programmingCount ?? 0) > 0) {
        return NextResponse.json(
          {
            message: `Projeto ${currentProject.sob} possui programacoes programadas, reprogramadas ou adiadas. Resolva essas etapas antes de inativar o projeto.`,
          },
          { status: 409 },
        );
      }
    }

    const statusResult = await setProjectStatusViaRpc({
      supabase,
      tenantId: appUser.tenant_id,
      actorUserId: appUser.id,
      projectId,
      action,
      reason,
      expectedUpdatedAt,
    });

    if (!statusResult.ok) {
      return NextResponse.json({ message: statusResult.message, code: statusResult.reason ?? undefined }, { status: statusResult.status });
    }

    return NextResponse.json({
      success: true,
      message:
        action === "ACTIVATE"
          ? `Projeto ${currentProject.sob} ativado com sucesso.`
          : `Projeto ${currentProject.sob} cancelado com sucesso.`,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao atualizar status do projeto." }, { status: 500 });
  }
}
