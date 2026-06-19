import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveAuthenticatedAppUser, type AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";
import { requirePageAction } from "@/lib/server/pageAuthorization";

const PAGE_KEY = "apuracao-fator-minimo";
const QUERY_PAGE_SIZE = 1000;
const FILTER_CHUNK_SIZE = 100;

type ProjectRow = {
  id: string;
  sob: string | null;
  service_center_text: string | null;
  service_type: string | null;
  service_type_text: string | null;
  is_active: boolean | null;
  is_test: boolean | null;
  is_withdrawn: boolean | null;
};

type ProjectServiceTypeRow = {
  id: string;
  name: string | null;
};

type TeamRow = {
  id: string;
  name: string | null;
  vehicle_plate: string | null;
  team_type_id: string | null;
  foreman_person_id: string | null;
  ativo: boolean | null;
};

type PersonRow = {
  id: string;
  nome: string | null;
};

type ServiceActivityRow = {
  id: string;
  code: string | null;
  description: string | null;
  group_name: string | null;
  ativo: boolean | null;
};

type MeasurementOrderRow = {
  id: string;
  order_number: string | null;
  project_id: string;
  team_id: string;
  execution_date: string;
  status: string | null;
  project_code_snapshot: string | null;
  team_name_snapshot: string | null;
  foreman_name_snapshot: string | null;
};

type MeasurementItemRow = {
  measurement_order_id: string;
  service_activity_id: string;
  activity_code: string | null;
  activity_description: string | null;
  quantity: number | string | null;
  voice_point: number | string | null;
  total_value: number | string | null;
};

type TeamTypeHistoryRow = {
  team_id: string;
  team_type_id: string | null;
  team_type_name_snapshot: string | null;
  valid_from: string;
  valid_to: string | null;
};

type TeamTypeRow = {
  id: string;
  name: string | null;
};

type MeasurementScoreTargetRow = {
  team_type_id: string;
  target_points: number | string | null;
};

type CycleWorkdaysRow = {
  id: string;
  cycle_start: string;
};

type CycleTargetItemRow = {
  cycle_id: string;
  team_type_id: string;
  daily_value: number | string | null;
};

type MeasurementTeamTypeTargetRow = {
  team_type_id: string;
  daily_value: number | string | null;
};

type SupabasePageResult<T> = {
  data: T[] | null;
  error: { message?: string } | null;
};

