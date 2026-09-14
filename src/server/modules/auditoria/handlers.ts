import { NextRequest, NextResponse } from "next/server";

import { resolveAdminOperator } from "@/lib/server/appUsersAdmin";
import { normalizeHistoryChanges, normalizeNullableText, parsePagination } from "@/lib/server/apiHelpers";
import {
  exportAccessLog,
  exportChangeHistory,
  exportErrorLogs,
  fetchUserSummaries,
  listAccessLog,
  listAuditableScreens,
  listChangeHistory,
  listErrorLogs,
  resolveUserIdsByQuery,
  type AccessLogFilters,
  type ChangeHistoryFilters,
  type ErrorLogFilters,
} from "@/server/modules/auditoria/queries";

function parseDateParam(params: URLSearchParams, key: string): string | null {
  const value = normalizeNullableText(params.get(key));
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  return value;
}

function parseChangeHistoryFilters(params: URLSearchParams, userIds: string[] | null): ChangeHistoryFilters {
  return {
    moduleKey: normalizeNullableText(params.get("moduleKey")),
    userIds,
    changeType: normalizeNullableText(params.get("changeType")),
    entityCode: normalizeNullableText(params.get("entityCode")),
    dateFrom: parseDateParam(params, "dateFrom"),
    dateTo: parseDateParam(params, "dateTo"),
  };
}

function parseAccessLogFilters(params: URLSearchParams, userIds: string[] | null): AccessLogFilters {
  return {
    userIds,
    status: normalizeNullableText(params.get("status")),
    eventType: normalizeNullableText(params.get("eventType")),
    reason: normalizeNullableText(params.get("reason")),
    source: normalizeNullableText(params.get("source")),
    dateFrom: parseDateParam(params, "dateFrom"),
    dateTo: parseDateParam(params, "dateTo"),
  };
}

function parseErrorLogFilters(params: URLSearchParams, userIds: string[] | null): ErrorLogFilters {
  return {
    userIds,
    severity: normalizeNullableText(params.get("severity")),
    screen: normalizeNullableText(params.get("screen")),
    source: normalizeNullableText(params.get("source")),
    dateFrom: parseDateParam(params, "dateFrom"),
    dateTo: parseDateParam(params, "dateTo"),
  };
}

export async function getChangeHistory(request: NextRequest) {
  const resolution = await resolveAdminOperator(request);
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const { supabase, operator } = resolution;
  const params = request.nextUrl.searchParams;
  const { page, pageSize, from, to } = parsePagination(params, { defaultPageSize: 20, maxPageSize: 100 });

  try {
    const userIds = await resolveUserIdsByQuery(supabase, operator.tenantId, params.get("userQuery"));

    const { rows, total } = await listChangeHistory(
      supabase,
      operator.tenantId,
      parseChangeHistoryFilters(params, userIds),
      { from, to },
    );

    const creatorIds = Array.from(new Set(rows.map((row) => row.created_by).filter((id): id is string => Boolean(id))));
    const userSummaries = await fetchUserSummaries(supabase, operator.tenantId, creatorIds);

    return NextResponse.json({
      items: rows.map((row) => {
        const summary = row.created_by ? userSummaries.get(row.created_by) : undefined;
        return {
          id: row.id,
          moduleKey: row.module_key,
          entityTable: row.entity_table,
          entityId: row.entity_id,
          entityCode: row.entity_code,
          changeType: row.change_type,
          reason: row.reason,
          changes: normalizeHistoryChanges(row.changes),
          createdAt: row.created_at,
          userName: summary?.display ?? "Nao identificado",
          userMatricula: summary?.matricula ?? null,
        };
      }),
      pagination: { page, pageSize, total },
    });
  } catch {
    return NextResponse.json({ message: "Falha ao carregar o historico de alteracoes." }, { status: 500 });
  }
}

