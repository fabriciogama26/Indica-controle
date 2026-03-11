
import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";

type ProjectRow = {
  id: string;
  sob: string;
  service_center: string;
  partner: string;
  service_type: string;
  execution_deadline: string;
  priority: string;
  estimated_value: number;
  voltage_level: string | null;
  project_size: string | null;
  contractor_responsible: string;
  utility_responsible: string;
  utility_field_manager: string;
  street: string;
  neighborhood: string;
  city: string;
  service_description: string | null;
  observation: string | null;
  is_active: boolean;
  cancellation_reason: string | null;
  canceled_at: string | null;
  canceled_by: string | null;
  priority_id: string;
  service_center_id: string;
  service_type_id: string;
  voltage_level_id: string | null;
  project_size_id: string | null;
  municipality_id: string;
  contractor_responsible_id: string;
  utility_responsible_id: string;
  utility_field_manager_id: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

type ProjectSummaryRow = Omit<
  ProjectRow,
  | "priority_id"
  | "service_center_id"
  | "service_type_id"
  | "voltage_level_id"
  | "project_size_id"
  | "municipality_id"
  | "contractor_responsible_id"
  | "utility_responsible_id"
  | "utility_field_manager_id"
>;

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
};

type UpdateProjectPayload = CreateProjectPayload & {
  id: string;
};

type CancelProjectPayload = {
  id: string;
  reason: string;
};

type ProjectHistoryRow = {
  id: string;
  change_type: "UPDATE" | "CANCEL";
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
};