type AggregateDraft = {
  key: string;
  teamId: string;
  executionDate: string;
  teamName: string;
  foremanName: string;
  orderIds: Set<string>;
  projectIds: Set<string>;
  serviceCodes: Map<string, { code: string; description: string; quantity: number; points: number; value: number }>;
  points: number;
  totalValue: number;
  quantity: number;
  itemCount: number;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeUuid(value: unknown) {
  const normalized = normalizeText(value);
  return /^[0-9a-f-]{36}$/i.test(normalized) ? normalized : null;
}

function normalizeUuidList(searchParams: URLSearchParams, key: string) {
  const values = searchParams
    .getAll(key)
    .flatMap((value) => normalizeText(value).split(","))
    .map((value) => normalizeUuid(value))
    .filter((value): value is string => Boolean(value));

  return Array.from(new Set(values));
}

function normalizeIsoDate(value: unknown) {
  const normalized = normalizeText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function normalizeStatus(value: unknown) {
  const normalized = normalizeText(value).toUpperCase();
  return ["TODOS", "ABERTA", "FECHADA"].includes(normalized) ? normalized : "FECHADA";
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function fetchPagedSupabaseRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<SupabasePageResult<T>>,
) {
  const rows: T[] = [];
  let from = 0;

  while (true) {
    const to = from + QUERY_PAGE_SIZE - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) return { data: rows, error };

    const pageRows = data ?? [];
    rows.push(...pageRows);
    if (pageRows.length < QUERY_PAGE_SIZE) break;
    from += QUERY_PAGE_SIZE;
  }

  return { data: rows, error: null };
}

function createUtcDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function buildMeasurementCycleStart(executionDate: string) {
  const date = createUtcDate(executionDate);
  const year = date.getUTCFullYear();
  const monthIndex = date.getUTCMonth();
  const day = date.getUTCDate();
  const start = new Date(Date.UTC(year, day >= 21 ? monthIndex : monthIndex - 1, 21));
  return start.toISOString().slice(0, 10);
}

function daysBetween(startDate: string, endDate: string) {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}

async function authorizeRead(context: AuthenticatedAppUserContext) {
  const authorization = await requirePageAction({
    context,
    pageKey: PAGE_KEY,
    action: "read",
  });

  if (authorization.allowed) return null;

  return NextResponse.json(
    {
      message: authorization.error.message,
      code: authorization.error.code,
      pageKey: authorization.pageKey,
      action: authorization.action,
    },
    { status: authorization.error.status },
  );
}

async function loadMeta(context: AuthenticatedAppUserContext) {
  const [projectsResult, teamsResult, serviceTypesResult, activitiesResult] = await Promise.all([
    context.supabase
      .from("project_with_labels")
      .select("id, sob, service_center_text, service_type, service_type_text, is_active, is_test, is_withdrawn")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("is_active", true)
      .order("sob", { ascending: true })
      .returns<ProjectRow[]>(),
    context.supabase
      .from("teams")
      .select("id, name, vehicle_plate, team_type_id, foreman_person_id, ativo")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("ativo", true)
      .order("name", { ascending: true })
      .returns<TeamRow[]>(),
    context.supabase
      .from("project_service_types")
      .select("id, name")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("ativo", true)
      .order("name", { ascending: true })
      .returns<ProjectServiceTypeRow[]>(),
    context.supabase
      .from("service_activities")
      .select("id, code, description, group_name, ativo")
      .eq("tenant_id", context.appUser.tenant_id)
      .eq("ativo", true)
      .order("code", { ascending: true })
      .returns<ServiceActivityRow[]>(),
  ]);

  if (projectsResult.error) {
    return NextResponse.json({ message: "Falha ao carregar projetos da apuracao." }, { status: 500 });
  }
  if (teamsResult.error) {
    return NextResponse.json({ message: "Falha ao carregar equipes da apuracao." }, { status: 500 });
  }
  if (serviceTypesResult.error) {
    return NextResponse.json({ message: "Falha ao carregar tipos de servico da apuracao." }, { status: 500 });
  }
  if (activitiesResult.error) {
    return NextResponse.json({ message: "Falha ao carregar atividades da apuracao." }, { status: 500 });
  }

  const personIds = Array.from(new Set((teamsResult.data ?? []).map((item) => item.foreman_person_id).filter((item): item is string => Boolean(item))));
  const peopleResult = personIds.length
    ? await context.supabase
        .from("people")
        .select("id, nome")
        .eq("tenant_id", context.appUser.tenant_id)
        .in("id", personIds)
        .returns<PersonRow[]>()
    : { data: [] as PersonRow[], error: null };
  const peopleMap = new Map((peopleResult.data ?? []).map((item) => [item.id, normalizeText(item.nome)]));

  return NextResponse.json({
    projects: (projectsResult.data ?? [])
      .filter((item) => !item.is_test && !item.is_withdrawn)
      .map((item) => ({
        id: item.id,
        label: normalizeText(item.sob) || item.id,
        serviceCenter: normalizeText(item.service_center_text) || "Sem base",
        serviceTypeId: item.service_type,
        serviceType: normalizeText(item.service_type_text) || "Sem tipo",
      })),
    teams: (teamsResult.data ?? []).map((item) => ({
      id: item.id,
      label: normalizeText(item.name) || item.id,
      vehiclePlate: normalizeText(item.vehicle_plate),
      foremanName: item.foreman_person_id ? peopleMap.get(item.foreman_person_id) ?? "" : "",
    })),
    serviceTypes: (serviceTypesResult.data ?? []).map((item) => ({
      id: item.id,
      name: normalizeText(item.name),
    })),
    activities: (activitiesResult.data ?? []).map((item) => ({
      id: item.id,
      code: normalizeText(item.code),
      description: normalizeText(item.description),
      groupName: normalizeText(item.group_name),
      label: [normalizeText(item.code), normalizeText(item.description)].filter(Boolean).join(" - "),
    })),
  });
}

async function fetchEligibleProjects(params: {
  supabase: SupabaseClient;
  tenantId: string;
  projectIds: string[];
  serviceTypeId: string | null;
}) {
  const result = await fetchPagedSupabaseRows<ProjectRow>((from, to) => {
    let query = params.supabase
      .from("project_with_labels")
      .select("id, sob, service_center_text, service_type, service_type_text, is_active, is_test, is_withdrawn")
      .eq("tenant_id", params.tenantId)
      .eq("is_active", true);

    if (params.projectIds.length) query = query.in("id", params.projectIds);
    if (params.serviceTypeId) query = query.eq("service_type", params.serviceTypeId);

    return query
      .order("sob", { ascending: true })
      .range(from, to)
      .returns<ProjectRow[]>();
  });

  return {
    ...result,
    data: result.data.filter((item) => !item.is_test && !item.is_withdrawn),
  };
}

async function fetchOrders(params: {
  supabase: SupabaseClient;
  tenantId: string;
  projectIds: string[];
  teamIds: string[];
  startDate: string;
  endDate: string;
  status: string;
}) {
  const rows: MeasurementOrderRow[] = [];

  for (const projectIdChunk of chunk(params.projectIds, FILTER_CHUNK_SIZE)) {
    const result = await fetchPagedSupabaseRows<MeasurementOrderRow>((from, to) => {
      let query = params.supabase
        .from("project_measurement_orders")
        .select("id, order_number, project_id, team_id, execution_date, status, project_code_snapshot, team_name_snapshot, foreman_name_snapshot")
        .eq("tenant_id", params.tenantId)
        .eq("is_active", true)
        .eq("measurement_kind", "COM_PRODUCAO")
        .gte("execution_date", params.startDate)
        .lte("execution_date", params.endDate)
        .in("project_id", projectIdChunk);

      if (params.teamIds.length) query = query.in("team_id", params.teamIds);
      if (params.status === "TODOS") query = query.neq("status", "CANCELADA");
      else query = query.eq("status", params.status);

      return query
        .order("execution_date", { ascending: true })
        .order("team_name_snapshot", { ascending: true })
        .range(from, to)
        .returns<MeasurementOrderRow[]>();
    });

    if (result.error) return { data: rows, error: result.error };
    rows.push(...result.data);
  }

  return { data: rows, error: null };
}

async function fetchItems(params: {
  supabase: SupabaseClient;
  tenantId: string;
  orderIds: string[];
  activityIds: string[];
}) {
  const rows: MeasurementItemRow[] = [];

  for (const orderIdChunk of chunk(params.orderIds, FILTER_CHUNK_SIZE)) {
    const result = await fetchPagedSupabaseRows<MeasurementItemRow>((from, to) => {
      let query = params.supabase
        .from("project_measurement_order_items")
        .select("measurement_order_id, service_activity_id, activity_code, activity_description, quantity, voice_point, total_value")
        .eq("tenant_id", params.tenantId)
        .eq("is_active", true)
        .in("measurement_order_id", orderIdChunk);

      if (params.activityIds.length) query = query.in("service_activity_id", params.activityIds);

      return query
        .order("activity_code", { ascending: true })
        .range(from, to)
        .returns<MeasurementItemRow[]>();
    });

    if (result.error) return { data: rows, error: result.error };
    rows.push(...result.data);
  }

  return { data: rows, error: null };
}

async function fetchTeamTypeResolutionMaps(params: {
  supabase: SupabaseClient;
  tenantId: string;
  teamIds: string[];
}) {
  const teamIds = Array.from(new Set(params.teamIds.filter(Boolean)));
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
      .returns<Array<Pick<TeamRow, "id" | "team_type_id">>>(),
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

  const teamTypeIds = Array.from(new Set([
    ...(teamsResult.data ?? []).map((item) => item.team_type_id),
    ...(historyResult.data ?? []).map((item) => item.team_type_id),
  ].filter((item): item is string => Boolean(item))));

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

function resolveTeamType(params: {
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

async function fetchPointTargetMap(params: {
  supabase: SupabaseClient;
  tenantId: string;
  teamTypeIds: string[];
}) {
  const teamTypeIds = Array.from(new Set(params.teamTypeIds.filter(Boolean)));
  if (!teamTypeIds.length) return new Map<string, number>();

  const { data } = await params.supabase
    .from("measurement_score_targets")
    .select("team_type_id, target_points")
    .eq("tenant_id", params.tenantId)
    .eq("ativo", true)
    .in("team_type_id", teamTypeIds)
    .returns<MeasurementScoreTargetRow[]>();

  return new Map((data ?? []).map((item) => [item.team_type_id, numberValue(item.target_points)]));
}

async function fetchFinancialTargetMap(params: {
  supabase: SupabaseClient;
  tenantId: string;
  cycleStarts: string[];
  teamTypeIds: string[];
}) {
  const teamTypeIds = Array.from(new Set(params.teamTypeIds.filter(Boolean)));
  const cycleStarts = Array.from(new Set(params.cycleStarts.filter(Boolean)));
  if (!teamTypeIds.length) {
    return {
      cycleTargetMap: new Map<string, number>(),
      fallbackTargetMap: new Map<string, number>(),
    };
  }

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
    cycleTargetMap.set(`${cycleStart}:${item.team_type_id}`, numberValue(item.daily_value));
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
    fallbackTargetMap: new Map((fallbackResult.data ?? []).map((item) => [item.team_type_id, numberValue(item.daily_value)])),
  };
}

async function buildAnalysis(context: AuthenticatedAppUserContext, request: NextRequest) {
  const startDate = normalizeIsoDate(request.nextUrl.searchParams.get("startDate"));
  const endDate = normalizeIsoDate(request.nextUrl.searchParams.get("endDate"));
  const projectIds = normalizeUuidList(request.nextUrl.searchParams, "projectId");
  const teamIds = normalizeUuidList(request.nextUrl.searchParams, "teamId");
  const serviceTypeId = normalizeUuid(request.nextUrl.searchParams.get("serviceTypeId"));
  const activityIds = normalizeUuidList(request.nextUrl.searchParams, "activityId");
  const status = normalizeStatus(request.nextUrl.searchParams.get("status"));
  const detailTeamId = normalizeUuid(request.nextUrl.searchParams.get("detailTeamId"));
  const detailDate = normalizeIsoDate(request.nextUrl.searchParams.get("detailDate"));

  if (!startDate || !endDate) {
    return NextResponse.json({ message: "Periodo inicial e final sao obrigatorios." }, { status: 400 });
  }
  if (startDate > endDate) {
    return NextResponse.json({ message: "Periodo inicial nao pode ser maior que o periodo final." }, { status: 400 });
  }
  if (daysBetween(startDate, endDate) > 366) {
    return NextResponse.json({ message: "Periodo maximo para apuracao e de 366 dias." }, { status: 400 });
  }

  const effectiveStartDate = detailDate ?? startDate;
  const effectiveEndDate = detailDate ?? endDate;
  const effectiveTeamIds = detailTeamId ? [detailTeamId] : teamIds;

  const projectsResult = await fetchEligibleProjects({
    supabase: context.supabase,
    tenantId: context.appUser.tenant_id,
    projectIds,
    serviceTypeId,
  });
  if (projectsResult.error) {
    return NextResponse.json({ message: "Falha ao carregar projetos elegiveis para apuracao." }, { status: 500 });
  }

  const projects = projectsResult.data;
  const projectMap = new Map(projects.map((item) => [item.id, {
    code: normalizeText(item.sob) || item.id,
    serviceCenter: normalizeText(item.service_center_text) || "Sem base",
    serviceType: normalizeText(item.service_type_text) || "Sem tipo",
  }]));

  if (!projects.length) {
    return NextResponse.json({
      rows: [],
      detailRows: [],
      summary: {
        rowCount: 0,
        reachedCount: 0,
        notReachedCount: 0,
        withoutTargetCount: 0,
        totalPoints: 0,
        totalValue: 0,
        complementValue: 0,
      },
    });
  }

  const ordersResult = await fetchOrders({
    supabase: context.supabase,
    tenantId: context.appUser.tenant_id,
    projectIds: projects.map((item) => item.id),
    teamIds: effectiveTeamIds,
    startDate: effectiveStartDate,
    endDate: effectiveEndDate,
    status,
  });
  if (ordersResult.error) {
    return NextResponse.json({ message: "Falha ao carregar ordens de medicao da apuracao." }, { status: 500 });
  }

  const orders = ordersResult.data;
  const orderMap = new Map(orders.map((item) => [item.id, item]));
  if (!orders.length) {
    return NextResponse.json({
      rows: [],
      detailRows: [],
      summary: {
        rowCount: 0,
        reachedCount: 0,
        notReachedCount: 0,
        withoutTargetCount: 0,
        totalPoints: 0,
        totalValue: 0,
        complementValue: 0,
      },
    });
  }

  const itemsResult = await fetchItems({
    supabase: context.supabase,
    tenantId: context.appUser.tenant_id,
    orderIds: orders.map((item) => item.id),
    activityIds,
  });
  if (itemsResult.error) {
    return NextResponse.json({ message: "Falha ao carregar itens de medicao da apuracao." }, { status: 500 });
  }

  const aggregateMap = new Map<string, AggregateDraft>();
  const detailRows = [];

  for (const item of itemsResult.data) {
    const order = orderMap.get(item.measurement_order_id);
    if (!order) continue;

    const key = `${order.team_id}:${order.execution_date}`;
    const current = aggregateMap.get(key) ?? {
      key,
      teamId: order.team_id,
      executionDate: order.execution_date,
      teamName: normalizeText(order.team_name_snapshot) || order.team_id,
      foremanName: normalizeText(order.foreman_name_snapshot) || "Nao identificado",
      orderIds: new Set<string>(),
      projectIds: new Set<string>(),
      serviceCodes: new Map<string, { code: string; description: string; quantity: number; points: number; value: number }>(),
      points: 0,
      totalValue: 0,
      quantity: 0,
      itemCount: 0,
    };

    const quantity = numberValue(item.quantity);
    const points = numberValue(item.voice_point) * quantity;
    const value = numberValue(item.total_value);
    const code = normalizeText(item.activity_code) || "Sem codigo";
    const description = normalizeText(item.activity_description);
    const service = current.serviceCodes.get(code) ?? { code, description, quantity: 0, points: 0, value: 0 };

    service.quantity += quantity;
    service.points += points;
    service.value += value;
    current.serviceCodes.set(code, service);
    current.points += points;
    current.totalValue += value;
    current.quantity += quantity;
    current.itemCount += 1;
    current.orderIds.add(order.id);
    current.projectIds.add(order.project_id);
    aggregateMap.set(key, current);

    if (detailTeamId && detailDate) {
      const project = projectMap.get(order.project_id);
      detailRows.push({
        orderId: order.id,
        orderNumber: normalizeText(order.order_number) || order.id,
        executionDate: order.execution_date,
        projectId: order.project_id,
        projectCode: project?.code ?? normalizeText(order.project_code_snapshot) ?? order.project_id,
        serviceCenter: project?.serviceCenter ?? "Sem base",
        activityId: item.service_activity_id,
        activityCode: code,
        activityDescription: description,
        quantity,
        points,
        totalValue: value,
        status: normalizeText(order.status),
      });
    }
  }

  const aggregates = Array.from(aggregateMap.values());
  const teamTypeMaps = await fetchTeamTypeResolutionMaps({
    supabase: context.supabase,
    tenantId: context.appUser.tenant_id,
    teamIds: aggregates.map((item) => item.teamId),
  });

  const aggregateTypeMap = new Map<string, { teamTypeId: string | null; teamTypeName: string }>();
  for (const aggregate of aggregates) {
    aggregateTypeMap.set(aggregate.key, resolveTeamType({
      teamId: aggregate.teamId,
      executionDate: aggregate.executionDate,
      teamTypeByTeam: teamTypeMaps.teamTypeByTeam,
      teamTypeNameById: teamTypeMaps.teamTypeNameById,
      historyByTeam: teamTypeMaps.historyByTeam,
    }));
  }

  const teamTypeIds = Array.from(new Set(Array.from(aggregateTypeMap.values()).map((item) => item.teamTypeId).filter((item): item is string => Boolean(item))));
  const [pointTargetMap, financialTargets] = await Promise.all([
    fetchPointTargetMap({
      supabase: context.supabase,
      tenantId: context.appUser.tenant_id,
      teamTypeIds,
    }),
    fetchFinancialTargetMap({
      supabase: context.supabase,
      tenantId: context.appUser.tenant_id,
      cycleStarts: aggregates.map((item) => buildMeasurementCycleStart(item.executionDate)),
      teamTypeIds,
    }),
  ]);

  const rows = aggregates
    .map((aggregate) => {
      const teamType = aggregateTypeMap.get(aggregate.key) ?? { teamTypeId: null, teamTypeName: "" };
      const cycleStart = buildMeasurementCycleStart(aggregate.executionDate);
      const pointTarget = teamType.teamTypeId ? pointTargetMap.get(teamType.teamTypeId) ?? 0 : 0;
      const financialTarget = teamType.teamTypeId
        ? financialTargets.cycleTargetMap.get(`${cycleStart}:${teamType.teamTypeId}`)
          ?? financialTargets.fallbackTargetMap.get(teamType.teamTypeId)
          ?? 0
        : 0;
      const pointDifference = Math.max(0, pointTarget - aggregate.points);
      const complementValue = Math.max(0, financialTarget - aggregate.totalValue);
      const statusLabel = pointTarget <= 0 ? "SEM_META" : (aggregate.points >= pointTarget ? "ATINGIU" : "NAO_ATINGIU");
      const serviceCodes = Array.from(aggregate.serviceCodes.values()).sort((left, right) => left.code.localeCompare(right.code));
      const projectCodes = Array.from(aggregate.projectIds)
        .map((projectId) => projectMap.get(projectId)?.code ?? projectId)
        .sort((left, right) => left.localeCompare(right));

      return {
        key: aggregate.key,
        executionDate: aggregate.executionDate,
        teamId: aggregate.teamId,
        teamName: aggregate.teamName,
        foremanName: aggregate.foremanName,
        teamTypeId: teamType.teamTypeId,
        teamTypeName: teamType.teamTypeName || "Nao identificado",
        points: Number(aggregate.points.toFixed(2)),
        pointTarget: Number(pointTarget.toFixed(2)),
        pointDifference: Number(pointDifference.toFixed(2)),
        totalValue: Number(aggregate.totalValue.toFixed(2)),
        financialTarget: Number(financialTarget.toFixed(2)),
        complementValue: Number(complementValue.toFixed(2)),
        quantity: Number(aggregate.quantity.toFixed(4)),
        itemCount: aggregate.itemCount,
        orderCount: aggregate.orderIds.size,
        projectCount: aggregate.projectIds.size,
        projectCodes,
        serviceCodes,
        status: statusLabel,
      };
    })
    .sort((left, right) => left.executionDate.localeCompare(right.executionDate) || left.teamName.localeCompare(right.teamName));

  const summary = rows.reduce(
    (accumulator, row) => ({
      rowCount: accumulator.rowCount + 1,
      reachedCount: accumulator.reachedCount + (row.status === "ATINGIU" ? 1 : 0),
      notReachedCount: accumulator.notReachedCount + (row.status === "NAO_ATINGIU" ? 1 : 0),
      withoutTargetCount: accumulator.withoutTargetCount + (row.status === "SEM_META" ? 1 : 0),
      totalPoints: accumulator.totalPoints + row.points,
      totalValue: accumulator.totalValue + row.totalValue,
      complementValue: accumulator.complementValue + row.complementValue,
    }),
    { rowCount: 0, reachedCount: 0, notReachedCount: 0, withoutTargetCount: 0, totalPoints: 0, totalValue: 0, complementValue: 0 },
  );

  return NextResponse.json({
    filters: {
      startDate,
      endDate,
      status,
      projectIds,
      teamIds,
      serviceTypeId,
      activityIds,
      detailTeamId,
      detailDate,
      generatedAt: new Date().toISOString(),
    },
    rows,
    detailRows,
    summary: {
      ...summary,
      totalPoints: Number(summary.totalPoints.toFixed(2)),
      totalValue: Number(summary.totalValue.toFixed(2)),
      complementValue: Number(summary.complementValue.toFixed(2)),
    },
  });
}

export async function GET(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para carregar Apuracao de Fator Minimo.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const authorizationError = await authorizeRead(resolution);
  if (authorizationError) return authorizationError;

  if (request.nextUrl.searchParams.get("mode") === "meta") {
    return loadMeta(resolution);
  }

  return buildAnalysis(resolution, request);
}
