// Acesso a dados do dominio de Medicao.
// Consumido pelas rotas src/app/api/medicao/route.ts e /export/route.ts --
// a rota de export NAO deve voltar a chamar a rota de listagem por HTTP.

import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";
import { fetchProjectServiceCenterMap } from "@/server/modules/projects/serviceCenters";
import { loadProgrammingMatchMap } from "./programmingMatch";
import type { AppUserRow, CycleTargetItemRow, CycleWorkdaysRow, MeasurementCommercialMemberRow, MeasurementHistoryRow, MeasurementOrderItemRow, MeasurementOrderRow, MeasurementScoreTargetRow, MeasurementTeamTypeTargetRow, ProgrammingMatchStatus, ProjectTestRow, ServiceActivityIddRow, SupabasePageResult, TeamCompositionContextRow, TeamRow, TeamTypeHistoryRow, TeamTypeRow } from "./types";
import { buildMeasurementCycleStart, buildProgrammingMatchKey, normalizeMeasurementKind, normalizeText, resolveAppUserName } from "./normalizers";
export const SUPABASE_LIST_PAGE_SIZE = 1000;
export const HISTORY_LIMIT = 50;
export const MEASUREMENT_ORDER_SELECT = "id, order_number, programming_id, project_id, commercial_order_ref, commercial_process_id, commercial_process_name_snapshot, commercial_start_time, commercial_end_time, team_id, execution_date, measurement_date, voice_point, manual_rate, measurement_kind, no_production_reason_id, no_production_reason_name_snapshot, status, notes, project_code_snapshot, team_name_snapshot, foreman_name_snapshot, is_active, cancellation_reason, canceled_at, created_at, updated_at, created_by, updated_by, programming_completion_status_snapshot, programming_completion_status_snapshot_at, minimum_billing_amount, minimum_billing_team_type_id, minimum_billing_team_type_name_snapshot, minimum_billing_score_target_id, minimum_billing_target_points, minimum_billing_unit_value_source_activity_id, minimum_billing_unit_value_group_snapshot, minimum_billing_unit_value, minimum_billing_calculated_at";


export async function fetchTeamCompositionContextSet(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  orders: Array<Pick<MeasurementOrderRow, "project_id" | "team_id" | "execution_date">>;
}) {
  if (!params.orders.length) {
    return { data: new Set<string>(), error: null };
  }

  const projectIds = Array.from(new Set(params.orders.map((item) => item.project_id).filter((item): item is string => Boolean(item))));
  if (!projectIds.length) {
    return { data: new Set<string>(), error: null };
  }
  const teamIds = Array.from(new Set(params.orders.map((item) => item.team_id)));
  const executionDates = params.orders.map((item) => item.execution_date).sort();
  const result = await fetchPagedSupabaseRows<TeamCompositionContextRow>((from, to) =>
    params.supabase
      .from("team_compositions")
      .select("project_id, team_id, composition_date")
      .eq("tenant_id", params.tenantId)
      .eq("is_active", true)
      .in("project_id", projectIds)
      .in("team_id", teamIds)
      .gte("composition_date", executionDates[0])
      .lte("composition_date", executionDates[executionDates.length - 1])
      .range(from, to)
      .returns<TeamCompositionContextRow[]>(),
  );

  return {
    data: new Set(
      (result.data ?? []).map((item) => buildProgrammingMatchKey(item.project_id, item.team_id, item.composition_date)),
    ),
    error: result.error,
  };
}

export async function fetchPagedSupabaseRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<SupabasePageResult<T>>,
) {
  const rows: T[] = [];
  let from = 0;

  while (true) {
    const to = from + SUPABASE_LIST_PAGE_SIZE - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) {
      return { data: rows, error };
    }

    const pageRows = data ?? [];
    rows.push(...pageRows);

    if (pageRows.length < SUPABASE_LIST_PAGE_SIZE) {
      break;
    }

    from += SUPABASE_LIST_PAGE_SIZE;
  }

  return { data: rows, error: null };
}

