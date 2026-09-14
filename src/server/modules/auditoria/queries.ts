import type { SupabaseClient } from "@supabase/supabase-js";

import { loadAllRows, loadRowsInChunks } from "@/lib/server/apiHelpers";

type PaginationRange = { from: number; to: number };

/**
 * Teto de seguranca para a exportacao: leitura completa do resultado filtrado
 * numa unica resposta (via loadAllRows), no mesmo padrao de
 * `src/app/api/people/export/route.ts`.
 */
export const MAX_EXPORT_ROWS = 20000;

/** Ids por lote nos filtros `.in(...)` de usuario: limita a largura da URL do PostgREST. */
const USER_ID_CHUNK_SIZE = 200;

const USER_SEARCH_COLUMNS = ["display", "login_name", "matricula"] as const;

const AUDIT_USER_SELECT = "id, display, login_name, matricula";

type AuditUserRow = { id: string; display: string | null; login_name: string | null; matricula: string | null };

export type UserSummary = { display: string; matricula: string | null };

// ---------------------------------------------------------------------------
// Usuarios do tenant na Auditoria
//
// Um usuario pertence ao tenant por dois caminhos: tenant de origem
// (`app_users.tenant_id`) ou vinculo em `app_user_tenants` — usuarios multi-tenant
// mantem o `app_users.id` do tenant de origem e operam nos demais pelo vinculo.
// Considerar so a origem deixava como "Nao identificado" quem alterou dados no
// tenant ativo por vinculo, e a busca por usuario nao os encontrava.
//
// O vinculo vale ATIVO OU INATIVO, diferente de `fetchTenantLinkedAppUsers`
// (telas operacionais): a Auditoria le historico, e quem agiu no tenant precisa
// continuar identificado depois que o vinculo e desativado.
//
// Toda consulta continua presa ao tenant: `app_users` por `tenant_id`, ou restrito
// a ids cujo vinculo com o tenant ja foi confirmado em `app_user_tenants`.
// ---------------------------------------------------------------------------

async function listTenantLinkedUserIds(supabase: SupabaseClient, tenantId: string): Promise<string[]> {
  const { data, error } = await loadAllRows<{ user_id: string }>((from, to) =>
    supabase
      .from("app_user_tenants")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .order("user_id", { ascending: true })
      .range(from, to)
      .returns<Array<{ user_id: string }>>(),
  );

  if (error) {
    throw error;
  }

  return Array.from(new Set((data ?? []).map((row) => row.user_id).filter(Boolean)));
}

/**
 * Resolve ids de usuarios do tenant (origem ou vinculo) que casam com o texto de busca
 * (nome, login ou matricula).
 *
 * Nunca usa `.or()` com texto livre do cliente (convencao do projeto, ver
 * `src/server/modules/programacao-normalizada/queries.ts`): cada candidato e uma
 * chamada `.ilike()` parametrizada separada, e os ids sao unidos em memoria.
 *
 * Retorna `null` quando nao ha texto de busca (sem filtro); um array (possivelmente
 * vazio) quando ha busca — array vazio significa "nenhum usuario casa", e o chamador
 * deve encerrar a listagem em zero resultados sem consultar a tabela principal.
 */
export async function resolveUserIdsByQuery(
  supabase: SupabaseClient,
  tenantId: string,
  query: string | null,
): Promise<string[] | null> {
  const trimmed = String(query ?? "").trim();
  if (!trimmed) {
    return null;
  }

  const pattern = `%${trimmed}%`;
  const linkedUserIds = await listTenantLinkedUserIds(supabase, tenantId);

  const results = await Promise.all(
    USER_SEARCH_COLUMNS.flatMap((column) => [
      loadAllRows<{ id: string }>((from, to) =>
        supabase
          .from("app_users")
          .select("id")
          .eq("tenant_id", tenantId)
          .ilike(column, pattern)
          .order("id", { ascending: true })
          .range(from, to)
          .returns<Array<{ id: string }>>(),
      ),
      loadRowsInChunks<{ id: string }>(
        linkedUserIds,
        (chunk, from, to) =>
          supabase
            .from("app_users")
            .select("id")
            .in("id", chunk)
            .ilike(column, pattern)
            .order("id", { ascending: true })
            .range(from, to)
            .returns<Array<{ id: string }>>(),
        { chunkSize: USER_ID_CHUNK_SIZE },
      ),
    ]),
  );

  const ids = new Set<string>();
  for (const result of results) {
    if (result.error) {
      throw result.error;
    }
    for (const row of result.data ?? []) {
      ids.add(row.id);
    }
  }

  return Array.from(ids);
}

