import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";
import { requirePageAction } from "@/lib/server/pageAuthorization";

const DASHBOARD_PORTFOLIO_PAGE_KEY = "dashboard-carteira-operacional";
const QUERY_PAGE_SIZE = 1000;
const FILTER_CHUNK_SIZE = 100;
const ORDER_ITEM_CHUNK_SIZE = 200;

type ProjectForecastRow = {
  project_id: string;
};

type ProjectRow = {
  id: string;
  sob: string | null;
  service_center: string | null;
  service_center_text: string | null;
  estimated_value: number | string | null;
  is_active: boolean | null;
  is_test?: boolean | null;
  is_withdrawn?: boolean | null;
  is_third_party?: boolean | null;
};

type MeasurementOrderRow = {
  id: string;
  project_id: string;
  team_id: string | null;
  execution_date: string;
  status: string;
  project_code_snapshot: string | null;
  programming_completion_status_snapshot: string | null;
};

type MeasurementOrderItemRow = {
  measurement_order_id: string;
  total_value: number | string | null;
};

type TeamRow = {
  id: string;
  supervisor_person_id: string | null;
};

type TeamSupervisorHistoryRow = {
  team_id: string;
  supervisor_person_id: string | null;
  supervisor_name_snapshot: string | null;
  valid_from: string;
  valid_to: string | null;
};

type PersonRow = {
  id: string;
  nome: string | null;
};

type ProgrammingCompletionRow = {
  project_id: string;
  execution_date: string;
  status: string;
  work_completion_status: string | null;
  updated_at: string;
};

type Cycle = {
  cycleStart: string;
  cycleEnd: string;
  label: string;
};

type PortfolioScope = "ACTIVE" | "WITHDRAWN" | "ALL";

type ProjectPortfolioRow = {
  projectId: string;
  projectCode: string;
  serviceCenterId: string | null;
  serviceCenter: string;
  supervisorId: string | null;
  supervisorName: string;
  status: "CONCLUIDO" | "PENDENTE";
  origin: "NOVO" | "HERDADO" | "SEM_PRODUCAO";
  portfolioStatus: "ATIVA" | "RETIRADA";
  isWithdrawn: boolean;
  firstActivityDate: string | null;
  lastActivityDate: string | null;
  firstActivityLabel: string;
  lastActivityLabel: string;
  lastProductionWeek: number | null;
  daysWithoutProduction: number | null;
  workedCycleCount: number;
  cyclesWithoutProduction: number;
  estimatedValue: number;
  valueBeforeCycle: number;
  valueInCycle: number;
  accumulatedValue: number;
  remainingPotential: number;
  exploredPercentage: number;
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
  if (token === "PENDENCIA" || token.startsWith("PENDEN")) return "PENDENTE";
  if (token === "BENEFICIO_ATINGIDO" || token.endsWith("_BENEFICIO_ATINGIDO") || token.endsWith("_BENFICIO_ATINGIDO")) return "PENDENTE";
  if (token === "ANTECIPADO" || token.startsWith("ANTECIP")) return "PENDENTE";
  if (token === "PARCIAL" || token.startsWith("PARCIAL")) return "PENDENTE";
  return "PENDENTE";
}

function normalizeOptionalCompletionStatus(value: unknown) {
  return normalizeText(value) ? normalizeCompletionStatus(value) : null;
}

function normalizePortfolioScope(value: unknown): PortfolioScope {
  const token = normalizeText(value).toUpperCase();
  if (token === "WITHDRAWN" || token === "RETIRADA" || token === "RETIRADOS") return "WITHDRAWN";
  if (token === "ALL" || token === "TODOS") return "ALL";
  return "ACTIVE";
}

