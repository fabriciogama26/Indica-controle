import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";

type TeamTypeRow = {
  id: string;
  name: string;
};

type TeamRow = {
  team_type_id: string;
};

type MeasurementOrderDateRow = {
  execution_date: string;
  project_id: string;
  team_id: string | null;
};

type ProjectTestRow = {
  id: string;
  is_test: boolean | null;
};

type TargetRow = {
  id: string;
  team_type_id: string;
  daily_value: number | string;
  updated_at: string;
};

type CycleWorkdaysRow = {
  id: string;
  cycle_start: string;
  cycle_end: string;
  workdays: number;
  default_workdays: number | null;
  worked_days: number | string | null;
  notes: string | null;
  updated_at: string;
};

type CycleTargetItemRow = {
  id: string;
  cycle_id: string;
  team_type_id: string;
  daily_value: number | string;
  active_team_count: number | string;
  measured_team_count: number | string | null;
  daily_goal: number | string;
  cycle_goal: number | string;
  standard_cycle_goal: number | string | null;
  worked_cycle_goal: number | string | null;
  updated_at: string;
};

type MetaHistoryRow = {
  id: string;
  action_type: "CREATE" | "UPDATE";
  reason: string | null;
  changes: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  created_by: string | null;
};

type AppUserRow = {
  id: string;
  display: string | null;
  login_name: string | null;
};

type SaveMetaPayload = {
  action?: "SAVE_META_REGISTRATION";
  cycleId?: string;
  targets?: Array<{
    teamTypeId?: string;
    dailyValue?: string | number;
    measuredTeamCount?: string | number;
  }>;
  cycleStart?: string;
  cycleEnd?: string;
  workdays?: string | number;
  defaultWorkdays?: string | number;
  workedDays?: string | number;
  notes?: string;
  reason?: string;
};

type SaveMetaRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function buildMetaSaveErrorMessage(error: { message?: string; details?: string; hint?: string }) {
  const details = [error.message, error.details, error.hint].map(normalizeText).filter(Boolean).join(" ");
  if (!details) {
    return "Falha ao salvar cadastro de metas.";
  }

  return `Falha ao salvar cadastro de metas. Detalhe: ${details}`;
}

function normalizeUuid(value: unknown) {
  const normalized = normalizeText(value);
  return /^[0-9a-f-]{36}$/i.test(normalized) ? normalized : null;
}

function normalizeIsoDate(value: unknown) {
  const normalized = normalizeText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function normalizeExecutionDate(value: unknown) {
  const normalized = normalizeText(value).slice(0, 10);
  return normalizeIsoDate(normalized);
}

function normalizeMoney(value: unknown) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      return null;
    }
    return Number(value.toFixed(2));
  }

  const normalized = normalizeText(value).replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Number(parsed.toFixed(2));
}

function normalizeWorkdays(value: unknown) {
  const parsed = Number(normalizeText(value));
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 31) {
    return null;
  }
  return parsed;
}

function normalizeTeamCount(value: unknown) {
  const parsed = Number(normalizeText(value).replace(",", "."));
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 999) {
    return null;
  }
  return parsed;
}

