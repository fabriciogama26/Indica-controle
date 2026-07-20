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

// Select completo (mesmo da etapa/plano) para a lista tambem servir de fonte
// para os exports (CSV/ENEL/ENEL NOVO) sem uma segunda query por etapa.
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

  let query = supabase
    .from("programming")
    .select(PROGRAMMING_STAGE_SELECT_WITH_CHILDREN, { count: "exact" })
    .eq("tenant_id", filters.tenantId)
    .gte("execution_date", filters.dateFrom)
    .lte("execution_date", filters.dateTo);

  if (projectIdsFromSearch !== null) {
    query = query.in("project_id", projectIdsFromSearch);
  }

  if (stageIdsFromTeamFilter !== null) {
    query = query.in("id", stageIdsFromTeamFilter);
  }

  if (filters.statusChip === "PROGRAMADAS") {
    query = query.in("status", ["PROGRAMADA", "REPROGRAMADA"]);
  } else if (filters.statusChip === "PENDENCIAS") {
    query = query.eq("work_completion_status", "PENDENCIA");
  } else if (filters.statusChip === "ATRASADAS") {
    const todayIso = new Date().toISOString().slice(0, 10);
    query = query.in("status", ["PROGRAMADA", "REPROGRAMADA"]).lt("execution_date", todayIso);
  } else if (filters.statusChip === "ADIADAS") {
    query = query.eq("status", "ADIADA");
  }

  const from = (filters.page - 1) * filters.pageSize;
  const to = from + filters.pageSize - 1;

  // A lista agrupa por projeto no frontend. Aqui a ordenacao fica em colunas
  // nativas da tabela para evitar que falha de order por embed esconda etapas.
  const { data, error, count } = await query
    .order("project_id", { ascending: true })
    .order("execution_date", { ascending: true })
    .range(from, to)
    .returns<ProgrammingStageRow[]>();

  if (error) {
    throw new Error(`Falha ao carregar lista da Programacao Normalizada: ${error.message}`);
  }

  return { rows: data ?? [], total: count ?? 0 };
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
