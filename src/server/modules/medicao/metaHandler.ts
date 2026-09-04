// Metadados das telas de Medicao (tecnica e comercial): motivos sem producao,
// tipos de servico, catalogo de conclusao, e as fontes de filtro (projetos e
// equipes da categoria da tela). Handler compartilhado — a rota so delega.
import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";
import { authorizePageAction } from "@/lib/server/routeAuthorization";

import { DEFAULT_MEASUREMENT_ROUTE_CONFIG, type MeasurementRouteConfig } from "./routeConfig";

type NoProductionReasonRow = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  sort_order: number | null;
};

type WorkCompletionCatalogRow = {
  id: string;
  code: string;
  label_pt: string | null;
  is_active: boolean;
  sort_order: number | null;
};

type ProjectServiceTypeRow = {
  id: string;
  name: string;
};

type ProjectSourceRow = {
  id: string;
  sob: string | null;
  service_description: string | null;
  service_type_text: string | null;
};

type TeamSourceRow = {
  id: string;
  name: string | null;
  team_category_id: string | null;
};

type TeamCategoryRow = {
  id: string;
  code: string | null;
};

type ElectricianRow = {
  id: string;
  nome: string | null;
};

type CommercialProcessRow = {
  id: string;
  name: string | null;
};

function normalizeReasonKey(value: unknown) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

function dedupeNoProductionReasons(items: NoProductionReasonRow[]) {
  const byName = new Map<string, NoProductionReasonRow>();
  for (const item of items) {
    const key = normalizeReasonKey(item.name);
    if (!key || byName.has(key)) continue;
    byName.set(key, item);
  }
  return Array.from(byName.values());
}

const PROJECT_SOURCE_SELECT = "id, sob, service_description, service_type_text";

// Fontes de projeto/equipe para os filtros da tela `medicao-visualizacao`. A tela de
// cadastro carrega fontes de Programacao pelo endpoint proprio
// `/api/medicao/programming-sources`, sem herdar permissao da tela de Programacao.
// So entra quando pedido por `?includeSources=1`, para nao aumentar o egress da tela
// de cadastro.
async function fetchFilterSources(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  teamCategoryCode: "TECNICA" | "COMERCIAL";
}) {
  const categoryResult = await params.supabase
    .from("team_categories")
    .select("id, code")
    .eq("tenant_id", params.tenantId)
    .eq("ativo", true)
    .eq("code", params.teamCategoryCode)
    .maybeSingle<TeamCategoryRow>();

  const projectQuery = params.supabase
    .from("project_with_labels")
    .select(PROJECT_SOURCE_SELECT)
    .eq("tenant_id", params.tenantId)
    .eq("is_active", true)
    .order("sob", { ascending: true });

  const [projectResult, teamResult] = await Promise.all([
    projectQuery
      .eq("is_test", false)
      .eq("is_third_party", false)
      .returns<ProjectSourceRow[]>(),
    params.supabase
      .from("teams")
      .select("id, name, team_category_id")
      .eq("tenant_id", params.tenantId)
      .eq("ativo", true)
      // Tenant sem a categoria cadastrada devolve lista vazia em vez de todas as
      // equipes: o UUID sentinela mantem as duas consultas em paralelo sem
      // precisar de um segundo round-trip so para descobrir se ha categoria.
      .eq("team_category_id", categoryResult.data?.id ?? "00000000-0000-0000-0000-000000000000")
      .order("name", { ascending: true })
      .returns<TeamSourceRow[]>(),
  ]);

  // Tolerancia herdada do `fetchProjects` da Programacao antiga (removida no C8):
  // bases sem as colunas de obra de teste caem no recorte legado por `is_active`.
  const projectRows = projectResult.error
    ? (await params.supabase
        .from("project_with_labels")
        .select(PROJECT_SOURCE_SELECT)
        .eq("tenant_id", params.tenantId)
        .eq("is_active", true)
        .order("sob", { ascending: true })
        .returns<ProjectSourceRow[]>()).data ?? []
    : projectResult.data ?? [];

  return {
    projects: projectRows.map((item) => ({
      id: item.id,
      code: String(item.sob ?? "").trim(),
      serviceName: String(item.service_description ?? "").trim()
        || String(item.service_type_text ?? "").trim()
        || "Sem descricao",
    })),
    teams: (teamResult.error ? [] : teamResult.data ?? []).map((item) => ({
      id: item.id,
      name: String(item.name ?? "").trim(),
    })),
  };
}

