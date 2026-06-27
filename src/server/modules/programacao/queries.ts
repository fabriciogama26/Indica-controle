import { SupabaseClient } from "@supabase/supabase-js";

import { PROGRAMMING_SELECT_WITH_OUTAGE_STRUCTURE_AND_ENEL } from "./selects";
import type {
  AppUserLookupRow,
  ProgrammingActivityRow,
  ProgrammingConflictPayload,
  ProgrammingHistoryRow,
  ProgrammingOperationalHistoryRow,
  ProgrammingRow,
  ProgrammingStageValidationTeamSummary,
  TeamWeekSummaryRow,
} from "./types";
import {
  formatTime,
  normalizePositiveNumber,
  normalizeProgrammingStructureFields,
  normalizeSgdNumber,
  normalizeText,
  normalizeWorkCompletionStatus,
  resolveAppUserName,
} from "./normalizers";
import {
  fetchProgrammingEqCatalog,
  fetchProgrammingSgdTypes,
  fetchTeamsByIds,
} from "./catalogs";

export async function fetchProgrammingRows(
  supabase: SupabaseClient,
  tenantId: string,
  startDate: string,
  endDate: string,
) {
  const { data, error } = await supabase
    .from("project_programming")
    .select(PROGRAMMING_SELECT_WITH_OUTAGE_STRUCTURE_AND_ENEL)
    .eq("tenant_id", tenantId)
    .gte("execution_date", startDate)
    .lte("execution_date", endDate)
    .order("execution_date", { ascending: true })
    .order("start_time", { ascending: true })
    .returns<ProgrammingRow[]>();

  if (error) {
    return [] as ProgrammingRow[];
  }

  return (data ?? []).map((item) =>
    normalizeProgrammingStructureFields(item as unknown as Record<string, unknown>),
  );
}

export async function fetchProgrammingWeekSummary(
  supabase: SupabaseClient,
  tenantId: string,
  weekStart: string,
) {
  const { data, error } = await supabase.rpc("get_programming_week_summary", {
    p_tenant_id: tenantId,
    p_week_start: weekStart,
  });

  if (error) {
    return [] as TeamWeekSummaryRow[];
  }

  return (data ?? []) as TeamWeekSummaryRow[];
}

export async function fetchProgrammingActivities(
  supabase: SupabaseClient,
  tenantId: string,
  programmingIds: string[],
) {
  if (!programmingIds.length) {
    return {
      activityMap: new Map<string, ProgrammingActivityRow[]>(),
      hasError: false,
    };
  }

  const CHUNK_SIZE = 100;
  const chunks: string[][] = [];
  for (let i = 0; i < programmingIds.length; i += CHUNK_SIZE) {
    chunks.push(programmingIds.slice(i, i + CHUNK_SIZE));
  }

  const results = await Promise.all(
    chunks.map((chunk) =>
      supabase
        .from("project_programming_activities")
        .select("id, programming_id, service_activity_id, activity_code, activity_description, activity_unit, quantity, is_active")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .in("programming_id", chunk)
        .order("activity_code", { ascending: true })
        .returns<ProgrammingActivityRow[]>(),
    ),
  );

  if (results.some((r) => !!r.error)) {
    return {
      activityMap: new Map<string, ProgrammingActivityRow[]>(),
      hasError: true,
    };
  }

  const activityMap = new Map<string, ProgrammingActivityRow[]>();
  for (const result of results) {
    for (const item of result.data ?? []) {
      const current = activityMap.get(item.programming_id) ?? [];
      current.push(item);
      activityMap.set(item.programming_id, current);
    }
  }

  return {
    activityMap,
    hasError: false,
  };
}

export async function fetchProgrammingActivitiesForSave(params: {
  supabase: SupabaseClient;
  tenantId: string;
  programmingId: string;
}) {
  const { data, error } = await params.supabase
    .from("project_programming_activities")
    .select("service_activity_id, quantity")
    .eq("tenant_id", params.tenantId)
    .eq("programming_id", params.programmingId)
    .eq("is_active", true)
    .returns<Array<{ service_activity_id: string; quantity: number }>>();

  if (error) {
    return null;
  }

  return (data ?? [])
    .map((item) => ({
      catalogId: normalizeText(item.service_activity_id),
      quantity: normalizePositiveNumber(item.quantity),
    }))
    .filter((item): item is { catalogId: string; quantity: number } => Boolean(item.catalogId) && item.quantity !== null);
}

