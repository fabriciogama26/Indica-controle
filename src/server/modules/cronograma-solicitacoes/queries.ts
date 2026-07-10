import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeText } from "@/lib/server/apiHelpers";
import {
  isPrioridade,
  isTipoSolicitacao,
  normalizeWorkCompletionToken,
} from "./normalizers";
import type { ListFilters, ProjectLookupRow, SolicitacaoRow } from "./types";

const PROJECT_LOOKUP_SELECT = "id, sob, city_text, street, neighborhood, priority_text, is_active";

export const SOLICITACAO_SELECT =
  "id, tenant_id, projeto_id, projeto_codigo, tipo_solicitacao, prioridade, data_entrada, data_limite, data_conclusao, status, responsavel_id, solicitante_id, observacao, justificativa_prioridade, motivo_cancelamento, estado_programacao_snapshot, programacao_id, created_by, updated_by, created_at, updated_at";

export async function fetchProjectLookup(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
): Promise<ProjectLookupRow | null> {
  const { data, error } = await supabase
    .from("project_with_labels")
    .select(PROJECT_LOOKUP_SELECT)
    .eq("tenant_id", tenantId)
    .eq("id", projectId)
    .maybeSingle<ProjectLookupRow>();

  if (error || !data) return null;
  return data;
}

export async function fetchProjectLookupMap(
  supabase: SupabaseClient,
  tenantId: string,
  projectIds: string[],
): Promise<Map<string, ProjectLookupRow>> {
  const uniqueIds = Array.from(new Set(projectIds.filter(Boolean)));
  if (!uniqueIds.length) return new Map();

  const { data } = await supabase
    .from("project_with_labels")
    .select(PROJECT_LOOKUP_SELECT)
    .eq("tenant_id", tenantId)
    .in("id", uniqueIds)
    .returns<ProjectLookupRow[]>();

  return new Map((data ?? []).map((item) => [item.id, item]));
}

