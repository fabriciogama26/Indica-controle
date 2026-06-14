import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";
import { requirePageAction } from "@/lib/server/pageAuthorization";

const DASHBOARD_MEASUREMENT_PAGE_KEY = "dashboard-medicao";

type MeasurementOrderRow = {
  id: string;
  project_id: string;
  team_id: string;
  execution_date: string;
  measurement_kind: string;
  minimum_billing_amount: number | string;
  status: string;
  project_code_snapshot: string | null;
  team_name_snapshot: string | null;
  foreman_name_snapshot: string | null;
  programming_completion_status_snapshot: string | null;
};

type MeasurementOrderItemRow = {
  measurement_order_id: string;
  total_value: number | string;
};

type ProjectTestRow = {
  id: string;
  is_test: boolean | null;
  service_center: string | null;
};

type ProjectServiceCenterRow = {
  id: string;
  name: string | null;
};

type ProjectMeta = {
  isTest: boolean;
  serviceCenterId: string | null;
  serviceCenterName: string;
};

type ProjectProductionDetail = {
  projectId: string;
  projectCode: string;
  serviceCenter: string;
  totalValue: number;
  orderCount: number;
};

type CompletionAggregate = {
  value: number;
  orders: number;
  projectIds: Set<string>;
  projects: Map<string, ProjectProductionDetail>;
};

type TeamRow = {
  id: string;
  name: string;
  team_type_id: string | null;
  foreman_person_id: string | null;
  supervisor_person_id: string | null;
  ativo?: boolean | null;
};

type TeamTypeHistoryRow = {
  team_id: string;
  team_type_id: string | null;
  team_type_name_snapshot: string;
  valid_from: string;
  valid_to: string | null;
};

type TeamForemanHistoryRow = {
  team_id: string;
  foreman_name_snapshot: string;
  valid_from: string;
  valid_to: string | null;
};

type TeamTypeRow = {
  id: string;
  name: string | null;
};

type PersonRow = {
  id: string;
  nome: string | null;
};

type CycleWorkdaysRow = {
  id: string;
  cycle_start: string;
  cycle_end: string;
  workdays: number | string;
  default_workdays: number | string | null;
};

type CycleTargetItemRow = {
  team_type_id: string;
  daily_value: number | string;
  daily_goal: number | string;
  cycle_goal: number | string;
  standard_cycle_goal: number | string | null;
  worked_cycle_goal: number | string | null;
};

type ProgrammingCompletionRow = {
  project_id: string;
  execution_date: string;
  status: string;
  work_completion_status: string | null;
  updated_at: string;
};

type ProgrammingCompletionTimelineItem = {
  executionDate: string;
  status: string;
  updatedAt: string;
};

type CycleWeek = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  workdays: number;
};

type TeamProductionAggregate = {
  teamId: string;
  teamName: string;
  foremanNames: Set<string>;
  measuredForemanNamesByDate: Map<string, Set<string>>;
  totalValue: number;
  metaValue: number;
  standardMetaValue: number;
  workedMetaValue: number;
  projectIds: Set<string>;
  projects: Map<string, ProjectProductionDetail>;
  workedDates: Set<string>;
};

type ForemanAggregate = {
  foremanName: string;
  totalValue: number;
  metaValue: number;
  standardMetaValue: number;
  workedMetaValue: number;
  projectIds: Set<string>;
  projects: Map<string, ProjectProductionDetail>;
  teamIds: Set<string>;
  metaDays: number;
  standardMetaDays: number;
  workedDays: number;
};

