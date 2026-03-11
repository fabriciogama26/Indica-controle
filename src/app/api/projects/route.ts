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
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type ProjectCreatorRow = {
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

type CreateProjectPayload = {
  sob: string;
  serviceCenter: string;
  partner: string;
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
        "id, sob, service_center, partner, service_type, execution_deadline, priority, estimated_value, voltage_level, project_size, contractor_responsible, utility_responsible, utility_field_manager, street, neighborhood, city, service_description, observation, created_by, created_at, updated_at",
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
      .order("execution_deadline", { ascending: true })
      .order("created_at", { ascending: false })
      .range(from, to)
      .returns<ProjectRow[]>();

    if (error) {
      return NextResponse.json({ message: "Falha ao listar projetos." }, { status: 500 });
    }

    const creatorIds = Array.from(
      new Set((data ?? []).map((item) => item.created_by).filter((value): value is string => Boolean(value))),
    );

    const { data: creators } = creatorIds.length
      ? await supabase
          .from("app_users")
          .select("id, display, login_name")
          .eq("tenant_id", appUser.tenant_id)
          .in("id", creatorIds)
          .returns<ProjectCreatorRow[]>()
      : { data: [] };

    const creatorMap = new Map(
      (creators ?? []).map((creator) => [
        creator.id,
        String(creator.display ?? creator.login_name ?? "").trim() || "Nao identificado",
      ]),
    );

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
        createdByName: item.created_by ? creatorMap.get(item.created_by) ?? "Nao identificado" : "Nao identificado",
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

    const sob = normalizeSob(body.sob);
    const serviceCenter = normalizeText(body.serviceCenter);
    const partner = normalizeText(body.partner);
    const serviceType = normalizeText(body.serviceType);
    const executionDeadline = normalizeText(body.executionDeadline);
    const priority = normalizePriority(body.priority);
    const estimatedValue = normalizeEstimatedValue(body.estimatedValue);
    const voltageLevel = normalizeNullableText(body.voltageLevel);
    const projectSize = normalizeNullableText(body.projectSize);
    const contractorResponsible = normalizeText(body.contractorResponsible);
    const utilityResponsible = normalizeText(body.utilityResponsible);
    const utilityFieldManager = normalizeText(body.utilityFieldManager);
    const street = normalizeText(body.street);
    const neighborhood = normalizeText(body.neighborhood);
    const city = normalizeText(body.city);
    const serviceDescription = normalizeNullableText(body.serviceDescription);
    const observation = normalizeNullableText(body.observation);

    if (
      !sob ||
      !serviceCenter ||
      !partner ||
      !serviceType ||
      !executionDeadline ||
      !priority ||
      estimatedValue === null ||
      !contractorResponsible ||
      !utilityResponsible ||
      !utilityFieldManager ||
      !street ||
      !neighborhood ||
      !city
    ) {
      return NextResponse.json({ message: "Preencha todos os campos obrigatorios do projeto." }, { status: 400 });
    }

    if (!isIsoDate(executionDeadline)) {
      return NextResponse.json({ message: "Data limite invalida." }, { status: 422 });
    }

    const [
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
      resolveLookupByName(supabase, "project_priorities", appUser.tenant_id, priority, true, "a Prioridade"),
      resolveLookupByName(supabase, "project_service_centers", appUser.tenant_id, serviceCenter, true, "o Centro de Servico"),
      resolveLookupByName(supabase, "project_service_types", appUser.tenant_id, serviceType, true, "o Tipo de Servico"),
      resolveLookupByName(supabase, "project_voltage_levels", appUser.tenant_id, voltageLevel ?? "", false, "o Nivel de Tensao"),
      resolveLookupByName(supabase, "project_sizes", appUser.tenant_id, projectSize ?? "", false, "o Porte"),
      resolveLookupByName(supabase, "project_municipalities", appUser.tenant_id, city, true, "o Municipio"),
      resolveContractorResponsibleSupervisorByName(
        supabase,
        appUser.tenant_id,
        contractorResponsible,
        true,
        "o Responsavel Contratada (Supervisor)",
      ),
      resolveLookupByName(
        supabase,
        "project_utility_responsibles",
        appUser.tenant_id,
        utilityResponsible,
        true,
        "o Responsavel Distribuidora",
      ),
      resolveLookupByName(
        supabase,
        "project_utility_field_managers",
        appUser.tenant_id,
        utilityFieldManager,
        true,
        "o Gestor de campo Distribuidora",
      ),
    ]);

    const lookupMessage =
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
      return NextResponse.json({ message: lookupMessage }, { status: 422 });
    }

    const sobRuleError = getSobRuleError(normalizePriority(priorityLookup.data?.name ?? priority), sob);
    if (sobRuleError) {
      return NextResponse.json({ message: sobRuleError }, { status: 422 });
    }

    const { error } = await supabase.from("project").insert({
      tenant_id: appUser.tenant_id,
      sob,
      service_center: String(serviceCenterLookup.data?.name ?? serviceCenter),
      partner,
      service_type: String(serviceTypeLookup.data?.name ?? serviceType),
      execution_deadline: executionDeadline,
      priority: String(priorityLookup.data?.name ?? priority),
      estimated_value: estimatedValue,
      voltage_level: voltageLevelLookup.data ? String(voltageLevelLookup.data.name) : null,
      project_size: projectSizeLookup.data ? String(projectSizeLookup.data.name) : null,
      contractor_responsible: String(contractorResponsibleLookup.data?.name ?? contractorResponsible),
      utility_responsible: String(utilityResponsibleLookup.data?.name ?? utilityResponsible),
      utility_field_manager: String(utilityFieldManagerLookup.data?.name ?? utilityFieldManager),
      street,
      neighborhood,
      city: String(municipalityLookup.data?.name ?? city),
      priority_id: priorityLookup.data?.id,
      service_center_id: serviceCenterLookup.data?.id,
      service_type_id: serviceTypeLookup.data?.id,
      voltage_level_id: voltageLevelLookup.data?.id ?? null,
      project_size_id: projectSizeLookup.data?.id ?? null,
      municipality_id: municipalityLookup.data?.id,
      contractor_responsible_id: contractorResponsibleLookup.data?.id,
      utility_responsible_id: utilityResponsibleLookup.data?.id,
      utility_field_manager_id: utilityFieldManagerLookup.data?.id,
      service_description: serviceDescription,
      observation,
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
