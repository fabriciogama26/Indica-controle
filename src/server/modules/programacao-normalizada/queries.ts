import { SupabaseClient } from "@supabase/supabase-js";

import { resolveAppUserName } from "./normalizers";
import { PROGRAMMING_STAGE_SELECT_WITH_CHILDREN } from "./selects";
import type {
  AppUserLookupRow,
  ProgrammingHistoryRow,
  ProgrammingStageListFilters,
  ProgrammingStageRow,
} from "./types";

// Resolve ids de app_users para display/login_name (autor de etapa/historico).
// usado por qualquer tela que precise exibir "Criado por"/"Atualizado por".
export async function fetchAppUsersByIds(params: { supabase: SupabaseClient; tenantId: string; ids: Array<string | null | undefined> }) {
  const uniqueIds = Array.from(new Set(params.ids.filter((value): value is string => Boolean(value))));
  if (!uniqueIds.length) return [] as AppUserLookupRow[];

  const { data, error } = await params.supabase
    .from("app_users")
    .select("id, display, login_name")
    .eq("tenant_id", params.tenantId)
    .in("id", uniqueIds)
    .returns<AppUserLookupRow[]>();

  if (error) return [] as AppUserLookupRow[];

  return data ?? [];
}

// Filtro por equipe e derivado (cruza programming_team antes da query principal),
// resolvido aqui e nao no dataset completo (guia_backend regra 25).
async function resolveStageIdsByTeamIds(params: { supabase: SupabaseClient; tenantId: string; teamIds: string[] }) {
  if (!params.teamIds.length) return null;

  const { data, error } = await params.supabase
    .from("programming_team")
    .select("programming_id")
    .eq("tenant_id", params.tenantId)
    .eq("status", "ATIVA")
    .in("team_id", params.teamIds)
    .returns<{ programming_id: string }[]>();

  if (error) return [];

  return Array.from(new Set((data ?? []).map((item) => item.programming_id)));
}

// Aplica o chip de status de forma identica no passo 1 (RPC, no banco) e no
// passo 2 (etapas dos projetos da pagina). Mantido em um lugar so para os dois
// passos nunca divergirem.
function applyStatusChipToStageQuery<Q extends {
  in(column: string, values: string[]): Q;
  eq(column: string, value: string | boolean): Q;
  lt(column: string, value: string): Q;
  or(filters: string): Q;
}>(query: Q, statusChip: ProgrammingStageListFilters["statusChip"], todayIso: string): Q {
  if (statusChip === "PROGRAMADAS") {
    return query.in("status", ["PROGRAMADA", "REPROGRAMADA"]);
  }
  if (statusChip === "PENDENCIAS") {
    // "Pendencias abertas" (achado 8): flag ligada E ativa E nao concluida.
    return query
      .eq("is_pendencia", true)
      .in("status", ["PROGRAMADA", "REPROGRAMADA"])
      .or("work_completion_status.is.null,work_completion_status.neq.CONCLUIDO");
  }
  if (statusChip === "ATRASADAS") {
    return query.in("status", ["PROGRAMADA", "REPROGRAMADA"]).lt("execution_date", todayIso);
  }
  if (statusChip === "ADIADAS") {
    return query.eq("status", "ADIADA");
  }
  return query;
}