type SupervisorAggregate = {
  supervisorId: string | null;
  supervisorName: string;
  totalValue: number;
  orderCount: number;
  projectIds: Set<string>;
  projects: Map<string, ProjectProductionDetail>;
  productiveTeamIds: Set<string>;
  potentialTeamIds: Set<string>;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeUuid(value: unknown) {
  const normalized = normalizeText(value);
  return /^[0-9a-f-]{36}$/i.test(normalized) ? normalized : null;
}

function normalizeIsoDate(value: unknown) {
  const normalized = normalizeText(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function normalizeCompletionStatus(value: unknown) {
  const token = normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, "_");

  if (token === "CONCLUIDO" || token === "COMPLETO" || token.startsWith("CONCLUIDO")) return "CONCLUIDO";
  if (token === "PARCIAL_PLANEJADO_BENEFICIO_ATINGIDO" || token === "PARCIAL_PLANEJADO_BENFICIO_ATINGIDO") {
    return "PARCIAL_PLANEJADO_BENEFICIO_ATINGIDO";
  }
  if (token === "PARCIAL" || token.startsWith("PARCIAL")) return "PARCIAL";
  if (token === "PENDENCIA" || token === "PENDENCIAS" || token.startsWith("PENDEN")) return "PENDENCIA";
  return "NAO_INFORMADO";
}

function isCanceledProgrammingStatus(value: unknown) {
  return normalizeText(value).toUpperCase() === "CANCELADA";
}

function createUtcDate(year: number, monthIndex: number, day: number) {
  return new Date(Date.UTC(year, monthIndex, day));
}

function parseIsoDate(value: string) {
  const [year, month, day] = value.split("-").map((item) => Number(item));
  return createUtcDate(year, month - 1, day);
}

function toIsoDate(value: Date) {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(value: Date, days: number) {
  return createUtcDate(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate() + days);
}

function addMonths(value: Date, months: number) {
  return createUtcDate(value.getUTCFullYear(), value.getUTCMonth() + months, value.getUTCDate());
}

function resolveCycleStart(reference: Date) {
  const year = reference.getUTCFullYear();
  const monthIndex = reference.getUTCMonth();
  const day = reference.getUTCDate();
  return day >= 21 ? createUtcDate(year, monthIndex, 21) : createUtcDate(year, monthIndex - 1, 21);
}

function formatCycleLabel(start: Date, end: Date) {
  const startDay = String(start.getUTCDate()).padStart(2, "0");
  const startMonth = String(start.getUTCMonth() + 1).padStart(2, "0");
  const startYear = String(start.getUTCFullYear());
  const endDay = String(end.getUTCDate()).padStart(2, "0");
  const endMonth = String(end.getUTCMonth() + 1).padStart(2, "0");
  const endYear = String(end.getUTCFullYear());
  return `Ciclo ${startDay}/${startMonth}/${startYear} a ${endDay}/${endMonth}/${endYear}`;
}

function formatShortDate(value: Date) {
  const day = String(value.getUTCDate()).padStart(2, "0");
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
}

function countBusinessDays(start: Date, end: Date) {
  let total = 0;
  for (let current = start; current <= end; current = addDays(current, 1)) {
    const day = current.getUTCDay();
    if (day !== 0 && day !== 6) total += 1;
  }
  return total;
}

function buildCycleWeeks(cycleStart: string, cycleEnd: string): CycleWeek[] {
  const weeks: CycleWeek[] = [];
  let start = parseIsoDate(cycleStart);
  const cycleEndDate = parseIsoDate(cycleEnd);
  let index = 1;

  while (start <= cycleEndDate) {
    const end = addDays(start, 6) > cycleEndDate ? cycleEndDate : addDays(start, 6);
    weeks.push({
      id: `week-${index}`,
      label: `${index}ª semana (${formatShortDate(start)} a ${formatShortDate(end)})`,
      startDate: toIsoDate(start),
      endDate: toIsoDate(end),
      workdays: countBusinessDays(start, end),
    });
    start = addDays(end, 1);
    index += 1;
  }

  return weeks;
}

function buildCycleFromMeasurementDate(value: string) {
  const measurementDate = parseIsoDate(value);
  const start = resolveCycleStart(measurementDate);
  const end = addMonths(start, 1);
  end.setUTCDate(20);
  return {
    cycleStart: toIsoDate(start),
    cycleEnd: toIsoDate(end),
    label: formatCycleLabel(start, end),
  };
}

function formatPeriodLabel(period: string) {
  const [year, month] = period.split("-");
  return `${month}/${year}`;
}

async function fetchProjectMetaMap(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  projectIds: string[];
}) {
  const projectIds = Array.from(new Set(params.projectIds.filter(Boolean)));
  if (!projectIds.length) return new Map<string, ProjectMeta>();

  const { data, error } = await params.supabase
    .from("project")
    .select("id, is_test, service_center")
    .eq("tenant_id", params.tenantId)
    .in("id", projectIds)
    .returns<ProjectTestRow[]>();

  if (error) return new Map<string, ProjectMeta>();

  const serviceCenterIds = Array.from(new Set((data ?? []).map((item) => item.service_center).filter((id): id is string => Boolean(id))));
  const serviceCentersResult = serviceCenterIds.length
    ? await params.supabase
        .from("project_service_centers")
        .select("id, name")
        .eq("tenant_id", params.tenantId)
        .in("id", serviceCenterIds)
        .returns<ProjectServiceCenterRow[]>()
    : { data: [] as ProjectServiceCenterRow[], error: null };
  const serviceCenterMap = new Map((serviceCentersResult.data ?? []).map((item) => [item.id, normalizeText(item.name)]));

  return new Map((data ?? []).map((item) => [
    item.id,
    {
      isTest: Boolean(item.is_test),
      serviceCenterId: item.service_center,
      serviceCenterName: item.service_center ? serviceCenterMap.get(item.service_center) || "Centro nao identificado" : "Centro nao informado",
    },
  ]));
}

async function fetchProjectCompletionTimeline(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  projectIds: string[];
  endDate: string;
}) {
  const projectIds = Array.from(new Set(params.projectIds.filter(Boolean)));
  if (!projectIds.length) return new Map<string, ProgrammingCompletionTimelineItem[]>();

  const { data, error } = await params.supabase
    .from("project_programming")
    .select("project_id, execution_date, status, work_completion_status, updated_at")
    .eq("tenant_id", params.tenantId)
    .in("project_id", projectIds)
    .lte("execution_date", params.endDate)
    .neq("status", "CANCELADA")
    .not("work_completion_status", "is", null)
    .returns<ProgrammingCompletionRow[]>();

  if (error) return new Map<string, ProgrammingCompletionTimelineItem[]>();

  const result = new Map<string, ProgrammingCompletionTimelineItem[]>();
  for (const row of data ?? []) {
    if (isCanceledProgrammingStatus(row.status)) continue;

    const status = normalizeCompletionStatus(row.work_completion_status);
    const executionDate = normalizeIsoDate(row.execution_date);
    if (status === "NAO_INFORMADO" || !executionDate) continue;

    const current = result.get(row.project_id) ?? [];
    current.push({
      executionDate,
      status,
      updatedAt: row.updated_at,
    });
    result.set(row.project_id, current);
  }

  for (const items of result.values()) {
    items.sort((left, right) => {
      const byExecutionDate = right.executionDate.localeCompare(left.executionDate);
      if (byExecutionDate !== 0) {
        return byExecutionDate;
      }

      return right.updatedAt.localeCompare(left.updatedAt);
    });
  }

  return result;
}

function resolveProjectCompletionAtWindowEnd(
  timeline: Map<string, ProgrammingCompletionTimelineItem[]>,
  projectId: string,
  windowEndDate: string,
) {
  const normalizedWindowEndDate = normalizeIsoDate(windowEndDate);
  if (!normalizedWindowEndDate) {
    return null;
  }

  for (const item of timeline.get(projectId) ?? []) {
    if (item.executionDate <= normalizedWindowEndDate) {
      return item.status;
    }
  }

  return null;
}

function resolveWindowEndDate(orders: MeasurementOrderRow[], fallbackEndDate: string) {
  const orderDates = orders.map((order) => normalizeIsoDate(order.execution_date)).filter((date): date is string => Boolean(date)).sort();
  return orderDates[orderDates.length - 1] ?? fallbackEndDate;
}

function buildOrderCompletionMapForWindow(params: {
  timeline: Map<string, ProgrammingCompletionTimelineItem[]>;
  orders: MeasurementOrderRow[];
  windowEndDate: string;
}) {
  const result = new Map<string, string>();
  for (const order of params.orders) {
    const projectCompletion = resolveProjectCompletionAtWindowEnd(params.timeline, order.project_id, params.windowEndDate);
    const snapshot = normalizeCompletionStatus(order.programming_completion_status_snapshot);
    result.set(order.id, projectCompletion ?? (snapshot !== "NAO_INFORMADO" ? snapshot : "NAO_INFORMADO"));
  }
  return result;
}

export async function GET(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para carregar dashboard de medicao.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const authorization = await requirePageAction({
    context: resolution,
    pageKey: DASHBOARD_MEASUREMENT_PAGE_KEY,
    action: "read",
  });
  if (!authorization.allowed) {
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

  const tenantId = resolution.appUser.tenant_id;
  const selectedCycleStart = normalizeIsoDate(request.nextUrl.searchParams.get("cycleStart"));
  const startDateFilter = normalizeIsoDate(request.nextUrl.searchParams.get("startDate"));
  const endDateFilter = normalizeIsoDate(request.nextUrl.searchParams.get("endDate"));
  const projectIdFilter = normalizeUuid(request.nextUrl.searchParams.get("projectId"));
  const projectQueryFilter = normalizeText(request.nextUrl.searchParams.get("project")).toLowerCase();
  const teamIdFilter = normalizeUuid(request.nextUrl.searchParams.get("teamId"));
  const foremanFilter = normalizeText(request.nextUrl.searchParams.get("foreman"));
  const supervisorIdFilter = normalizeUuid(request.nextUrl.searchParams.get("supervisorId"));
  const completionFilter = normalizeText(request.nextUrl.searchParams.get("completionStatus")).toUpperCase();

  const { data: orders, error: ordersError } = await resolution.supabase
    .from("project_measurement_orders")
    .select("id, project_id, team_id, execution_date, measurement_kind, minimum_billing_amount, status, project_code_snapshot, team_name_snapshot, foreman_name_snapshot, programming_completion_status_snapshot")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .eq("measurement_kind", "COM_PRODUCAO")
    .neq("status", "CANCELADA")
    .order("execution_date", { ascending: false })
    .limit(10000)
    .returns<MeasurementOrderRow[]>();

  if (ordersError) {
    return NextResponse.json({ message: "Falha ao carregar medicoes para dashboard." }, { status: 500 });
  }

  const { data: minimumBillingGuaranteeOrders, error: minimumBillingGuaranteeOrdersError } = await resolution.supabase
    .from("project_measurement_orders")
    .select("id, project_id, team_id, execution_date, measurement_kind, minimum_billing_amount, status, project_code_snapshot, team_name_snapshot, foreman_name_snapshot, programming_completion_status_snapshot")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .eq("measurement_kind", "SEM_PRODUCAO")
    .gt("minimum_billing_amount", 0)
    .neq("status", "CANCELADA")
    .order("execution_date", { ascending: false })
    .limit(10000)
    .returns<MeasurementOrderRow[]>();

  if (minimumBillingGuaranteeOrdersError) {
    return NextResponse.json({ message: "Falha ao carregar garantias de faturamento minimo para dashboard." }, { status: 500 });
  }

  const projectMetaMap = await fetchProjectMetaMap({
    supabase: resolution.supabase,
    tenantId,
    projectIds: [...(orders ?? []), ...(minimumBillingGuaranteeOrders ?? [])].map((item) => item.project_id),
  });

  const validOrders = (orders ?? [])
    .filter((order) => normalizeIsoDate(order.execution_date))
    .filter((order) => !projectMetaMap.get(order.project_id)?.isTest);
  const validMinimumBillingGuaranteeOrders = (minimumBillingGuaranteeOrders ?? [])
    .filter((order) => normalizeIsoDate(order.execution_date))
    .filter((order) => !projectMetaMap.get(order.project_id)?.isTest);

  const cycleMap = new Map<string, ReturnType<typeof buildCycleFromMeasurementDate>>();
  for (const order of validOrders) {
    const executionDate = normalizeIsoDate(order.execution_date);
    if (!executionDate) continue;
    const cycle = buildCycleFromMeasurementDate(executionDate);
    if (!cycleMap.has(cycle.cycleStart)) {
      cycleMap.set(cycle.cycleStart, cycle);
    }
  }

  const cycles = Array.from(cycleMap.values()).sort((left, right) => right.cycleStart.localeCompare(left.cycleStart));
  const periods = Array.from(new Set(cycles.map((cycle) => cycle.cycleEnd.slice(0, 7))))
    .sort((left, right) => right.localeCompare(left))
    .map((period) => ({ id: period, label: formatPeriodLabel(period) }));
  const selectedCycle = cycles.find((cycle) => cycle.cycleStart === selectedCycleStart) ?? cycles[0] ?? null;
  if (!selectedCycle) {
    return NextResponse.json({
      cycles: [],
      periods: [],
      selectedPeriod: null,
      startDate: null,
      endDate: null,
      selectedCycleStart: null,
      filters: { projects: [], teams: [], foremen: [], supervisors: [] },
      summary: null,
      completionChart: [],
      cycleCompletionChart: [],
      periodCompletionChart: [],
      periodSummary: null,
      cycleComparison: null,
      teamsProduction: [],
      teamsProductionByWeek: {},
      foremen: [],
      foremenByWeek: {},
      cycleWeeks: [],
      supervisorsProduction: [],
      supervisorsProductionByWeek: {},
    });
  }

  const cycleOrders = validOrders.filter((order) => {
    if (order.execution_date < selectedCycle.cycleStart || order.execution_date > selectedCycle.cycleEnd) return false;
    return true;
  });
  const cycleWeeks = buildCycleWeeks(selectedCycle.cycleStart, selectedCycle.cycleEnd);

  const hasPeriodFilter = Boolean(startDateFilter || endDateFilter);
  const periodOrders = hasPeriodFilter
    ? validOrders.filter((order) => {
        if (startDateFilter && order.execution_date < startDateFilter) return false;
        if (endDateFilter && order.execution_date > endDateFilter) return false;
        return true;
      })
    : cycleOrders;
  const periodMinimumBillingGuaranteeOrders = hasPeriodFilter
    ? validMinimumBillingGuaranteeOrders.filter((order) => {
        if (startDateFilter && order.execution_date < startDateFilter) return false;
        if (endDateFilter && order.execution_date > endDateFilter) return false;
        return true;
      })
    : validMinimumBillingGuaranteeOrders.filter((order) => (
        order.execution_date >= selectedCycle.cycleStart
        && order.execution_date <= selectedCycle.cycleEnd
      ));

  const cycleWindowEndDate = selectedCycle.cycleEnd;
  const periodWindowEndDate = endDateFilter ?? resolveWindowEndDate(periodOrders, selectedCycle.cycleEnd);
  const completionOrders = [...cycleOrders, ...periodOrders];
  const completionTimelineEndDate = [cycleWindowEndDate, periodWindowEndDate].sort()[1] ?? selectedCycle.cycleEnd;
  const projectCompletionTimeline = await fetchProjectCompletionTimeline({
    supabase: resolution.supabase,
    tenantId,
    projectIds: completionOrders.map((order) => order.project_id),
    endDate: completionTimelineEndDate,
  });

  const cycleOrderCompletionMap = buildOrderCompletionMapForWindow({
    timeline: projectCompletionTimeline,
    orders: cycleOrders,
    windowEndDate: cycleWindowEndDate,
  });
  const periodOrderCompletionMap = buildOrderCompletionMapForWindow({
    timeline: projectCompletionTimeline,
    orders: periodOrders,
    windowEndDate: periodWindowEndDate,
  });

  const allVisibleTeamIds = Array.from(new Set([...cycleOrders, ...periodOrders, ...periodMinimumBillingGuaranteeOrders].map((order) => order.team_id).filter(Boolean)));
  const teamsResult = allVisibleTeamIds.length
    ? await resolution.supabase
        .from("teams")
        .select("id, name, team_type_id, foreman_person_id, supervisor_person_id, ativo")
        .eq("tenant_id", tenantId)
        .in("id", allVisibleTeamIds)
        .returns<TeamRow[]>()
    : { data: [] as TeamRow[], error: null };

  if (teamsResult.error) {
    return NextResponse.json({ message: "Falha ao carregar equipes para dashboard." }, { status: 500 });
  }

  const activeTeamsResult = await resolution.supabase
    .from("teams")
    .select("id, name, team_type_id, foreman_person_id, supervisor_person_id, ativo")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .returns<TeamRow[]>();

  if (activeTeamsResult.error) {
    return NextResponse.json({ message: "Falha ao carregar equipes ativas para metas de supervisores." }, { status: 500 });
  }

  const teamTypeHistoryTeamIds = Array.from(
    new Set([...allVisibleTeamIds, ...(activeTeamsResult.data ?? []).map((team) => team.id).filter(Boolean)]),
  );
  const teamTypeHistoryResult = teamTypeHistoryTeamIds.length
    ? await resolution.supabase
        .from("team_type_history")
        .select("team_id, team_type_id, team_type_name_snapshot, valid_from, valid_to")
        .eq("tenant_id", tenantId)
        .in("team_id", teamTypeHistoryTeamIds)
        .returns<TeamTypeHistoryRow[]>()
    : { data: [] as TeamTypeHistoryRow[], error: null };

  if (teamTypeHistoryResult.error) {
    return NextResponse.json({ message: "Falha ao carregar historico de tipo das equipes." }, { status: 500 });
  }

  const teamMap = new Map((teamsResult.data ?? []).map((team) => [team.id, team]));
  const activeTeamMap = new Map((activeTeamsResult.data ?? []).map((team) => [team.id, team]));
  const teamTypeHistoryByTeam = new Map<string, TeamTypeHistoryRow[]>();
  for (const entry of teamTypeHistoryResult.data ?? []) {
    const entries = teamTypeHistoryByTeam.get(entry.team_id) ?? [];
    entries.push(entry);
    teamTypeHistoryByTeam.set(entry.team_id, entries);
  }
  for (const entries of teamTypeHistoryByTeam.values()) {
    entries.sort((left, right) => right.valid_from.localeCompare(left.valid_from));
  }

  const teamForemanHistoryResult = teamTypeHistoryTeamIds.length
    ? await resolution.supabase
        .from("team_foreman_history")
        .select("team_id, foreman_name_snapshot, valid_from, valid_to")
        .eq("tenant_id", tenantId)
        .in("team_id", teamTypeHistoryTeamIds)
        .returns<TeamForemanHistoryRow[]>()
    : { data: [] as TeamForemanHistoryRow[], error: null };

  if (teamForemanHistoryResult.error) {
    return NextResponse.json({ message: "Falha ao carregar historico de encarregados das equipes." }, { status: 500 });
  }

  const teamForemanHistoryByTeam = new Map<string, TeamForemanHistoryRow[]>();
  for (const entry of teamForemanHistoryResult.data ?? []) {
    const entries = teamForemanHistoryByTeam.get(entry.team_id) ?? [];
    entries.push(entry);
    teamForemanHistoryByTeam.set(entry.team_id, entries);
  }
  for (const entries of teamForemanHistoryByTeam.values()) {
    entries.sort((left, right) => right.valid_from.localeCompare(left.valid_from));
  }

  const teamTypeIds = Array.from(new Set([
    ...(teamTypeHistoryResult.data ?? []).map((entry) => entry.team_type_id),
    ...(teamsResult.data ?? []).map((team) => team.team_type_id),
    ...(activeTeamsResult.data ?? []).map((team) => team.team_type_id),
  ].filter((id): id is string => Boolean(id))));
  const teamTypesResult = teamTypeIds.length
    ? await resolution.supabase
        .from("team_types")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .in("id", teamTypeIds)
        .returns<TeamTypeRow[]>()
    : { data: [] as TeamTypeRow[], error: null };

  if (teamTypesResult.error) {
    return NextResponse.json({ message: "Falha ao carregar tipos das equipes." }, { status: 500 });
  }

  const teamTypeNameMap = new Map((teamTypesResult.data ?? []).map((teamType) => [teamType.id, normalizeText(teamType.name)]));

  const personIds = Array.from(
    new Set(
      [...(teamsResult.data ?? []), ...(activeTeamsResult.data ?? [])]
        .flatMap((team) => [team.foreman_person_id, team.supervisor_person_id])
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const peopleResult = personIds.length
    ? await resolution.supabase
        .from("people")
        .select("id, nome")
        .eq("tenant_id", tenantId)
        .in("id", personIds)
        .returns<PersonRow[]>()
    : { data: [] as PersonRow[], error: null };
  const personMap = new Map((peopleResult.data ?? []).map((person) => [person.id, normalizeText(person.nome)]));

  const projectOptions = Array.from(
    new Map(cycleOrders.map((order) => [order.project_id, {
      id: order.project_id,
      label: normalizeText(order.project_code_snapshot) || "Projeto sem codigo",
    }])).values(),
  ).sort((left, right) => left.label.localeCompare(right.label));

  const teamOptions = Array.from(
    new Map(cycleOrders.map((order) => [order.team_id, {
      id: order.team_id,
      label: normalizeText(order.team_name_snapshot) || "Equipe sem nome",
    }])).values(),
  ).sort((left, right) => left.label.localeCompare(right.label));

  const foremanOptions = Array.from(
    new Set(cycleOrders.map((order) => normalizeText(order.foreman_name_snapshot)).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right));

  const supervisorOptions = Array.from(
    new Map(
      (activeTeamsResult.data ?? [])
        .filter((team): team is TeamRow => Boolean(team?.supervisor_person_id))
        .map((team) => [
          team.supervisor_person_id as string,
          {
            id: team.supervisor_person_id as string,
            label: personMap.get(team.supervisor_person_id as string) || "Supervisor nao identificado",
          },
        ]),
    ).values(),
  ).sort((left, right) => left.label.localeCompare(right.label));

  const filteredOrders = cycleOrders.filter((order) => {
    if (projectIdFilter && order.project_id !== projectIdFilter) return false;
    if (projectQueryFilter && !normalizeText(order.project_code_snapshot).toLowerCase().includes(projectQueryFilter)) return false;
    if (teamIdFilter && order.team_id !== teamIdFilter) return false;
    if (foremanFilter && normalizeText(order.foreman_name_snapshot) !== foremanFilter) return false;
    if (supervisorIdFilter && teamMap.get(order.team_id)?.supervisor_person_id !== supervisorIdFilter) return false;
    if (
      (
        completionFilter === "CONCLUIDO"
        || completionFilter === "PARCIAL"
        || completionFilter === "PARCIAL_PLANEJADO_BENEFICIO_ATINGIDO"
        || completionFilter === "PENDENCIA"
      )
      && cycleOrderCompletionMap.get(order.id) !== completionFilter
    ) return false;
    return true;
  });

  const periodFilteredOrders = periodOrders.filter((order) => {
    if (projectIdFilter && order.project_id !== projectIdFilter) return false;
    if (projectQueryFilter && !normalizeText(order.project_code_snapshot).toLowerCase().includes(projectQueryFilter)) return false;
    if (teamIdFilter && order.team_id !== teamIdFilter) return false;
    if (foremanFilter && normalizeText(order.foreman_name_snapshot) !== foremanFilter) return false;
    if (supervisorIdFilter && teamMap.get(order.team_id)?.supervisor_person_id !== supervisorIdFilter) return false;
    if (
      (
        completionFilter === "CONCLUIDO"
        || completionFilter === "PARCIAL"
        || completionFilter === "PARCIAL_PLANEJADO_BENEFICIO_ATINGIDO"
        || completionFilter === "PENDENCIA"
      )
      && periodOrderCompletionMap.get(order.id) !== completionFilter
    ) return false;
    return true;
  });
  const periodFilteredMinimumBillingGuaranteeOrders = periodMinimumBillingGuaranteeOrders.filter((order) => {
    if (projectIdFilter && order.project_id !== projectIdFilter) return false;
    if (projectQueryFilter && !normalizeText(order.project_code_snapshot).toLowerCase().includes(projectQueryFilter)) return false;
    if (teamIdFilter && order.team_id !== teamIdFilter) return false;
    if (foremanFilter && normalizeText(order.foreman_name_snapshot) !== foremanFilter) return false;
    if (supervisorIdFilter && teamMap.get(order.team_id)?.supervisor_person_id !== supervisorIdFilter) return false;
    if (
      completionFilter === "CONCLUIDO"
      || completionFilter === "PARCIAL"
      || completionFilter === "PARCIAL_PLANEJADO_BENEFICIO_ATINGIDO"
      || completionFilter === "PENDENCIA"
    ) return false;
    return true;
  });

  const orderIds = Array.from(new Set([...filteredOrders, ...periodFilteredOrders].map((order) => order.id)));
  const { data: items, error: itemsError } = orderIds.length
    ? await resolution.supabase
        .from("project_measurement_order_items")
        .select("measurement_order_id, total_value")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .in("measurement_order_id", orderIds)
        .returns<MeasurementOrderItemRow[]>()
    : { data: [] as MeasurementOrderItemRow[], error: null };

  if (itemsError) {
    return NextResponse.json({ message: "Falha ao carregar valores das medicoes." }, { status: 500 });
  }

  const valueByOrder = new Map<string, number>();
  for (const item of items ?? []) {
    valueByOrder.set(item.measurement_order_id, (valueByOrder.get(item.measurement_order_id) ?? 0) + Number(item.total_value ?? 0));
  }

  const selectedCycleRecordResult = await resolution.supabase
    .from("measurement_cycle_workdays")
    .select("id, cycle_start, cycle_end, workdays, default_workdays")
    .eq("tenant_id", tenantId)
    .eq("cycle_start", selectedCycle.cycleStart)
    .maybeSingle<CycleWorkdaysRow>();

  const selectedCycleRecord = selectedCycleRecordResult.data ?? null;
  const targetItemsResult = selectedCycleRecord
    ? await resolution.supabase
        .from("measurement_cycle_target_items")
        .select("team_type_id, daily_value, daily_goal, cycle_goal, standard_cycle_goal, worked_cycle_goal")
        .eq("tenant_id", tenantId)
        .eq("cycle_id", selectedCycleRecord.id)
        .returns<CycleTargetItemRow[]>()
    : { data: [] as CycleTargetItemRow[], error: null };

  if (targetItemsResult.error) {
    return NextResponse.json({ message: "Falha ao carregar metas do ciclo." }, { status: 500 });
  }

  const dailyMetaByTeamType = new Map((targetItemsResult.data ?? []).map((item) => [item.team_type_id, Number(item.daily_value ?? 0)]));
  const targetDailyValue = (targetItemsResult.data ?? []).reduce((sum, item) => sum + Number(item.daily_goal ?? 0), 0);
  const cycleMetaValue = (targetItemsResult.data ?? []).reduce((sum, item) => sum + Number(item.cycle_goal ?? 0), 0);
  const standardCycleMetaValue = (targetItemsResult.data ?? []).reduce((sum, item) => sum + Number(item.standard_cycle_goal ?? 0), 0);
  const workdays = Number(selectedCycleRecord?.workdays ?? 0);
  const defaultWorkdays = Number(selectedCycleRecord?.default_workdays ?? selectedCycleRecord?.workdays ?? 0);

  function createCompletionTotals() {
    return new Map<string, CompletionAggregate>([
      ["CONCLUIDO", { value: 0, orders: 0, projectIds: new Set<string>(), projects: new Map<string, ProjectProductionDetail>() }],
      ["PARCIAL", { value: 0, orders: 0, projectIds: new Set<string>(), projects: new Map<string, ProjectProductionDetail>() }],
      ["PARCIAL_PLANEJADO_BENEFICIO_ATINGIDO", { value: 0, orders: 0, projectIds: new Set<string>(), projects: new Map<string, ProjectProductionDetail>() }],
      ["PENDENCIA", { value: 0, orders: 0, projectIds: new Set<string>(), projects: new Map<string, ProjectProductionDetail>() }],
      ["NAO_INFORMADO", { value: 0, orders: 0, projectIds: new Set<string>(), projects: new Map<string, ProjectProductionDetail>() }],
    ]);
  }

  function createCompletionAggregate(): CompletionAggregate {
    return {
      value: 0,
      orders: 0,
      projectIds: new Set<string>(),
      projects: new Map<string, ProjectProductionDetail>(),
    };
  }

  function addCompletionTotals(
    target: Map<string, CompletionAggregate>,
    order: MeasurementOrderRow,
    completionMap: Map<string, string>,
  ) {
    const totalValue = valueByOrder.get(order.id) ?? 0;
    const completion = completionMap.get(order.id) ?? "NAO_INFORMADO";
    const completionTotal = target.get(completion) ?? {
      value: 0,
      orders: 0,
      projectIds: new Set<string>(),
      projects: new Map<string, ProjectProductionDetail>(),
    };
    completionTotal.value += totalValue;
    completionTotal.orders += 1;
    completionTotal.projectIds.add(order.project_id);
    addProjectProduction(completionTotal.projects, order, totalValue);
    target.set(completion, completionTotal);
  }

  function addMinimumBillingGuaranteeTotal(target: CompletionAggregate, order: MeasurementOrderRow) {
    const totalValue = Number(order.minimum_billing_amount ?? 0);
    target.value += totalValue;
    target.orders += 1;
    target.projectIds.add(order.project_id);
    addProjectProduction(target.projects, order, totalValue);
  }

  function buildCompletionChart(target: Map<string, CompletionAggregate>, minimumBillingGuaranteeTotal?: CompletionAggregate) {
    const totalValue = Array.from(target.values()).reduce((sum, item) => sum + item.value, 0)
      + (minimumBillingGuaranteeTotal?.value ?? 0);
    const chart = [
      {
        label: "Concluidos",
        value: target.get("CONCLUIDO")?.value ?? 0,
        orders: target.get("CONCLUIDO")?.orders ?? 0,
        projectCount: target.get("CONCLUIDO")?.projectIds.size ?? 0,
        projects: buildProjectProductionRows(target.get("CONCLUIDO")?.projects ?? new Map<string, ProjectProductionDetail>()),
        percentage: totalValue > 0 ? ((target.get("CONCLUIDO")?.value ?? 0) / totalValue) * 100 : 0,
      },
      {
        label: "Parciais",
        value: target.get("PARCIAL")?.value ?? 0,
        orders: target.get("PARCIAL")?.orders ?? 0,
        projectCount: target.get("PARCIAL")?.projectIds.size ?? 0,
        projects: buildProjectProductionRows(target.get("PARCIAL")?.projects ?? new Map<string, ProjectProductionDetail>()),
        percentage: totalValue > 0 ? ((target.get("PARCIAL")?.value ?? 0) / totalValue) * 100 : 0,
      },
      {
        label: "Parcial planejado beneficio atingido",
        value: target.get("PARCIAL_PLANEJADO_BENEFICIO_ATINGIDO")?.value ?? 0,
        orders: target.get("PARCIAL_PLANEJADO_BENEFICIO_ATINGIDO")?.orders ?? 0,
        projectCount: target.get("PARCIAL_PLANEJADO_BENEFICIO_ATINGIDO")?.projectIds.size ?? 0,
        projects: buildProjectProductionRows(target.get("PARCIAL_PLANEJADO_BENEFICIO_ATINGIDO")?.projects ?? new Map<string, ProjectProductionDetail>()),
        percentage: totalValue > 0 ? ((target.get("PARCIAL_PLANEJADO_BENEFICIO_ATINGIDO")?.value ?? 0) / totalValue) * 100 : 0,
      },
      {
        label: "Pendencias",
        value: target.get("PENDENCIA")?.value ?? 0,
        orders: target.get("PENDENCIA")?.orders ?? 0,
        projectCount: target.get("PENDENCIA")?.projectIds.size ?? 0,
        projects: buildProjectProductionRows(target.get("PENDENCIA")?.projects ?? new Map<string, ProjectProductionDetail>()),
        percentage: totalValue > 0 ? ((target.get("PENDENCIA")?.value ?? 0) / totalValue) * 100 : 0,
      },
    ];

    if (minimumBillingGuaranteeTotal) {
      chart.push({
        label: "Garantia de faturamento minimo",
        value: minimumBillingGuaranteeTotal.value,
        orders: minimumBillingGuaranteeTotal.orders,
        projectCount: minimumBillingGuaranteeTotal.projectIds.size,
        projects: buildProjectProductionRows(minimumBillingGuaranteeTotal.projects),
        percentage: totalValue > 0 ? (minimumBillingGuaranteeTotal.value / totalValue) * 100 : 0,
      });
    }

    return chart;
  }

  const cycleCompletionTotals = createCompletionTotals();
  const periodCompletionTotals = createCompletionTotals();
  const periodMinimumBillingGuaranteeTotal = createCompletionAggregate();

  const potentialSupervisorTeams = (activeTeamsResult.data ?? []).filter((team) => {
    if (!team.supervisor_person_id) return false;
    if (teamIdFilter && team.id !== teamIdFilter) return false;
    if (supervisorIdFilter && team.supervisor_person_id !== supervisorIdFilter) return false;
    return true;
  });

  function resolveTeamTypeForDate(teamId: string, isoDate: string) {
    const history = teamTypeHistoryByTeam.get(teamId) ?? [];
    const effectiveEntry = history.find((entry) => (
      entry.valid_from <= isoDate
      && (!entry.valid_to || entry.valid_to >= isoDate)
    ));

    if (effectiveEntry?.team_type_id) return effectiveEntry.team_type_id;

    return (teamMap.get(teamId) ?? activeTeamMap.get(teamId))?.team_type_id ?? null;
  }

  function resolveTeamTypeNameForDate(teamId: string, isoDate: string) {
    const history = teamTypeHistoryByTeam.get(teamId) ?? [];
    const effectiveEntry = history.find((entry) => (
      entry.valid_from <= isoDate
      && (!entry.valid_to || entry.valid_to >= isoDate)
    ));
    const historyName = normalizeText(effectiveEntry?.team_type_name_snapshot);
    if (historyName) return historyName;

    const teamTypeId = resolveTeamTypeForDate(teamId, isoDate);
    return teamTypeId ? teamTypeNameMap.get(teamTypeId) || "Nao identificado" : "Nao identificado";
  }

  function resolveTeamForemanNameForDate(teamId: string, isoDate: string) {
    const history = teamForemanHistoryByTeam.get(teamId) ?? [];
    const effectiveEntry = history.find((entry) => (
      entry.valid_from <= isoDate
      && (!entry.valid_to || entry.valid_to >= isoDate)
    ));
    const historyName = normalizeText(effectiveEntry?.foreman_name_snapshot);
    if (historyName) return historyName;

    const team = teamMap.get(teamId) ?? activeTeamMap.get(teamId);
    return (team?.foreman_person_id ? personMap.get(team.foreman_person_id) : "") || "Nao identificado";
  }

  function listBusinessDayIsoDates(startDate: string, endDate: string) {
    const start = parseIsoDate(startDate);
    const end = parseIsoDate(endDate);
    const dates: string[] = [];
    for (let current = start; current <= end; current = addDays(current, 1)) {
      const day = current.getUTCDay();
      if (day !== 0 && day !== 6) dates.push(toIsoDate(current));
    }
    return dates;
  }

  function calculateTeamMetaForWindow(teamId: string, startDate: string, endDate: string, metaWorkdays: number) {
    if (metaWorkdays <= 0) return 0;

    const businessDays = listBusinessDayIsoDates(startDate, endDate);
    if (!businessDays.length) return 0;

    const dayWeight = metaWorkdays / businessDays.length;
    return businessDays.reduce((total, isoDate) => {
      const teamTypeId = resolveTeamTypeForDate(teamId, isoDate);
      if (!teamTypeId) return total;
      return total + ((dailyMetaByTeamType.get(teamTypeId) ?? 0) * dayWeight);
    }, 0);
  }

  function calculateWorkedTeamMeta(teamId: string, dates: Set<string>) {
    let total = 0;
    for (const isoDate of dates) {
      const teamTypeId = resolveTeamTypeForDate(teamId, isoDate);
      if (!teamTypeId) continue;
      total += dailyMetaByTeamType.get(teamTypeId) ?? 0;
    }
    return total;
  }

  function createTeamProductionMap() {
    return new Map<string, TeamProductionAggregate>();
  }

  function createForemanMap() {
    return new Map<string, ForemanAggregate>();
  }

  function createSupervisorMap() {
    const map = new Map<string, SupervisorAggregate>();
    for (const team of potentialSupervisorTeams) {
      const supervisorId = team.supervisor_person_id ?? null;
      const supervisorName = supervisorId ? personMap.get(supervisorId) || "Supervisor nao identificado" : "Sem supervisor";
      const supervisorKey = supervisorId ?? "__NO_SUPERVISOR__";
      const currentSupervisor = map.get(supervisorKey) ?? {
        supervisorId,
        supervisorName,
        totalValue: 0,
        orderCount: 0,
        projectIds: new Set<string>(),
        projects: new Map<string, ProjectProductionDetail>(),
        productiveTeamIds: new Set<string>(),
        potentialTeamIds: new Set<string>(),
      };
      currentSupervisor.potentialTeamIds.add(team.id);
      map.set(supervisorKey, currentSupervisor);
    }
    return map;
  }

  function addProjectProduction(target: Map<string, ProjectProductionDetail>, order: MeasurementOrderRow, totalValue: number) {
    const current = target.get(order.project_id) ?? {
      projectId: order.project_id,
      projectCode: normalizeText(order.project_code_snapshot) || "Projeto sem codigo",
      serviceCenter: projectMetaMap.get(order.project_id)?.serviceCenterName || "Centro nao informado",
      totalValue: 0,
      orderCount: 0,
    };
    current.totalValue += totalValue;
    current.orderCount += 1;
    target.set(order.project_id, current);
  }

  function buildProjectProductionRows(target: Map<string, ProjectProductionDetail>) {
    return Array.from(target.values()).sort((left, right) => right.totalValue - left.totalValue);
  }

  function addTeamProductionOrder(target: Map<string, TeamProductionAggregate>, order: MeasurementOrderRow) {
    const totalValue = valueByOrder.get(order.id) ?? 0;
    const team = teamMap.get(order.team_id);
    const measuredForemanName = normalizeText(order.foreman_name_snapshot) || "Nao identificado";
    const foremanName = normalizeText(order.foreman_name_snapshot)
      || (team?.foreman_person_id ? personMap.get(team.foreman_person_id) : "")
      || "Nao identificado";
    const current = target.get(order.team_id) ?? {
      teamId: order.team_id,
      teamName: normalizeText(order.team_name_snapshot) || normalizeText(team?.name) || "Equipe sem nome",
      foremanNames: new Set<string>(),
      measuredForemanNamesByDate: new Map<string, Set<string>>(),
      totalValue: 0,
      metaValue: 0,
      standardMetaValue: 0,
      workedMetaValue: 0,
      projectIds: new Set<string>(),
      projects: new Map<string, ProjectProductionDetail>(),
      workedDates: new Set<string>(),
    };
    current.foremanNames.add(foremanName);
    const measuredForemanNames = current.measuredForemanNamesByDate.get(order.execution_date) ?? new Set<string>();
    measuredForemanNames.add(measuredForemanName);
    current.measuredForemanNamesByDate.set(order.execution_date, measuredForemanNames);
    current.totalValue += totalValue;
    current.projectIds.add(order.project_id);
    addProjectProduction(current.projects, order, totalValue);
    current.workedDates.add(order.execution_date);
    target.set(order.team_id, current);
  }

  function ensureForemanAggregate(target: Map<string, ForemanAggregate>, foremanName: string) {
    const normalizedForemanName = normalizeText(foremanName) || "Nao identificado";
    const current = target.get(normalizedForemanName) ?? {
      foremanName: normalizedForemanName,
      totalValue: 0,
      metaValue: 0,
      standardMetaValue: 0,
      workedMetaValue: 0,
      projectIds: new Set<string>(),
      projects: new Map<string, ProjectProductionDetail>(),
      teamIds: new Set<string>(),
      metaDays: 0,
      standardMetaDays: 0,
      workedDays: 0,
    };
    target.set(normalizedForemanName, current);
    return current;
  }

  function addForemanOrder(target: Map<string, ForemanAggregate>, order: MeasurementOrderRow) {
    const totalValue = valueByOrder.get(order.id) ?? 0;
    const foremanName = normalizeText(order.foreman_name_snapshot) || "Nao identificado";
    const current = ensureForemanAggregate(target, foremanName);
    current.totalValue += totalValue;
    current.projectIds.add(order.project_id);
    current.teamIds.add(order.team_id);
    addProjectProduction(current.projects, order, totalValue);
  }

  function addSupervisorOrder(target: Map<string, SupervisorAggregate>, order: MeasurementOrderRow) {
    const totalValue = valueByOrder.get(order.id) ?? 0;
    const team = teamMap.get(order.team_id);
    const supervisorId = team?.supervisor_person_id ?? null;
    const supervisorName = supervisorId ? personMap.get(supervisorId) || "Supervisor nao identificado" : "Sem supervisor";
    const supervisorKey = supervisorId ?? "__NO_SUPERVISOR__";
    const currentSupervisor = target.get(supervisorKey) ?? {
      supervisorId,
      supervisorName,
      totalValue: 0,
      orderCount: 0,
      projectIds: new Set<string>(),
      projects: new Map<string, ProjectProductionDetail>(),
      productiveTeamIds: new Set<string>(),
      potentialTeamIds: new Set<string>(),
    };
    currentSupervisor.totalValue += totalValue;
    currentSupervisor.orderCount += 1;
    currentSupervisor.projectIds.add(order.project_id);
    addProjectProduction(currentSupervisor.projects, order, totalValue);
    currentSupervisor.productiveTeamIds.add(order.team_id);
    if (activeTeamMap.has(order.team_id)) {
      currentSupervisor.potentialTeamIds.add(order.team_id);
    }
    target.set(supervisorKey, currentSupervisor);
  }

  function calculateSupervisorMeta(teamIds: Set<string>, metaWorkdays: number, startDate: string, endDate: string) {
    return Array.from(teamIds).reduce(
      (total, teamId) => total + calculateTeamMetaForWindow(teamId, startDate, endDate, metaWorkdays),
      0,
    );
  }

  function buildTeamRows(
    target: Map<string, TeamProductionAggregate>,
    metaWorkdays: number,
    standardMetaWorkdays: number,
    startDate: string,
    endDate: string,
  ) {
    const periodDates = Array.from(new Set([
      ...listBusinessDayIsoDates(startDate, endDate),
      ...Array.from(target.values()).flatMap((team) => Array.from(team.workedDates)),
    ]));

    return Array.from(target.values())
      .map((team) => {
        const metaValue = calculateTeamMetaForWindow(team.teamId, startDate, endDate, metaWorkdays);
        const standardMetaValue = calculateTeamMetaForWindow(team.teamId, startDate, endDate, standardMetaWorkdays);
        const workedMetaValue = calculateWorkedTeamMeta(team.teamId, team.workedDates);
        const foremanNames = new Set(team.foremanNames);
        const teamTypeNames = new Set<string>();
        for (const isoDate of periodDates) {
          foremanNames.add(resolveTeamForemanNameForDate(team.teamId, isoDate));
          teamTypeNames.add(resolveTeamTypeNameForDate(team.teamId, isoDate));
        }
        return {
          teamId: team.teamId,
          teamName: team.teamName,
          foremanNames: Array.from(foremanNames).filter(Boolean).sort((left, right) => left.localeCompare(right)),
          teamTypeNames: Array.from(teamTypeNames).filter(Boolean).sort((left, right) => left.localeCompare(right)),
          totalValue: team.totalValue,
          metaValue,
          standardMetaValue,
          workedMetaValue,
          projectCount: team.projectIds.size,
          projects: buildProjectProductionRows(team.projects),
          teamCount: 1,
          metaDays: metaWorkdays,
          standardMetaDays: standardMetaWorkdays,
          workedDays: team.workedDates.size,
          percentage: metaValue > 0 ? (team.totalValue / metaValue) * 100 : 0,
        };
      })
      .sort((left, right) => right.totalValue - left.totalValue);
  }

  function allocateForemanMetas(
    target: Map<string, ForemanAggregate>,
    teams: Map<string, TeamProductionAggregate>,
    metaWorkdays: number,
    standardMetaWorkdays: number,
    startDate: string,
    endDate: string,
  ) {
    for (const team of teams.values()) {
      const measuredDaysByForeman = new Map<string, number>();
      for (const [isoDate, foremanNames] of team.measuredForemanNamesByDate.entries()) {
        const measuredForemanNames = Array.from(foremanNames);
        if (!measuredForemanNames.length) continue;

        const measuredDayShare = 1 / measuredForemanNames.length;
        const teamTypeId = resolveTeamTypeForDate(team.teamId, isoDate);
        const dailyMeta = teamTypeId ? dailyMetaByTeamType.get(teamTypeId) ?? 0 : 0;
        for (const foremanName of measuredForemanNames) {
          const current = ensureForemanAggregate(target, foremanName);
          measuredDaysByForeman.set(foremanName, (measuredDaysByForeman.get(foremanName) ?? 0) + measuredDayShare);
          current.workedMetaValue += dailyMeta * measuredDayShare;
          current.workedDays += measuredDayShare;
          current.teamIds.add(team.teamId);
        }
      }

      const measuredDays = Array.from(measuredDaysByForeman.values()).reduce((sum, days) => sum + days, 0);
      if (measuredDays <= 0) continue;

      const teamMetaValue = calculateTeamMetaForWindow(team.teamId, startDate, endDate, metaWorkdays);
      const teamStandardMetaValue = calculateTeamMetaForWindow(team.teamId, startDate, endDate, standardMetaWorkdays);
      for (const [foremanName, foremanMeasuredDays] of measuredDaysByForeman.entries()) {
        const current = ensureForemanAggregate(target, foremanName);
        const foremanShare = foremanMeasuredDays / measuredDays;
        current.metaValue += teamMetaValue * foremanShare;
        current.standardMetaValue += teamStandardMetaValue * foremanShare;
        current.metaDays += metaWorkdays * foremanShare;
        current.standardMetaDays += standardMetaWorkdays * foremanShare;
        current.teamIds.add(team.teamId);
      }
    }
  }

  function buildForemanRows(
    target: Map<string, ForemanAggregate>,
    teams: Map<string, TeamProductionAggregate>,
    metaWorkdays: number,
    standardMetaWorkdays: number,
    startDate: string,
    endDate: string,
  ) {
    allocateForemanMetas(target, teams, metaWorkdays, standardMetaWorkdays, startDate, endDate);

    return Array.from(target.values())
      .map((foreman) => ({
        foremanName: foreman.foremanName,
        totalValue: foreman.totalValue,
        metaValue: foreman.metaValue,
        standardMetaValue: foreman.standardMetaValue,
        workedMetaValue: foreman.workedMetaValue,
        projectCount: foreman.projectIds.size,
        projects: buildProjectProductionRows(foreman.projects),
        teamCount: foreman.teamIds.size,
        metaDays: Number(foreman.metaDays.toFixed(2)),
        standardMetaDays: Number(foreman.standardMetaDays.toFixed(2)),
        workedDays: foreman.workedDays,
        percentage: foreman.metaValue > 0 ? (foreman.totalValue / foreman.metaValue) * 100 : 0,
      }))
      .sort((left, right) => right.totalValue - left.totalValue);
  }

  function buildSupervisorRows(
    target: Map<string, SupervisorAggregate>,
    metaWorkdays: number,
    totalRealized: number,
    startDate: string,
    endDate: string,
  ) {
    return Array.from(target.values())
      .map((supervisor) => {
        const productiveMetaValue = calculateSupervisorMeta(supervisor.productiveTeamIds, metaWorkdays, startDate, endDate);
        const potentialMetaValue = calculateSupervisorMeta(supervisor.potentialTeamIds, metaWorkdays, startDate, endDate);
        return {
          supervisorId: supervisor.supervisorId,
          supervisorName: supervisor.supervisorName,
          totalValue: supervisor.totalValue,
          orderCount: supervisor.orderCount,
          projectCount: supervisor.projectIds.size,
          projects: buildProjectProductionRows(supervisor.projects),
          productiveTeamCount: supervisor.productiveTeamIds.size,
          potentialTeamCount: supervisor.potentialTeamIds.size,
          productiveMetaValue,
          potentialMetaValue,
          productivePercentage: productiveMetaValue > 0 ? (supervisor.totalValue / productiveMetaValue) * 100 : 0,
          potentialPercentage: potentialMetaValue > 0 ? (supervisor.totalValue / potentialMetaValue) * 100 : 0,
          percentageOfTotal: totalRealized > 0 ? (supervisor.totalValue / totalRealized) * 100 : 0,
        };
      })
      .sort((left, right) => right.totalValue - left.totalValue);
  }

  const teamsProductionMap = createTeamProductionMap();
  const foremanMap = createForemanMap();
  const supervisorProductionMap = createSupervisorMap();

  for (const order of filteredOrders) {
    addCompletionTotals(cycleCompletionTotals, order, cycleOrderCompletionMap);
    addTeamProductionOrder(teamsProductionMap, order);
    addForemanOrder(foremanMap, order);
    addSupervisorOrder(supervisorProductionMap, order);
  }

  for (const order of periodFilteredOrders) {
    addCompletionTotals(periodCompletionTotals, order, periodOrderCompletionMap);
  }
  for (const order of periodFilteredMinimumBillingGuaranteeOrders) {
    addMinimumBillingGuaranteeTotal(periodMinimumBillingGuaranteeTotal, order);
  }

  const teamsProductionByWeek: Record<string, ReturnType<typeof buildTeamRows>> = {};
  const foremenByWeek: Record<string, ReturnType<typeof buildForemanRows>> = {};
  const supervisorsProductionByWeek: Record<string, ReturnType<typeof buildSupervisorRows>> = {};
  for (const week of cycleWeeks) {
    const weekOrders = filteredOrders.filter((order) => order.execution_date >= week.startDate && order.execution_date <= week.endDate);
    const weekTeamsProductionMap = createTeamProductionMap();
    const weekForemanMap = createForemanMap();
    const weekSupervisorMap = createSupervisorMap();
    for (const order of weekOrders) {
      addTeamProductionOrder(weekTeamsProductionMap, order);
      addForemanOrder(weekForemanMap, order);
      addSupervisorOrder(weekSupervisorMap, order);
    }
    const weekRealizedValue = weekOrders.reduce((sum, order) => sum + (valueByOrder.get(order.id) ?? 0), 0);
    teamsProductionByWeek[week.id] = buildTeamRows(weekTeamsProductionMap, week.workdays, week.workdays, week.startDate, week.endDate);
    foremenByWeek[week.id] = buildForemanRows(weekForemanMap, weekTeamsProductionMap, week.workdays, week.workdays, week.startDate, week.endDate);
    supervisorsProductionByWeek[week.id] = buildSupervisorRows(weekSupervisorMap, week.workdays, weekRealizedValue, week.startDate, week.endDate);
  }

  const teamsProductionRows = buildTeamRows(teamsProductionMap, workdays, defaultWorkdays, selectedCycle.cycleStart, selectedCycle.cycleEnd);
  const foremenRows = buildForemanRows(foremanMap, teamsProductionMap, workdays, defaultWorkdays, selectedCycle.cycleStart, selectedCycle.cycleEnd);
  const realizedValue = filteredOrders.reduce((sum, order) => sum + (valueByOrder.get(order.id) ?? 0), 0);
  const projectCount = new Set(filteredOrders.map((order) => order.project_id)).size;
  const averageTicketValue = projectCount > 0 ? realizedValue / projectCount : 0;
  const averageServiceTicketValue = filteredOrders.length > 0 ? realizedValue / filteredOrders.length : 0;
  const periodRealizedValue = periodFilteredOrders.reduce((sum, order) => sum + (valueByOrder.get(order.id) ?? 0), 0)
    + periodFilteredMinimumBillingGuaranteeOrders.reduce((sum, order) => sum + Number(order.minimum_billing_amount ?? 0), 0);
  const periodOrderCount = periodFilteredOrders.length + periodFilteredMinimumBillingGuaranteeOrders.length;
  const periodProjectCount = new Set([
    ...periodFilteredOrders.map((order) => order.project_id),
    ...periodFilteredMinimumBillingGuaranteeOrders.map((order) => order.project_id),
  ]).size;
  const periodAverageTicketValue = periodProjectCount > 0 ? periodRealizedValue / periodProjectCount : 0;
  const periodAverageServiceTicketValue = periodOrderCount > 0 ? periodRealizedValue / periodOrderCount : 0;
  const supervisorsProductionRows = buildSupervisorRows(supervisorProductionMap, workdays, realizedValue, selectedCycle.cycleStart, selectedCycle.cycleEnd);
  const percentage = cycleMetaValue > 0 ? (realizedValue / cycleMetaValue) * 100 : 0;
  const executedWorkdays = new Set(filteredOrders.map((order) => normalizeIsoDate(order.execution_date)).filter(Boolean)).size;
  const averageDailyValue = executedWorkdays > 0 ? realizedValue / executedWorkdays : 0;
  const workedObjectiveValue = teamsProductionRows.reduce((sum, team) => sum + team.workedMetaValue, 0);
  const workedDays = teamsProductionRows.length > 0
    ? Math.round(teamsProductionRows.reduce((sum, team) => sum + team.workedDays, 0) / teamsProductionRows.length)
    : 0;
  const objectiveDailyValue = executedWorkdays > 0 ? workedObjectiveValue / executedWorkdays : 0;
  const forecastValue = averageDailyValue * workdays;
  const forecastPercentage = cycleMetaValue > 0 ? (forecastValue / cycleMetaValue) * 100 : 0;
  const forecastDifference = forecastValue - cycleMetaValue;

  return NextResponse.json({
    cycles,
    periods,
    selectedPeriod: selectedCycle.cycleEnd.slice(0, 7),
    startDate: startDateFilter,
    endDate: endDateFilter,
    selectedCycleStart: selectedCycle.cycleStart,
    filters: {
      projects: projectOptions,
      teams: teamOptions,
      foremen: foremanOptions.map((name) => ({ id: name, label: name })),
      supervisors: supervisorOptions,
    },
    summary: {
      orderCount: filteredOrders.length,
      realizedValue,
      metaValue: cycleMetaValue,
      percentage,
      workdays,
      defaultWorkdays,
      workedDays,
      executedWorkdays,
      averageDailyValue,
      workedObjectiveValue,
      objectiveDailyValue,
      targetDailyValue,
      forecastValue,
      forecastPercentage,
      forecastDifference,
      completedValue: cycleCompletionTotals.get("CONCLUIDO")?.value ?? 0,
      partialValue: cycleCompletionTotals.get("PARCIAL")?.value ?? 0,
      pendingValue: cycleCompletionTotals.get("PENDENCIA")?.value ?? 0,
      noStatusValue: cycleCompletionTotals.get("NAO_INFORMADO")?.value ?? 0,
      projectCount,
      averageTicketValue,
      averageServiceTicketValue,
    },
    completionChart: buildCompletionChart(periodCompletionTotals, periodMinimumBillingGuaranteeTotal),
    cycleCompletionChart: buildCompletionChart(cycleCompletionTotals),
    periodCompletionChart: buildCompletionChart(periodCompletionTotals, periodMinimumBillingGuaranteeTotal),
    periodSummary: {
      realizedValue: periodRealizedValue,
      orderCount: periodOrderCount,
      projectCount: periodProjectCount,
      averageTicketValue: periodAverageTicketValue,
      averageServiceTicketValue: periodAverageServiceTicketValue,
    },
    cycleComparison: {
      label: selectedCycle.label,
      value: realizedValue,
      meta: cycleMetaValue,
      standardMeta: standardCycleMetaValue,
      workedMeta: workedObjectiveValue,
      workdays,
      defaultWorkdays,
      workedDays,
      orderCount: filteredOrders.length,
      projectCount,
      averageTicketValue,
      averageServiceTicketValue,
      executedWorkdays,
      averageDailyValue,
      workedObjectiveValue,
      objectiveDailyValue,
      targetDailyValue,
      forecastValue,
      forecastPercentage,
      forecastDifference,
      percentage,
    },
    cycleWeeks,
    teamsProduction: teamsProductionRows,
    teamsProductionByWeek,
    foremen: foremenRows,
    foremenByWeek,
    supervisorsProduction: supervisorsProductionRows,
    supervisorsProductionByWeek,
  });
}