export function measurementModuleMigrationHint(message: string | undefined) {
  const normalized = String(message ?? "").toLowerCase();
  if (
    normalized.includes("project_measurement_orders")
    || normalized.includes("project_measurement_order_items")
    || normalized.includes("project_measurement_order_history")
    || normalized.includes("save_project_measurement_order")
    || normalized.includes("set_project_measurement_order_status")
    || normalized.includes("save_project_measurement_order_batch_partial")
    || normalized.includes("minimum_billing_")
  ) {
    return " Verifique se as migrations 112_create_measurement_order_module.sql, 115_allow_historical_programming_in_measurement_save.sql, 116_measurement_programming_match_and_completion_alert.sql, 117_allow_measurement_context_edit_and_history_details.sql, 119_create_measurement_batch_import_partial_rpc.sql, 120_unify_measurement_with_service_activities.sql, 122_protect_duplicate_measurement_items_in_rpc.sql, 123_support_measurement_without_production.sql, 124_add_measurement_reopen_status_action.sql, 125_require_closed_before_measurement_cancel.sql, 126_allow_measurement_cancel_when_open.sql, 127_add_mva_hour_composed_quantity_to_measurement_items.sql e 212_measurement_minimum_billing_guarantee.sql foram aplicadas.";
  }
  return "";
}

export function isMissingProjectTestColumn(message: string | undefined) {
  const normalized = normalizeText(message).toLowerCase();
  return normalized.includes("is_test") || normalized.includes("is_third_party");
}

export async function fetchProjectIsTestMap(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  projectIds: string[];
}) {
  if (!params.projectIds.length) {
    return new Map<string, boolean>();
  }

  const uniqueProjectIds = Array.from(new Set(params.projectIds.filter(Boolean)));
  const primary = await params.supabase
    .from("project")
    .select("id, is_test, is_third_party")
    .eq("tenant_id", params.tenantId)
    .in("id", uniqueProjectIds)
    .returns<ProjectTestRow[]>();

  if (!primary.error) {
    return new Map((primary.data ?? []).map((item) => [item.id, Boolean(item.is_test) || Boolean(item.is_third_party)]));
  }

  if (!isMissingProjectTestColumn(primary.error.message)) {
    return new Map<string, boolean>();
  }

  const fallback = await params.supabase
    .from("project")
    .select("id")
    .eq("tenant_id", params.tenantId)
    .in("id", uniqueProjectIds)
    .returns<Array<{ id: string }>>();

  return new Map((fallback.data ?? []).map((item) => [item.id, false]));
}

export async function fetchServiceActivityIddMap(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  activityIds: string[];
}) {
  const uniqueActivityIds = Array.from(new Set(params.activityIds.filter(Boolean)));
  if (!uniqueActivityIds.length) {
    return new Map<string, string>();
  }

  const { data, error } = await params.supabase
    .from("service_activities")
    .select("id, code_idd")
    .eq("tenant_id", params.tenantId)
    .in("id", uniqueActivityIds)
    .returns<ServiceActivityIddRow[]>();

  if (error) {
    return new Map<string, string>();
  }

  return new Map((data ?? []).map((item) => [item.id, normalizeText(item.code_idd)]));
}