function numberValue(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
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

function diffDays(left: string, right: string) {
  const milliseconds = parseIsoDate(right).getTime() - parseIsoDate(left).getTime();
  return Math.max(0, Math.floor(milliseconds / 86_400_000));
}

function diffMonths(leftCycleStart: string, rightCycleStart: string) {
  const left = parseIsoDate(leftCycleStart);
  const right = parseIsoDate(rightCycleStart);
  return Math.max(
    0,
    (right.getUTCFullYear() - left.getUTCFullYear()) * 12
      + (right.getUTCMonth() - left.getUTCMonth()),
  );
}

function resolveCycleStart(reference: Date) {
  const year = reference.getUTCFullYear();
  const monthIndex = reference.getUTCMonth();
  const day = reference.getUTCDate();
  return day >= 21 ? createUtcDate(year, monthIndex, 21) : createUtcDate(year, monthIndex - 1, 21);
}

function buildCycleFromDate(value: string) {
  const reference = parseIsoDate(value);
  const start = resolveCycleStart(reference);
  const end = addMonths(start, 1);
  end.setUTCDate(20);
  return {
    cycleStart: toIsoDate(start),
    cycleEnd: toIsoDate(end),
    label: formatCycleLabel(start, end),
  };
}

function buildCurrentCycle() {
  return buildCycleFromDate(new Date().toISOString().slice(0, 10));
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

function formatDatePtBr(value: string | null) {
  if (!value) return "-";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function buildCycleWeeks(cycleStart: string, cycleEnd: string) {
  const weeks: Array<{ id: string; label: string; startDate: string; endDate: string }> = [];
  let start = parseIsoDate(cycleStart);
  const endDate = parseIsoDate(cycleEnd);
  let index = 1;

  while (start <= endDate) {
    const end = addDays(start, 6) > endDate ? endDate : addDays(start, 6);
    weeks.push({
      id: `week-${index}`,
      label: `${index} semana`,
      startDate: toIsoDate(start),
      endDate: toIsoDate(end),
    });
    start = addDays(end, 1);
    index += 1;
  }

  return weeks;
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function loadPaged<T>(builder: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += QUERY_PAGE_SIZE) {
    const { data, error } = await builder(from, from + QUERY_PAGE_SIZE - 1);
    if (error) {
      return { data: [] as T[], error };
    }

    rows.push(...(data ?? []));
    if ((data ?? []).length < QUERY_PAGE_SIZE) break;
  }

  return { data: rows, error: null };
}

async function loadForecastProjectIds(supabase: AuthenticatedAppUserContext["supabase"], tenantId: string) {
  const result = await loadPaged<ProjectForecastRow>((from, to) =>
    supabase
      .from("project_activity_forecast")
      .select("project_id")
      .eq("tenant_id", tenantId)
      .order("project_id", { ascending: true })
      .range(from, to)
      .returns<ProjectForecastRow[]>(),
  );

  if (result.error) return { projectIds: [] as string[], error: result.error };
  return {
    projectIds: Array.from(new Set(result.data.map((item) => normalizeUuid(item.project_id)).filter((id): id is string => Boolean(id)))),
    error: null,
  };
}

async function loadProjects(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  projectIds: string[];
}) {
  const rows: ProjectRow[] = [];
  for (const projectIdChunk of chunk(params.projectIds, FILTER_CHUNK_SIZE)) {
    const { data, error } = await params.supabase
      .from("project_with_labels")
      .select("id, sob, service_center, service_center_text, estimated_value, is_active, is_test, is_withdrawn, is_third_party")
      .eq("tenant_id", params.tenantId)
      .in("id", projectIdChunk)
      .returns<ProjectRow[]>();

    if (error) return { data: [] as ProjectRow[], error };
    rows.push(...(data ?? []));
  }

  return { data: rows, error: null };
}

async function loadMeasurementOrders(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  projectIds: string[];
}) {
  const rows: MeasurementOrderRow[] = [];
  for (const projectIdChunk of chunk(params.projectIds, FILTER_CHUNK_SIZE)) {
    const result = await loadPaged<MeasurementOrderRow>((from, to) =>
      params.supabase
        .from("project_measurement_orders")
        .select("id, project_id, team_id, execution_date, status, project_code_snapshot, programming_completion_status_snapshot")
        .eq("tenant_id", params.tenantId)
        .eq("is_active", true)
        .eq("measurement_kind", "COM_PRODUCAO")
        .neq("status", "CANCELADA")
        .in("project_id", projectIdChunk)
        .order("execution_date", { ascending: true })
        .range(from, to)
        .returns<MeasurementOrderRow[]>(),
    );

    if (result.error) return { data: [] as MeasurementOrderRow[], error: result.error };
    rows.push(...result.data);
  }

  return { data: rows, error: null };
}

async function loadMeasurementItemValues(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  orderIds: string[];
}) {
  const values = new Map<string, number>();
  for (const orderIdChunk of chunk(params.orderIds, ORDER_ITEM_CHUNK_SIZE)) {
    const { data, error } = await params.supabase
      .from("project_measurement_order_items")
      .select("measurement_order_id, total_value")
      .eq("tenant_id", params.tenantId)
      .eq("is_active", true)
      .in("measurement_order_id", orderIdChunk)
      .returns<MeasurementOrderItemRow[]>();

    if (error) return { values, error };
    for (const item of data ?? []) {
      values.set(item.measurement_order_id, (values.get(item.measurement_order_id) ?? 0) + numberValue(item.total_value));
    }
  }

  return { values, error: null };
}