/**
 * Nome e matricula dos autores das linhas ja filtradas por tenant. Os ids vem sempre
 * dessas linhas no servidor, nunca do cliente; mesmo assim so resolve quem pertence
 * ao tenant (origem ou vinculo) — id de fora do tenant fica sem resumo.
 */
export async function fetchUserSummaries(
  supabase: SupabaseClient,
  tenantId: string,
  ids: readonly string[],
): Promise<Map<string, UserSummary>> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (!uniqueIds.length) {
    return new Map();
  }

  const { data: homeUsers, error: homeUsersError } = await loadRowsInChunks<AuditUserRow>(
    uniqueIds,
    (chunk, from, to) =>
      supabase
        .from("app_users")
        .select(AUDIT_USER_SELECT)
        .eq("tenant_id", tenantId)
        .in("id", chunk)
        .order("id", { ascending: true })
        .range(from, to)
        .returns<AuditUserRow[]>(),
    { chunkSize: USER_ID_CHUNK_SIZE },
  );

  if (homeUsersError) {
    throw homeUsersError;
  }

  const users = [...(homeUsers ?? [])];
  const homeUserIds = new Set(users.map((user) => user.id));
  const missingIds = uniqueIds.filter((id) => !homeUserIds.has(id));

  if (missingIds.length) {
    const { data: links, error: linksError } = await loadRowsInChunks<{ user_id: string }>(
      missingIds,
      (chunk, from, to) =>
        supabase
          .from("app_user_tenants")
          .select("user_id")
          .eq("tenant_id", tenantId)
          .in("user_id", chunk)
          .order("user_id", { ascending: true })
          .range(from, to)
          .returns<Array<{ user_id: string }>>(),
      { chunkSize: USER_ID_CHUNK_SIZE },
    );

    if (linksError) {
      throw linksError;
    }

    const linkedUserIds = (links ?? []).map((link) => link.user_id);
    const { data: linkedUsers, error: linkedUsersError } = await loadRowsInChunks<AuditUserRow>(
      linkedUserIds,
      (chunk, from, to) =>
        supabase
          .from("app_users")
          .select(AUDIT_USER_SELECT)
          .in("id", chunk)
          .order("id", { ascending: true })
          .range(from, to)
          .returns<AuditUserRow[]>(),
      { chunkSize: USER_ID_CHUNK_SIZE },
    );

    if (linkedUsersError) {
      throw linkedUsersError;
    }

    users.push(...(linkedUsers ?? []));
  }

  const map = new Map<string, UserSummary>();
  for (const user of users) {
    map.set(user.id, {
      display: String(user.display ?? user.login_name ?? "").trim() || "Nao identificado",
      matricula: user.matricula,
    });
  }

  return map;
}

function toRangeStart(date: string): string {
  return `${date}T00:00:00.000Z`;
}

function toRangeEnd(date: string): string {
  return `${date}T23:59:59.999Z`;
}

// ---------------------------------------------------------------------------
// Aba 1 - Historico de alteracoes (app_entity_history)
// ---------------------------------------------------------------------------

export type ChangeHistoryFilters = {
  moduleKey: string | null;
  userIds: string[] | null;
  changeType: string | null;
  entityCode: string | null;
  dateFrom: string | null;
  dateTo: string | null;
};

export type ChangeHistoryRow = {
  id: string;
  module_key: string;
  entity_table: string;
  entity_id: string;
  entity_code: string | null;
  change_type: string;
  reason: string | null;
  changes: Record<string, unknown>;
  created_at: string;
  created_by: string | null;
};

const CHANGE_HISTORY_SELECT =
  "id, module_key, entity_table, entity_id, entity_code, change_type, reason, changes, created_at, created_by";

function buildChangeHistoryQuery(
  supabase: SupabaseClient,
  tenantId: string,
  filters: ChangeHistoryFilters,
  withCount: boolean,
) {
  let query = supabase
    .from("app_entity_history")
    .select(CHANGE_HISTORY_SELECT, withCount ? { count: "exact" } : undefined)
    .eq("tenant_id", tenantId);

  if (filters.moduleKey) {
    query = query.eq("module_key", filters.moduleKey);
  }
  if (filters.changeType) {
    query = query.eq("change_type", filters.changeType);
  }
  if (filters.entityCode) {
    query = query.ilike("entity_code", `%${filters.entityCode}%`);
  }
  if (filters.userIds) {
    query = query.in("created_by", filters.userIds);
  }
  if (filters.dateFrom) {
    query = query.gte("created_at", toRangeStart(filters.dateFrom));
  }
  if (filters.dateTo) {
    query = query.lte("created_at", toRangeEnd(filters.dateTo));
  }

  return query.order("created_at", { ascending: false });
}