export async function fetchRescheduledProgrammingIds(
  supabase: SupabaseClient,
  tenantId: string,
  programmingIds: string[],
) {
  if (!programmingIds.length) {
    return new Map<
      string,
      {
        historyId: string;
        changedAt: string;
        reason: string;
        fromDate: string;
        toDate: string;
      }
    >();
  }

  const { data, error } = await supabase
    .from("project_programming_history")
    .select("id, programming_id, created_by, reason, changes, metadata, created_at, action_type")
    .eq("tenant_id", tenantId)
    .eq("action_type", "RESCHEDULE")
    .in("programming_id", programmingIds)
    .order("created_at", { ascending: false })
    .returns<Array<ProgrammingOperationalHistoryRow & { action_type: string }>>();

  if (error) {
    return new Map<
      string,
      {
        historyId: string;
        changedAt: string;
        reason: string;
        fromDate: string;
        toDate: string;
      }
    >();
  }

  const normalizedData: ProgrammingHistoryRow[] = (data ?? []).map((item) => ({
    id: item.id,
    entity_id: item.programming_id,
    created_by: item.created_by ?? null,
    changed_by_name: "",
    reason: item.reason,
    changes: item.changes,
    metadata: {
      ...(item.metadata ?? {}),
      action: normalizeText(item.action_type) || normalizeText(item.metadata?.action),
    },
    created_at: item.created_at,
  }));

  const latestReschedules = new Map<
    string,
    {
      historyId: string;
      changedAt: string;
      reason: string;
      fromDate: string;
      toDate: string;
    }
  >();

  for (const item of normalizedData) {
    if (latestReschedules.has(item.entity_id)) {
      continue;
    }

    if (normalizeText(item.metadata?.action).toUpperCase() !== "RESCHEDULE") {
      continue;
    }

    const executionDateChange = item.changes?.executionDate as
      | { from?: string | null; to?: string | null }
      | undefined;

    latestReschedules.set(item.entity_id, {
      historyId: item.id,
      changedAt: item.created_at,
      reason: normalizeText(item.reason),
      fromDate: normalizeText(executionDateChange?.from),
      toDate: normalizeText(executionDateChange?.to),
    });
  }

  return latestReschedules;
}

export async function fetchProgrammingHistory(
  supabase: SupabaseClient,
  tenantId: string,
  programmingId: string,
) {
  const { data, error } = await supabase
    .from("project_programming_history")
    .select("id, programming_id, created_by, reason, changes, metadata, created_at, action_type")
    .eq("tenant_id", tenantId)
    .eq("programming_id", programmingId)
    .order("created_at", { ascending: false })
    .returns<Array<ProgrammingOperationalHistoryRow & { action_type: string }>>();

  if (error) {
    return [] as ProgrammingHistoryRow[];
  }

  const historyRows = data ?? [];
  const historyAuthorIds = Array.from(
    new Set(historyRows.map((item) => item.created_by).filter((value): value is string => Boolean(value))),
  );

  let historyUsers: AppUserLookupRow[] = [];
  if (historyAuthorIds.length > 0) {
    const usersResult = await supabase
      .from("app_users")
      .select("id, display, login_name")
      .eq("tenant_id", tenantId)
      .in("id", historyAuthorIds)
      .returns<AppUserLookupRow[]>();

    if (!usersResult.error) {
      historyUsers = usersResult.data ?? [];
    }
  }

  const historyUserMap = new Map(historyUsers.map((item) => [item.id, item]));

  return historyRows.map((item) => ({
    id: item.id,
    entity_id: item.programming_id,
    created_by: item.created_by ?? null,
    changed_by_name: resolveAppUserName(historyUserMap.get(item.created_by ?? "")),
    reason: item.reason,
    changes: item.changes,
    metadata: {
      ...(item.metadata ?? {}),
      action: normalizeText(item.action_type) || normalizeText(item.metadata?.action),
    },
    created_at: item.created_at,
  }));
}