async function loadTeamSupervisors(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  teamIds: string[];
}) {
  const teamIds = Array.from(new Set(params.teamIds.filter(Boolean)));
  if (!teamIds.length) {
    return {
      teams: [] as TeamRow[],
      history: [] as TeamSupervisorHistoryRow[],
      people: [] as PersonRow[],
      error: null,
    };
  }

  const [teamsResult, historyResult] = await Promise.all([
    params.supabase
      .from("teams")
      .select("id, supervisor_person_id")
      .eq("tenant_id", params.tenantId)
      .in("id", teamIds)
      .returns<TeamRow[]>(),
    params.supabase
      .from("team_supervisor_history")
      .select("team_id, supervisor_person_id, supervisor_name_snapshot, valid_from, valid_to")
      .eq("tenant_id", params.tenantId)
      .in("team_id", teamIds)
      .returns<TeamSupervisorHistoryRow[]>(),
  ]);

  if (teamsResult.error) return { teams: [], history: [], people: [], error: teamsResult.error };
  if (historyResult.error) return { teams: [], history: [], people: [], error: historyResult.error };

  const personIds = Array.from(
    new Set([
      ...(teamsResult.data ?? []).map((team) => team.supervisor_person_id),
      ...(historyResult.data ?? []).map((entry) => entry.supervisor_person_id),
    ].filter((id): id is string => Boolean(id))),
  );
  const peopleResult = personIds.length
    ? await params.supabase
        .from("people")
        .select("id, nome")
        .eq("tenant_id", params.tenantId)
        .in("id", personIds)
        .returns<PersonRow[]>()
    : { data: [] as PersonRow[], error: null };

  if (peopleResult.error) return { teams: [], history: [], people: [], error: peopleResult.error };

  return {
    teams: teamsResult.data ?? [],
    history: historyResult.data ?? [],
    people: peopleResult.data ?? [],
    error: null,
  };
}

async function loadCompletionRows(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  projectIds: string[];
  endDate: string;
}) {
  const rows: ProgrammingCompletionRow[] = [];
  for (const projectIdChunk of chunk(params.projectIds, FILTER_CHUNK_SIZE)) {
    const { data, error } = await params.supabase
      .from("project_programming")
      .select("project_id, execution_date, status, work_completion_status, updated_at")
      .eq("tenant_id", params.tenantId)
      .in("project_id", projectIdChunk)
      .lte("execution_date", params.endDate)
      .neq("status", "CANCELADA")
      .not("work_completion_status", "is", null)
      .returns<ProgrammingCompletionRow[]>();

    if (error) return { data: [] as ProgrammingCompletionRow[], error };
    rows.push(...(data ?? []));
  }

  return { data: rows, error: null };
}

function resolveReferenceDate(cycleEnd: string) {
  const today = new Date().toISOString().slice(0, 10);
  return today < cycleEnd ? today : cycleEnd;
}

function buildCycles(orders: MeasurementOrderRow[], requestedCycleStart: string | null) {
  const cycleMap = new Map<string, Cycle>();
  for (const order of orders) {
    const date = normalizeIsoDate(order.execution_date);
    if (!date) continue;
    const cycle = buildCycleFromDate(date);
    cycleMap.set(cycle.cycleStart, cycle);
  }

  if (requestedCycleStart && !cycleMap.has(requestedCycleStart)) {
    cycleMap.set(requestedCycleStart, buildCycleFromDate(requestedCycleStart));
  }

  if (cycleMap.size === 0) {
    const currentCycle = buildCurrentCycle();
    cycleMap.set(currentCycle.cycleStart, currentCycle);
  }

  return Array.from(cycleMap.values()).sort((left, right) => right.cycleStart.localeCompare(left.cycleStart));
}