export async function fetchTeamTypeResolutionMaps(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  orders: Array<{ team_id?: string; teamId?: string }>;
}) {
  const teamIds = Array.from(new Set(params.orders.map((item) => item.team_id ?? item.teamId ?? "").filter(Boolean)));
  if (!teamIds.length) {
    return {
      teamTypeByTeam: new Map<string, string | null>(),
      teamTypeNameById: new Map<string, string>(),
      historyByTeam: new Map<string, TeamTypeHistoryRow[]>(),
    };
  }

  const [teamsResult, historyResult] = await Promise.all([
    params.supabase
      .from("teams")
      .select("id, team_type_id")
      .eq("tenant_id", params.tenantId)
      .in("id", teamIds)
      .returns<TeamRow[]>(),
    params.supabase
      .from("team_type_history")
      .select("team_id, team_type_id, team_type_name_snapshot, valid_from, valid_to")
      .eq("tenant_id", params.tenantId)
      .in("team_id", teamIds)
      .returns<TeamTypeHistoryRow[]>(),
  ]);

  const teamTypeByTeam = new Map((teamsResult.data ?? []).map((item) => [item.id, item.team_type_id]));
  const historyByTeam = new Map<string, TeamTypeHistoryRow[]>();
  for (const entry of historyResult.data ?? []) {
    const entries = historyByTeam.get(entry.team_id) ?? [];
    entries.push(entry);
    historyByTeam.set(entry.team_id, entries);
  }
  for (const entries of historyByTeam.values()) {
    entries.sort((left, right) => right.valid_from.localeCompare(left.valid_from));
  }

  const teamTypeIds = Array.from(
    new Set([
      ...(teamsResult.data ?? []).map((item) => item.team_type_id),
      ...(historyResult.data ?? []).map((item) => item.team_type_id),
    ].filter((item): item is string => Boolean(item))),
  );
  const teamTypesResult = teamTypeIds.length
    ? await params.supabase
        .from("team_types")
        .select("id, name")
        .eq("tenant_id", params.tenantId)
        .in("id", teamTypeIds)
        .returns<TeamTypeRow[]>()
    : { data: [] as TeamTypeRow[] };

  return {
    teamTypeByTeam,
    teamTypeNameById: new Map((teamTypesResult.data ?? []).map((item) => [item.id, normalizeText(item.name)])),
    historyByTeam,
  };
}

export function resolveOrderTeamType(params: {
  teamId: string;
  executionDate: string;
  teamTypeByTeam: Map<string, string | null>;
  teamTypeNameById: Map<string, string>;
  historyByTeam: Map<string, TeamTypeHistoryRow[]>;
}) {
  const history = params.historyByTeam.get(params.teamId) ?? [];
  const effectiveEntry = history.find((entry) => (
    entry.valid_from <= params.executionDate
    && (!entry.valid_to || entry.valid_to >= params.executionDate)
  ));

  if (effectiveEntry) {
    const teamTypeId = effectiveEntry.team_type_id;
    return {
      teamTypeId,
      teamTypeName: teamTypeId
        ? params.teamTypeNameById.get(teamTypeId) ?? normalizeText(effectiveEntry.team_type_name_snapshot)
        : normalizeText(effectiveEntry.team_type_name_snapshot),
    };
  }

  const teamTypeId = params.teamTypeByTeam.get(params.teamId) ?? null;
  return {
    teamTypeId,
    teamTypeName: teamTypeId ? params.teamTypeNameById.get(teamTypeId) ?? "" : "",
  };
}

export async function fetchPointTargetMap(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  teamTypeIds: string[];
}) {
  const teamTypeIds = Array.from(new Set(params.teamTypeIds.filter(Boolean)));
  if (!teamTypeIds.length) {
    return new Map<string, number>();
  }

  const { data } = await params.supabase
    .from("measurement_score_targets")
    .select("team_type_id, target_points")
    .eq("tenant_id", params.tenantId)
    .eq("ativo", true)
    .in("team_type_id", teamTypeIds)
    .returns<MeasurementScoreTargetRow[]>();

  return new Map((data ?? []).map((item) => [item.team_type_id, Number(item.target_points ?? 0)]));
}