export async function listChangeHistory(
  supabase: SupabaseClient,
  tenantId: string,
  filters: ChangeHistoryFilters,
  range: PaginationRange,
): Promise<{ rows: ChangeHistoryRow[]; total: number }> {
  if (filters.userIds !== null && filters.userIds.length === 0) {
    return { rows: [], total: 0 };
  }

  const { data, error, count } = await buildChangeHistoryQuery(supabase, tenantId, filters, true)
    .range(range.from, range.to)
    .returns<ChangeHistoryRow[]>();

  if (error) {
    throw error;
  }

  return { rows: data ?? [], total: count ?? 0 };
}

export async function exportChangeHistory(
  supabase: SupabaseClient,
  tenantId: string,
  filters: ChangeHistoryFilters,
): Promise<{ rows: ChangeHistoryRow[]; truncated: boolean }> {
  if (filters.userIds !== null && filters.userIds.length === 0) {
    return { rows: [], truncated: false };
  }

  const { data, error } = await loadAllRows<ChangeHistoryRow>(
    (from, to) => buildChangeHistoryQuery(supabase, tenantId, filters, false).range(from, to).returns<ChangeHistoryRow[]>(),
    { maxRows: MAX_EXPORT_ROWS },
  );

  if (error) {
    throw error;
  }

  const rows = data ?? [];
  return { rows, truncated: rows.length >= MAX_EXPORT_ROWS };
}

export async function listAuditableScreens(
  supabase: SupabaseClient,
): Promise<Array<{ pageKey: string; name: string }>> {
  const { data, error } = await supabase
    .from("app_pages")
    .select("page_key, name")
    .order("name", { ascending: true })
    .returns<Array<{ page_key: string; name: string }>>();

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => ({ pageKey: row.page_key, name: row.name }));
}

// ---------------------------------------------------------------------------
// Aba 2 - Log de acessos (login_audit)
// ---------------------------------------------------------------------------

export type AccessLogFilters = {
  userIds: string[] | null;
  status: string | null;
  eventType: string | null;
  reason: string | null;
  source: string | null;
  dateFrom: string | null;
  dateTo: string | null;
};

export type AccessLogRow = {
  id: string;
  user_id: string | null;
  matricula: string | null;
  login_name: string | null;
  source: string;
  status: string;
  reason: string | null;
  event_type: string;
  event_at: string;
};

// `session_ref` fica fora de proposito: nenhuma tela usa, e a Edge Function `logout`
// aceita `session_ref` + `reason=TOKEN_EXPIRED` sem sessao valida para gravar LOGOUT —
// quem tem o valor consegue forjar o horario de saida de outra sessao.
const ACCESS_LOG_SELECT = "id, user_id, matricula, login_name, source, status, reason, event_type, event_at";

function buildAccessLogQuery(
  supabase: SupabaseClient,
  tenantId: string,
  filters: AccessLogFilters,
  withCount: boolean,
) {
  let query = supabase
    .from("login_audit")
    .select(ACCESS_LOG_SELECT, withCount ? { count: "exact" } : undefined)
    .eq("tenant_id", tenantId);

  if (filters.status) {
    query = query.eq("status", filters.status);
  }
  if (filters.eventType) {
    query = query.eq("event_type", filters.eventType);
  }
  if (filters.reason) {
    query = query.eq("reason", filters.reason);
  }
  if (filters.source) {
    query = query.eq("source", filters.source);
  }
  if (filters.userIds) {
    query = query.in("user_id", filters.userIds);
  }
  if (filters.dateFrom) {
    query = query.gte("event_at", toRangeStart(filters.dateFrom));
  }
  if (filters.dateTo) {
    query = query.lte("event_at", toRangeEnd(filters.dateTo));
  }

  return query.order("event_at", { ascending: false });
}