export async function exportChangeHistoryHandler(request: NextRequest) {
  const resolution = await resolveAdminOperator(request);
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const { supabase, operator } = resolution;
  const params = request.nextUrl.searchParams;

  try {
    const userIds = await resolveUserIdsByQuery(supabase, operator.tenantId, params.get("userQuery"));

    const { rows, truncated } = await exportChangeHistory(
      supabase,
      operator.tenantId,
      parseChangeHistoryFilters(params, userIds),
    );

    const creatorIds = Array.from(new Set(rows.map((row) => row.created_by).filter((id): id is string => Boolean(id))));
    const userSummaries = await fetchUserSummaries(supabase, operator.tenantId, creatorIds);

    return NextResponse.json({
      items: rows.map((row) => {
        const summary = row.created_by ? userSummaries.get(row.created_by) : undefined;
        return {
          id: row.id,
          moduleKey: row.module_key,
          entityTable: row.entity_table,
          entityId: row.entity_id,
          entityCode: row.entity_code,
          changeType: row.change_type,
          reason: row.reason,
          changes: normalizeHistoryChanges(row.changes),
          createdAt: row.created_at,
          userName: summary?.display ?? "Nao identificado",
          userMatricula: summary?.matricula ?? null,
        };
      }),
      truncated,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao exportar o historico de alteracoes." }, { status: 500 });
  }
}

export async function getAuditableScreens(request: NextRequest) {
  const resolution = await resolveAdminOperator(request);
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  try {
    const screens = await listAuditableScreens(resolution.supabase);
    return NextResponse.json({ screens });
  } catch {
    return NextResponse.json({ message: "Falha ao carregar as telas auditaveis." }, { status: 500 });
  }
}

export async function getAccessLog(request: NextRequest) {
  const resolution = await resolveAdminOperator(request);
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const { supabase, operator } = resolution;
  const params = request.nextUrl.searchParams;
  const { page, pageSize, from, to } = parsePagination(params, { defaultPageSize: 20, maxPageSize: 100 });

  try {
    const userIds = await resolveUserIdsByQuery(supabase, operator.tenantId, params.get("userQuery"));

    const { rows, total } = await listAccessLog(
      supabase,
      operator.tenantId,
      parseAccessLogFilters(params, userIds),
      { from, to },
    );

    return NextResponse.json({
      items: rows.map((row) => ({
        id: row.id,
        eventType: row.event_type,
        status: row.status,
        reason: row.reason,
        source: row.source,
        matricula: row.matricula,
        loginName: row.login_name,
        eventAt: row.event_at,
        sessionRef: row.session_ref,
      })),
      pagination: { page, pageSize, total },
    });
  } catch {
    return NextResponse.json({ message: "Falha ao carregar o log de acessos." }, { status: 500 });
  }
}

export async function exportAccessLogHandler(request: NextRequest) {
  const resolution = await resolveAdminOperator(request);
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const { supabase, operator } = resolution;
  const params = request.nextUrl.searchParams;

  try {
    const userIds = await resolveUserIdsByQuery(supabase, operator.tenantId, params.get("userQuery"));

    const { rows, truncated } = await exportAccessLog(supabase, operator.tenantId, parseAccessLogFilters(params, userIds));

    return NextResponse.json({
      items: rows.map((row) => ({
        id: row.id,
        eventType: row.event_type,
        status: row.status,
        reason: row.reason,
        source: row.source,
        matricula: row.matricula,
        loginName: row.login_name,
        eventAt: row.event_at,
        sessionRef: row.session_ref,
      })),
      truncated,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao exportar o log de acessos." }, { status: 500 });
  }
}

export async function getErrorLog(request: NextRequest) {
  const resolution = await resolveAdminOperator(request);
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const { supabase, operator } = resolution;
  const params = request.nextUrl.searchParams;
  const { page, pageSize, from, to } = parsePagination(params, { defaultPageSize: 20, maxPageSize: 100 });

  try {
    const userIds = await resolveUserIdsByQuery(supabase, operator.tenantId, params.get("userQuery"));

    const { rows, total } = await listErrorLogs(
      supabase,
      operator.tenantId,
      parseErrorLogFilters(params, userIds),
      { from, to },
    );

    return NextResponse.json({
      items: rows.map((row) => ({
        id: row.id,
        severity: row.severity,
        screen: row.screen,
        message: row.message,
        stacktrace: row.stacktrace,
        matricula: row.matricula,
        loginName: row.login_name,
        source: row.source,
        createdAt: row.created_at,
      })),
      pagination: { page, pageSize, total },
    });
  } catch {
    return NextResponse.json({ message: "Falha ao carregar o log de erros." }, { status: 500 });
  }
}

export async function exportErrorLogHandler(request: NextRequest) {
  const resolution = await resolveAdminOperator(request);
  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const { supabase, operator } = resolution;
  const params = request.nextUrl.searchParams;

  try {
    const userIds = await resolveUserIdsByQuery(supabase, operator.tenantId, params.get("userQuery"));

    const { rows, truncated } = await exportErrorLogs(supabase, operator.tenantId, parseErrorLogFilters(params, userIds));

    return NextResponse.json({
      items: rows.map((row) => ({
        id: row.id,
        severity: row.severity,
        screen: row.screen,
        message: row.message,
        stacktrace: row.stacktrace,
        matricula: row.matricula,
        loginName: row.login_name,
        source: row.source,
        createdAt: row.created_at,
      })),
      truncated,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao exportar o log de erros." }, { status: 500 });
  }
}