export async function fetchFinancialTargetMap(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  orders: Array<{ execution_date?: string; executionDate?: string }>;
  teamTypeIds: string[];
}) {
  const teamTypeIds = Array.from(new Set(params.teamTypeIds.filter(Boolean)));
  if (!teamTypeIds.length) {
    return {
      cycleTargetMap: new Map<string, number>(),
      fallbackTargetMap: new Map<string, number>(),
    };
  }

  const cycleStarts = Array.from(new Set(params.orders.map((item) => buildMeasurementCycleStart(item.execution_date ?? item.executionDate ?? ""))));
  const cyclesResult = cycleStarts.length
    ? await params.supabase
        .from("measurement_cycle_workdays")
        .select("id, cycle_start")
        .eq("tenant_id", params.tenantId)
        .in("cycle_start", cycleStarts)
        .returns<CycleWorkdaysRow[]>()
    : { data: [] as CycleWorkdaysRow[] };

  const cycleById = new Map((cyclesResult.data ?? []).map((item) => [item.id, item.cycle_start]));
  const cycleIds = Array.from(cycleById.keys());
  const cycleItemsResult = cycleIds.length
    ? await params.supabase
        .from("measurement_cycle_target_items")
        .select("cycle_id, team_type_id, daily_value")
        .eq("tenant_id", params.tenantId)
        .in("cycle_id", cycleIds)
        .in("team_type_id", teamTypeIds)
        .returns<CycleTargetItemRow[]>()
    : { data: [] as CycleTargetItemRow[] };

  const cycleTargetMap = new Map<string, number>();
  for (const item of cycleItemsResult.data ?? []) {
    const cycleStart = cycleById.get(item.cycle_id);
    if (!cycleStart) continue;
    cycleTargetMap.set(`${cycleStart}:${item.team_type_id}`, Number(item.daily_value ?? 0));
  }

  const fallbackResult = await params.supabase
    .from("measurement_team_type_targets")
    .select("team_type_id, daily_value")
    .eq("tenant_id", params.tenantId)
    .eq("ativo", true)
    .in("team_type_id", teamTypeIds)
    .returns<MeasurementTeamTypeTargetRow[]>();

  return {
    cycleTargetMap,
    fallbackTargetMap: new Map((fallbackResult.data ?? []).map((item) => [item.team_type_id, Number(item.daily_value ?? 0)])),
  };
}

export async function fetchAppUserMap(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  ids: string[];
}) {
  if (!params.ids.length) {
    return new Map<string, AppUserRow>();
  }

  const { data } = await params.supabase
    .from("app_users")
    .select("id, display, login_name")
    .eq("tenant_id", params.tenantId)
    .in("id", params.ids)
    .returns<AppUserRow[]>();

  return new Map((data ?? []).map((item) => [item.id, item]));
}

export async function fetchCommercialMemberMap(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  orderIds: string[];
}) {
  const orderIds = Array.from(new Set(params.orderIds.filter(Boolean)));
  if (!orderIds.length) {
    return new Map<string, Array<{ personId: string; name: string; sortOrder: number }>>();
  }

  const { data, error } = await params.supabase
    .from("project_commercial_measurement_order_members")
    .select("measurement_order_id, person_id, person_name_snapshot, sort_order")
    .eq("tenant_id", params.tenantId)
    .in("measurement_order_id", orderIds)
    .order("sort_order", { ascending: true })
    .returns<MeasurementCommercialMemberRow[]>();

  if (error) {
    return new Map<string, Array<{ personId: string; name: string; sortOrder: number }>>();
  }

  const result = new Map<string, Array<{ personId: string; name: string; sortOrder: number }>>();
  for (const row of data ?? []) {
    const members = result.get(row.measurement_order_id) ?? [];
    members.push({
      personId: row.person_id,
      name: normalizeText(row.person_name_snapshot),
      sortOrder: Number(row.sort_order ?? members.length + 1),
    });
    result.set(row.measurement_order_id, members);
  }

  return result;
}