export async function fetchNextProgrammingStage(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  teamIds: string[],
  executionDate: string,
) {
  if (!projectId || !teamIds.length || !executionDate) {
    return 1;
  }

  const { data, error } = await supabase
    .from("project_programming")
    .select("etapa_number")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .in("team_id", teamIds)
    .lt("execution_date", executionDate)
    .not("etapa_number", "is", null)
    .order("etapa_number", { ascending: false })
    .limit(1)
    .returns<Array<{ etapa_number: number | null }>>();

  if (error) {
    return 1;
  }

  const highestStage = Number(data?.[0]?.etapa_number ?? 0);
  if (!Number.isFinite(highestStage) || highestStage < 1) {
    return 1;
  }

  return highestStage + 1;
}

export async function fetchProgrammingStageValidation(params: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  teamIds: string[];
  enteredEtapaNumber: number;
  excludeProgrammingId?: string | null;
  currentEditingStage?: number | null;
  currentEditingDate?: string | null;
  currentEditingTeamId?: string | null;
}) {
  const { data, error } = await params.supabase
    .from("project_programming")
    .select("id, team_id, etapa_number, execution_date")
    .eq("tenant_id", params.tenantId)
    .eq("project_id", params.projectId)
    .in("team_id", params.teamIds)
    .not("etapa_number", "is", null)
    .returns<Array<{ id: string; team_id: string; etapa_number: number | null; execution_date: string }>>();

  if (error) {
    return [];
  }

  const relevantRows = (data ?? []).filter((item) => {
    if (!item.etapa_number || item.etapa_number < 1) {
      return false;
    }

    if (params.excludeProgrammingId && item.id === params.excludeProgrammingId) {
      return false;
    }

    return item.etapa_number >= params.enteredEtapaNumber;
  });

  const relevantTeamIds = new Set(relevantRows.map((item) => item.team_id));
  if (
    params.currentEditingTeamId
    && params.currentEditingStage
    && params.currentEditingStage > params.enteredEtapaNumber
  ) {
    relevantTeamIds.add(params.currentEditingTeamId);
  }

  if (!relevantRows.length && !relevantTeamIds.size) {
    return [];
  }

  const uniqueTeamIds = Array.from(relevantTeamIds);
  const { data: teamRows } = await params.supabase
    .from("teams")
    .select("id, name")
    .eq("tenant_id", params.tenantId)
    .in("id", uniqueTeamIds)
    .returns<Array<{ id: string; name: string }>>();

  const teamNameMap = new Map((teamRows ?? []).map((item) => [item.id, normalizeText(item.name)]));

  return uniqueTeamIds
    .map((teamId) => {
      const teamItems = relevantRows.filter((item) => item.team_id === teamId);
      let existingStages = Array.from(
        new Set(
          teamItems
            .map((item) => Number(item.etapa_number ?? 0))
            .filter((stage) => Number.isFinite(stage) && stage >= params.enteredEtapaNumber),
        ),
      ).sort((left, right) => left - right);

      let existingDates = Array.from(new Set(teamItems.map((item) => item.execution_date))).sort();

      if (
        params.currentEditingTeamId === teamId
        && params.currentEditingStage
        && params.currentEditingStage > params.enteredEtapaNumber
      ) {
        if (!existingStages.includes(params.currentEditingStage)) {
          existingStages = [...existingStages, params.currentEditingStage].sort((left, right) => left - right);
        }

        if (params.currentEditingDate && !existingDates.includes(params.currentEditingDate)) {
          existingDates = [...existingDates, params.currentEditingDate].sort();
        }
      }

      const highestStage = existingStages.length ? Math.max(...existingStages) : 0;

      return {
        teamId,
        teamName: teamNameMap.get(teamId) ?? teamId,
        highestStage,
        existingStages,
        existingDates,
      } satisfies ProgrammingStageValidationTeamSummary;
    })
    .filter((item) => item.existingStages.length > 0)
    .sort((left, right) => left.teamName.localeCompare(right.teamName));
}

export async function fetchProgrammingById(
  supabase: SupabaseClient,
  tenantId: string,
  programmingId: string,
) {
  const { data, error } = await supabase
    .from("project_programming")
    .select(PROGRAMMING_SELECT_WITH_OUTAGE_STRUCTURE_AND_ENEL)
    .eq("tenant_id", tenantId)
    .eq("id", programmingId)
    .maybeSingle<ProgrammingRow>();

  if (error || !data) {
    return null;
  }

  return normalizeProgrammingStructureFields(data as unknown as Record<string, unknown>);
}

