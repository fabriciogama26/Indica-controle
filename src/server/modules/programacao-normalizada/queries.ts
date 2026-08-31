import { SupabaseClient } from "@supabase/supabase-js";

import { loadAllRows } from "@/lib/server/apiHelpers";
import { resolveAppUserName } from "./normalizers";
import { PROGRAMMING_STAGE_SELECT_WITH_CHILDREN } from "./selects";
import type {
  AppUserLookupRow,
  ProgrammingHistoryRow,
  ProgrammingMeasurementMatchHistoryRow,
  ProgrammingMeasurementMatchRow,
  ProgrammingMeasurementSourceStageRow,
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
// - "ultimo" = maior execution_date, desempate por STATUS ATIVO primeiro
//   (PROGRAMADA/REPROGRAMADA antes de ADIADA/ANTECIPADA), so depois updated_at.
//   Antes da migration 346 nao havia desempate por status porque so uma etapa
//   podia ocupar a mesma execution_date do projeto; a 346 passou a permitir
//   uma etapa historica (CANCELADA/ADIADA/ANTECIPADA) coexistir com uma etapa
//   ATIVA na mesma data — sem esse desempate, uma etapa ANTECIPADA/ADIADA
//   "morta" podia vencer por updated_at e virar o `programmingId` gravado em
//   `cronograma_solicitacoes.programacao_id` (344) no lugar da etapa viva.
// - `rawStatus` e o ultimo Estado do Trabalho PREENCHIDO. Projeto que tem etapa
//   mas nunca teve estado preenchido entra no resultado com `rawStatus` vazio e
//   `hasWorkCompletion = false` — presenca e estado sao coisas diferentes, e a
//   tela de Cronograma depende dessa distincao para diferenciar "-" de
//   "A PROGRAMAR".
//
// `isPendencia` sai como campo PROPRIO e nao e dobrado dentro do status: na
// migration 318 a pendencia deixou de ser status e Estado do Trabalho e virou flag
// ortogonal. Quem consome decide se ela importa.
//
// `executionDate` e ANULAVEL: a migration 318 tornou `programming.execution_date`
// anulavel para a etapa "em espera" (ADIADA sem data). Quem consome precisa
// tratar o null — nao existe data para uma etapa que ainda nao foi remarcada.
export type ProgrammingProjectWorkCompletion = {
  programmingId: string;
  executionDate: string | null;
  rawStatus: string;
  hasWorkCompletion: boolean;
  isPendencia: boolean;
};

type ProjectWorkCompletionRow = {
  id: string;
  project_id: string;
  execution_date: string | null;
  status: string;
  work_completion_status: string | null;
  is_pendencia: boolean | null;
  updated_at: string;
};

const PROJECT_WORK_COMPLETION_SELECT = "id, project_id, execution_date, status, work_completion_status, is_pendencia, updated_at";
const PROJECT_WORK_COMPLETION_ROW_LIMIT = 5000;

export async function fetchWorkCompletionByProject(params: {
  supabase: SupabaseClient;
  tenantId: string;
  projectIds: string[];
}): Promise<Map<string, ProgrammingProjectWorkCompletion>> {
  const result = new Map<string, ProgrammingProjectWorkCompletion>();
  const uniqueIds = Array.from(new Set(params.projectIds.filter(Boolean)));
  if (!uniqueIds.length) return result;

  // Truncar aqui nao some com linhas da tela: some com o Estado do Trabalho dos projetos que
  // ficarem alem do corte, porque o Map abaixo simplesmente nao ganha entrada para eles. Por isso
  // a leitura pagina ate o teto proposital em vez de pedir tudo numa resposta so.
  const { data } = await loadAllRows<ProjectWorkCompletionRow>(
    (from, to) =>
      params.supabase
        .from("programming")
        .select(PROJECT_WORK_COMPLETION_SELECT)
        .eq("tenant_id", params.tenantId)
        .in("project_id", uniqueIds)
        .neq("status", "CANCELADA")
        .order("project_id", { ascending: true })
        .order("execution_date", { ascending: false })
        .order("updated_at", { ascending: false })
        // Desempate obrigatorio: os tres campos acima repetem entre etapas do mesmo projeto, e sem
        // ordem total a paginacao por offset embaralharia justamente a linha que vence o Map.
        .order("id", { ascending: true })
        .range(from, to)
        .returns<ProjectWorkCompletionRow[]>(),
    { maxRows: PROJECT_WORK_COMPLETION_ROW_LIMIT },
  );

  // Reordena em JS (o query builder do PostgREST nao expressa "status ativo
  // primeiro" num ORDER BY): mesma execution_date -> PROGRAMADA/REPROGRAMADA
  // vence ADIADA/ANTECIPADA antes de olhar updated_at. So importa a ordem
  // relativa DENTRO do mesmo project_id — o Map abaixo trata cada projeto de
  // forma independente, entao nao precisa reagrupar por projeto aqui.
  //
  // Etapa "em espera" (ADIADA sem data, migration 318) entra com
  // `execution_date` NULL e vai para o FIM do projeto: ela esta fora da
  // numeracao de etapas (a 318 exige data para reclassificar) e nao pode
  // definir o Estado do Trabalho no lugar de uma etapa com data. O ORDER BY do
  // Postgres traz esses NULLs primeiro (`desc` = NULLS FIRST), por isso a
  // inversao precisa ser explicita aqui.
  const rows = (data ?? []).slice().sort((left, right) => {
    const leftDate = left.execution_date ?? "";
    const rightDate = right.execution_date ?? "";
    if (leftDate !== rightDate) {
      if (!leftDate) return 1;
      if (!rightDate) return -1;
      return rightDate.localeCompare(leftDate);
    }

    const leftActive = left.status === "PROGRAMADA" || left.status === "REPROGRAMADA" ? 0 : 1;
    const rightActive = right.status === "PROGRAMADA" || right.status === "REPROGRAMADA" ? 0 : 1;
    if (leftActive !== rightActive) return leftActive - rightActive;

    return right.updated_at.localeCompare(left.updated_at);
  });

  for (const row of rows) {
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

// Codigo canonico de Estado do Trabalho.
//
// O catalogo tem DOIS codigos ativos para o mesmo estado de negocio: o legado
// `PARCIAL_PLANEJADO_BENFICIO_ATINGIDO` (com typo, que descreve as linhas de
// `project_programming`) e `BENEFICIO_ATINGIDO`, criado correto pela migration 310
// e usado por `programming` — as cargas 315/335 remapearam um para o outro.
// Os dois continuam aparecendo em filtros que listam o catalogo (ex.: Projetos),
// entao comparar codigo cru faria a opcao "errada" nao retornar nada.
export function toCanonicalWorkCompletionCode(value: unknown) {
  const code = String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");

  if (
    code === "BENEFICIO_ATINGIDO"
    || code === "PARCIAL_PLANEJADO_BENEFICIO_ATINGIDO"
    || code === "PARCIAL_PLANEJADO_BENFICIO_ATINGIDO"
  ) {
    return "BENEFICIO_ATINGIDO";
  }

  return code;
}

// Codigos que existem em `programming` e batem com o filtro pedido, resolvidos
// pelo codigo canonico. Retorna [] quando nada bate — o chamador trata como
// "filtro nao encontra nenhum projeto", nunca como "sem filtro".
async function resolveMatchingWorkCompletionCodes(params: {
  supabase: SupabaseClient;
  tenantId: string;
  requestedCode: string;
}) {
  const wanted = toCanonicalWorkCompletionCode(params.requestedCode);
  const { data } = await params.supabase
    .from("programming_work_completion_catalog")
    .select("code")
    .eq("tenant_id", params.tenantId)
    .returns<Array<{ code: string }>>();

  const codes = (data ?? [])
    .map((item) => String(item.code ?? "").trim())
    .filter((code) => code && toCanonicalWorkCompletionCode(code) === wanted);

  // O proprio codigo pedido entra mesmo se nao estiver no catalogo do tenant,
  // para o filtro nao depender de o catalogo estar completo.
  if (!codes.includes(params.requestedCode) && params.requestedCode) {
    codes.push(params.requestedCode);
  }

  return Array.from(new Set(codes));
}

// Timeline de Estado do Trabalho por projeto, ate uma data de corte.
// Consumida pelos dashboards de Medicao e de Carteira Operacional, que antes do
// corte tinham a mesma query duplicada.
export type ProgrammingCompletionTimelineRow = {
  project_id: string;
  execution_date: string;
  status: string;
  work_completion_status: string | null;
  is_pendencia: boolean | null;
  updated_at: string;
};

const TIMELINE_CHUNK_SIZE = 200;

export async function fetchWorkCompletionTimelineByProject(params: {
  supabase: SupabaseClient;
  tenantId: string;
  projectIds: string[];
  endDate: string;
}): Promise<{ rows: ProgrammingCompletionTimelineRow[]; error: unknown }> {
  const uniqueIds = Array.from(new Set(params.projectIds.filter(Boolean)));
  if (!uniqueIds.length) return { rows: [], error: null };

  const rows: ProgrammingCompletionTimelineRow[] = [];

  for (let index = 0; index < uniqueIds.length; index += TIMELINE_CHUNK_SIZE) {
    const chunk = uniqueIds.slice(index, index + TIMELINE_CHUNK_SIZE);
    const { data, error } = await params.supabase
      .from("programming")
      .select("project_id, execution_date, status, work_completion_status, is_pendencia, updated_at")
      .eq("tenant_id", params.tenantId)
      .in("project_id", chunk)
      .lte("execution_date", params.endDate)
      .neq("status", "CANCELADA")
      .or("work_completion_status.not.is.null,is_pendencia.eq.true")
      .returns<ProgrammingCompletionTimelineRow[]>();

    if (error) return { rows: [], error };
    rows.push(...(data ?? []));
  }

  return { rows, error: null };
}

// Projetos que tem alguma etapa com Estado do Trabalho concluido.
//
// No modelo normalizado `work_completion_status` guarda o CODIGO do catalogo e a
// FK e por codigo (310) — nao existe coluna `work_completion_status_id`. Isso
// elimina o caminho duplo id/texto e os fallbacks de schema legado que a leitura
// anterior precisava manter.
export async function fetchProjectIdsWithCompletedWork(params: {
  supabase: SupabaseClient;
  tenantId: string;
  projectIds?: string[];
}): Promise<{ projectIds: string[]; error: unknown }> {
  let query = params.supabase
    .from("programming")
    .select("project_id")
    .eq("tenant_id", params.tenantId)
    .eq("work_completion_status", "CONCLUIDO");

  if (params.projectIds?.length) {
    query = query.in("project_id", params.projectIds);
  }

  const { data, error } = await query.returns<Array<{ project_id: string }>>();
  if (error) return { projectIds: [], error };

  return {
    projectIds: Array.from(new Set((data ?? []).map((item) => item.project_id).filter(Boolean))),
    error: null,
  };
}

// Projetos que batem no filtro de Estado do Trabalho e/ou Tipo de SGD da lista de
// Projetos. Devolve `null` quando nenhum filtro foi pedido — "sem recorte" e
// diferente de "recorte que nao achou nada" ([]).
export async function fetchProjectIdsByProgrammingFilter(params: {
  supabase: SupabaseClient;
  tenantId: string;
  workCompletionStatus: string;
  sgdTypeId: string | null;
}): Promise<{ projectIds: string[] | null; error: unknown }> {
  const hasWorkCompletionFilter = params.workCompletionStatus !== "TODOS";
  const hasSgdTypeFilter = Boolean(params.sgdTypeId);

  if (!hasWorkCompletionFilter && !hasSgdTypeFilter) {
    return { projectIds: null, error: null };
  }

  let query = params.supabase
    .from("programming")
    .select("project_id")
    .eq("tenant_id", params.tenantId);

  if (hasSgdTypeFilter && params.sgdTypeId) {
    query = query.eq("sgd_type_id", params.sgdTypeId);
  }

  if (hasWorkCompletionFilter) {
    if (params.workCompletionStatus === "NAO_INFORMADO") {
      // Sem Estado do Trabalho E sem pendencia — etapa marcada como pendencia nao
      // e "nao informada", so guarda a informacao em outra coluna.
      query = query.is("work_completion_status", null).eq("is_pendencia", false);
    } else if (toCanonicalWorkCompletionCode(params.workCompletionStatus) === "PENDENCIA") {
      // PENDENCIA continua ativa no catalogo e por isso e oferecida no filtro, mas
      // a migration 318 tirou o valor de status E de Estado do Trabalho: virou a
      // flag ortogonal `is_pendencia`. Comparar pelo codigo devolveria zero
      // projeto — um "nenhum resultado" falso, que parece boa noticia.
      query = query.eq("is_pendencia", true);
    } else {
      const codes = await resolveMatchingWorkCompletionCodes({
        supabase: params.supabase,
        tenantId: params.tenantId,
        requestedCode: params.workCompletionStatus,
      });
      if (!codes.length) return { projectIds: [], error: null };
      query = query.in("work_completion_status", codes);
    }
  }

  const { data, error } = await query.returns<Array<{ project_id: string }>>();
  if (error) return { projectIds: [], error };

  return {
    projectIds: Array.from(new Set((data ?? []).map((item) => item.project_id).filter(Boolean))),
    error: null,
  };
}

// Etapas ativas do projeto — usado pela guarda que impede inativar projeto com
// Programacao em aberto.
export async function countActiveStagesForProject(params: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
}): Promise<{ count: number; error: unknown }> {
  const { count, error } = await params.supabase
    .from("programming")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", params.tenantId)
    .eq("project_id", params.projectId)
    .in("status", ["PROGRAMADA", "REPROGRAMADA", "ADIADA"]);

  if (error) return { count: 0, error };
  return { count: count ?? 0, error: null };
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
    // `filters.pageSize` chega aqui como STAGE_LIST_EXPORT_MAX_ROWS (5000) vindo da rota. Um
    // `.limit(5000)` unico nunca entregou isso: o PostgREST corta em 1.000 por resposta sem
    // sinalizar, entao a exportacao saia com 1.000 etapas. O aviso de exportacao parcial na tela
    // continuava correto (`total > list.length` compara com o count exato do banco), mas disparava
    // a partir de 1.000 em vez dos 5.000 pretendidos.
    const buildExportQuery = (withCount: boolean) => {
      let exportQuery = supabase
        .from("programming")
        .select(
          PROGRAMMING_STAGE_SELECT_WITH_CHILDREN,
          withCount ? { count: "exact" } : undefined,
        )
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

      return applyWorkCompletionFilterToStageQuery(exportQuery, filters.workCompletionStatuses);
    };

    let exportCount = 0;

    const { data: exportRows, error: exportError } = await loadAllRows<ProgrammingStageRow>(
      (from, to) =>
        buildExportQuery(from === 0)
          .order("project_id", { ascending: true })
          .order("execution_date", { ascending: true })
          // `id` como desempate: sem ordem total, paginar por offset repete ou perde etapas na
          // virada. Varias etapas do mesmo projeto compartilham `execution_date`.
          .order("id", { ascending: true })
          .range(from, to)
          .returns<ProgrammingStageRow[]>()
          .then((result) => {
            // O count exato so e pedido na primeira pagina — repetir a contagem a cada bloco
            // custaria um count(*) por chamada sem mudar o resultado.
            if (typeof result.count === "number") exportCount = result.count;
            return result;
          }),
      { maxRows: filters.pageSize },
    );

    if (exportError) {
      throw new Error(`Falha ao carregar etapas para exportacao: ${exportError.message}`);
    }

    // total = total de ETAPAS que batem no filtro (nao so as devolvidas). E o que sustenta o aviso
    // de exportacao parcial na tela quando o filtro rende mais que o teto.
    return { rows: exportRows ?? [], total: exportCount };
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

export async function fetchProgrammingStagesForMeasurementSources(params: {
  supabase: SupabaseClient;
  tenantId: string;
  startDate: string;
  endDate: string;
}) {
  const { data, error } = await params.supabase
    .from("programming")
    .select(`
      id, project_id, execution_date, status, campo_eletrico, work_completion_status,
      programming_team ( team_id, status ),
      programming_activity ( id, service_activity_id, quantity, is_active )
    `)
    .eq("tenant_id", params.tenantId)
    .gte("execution_date", params.startDate)
    .lte("execution_date", params.endDate)
    .order("execution_date", { ascending: true })
    .returns<ProgrammingMeasurementSourceStageRow[]>();

  if (error) {
    throw new Error(`Falha ao carregar fontes de Programacao para Medicao: ${error.message}`);
  }

  return data ?? [];
}

async function fetchPagedProgrammingRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>,
) {
  const rows: T[] = [];
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) {
      throw new Error(error.message ?? "Falha ao carregar Programacao paginada.");
    }

    const pageRows = data ?? [];
    rows.push(...pageRows);
    if (pageRows.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

export async function fetchProgrammingStagesForMeasurementMatch(params: {
  supabase: SupabaseClient;
  tenantId: string;
  projectIds: string[];
  startDate: string;
  endDate: string;
}) {
  if (!params.projectIds.length) return [] as ProgrammingMeasurementMatchRow[];

  return fetchPagedProgrammingRows<ProgrammingMeasurementMatchRow>((from, to) =>
    params.supabase
      .from("programming")
      .select("id, project_id, execution_date, status, work_completion_status, updated_at, programming_team(team_id, status)")
      .eq("tenant_id", params.tenantId)
      .in("project_id", params.projectIds)
      .gte("execution_date", params.startDate)
      .lte("execution_date", params.endDate)
      .range(from, to)
      .returns<ProgrammingMeasurementMatchRow[]>(),
  );
}

export async function fetchCanceledProgrammingStageIdsForMeasurement(params: {
  supabase: SupabaseClient;
  tenantId: string;
  projectIds: string[];
}) {
  if (!params.projectIds.length) return [] as Array<Pick<ProgrammingMeasurementMatchRow, "id">>;

  return fetchPagedProgrammingRows<Pick<ProgrammingMeasurementMatchRow, "id">>((from, to) =>
    params.supabase
      .from("programming")
      .select("id")
      .eq("tenant_id", params.tenantId)
      .in("project_id", params.projectIds)
      .eq("status", "CANCELADA")
      .range(from, to)
      .returns<Array<Pick<ProgrammingMeasurementMatchRow, "id">>>(),
  );
}

export async function fetchProgrammingCompletionRowsForMeasurement(params: {
  supabase: SupabaseClient;
  tenantId: string;
  projectIds: string[];
  windowEndDate: string;
}) {
  if (!params.projectIds.length) {
    return [] as Array<Pick<ProgrammingMeasurementMatchRow, "project_id" | "execution_date" | "work_completion_status" | "updated_at">>;
  }

  return fetchPagedProgrammingRows<Pick<ProgrammingMeasurementMatchRow, "project_id" | "execution_date" | "work_completion_status" | "updated_at">>((from, to) =>
    params.supabase
      .from("programming")
      .select("project_id, execution_date, work_completion_status, updated_at")
      .eq("tenant_id", params.tenantId)
      .in("project_id", params.projectIds)
      .lte("execution_date", params.windowEndDate)
      .neq("status", "CANCELADA")
      .not("work_completion_status", "is", null)
      .range(from, to)
      .returns<Array<Pick<ProgrammingMeasurementMatchRow, "project_id" | "execution_date" | "work_completion_status" | "updated_at">>>(),
  );
}

export async function fetchProgrammingWorkCompletionHistoryForMeasurement(params: {
  supabase: SupabaseClient;
  tenantId: string;
  projectIds: string[];
}) {
  if (!params.projectIds.length) return [] as ProgrammingMeasurementMatchHistoryRow[];

  return fetchPagedProgrammingRows<ProgrammingMeasurementMatchHistoryRow>((from, to) =>
    params.supabase
      .from("programming_history")
      .select("id, programming_id, changes, created_at, programming!inner(project_id, tenant_id)")
      .eq("tenant_id", params.tenantId)
      .eq("programming.tenant_id", params.tenantId)
      .in("programming.project_id", params.projectIds)
      .contains("changes", { workCompletionStatus: {} })
      .order("created_at", { ascending: false })
      .range(from, to)
      .returns<ProgrammingMeasurementMatchHistoryRow[]>(),
  );
}

// =============================================================================
// Leitura ampla para o Mapa de Programacao (Corte - Fase 4)
// =============================================================================
// O Mapa consolida TODAS as etapas de uma janela ampla (18 meses) por projeto,
// para calcular cartoes de situacao (concluidas, para reprogramar, pendentes,
// etc.) — algo que nenhuma outra tela precisa, entao nao reaproveita as queries
// paginadas acima. Ainda assim passa pela fachada (nunca le a tabela direto),
// porque Mapa e Programacao Normalizada sao features irmas.
export type ProgrammingMapTeamRow = {
  team_id: string;
  status: string;
  programmed_foreman_person_id: string | null;
  programmed_foreman_name_snapshot: string | null;
};

export type ProgrammingMapStageRow = {
  id: string;
  project_id: string;
  status: string;
  execution_date: string | null;
  etapa_number: number | null;
  etapa_unica: boolean;
  etapa_final: boolean;
  work_completion_status: string | null;
  is_pendencia: boolean;
  cancellation_reason: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  // Snapshot da 337: a etapa "em espera" perde execution_date e classificacao. O
  // Mapa precisa dos dois para ordenar e rotular essa etapa como as demais.
  classification_snapshot_execution_date: string | null;
  classification_snapshot_number: number | null;
  classification_snapshot_unica: boolean | null;
  classification_snapshot_final: boolean | null;
  programming_team: ProgrammingMapTeamRow[] | null;
};

const MAP_STAGE_SELECT =
  "id, project_id, status, execution_date, etapa_number, etapa_unica, etapa_final, work_completion_status, is_pendencia, cancellation_reason, note, created_at, updated_at, classification_snapshot_execution_date, classification_snapshot_number, classification_snapshot_unica, classification_snapshot_final, programming_team(team_id, status, programmed_foreman_person_id, programmed_foreman_name_snapshot)";
const MAP_STAGE_ROW_LIMIT = 5000;

export async function fetchProgrammingStagesForMap(params: {
  supabase: SupabaseClient;
  tenantId: string;
  sinceDate: string;
}): Promise<ProgrammingMapStageRow[]> {
  // Etapa "em espera" (ADIADA sem data) precisa entrar: com `gte` puro ela era
  // descartada em silencio — `NULL >= data` e NULL, nao false —, e o Mapa nunca
  // via essas obras. Efeito colateral do bug: obra cuja UNICA etapa estava em
  // espera caia em "Nunca programadas". Sem data nao ha o que recortar por
  // periodo, entao elas vem sempre; o teto de MAP_STAGE_ROW_LIMIT segue valendo.
  const { data, error } = await loadAllRows<ProgrammingMapStageRow>(
    (from, to) =>
      params.supabase
        .from("programming")
        .select(MAP_STAGE_SELECT)
        .eq("tenant_id", params.tenantId)
        .or(`execution_date.is.null,execution_date.gte.${params.sinceDate}`)
        // Antes desta correcao a consulta nao tinha ORDER BY nenhum e ainda era cortada em 1.000
        // pelo servidor: alem de incompleta, ela era NAO DETERMINISTICA — quais 1.000 etapas o
        // Mapa recebia podia mudar entre duas chamadas identicas.
        .order("id", { ascending: true })
        .range(from, to)
        .returns<ProgrammingMapStageRow[]>(),
    { maxRows: MAP_STAGE_ROW_LIMIT },
  );

  if (error) {
    throw new Error(`Falha ao carregar historico geral de Programacao: ${error.message}`);
  }

  return data ?? [];
}

// Pares equipe + data com pelo menos uma etapa ativa (PROGRAMADA/REPROGRAMADA)
// no periodo — usado pelo Mapa para achar equipes SEM programacao em cada dia.
export async function fetchProgrammedTeamDatesInPeriod(params: {
  supabase: SupabaseClient;
  tenantId: string;
  startDate: string;
  endDate: string;
}): Promise<Set<string>> {
  const { data, error } = await loadAllRows<{
    id: string;
    team_id: string;
    programming: { execution_date: string | null } | null;
  }>(
    (from, to) =>
      params.supabase
        .from("programming_team")
        .select("id, team_id, programming!inner(execution_date, status, tenant_id)")
        .eq("tenant_id", params.tenantId)
        .eq("status", "ATIVA")
        .eq("programming.tenant_id", params.tenantId)
        .gte("programming.execution_date", params.startDate)
        .lte("programming.execution_date", params.endDate)
        .in("programming.status", ["PROGRAMADA", "REPROGRAMADA"])
        .order("id", { ascending: true })
        .range(from, to)
        .returns<Array<{ id: string; team_id: string; programming: { execution_date: string | null } | null }>>(),
  );

  if (error) {
    throw new Error(`Falha ao carregar programacoes das equipes no periodo: ${error.message}`);
  }

  return new Set(
    (data ?? [])
      .map((item) => {
        const teamId = item.team_id;
        const executionDate = item.programming?.execution_date;
        return teamId && executionDate ? `${teamId}|${executionDate}` : "";
      })
      .filter(Boolean),
  );
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
