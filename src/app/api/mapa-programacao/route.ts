import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";

import { resolveAuthenticatedAppUser, type AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";
import { requirePageAction } from "@/lib/server/pageAuthorization";

const MAP_PROGRAMMING_PAGE_KEY = "mapa-programacao";
const DUE_SOON_DAYS = 15;

type ProjectRow = {
  id: string;
  sob: string | null;
  execution_deadline: string | null;
  service_center_text: string | null;
  service_type_text: string | null;
  city_text: string | null;
  priority_text: string | null;
  is_active: boolean | null;
  is_test?: boolean | null;
  is_withdrawn?: boolean | null;
};

type ProgrammingProjectRow = {
  project_id: string;
};

type TeamRow = {
  id: string;
  name: string | null;
  vehicle_plate: string | null;
  service_center_id: string | null;
  team_type_id: string | null;
  foreman_person_id: string | null;
  ativo: boolean | null;
};

type TeamTypeRow = {
  id: string;
  name: string | null;
};

type PersonRow = {
  id: string;
  nome: string | null;
};

type ServiceCenterRow = {
  id: string;
  name: string | null;
};

type TeamProgrammingRow = {
  team_id: string;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeIsoDate(value: unknown) {
  const normalized = normalizeText(value);
  return isIsoDate(normalized) ? normalized : null;
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: string, amount: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return toIsoDate(value);
}

function diffInDays(targetDate: string, baseDate: string) {
  const target = Date.parse(`${targetDate}T00:00:00.000Z`);
  const base = Date.parse(`${baseDate}T00:00:00.000Z`);
  if (!Number.isFinite(target) || !Number.isFinite(base)) {
    return null;
  }
  return Math.round((target - base) / 86_400_000);
}

function resolveDeadlineStatus(daysUntilDeadline: number | null) {
  if (daysUntilDeadline === null) return "NO_DEADLINE";
  if (daysUntilDeadline < 0) return "OVERDUE";
  if (daysUntilDeadline === 0) return "TODAY";
  if (daysUntilDeadline <= DUE_SOON_DAYS) return "SOON";
  return "NORMAL";
}

async function authorizeMapProgrammingRead(context: AuthenticatedAppUserContext) {
  const authorization = await requirePageAction({
    context,
    pageKey: MAP_PROGRAMMING_PAGE_KEY,
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

async function fetchProjects(supabase: SupabaseClient, tenantId: string) {
  const selectWithFlags = [
    "id",
    "sob",
    "execution_deadline",
    "service_center_text",
    "service_type_text",
    "city_text",
    "priority_text",
    "is_active",
    "is_test",
    "is_withdrawn",
  ].join(", ");

  const primary = await supabase
    .from("project_with_labels")
    .select(selectWithFlags)
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .eq("is_test", false)
    .eq("is_withdrawn", false)
    .order("execution_deadline", { ascending: true })
    .returns<ProjectRow[]>();

  if (!primary.error) {
    return primary.data ?? [];
  }

  const fallback = await supabase
    .from("project_with_labels")
    .select("id, sob, execution_deadline, service_center_text, service_type_text, city_text, priority_text, is_active")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("execution_deadline", { ascending: true })
    .returns<ProjectRow[]>();

  if (fallback.error) {
    throw new Error("Falha ao carregar projetos para o Mapa de Programacao.");
  }

  return (fallback.data ?? []).map((item) => ({
    ...item,
    is_test: false,
    is_withdrawn: false,
  }));
}

async function fetchProgrammedProjectIds(supabase: SupabaseClient, tenantId: string) {
  const { data, error } = await supabase
    .from("project_programming")
    .select("project_id")
    .eq("tenant_id", tenantId)
    .not("project_id", "is", null)
    .limit(100000)
    .returns<ProgrammingProjectRow[]>();

  if (error) {
    throw new Error("Falha ao carregar historico geral de Programacao.");
  }

  return new Set((data ?? []).map((item) => item.project_id));
}

async function fetchTeams(supabase: SupabaseClient, tenantId: string) {
  const { data: teams, error } = await supabase
    .from("teams")
    .select("id, name, vehicle_plate, service_center_id, team_type_id, foreman_person_id, ativo")
    .eq("tenant_id", tenantId)
    .eq("ativo", true)
    .order("name", { ascending: true })
    .returns<TeamRow[]>();

  if (error) {
    throw new Error("Falha ao carregar equipes para o Mapa de Programacao.");
  }

  const teamRows = teams ?? [];
  const teamTypeIds = Array.from(new Set(teamRows.map((item) => normalizeText(item.team_type_id)).filter(Boolean)));
  const personIds = Array.from(new Set(teamRows.map((item) => normalizeText(item.foreman_person_id)).filter(Boolean)));
  const serviceCenterIds = Array.from(new Set(teamRows.map((item) => normalizeText(item.service_center_id)).filter(Boolean)));

  const [teamTypesResult, peopleResult, serviceCentersResult] = await Promise.all([
    teamTypeIds.length
      ? supabase.from("team_types").select("id, name").eq("tenant_id", tenantId).in("id", teamTypeIds).returns<TeamTypeRow[]>()
      : Promise.resolve({ data: [], error: null }),
    personIds.length
      ? supabase.from("people").select("id, nome").eq("tenant_id", tenantId).in("id", personIds).returns<PersonRow[]>()
      : Promise.resolve({ data: [], error: null }),
    serviceCenterIds.length
      ? supabase.from("service_centers").select("id, name").eq("tenant_id", tenantId).in("id", serviceCenterIds).returns<ServiceCenterRow[]>()
      : Promise.resolve({ data: [], error: null }),
  ]);

  const teamTypeMap = new Map((teamTypesResult.data ?? []).map((item) => [item.id, normalizeText(item.name)]));
  const peopleMap = new Map((peopleResult.data ?? []).map((item) => [item.id, normalizeText(item.nome)]));
  const serviceCenterMap = new Map((serviceCentersResult.data ?? []).map((item) => [item.id, normalizeText(item.name)]));

  return teamRows.map((team) => ({
    id: team.id,
    name: normalizeText(team.name) || team.id,
    vehiclePlate: normalizeText(team.vehicle_plate),
    serviceCenter: serviceCenterMap.get(normalizeText(team.service_center_id)) || "Sem base",
    teamType: teamTypeMap.get(normalizeText(team.team_type_id)) || "Sem tipo",
    foremanName: peopleMap.get(normalizeText(team.foreman_person_id)) || "Sem encarregado",
  }));
}

async function fetchProgrammedTeamIds(params: {
  supabase: SupabaseClient;
  tenantId: string;
  startDate: string;
  endDate: string;
}) {
  const { data, error } = await params.supabase
    .from("project_programming")
    .select("team_id")
    .eq("tenant_id", params.tenantId)
    .gte("execution_date", params.startDate)
    .lte("execution_date", params.endDate)
    .in("status", ["PROGRAMADA", "REPROGRAMADA"])
    .returns<TeamProgrammingRow[]>();

  if (error) {
    throw new Error("Falha ao carregar programacoes das equipes no periodo.");
  }

  return new Set((data ?? []).map((item) => item.team_id));
}

export async function GET(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para carregar Mapa de Programacao.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const authorizationError = await authorizeMapProgrammingRead(resolution);
  if (authorizationError) return authorizationError;

  const today = toIsoDate(new Date());
  const startDate = normalizeIsoDate(request.nextUrl.searchParams.get("startDate")) ?? today;
  const endDate = normalizeIsoDate(request.nextUrl.searchParams.get("endDate")) ?? addDays(startDate, 6);

  if (endDate < startDate) {
    return NextResponse.json({ message: "Data final deve ser maior ou igual a data inicial." }, { status: 400 });
  }

  try {
    const [projects, programmedProjectIds, teams, programmedTeamIds] = await Promise.all([
      fetchProjects(resolution.supabase, resolution.appUser.tenant_id),
      fetchProgrammedProjectIds(resolution.supabase, resolution.appUser.tenant_id),
      fetchTeams(resolution.supabase, resolution.appUser.tenant_id),
      fetchProgrammedTeamIds({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        startDate,
        endDate,
      }),
    ]);

    const neverProgrammedProjects = projects
      .filter((project) => !programmedProjectIds.has(project.id))
      .map((project) => {
        const executionDeadline = normalizeText(project.execution_deadline);
        const daysUntilDeadline = isIsoDate(executionDeadline) ? diffInDays(executionDeadline, today) : null;
        const deadlineStatus = resolveDeadlineStatus(daysUntilDeadline);
        return {
          id: project.id,
          sob: normalizeText(project.sob) || project.id,
          serviceCenter: normalizeText(project.service_center_text) || "Sem base",
          priority: normalizeText(project.priority_text) || "Sem prioridade",
          serviceType: normalizeText(project.service_type_text) || "Sem tipo",
          city: normalizeText(project.city_text) || "Sem municipio",
          executionDeadline,
          daysUntilDeadline,
          deadlineStatus,
        };
      })
      .sort((left, right) => {
        if (left.deadlineStatus === "NO_DEADLINE" && right.deadlineStatus !== "NO_DEADLINE") return 1;
        if (right.deadlineStatus === "NO_DEADLINE" && left.deadlineStatus !== "NO_DEADLINE") return -1;
        return (left.daysUntilDeadline ?? 99999) - (right.daysUntilDeadline ?? 99999)
          || left.sob.localeCompare(right.sob);
      });

    const teamsWithoutProgramming = teams.filter((team) => !programmedTeamIds.has(team.id));

    return NextResponse.json({
      filters: {
        startDate,
        endDate,
        generatedAt: new Date().toISOString(),
      },
      summary: {
        activeProjectCount: projects.length,
        neverProgrammedProjectCount: neverProgrammedProjects.length,
        overdueNeverProgrammedProjectCount: neverProgrammedProjects.filter((item) => item.deadlineStatus === "OVERDUE").length,
        dueSoonNeverProgrammedProjectCount: neverProgrammedProjects.filter((item) => item.deadlineStatus === "TODAY" || item.deadlineStatus === "SOON").length,
        noDeadlineNeverProgrammedProjectCount: neverProgrammedProjects.filter((item) => item.deadlineStatus === "NO_DEADLINE").length,
        activeTeamCount: teams.length,
        teamsWithoutProgrammingCount: teamsWithoutProgramming.length,
        programmedTeamCount: teams.length - teamsWithoutProgramming.length,
      },
      neverProgrammedProjects,
      teamsWithoutProgramming,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao carregar Mapa de Programacao.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
