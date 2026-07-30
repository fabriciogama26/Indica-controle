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

// Sentinela de "Estado do Trabalho em branco (a fazer)". Em branco e um estado
// REAL de negocio (etapa ainda nao executada — ver migration 329), mas e NULL no
// banco e por isso nao entra num `in (...)`. O mesmo valor literal aparece na
// migration 336 (RPC do passo 1) e em constants.ts do modulo de tela (que monta a
// querystring) — os tres tem que casar.
export const WORK_COMPLETION_BLANK_CODE = "__EM_BRANCO__";

// Aplica o filtro de Estado do Trabalho de forma identica no passo 2 e no export.
// No passo 1 (paginacao por projeto) o mesmo predicado vive na RPC da 336 — se um
// dos lados mudar, o outro tem que mudar junto, senao a pagina traz projeto que
// nao tem etapa para mostrar.
function applyWorkCompletionFilterToStageQuery<Q extends {
  in(column: string, values: string[]): Q;
  is(column: string, value: null): Q;
  or(filters: string): Q;
}>(query: Q, workCompletionStatuses: string[]): Q {
  if (!workCompletionStatuses.length) return query;

  const includeBlank = workCompletionStatuses.includes(WORK_COMPLETION_BLANK_CODE);
  const codes = workCompletionStatuses.filter((code) => code !== WORK_COMPLETION_BLANK_CODE);

  if (includeBlank && !codes.length) {
    return query.is("work_completion_status", null);
  }
  if (!includeBlank) {
    return query.in("work_completion_status", codes);
  }

  // "Em branco" OU um dos codigos. Os codigos vem do catalogo do tenant (validados
  // na rota), entao nao ha texto livre do cliente entrando na expressao do PostgREST.
  return query.or(`work_completion_status.is.null,work_completion_status.in.(${codes.join(",")})`);
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
  // 337: canceladas MANTEM execution_date, entao — diferente de EM_ESPERA e
  // SEM_RETORNO — este chip respeita o intervalo de datas normalmente (o filtro de
  // periodo ja foi aplicado por quem chama).
  if (statusChip === "CANCELADAS") {
    return query.eq("status", "CANCELADA");
  }
  return query;
}

// =============================================================================
// Estado do Trabalho por projeto — contrato de leitura consumido por OUTRAS telas
// =============================================================================
// Substitui a leitura direta de `project_programming` (tela programacao-simples,
// congelada em somente leitura). Antes do corte a mesma regra estava reescrita em
// cinco lugares com critérios divergentes; aqui ela existe uma vez.
//
// Regras herdadas do comportamento legado, deliberadamente preservadas:
// - etapa CANCELADA nao conta. ANTECIPADA CONTA — a query legada excluia apenas
//   CANCELADA, e mudar isso alteraria numero em tela sem pedido.
// - "ultimo" = maior execution_date, desempate por updated_at (sem usar etapa).
// - `rawStatus` e o ultimo Estado do Trabalho PREENCHIDO. Projeto que tem etapa
//   mas nunca teve estado preenchido entra no resultado com `rawStatus` vazio e
//   `hasWorkCompletion = false` — presenca e estado sao coisas diferentes, e a
//   tela de Cronograma depende dessa distincao para diferenciar "-" de
//   "A PROGRAMAR".
//
// `isPendencia` sai como campo PROPRIO e nao e dobrado dentro do status: na
// migration 318 a pendencia deixou de ser status e Estado do Trabalho e virou flag
// ortogonal. Quem consome decide se ela importa.
export type ProgrammingProjectWorkCompletion = {
  programmingId: string;
  executionDate: string;
  rawStatus: string;
  hasWorkCompletion: boolean;
  isPendencia: boolean;
};

type ProjectWorkCompletionRow = {
  id: string;
  project_id: string;
  execution_date: string;
  work_completion_status: string | null;
  is_pendencia: boolean | null;
  updated_at: string;
};

const PROJECT_WORK_COMPLETION_SELECT = "id, project_id, execution_date, work_completion_status, is_pendencia, updated_at";
const PROJECT_WORK_COMPLETION_ROW_LIMIT = 5000;