type ResolvedProjectLookups = {
  partnerName: string;
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

const PRIORITY_A_PREFIX = new Set(["GRUPO B - FLUXO", "DRP / DRC", "GRUPO A - FLUXO"]);

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

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getSobRuleError(priority: string, sob: string) {
  if (PRIORITY_A_PREFIX.has(priority) && !/^A[0-9]{9}$/.test(sob)) {
    return "Para esta prioridade, Projeto (SOB) deve iniciar com A e conter 9 numeros.";
  }

  if (priority === "FUSESAVER" && !/^(ZX|FS)[0-9]{8}$/.test(sob)) {
    return "Para FUSESAVER, Projeto (SOB) deve iniciar com ZX ou FS e conter 8 numeros.";
  }

  return null;
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
    .select("name")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .maybeSingle<ContractRow>();

  const partnerName = String(data?.name ?? "").trim();
  if (error || !partnerName) {
    return {
      name: null,
      message: "Nao foi encontrado contrato ativo com campo name para preencher Parceira automaticamente.",
    };
  }

  return { name: partnerName, message: null };
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
      partnerName: String(partnerFromContract.name),
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
  updatedBy: string,
) {
  return {
    sob: input.sob,
    service_center: lookups.serviceCenter.name,
    partner: lookups.partnerName,
    service_type: lookups.serviceType.name,
    execution_deadline: input.executionDeadline,
    priority: lookups.priority.name,
    estimated_value: input.estimatedValue,
    voltage_level: lookups.voltageLevel ? lookups.voltageLevel.name : null,
    project_size: lookups.projectSize ? lookups.projectSize.name : null,
    contractor_responsible: lookups.contractorResponsible.name,
    utility_responsible: lookups.utilityResponsible.name,
    utility_field_manager: lookups.utilityFieldManager.name,
    street: input.street,
    neighborhood: input.neighborhood,
    city: lookups.municipality.name,
    priority_id: lookups.priority.id,
    service_center_id: lookups.serviceCenter.id,
    service_type_id: lookups.serviceType.id,
    voltage_level_id: lookups.voltageLevel?.id ?? null,
    project_size_id: lookups.projectSize?.id ?? null,
    municipality_id: lookups.municipality.id,
    contractor_responsible_id: lookups.contractorResponsible.id,
    utility_responsible_id: lookups.utilityResponsible.id,
    utility_field_manager_id: lookups.utilityFieldManager.id,
    service_description: input.serviceDescription,
    observation: input.observation,
    updated_by: updatedBy,
  };
}

function buildProjectUpdateChanges(current: ProjectRow, next: ReturnType<typeof buildProjectWritePayload>) {
  const changes: Record<string, HistoryChange> = {};

  addChange(changes, "priority", current.priority, next.priority);
  addChange(changes, "sob", current.sob, next.sob);
  addChange(changes, "serviceCenter", current.service_center, next.service_center);
  addChange(changes, "serviceType", current.service_type, next.service_type);
  addChange(changes, "executionDeadline", current.execution_deadline, next.execution_deadline);
  addChange(changes, "estimatedValue", current.estimated_value, next.estimated_value);
  addChange(changes, "voltageLevel", current.voltage_level, next.voltage_level);
  addChange(changes, "projectSize", current.project_size, next.project_size);
  addChange(changes, "contractorResponsible", current.contractor_responsible, next.contractor_responsible);
  addChange(changes, "utilityResponsible", current.utility_responsible, next.utility_responsible);
  addChange(changes, "utilityFieldManager", current.utility_field_manager, next.utility_field_manager);
  addChange(changes, "city", current.city, next.city);
  addChange(changes, "street", current.street, next.street);
  addChange(changes, "neighborhood", current.neighborhood, next.neighborhood);
  addChange(changes, "serviceDescription", current.service_description, next.service_description);
  addChange(changes, "observation", current.observation, next.observation);
  addChange(changes, "partner", current.partner, next.partner);

  return changes;
}

async function fetchProjectById(supabase: SupabaseClient, tenantId: string, projectId: string) {
  const { data, error } = await supabase
    .from("project")
    .select(
      "id, sob, service_center, partner, service_type, execution_deadline, priority, estimated_value, voltage_level, project_size, contractor_responsible, utility_responsible, utility_field_manager, street, neighborhood, city, service_description, observation, is_active, cancellation_reason, canceled_at, canceled_by, priority_id, service_center_id, service_type_id, voltage_level_id, project_size_id, municipality_id, contractor_responsible_id, utility_responsible_id, utility_field_manager_id, created_by, updated_by, created_at, updated_at",
    )
    .eq("tenant_id", tenantId)
    .eq("id", projectId)
    .maybeSingle<ProjectRow>();

  if (error || !data) {
    return null;
  }

  return data;
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
      const project = await fetchProjectById(supabase, appUser.tenant_id, historyProjectId);
      if (!project) {
        return NextResponse.json({ message: "Projeto nao encontrado." }, { status: 404 });
      }

      const { data: historyRows, error: historyError } = await supabase
        .from("project_history")
        .select("id, change_type, changes, created_at, created_by")
        .eq("tenant_id", appUser.tenant_id)
        .eq("project_id", historyProjectId)
        .order("created_at", { ascending: false })
        .limit(200)
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
      });
    }

    const sob = normalizeText(params.get("sob"));
    const executionDate = normalizeText(params.get("executionDate"));
    const priority = normalizeText(params.get("priority"));
    const city = normalizeText(params.get("city"));
    const page = Math.max(1, Number(params.get("page") ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(params.get("pageSize") ?? 20)));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from("project")
      .select(
        "id, sob, service_center, partner, service_type, execution_deadline, priority, estimated_value, voltage_level, project_size, contractor_responsible, utility_responsible, utility_field_manager, street, neighborhood, city, service_description, observation, is_active, cancellation_reason, canceled_at, canceled_by, created_by, updated_by, created_at, updated_at",
        { count: "exact" },
      )
      .eq("tenant_id", appUser.tenant_id);

    if (sob) {
      query = query.ilike("sob", `%${sob}%`);
    }
    if (executionDate && isIsoDate(executionDate)) {
      query = query.eq("execution_deadline", executionDate);
    }
    if (priority) {
      query = query.eq("priority", priority);
    }
    if (city) {
      query = query.eq("city", city);
    }

    const { data, error, count } = await query
      .order("is_active", { ascending: false })
      .order("execution_deadline", { ascending: true })
      .order("created_at", { ascending: false })
      .range(from, to)
      .returns<ProjectSummaryRow[]>();

    if (error) {
      return NextResponse.json({ message: "Falha ao listar projetos." }, { status: 500 });
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

    return NextResponse.json({
      projects: (data ?? []).map((item) => ({
        id: item.id,
        sob: item.sob,
        serviceCenter: item.service_center,
        partner: item.partner,
        serviceType: item.service_type,
        executionDeadline: item.execution_deadline,
        priority: item.priority,
        estimatedValue: Number(item.estimated_value ?? 0),
        voltageLevel: item.voltage_level,
        projectSize: item.project_size,
        contractorResponsible: item.contractor_responsible,
        utilityResponsible: item.utility_responsible,
        utilityFieldManager: item.utility_field_manager,
        street: item.street,
        neighborhood: item.neighborhood,
        city: item.city,
        serviceDescription: item.service_description,
        observation: item.observation,
        isActive: Boolean(item.is_active),
        cancellationReason: item.cancellation_reason,
        canceledAt: item.canceled_at,
        canceledByName: item.canceled_by ? userMap.get(item.canceled_by) ?? "Nao identificado" : null,
        createdByName: item.created_by ? userMap.get(item.created_by) ?? "Nao identificado" : "Nao identificado",
        updatedByName: item.updated_by ? userMap.get(item.updated_by) ?? "Nao identificado" : "Nao identificado",
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      })),
      pagination: {
        page,
        pageSize,
        total: count ?? 0,
      },
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

    const sobRuleError = getSobRuleError(normalizePriority(lookupResolution.data.priority.name), input.sob);
    if (sobRuleError) {
      return NextResponse.json({ message: sobRuleError }, { status: 422 });
    }

    const insertPayload = buildProjectWritePayload(input, lookupResolution.data, appUser.id);

    const { error } = await supabase.from("project").insert({
      tenant_id: appUser.tenant_id,
      ...insertPayload,
      is_active: true,
      cancellation_reason: null,
      canceled_at: null,
      canceled_by: null,
      created_by: appUser.id,
      updated_by: appUser.id,
    });

    if (error) {
      if (String(error.message ?? "").toLowerCase().includes("duplicate key")) {
        return NextResponse.json({ message: "Ja existe projeto com este SOB no tenant atual." }, { status: 409 });
      }

      return NextResponse.json({ message: "Falha ao registrar projeto." }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: "Projeto registrado com sucesso.",
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

    if (!projectId) {
      return NextResponse.json({ message: "Projeto invalido para edicao." }, { status: 400 });
    }

    const currentProject = await fetchProjectById(supabase, appUser.tenant_id, projectId);
    if (!currentProject) {
      return NextResponse.json({ message: "Projeto nao encontrado." }, { status: 404 });
    }

    if (!currentProject.is_active) {
      return NextResponse.json({ message: "Projeto inativo nao pode ser editado." }, { status: 409 });
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

    const sobRuleError = getSobRuleError(normalizePriority(lookupResolution.data.priority.name), input.sob);
    if (sobRuleError) {
      return NextResponse.json({ message: sobRuleError }, { status: 422 });
    }

    const updatePayload = buildProjectWritePayload(input, lookupResolution.data, appUser.id);
    const changes = buildProjectUpdateChanges(currentProject, updatePayload);

    if (Object.keys(changes).length === 0) {
      return NextResponse.json({ success: true, message: "Nenhuma alteracao detectada." });
    }

    const { error: updateError } = await supabase
      .from("project")
      .update({
        ...updatePayload,
        updated_by: appUser.id,
      })
      .eq("tenant_id", appUser.tenant_id)
      .eq("id", projectId);

    if (updateError) {
      if (String(updateError.message ?? "").toLowerCase().includes("duplicate key")) {
        return NextResponse.json({ message: "Ja existe projeto com este SOB no tenant atual." }, { status: 409 });
      }

      return NextResponse.json({ message: "Falha ao editar projeto." }, { status: 500 });
    }

    const { error: historyError } = await supabase.from("project_history").insert({
      tenant_id: appUser.tenant_id,
      project_id: projectId,
      change_type: "UPDATE",
      changes,
      created_by: appUser.id,
      updated_by: appUser.id,
    });

    if (historyError) {
      return NextResponse.json({ message: "Projeto atualizado, mas falhou ao registrar historico." }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: "Projeto atualizado com sucesso.",
    });
  } catch {
    return NextResponse.json({ message: "Falha ao editar projeto." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para cancelar projetos.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const { supabase, appUser } = resolution;
    const body = (await request.json().catch(() => ({}))) as Partial<CancelProjectPayload>;
    const projectId = normalizeText(body.id);
    const reason = normalizeText(body.reason);

    if (!projectId) {
      return NextResponse.json({ message: "Projeto invalido para cancelamento." }, { status: 400 });
    }

    if (!reason) {
      return NextResponse.json({ message: "Informe o motivo do cancelamento." }, { status: 400 });
    }

    const currentProject = await fetchProjectById(supabase, appUser.tenant_id, projectId);
    if (!currentProject) {
      return NextResponse.json({ message: "Projeto nao encontrado." }, { status: 404 });
    }

    if (!currentProject.is_active) {
      return NextResponse.json({ message: "Projeto ja esta inativo." }, { status: 409 });
    }

    const canceledAt = new Date().toISOString();

    const { error: cancelError } = await supabase
      .from("project")
      .update({
        is_active: false,
        cancellation_reason: reason,
        canceled_at: canceledAt,
        canceled_by: appUser.id,
        updated_by: appUser.id,
      })
      .eq("tenant_id", appUser.tenant_id)
      .eq("id", projectId);

    if (cancelError) {
      return NextResponse.json({ message: "Falha ao cancelar projeto." }, { status: 500 });
    }

    const { error: cancellationHistoryError } = await supabase.from("project_cancellation_history").insert({
      tenant_id: appUser.tenant_id,
      project_id: projectId,
      reason,
      created_by: appUser.id,
      updated_by: appUser.id,
    });

    if (cancellationHistoryError) {
      return NextResponse.json(
        { message: "Projeto cancelado, mas falhou ao registrar historico de cancelamento." },
        { status: 500 },
      );
    }

    const cancelChanges: Record<string, HistoryChange> = {
      isActive: {
        from: "true",
        to: "false",
      },
      cancellationReason: {
        from: null,
        to: reason,
      },
      canceledAt: {
        from: null,
        to: canceledAt,
      },
    };

    const { error: historyError } = await supabase.from("project_history").insert({
      tenant_id: appUser.tenant_id,
      project_id: projectId,
      change_type: "CANCEL",
      changes: cancelChanges,
      created_by: appUser.id,
      updated_by: appUser.id,
    });

    if (historyError) {
      return NextResponse.json({ message: "Projeto cancelado, mas falhou ao registrar historico do projeto." }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: "Projeto cancelado com sucesso.",
    });
  } catch {
    return NextResponse.json({ message: "Falha ao cancelar projeto." }, { status: 500 });
  }
}
