import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";

type MeasurementOrderRow = {
  id: string;
  project_id: string;
  team_id: string;
  execution_date: string;
  measurement_kind: string;
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
};

type TeamRow = {
  id: string;
  name: string;
  team_type_id: string | null;
  foreman_person_id: string | null;
  supervisor_person_id: string | null;
  ativo?: boolean | null;
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
  worked_days: number | string | null;
};

type CycleTargetItemRow = {
  team_type_id: string;
  daily_value: number | string;
  cycle_goal: number | string;
  standard_cycle_goal: number | string | null;
  worked_cycle_goal: number | string | null;
};

type ProgrammingCompletionRow = {
  project_id: string;
  work_completion_status: string | null;
  updated_at: string;
};

type CycleWeek = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  workdays: number;
};

type ForemanAggregate = {
  foremanName: string;
  totalValue: number;
  metaValue: number;
  standardMetaValue: number;
  workedMetaValue: number;
  teamIds: Set<string>;
  daysByTeam: Map<string, Set<string>>;
};

type SupervisorAggregate = {
  supervisorId: string | null;
  supervisorName: string;
  totalValue: number;
  orderCount: number;
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
  if (token === "PARCIAL" || token.startsWith("PARCIAL")) return "PARCIAL";
  return "NAO_INFORMADO";
}

function completionRank(value: string) {
  if (value === "CONCLUIDO") return 2;
  if (value === "PARCIAL") return 1;
  return 0;
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

async function fetchProjectIsTestMap(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  projectIds: string[];
}) {
  const projectIds = Array.from(new Set(params.projectIds.filter(Boolean)));
  if (!projectIds.length) return new Map<string, boolean>();

  const { data, error } = await params.supabase
    .from("project")
    .select("id, is_test")
    .eq("tenant_id", params.tenantId)
    .in("id", projectIds)
    .returns<ProjectTestRow[]>();

  if (error) return new Map<string, boolean>();
  return new Map((data ?? []).map((item) => [item.id, Boolean(item.is_test)]));
}

async function fetchProjectCompletionMap(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  projectIds: string[];
}) {
  const projectIds = Array.from(new Set(params.projectIds.filter(Boolean)));
  if (!projectIds.length) return new Map<string, string>();

  const { data, error } = await params.supabase
    .from("project_programming")
    .select("project_id, work_completion_status, updated_at")
    .eq("tenant_id", params.tenantId)
    .in("project_id", projectIds)
    .not("work_completion_status", "is", null)
    .returns<ProgrammingCompletionRow[]>();

  if (error) return new Map<string, string>();

  const result = new Map<string, { status: string; rank: number; updatedAt: string }>();
  for (const row of data ?? []) {
    const status = normalizeCompletionStatus(row.work_completion_status);
    const rank = completionRank(status);
    if (!rank) continue;
    const current = result.get(row.project_id);
    if (!current || rank > current.rank || (rank === current.rank && row.updated_at > current.updatedAt)) {
      result.set(row.project_id, { status, rank, updatedAt: row.updated_at });
    }
  }

  return new Map(Array.from(result.entries()).map(([projectId, item]) => [projectId, item.status]));
}