function toIsoDate(value: Date) {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function createUtcDate(year: number, monthIndex: number, day: number) {
  return new Date(Date.UTC(year, monthIndex, day));
}

function addMonths(value: Date, months: number) {
  return createUtcDate(value.getUTCFullYear(), value.getUTCMonth() + months, value.getUTCDate());
}

function parseIsoDate(value: string) {
  const [year, month, day] = value.split("-").map((item) => Number(item));
  return createUtcDate(year, month - 1, day);
}

function resolveCycleStart(reference: Date) {
  const year = reference.getUTCFullYear();
  const monthIndex = reference.getUTCMonth();
  const day = reference.getUTCDate();
  return day >= 21 ? createUtcDate(year, monthIndex, 21) : createUtcDate(year, monthIndex - 1, 21);
}

function countWeekdays(start: Date, end: Date) {
  let total = 0;
  const current = new Date(start);
  while (current <= end) {
    const day = current.getUTCDay();
    if (day >= 1 && day <= 5) {
      total += 1;
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return total;
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

function formatCycleLabelFromIso(cycleStart: string, cycleEnd: string) {
  return formatCycleLabel(parseIsoDate(cycleStart), parseIsoDate(cycleEnd));
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
    defaultWorkdays: countWeekdays(start, end),
    workedDays: 0,
  };
}

async function fetchProjectIsTestMap(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  projectIds: string[];
}) {
  const uniqueProjectIds = Array.from(new Set(params.projectIds.filter(Boolean)));
  if (!uniqueProjectIds.length) {
    return new Map<string, boolean>();
  }

  const { data, error } = await params.supabase
    .from("project")
    .select("id, is_test")
    .eq("tenant_id", params.tenantId)
    .in("id", uniqueProjectIds)
    .returns<ProjectTestRow[]>();

  if (error) {
    return new Map<string, boolean>();
  }

  return new Map((data ?? []).map((item) => [item.id, Boolean(item.is_test)]));
}

function resolveAppUserName(user: AppUserRow | undefined) {
  if (!user) return "Nao identificado";
  return normalizeText(user.display) || normalizeText(user.login_name) || "Nao identificado";
}

async function fetchAppUserMap(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  ids: string[];
}) {
  const ids = Array.from(new Set(params.ids.filter(Boolean)));
  if (!ids.length) return new Map<string, AppUserRow>();

  const { data } = await params.supabase
    .from("app_users")
    .select("id, display, login_name")
    .eq("tenant_id", params.tenantId)
    .in("id", ids)
    .returns<AppUserRow[]>();

  return new Map((data ?? []).map((item) => [item.id, item]));
}

async function calculateWorkedDaysForCycle(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  cycleStart: string;
  cycleEnd: string;
}) {
  const { data, error } = await params.supabase
    .from("project_measurement_orders")
    .select("execution_date, project_id, team_id")
    .eq("tenant_id", params.tenantId)
    .eq("is_active", true)
    .eq("measurement_kind", "COM_PRODUCAO")
    .neq("status", "CANCELADA")
    .gte("execution_date", params.cycleStart)
    .lte("execution_date", params.cycleEnd)
    .returns<MeasurementOrderDateRow[]>();

  if (error) {
    throw new Error("Falha ao recalcular dias trabalhados do ciclo.");
  }

  const projectIsTestMap = await fetchProjectIsTestMap({
    supabase: params.supabase,
    tenantId: params.tenantId,
    projectIds: (data ?? []).map((item) => item.project_id),
  });

  const workedDatesByTeam = new Map<string, Set<string>>();
  for (const row of data ?? []) {
    const executionDate = normalizeExecutionDate(row.execution_date);
    if (!executionDate || !row.team_id || projectIsTestMap.get(row.project_id)) {
      continue;
    }

    const dates = workedDatesByTeam.get(row.team_id) ?? new Set<string>();
    dates.add(executionDate);
    workedDatesByTeam.set(row.team_id, dates);
  }

  const counts = Array.from(workedDatesByTeam.values()).map((dates) => dates.size);
  const average = counts.length ? counts.reduce((sum, value) => sum + value, 0) / counts.length : 0;
  return Math.round(average);
}

