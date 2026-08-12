import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";

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
}) {
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
      .select("id, name")
      .eq("tenant_id", params.tenantId)
      .eq("ativo", true)
      .order("name", { ascending: true })
      .returns<TeamSourceRow[]>(),
  ]);

  // Mesma tolerancia de `fetchProjects` (server/modules/programacao/catalogs.ts):
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

export async function GET(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para carregar metadados da medicao.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
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
      })
    : null;

  return NextResponse.json({
    ...(sources ? { projects: sources.projects, teams: sources.teams } : {}),
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