export async function GET(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para carregar dashboard de medicao.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
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
    .select("id, project_id, team_id, execution_date, measurement_kind, status, project_code_snapshot, team_name_snapshot, foreman_name_snapshot, programming_completion_status_snapshot")
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

  const projectIsTestMap = await fetchProjectIsTestMap({
    supabase: resolution.supabase,
    tenantId,
    projectIds: (orders ?? []).map((item) => item.project_id),
  });

  const validOrders = (orders ?? [])
    .filter((order) => normalizeIsoDate(order.execution_date))
    .filter((order) => !projectIsTestMap.get(order.project_id));

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
      cycleComparison: null,
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

  const projectCompletionMap = await fetchProjectCompletionMap({
    supabase: resolution.supabase,
    tenantId,
    projectIds: [...cycleOrders, ...periodOrders].map((order) => order.project_id),
  });

  const orderCompletionMap = new Map<string, string>();
  for (const order of [...cycleOrders, ...periodOrders]) {
    const snapshot = normalizeCompletionStatus(order.programming_completion_status_snapshot);
    orderCompletionMap.set(order.id, projectCompletionMap.get(order.project_id) ?? snapshot);
  }

  const allVisibleTeamIds = Array.from(new Set([...cycleOrders, ...periodOrders].map((order) => order.team_id).filter(Boolean)));
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

  const teamMap = new Map((teamsResult.data ?? []).map((team) => [team.id, team]));
  const activeTeamMap = new Map((activeTeamsResult.data ?? []).map((team) => [team.id, team]));
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
    if ((completionFilter === "CONCLUIDO" || completionFilter === "PARCIAL") && orderCompletionMap.get(order.id) !== completionFilter) return false;
    return true;
  });

  const periodFilteredOrders = periodOrders.filter((order) => {
    if (projectIdFilter && order.project_id !== projectIdFilter) return false;
    if (projectQueryFilter && !normalizeText(order.project_code_snapshot).toLowerCase().includes(projectQueryFilter)) return false;
    if (teamIdFilter && order.team_id !== teamIdFilter) return false;
    if (foremanFilter && normalizeText(order.foreman_name_snapshot) !== foremanFilter) return false;
    if (supervisorIdFilter && teamMap.get(order.team_id)?.supervisor_person_id !== supervisorIdFilter) return false;
    if ((completionFilter === "CONCLUIDO" || completionFilter === "PARCIAL") && orderCompletionMap.get(order.id) !== completionFilter) return false;
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
    .select("id, cycle_start, cycle_end, workdays, default_workdays, worked_days")
    .eq("tenant_id", tenantId)
    .eq("cycle_start", selectedCycle.cycleStart)
    .maybeSingle<CycleWorkdaysRow>();

  const selectedCycleRecord = selectedCycleRecordResult.data ?? null;
  const targetItemsResult = selectedCycleRecord
    ? await resolution.supabase
        .from("measurement_cycle_target_items")
        .select("team_type_id, daily_value, cycle_goal, standard_cycle_goal, worked_cycle_goal")
        .eq("tenant_id", tenantId)
        .eq("cycle_id", selectedCycleRecord.id)
        .returns<CycleTargetItemRow[]>()
    : { data: [] as CycleTargetItemRow[], error: null };

  if (targetItemsResult.error) {
    return NextResponse.json({ message: "Falha ao carregar metas do ciclo." }, { status: 500 });
  }

  const dailyMetaByTeamType = new Map((targetItemsResult.data ?? []).map((item) => [item.team_type_id, Number(item.daily_value ?? 0)]));
  const cycleMetaValue = (targetItemsResult.data ?? []).reduce((sum, item) => sum + Number(item.cycle_goal ?? 0), 0);
  const standardCycleMetaValue = (targetItemsResult.data ?? []).reduce((sum, item) => sum + Number(item.standard_cycle_goal ?? 0), 0);
  const workedCycleMetaValue = (targetItemsResult.data ?? []).reduce((sum, item) => sum + Number(item.worked_cycle_goal ?? 0), 0);
  const workdays = Number(selectedCycleRecord?.workdays ?? 0);
  const defaultWorkdays = Number(selectedCycleRecord?.default_workdays ?? selectedCycleRecord?.workdays ?? 0);
  const workedDays = Math.round(Number(selectedCycleRecord?.worked_days ?? 0));

  function createCompletionTotals() {
    return new Map<string, { value: number; orders: number }>([
      ["CONCLUIDO", { value: 0, orders: 0 }],
      ["PARCIAL", { value: 0, orders: 0 }],
      ["NAO_INFORMADO", { value: 0, orders: 0 }],
    ]);
  }

  function addCompletionTotals(target: Map<string, { value: number; orders: number }>, order: MeasurementOrderRow) {
    const totalValue = valueByOrder.get(order.id) ?? 0;
    const completion = orderCompletionMap.get(order.id) ?? "NAO_INFORMADO";
    const completionTotal = target.get(completion) ?? { value: 0, orders: 0 };
    completionTotal.value += totalValue;
    completionTotal.orders += 1;
    target.set(completion, completionTotal);
  }

  function buildCompletionChart(target: Map<string, { value: number; orders: number }>) {
    const totalValue = Array.from(target.values()).reduce((sum, item) => sum + item.value, 0);
    return [
      {
        label: "Concluidos",
        value: target.get("CONCLUIDO")?.value ?? 0,
        orders: target.get("CONCLUIDO")?.orders ?? 0,
        percentage: totalValue > 0 ? ((target.get("CONCLUIDO")?.value ?? 0) / totalValue) * 100 : 0,
      },
      {
        label: "Parciais",
        value: target.get("PARCIAL")?.value ?? 0,
        orders: target.get("PARCIAL")?.orders ?? 0,
        percentage: totalValue > 0 ? ((target.get("PARCIAL")?.value ?? 0) / totalValue) * 100 : 0,
      },
    ];
  }

  const cycleCompletionTotals = createCompletionTotals();
  const periodCompletionTotals = createCompletionTotals();

  const potentialSupervisorTeams = (activeTeamsResult.data ?? []).filter((team) => {
    if (!team.supervisor_person_id) return false;
    if (teamIdFilter && team.id !== teamIdFilter) return false;
    if (supervisorIdFilter && team.supervisor_person_id !== supervisorIdFilter) return false;
    return true;
  });

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
        productiveTeamIds: new Set<string>(),
        potentialTeamIds: new Set<string>(),
      };
      currentSupervisor.potentialTeamIds.add(team.id);
      map.set(supervisorKey, currentSupervisor);
    }
    return map;
  }

  function addForemanOrder(target: Map<string, ForemanAggregate>, order: MeasurementOrderRow) {
    const totalValue = valueByOrder.get(order.id) ?? 0;
    const team = teamMap.get(order.team_id);
    const foremanName = normalizeText(order.foreman_name_snapshot)
      || (team?.foreman_person_id ? personMap.get(team.foreman_person_id) : "")
      || "Nao identificado";
    const current = target.get(foremanName) ?? {
      foremanName,
      totalValue: 0,
      metaValue: 0,
      standardMetaValue: 0,
      workedMetaValue: 0,
      teamIds: new Set<string>(),
      daysByTeam: new Map<string, Set<string>>(),
    };
    current.totalValue += totalValue;
    current.teamIds.add(order.team_id);
    const dates = current.daysByTeam.get(order.team_id) ?? new Set<string>();
    dates.add(order.execution_date);
    current.daysByTeam.set(order.team_id, dates);
    target.set(foremanName, current);
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
      productiveTeamIds: new Set<string>(),
      potentialTeamIds: new Set<string>(),
    };
    currentSupervisor.totalValue += totalValue;
    currentSupervisor.orderCount += 1;
    currentSupervisor.productiveTeamIds.add(order.team_id);
    if (activeTeamMap.has(order.team_id)) {
      currentSupervisor.potentialTeamIds.add(order.team_id);
    }
    target.set(supervisorKey, currentSupervisor);
  }

  function calculateSupervisorMeta(teamIds: Set<string>, metaWorkdays: number) {
    let total = 0;
    for (const teamId of teamIds) {
      const team = activeTeamMap.get(teamId) ?? teamMap.get(teamId);
      if (!team?.team_type_id) continue;
      total += (dailyMetaByTeamType.get(team.team_type_id) ?? 0) * metaWorkdays;
    }
    return total;
  }

  function buildForemanRows(target: Map<string, ForemanAggregate>, metaWorkdays: number, standardMetaWorkdays: number) {
    return Array.from(target.values())
      .map((foreman) => {
        let metaValue = 0;
        let standardMetaValue = 0;
        let workedMetaValue = 0;
        const dayCounts = Array.from(foreman.daysByTeam.values()).map((dates) => dates.size);
        const rowWorkedDays = dayCounts.length ? Math.round(dayCounts.reduce((sum, value) => sum + value, 0) / dayCounts.length) : 0;
        for (const teamId of foreman.teamIds) {
          const team = teamMap.get(teamId);
          if (team?.team_type_id) {
            const dailyMeta = dailyMetaByTeamType.get(team.team_type_id) ?? 0;
            metaValue += dailyMeta * metaWorkdays;
            standardMetaValue += dailyMeta * standardMetaWorkdays;
            workedMetaValue += dailyMeta * rowWorkedDays;
          }
        }
        return {
          foremanName: foreman.foremanName,
          totalValue: foreman.totalValue,
          metaValue,
          standardMetaValue,
          workedMetaValue,
          teamCount: foreman.teamIds.size,
          metaDays: metaWorkdays,
          standardMetaDays: standardMetaWorkdays,
          workedDays: rowWorkedDays,
          percentage: metaValue > 0 ? (foreman.totalValue / metaValue) * 100 : 0,
        };
      })
      .sort((left, right) => right.totalValue - left.totalValue);
  }

  function buildSupervisorRows(target: Map<string, SupervisorAggregate>, metaWorkdays: number, totalRealized: number) {
    return Array.from(target.values())
      .map((supervisor) => {
        const productiveMetaValue = calculateSupervisorMeta(supervisor.productiveTeamIds, metaWorkdays);
        const potentialMetaValue = calculateSupervisorMeta(supervisor.potentialTeamIds, metaWorkdays);
        return {
          supervisorId: supervisor.supervisorId,
          supervisorName: supervisor.supervisorName,
          totalValue: supervisor.totalValue,
          orderCount: supervisor.orderCount,
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

  const foremanMap = createForemanMap();
  const supervisorProductionMap = createSupervisorMap();

  for (const order of filteredOrders) {
    addCompletionTotals(cycleCompletionTotals, order);
    addForemanOrder(foremanMap, order);
    addSupervisorOrder(supervisorProductionMap, order);
  }

  for (const order of periodFilteredOrders) {
    addCompletionTotals(periodCompletionTotals, order);
  }

  const foremenByWeek: Record<string, ReturnType<typeof buildForemanRows>> = {};
  const supervisorsProductionByWeek: Record<string, ReturnType<typeof buildSupervisorRows>> = {};
  for (const week of cycleWeeks) {
    const weekOrders = filteredOrders.filter((order) => order.execution_date >= week.startDate && order.execution_date <= week.endDate);
    const weekForemanMap = createForemanMap();
    const weekSupervisorMap = createSupervisorMap();
    for (const order of weekOrders) {
      addForemanOrder(weekForemanMap, order);
      addSupervisorOrder(weekSupervisorMap, order);
    }
    const weekRealizedValue = weekOrders.reduce((sum, order) => sum + (valueByOrder.get(order.id) ?? 0), 0);
    foremenByWeek[week.id] = buildForemanRows(weekForemanMap, week.workdays, week.workdays);
    supervisorsProductionByWeek[week.id] = buildSupervisorRows(weekSupervisorMap, week.workdays, weekRealizedValue);
  }

  const foremenRows = buildForemanRows(foremanMap, workdays, defaultWorkdays);
  const realizedValue = filteredOrders.reduce((sum, order) => sum + (valueByOrder.get(order.id) ?? 0), 0);
  const supervisorsProductionRows = buildSupervisorRows(supervisorProductionMap, workdays, realizedValue);
  const percentage = cycleMetaValue > 0 ? (realizedValue / cycleMetaValue) * 100 : 0;
  const executedWorkdays = new Set(filteredOrders.map((order) => normalizeIsoDate(order.execution_date)).filter(Boolean)).size;
  const averageDailyValue = executedWorkdays > 0 ? realizedValue / executedWorkdays : 0;
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
      forecastValue,
      forecastPercentage,
      forecastDifference,
      completedValue: cycleCompletionTotals.get("CONCLUIDO")?.value ?? 0,
      partialValue: cycleCompletionTotals.get("PARCIAL")?.value ?? 0,
      noStatusValue: cycleCompletionTotals.get("NAO_INFORMADO")?.value ?? 0,
    },
    completionChart: buildCompletionChart(periodCompletionTotals),
    cycleCompletionChart: buildCompletionChart(cycleCompletionTotals),
    periodCompletionChart: buildCompletionChart(periodCompletionTotals),
    cycleComparison: {
      label: selectedCycle.label,
      value: realizedValue,
      meta: cycleMetaValue,
      standardMeta: standardCycleMetaValue,
      workedMeta: workedCycleMetaValue,
      workdays,
      defaultWorkdays,
      workedDays,
      executedWorkdays,
      averageDailyValue,
      forecastValue,
      forecastPercentage,
      forecastDifference,
      percentage,
    },
    cycleWeeks,
    foremen: foremenRows,
    foremenByWeek,
    supervisorsProduction: supervisorsProductionRows,
    supervisorsProductionByWeek,
  });
}
