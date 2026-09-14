import type {
  AccessLogFiltersState,
  AccessLogItem,
  ChangeHistoryFiltersState,
  ChangeHistoryItem,
  ErrorLogFiltersState,
  ErrorLogItem,
  PaginationInfo,
  ScreenOption,
} from "./types";

type ChangeHistoryResponse = { items?: ChangeHistoryItem[]; pagination?: PaginationInfo; message?: string };
type AccessLogResponse = { items?: AccessLogItem[]; pagination?: PaginationInfo; message?: string };
type ErrorLogResponse = { items?: ErrorLogItem[]; pagination?: PaginationInfo; message?: string };
type ScreensResponse = { screens?: ScreenOption[]; message?: string };
type ChangeHistoryExportResponse = { items?: ChangeHistoryItem[]; truncated?: boolean; message?: string };
type AccessLogExportResponse = { items?: AccessLogItem[]; truncated?: boolean; message?: string };
type ErrorLogExportResponse = { items?: ErrorLogItem[]; truncated?: boolean; message?: string };

function buildAuthHeaders(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

function appendIfPresent(params: URLSearchParams, key: string, value: string) {
  const trimmed = value.trim();
  if (trimmed) {
    params.set(key, trimmed);
  }
}

export function buildChangeHistoryQuery(filters: ChangeHistoryFiltersState, page: number, pageSize: number) {
  const params = new URLSearchParams();
  appendIfPresent(params, "moduleKey", filters.moduleKey);
  appendIfPresent(params, "userQuery", filters.userQuery);
  appendIfPresent(params, "changeType", filters.changeType);
  appendIfPresent(params, "entityCode", filters.entityCode);
  appendIfPresent(params, "dateFrom", filters.dateFrom);
  appendIfPresent(params, "dateTo", filters.dateTo);
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  return params;
}

export async function fetchChangeHistory(accessToken: string, query: URLSearchParams) {
  const response = await fetch(`/api/auditoria/alteracoes?${query.toString()}`, {
    cache: "no-store",
    headers: buildAuthHeaders(accessToken),
  });
  const data = (await response.json().catch(() => ({}))) as ChangeHistoryResponse;
  return { ok: response.ok, data };
}

export function buildChangeHistoryExportQuery(filters: ChangeHistoryFiltersState) {
  const params = new URLSearchParams();
  appendIfPresent(params, "moduleKey", filters.moduleKey);
  appendIfPresent(params, "userQuery", filters.userQuery);
  appendIfPresent(params, "changeType", filters.changeType);
  appendIfPresent(params, "entityCode", filters.entityCode);
  appendIfPresent(params, "dateFrom", filters.dateFrom);
  appendIfPresent(params, "dateTo", filters.dateTo);
  return params;
}

export async function fetchChangeHistoryExport(accessToken: string, query: URLSearchParams) {
  const response = await fetch(`/api/auditoria/alteracoes/export?${query.toString()}`, {
    cache: "no-store",
    headers: buildAuthHeaders(accessToken),
  });
  const data = (await response.json().catch(() => ({}))) as ChangeHistoryExportResponse;
  return { ok: response.ok, data };
}

export function buildAccessLogQuery(filters: AccessLogFiltersState, page: number, pageSize: number) {
  const params = new URLSearchParams();
  appendIfPresent(params, "userQuery", filters.userQuery);
  appendIfPresent(params, "status", filters.status);
  appendIfPresent(params, "eventType", filters.eventType);
  appendIfPresent(params, "reason", filters.reason);
  appendIfPresent(params, "source", filters.source);
  appendIfPresent(params, "dateFrom", filters.dateFrom);
  appendIfPresent(params, "dateTo", filters.dateTo);
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  return params;
}

export async function fetchAccessLog(accessToken: string, query: URLSearchParams) {
  const response = await fetch(`/api/auditoria/acessos?${query.toString()}`, {
    cache: "no-store",
    headers: buildAuthHeaders(accessToken),
  });
  const data = (await response.json().catch(() => ({}))) as AccessLogResponse;
  return { ok: response.ok, data };
}

export function buildAccessLogExportQuery(filters: AccessLogFiltersState) {
  const params = new URLSearchParams();
  appendIfPresent(params, "userQuery", filters.userQuery);
  appendIfPresent(params, "status", filters.status);
  appendIfPresent(params, "eventType", filters.eventType);
  appendIfPresent(params, "reason", filters.reason);
  appendIfPresent(params, "source", filters.source);
  appendIfPresent(params, "dateFrom", filters.dateFrom);
  appendIfPresent(params, "dateTo", filters.dateTo);
  return params;
}

export async function fetchAccessLogExport(accessToken: string, query: URLSearchParams) {
  const response = await fetch(`/api/auditoria/acessos/export?${query.toString()}`, {
    cache: "no-store",
    headers: buildAuthHeaders(accessToken),
  });
  const data = (await response.json().catch(() => ({}))) as AccessLogExportResponse;
  return { ok: response.ok, data };
}

export function buildErrorLogQuery(filters: ErrorLogFiltersState, page: number, pageSize: number) {
  const params = new URLSearchParams();
  appendIfPresent(params, "userQuery", filters.userQuery);
  appendIfPresent(params, "severity", filters.severity);
  appendIfPresent(params, "screen", filters.screen);
  appendIfPresent(params, "source", filters.source);
  appendIfPresent(params, "dateFrom", filters.dateFrom);
  appendIfPresent(params, "dateTo", filters.dateTo);
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  return params;
}

export async function fetchErrorLog(accessToken: string, query: URLSearchParams) {
  const response = await fetch(`/api/auditoria/erros?${query.toString()}`, {
    cache: "no-store",
    headers: buildAuthHeaders(accessToken),
  });
  const data = (await response.json().catch(() => ({}))) as ErrorLogResponse;
  return { ok: response.ok, data };
}

export function buildErrorLogExportQuery(filters: ErrorLogFiltersState) {
  const params = new URLSearchParams();
  appendIfPresent(params, "userQuery", filters.userQuery);
  appendIfPresent(params, "severity", filters.severity);
  appendIfPresent(params, "screen", filters.screen);
  appendIfPresent(params, "source", filters.source);
  appendIfPresent(params, "dateFrom", filters.dateFrom);
  appendIfPresent(params, "dateTo", filters.dateTo);
  return params;
}

export async function fetchErrorLogExport(accessToken: string, query: URLSearchParams) {
  const response = await fetch(`/api/auditoria/erros/export?${query.toString()}`, {
    cache: "no-store",
    headers: buildAuthHeaders(accessToken),
  });
  const data = (await response.json().catch(() => ({}))) as ErrorLogExportResponse;
  return { ok: response.ok, data };
}

export async function fetchAuditableScreens(accessToken: string) {
  const response = await fetch("/api/auditoria/telas", {
    cache: "no-store",
    headers: buildAuthHeaders(accessToken),
  });
  const data = (await response.json().catch(() => ({}))) as ScreensResponse;
  return { ok: response.ok, data };
}