export async function fetchProgrammingConflictPayload(params: {
  supabase: SupabaseClient;
  tenantId: string;
  programmingId: string;
  requested?: {
    executionDate?: string | null;
    teamId?: string | null;
    startTime?: string | null;
    endTime?: string | null;
    status?: string | null;
  };
}) {
  const { data: currentRow, error } = await params.supabase
    .from("project_programming")
    .select("id, project_id, team_id, status, execution_date, start_time, end_time, updated_at, updated_by")
    .eq("tenant_id", params.tenantId)
    .eq("id", params.programmingId)
    .maybeSingle<{
      id: string;
      project_id: string;
      team_id: string;
      status: string;
      execution_date: string;
      start_time: string;
      end_time: string;
      updated_at: string;
      updated_by: string | null;
    }>();

  if (error || !currentRow) {
    return null;
  }

  let updatedBy: string | null = null;
  if (currentRow.updated_by) {
    const { data: actor } = await params.supabase
      .from("app_users")
      .select("login_name, email, matricula")
      .eq("tenant_id", params.tenantId)
      .eq("id", currentRow.updated_by)
      .maybeSingle<{ login_name: string | null; email: string | null; matricula: string | null }>();

    updatedBy =
      normalizeText(actor?.login_name)
      || normalizeText(actor?.email)
      || normalizeText(actor?.matricula)
      || null;
  }

  const changedFields: string[] = [];
  const requested = params.requested ?? {};
  if (requested.executionDate && requested.executionDate !== currentRow.execution_date) {
    changedFields.push("executionDate");
  }
  if (requested.teamId && requested.teamId !== currentRow.team_id) {
    changedFields.push("teamId");
  }
  if (requested.startTime && requested.startTime !== formatTime(currentRow.start_time)) {
    changedFields.push("startTime");
  }
  if (requested.endTime && requested.endTime !== formatTime(currentRow.end_time)) {
    changedFields.push("endTime");
  }
  if (requested.status && requested.status !== currentRow.status) {
    changedFields.push("status");
  }

  return {
    error: "conflict" as const,
    message: "Esta programacao foi alterada por outro usuario.",
    currentRecord: {
      id: currentRow.id,
      projectId: currentRow.project_id,
      teamId: currentRow.team_id,
      status: currentRow.status,
      executionDate: currentRow.execution_date,
      startTime: formatTime(currentRow.start_time),
      endTime: formatTime(currentRow.end_time),
      updatedAt: currentRow.updated_at,
    },
    currentUpdatedAt: currentRow.updated_at,
    updatedBy,
    changedFields,
  } satisfies ProgrammingConflictPayload;
}