async function loadMetaDetail(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  cycleId: string;
}) {
  const { data: cycle, error: cycleError } = await params.supabase
    .from("measurement_cycle_workdays")
    .select("id, cycle_start, cycle_end, workdays, default_workdays, worked_days, notes, updated_at")
    .eq("tenant_id", params.tenantId)
    .eq("id", params.cycleId)
    .maybeSingle<CycleWorkdaysRow>();

  if (cycleError || !cycle) return null;

  const { data: items, error: itemsError } = await params.supabase
    .from("measurement_cycle_target_items")
    .select("id, cycle_id, team_type_id, daily_value, active_team_count, measured_team_count, daily_goal, cycle_goal, standard_cycle_goal, worked_cycle_goal, updated_at")
    .eq("tenant_id", params.tenantId)
    .eq("cycle_id", params.cycleId)
    .returns<CycleTargetItemRow[]>();

  if (itemsError) return null;

  const teamTypeIds = Array.from(new Set((items ?? []).map((item) => item.team_type_id).filter(Boolean)));
  const teamTypesResult = teamTypeIds.length
    ? await params.supabase
        .from("team_types")
        .select("id, name")
        .eq("tenant_id", params.tenantId)
        .in("id", teamTypeIds)
        .returns<TeamTypeRow[]>()
    : { data: [] as TeamTypeRow[], error: null };

  const teamTypeMap = new Map((teamTypesResult.data ?? []).map((item) => [item.id, normalizeText(item.name)]));
  const normalizedItems = (items ?? []).map((item) => ({
    id: item.id,
    teamTypeId: item.team_type_id,
    teamTypeName: teamTypeMap.get(item.team_type_id) ?? "Nao identificado",
    dailyValue: Number(item.daily_value ?? 0),
    activeTeamCount: Number(item.active_team_count ?? 0),
    measuredTeamCount: Number(item.measured_team_count ?? item.active_team_count ?? 0),
    updatedAt: item.updated_at,
  })).map((item) => {
    const dailyGoal = item.dailyValue * item.measuredTeamCount;
    return {
      ...item,
      dailyGoal,
      cycleGoal: dailyGoal * Number(cycle.workdays ?? 0),
      standardCycleGoal: dailyGoal * Number(cycle.default_workdays ?? cycle.workdays ?? 0),
      workedCycleGoal: dailyGoal * Math.round(Number(cycle.worked_days ?? 0)),
    };
  });

  return {
    id: cycle.id,
    cycleStart: cycle.cycle_start,
    cycleEnd: cycle.cycle_end,
    label: formatCycleLabelFromIso(cycle.cycle_start, cycle.cycle_end),
    workdays: Number(cycle.workdays ?? 0),
    defaultWorkdays: Number(cycle.default_workdays ?? cycle.workdays ?? 0),
    workedDays: Math.round(Number(cycle.worked_days ?? 0)),
    notes: normalizeText(cycle.notes),
    updatedAt: cycle.updated_at,
    totalMeasuredTeams: normalizedItems.reduce((sum, item) => sum + item.measuredTeamCount, 0),
    totalDailyGoal: normalizedItems.reduce((sum, item) => sum + item.dailyGoal, 0),
    totalCycleGoal: normalizedItems.reduce((sum, item) => sum + item.cycleGoal, 0),
    totalStandardCycleGoal: normalizedItems.reduce((sum, item) => sum + item.standardCycleGoal, 0),
    totalWorkedCycleGoal: normalizedItems.reduce((sum, item) => sum + item.workedCycleGoal, 0),
    items: normalizedItems.sort((left, right) => left.teamTypeName.localeCompare(right.teamTypeName)),
  };
}