function buildSupervisorResolver(params: {
  teams: TeamRow[];
  history: TeamSupervisorHistoryRow[];
  people: PersonRow[];
}) {
  const teamMap = new Map(params.teams.map((team) => [team.id, team]));
  const personMap = new Map(params.people.map((person) => [person.id, normalizeText(person.nome)]));
  const historyByTeam = new Map<string, TeamSupervisorHistoryRow[]>();
  for (const entry of params.history) {
    const current = historyByTeam.get(entry.team_id) ?? [];
    current.push(entry);
    historyByTeam.set(entry.team_id, current);
  }
  for (const entries of historyByTeam.values()) {
    entries.sort((left, right) => right.valid_from.localeCompare(left.valid_from));
  }

  return (teamId: string | null, date: string | null) => {
    if (!teamId) return { supervisorId: null, supervisorName: "Sem supervisor" };

    if (date) {
      const history = historyByTeam.get(teamId) ?? [];
      const effective = history.find((entry) => entry.valid_from <= date && (!entry.valid_to || entry.valid_to >= date));
      if (effective) {
        const supervisorId = effective.supervisor_person_id ?? null;
        return {
          supervisorId,
          supervisorName: supervisorId
            ? (personMap.get(supervisorId) || normalizeText(effective.supervisor_name_snapshot) || "Supervisor nao identificado")
            : "Sem supervisor",
        };
      }
    }

    const supervisorId = teamMap.get(teamId)?.supervisor_person_id ?? null;
    return {
      supervisorId,
      supervisorName: supervisorId ? (personMap.get(supervisorId) || "Supervisor nao identificado") : "Sem supervisor",
    };
  };
}

