import { NextRequest, NextResponse } from "next/server";

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

    const sobRuleError = getSobRuleError(priority, sob);
    if (sobRuleError) {
      return NextResponse.json({ message: sobRuleError }, { status: 422 });
    }

    const { error } = await supabase.from("project").insert({
      tenant_id: appUser.tenant_id,
      sob,
      service_center: serviceCenter,
      partner,
      service_type: serviceType,
      execution_deadline: executionDeadline,
      priority,
      estimated_value: estimatedValue,
      voltage_level: voltageLevel,
      project_size: projectSize,
      contractor_responsible: contractorResponsible,
      utility_responsible: utilityResponsible,
      utility_field_manager: utilityFieldManager,
      street,
      neighborhood,
      city,
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