export async function GET(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para carregar metas.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const detailCycleId = normalizeUuid(request.nextUrl.searchParams.get("detailCycleId"));
  if (detailCycleId) {
    const detail = await loadMetaDetail({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      cycleId: detailCycleId,
    });

    if (!detail) {
      return NextResponse.json({ message: "Cadastro de meta do ciclo nao encontrado." }, { status: 404 });
    }

    return NextResponse.json({ detail });
  }

  const historyCycleId = normalizeUuid(request.nextUrl.searchParams.get("historyCycleId"));
  if (historyCycleId) {
    const { data: history, error } = await resolution.supabase
      .from("measurement_meta_history")
      .select("id, action_type, reason, changes, metadata, created_at, created_by")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("cycle_id", historyCycleId)
      .order("created_at", { ascending: false })
      .returns<MetaHistoryRow[]>();

    if (error) {
      return NextResponse.json({ message: "Falha ao carregar historico da meta." }, { status: 500 });
    }

    const userMap = await fetchAppUserMap({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      ids: (history ?? []).map((item) => item.created_by ?? "").filter(Boolean),
    });

    return NextResponse.json({
      history: (history ?? []).map((item) => ({
        id: item.id,
        actionType: item.action_type,
        reason: normalizeText(item.reason),
        changes: item.changes ?? {},
        metadata: item.metadata ?? {},
        createdAt: item.created_at,
        createdByName: resolveAppUserName(userMap.get(item.created_by ?? "")),
      })),
    });
  }

  const [teamTypesResult, targetsResult, teamsResult, measurementDatesResult] = await Promise.all([
    resolution.supabase
      .from("team_types")
      .select("id, name")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("ativo", true)
      .order("name", { ascending: true })
      .returns<TeamTypeRow[]>(),
    resolution.supabase
      .from("measurement_team_type_targets")
      .select("id, team_type_id, daily_value, updated_at")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("ativo", true)
      .returns<TargetRow[]>(),
    resolution.supabase
      .from("teams")
      .select("team_type_id")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("ativo", true)
      .returns<TeamRow[]>(),
    resolution.supabase
      .from("project_measurement_orders")
      .select("execution_date, project_id, team_id")
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("is_active", true)
      .eq("measurement_kind", "COM_PRODUCAO")
      .neq("status", "CANCELADA")
      .order("execution_date", { ascending: false })
      .limit(10000)
      .returns<MeasurementOrderDateRow[]>(),
  ]);

  if (teamTypesResult.error) {
    return NextResponse.json({ message: "Falha ao carregar tipos de equipe para metas." }, { status: 500 });
  }

  if (targetsResult.error) {
    return NextResponse.json({ message: "Falha ao carregar metas por tipo de equipe." }, { status: 500 });
  }

  if (teamsResult.error) {
    return NextResponse.json({ message: "Falha ao carregar equipes para calculo de metas." }, { status: 500 });
  }

  if (measurementDatesResult.error) {
    return NextResponse.json({ message: "Falha ao carregar ciclos das medicoes." }, { status: 500 });
  }

  const projectIsTestMap = await fetchProjectIsTestMap({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    projectIds: (measurementDatesResult.data ?? []).map((item) => item.project_id),
  });

  const cycleMap = new Map<string, ReturnType<typeof buildCycleFromMeasurementDate>>();
  const workedDatesByCycleTeam = new Map<string, Map<string, Set<string>>>();
  for (const row of measurementDatesResult.data ?? []) {
    const executionDate = normalizeExecutionDate(row.execution_date);
    if (!executionDate || projectIsTestMap.get(row.project_id)) {
      continue;
    }
    const cycle = buildCycleFromMeasurementDate(executionDate);
    if (!cycleMap.has(cycle.cycleStart)) {
      cycleMap.set(cycle.cycleStart, cycle);
    }

    if (row.team_id) {
      const teamMap = workedDatesByCycleTeam.get(cycle.cycleStart) ?? new Map<string, Set<string>>();
      const dates = teamMap.get(row.team_id) ?? new Set<string>();
      dates.add(executionDate);
      teamMap.set(row.team_id, dates);
      workedDatesByCycleTeam.set(cycle.cycleStart, teamMap);
    }
  }

  for (const cycle of cycleMap.values()) {
    const teamMap = workedDatesByCycleTeam.get(cycle.cycleStart);
    const counts = teamMap ? Array.from(teamMap.values()).map((dates) => dates.size) : [];
    const average = counts.length ? counts.reduce((sum, value) => sum + value, 0) / counts.length : 0;
    cycle.workedDays = Math.round(average);
  }

  const cycles = Array.from(cycleMap.values()).sort((left, right) => right.cycleStart.localeCompare(left.cycleStart));
  const cycleStarts = cycles.map((cycle) => cycle.cycleStart);

  const cyclesResult = cycleStarts.length
    ? await resolution.supabase
      .from("measurement_cycle_workdays")
      .select("id, cycle_start, cycle_end, workdays, default_workdays, worked_days, notes, updated_at")
        .eq("tenant_id", resolution.appUser.tenant_id)
        .in("cycle_start", cycleStarts)
      .returns<CycleWorkdaysRow[]>()
    : { data: [] as CycleWorkdaysRow[], error: null };

  if (cyclesResult.error) {
    return NextResponse.json({ message: "Falha ao carregar dias uteis por ciclo." }, { status: 500 });
  }

  const targetMap = new Map((targetsResult.data ?? []).map((item) => [item.team_type_id, item]));
  const cycleWorkdaysMap = new Map((cyclesResult.data ?? []).map((item) => [item.cycle_start, item]));
  const teamCountByType = new Map<string, number>();
  for (const team of teamsResult.data ?? []) {
    teamCountByType.set(team.team_type_id, (teamCountByType.get(team.team_type_id) ?? 0) + 1);
  }

  const registeredCycleIds = (cyclesResult.data ?? []).map((cycle) => cycle.id);
  const registeredItemsResult = registeredCycleIds.length
    ? await resolution.supabase
        .from("measurement_cycle_target_items")
        .select("id, cycle_id, team_type_id, daily_value, active_team_count, measured_team_count, daily_goal, cycle_goal, standard_cycle_goal, worked_cycle_goal, updated_at")
        .eq("tenant_id", resolution.appUser.tenant_id)
        .in("cycle_id", registeredCycleIds)
        .returns<CycleTargetItemRow[]>()
    : { data: [] as CycleTargetItemRow[], error: null };

  if (registeredItemsResult.error) {
    return NextResponse.json({ message: "Falha ao carregar lista de metas salvas." }, { status: 500 });
  }

  const registeredItemsByCycle = new Map<string, CycleTargetItemRow[]>();
  for (const item of registeredItemsResult.data ?? []) {
    const current = registeredItemsByCycle.get(item.cycle_id) ?? [];
    current.push(item);
    registeredItemsByCycle.set(item.cycle_id, current);
  }

  const registrations = (cyclesResult.data ?? []).map((cycle) => {
    const items = registeredItemsByCycle.get(cycle.id) ?? [];
    const workdays = Number(cycle.workdays ?? 0);
    const defaultWorkdays = Number(cycle.default_workdays ?? cycle.workdays ?? 0);
    const workedDays = Math.round(Number(cycle.worked_days ?? 0));
    const normalizedItems = items.map((item) => {
      const dailyValue = Number(item.daily_value ?? 0);
      const measuredTeamCount = Number(item.measured_team_count ?? item.active_team_count ?? 0);
      const dailyGoal = dailyValue * measuredTeamCount;
      return {
        activeTeamCount: Number(item.active_team_count ?? 0),
        measuredTeamCount,
        dailyGoal,
        cycleGoal: dailyGoal * workdays,
        standardCycleGoal: dailyGoal * defaultWorkdays,
        workedCycleGoal: dailyGoal * workedDays,
      };
    });
    return {
      id: cycle.id,
      cycleStart: cycle.cycle_start,
      cycleEnd: cycle.cycle_end,
      label: formatCycleLabelFromIso(cycle.cycle_start, cycle.cycle_end),
      workdays,
      defaultWorkdays,
      workedDays,
      notes: normalizeText(cycle.notes),
      updatedAt: cycle.updated_at,
      targetCount: items.length,
      totalActiveTeams: normalizedItems.reduce((sum, item) => sum + item.activeTeamCount, 0),
      totalMeasuredTeams: normalizedItems.reduce((sum, item) => sum + item.measuredTeamCount, 0),
      totalDailyGoal: normalizedItems.reduce((sum, item) => sum + item.dailyGoal, 0),
      totalCycleGoal: normalizedItems.reduce((sum, item) => sum + item.cycleGoal, 0),
      totalStandardCycleGoal: normalizedItems.reduce((sum, item) => sum + item.standardCycleGoal, 0),
      totalWorkedCycleGoal: normalizedItems.reduce((sum, item) => sum + item.workedCycleGoal, 0),
    };
  }).sort((left, right) => right.cycleStart.localeCompare(left.cycleStart));

  return NextResponse.json({
    teamTypes: (teamTypesResult.data ?? []).map((item) => {
      const target = targetMap.get(item.id);
      return {
        id: item.id,
        name: normalizeText(item.name),
        dailyValue: Number(target?.daily_value ?? 0),
        activeTeamCount: teamCountByType.get(item.id) ?? 0,
        targetId: target?.id ?? null,
        updatedAt: target?.updated_at ?? null,
      };
    }),
    cycles: cycles.map((cycle) => {
      const savedCycle = cycleWorkdaysMap.get(cycle.cycleStart);
      const savedItems = savedCycle ? registeredItemsByCycle.get(savedCycle.id) ?? [] : [];
      return {
        ...cycle,
        id: savedCycle?.id ?? null,
        defaultWorkdays: savedCycle?.default_workdays ?? cycle.defaultWorkdays,
        workedDays: cycle.workedDays,
        workdays: savedCycle?.workdays ?? cycle.defaultWorkdays,
        notes: savedCycle?.notes ?? "",
        updatedAt: savedCycle?.updated_at ?? null,
        isEdited: Boolean(savedCycle),
        targets: savedItems.map((item) => ({
          teamTypeId: item.team_type_id,
          dailyValue: Number(item.daily_value ?? 0),
          measuredTeamCount: Number(item.measured_team_count ?? item.active_team_count ?? 0),
        })),
      };
    }),
    registrations,
  });
}