async function fetchElectricians(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
}) {
  const { data: jobTitles, error: jobTitleError } = await params.supabase
    .from("job_titles")
    .select("id")
    .eq("tenant_id", params.tenantId)
    .eq("ativo", true)
    .or("code.ilike.%ELETRICISTA%,name.ilike.%ELETRICISTA%")
    .returns<Array<{ id: string }>>();

  if (jobTitleError || !jobTitles?.length) {
    return [] as Array<{ id: string; name: string }>;
  }

  const { data, error } = await params.supabase
    .from("people")
    .select("id, nome")
    .eq("tenant_id", params.tenantId)
    .eq("ativo", true)
    .in("job_title_id", jobTitles.map((item) => item.id))
    .order("nome", { ascending: true })
    .returns<ElectricianRow[]>();

  if (error) {
    return [] as Array<{ id: string; name: string }>;
  }

  return (data ?? [])
    .map((item) => ({ id: item.id, name: String(item.nome ?? "").trim() }))
    .filter((item) => Boolean(item.id) && Boolean(item.name));
}

// Catalogo do campo `Processo` da Medicao Comercial. Nao tem tela de cadastro:
// nasce semeado pela migration 415 e cresce por SQL.
async function fetchCommercialProcesses(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
}) {
  const { data, error } = await params.supabase
    .from("measurement_commercial_processes")
    .select("id, name")
    .eq("tenant_id", params.tenantId)
    .eq("ativo", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
    .returns<CommercialProcessRow[]>();

  if (error) {
    return [] as Array<{ id: string; name: string }>;
  }

  return (data ?? [])
    .map((item) => ({ id: item.id, name: String(item.name ?? "").trim() }))
    .filter((item) => Boolean(item.id) && Boolean(item.name));
}

export async function handleMeasurementMetaGet(
  request: NextRequest,
  config: MeasurementRouteConfig = DEFAULT_MEASUREMENT_ROUTE_CONFIG,
) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para carregar metadados da medicao.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const authorizationError = await authorizePageAction(resolution, config.pageKey, "read");
  if (authorizationError) {
    return authorizationError;
  }

  const [noProductionReasonResult, projectServiceTypesResult, workCompletionCatalogResult] = await Promise.all([
    resolution.supabase
      .from("measurement_no_production_reasons")
      .select("id, code, name, is_active, sort_order")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
      .returns<NoProductionReasonRow[]>(),
    resolution.supabase
      .from("project_service_types")
      .select("id, name")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("ativo", true)
      .order("name", { ascending: true })
      .returns<ProjectServiceTypeRow[]>(),
    resolution.supabase
      .from("programming_work_completion_catalog")
      .select("id, code, label_pt, is_active, sort_order")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("label_pt", { ascending: true })
      .returns<WorkCompletionCatalogRow[]>(),
  ]);

  if (noProductionReasonResult.error) {
    return NextResponse.json({ message: "Falha ao carregar motivos de sem producao da medicao." }, { status: 500 });
  }

  if (projectServiceTypesResult.error) {
    return NextResponse.json({ message: "Falha ao carregar tipos de servico dos projetos." }, { status: 500 });
  }

  const noProductionReasons = dedupeNoProductionReasons(noProductionReasonResult.data ?? []);
  const workCompletionCatalog = workCompletionCatalogResult.error
    ? []
    : (workCompletionCatalogResult.data ?? []);

  const includeSources = request.nextUrl.searchParams.get("includeSources") === "1";
  const sources = includeSources
    ? await fetchFilterSources({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        teamCategoryCode: config.teamCategoryCode,
      })
    : null;
  const [electricians, commercialProcesses] = config.commercial
    ? await Promise.all([
        fetchElectricians({
          supabase: resolution.supabase,
          tenantId: resolution.appUser.tenant_id,
        }),
        fetchCommercialProcesses({
          supabase: resolution.supabase,
          tenantId: resolution.appUser.tenant_id,
        }),
      ])
    : [[], []];

  return NextResponse.json({
    ...(sources ? { projects: sources.projects, teams: sources.teams } : {}),
    ...(config.commercial ? { electricians, commercialProcesses } : {}),
    noProductionReasons: noProductionReasons.map((item) => ({
      id: item.id,
      code: String(item.code ?? "").trim(),
      name: String(item.name ?? "").trim(),
    })),
    projectServiceTypes: (projectServiceTypesResult.data ?? []).map((item) => ({
      id: item.id,
      name: String(item.name ?? "").trim(),
    })),
    workCompletionCatalog: workCompletionCatalog.map((item) => ({
      code: String(item.code ?? "").trim().toUpperCase(),
      label: String(item.label_pt ?? "").trim() || String(item.code ?? "").trim().toUpperCase(),
    })),
  });
}