export async function listAccessLog(
  supabase: SupabaseClient,
  tenantId: string,
  filters: AccessLogFilters,
  range: PaginationRange,
): Promise<{ rows: AccessLogRow[]; total: number }> {
  if (filters.userIds !== null && filters.userIds.length === 0) {
    return { rows: [], total: 0 };
  }

  const { data, error, count } = await buildAccessLogQuery(supabase, tenantId, filters, true)
    .range(range.from, range.to)
    .returns<AccessLogRow[]>();

  if (error) {
    throw error;
  }

  return { rows: data ?? [], total: count ?? 0 };
}

export async function exportAccessLog(
  supabase: SupabaseClient,
  tenantId: string,
  filters: AccessLogFilters,
): Promise<{ rows: AccessLogRow[]; truncated: boolean }> {
  if (filters.userIds !== null && filters.userIds.length === 0) {
    return { rows: [], truncated: false };
  }

  const { data, error } = await loadAllRows<AccessLogRow>(
    (from, to) => buildAccessLogQuery(supabase, tenantId, filters, false).range(from, to).returns<AccessLogRow[]>(),
    { maxRows: MAX_EXPORT_ROWS },
  );

  if (error) {
    throw error;
  }

  const rows = data ?? [];
  return { rows, truncated: rows.length >= MAX_EXPORT_ROWS };
}

// ---------------------------------------------------------------------------
// Aba 3 - Log de erros (app_error_logs)
// ---------------------------------------------------------------------------

export type ErrorLogFilters = {
  userIds: string[] | null;
  severity: string | null;
  screen: string | null;
  source: string | null;
  dateFrom: string | null;
  dateTo: string | null;
};

export type ErrorLogRow = {
  id: string;
  user_id: string | null;
  source: string;
  severity: string;
  screen: string | null;
  message: string;
  stacktrace: string | null;
  created_at: string;
};

// `matricula`/`login_name` gravados em `app_error_logs` nao identificam o usuario: a Edge
// Function `log_error` aceita a matricula enviada pelo cliente e nunca grava `login_name`.
// A identidade vem de `user_id` (derivado do JWT) resolvido por `fetchUserSummaries`.
const ERROR_LOG_SELECT = "id, user_id, source, severity, screen, message, stacktrace, created_at";

function buildErrorLogQuery(
  supabase: SupabaseClient,
  tenantId: string,
  filters: ErrorLogFilters,
  withCount: boolean,
) {
  let query = supabase
    .from("app_error_logs")
    .select(ERROR_LOG_SELECT, withCount ? { count: "exact" } : undefined)
    .eq("tenant_id", tenantId);

  if (filters.severity) {
    query = query.eq("severity", filters.severity);
  }
  if (filters.screen) {
    query = query.ilike("screen", `%${filters.screen}%`);
  }
  if (filters.source) {
    query = query.eq("source", filters.source);
  }
  if (filters.userIds) {
    query = query.in("user_id", filters.userIds);
  }
  if (filters.dateFrom) {
    query = query.gte("created_at", toRangeStart(filters.dateFrom));
  }
  if (filters.dateTo) {
    query = query.lte("created_at", toRangeEnd(filters.dateTo));
  }

  return query.order("created_at", { ascending: false });
}

export async function listErrorLogs(
  supabase: SupabaseClient,
  tenantId: string,
  filters: ErrorLogFilters,
  range: PaginationRange,
): Promise<{ rows: ErrorLogRow[]; total: number }> {
  if (filters.userIds !== null && filters.userIds.length === 0) {
    return { rows: [], total: 0 };
  }

  const { data, error, count } = await buildErrorLogQuery(supabase, tenantId, filters, true)
    .range(range.from, range.to)
    .returns<ErrorLogRow[]>();

  if (error) {
    throw error;
  }

  return { rows: data ?? [], total: count ?? 0 };
}

export async function exportErrorLogs(
  supabase: SupabaseClient,
  tenantId: string,
  filters: ErrorLogFilters,
): Promise<{ rows: ErrorLogRow[]; truncated: boolean }> {
  if (filters.userIds !== null && filters.userIds.length === 0) {
    return { rows: [], truncated: false };
  }

  const { data, error } = await loadAllRows<ErrorLogRow>(
    (from, to) => buildErrorLogQuery(supabase, tenantId, filters, false).range(from, to).returns<ErrorLogRow[]>(),
    { maxRows: MAX_EXPORT_ROWS },
  );

  if (error) {
    throw error;
  }

  const rows = data ?? [];
  return { rows, truncated: rows.length >= MAX_EXPORT_ROWS };
}