// Mapeamento puro de uma ordem para o formato de detalhe da API.
// Extraido de fetchMeasurementOrderDetail para que a versao em lote
// (fetchMeasurementOrderDetailsForExport) produza exatamente o mesmo objeto.
export function buildMeasurementOrderDetail(params: {
  order: MeasurementOrderRow;
  itemRows: MeasurementOrderItemRow[];
  serviceActivityIddMap: Awaited<ReturnType<typeof fetchServiceActivityIddMap>>;
  userMap: Awaited<ReturnType<typeof fetchAppUserMap>>;
  projectServiceCenterMap: Awaited<ReturnType<typeof fetchProjectServiceCenterMap>>;
  teamCompositionKeys: Awaited<ReturnType<typeof fetchTeamCompositionContextSet>>["data"];
  programmingMatchMap: Awaited<ReturnType<typeof loadProgrammingMatchMap>>;
  commercialMemberMap?: Awaited<ReturnType<typeof fetchCommercialMemberMap>>;
}) {
  const { order, itemRows, serviceActivityIddMap, userMap, projectServiceCenterMap, teamCompositionKeys, programmingMatchMap } = params;
  const normalizedItems = itemRows.map((item) => ({
    id: item.id,
    activityId: item.service_activity_id,
    programmingActivityId: item.programming_activity_id,
    projectActivityForecastId: item.project_activity_forecast_id,
    code: normalizeText(item.activity_code),
    codeIdd: serviceActivityIddMap.get(item.service_activity_id) ?? "",
    description: normalizeText(item.activity_description),
    unit: normalizeText(item.activity_unit),
    quantity: Number(item.quantity ?? 0),
    mvaQuantity: item.mva_quantity === null || item.mva_quantity === undefined ? null : Number(item.mva_quantity),
    workedHours: item.worked_hours === null || item.worked_hours === undefined ? null : Number(item.worked_hours),
    voicePoint: Number(item.voice_point ?? 0),
    manualRate: Number(item.manual_rate ?? 0),
    unitValue: Number(item.unit_value ?? 0),
    totalValue: Number(item.total_value ?? 0),
    observation: normalizeText(item.observation),
  }));
  const minimumBillingAmount = Number(order.minimum_billing_amount ?? 0);

  const programmingMatch = programmingMatchMap.get(order.id) ?? {
    status: "NAO_PROGRAMADA" as ProgrammingMatchStatus,
    programmingId: null,
    completionStatus: null,
    completionStatusChangedAfterMeasurement: false,
  };

  return {
    id: order.id,
    orderNumber: normalizeText(order.order_number),
    programmingId: order.programming_id,
    projectId: order.project_id,
    teamId: order.team_id,
    executionDate: order.execution_date,
    measurementDate: order.measurement_date,
    voicePoint: Number(order.voice_point ?? 0),
    manualRate: Number(order.manual_rate ?? 0),
    measurementKind: normalizeMeasurementKind(order.measurement_kind),
    noProductionReasonId: order.no_production_reason_id,
    noProductionReasonName: normalizeText(order.no_production_reason_name_snapshot),
    status: order.status,
    notes: normalizeText(order.notes),
    projectCode: normalizeText(order.project_code_snapshot),
    projectServiceCenter: order.project_id ? (projectServiceCenterMap.get(order.project_id) ?? "Sem base") : "Sem projeto",
    teamName: normalizeText(order.team_name_snapshot),
    foremanName: normalizeText(order.foreman_name_snapshot),
    commercialOrderRef: normalizeText(order.commercial_order_ref),
    commercialProcessId: order.commercial_process_id,
    commercialProcessName: normalizeText(order.commercial_process_name_snapshot),
    commercialStartTime: normalizeText(order.commercial_start_time).slice(0, 5),
    commercialEndTime: normalizeText(order.commercial_end_time).slice(0, 5),
    commercialMembers: params.commercialMemberMap?.get(order.id) ?? [],
    isActive: Boolean(order.is_active),
    cancellationReason: normalizeText(order.cancellation_reason),
    canceledAt: order.canceled_at,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    createdByName: resolveAppUserName(userMap.get(order.created_by ?? "")),
    updatedByName: resolveAppUserName(userMap.get(order.updated_by ?? "")),
    hasTeamComposition: teamCompositionKeys.has(buildProgrammingMatchKey(order.project_id, order.team_id, order.execution_date)),
    programmingMatchStatus: programmingMatch.status,
    matchedProgrammingId: programmingMatch.programmingId,
    programmingCompletionStatus: programmingMatch.completionStatus,
    programmingCompletionStatusChangedAfterMeasurement: programmingMatch.completionStatusChangedAfterMeasurement,
    itemCount: normalizedItems.length,
    totalAmount: normalizedItems.reduce((sum, item) => sum + item.totalValue, 0) + minimumBillingAmount,
    minimumBillingAmount,
    minimumBillingTeamTypeId: order.minimum_billing_team_type_id,
    minimumBillingTeamTypeName: normalizeText(order.minimum_billing_team_type_name_snapshot),
    minimumBillingScoreTargetId: order.minimum_billing_score_target_id,
    minimumBillingTargetPoints: Number(order.minimum_billing_target_points ?? 0),
    minimumBillingUnitValueSourceActivityId: order.minimum_billing_unit_value_source_activity_id,
    minimumBillingUnitValueGroup: normalizeText(order.minimum_billing_unit_value_group_snapshot),
    minimumBillingUnitValue: Number(order.minimum_billing_unit_value ?? 0),
    minimumBillingCalculatedAt: order.minimum_billing_calculated_at,
    items: normalizedItems,
  };
}
export async function fetchMeasurementOrderDetail(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  orderId: string;
  windowEndDate?: string | null;
}) {
  const { data: order, error: orderError } = await params.supabase
    .from("project_measurement_orders")
    .select(MEASUREMENT_ORDER_SELECT)
    .eq("tenant_id", params.tenantId)
    .eq("id", params.orderId)
    .maybeSingle<MeasurementOrderRow>();

  if (orderError || !order) {
    return null;
  }

  const userIds = [order.created_by, order.updated_by].filter((item): item is string => Boolean(item));
  const [
    itemsResult,
    commercialMemberMap,
    userMap,
    programmingMatchMap,
    projectServiceCenterMap,
    teamCompositionContexts,
  ] = await Promise.all([
    params.supabase
      .from("project_measurement_order_items")
      .select("id, measurement_order_id, service_activity_id, programming_activity_id, project_activity_forecast_id, activity_code, activity_description, activity_unit, quantity, mva_quantity, worked_hours, voice_point, manual_rate, unit_value, total_value, observation, is_active, updated_at")
      .eq("tenant_id", params.tenantId)
      .eq("measurement_order_id", params.orderId)
      .eq("is_active", true)
      .order("activity_code", { ascending: true })
      .returns<MeasurementOrderItemRow[]>(),
    fetchCommercialMemberMap({
      supabase: params.supabase,
      tenantId: params.tenantId,
      orderIds: [params.orderId],
    }),
    fetchAppUserMap({
      supabase: params.supabase,
      tenantId: params.tenantId,
      ids: Array.from(new Set(userIds)),
    }),
    loadProgrammingMatchMap({
      supabase: params.supabase,
      tenantId: params.tenantId,
      windowEndDate: params.windowEndDate ?? order.execution_date,
      orders: [order],
    }),
    fetchProjectServiceCenterMap({
      supabase: params.supabase,
      tenantId: params.tenantId,
      projectIds: order.project_id ? [order.project_id] : [],
    }),
    fetchTeamCompositionContextSet({
      supabase: params.supabase,
      tenantId: params.tenantId,
      orders: [order],
    }),
  ]);

  const itemRows = itemsResult.data ?? [];
  const serviceActivityIddMap = await fetchServiceActivityIddMap({
    supabase: params.supabase,
    tenantId: params.tenantId,
    activityIds: itemRows.map((item) => item.service_activity_id),
  });

  if (teamCompositionContexts.error) {
    return null;
  }

  return buildMeasurementOrderDetail({
    order,
    itemRows,
    serviceActivityIddMap,
    userMap,
    projectServiceCenterMap,
    teamCompositionKeys: teamCompositionContexts.data,
    programmingMatchMap,
    commercialMemberMap,
  });
}