export async function handleDashboardPortfolioGet(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para carregar Dashboard Carteira Operacional.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const authorization = await requirePageAction({
    context: resolution,
    pageKey: DASHBOARD_PORTFOLIO_PAGE_KEY,
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
  const cycleMode = normalizeText(request.nextUrl.searchParams.get("cycleStart")).toUpperCase();
  const isAllCycles = cycleMode === "ALL";
  const portfolioScope = normalizePortfolioScope(request.nextUrl.searchParams.get("portfolioScope"));
  const projectQuery = normalizeText(request.nextUrl.searchParams.get("project")).toLowerCase();
  const serviceCenterIdFilter = normalizeUuid(request.nextUrl.searchParams.get("serviceCenterId"));
  const supervisorIdFilter = normalizeUuid(request.nextUrl.searchParams.get("supervisorId"));

  const forecastProjectIdsResult = await loadForecastProjectIds(resolution.supabase, tenantId);
  if (forecastProjectIdsResult.error) {
    return NextResponse.json({ message: "Falha ao carregar projetos com atividades previstas." }, { status: 500 });
  }

  const projectsResult = await loadProjects({
    supabase: resolution.supabase,
    tenantId,
    projectIds: forecastProjectIdsResult.projectIds,
  });
  if (projectsResult.error) {
    return NextResponse.json({ message: "Falha ao carregar carteira de projetos." }, { status: 500 });
  }

  const baseProjects = (projectsResult.data ?? [])
    .filter((project) => project.is_active === true)
    .filter((project) => !project.is_test && !project.is_third_party);
  const eligibleProjects = baseProjects
    .filter((project) => {
      if (portfolioScope === "WITHDRAWN") return project.is_withdrawn === true;
      if (portfolioScope === "ALL") return true;
      return project.is_withdrawn !== true;
    });
  const baseProjectIds = baseProjects.map((project) => project.id);
  const eligibleProjectIds = eligibleProjects.map((project) => project.id);
  const eligibleProjectIdSet = new Set(eligibleProjectIds);

  const measurementOrdersResult = await loadMeasurementOrders({
    supabase: resolution.supabase,
    tenantId,
    projectIds: baseProjectIds,
  });
  if (measurementOrdersResult.error) {
    return NextResponse.json({ message: "Falha ao carregar medicoes da carteira." }, { status: 500 });
  }

  const baseOrders = measurementOrdersResult.data.filter((order) => normalizeIsoDate(order.execution_date));
  const orders = baseOrders.filter((order) => eligibleProjectIdSet.has(order.project_id));
  const cycles = buildCycles(baseOrders, isAllCycles ? null : selectedCycleStart);
  const latestCycle = cycles[0] ?? buildCurrentCycle();
  const oldestCycle = cycles[cycles.length - 1] ?? latestCycle;
  const selectedCycle = isAllCycles ? latestCycle : cycles.find((cycle) => cycle.cycleStart === selectedCycleStart) ?? latestCycle;
  const periodStart = isAllCycles ? oldestCycle.cycleStart : selectedCycle.cycleStart;
  const periodEnd = selectedCycle.cycleEnd;
  const cycleWeeks = isAllCycles ? [] : buildCycleWeeks(periodStart, periodEnd);
  const referenceDate = resolveReferenceDate(periodEnd);

  const completionRowsResult = await loadCompletionRows({
    supabase: resolution.supabase,
    tenantId,
    projectIds: eligibleProjectIds,
    endDate: periodEnd,
  });
  if (completionRowsResult.error) {
    return NextResponse.json({ message: "Falha ao carregar estado de trabalho da carteira." }, { status: 500 });
  }

  const orderIds = orders.filter((order) => order.execution_date <= periodEnd).map((order) => order.id);
  const valueResult = await loadMeasurementItemValues({
    supabase: resolution.supabase,
    tenantId,
    orderIds,
  });
  if (valueResult.error) {
    return NextResponse.json({ message: "Falha ao carregar valores medidos da carteira." }, { status: 500 });
  }

  const teamIds = Array.from(new Set(orders.map((order) => order.team_id).filter((id): id is string => Boolean(id))));
  const supervisorsResult = await loadTeamSupervisors({
    supabase: resolution.supabase,
    tenantId,
    teamIds,
  });
  if (supervisorsResult.error) {
    return NextResponse.json({ message: "Falha ao carregar supervisores da carteira." }, { status: 500 });
  }

  const resolveSupervisor = buildSupervisorResolver(supervisorsResult);
  const completionByProject = new Map<string, "CONCLUIDO" | "PENDENTE">();
  for (const row of completionRowsResult.data.sort((left, right) => {
    const byDate = right.execution_date.localeCompare(left.execution_date);
    return byDate !== 0 ? byDate : right.updated_at.localeCompare(left.updated_at);
  })) {
    if (completionByProject.has(row.project_id)) continue;
    completionByProject.set(row.project_id, normalizeCompletionStatus(row.work_completion_status));
  }

  const ordersByProject = new Map<string, MeasurementOrderRow[]>();
  for (const order of orders.filter((item) => item.execution_date <= periodEnd)) {
    const current = ordersByProject.get(order.project_id) ?? [];
    current.push(order);
    ordersByProject.set(order.project_id, current);
  }

  const allProjectRows: ProjectPortfolioRow[] = eligibleProjects.map((project) => {
    const projectOrders = (ordersByProject.get(project.id) ?? []).sort((left, right) => left.execution_date.localeCompare(right.execution_date));
    const cycleOrders = projectOrders.filter((order) => order.execution_date >= periodStart && order.execution_date <= periodEnd);
    const firstOrder = projectOrders[0] ?? null;
    const lastOrder = projectOrders[projectOrders.length - 1] ?? null;
    const firstActivityDate = firstOrder?.execution_date ?? null;
    const lastActivityDate = lastOrder?.execution_date ?? null;
    const valueBeforeCycle = projectOrders
      .filter((order) => order.execution_date < periodStart)
      .reduce((sum, order) => sum + (valueResult.values.get(order.id) ?? 0), 0);
    const valueInCycle = cycleOrders.reduce((sum, order) => sum + (valueResult.values.get(order.id) ?? 0), 0);
    const accumulatedValue = valueBeforeCycle + valueInCycle;
    const estimatedValue = numberValue(project.estimated_value);
    const remainingPotential = Math.max(0, estimatedValue - accumulatedValue);
    const workedCycleCount = new Set(projectOrders.map((order) => buildCycleFromDate(order.execution_date).cycleStart)).size;
    const lastCycle = lastActivityDate ? buildCycleFromDate(lastActivityDate) : null;
    const cyclesWithoutProduction = lastCycle && lastCycle.cycleStart < selectedCycle.cycleStart
      ? diffMonths(lastCycle.cycleStart, selectedCycle.cycleStart)
      : 0;
    const lastProductionWeek = lastActivityDate
      ? cycleWeeks.findIndex((week) => lastActivityDate >= week.startDate && lastActivityDate <= week.endDate)
      : -1;
    const supervisorOrder = cycleOrders[cycleOrders.length - 1] ?? lastOrder;
    const supervisor = resolveSupervisor(supervisorOrder?.team_id ?? null, supervisorOrder?.execution_date ?? null);
    const firstCycleStart = firstActivityDate ? buildCycleFromDate(firstActivityDate).cycleStart : null;
    const origin = valueInCycle <= 0
      ? "SEM_PRODUCAO"
      : firstCycleStart === periodStart
        ? "NOVO"
        : "HERDADO";
    const latestCycleSnapshotStatus = [...cycleOrders]
      .reverse()
      .map((order) => normalizeOptionalCompletionStatus(order.programming_completion_status_snapshot))
      .find((status): status is "CONCLUIDO" | "PENDENTE" => Boolean(status));
    const resolvedStatus = completionByProject.get(project.id) ?? latestCycleSnapshotStatus ?? "PENDENTE";

    return {
      projectId: project.id,
      projectCode: normalizeText(project.sob) || normalizeText(firstOrder?.project_code_snapshot) || "Projeto sem codigo",
      serviceCenterId: project.service_center,
      serviceCenter: normalizeText(project.service_center_text) || "Nao identificado",
      supervisorId: supervisor.supervisorId,
      supervisorName: supervisor.supervisorName,
      status: resolvedStatus,
      origin,
      portfolioStatus: project.is_withdrawn ? "RETIRADA" : "ATIVA",
      isWithdrawn: project.is_withdrawn === true,
      firstActivityDate,
      lastActivityDate,
      firstActivityLabel: formatDatePtBr(firstActivityDate),
      lastActivityLabel: formatDatePtBr(lastActivityDate),
      lastProductionWeek: lastProductionWeek >= 0 ? lastProductionWeek + 1 : null,
      daysWithoutProduction: lastActivityDate ? diffDays(lastActivityDate, referenceDate) : null,
      workedCycleCount,
      cyclesWithoutProduction,
      estimatedValue,
      valueBeforeCycle,
      valueInCycle,
      accumulatedValue,
      remainingPotential,
      exploredPercentage: estimatedValue > 0 ? (accumulatedValue / estimatedValue) * 100 : 0,
    };
  });

  const filteredProjectRows = allProjectRows
    .filter((project) => !projectQuery || project.projectCode.toLowerCase().includes(projectQuery))
    .filter((project) => !serviceCenterIdFilter || project.serviceCenterId === serviceCenterIdFilter)
    .filter((project) => !supervisorIdFilter || project.supervisorId === supervisorIdFilter)
    .sort((left, right) => {
      const byRemaining = right.remainingPotential - left.remainingPotential;
      return byRemaining !== 0 ? byRemaining : left.projectCode.localeCompare(right.projectCode, "pt-BR");
    });

  const workedRows = filteredProjectRows.filter((project) => project.valueInCycle > 0);
  const newRows = workedRows.filter((project) => project.origin === "NOVO");
  const inheritedRows = workedRows.filter((project) => project.origin === "HERDADO");
  const concludedRows = filteredProjectRows.filter((project) => project.status === "CONCLUIDO");
  const pendingRows = filteredProjectRows.filter((project) => project.status !== "CONCLUIDO");
  const withdrawnRows = filteredProjectRows.filter((project) => project.isWithdrawn);
  const totalEstimatedValue = filteredProjectRows.reduce((sum, project) => sum + project.estimatedValue, 0);
  const producedInCycle = filteredProjectRows.reduce((sum, project) => sum + project.valueInCycle, 0);
  const accumulatedValue = filteredProjectRows.reduce((sum, project) => sum + project.accumulatedValue, 0);
  const remainingPotential = filteredProjectRows.reduce((sum, project) => sum + project.remainingPotential, 0);
  const averageAge = filteredProjectRows.length > 0
    ? filteredProjectRows.reduce((sum, project) => sum + project.workedCycleCount, 0) / filteredProjectRows.length
    : 0;

  function averageEstimated(rows: ProjectPortfolioRow[]) {
    return rows.length > 0 ? rows.reduce((sum, project) => sum + project.estimatedValue, 0) / rows.length : 0;
  }

  const originTotalValue = newRows.reduce((sum, project) => sum + project.valueInCycle, 0)
    + inheritedRows.reduce((sum, project) => sum + project.valueInCycle, 0);
  const renewalChart = [
    {
      origin: "Novos",
      projects: newRows.length,
      valueInCycle: newRows.reduce((sum, project) => sum + project.valueInCycle, 0),
      averageTicket: newRows.length > 0 ? newRows.reduce((sum, project) => sum + project.valueInCycle, 0) / newRows.length : 0,
      participation: originTotalValue > 0 ? (newRows.reduce((sum, project) => sum + project.valueInCycle, 0) / originTotalValue) * 100 : 0,
    },
    {
      origin: "Herdados",
      projects: inheritedRows.length,
      valueInCycle: inheritedRows.reduce((sum, project) => sum + project.valueInCycle, 0),
      averageTicket: inheritedRows.length > 0 ? inheritedRows.reduce((sum, project) => sum + project.valueInCycle, 0) / inheritedRows.length : 0,
      participation: originTotalValue > 0 ? (inheritedRows.reduce((sum, project) => sum + project.valueInCycle, 0) / originTotalValue) * 100 : 0,
    },
  ];

  const ageBuckets = [
    { label: "Sem producao", min: 0, max: 0, count: 0, value: 0 },
    { label: "1 ciclo", min: 1, max: 1, count: 0, value: 0 },
    { label: "2 ciclos", min: 2, max: 2, count: 0, value: 0 },
    { label: "3 ciclos", min: 3, max: 3, count: 0, value: 0 },
    { label: "4+ ciclos", min: 4, max: Number.POSITIVE_INFINITY, count: 0, value: 0 },
  ];
  for (const project of filteredProjectRows) {
    const bucket = ageBuckets.find((item) => project.workedCycleCount >= item.min && project.workedCycleCount <= item.max);
    if (!bucket) continue;
    bucket.count += 1;
    bucket.value += project.estimatedValue;
  }

  const supervisorPotential = Array.from(
    filteredProjectRows.reduce((map, project) => {
      const key = project.supervisorId ?? "sem-supervisor";
      const current = map.get(key) ?? {
        supervisorId: project.supervisorId,
        supervisorName: project.supervisorName,
        projects: 0,
        accumulatedValue: 0,
        remainingPotential: 0,
        exploredPercentage: 0,
        estimatedValue: 0,
      };
      current.projects += 1;
      current.accumulatedValue += project.accumulatedValue;
      current.remainingPotential += project.remainingPotential;
      current.estimatedValue += project.estimatedValue;
      current.exploredPercentage = current.estimatedValue > 0 ? (current.accumulatedValue / current.estimatedValue) * 100 : 0;
      map.set(key, current);
      return map;
    }, new Map<string, {
      supervisorId: string | null;
      supervisorName: string;
      projects: number;
      accumulatedValue: number;
      remainingPotential: number;
      exploredPercentage: number;
      estimatedValue: number;
    }>())
      .values(),
  ).sort((left, right) => right.remainingPotential - left.remainingPotential);

  const serviceCenters = Array.from(
    new Map(eligibleProjects
      .filter((project) => project.service_center)
      .map((project) => [project.service_center as string, {
        id: project.service_center as string,
        label: normalizeText(project.service_center_text) || "Nao identificado",
      }])).values(),
  ).sort((left, right) => left.label.localeCompare(right.label, "pt-BR"));

  const supervisorOptions = Array.from(
    new Map(allProjectRows
      .filter((project) => project.supervisorId)
      .map((project) => [project.supervisorId as string, {
        id: project.supervisorId as string,
        label: project.supervisorName,
      }])).values(),
  ).sort((left, right) => left.label.localeCompare(right.label, "pt-BR"));

  const projectOptions = Array.from(
    new Map(eligibleProjects.map((project) => [project.id, {
      id: project.id,
      label: normalizeText(project.sob) || project.id,
    }])).values(),
  ).sort((left, right) => left.label.localeCompare(right.label, "pt-BR"));

  const renewalRate = workedRows.length > 0 ? (newRows.length / workedRows.length) * 100 : 0;
  const explorationRate = totalEstimatedValue > 0 ? (accumulatedValue / totalEstimatedValue) * 100 : 0;
  const riskSignals = [
    renewalRate < 10 ? "Apenas " + renewalRate.toFixed(1).replace(".", ",") + "% dos projetos trabalhados sao novos." : "",
    explorationRate > 85 ? "Carteira " + explorationRate.toFixed(1).replace(".", ",") + "% explorada." : "",
    averageAge > 4 ? "Idade media elevada: " + averageAge.toFixed(1).replace(".", ",") + " ciclos." : "",
  ].filter(Boolean);
  const warningSignals = [
    renewalRate >= 10 && renewalRate < 20 ? "Renovacao em atencao: " + renewalRate.toFixed(1).replace(".", ",") + "%." : "",
    explorationRate > 75 && explorationRate <= 85 ? "Exploracao em atencao: " + explorationRate.toFixed(1).replace(".", ",") + "%." : "",
    averageAge > 3 && averageAge <= 4 ? "Idade media em atencao: " + averageAge.toFixed(1).replace(".", ",") + " ciclos." : "",
  ].filter(Boolean);
  const diagnosticStatus = riskSignals.length ? "RISCO" : warningSignals.length ? "ATENCAO" : "SAUDAVEL";
  const diagnosticMessage = riskSignals[0] ?? warningSignals[0] ?? "Carteira com renovacao e potencial dentro dos parametros definidos.";

  const payload = {
    cycles,
    selectedCycleStart: isAllCycles ? "ALL" : selectedCycle.cycleStart,
    selectedCycleEnd: periodEnd,
    portfolioScope,
    filters: {
      projects: projectOptions,
      serviceCenters,
      supervisors: supervisorOptions,
    },
    diagnostic: {
      status: diagnosticStatus,
      message: diagnosticMessage,
      signals: [...riskSignals, ...warningSignals],
    },
    quantitySummary: {
      operationalProjects: filteredProjectRows.length,
      workedProjects: workedRows.length,
      newProjects: newRows.length,
      inheritedProjects: inheritedRows.length,
      concludedProjects: concludedRows.length,
      pendingProjects: pendingRows.length,
      withdrawnProjects: withdrawnRows.length,
      averageAge,
      renewalRate,
    },
    financialSummary: {
      totalPortfolioValue: totalEstimatedValue,
      producedInCycle,
      accumulatedValue,
      remainingPotential,
      explorationRate,
      averageNewProjectValue: averageEstimated(newRows),
      averageInheritedProjectValue: averageEstimated(inheritedRows),
      completedAverageTicket: concludedRows.length > 0
        ? concludedRows.reduce((sum, project) => sum + project.valueInCycle, 0) / concludedRows.length
        : 0,
    },
    flow: [
      {
        stage: "Projetos novos",
        projects: newRows.length,
        value: newRows.reduce((sum, project) => sum + project.estimatedValue, 0),
      },
      {
        stage: "Em andamento",
        projects: pendingRows.length,
        value: pendingRows.reduce((sum, project) => sum + project.remainingPotential, 0),
      },
      {
        stage: "Concluidos",
        projects: concludedRows.length,
        value: concludedRows.reduce((sum, project) => sum + project.accumulatedValue, 0),
      },
    ],
    renewalChart,
    ageBuckets: ageBuckets.map(({ label, count, value }) => ({ label, count, value })),
    supervisorPotential,
    projects: filteredProjectRows,
  };

  const payloadSize = JSON.stringify(payload).length;
  if (payloadSize > 100_000) {
    console.warn(`[resp-size] dashboard-carteira-operacional ${Math.round(payloadSize / 1024)}KB tenant=${tenantId}`);
  }

  return NextResponse.json(payload);
}