export async function fetchWorkCompletionByProject(params: {
  supabase: SupabaseClient;
  tenantId: string;
  projectIds: string[];
}): Promise<Map<string, ProgrammingProjectWorkCompletion>> {
  const result = new Map<string, ProgrammingProjectWorkCompletion>();
  const uniqueIds = Array.from(new Set(params.projectIds.filter(Boolean)));
  if (!uniqueIds.length) return result;

  const { data } = await params.supabase
    .from("programming")
    .select(PROJECT_WORK_COMPLETION_SELECT)
    .eq("tenant_id", params.tenantId)
    .in("project_id", uniqueIds)
    .neq("status", "CANCELADA")
    .order("project_id", { ascending: true })
    .order("execution_date", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(PROJECT_WORK_COMPLETION_ROW_LIMIT)
    .returns<ProjectWorkCompletionRow[]>();

  for (const row of data ?? []) {
    const rawStatus = (row.work_completion_status ?? "").trim();
    const current = result.get(row.project_id);

    // Primeira linha do projeto (a mais recente): registra presenca, com ou sem
    // estado preenchido.
    if (!current) {
      result.set(row.project_id, {
        programmingId: row.id,
        executionDate: row.execution_date,
        rawStatus,
        hasWorkCompletion: Boolean(rawStatus),
        isPendencia: Boolean(row.is_pendencia),
      });
      continue;
    }

    // Ja havia presenca sem estado e esta linha (mais antiga) tem estado: passa a
    // valer o ultimo estado PREENCHIDO, junto com a etapa que o registrou.
    if (!current.hasWorkCompletion && rawStatus) {
      result.set(row.project_id, {
        programmingId: row.id,
        executionDate: row.execution_date,
        rawStatus,
        hasWorkCompletion: true,
        isPendencia: Boolean(row.is_pendencia),
      });
    }
  }

  return result;
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
  // Export (CSV/ENEL/ENEL NOVO) gera um CSV PLANO de etapas — nao ha agrupamento
  // por projeto para preservar, entao ele NAO usa a paginacao por projeto: o teto
  // e por ETAPAS exportadas e o total devolvido e o total de ETAPAS que batem no
  // filtro, para o aviso poder dizer "exportados X de Y".
  forExport?: boolean;
}) {
  const { supabase, filters, projectIdsFromSearch, forExport } = params;

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
  const isEmEsperaChip = filters.statusChip === "EM_ESPERA";
  // "Sem retorno" (achado/migration 330): condicao DERIVADA — pendencia aberta,
  // vencida e sem Estado do Trabalho lancado. Como o "Em espera", IGNORA o
  // intervalo de data de proposito (senao a pendencia antiga — a que mais
  // precisa de cobranca — ficaria escondida). todayIso vem do servidor.
  const isSemRetornoChip = filters.statusChip === "SEM_RETORNO";

  // Export: consulta plana por ETAPA, com total exato de etapas e teto por etapa.
  if (forExport) {
    let exportQuery = supabase
      .from("programming")
      .select(PROGRAMMING_STAGE_SELECT_WITH_CHILDREN, { count: "exact" })
      .eq("tenant_id", filters.tenantId);

    if (projectIdsFromSearch !== null) {
      exportQuery = exportQuery.in("project_id", projectIdsFromSearch);
    }

    if (stageIdsFromTeamFilter !== null) {
      exportQuery = exportQuery.in("id", stageIdsFromTeamFilter);
    }

    if (isEmEsperaChip) {
      exportQuery = exportQuery.eq("status", "ADIADA").is("execution_date", null);
    } else if (isSemRetornoChip) {
      exportQuery = exportQuery
        .eq("is_pendencia", true)
        .in("status", ["PROGRAMADA", "REPROGRAMADA"])
        .lt("execution_date", todayIso)
        .is("work_completion_status", null);
    } else {
      exportQuery = exportQuery.gte("execution_date", filters.dateFrom).lte("execution_date", filters.dateTo);
      exportQuery = applyStatusChipToStageQuery(exportQuery, filters.statusChip, todayIso);
    }

    exportQuery = applyWorkCompletionFilterToStageQuery(exportQuery, filters.workCompletionStatuses);

    const { data: exportRows, error: exportError, count: exportCount } = await exportQuery
      .order("project_id", { ascending: true })
      .order("execution_date", { ascending: true })
      .limit(filters.pageSize)
      .returns<ProgrammingStageRow[]>();

    if (exportError) {
      throw new Error(`Falha ao carregar etapas para exportacao: ${exportError.message}`);
    }

    // total = total de ETAPAS que batem no filtro (nao so as devolvidas).
    return { rows: exportRows ?? [], total: exportCount ?? 0 };
  }

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
    // Migration 336. Passado por NOME: a sobrecarga antiga (9 parametros) continua
    // existindo no banco, e nomear o argumento garante que a chamada resolva para a
    // versao nova mesmo antes de a antiga ser removida.
    p_work_completion_status: filters.workCompletionStatuses.length ? filters.workCompletionStatuses : null,
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
  // "Em espera" (achado 9) ignora o intervalo de data de proposito: sao etapas
  // ADIADA sem data, que por definicao nao caem em nenhuma janela.
  let query = supabase
    .from("programming")
    .select(PROGRAMMING_STAGE_SELECT_WITH_CHILDREN)
    .eq("tenant_id", filters.tenantId)
    .in("project_id", pageProjectIds);

  if (isEmEsperaChip) {
    query = query.eq("status", "ADIADA").is("execution_date", null);
  } else if (isSemRetornoChip) {
    query = query
      .eq("is_pendencia", true)
      .in("status", ["PROGRAMADA", "REPROGRAMADA"])
      .lt("execution_date", todayIso)
      .is("work_completion_status", null);
  } else {
    query = query.gte("execution_date", filters.dateFrom).lte("execution_date", filters.dateTo);
    query = applyStatusChipToStageQuery(query, filters.statusChip, todayIso);
  }

  if (stageIdsFromTeamFilter !== null) {
    query = query.in("id", stageIdsFromTeamFilter);
  }

  query = applyWorkCompletionFilterToStageQuery(query, filters.workCompletionStatuses);

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