export async function POST(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para salvar metas.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const payload = (await request.json().catch(() => null)) as SaveMetaPayload | null;
  const action = normalizeText(payload?.action).toUpperCase();

  if (action !== "SAVE_META_REGISTRATION") {
    return NextResponse.json({ message: "Acao invalida para salvar metas." }, { status: 400 });
  }

  const targets = Array.isArray(payload?.targets) ? payload.targets : [];
  const normalizedTargets = targets.map((target) => ({
    teamTypeId: normalizeUuid(target.teamTypeId),
    dailyValue: normalizeMoney(target.dailyValue),
    measuredTeamCount: normalizeTeamCount(target.measuredTeamCount),
  }));

  if (!normalizedTargets.length || normalizedTargets.some((target) => !target.teamTypeId || target.dailyValue === null || target.measuredTeamCount === null)) {
    return NextResponse.json({ message: "Informe metas validas por tipo de equipe." }, { status: 400 });
  }

  const cycleStart = normalizeIsoDate(payload?.cycleStart);
  const cycleEnd = normalizeIsoDate(payload?.cycleEnd);
  const workdays = normalizeWorkdays(payload?.workdays);
  const defaultWorkdays = normalizeWorkdays(payload?.defaultWorkdays);
  const notes = normalizeText(payload?.notes) || null;
  const cycleId = normalizeUuid(payload?.cycleId);
  const reason = normalizeText(payload?.reason) || null;

  if (!cycleStart || !cycleEnd || workdays === null || defaultWorkdays === null) {
    return NextResponse.json({ message: "Informe ciclo e dias uteis validos." }, { status: 400 });
  }

  let workedDays = 0;
  try {
    workedDays = await calculateWorkedDaysForCycle({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      cycleStart,
      cycleEnd,
    });
  } catch {
    return NextResponse.json({ message: "Falha ao recalcular dias trabalhados do ciclo." }, { status: 500 });
  }

  const { data, error } = await resolution.supabase.rpc("save_measurement_meta_registration", {
    p_tenant_id: resolution.appUser.tenant_id,
    p_actor_user_id: resolution.appUser.id,
    p_targets: normalizedTargets.map((target) => ({
      teamTypeId: target.teamTypeId as string,
      dailyValue: target.dailyValue as number,
      measuredTeamCount: target.measuredTeamCount as number,
    })),
    p_cycle_start: cycleStart,
    p_cycle_end: cycleEnd,
    p_workdays: workdays,
    p_default_workdays: defaultWorkdays,
    p_worked_days: workedDays,
    p_notes: notes,
    p_cycle_id: cycleId,
    p_reason: reason,
  });

  if (error) {
    return NextResponse.json({ message: buildMetaSaveErrorMessage(error) }, { status: 500 });
  }

  const result = (data ?? {}) as SaveMetaRpcResult;
  if (result.success !== true) {
    return NextResponse.json(
      { message: result.message ?? "Falha ao salvar cadastro de metas.", reason: result.reason ?? null },
      { status: Number(result.status ?? 400) },
    );
  }

  return NextResponse.json({
    success: true,
    message: result.message ?? "Cadastro de metas salvo com sucesso.",
  });
}