export async function fetchProgrammingResponseItem(
  supabase: SupabaseClient,
  tenantId: string,
  programmingId: string,
) {
  const row = await fetchProgrammingById(supabase, tenantId, programmingId);
  if (!row) {
    return null;
  }

  const [activitiesMap, projectRows, sgdTypes, eqCatalog, rescheduleHistoryMap, teamRows] = await Promise.all([
    fetchProgrammingActivities(supabase, tenantId, [programmingId]),
    supabase
      .from("project_with_labels")
      .select("id, service_center_text")
      .eq("tenant_id", tenantId)
      .eq("id", row.project_id)
      .returns<Array<{ id: string; service_center_text: string | null }>>(),
    fetchProgrammingSgdTypes(supabase, tenantId),
    fetchProgrammingEqCatalog(supabase, tenantId),
    fetchRescheduledProgrammingIds(supabase, tenantId, [programmingId]),
    fetchTeamsByIds(supabase, tenantId, [row.team_id]),
  ]);

  const projectBase = normalizeText(projectRows.data?.[0]?.service_center_text) || "Sem base";
  const sgdType = row.sgd_type_id ? sgdTypes.find((item) => item.id === row.sgd_type_id) ?? null : null;
  const eqType = row.electrical_eq_catalog_id
    ? eqCatalog.find((item) => item.id === row.electrical_eq_catalog_id) ?? null
    : null;
  const team = teamRows[0] ?? null;
  const scheduleActivities = activitiesMap.activityMap.get(programmingId) ?? [];

  return {
    id: row.id,
    projectId: row.project_id,
    teamId: row.team_id,
    programmingGroupId: normalizeText(row.programming_group_id),
    status: row.status,
    isReprogrammed: row.status === "REPROGRAMADA",
    date: row.execution_date,
    period: row.period === "INTEGRAL" ? "integral" : "partial",
    startTime: formatTime(row.start_time),
    endTime: formatTime(row.end_time),
    outageStartTime: formatTime(row.outage_start_time),
    outageEndTime: formatTime(row.outage_end_time),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expectedMinutes: Number(row.expected_minutes ?? 0),
    posteQty: Number(row.poste_qty ?? 0),
    estruturaQty: Number(row.estrutura_qty ?? 0),
    trafoQty: Number(row.trafo_qty ?? 0),
    redeQty: Number(row.rede_qty ?? 0),
    redeQtyText: normalizeText(row.rede_qty ?? "0"),
    etapaNumber: row.etapa_number === null ? null : Number(row.etapa_number),
    etapaUnica: Boolean(row.etapa_unica ?? false),
    etapaFinal: Boolean(row.etapa_final ?? false),
    workCompletionStatus: normalizeWorkCompletionStatus(row.work_completion_status),
    anticipatedByProgrammingId: normalizeText(row.anticipated_by_programming_id),
    anticipatedAt: normalizeText(row.anticipated_at),
    previousWorkCompletionStatus: normalizeWorkCompletionStatus(row.previous_work_completion_status),
    affectedCustomers: Number(row.affected_customers ?? 0),
    sgdTypeId: row.sgd_type_id,
    electricalEqCatalogId: row.electrical_eq_catalog_id,
    electricalEqCode: normalizeText(eqType?.code),
    sgdTypeDescription: normalizeText(sgdType?.description),
    sgdExportColumn: normalizeText(sgdType?.export_column),
    feeder: normalizeText(row.feeder),
    support: normalizeText(row.support),
    supportItemId: row.support_item_id,
    note: normalizeText(row.note),
    electricalField: normalizeText(row.campo_eletrico),
    serviceDescription: normalizeText(row.service_description),
    activitiesLoaded: !activitiesMap.hasError,
    teamName: normalizeText(team?.name) || row.team_id,
    teamVehiclePlate: normalizeText(team?.vehiclePlate),
    teamServiceCenterName: normalizeText(team?.serviceCenterName),
    teamTypeName: normalizeText(team?.teamTypeName),
    teamForemanName: normalizeText(team?.foremanName),
    projectBase,
    statusReason: normalizeText(row.cancellation_reason),
    statusChangedAt: row.canceled_at ?? "",
    wasRescheduled: row.status === "REPROGRAMADA" || rescheduleHistoryMap.has(row.id),
    lastReschedule: rescheduleHistoryMap.get(row.id)
      ? {
          id: rescheduleHistoryMap.get(row.id)?.historyId ?? "",
          changedAt: rescheduleHistoryMap.get(row.id)?.changedAt ?? "",
          reason: rescheduleHistoryMap.get(row.id)?.reason ?? "",
          fromDate: rescheduleHistoryMap.get(row.id)?.fromDate ?? "",
          toDate: rescheduleHistoryMap.get(row.id)?.toDate ?? "",
        }
      : null,
    activities: scheduleActivities.map((activity) => ({
      id: activity.id,
      catalogId: activity.service_activity_id,
      code: normalizeText(activity.activity_code),
      description: normalizeText(activity.activity_description),
      quantity: Number(activity.quantity ?? 0),
      unit: normalizeText(activity.activity_unit),
    })),
    documents: {
      sgd: {
        number: normalizeSgdNumber(row.sgd_number) ?? "",
        approvedAt: row.sgd_included_at ?? "",
        requestedAt: row.sgd_delivered_at ?? "",
        includedAt: row.sgd_included_at ?? "",
        deliveredAt: row.sgd_delivered_at ?? "",
      },
      pi: {
        number: normalizeText(row.pi_number),
        approvedAt: row.pi_included_at ?? "",
        requestedAt: row.pi_delivered_at ?? "",
        includedAt: row.pi_included_at ?? "",
        deliveredAt: row.pi_delivered_at ?? "",
      },
      pep: {
        number: normalizeText(row.pep_number),
        approvedAt: row.pep_included_at ?? "",
        requestedAt: row.pep_delivered_at ?? "",
        includedAt: row.pep_included_at ?? "",
        deliveredAt: row.pep_delivered_at ?? "",
      },
    },
  };
}