// Lista cross-projeto paginada POR PROJETO (achado 14): o passo 1 pagina os
// project_id distintos que batem nos filtros (RPC programming_list_project_page,
// no banco); o passo 2 busca TODAS as etapas (matching) dos projetos da pagina,
// para nunca partir um projeto entre paginas e nao ter contador parcial.
// O select completo tambem serve de fonte para os exports (CSV/ENEL/ENEL NOVO).
export async function fetchProgrammingStageList(params: {
  supabase: SupabaseClient;
  filters: ProgrammingStageListFilters;
  projectIdsFromSearch: string[] | null;
}) {
  const { supabase, filters, projectIdsFromSearch } = params;

  if (projectIdsFromSearch !== null && !projectIdsFromSearch.length) {
    return { rows: [] as ProgrammingStageRow[], total: 0 };
  }

  const stageIdsFromTeamFilter = await resolveStageIdsByTeamIds({
    supabase,
    tenantId: filters.tenantId,
    teamIds: filters.teamIds,
  });

  if (stageIdsFromTeamFilter !== null && !stageIdsFromTeamFilter.length) {
    return { rows: [] as ProgrammingStageRow[], total: 0 };
  }

  const todayIso = new Date().toISOString().slice(0, 10);

  // Passo 1: projetos distintos (paginados) + total de projetos.
  const { data: projectPage, error: projectError } = await supabase.rpc("programming_list_project_page", {
    p_tenant_id: filters.tenantId,
    p_date_from: filters.dateFrom,
    p_date_to: filters.dateTo,
    p_project_ids: projectIdsFromSearch,
    p_stage_ids: stageIdsFromTeamFilter,
    p_status_chip: filters.statusChip,
    p_today: todayIso,
    p_page: filters.page,
    p_page_size: filters.pageSize,
  });

  if (projectError) {
    throw new Error(`Falha ao paginar projetos da Programacao Normalizada: ${projectError.message}`);
  }

  const projectRows = (projectPage ?? []) as Array<{ project_id: string; total_count: number }>;
  const total = projectRows.length ? Number(projectRows[0].total_count) : 0;
  const pageProjectIds = projectRows.map((row) => row.project_id);

  if (!pageProjectIds.length) {
    return { rows: [] as ProgrammingStageRow[], total };
  }

  // Passo 2: todas as etapas (matching) dos projetos da pagina.
  let query = supabase
    .from("programming")
    .select(PROGRAMMING_STAGE_SELECT_WITH_CHILDREN)
    .eq("tenant_id", filters.tenantId)
    .gte("execution_date", filters.dateFrom)
    .lte("execution_date", filters.dateTo)
    .in("project_id", pageProjectIds);

  if (stageIdsFromTeamFilter !== null) {
    query = query.in("id", stageIdsFromTeamFilter);
  }

  query = applyStatusChipToStageQuery(query, filters.statusChip, todayIso);

  const { data, error } = await query
    .order("project_id", { ascending: true })
    .order("execution_date", { ascending: true })
    .returns<ProgrammingStageRow[]>();

  if (error) {
    throw new Error(`Falha ao carregar lista da Programacao Normalizada: ${error.message}`);
  }

  return { rows: data ?? [], total };
}

export async function fetchProgrammingPlanForProject(params: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
}) {
  const { data, error } = await params.supabase
    .from("programming")
    .select(PROGRAMMING_STAGE_SELECT_WITH_CHILDREN)
    .eq("tenant_id", params.tenantId)
    .eq("project_id", params.projectId)
    .order("execution_date", { ascending: true })
    .returns<ProgrammingStageRow[]>();

  if (error) return [] as ProgrammingStageRow[];

  return data ?? [];
}

export async function fetchProgrammingStageById(params: {
  supabase: SupabaseClient;
  tenantId: string;
  programmingId: string;
}) {
  const { data, error } = await params.supabase
    .from("programming")
    .select(PROGRAMMING_STAGE_SELECT_WITH_CHILDREN)
    .eq("tenant_id", params.tenantId)
    .eq("id", params.programmingId)
    .maybeSingle<ProgrammingStageRow>();

  if (error) return null;

  return data;
}

// Historico exibido em modal: limit 50 (guia_backend regra 26).
export async function fetchProgrammingHistory(params: {
  supabase: SupabaseClient;
  tenantId: string;
  programmingId: string;
}) {
  const { data, error } = await params.supabase
    .from("programming_history")
    .select("id, programming_id, programming_team_id, action_type, reason, changes, metadata, created_by, created_at")
    .eq("tenant_id", params.tenantId)
    .eq("programming_id", params.programmingId)
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<ProgrammingHistoryRow[]>();

  if (error) return [] as Array<ProgrammingHistoryRow & { changed_by_name: string }>;

  const historyRows = data ?? [];
  const authors = await fetchAppUsersByIds({
    supabase: params.supabase,
    tenantId: params.tenantId,
    ids: historyRows.map((item) => item.created_by),
  });
  const authorMap = new Map(authors.map((item) => [item.id, item]));

  return historyRows.map((item) => ({
    ...item,
    changed_by_name: resolveAppUserName(authorMap.get(item.created_by ?? "")),
  }));
}
