import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";

import { resolveAuthenticatedAppUser, type AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";
import { requirePageAction } from "@/lib/server/pageAuthorization";
import {
  fetchProgrammingStagesForMap,
  fetchTeamIdsProgrammedInPeriod,
  type ProgrammingMapStageRow,
} from "@/server/modules/programacao-normalizada";

const MAP_PROGRAMMING_PAGE_KEY = "mapa-programacao";
const ACTIVE_PROGRAMMING_STATUSES = new Set(["PROGRAMADA", "REPROGRAMADA"]);
const INTERRUPTED_PROGRAMMING_STATUSES = new Set(["CANCELADA", "ADIADA"]);

type ProjectSituationKey =
  | "PORTFOLIO"
  | "CONCLUDED"
  | "TO_REPROGRAM"
  | "PENDING"
  | "PARTIAL_PLANNED"
  | "PARTIAL"
  | "BENEFIT_REACHED"
  | "INTERRUPTED"
  | "WITHOUT_STATUS"
  | "NEVER_PROGRAMMED"
  | "WITHDRAWN";

// Escopo por Tipo de Servico. `MANUTENCAO` agrupa emergencial + manutencao e
// `OBRAS` traz todo o resto; nao existe visao misturando os dois, porque os
// indicadores de carteira e prazo tem leitura operacional diferente em cada um.
//
// A classificacao e por texto do Tipo de Servico, e `project_service_types` e
// catalogo por tenant, editavel na tela `/tipo-servico` (a migration 031 apenas
// semeou o que ja existia como texto livre em `project.service_type`). Ou seja:
// tipo novo cadastrado amanha cai em `OBRAS` por omissao. Parametrizar essa
// classificacao esta anotado como melhoria futura no doc da tela.
type ServiceScope = "OBRAS" | "MANUTENCAO";

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
  is_third_party?: boolean | null;
};

type ProgrammingRow = ProgrammingMapStageRow;

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

// `MANUTENCAO` casa por substring normalizada, entao pega tanto `EMERGENCIAL`
// quanto `MANUTENCAO` e suas variacoes (`MANUTENCAO PREVENTIVA`,
// `OBRA EMERGENCIAL`). Tudo que nao casa aqui e `OBRAS`.
function isMaintenanceServiceType(value: unknown) {
  const token = normalizeToken(value);
  return token.includes("EMERGENCIAL") || token.includes("MANUTENCAO");
}