// Estado atual da Programacao do projeto = ultima linha por data de execucao/etapa.
export async function fetchLatestProgrammingState(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
): Promise<{ programmingId: string; executionDate: string; rawStatus: string; stateToken: string } | null> {
  const { data, error } = await supabase
    .from("project_programming")
    .select("id, execution_date, work_completion_status, updated_at")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .neq("status", "CANCELADA")
    .not("work_completion_status", "is", null)
    .order("execution_date", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<{
      id: string;
      execution_date: string;
      work_completion_status: string | null;
      updated_at: string;
    }>();

  if (error || !data) return null;

  return {
    programmingId: data.id,
    executionDate: data.execution_date,
    rawStatus: normalizeText(data.work_completion_status),
    stateToken: normalizeWorkCompletionToken(data.work_completion_status),
  };
}

// Estado atual (ultimo Estado Trabalho) por projeto, para uma pagina da lista.
export async function fetchLatestProgrammingStateMap(
  supabase: SupabaseClient,
  tenantId: string,
  projectIds: string[],
): Promise<Map<string, { rawStatus: string; stateToken: string; programmingId: string }>> {
  const uniqueIds = Array.from(new Set(projectIds.filter(Boolean)));
  const result = new Map<string, { rawStatus: string; stateToken: string; programmingId: string }>();
  if (!uniqueIds.length) return result;

  // Alinhado com a Medicao: ignora CANCELADA e exige Estado Trabalho preenchido;
  // "ultimo" = maior execution_date, desempate por updated_at.
  const { data } = await supabase
    .from("project_programming")
    .select("id, project_id, execution_date, work_completion_status, updated_at")
    .eq("tenant_id", tenantId)
    .in("project_id", uniqueIds)
    .neq("status", "CANCELADA")
    .not("work_completion_status", "is", null)
    .order("project_id", { ascending: true })
    .order("execution_date", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(5000)
    .returns<Array<{ id: string; project_id: string; work_completion_status: string | null }>>();

  for (const row of data ?? []) {
    if (result.has(row.project_id)) continue;
    const rawStatus = normalizeText(row.work_completion_status);
    if (!rawStatus) continue;
    result.set(row.project_id, {
      rawStatus,
      stateToken: normalizeWorkCompletionToken(row.work_completion_status),
      programmingId: row.id,
    });
  }

  return result;
}

export async function fetchAsbuiltEligibleProjectIds(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<string[]> {
  const { data, error } = await supabase.rpc("get_cronograma_asbuilt_project_ids", {
    p_tenant_id: tenantId,
  });

  if (error) return [];
  return (data ?? [])
    .map((item: { project_id?: string }) => normalizeText(item.project_id))
    .filter(Boolean);
}

export async function fetchPeopleNameMap(
  supabase: SupabaseClient,
  tenantId: string,
  ids: string[],
): Promise<Map<string, string>> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (!uniqueIds.length) return new Map();

  const { data } = await supabase
    .from("people")
    .select("id, name:nome")
    .eq("tenant_id", tenantId)
    .in("id", uniqueIds)
    .returns<Array<{ id: string; name: string | null }>>();

  return new Map((data ?? []).map((item) => [item.id, normalizeText(item.name) || "Nao identificado"]));
}

export async function fetchUserNameMap(
  supabase: SupabaseClient,
  tenantId: string,
  ids: string[],
): Promise<Map<string, string>> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (!uniqueIds.length) return new Map();

  const { data } = await supabase
    .from("app_users")
    .select("id, display, login_name")
    .eq("tenant_id", tenantId)
    .in("id", uniqueIds)
    .returns<Array<{ id: string; display: string | null; login_name: string | null }>>();

  return new Map(
    (data ?? []).map((item) => [
      item.id,
      normalizeText(item.display) || normalizeText(item.login_name) || "Nao identificado",
    ]),
  );
}

export async function fetchPersonActive(
  supabase: SupabaseClient,
  tenantId: string,
  personId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("people")
    .select("id, ativo")
    .eq("tenant_id", tenantId)
    .eq("id", personId)
    .maybeSingle<{ id: string; ativo: boolean }>();

  return Boolean(data?.ativo);
}

export async function fetchSolicitacaoById(
  supabase: SupabaseClient,
  tenantId: string,
  id: string,
): Promise<SolicitacaoRow | null> {
  const { data, error } = await supabase
    .from("cronograma_solicitacoes")
    .select(SOLICITACAO_SELECT)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle<SolicitacaoRow>();

  if (error || !data) return null;
  return data;
}

export async function resolveProjectIdsByCity(
  supabase: SupabaseClient,
  tenantId: string,
  city: string,
): Promise<string[]> {
  const normalized = normalizeText(city);
  if (!normalized) return [];

  const { data } = await supabase
    .from("project_with_labels")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("city_text", normalized)
    .returns<Array<{ id: string }>>();

  return (data ?? []).map((item) => item.id).filter(Boolean);
}

function sanitizeSearchTerm(term: string): string {
  return normalizeText(term).replace(/[,()*]/g, " ").replace(/\s+/g, " ").trim();
}

export async function resolveSearchIds(
  supabase: SupabaseClient,
  tenantId: string,
  term: string,
): Promise<{ term: string; projetoIds: string[]; responsavelIds: string[]; solicitanteIds: string[] }> {
  const clean = sanitizeSearchTerm(term);
  if (!clean) {
    return { term: "", projetoIds: [], responsavelIds: [], solicitanteIds: [] };
  }

  const [projetos, responsaveis, solicitantes] = await Promise.all([
    supabase
      .from("project_with_labels")
      .select("id")
      .eq("tenant_id", tenantId)
      .ilike("sob", `%${clean}%`)
      .limit(100)
      .returns<Array<{ id: string }>>(),
    supabase
      .from("people")
      .select("id")
      .eq("tenant_id", tenantId)
      .ilike("nome", `%${clean}%`)
      .limit(100)
      .returns<Array<{ id: string }>>(),
    supabase
      .from("app_users")
      .select("id")
      .eq("tenant_id", tenantId)
      .or(`display.ilike.%${clean}%,login_name.ilike.%${clean}%`)
      .limit(100)
      .returns<Array<{ id: string }>>(),
  ]);

  return {
    term: clean,
    projetoIds: (projetos.data ?? []).map((item) => item.id).filter(Boolean),
    responsavelIds: (responsaveis.data ?? []).map((item) => item.id).filter(Boolean),
    solicitanteIds: (solicitantes.data ?? []).map((item) => item.id).filter(Boolean),
  };
}

type FilterContext = {
  filters: ListFilters;
  today: string;
  municipioProjectIds: string[] | null;
  searchIds: { term: string; projetoIds: string[]; responsavelIds: string[]; solicitanteIds: string[] } | null;
  includeStatus: boolean;
};

const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";

// Aplica os filtros nativos (colunas indexadas). Status ATRASADO/PENDENTE via predicado de data.
export function applySolicitacaoFilters<T>(query: T, ctx: FilterContext): T {
  let q = query as unknown as {
    eq: (c: string, v: unknown) => typeof q;
    gte: (c: string, v: unknown) => typeof q;
    lte: (c: string, v: unknown) => typeof q;
    lt: (c: string, v: unknown) => typeof q;
    in: (c: string, v: unknown[]) => typeof q;
    or: (c: string) => typeof q;
  };
  const { filters, today } = ctx;

  if (isTipoSolicitacao(filters.tipo)) q = q.eq("tipo_solicitacao", filters.tipo.toUpperCase());
  if (isPrioridade(filters.prioridade)) q = q.eq("prioridade", filters.prioridade.toUpperCase());
  if (filters.responsavelId) q = q.eq("responsavel_id", filters.responsavelId);
  if (filters.projetoId) q = q.eq("projeto_id", filters.projetoId);
  if (filters.dataEntradaInicio) q = q.gte("data_entrada", filters.dataEntradaInicio);
  if (filters.dataEntradaFim) q = q.lte("data_entrada", filters.dataEntradaFim);
  if (filters.dataLimiteInicio) q = q.gte("data_limite", filters.dataLimiteInicio);
  if (filters.dataLimiteFim) q = q.lte("data_limite", filters.dataLimiteFim);

  if (ctx.municipioProjectIds) {
    q = q.in("projeto_id", ctx.municipioProjectIds.length ? ctx.municipioProjectIds : [EMPTY_UUID]);
  }

  if (ctx.searchIds && ctx.searchIds.term) {
    const terms = [`projeto_codigo.ilike.%${ctx.searchIds.term}%`];
    if (ctx.searchIds.projetoIds.length) terms.push(`projeto_id.in.(${ctx.searchIds.projetoIds.join(",")})`);
    if (ctx.searchIds.responsavelIds.length) terms.push(`responsavel_id.in.(${ctx.searchIds.responsavelIds.join(",")})`);
    if (ctx.searchIds.solicitanteIds.length) terms.push(`solicitante_id.in.(${ctx.searchIds.solicitanteIds.join(",")})`);
    q = q.or(terms.join(","));
  }

  if (ctx.includeStatus) {
    const status = normalizeText(filters.status).toUpperCase();
    if (status === "ATRASADO") {
      q = q.eq("status", "PENDENTE").lt("data_limite", today);
    } else if (status === "PENDENTE") {
      q = q.eq("status", "PENDENTE").gte("data_limite", today);
    } else if (status === "CONCLUIDO" || status === "CANCELADO") {
      q = q.eq("status", status);
    }
  }

  return q as unknown as T;
}

export async function insertHistory(
  supabase: SupabaseClient,
  params: {
    tenantId: string;
    solicitacaoId: string;
    changeType: "CREATE" | "UPDATE" | "VERIFY" | "CANCEL";
    changes: Record<string, unknown>;
    reason: string | null;
    actorUserId: string;
  },
): Promise<void> {
  await supabase.from("cronograma_solicitacoes_history").insert({
    tenant_id: params.tenantId,
    solicitacao_id: params.solicitacaoId,
    change_type: params.changeType,
    changes: params.changes,
    reason: params.reason,
    created_by: params.actorUserId,
  });
}
