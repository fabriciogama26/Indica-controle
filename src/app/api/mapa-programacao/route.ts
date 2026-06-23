import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";

import { resolveAuthenticatedAppUser, type AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";
import { requirePageAction } from "@/lib/server/pageAuthorization";

const MAP_PROGRAMMING_PAGE_KEY = "mapa-programacao";
const ACTIVE_PROGRAMMING_STATUSES = new Set(["PROGRAMADA", "REPROGRAMADA"]);
const INTERRUPTED_PROGRAMMING_STATUSES = new Set(["CANCELADA", "ADIADA"]);

type ProjectSituationKey =
  | "PORTFOLIO"
  | "CONCLUDED"
  | "TO_REPROGRAM"
  | "REVIEW_STAGES"
  | "PENDING"
  | "PARTIAL_PLANNED"
  | "PARTIAL"
  | "BENEFIT_REACHED"
  | "INTERRUPTED"
  | "WITHOUT_STATUS"
  | "NEVER_PROGRAMMED";

type PriorityLevel = "NORMAL" | "ATTENTION" | "PRIORITY" | "INCONSISTENCY";

type ProjectRow = {
  id: string;
  sob: string | null;
  execution_deadline: string | null;
  service_center_text: string | null;
  service_type_text: string | null;
  city_text: string | null;
  priority_text: string | null;
  service_description?: string | null;
  partner_text?: string | null;
  is_active: boolean | null;
  is_test?: boolean | null;
  is_withdrawn?: boolean | null;
};

type ProgrammingRow = {
  id: string;
  project_id: string | null;
  team_id: string | null;
  status: string | null;
  execution_date: string | null;
  etapa_number: number | null;
  etapa_unica: boolean | null;
  etapa_final?: boolean | null;
  work_completion_status: string | null;
  cancellation_reason: string | null;
  note: string | null;
  created_at: string | null;
  updated_at: string | null;
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

type WorkCompletionCatalogRow = {
  code: string | null;
  label_pt: string | null;
};

type TeamProgrammingRow = {
  team_id: string | null;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeToken(value: unknown) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
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

function diffInDays(targetDate: string, baseDate: string) {
  const target = Date.parse(`${targetDate}T00:00:00.000Z`);
  const base = Date.parse(`${baseDate}T00:00:00.000Z`);
  if (!Number.isFinite(target) || !Number.isFinite(base)) {
    return null;
  }
  return Math.round((target - base) / 86_400_000);
}

function isCompletedWorkStatus(value: unknown) {
  const token = normalizeToken(value);
  return token === "CONCLUIDO" || token === "COMPLETO" || token.startsWith("CONCLUIDO");
}

function isEmergencyServiceType(value: unknown) {
  return normalizeToken(value).includes("EMERGENCIAL");
}

function isPendingWorkStatus(value: unknown) {
  return normalizeToken(value).includes("PENDEN");
}

function isPartialPlannedWorkStatus(value: unknown) {
  const token = normalizeToken(value);
  return token.includes("PARCIAL") && token.includes("PLANEJ");
}

function isPartialWorkStatus(value: unknown) {
  const token = normalizeToken(value);
  return token.includes("PARCIAL") && !token.includes("PLANEJ");
}

function isBenefitReachedWorkStatus(value: unknown) {
  const token = normalizeToken(value);
  return token.includes("BENEFICIO") || token.includes("BENFICIO");
}

function isInterruptedStatus(value: unknown) {
  return INTERRUPTED_PROGRAMMING_STATUSES.has(normalizeToken(value));
}

function isActiveProgrammingStatus(value: unknown) {
  return ACTIVE_PROGRAMMING_STATUSES.has(normalizeToken(value));
}

function compareProgrammingRows(left: ProgrammingRow, right: ProgrammingRow) {
  const leftDate = normalizeIsoDate(left.execution_date) ?? "";
  const rightDate = normalizeIsoDate(right.execution_date) ?? "";
  if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);

  const leftUpdatedAt = normalizeText(left.updated_at);
  const rightUpdatedAt = normalizeText(right.updated_at);
  if (leftUpdatedAt !== rightUpdatedAt) return leftUpdatedAt.localeCompare(rightUpdatedAt);

  const leftCreatedAt = normalizeText(left.created_at);
  const rightCreatedAt = normalizeText(right.created_at);
  if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt.localeCompare(rightCreatedAt);

  return normalizeText(left.id).localeCompare(normalizeText(right.id));
}

function resolveStageKey(row: ProgrammingRow) {
  if (row.etapa_final) return "ETAPA_FINAL";
  if (row.etapa_unica) return "ETAPA_UNICA";
  const stageNumber = Number(row.etapa_number ?? 0);
  return Number.isInteger(stageNumber) && stageNumber > 0 ? `ETAPA_${stageNumber}` : "";
}

function resolveStageLabel(row: ProgrammingRow | null) {
  if (!row) return "Sem etapa";
  if (row.etapa_final) return "Etapa final";
  if (row.etapa_unica) return "Etapa unica";
  const stageNumber = Number(row.etapa_number ?? 0);
  return Number.isInteger(stageNumber) && stageNumber > 0 ? `${stageNumber} etapa` : "Sem etapa";
}

function resolveStageReviewIssue(rows: ProgrammingRow[]) {
  const activeRowsWithStage = rows
    .filter((row) => isActiveProgrammingStatus(row.status))
    .filter((row) => {
      const stageNumber = Number(row.etapa_number ?? 0);
      return Number.isInteger(stageNumber) && stageNumber > 0;
    });

  for (const interruptedRow of rows.filter((row) => isInterruptedStatus(row.status))) {
    const interruptedStageNumber = Number(interruptedRow.etapa_number ?? 0);
    if (!Number.isInteger(interruptedStageNumber) || interruptedStageNumber < 1) continue;

    const nextActiveStage = activeRowsWithStage
      .filter((row) => Number(row.etapa_number ?? 0) > interruptedStageNumber)
      .sort((left, right) => {
        const stageDiff = Number(left.etapa_number ?? 0) - Number(right.etapa_number ?? 0);
        return stageDiff || compareProgrammingRows(left, right);
      })
      .at(0);

    if (!nextActiveStage) continue;

    return {
      interruptedStageLabel: resolveStageLabel(interruptedRow),
      nextActiveStageLabel: resolveStageLabel(nextActiveStage),
      interruptedStatus: normalizeToken(interruptedRow.status),
      interruptedDate: normalizeIsoDate(interruptedRow.execution_date) ?? "",
    };
  }

  return null;
}

function resolvePriorityLevel(params: {
  latestDate: string;
  daysSinceLatest: number | null;
  workCompletionStatus: string | null;
}) {
  if (!params.workCompletionStatus && params.latestDate && params.daysSinceLatest !== null && params.daysSinceLatest > 0) {
    return "INCONSISTENCY" satisfies PriorityLevel;
  }
  if (params.daysSinceLatest === null || params.daysSinceLatest <= 2) return "NORMAL" satisfies PriorityLevel;
  if (params.daysSinceLatest <= 5) return "ATTENTION" satisfies PriorityLevel;
  return "PRIORITY" satisfies PriorityLevel;
}

function buildTeamLookup(teams: TeamRow[], teamTypeMap: Map<string, string>, peopleMap: Map<string, string>, serviceCenterMap: Map<string, string>) {
  return new Map(
    teams.map((team) => [
      team.id,
      {
        id: team.id,
        name: normalizeText(team.name) || team.id,
        vehiclePlate: normalizeText(team.vehicle_plate),
        serviceCenter: serviceCenterMap.get(normalizeText(team.service_center_id)) || "Sem base",
        teamType: teamTypeMap.get(normalizeText(team.team_type_id)) || "Sem tipo",
        foremanName: peopleMap.get(normalizeText(team.foreman_person_id)) || "Sem encarregado",
        active: Boolean(team.ativo),
      },
    ]),
  );
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
    "service_description",
    "partner_text",
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
    .order("sob", { ascending: true })
    .returns<ProjectRow[]>();

  if (!primary.error) {
    return (primary.data ?? []).filter((project) => !isEmergencyServiceType(project.service_type_text));
  }

  const fallback = await supabase
    .from("project_with_labels")
    .select("id, sob, execution_deadline, service_center_text, service_type_text, city_text, priority_text, is_active")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("sob", { ascending: true })
    .returns<ProjectRow[]>();

  if (fallback.error) {
    throw new Error("Falha ao carregar projetos para o Mapa de Programacao.");
  }

  return (fallback.data ?? [])
    .map((item) => ({
      ...item,
      is_test: false,
      is_withdrawn: false,
    }))
    .filter((project) => !isEmergencyServiceType(project.service_type_text));
}

async function fetchProgrammingRows(supabase: SupabaseClient, tenantId: string, windowStart: string) {
  const { data, error } = await supabase
    .from("project_programming")
    .select("id, project_id, team_id, status, execution_date, etapa_number, etapa_unica, etapa_final, work_completion_status, cancellation_reason, note, created_at, updated_at")
    .eq("tenant_id", tenantId)
    .not("project_id", "is", null)
    .gte("execution_date", windowStart)
    .limit(5000)
    .returns<ProgrammingRow[]>();

  if (error) {
    throw new Error("Falha ao carregar historico geral de Programacao.");
  }

  return data ?? [];
}

async function fetchWorkCompletionCatalog(supabase: SupabaseClient, tenantId: string) {
  const { data, error } = await supabase
    .from("programming_work_completion_catalog")
    .select("code, label_pt")
    .eq("tenant_id", tenantId)
    .returns<WorkCompletionCatalogRow[]>();

  if (error) {
    return new Map<string, string>();
  }

  return new Map(
    (data ?? [])
      .map((item) => [normalizeToken(item.code), normalizeText(item.label_pt) || normalizeText(item.code)] as const)
      .filter(([code]) => Boolean(code)),
  );
}

async function fetchTeams(supabase: SupabaseClient, tenantId: string) {
  const { data: teams, error } = await supabase
    .from("teams")
    .select("id, name, vehicle_plate, service_center_id, team_type_id, foreman_person_id, ativo")
    .eq("tenant_id", tenantId)
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

  return buildTeamLookup(teamRows, teamTypeMap, peopleMap, serviceCenterMap);
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
    .in("status", Array.from(ACTIVE_PROGRAMMING_STATUSES))
    .returns<TeamProgrammingRow[]>();

  if (error) {
    throw new Error("Falha ao carregar programacoes das equipes no periodo.");
  }

  return new Set((data ?? []).map((item) => normalizeText(item.team_id)).filter(Boolean));
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
  const startDate = normalizeIsoDate(request.nextUrl.searchParams.get("startDate"));
  const endDate = normalizeIsoDate(request.nextUrl.searchParams.get("endDate"));
  const hasTeamPeriod = Boolean(startDate && endDate);

  if ((startDate && !endDate) || (!startDate && endDate)) {
    return NextResponse.json({ message: "Informe data inicial e data final, ou deixe as duas em branco." }, { status: 400 });
  }

  if (startDate && endDate && endDate < startDate) {
    return NextResponse.json({ message: "Data final deve ser maior ou igual a data inicial." }, { status: 400 });
  }

  try {
    const programmingWindowStartDate = new Date();
    programmingWindowStartDate.setUTCMonth(programmingWindowStartDate.getUTCMonth() - 18);
    const programmingWindowStart = toIsoDate(programmingWindowStartDate);

    const [projects, programmingRows, workCompletionLabelMap, teamMap] = await Promise.all([
      fetchProjects(resolution.supabase, resolution.appUser.tenant_id),
      fetchProgrammingRows(resolution.supabase, resolution.appUser.tenant_id, programmingWindowStart),
      fetchWorkCompletionCatalog(resolution.supabase, resolution.appUser.tenant_id),
      fetchTeams(resolution.supabase, resolution.appUser.tenant_id),
    ]);

    const validProjectMap = new Map(projects.map((project) => [project.id, project]));
    const programmingByProject = new Map<string, ProgrammingRow[]>();

    for (const row of programmingRows) {
      const projectId = normalizeText(row.project_id);
      if (!projectId || !validProjectMap.has(projectId)) continue;
      const rows = programmingByProject.get(projectId) ?? [];
      rows.push(row);
      programmingByProject.set(projectId, rows);
    }

    const consolidatedProjects = projects
      .map((project) => {
        const projectRows = (programmingByProject.get(project.id) ?? []).sort(compareProgrammingRows);
        const latest = projectRows.at(-1) ?? null;
        const latestDate = normalizeIsoDate(latest?.execution_date) ?? "";
        const daysSinceLatest = latestDate ? diffInDays(today, latestDate) : null;
        const latestWorkCompletion = projectRows
          .filter((row) => normalizeToken(row.work_completion_status))
          .at(-1) ?? null;
        const workCompletionStatus = latestWorkCompletion?.work_completion_status
          ? normalizeToken(latestWorkCompletion.work_completion_status)
          : null;
        const workCompletionLabel = workCompletionStatus
          ? workCompletionLabelMap.get(workCompletionStatus) ?? workCompletionStatus
          : "Nao informado";
        const latestProgrammingStatus = normalizeToken(latest?.status) || "SEM_PROGRAMACAO";
        const latestTeam = latest?.team_id ? teamMap.get(latest.team_id) : null;
        const stageKeys = new Set(projectRows.map(resolveStageKey).filter(Boolean));
        const stageReviewIssue = resolveStageReviewIssue(projectRows);
        const stageReviewRequired = Boolean(stageReviewIssue);
        const hasFutureActiveProgramming = projectRows.some((row) => {
          const executionDate = normalizeIsoDate(row.execution_date);
          return Boolean(executionDate && executionDate >= today && isActiveProgrammingStatus(row.status));
        });
        const completed = isCompletedWorkStatus(workCompletionStatus);
        const interrupted = latest
          ? (isInterruptedStatus(latest.status) || isInterruptedStatus(workCompletionStatus)) && !completed
          : false;
        const withoutStatus = Boolean(latest && !workCompletionStatus && (!latestDate || (daysSinceLatest !== null && daysSinceLatest > 0)));
        const actionRequired = stageReviewRequired || (!completed && (!hasFutureActiveProgramming || interrupted || withoutStatus));

        return {
          id: project.id,
          sob: normalizeText(project.sob) || project.id,
          projectName: normalizeText(project.service_description) || normalizeText(project.service_type_text) || "Sem descricao",
          contract: normalizeText(project.partner_text) || "Sem contrato",
          serviceCenter: normalizeText(project.service_center_text) || "Sem base",
          priority: normalizeText(project.priority_text) || "Sem prioridade",
          serviceType: normalizeText(project.service_type_text) || "Sem tipo",
          city: normalizeText(project.city_text) || "Sem municipio",
          executionDeadline: normalizeIsoDate(project.execution_deadline) ?? "",
          latestProgrammingId: latest?.id ?? null,
          latestDate,
          latestProgrammingStatus,
          latestWorkCompletionStatus: workCompletionStatus,
          latestWorkCompletionLabel: workCompletionLabel,
          latestTeamName: latestTeam?.name ?? (latest?.team_id ? latest.team_id : "Sem equipe"),
          latestForemanName: latestTeam?.foremanName ?? "Sem encarregado",
          latestStageLabel: resolveStageLabel(latest),
          programmingCount: projectRows.length,
          stageCount: stageKeys.size,
          reason: normalizeText(latest?.cancellation_reason) || normalizeText(latest?.note),
          daysSinceLatest,
          priorityLevel: stageReviewRequired
            ? ("INCONSISTENCY" satisfies PriorityLevel)
            : latest
              ? resolvePriorityLevel({ latestDate, daysSinceLatest, workCompletionStatus })
              : ("ATTENTION" satisfies PriorityLevel),
          stageReviewRequired,
          stageReviewStageLabel: stageReviewIssue?.interruptedStageLabel ?? "",
          stageReviewNextStageLabel: stageReviewIssue?.nextActiveStageLabel ?? "",
          stageReviewStatus: stageReviewIssue?.interruptedStatus ?? "",
          stageReviewDate: stageReviewIssue?.interruptedDate ?? "",
          hasFutureActiveProgramming,
          completed,
          interrupted,
          withoutStatus,
          actionRequired,
          neverProgrammed: projectRows.length === 0,
        };
      })
      .sort((left, right) => {
        const leftPriority = left.priorityLevel === "INCONSISTENCY" ? 0 : left.priorityLevel === "PRIORITY" ? 1 : left.priorityLevel === "ATTENTION" ? 2 : 3;
        const rightPriority = right.priorityLevel === "INCONSISTENCY" ? 0 : right.priorityLevel === "PRIORITY" ? 1 : right.priorityLevel === "ATTENTION" ? 2 : 3;
        return leftPriority - rightPriority
          || (right.daysSinceLatest ?? -99999) - (left.daysSinceLatest ?? -99999)
          || left.sob.localeCompare(right.sob);
      });

    const buildCard = (key: ProjectSituationKey, title: string, description: string, projectsForCard: typeof consolidatedProjects) => ({
      key,
      title,
      description,
      count: projectsForCard.length,
      projects: projectsForCard,
    });

    const statusCards = [
      buildCard("PORTFOLIO", "Carteira valida", "Obras ativas sem teste, retiradas ou emergenciais.", consolidatedProjects),
      buildCard("CONCLUDED", "Concluidas", "Ultimo Estado Trabalho valido concluido.", consolidatedProjects.filter((project) => project.completed)),
      buildCard("TO_REPROGRAM", "Para reprogramar", "Ultimo Estado Trabalho valido nao concluido e sem programacao futura ativa.", consolidatedProjects.filter((project) => !project.neverProgrammed && project.actionRequired && !project.stageReviewRequired)),
      buildCard("REVIEW_STAGES", "Revisao de etapas", "Etapa cancelada ou adiada com etapa futura ativa.", consolidatedProjects.filter((project) => project.stageReviewRequired)),
      buildCard("PENDING", "Pendentes", "Ultimo Estado Trabalho valido com pendencia.", consolidatedProjects.filter((project) => isPendingWorkStatus(project.latestWorkCompletionStatus))),
      buildCard("PARTIAL_PLANNED", "Parcial planejada", "Ultimo Estado Trabalho valido parcial planejado.", consolidatedProjects.filter((project) => isPartialPlannedWorkStatus(project.latestWorkCompletionStatus))),
      buildCard("PARTIAL", "Parciais", "Ultimo Estado Trabalho valido parcial.", consolidatedProjects.filter((project) => isPartialWorkStatus(project.latestWorkCompletionStatus))),
      buildCard("BENEFIT_REACHED", "Beneficio atingido", "Beneficio atingido sem conclusao marcada.", consolidatedProjects.filter((project) => !project.completed && isBenefitReachedWorkStatus(project.latestWorkCompletionStatus))),
      buildCard("INTERRUPTED", "Canceladas/adiadas", "Ultima programacao cancelada ou adiada sem continuidade posterior.", consolidatedProjects.filter((project) => project.interrupted && !project.hasFutureActiveProgramming)),
      buildCard("WITHOUT_STATUS", "Sem Estado Trabalho", "Sem Estado Trabalho valido em programacao vencida.", consolidatedProjects.filter((project) => project.withoutStatus)),
      buildCard("NEVER_PROGRAMMED", "Nunca programadas", "Obras validas sem historico em Programacao.", consolidatedProjects.filter((project) => project.neverProgrammed)),
    ];

    const activeTeams = Array.from(teamMap.values()).filter((team) => team.active);
    const programmedTeamIds = hasTeamPeriod && startDate && endDate
      ? await fetchProgrammedTeamIds({
          supabase: resolution.supabase,
          tenantId: resolution.appUser.tenant_id,
          startDate,
          endDate,
        })
      : new Set<string>();
    const teamsWithoutProgramming = hasTeamPeriod
      ? activeTeams.filter((team) => !programmedTeamIds.has(team.id))
      : [];

    return NextResponse.json({
      filters: {
        startDate,
        endDate,
        generatedAt: new Date().toISOString(),
        teamPeriodEnabled: hasTeamPeriod,
      },
      summary: {
        portfolioProjectCount: consolidatedProjects.length,
        actionRequiredProjectCount: consolidatedProjects.filter((project) => project.actionRequired || project.neverProgrammed).length,
        concludedProjectCount: consolidatedProjects.filter((project) => project.completed).length,
        toReprogramProjectCount: consolidatedProjects.filter((project) => !project.neverProgrammed && project.actionRequired && !project.stageReviewRequired).length,
        stageReviewProjectCount: consolidatedProjects.filter((project) => project.stageReviewRequired).length,
        neverProgrammedProjectCount: consolidatedProjects.filter((project) => project.neverProgrammed).length,
        interruptedProjectCount: consolidatedProjects.filter((project) => project.interrupted && !project.hasFutureActiveProgramming).length,
        withoutStatusProjectCount: consolidatedProjects.filter((project) => project.withoutStatus).length,
        activeTeamCount: activeTeams.length,
        teamsWithoutProgrammingCount: teamsWithoutProgramming.length,
        programmedTeamCount: hasTeamPeriod ? activeTeams.length - teamsWithoutProgramming.length : 0,
      },
      statusCards,
      priorityProjects: consolidatedProjects.filter((project) => project.actionRequired && !project.neverProgrammed),
      neverProgrammedProjects: consolidatedProjects.filter((project) => project.neverProgrammed),
      teamsWithoutProgramming,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao carregar Mapa de Programacao.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