export async function loadHistory(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  orderId: string;
}) {
  const { data, error } = await params.supabase
    .from("project_measurement_order_history")
    .select("id, action_type, reason, changes, metadata, created_by, created_at")
    .eq("tenant_id", params.tenantId)
    .eq("measurement_order_id", params.orderId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT)
    .returns<MeasurementHistoryRow[]>();

  if (error) {
    return null;
  }

  const userIds = Array.from(new Set((data ?? []).map((item) => item.created_by).filter((item): item is string => Boolean(item))));
  const userMap = await fetchAppUserMap({
    supabase: params.supabase,
    tenantId: params.tenantId,
    ids: userIds,
  });

  return (data ?? []).map((item) => ({
    id: item.id,
    action: normalizeText(item.action_type),
    reason: normalizeText(item.reason),
    changes: item.changes ?? {},
    metadata: item.metadata ?? {},
    changedAt: item.created_at,
    changedByName: resolveAppUserName(userMap.get(item.created_by ?? "")),
  }));
}


// Lote de detalhes para exportacao.
//
// Substitui o padrao anterior da rota /api/medicao/export, que buscava o detalhe
// de UMA ordem por vez (lotes de 20 chamadas HTTP internas para a propria rota de
// listagem). Cada chamada refazia resolucao de sessao e, pior, rodava
// loadProgrammingMatchMap para uma unica ordem -- um N+1 sobre a funcao mais cara
// do modulo. Aqui as colecoes sao resolvidas UMA vez para todas as ordens.
//
// Fidelidade: o objeto devolvido por ordem vem de buildMeasurementOrderDetail, a
// mesma funcao usada por fetchMeasurementOrderDetail, entao o CSV nao muda.
// A janela de match (windowEndDate) e agrupada em vez de unificada de proposito:
// quando a exportacao nao envia `endDate`, cada ordem usa a propria data de
// execucao como janela, e unificar mudaria o status de programacao.
const EXPORT_DETAIL_ID_CHUNK = 200;