function parseServiceScope(value: unknown): ServiceScope {
  return normalizeToken(value) === "MANUTENCAO" ? "MANUTENCAO" : "OBRAS";
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

function resolveStageLabel(row: ProgrammingRow | null) {
  if (!row) return "Sem etapa";
  if (row.etapa_final) return "Etapa final";
  if (row.etapa_unica) return "Etapa unica";
  const stageNumber = Number(row.etapa_number ?? 0);
  return Number.isInteger(stageNumber) && stageNumber > 0 ? `${stageNumber} etapa` : "Sem etapa";
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
    "is_third_party",
  ].join(", ");

  // Terceiros ficam fora do Mapa inteiro (nem carteira, nem card de apoio).
  // `is_withdrawn` NAO e cortado aqui: as retiradas viram card proprio e sao
  // separadas da `Carteira valida` na consolidacao, nunca somadas a ela.
  // O Tipo de Servico tambem nao e cortado aqui: virou o escopo `serviceScope`.
  //
  // Nao existe mais fallback sem as flags: `is_withdrawn` (migration 174) e
  // `is_third_party` (migration 307) sao `not null` na view `project_with_labels`,
  // e um fallback que assumia `false` para as duas passaria a reportar zero
  // retiradas e a incluir terceiros em silencio quando a consulta falhasse.
  const { data, error } = await supabase
    .from("project_with_labels")
    .select(selectWithFlags)
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .eq("is_test", false)
    .eq("is_third_party", false)
    .order("sob", { ascending: true })
    .returns<ProjectRow[]>();

  if (error) {
    throw new Error("Falha ao carregar projetos para o Mapa de Programacao.");
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

type ConsolidationContext = {
  today: string;
  programmingByProject: Map<string, ProgrammingRow[]>;
  workCompletionLabelMap: Map<string, string>;
  teamMap: ReturnType<typeof buildTeamLookup>;
};

// Consolida uma obra por linha a partir do historico de Programacao. Roda duas
// vezes com o mesmo contexto: uma para a carteira e outra para as retiradas, que
// precisam dos mesmos campos na tabela do card mas nao podem entrar nos
// indicadores da `Carteira valida`.
function consolidateProjects(projects: ProjectRow[], context: ConsolidationContext) {
  const { today, programmingByProject, workCompletionLabelMap, teamMap } = context;

  return projects
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
      // Etapa (linha de `programming`) tem N equipes em `programming_team`, nao
      // mais uma so (achado da auditoria: mostrar uma equipe so escondia as
      // demais quando a etapa tinha mais de uma equipe ativa).
      const latestActiveTeamIds = (latest?.programming_team ?? [])
        .filter((team) => team.status === "ATIVA")
        .map((team) => normalizeText(team.team_id))
        .filter(Boolean);
      const latestTeamNames = Array.from(new Set(latestActiveTeamIds.map((teamId) => teamMap.get(teamId)?.name ?? teamId)));
      const latestForemanNames = Array.from(
        new Set(latestActiveTeamIds.map((teamId) => teamMap.get(teamId)?.foremanName ?? "Sem encarregado")),
      );
      // `programmingCount` (linhas legadas, uma por equipe) e `stageCount`
      // (chaves distintas de etapa) colapsam no modelo normalizado: uma linha
      // de `programming` JA E uma etapa. O dado novo e util e a contagem de
      // equipes distintas que passaram pela Programacao do projeto.
      const distinctTeamIds = new Set(
        projectRows.flatMap((row) => (row.programming_team ?? []).map((team) => normalizeText(team.team_id)).filter(Boolean)),
      );
      // Pendencia (achado da auditoria): a migration 318 tirou PENDENCIA de
      // `work_completion_status` e virou a flag `is_pendencia`. "Aberta" segue a
      // mesma definicao usada no chip da lista de Programacao Normalizada
      // (queries.ts): flag ligada, etapa ativa e ainda nao concluida.
      const hasOpenPendencia = projectRows.some(
        (row) => row.is_pendencia && isActiveProgrammingStatus(row.status) && normalizeToken(row.work_completion_status) !== "CONCLUIDO",
      );
      const hasFutureActiveProgramming = projectRows.some((row) => {
        const executionDate = normalizeIsoDate(row.execution_date);
        return Boolean(executionDate && executionDate >= today && isActiveProgrammingStatus(row.status));
      });
      const completed = isCompletedWorkStatus(workCompletionStatus);
      const interrupted = latest
        ? (isInterruptedStatus(latest.status) || isInterruptedStatus(workCompletionStatus)) && !completed
        : false;
      const withoutStatus = Boolean(latest && !workCompletionStatus && (!latestDate || (daysSinceLatest !== null && daysSinceLatest > 0)));
      const actionRequired = !completed && (!hasFutureActiveProgramming || interrupted || withoutStatus);

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
        isWithdrawn: project.is_withdrawn === true,
        latestProgrammingId: latest?.id ?? null,
        latestDate,
        latestProgrammingStatus,
        latestWorkCompletionStatus: workCompletionStatus,
        latestWorkCompletionLabel: workCompletionLabel,
        latestTeamNames: latestTeamNames.length ? latestTeamNames : ["Sem equipe"],
        latestForemanNames: latestForemanNames.length ? latestForemanNames : ["Sem encarregado"],
        latestStageLabel: resolveStageLabel(latest),
        stageCount: projectRows.length,
        teamCount: distinctTeamIds.size,
        hasOpenPendencia,
        reason: normalizeText(latest?.cancellation_reason) || normalizeText(latest?.note),
        daysSinceLatest,
        priorityLevel: latest
          ? resolvePriorityLevel({ latestDate, daysSinceLatest, workCompletionStatus })
          : ("ATTENTION" satisfies PriorityLevel),
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
}

type ConsolidatedProject = ReturnType<typeof consolidateProjects>[number];

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
  const serviceScope = parseServiceScope(request.nextUrl.searchParams.get("serviceScope"));
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

    const [allProjects, programmingRows, workCompletionLabelMap, teamMap] = await Promise.all([
      fetchProjects(resolution.supabase, resolution.appUser.tenant_id),
      fetchProgrammingStagesForMap({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        sinceDate: programmingWindowStart,
      }),
      fetchWorkCompletionCatalog(resolution.supabase, resolution.appUser.tenant_id),
      fetchTeams(resolution.supabase, resolution.appUser.tenant_id),
    ]);

    // O escopo por Tipo de Servico vale para a tela inteira: `OBRAS` e o
    // complemento exato de `MANUTENCAO`, entao nenhuma obra fica sem escopo e
    // nenhuma aparece nos dois.
    const scopedProjects = allProjects.filter(
      (project) => isMaintenanceServiceType(project.service_type_text) === (serviceScope === "MANUTENCAO"),
    );
    // `Carteira valida` = escopo atual sem retiradas (terceiros e teste ja
    // ficaram na consulta). As retiradas seguem para um card separado.
    const portfolioSource = scopedProjects.filter((project) => project.is_withdrawn !== true);
    const withdrawnSource = scopedProjects.filter((project) => project.is_withdrawn === true);

    const validProjectMap = new Map(scopedProjects.map((project) => [project.id, project]));
    const programmingByProject = new Map<string, ProgrammingRow[]>();

    for (const row of programmingRows) {
      const projectId = normalizeText(row.project_id);
      if (!projectId || !validProjectMap.has(projectId)) continue;
      const rows = programmingByProject.get(projectId) ?? [];
      rows.push(row);
      programmingByProject.set(projectId, rows);
    }

    const consolidationContext: ConsolidationContext = {
      today,
      programmingByProject,
      workCompletionLabelMap,
      teamMap,
    };
    const consolidatedProjects = consolidateProjects(portfolioSource, consolidationContext);
    const withdrawnProjects = consolidateProjects(withdrawnSource, consolidationContext);

    const buildCard = (key: ProjectSituationKey, title: string, description: string, projectsForCard: ConsolidatedProject[]) => ({
      key,
      title,
      description,
      count: projectsForCard.length,
      projects: projectsForCard,
    });

    const statusCards = [
      buildCard(
        "PORTFOLIO",
        "Carteira valida",
        serviceScope === "MANUTENCAO"
          ? "Manutencao e emergencial ativas, sem teste, terceiros ou retiradas."
          : "Obras ativas sem teste, terceiros, retiradas, manutencao ou emergencial.",
        consolidatedProjects,
      ),
      buildCard("CONCLUDED", "Concluidas", "Ultimo Estado Trabalho valido concluido.", consolidatedProjects.filter((project) => project.completed)),
      buildCard("TO_REPROGRAM", "Para reprogramar", "Ultimo Estado Trabalho valido nao concluido e sem programacao futura ativa.", consolidatedProjects.filter((project) => !project.neverProgrammed && project.actionRequired)),
      buildCard("PENDING", "Pendentes", "Programacao ativa com pendencia aberta (nao concluida).", consolidatedProjects.filter((project) => project.hasOpenPendencia)),
      buildCard("PARTIAL_PLANNED", "Parcial planejada", "Ultimo Estado Trabalho valido parcial planejado.", consolidatedProjects.filter((project) => isPartialPlannedWorkStatus(project.latestWorkCompletionStatus))),
      buildCard("PARTIAL", "Parciais", "Ultimo Estado Trabalho valido parcial.", consolidatedProjects.filter((project) => isPartialWorkStatus(project.latestWorkCompletionStatus))),
      buildCard("BENEFIT_REACHED", "Beneficio atingido", "Beneficio atingido sem conclusao marcada.", consolidatedProjects.filter((project) => !project.completed && isBenefitReachedWorkStatus(project.latestWorkCompletionStatus))),
      buildCard("INTERRUPTED", "Canceladas/adiadas", "Ultima programacao cancelada ou adiada sem continuidade posterior.", consolidatedProjects.filter((project) => project.interrupted && !project.hasFutureActiveProgramming)),
      buildCard("WITHOUT_STATUS", "Sem Estado Trabalho", "Sem Estado Trabalho valido em programacao vencida.", consolidatedProjects.filter((project) => project.withoutStatus)),
      buildCard("NEVER_PROGRAMMED", "Nunca programadas", "Obras validas sem historico em Programacao.", consolidatedProjects.filter((project) => project.neverProgrammed)),
      buildCard("WITHDRAWN", "Retiradas da carteira", "Obras marcadas como retiradas; contadas a parte, fora da Carteira valida.", withdrawnProjects),
    ];

    const activeTeams = Array.from(teamMap.values()).filter((team) => team.active);
    const programmedTeamIds = hasTeamPeriod && startDate && endDate
      ? await fetchTeamIdsProgrammedInPeriod({
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
        serviceScope,
        generatedAt: new Date().toISOString(),
        teamPeriodEnabled: hasTeamPeriod,
      },
      // Sem bloco `summary`: ele so alimentava a faixa de indicadores do topo,
      // que repetia cards do grid e — por vir pronta do servidor — ignorava os
      // filtros locais de centro/busca, divergindo dos cards de baixo. Agora
      // todo numero da tela sai de `statusCards` passando por `filterProjects`.
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
