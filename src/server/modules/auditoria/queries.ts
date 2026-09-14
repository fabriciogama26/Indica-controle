import type { SupabaseClient } from "@supabase/supabase-js";

type PaginationRange = { from: number; to: number };

export type UserSummary = { display: string; matricula: string | null };

/**
 * Resolve ids de app_users que casam com o texto de busca (nome, login ou matricula).
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
  const [byDisplay, byLogin, byMatricula] = await Promise.all([
    supabase
      .from("app_users")
      .select("id")
      .eq("tenant_id", tenantId)
      .ilike("display", pattern)
      .returns<Array<{ id: string }>>(),
    supabase
      .from("app_users")
      .select("id")
      .eq("tenant_id", tenantId)
      .ilike("login_name", pattern)
      .returns<Array<{ id: string }>>(),
    supabase
      .from("app_users")
      .select("id")
      .eq("tenant_id", tenantId)
      .ilike("matricula", pattern)
      .returns<Array<{ id: string }>>(),
  ]);

  const ids = new Set<string>();
  for (const result of [byDisplay, byLogin, byMatricula]) {
    for (const row of result.data ?? []) {
      ids.add(row.id);
    }
  }

  return Array.from(ids);
}

export async function fetchUserSummaries(
  supabase: SupabaseClient,
  tenantId: string,
  ids: readonly string[],
): Promise<Map<string, UserSummary>> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (!uniqueIds.length) {
    return new Map();
  }

  const { data } = await supabase
    .from("app_users")
    .select("id, display, login_name, matricula")
    .eq("tenant_id", tenantId)
    .in("id", uniqueIds)
    .returns<Array<{ id: string; display: string | null; login_name: string | null; matricula: string | null }>>();

  const map = new Map<string, UserSummary>();
  for (const user of data ?? []) {
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

export async function listChangeHistory(
  supabase: SupabaseClient,
  tenantId: string,
  filters: ChangeHistoryFilters,
  range: PaginationRange,
): Promise<{ rows: ChangeHistoryRow[]; total: number }> {
  if (filters.userIds !== null && filters.userIds.length === 0) {
    return { rows: [], total: 0 };
  }

  let query = supabase
    .from("app_entity_history")
    .select("id, module_key, entity_table, entity_id, entity_code, change_type, reason, changes, created_at, created_by", {
      count: "exact",
    })
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

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(range.from, range.to)
    .returns<ChangeHistoryRow[]>();

  if (error) {
    throw error;
  }

  return { rows: data ?? [], total: count ?? 0 };
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
  session_ref: string | null;
};

export async function listAccessLog(
  supabase: SupabaseClient,
  tenantId: string,
  filters: AccessLogFilters,
  range: PaginationRange,
): Promise<{ rows: AccessLogRow[]; total: number }> {
  if (filters.userIds !== null && filters.userIds.length === 0) {
    return { rows: [], total: 0 };
  }

  let query = supabase
    .from("login_audit")
    .select("id, user_id, matricula, login_name, source, status, reason, event_type, event_at, session_ref", {
      count: "exact",
    })
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

  const { data, error, count } = await query
    .order("event_at", { ascending: false })
    .range(range.from, range.to)
    .returns<AccessLogRow[]>();

  if (error) {
    throw error;
  }

  return { rows: data ?? [], total: count ?? 0 };
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
  matricula: string | null;
  login_name: string | null;
  source: string;
  severity: string;
  screen: string | null;
  message: string;
  stacktrace: string | null;
  created_at: string;
};

export async function listErrorLogs(
  supabase: SupabaseClient,
  tenantId: string,
  filters: ErrorLogFilters,
  range: PaginationRange,
): Promise<{ rows: ErrorLogRow[]; total: number }> {
  if (filters.userIds !== null && filters.userIds.length === 0) {
    return { rows: [], total: 0 };
  }

  let query = supabase
    .from("app_error_logs")
    .select("id, user_id, matricula, login_name, source, severity, screen, message, stacktrace, created_at", {
      count: "exact",
    })
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

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(range.from, range.to)
    .returns<ErrorLogRow[]>();

  if (error) {
    throw error;
  }

  return { rows: data ?? [], total: count ?? 0 };
}