export async function fetchMeasurementOrderDetailsForExport(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  orderIds: string[];
  windowEndDate?: string | null;
}) {
  const uniqueOrderIds = Array.from(new Set(params.orderIds.filter(Boolean)));
  if (!uniqueOrderIds.length) {
    return [];
  }

  const orderRows: MeasurementOrderRow[] = [];
  for (let index = 0; index < uniqueOrderIds.length; index += EXPORT_DETAIL_ID_CHUNK) {
    const chunk = uniqueOrderIds.slice(index, index + EXPORT_DETAIL_ID_CHUNK);
    const { data, error } = await params.supabase
      .from("project_measurement_orders")
      .select(MEASUREMENT_ORDER_SELECT)
      .eq("tenant_id", params.tenantId)
      .in("id", chunk)
      .returns<MeasurementOrderRow[]>();

    if (error) {
      throw new Error(error.message);
    }
    orderRows.push(...(data ?? []));
  }

  if (!orderRows.length) {
    return [];
  }

  const itemRows: MeasurementOrderItemRow[] = [];
  for (let index = 0; index < uniqueOrderIds.length; index += EXPORT_DETAIL_ID_CHUNK) {
    const chunk = uniqueOrderIds.slice(index, index + EXPORT_DETAIL_ID_CHUNK);
    const { data, error } = await params.supabase
      .from("project_measurement_order_items")
      .select("id, measurement_order_id, service_activity_id, programming_activity_id, project_activity_forecast_id, activity_code, activity_description, activity_unit, quantity, mva_quantity, worked_hours, voice_point, manual_rate, unit_value, total_value, observation, is_active, updated_at")
      .eq("tenant_id", params.tenantId)
      .in("measurement_order_id", chunk)
      .eq("is_active", true)
      .order("activity_code", { ascending: true })
      .returns<MeasurementOrderItemRow[]>();

    if (error) {
      throw new Error(error.message);
    }
    itemRows.push(...(data ?? []));
  }

  const userIds = orderRows
    .flatMap((order) => [order.created_by, order.updated_by])
    .filter((item): item is string => Boolean(item));

  const [userMap, projectServiceCenterMap, teamCompositionContexts, serviceActivityIddMap, commercialMemberMap] = await Promise.all([
    fetchAppUserMap({
      supabase: params.supabase,
      tenantId: params.tenantId,
      ids: Array.from(new Set(userIds)),
    }),
    fetchProjectServiceCenterMap({
      supabase: params.supabase,
      tenantId: params.tenantId,
      projectIds: Array.from(new Set(orderRows.map((order) => order.project_id).filter((item): item is string => Boolean(item)))),
    }),
    fetchTeamCompositionContextSet({
      supabase: params.supabase,
      tenantId: params.tenantId,
      orders: orderRows,
    }),
    fetchServiceActivityIddMap({
      supabase: params.supabase,
      tenantId: params.tenantId,
      activityIds: itemRows.map((item) => item.service_activity_id),
    }),
    fetchCommercialMemberMap({
      supabase: params.supabase,
      tenantId: params.tenantId,
      orderIds: uniqueOrderIds,
    }),
  ]);

  if (teamCompositionContexts.error) {
    throw new Error("Falha ao carregar composicao de equipe para exportacao.");
  }

  // Agrupa por janela efetiva: uma chamada de loadProgrammingMatchMap por janela
  // distinta, nao por ordem. Com `endDate` informado isso vira uma chamada so.
  const ordersByWindow = new Map<string, MeasurementOrderRow[]>();
  for (const order of orderRows) {
    const window = params.windowEndDate ?? order.execution_date;
    const bucket = ordersByWindow.get(window);
    if (bucket) {
      bucket.push(order);
    } else {
      ordersByWindow.set(window, [order]);
    }
  }

  const matchMaps = await Promise.all(
    Array.from(ordersByWindow.entries()).map(([window, windowOrders]) =>
      loadProgrammingMatchMap({
        supabase: params.supabase,
        tenantId: params.tenantId,
        windowEndDate: window,
        orders: windowOrders,
      }),
    ),
  );

  const programmingMatchMap = matchMaps.reduce((merged, current) => {
    for (const [key, value] of current) {
      merged.set(key, value);
    }
    return merged;
  }, new Map() as Awaited<ReturnType<typeof loadProgrammingMatchMap>>);

  const itemsByOrder = new Map<string, MeasurementOrderItemRow[]>();
  for (const item of itemRows) {
    const bucket = itemsByOrder.get(item.measurement_order_id);
    if (bucket) {
      bucket.push(item);
    } else {
      itemsByOrder.set(item.measurement_order_id, [item]);
    }
  }

  const detailByOrderId = new Map(
    orderRows.map((order) => [
      order.id,
      buildMeasurementOrderDetail({
        order,
        itemRows: itemsByOrder.get(order.id) ?? [],
        serviceActivityIddMap,
        userMap,
        projectServiceCenterMap,
        teamCompositionKeys: teamCompositionContexts.data,
        programmingMatchMap,
        commercialMemberMap,
      }),
    ]),
  );

  // Preserva a ordem de entrada: o CSV de detalhamento segue a ordem da listagem.
  return uniqueOrderIds
    .map((orderId) => detailByOrderId.get(orderId))
    .filter((detail): detail is NonNullable<typeof detail> => Boolean(detail));
}
