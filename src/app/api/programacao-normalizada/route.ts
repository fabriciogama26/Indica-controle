import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser, type AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";

import { fetchProjects, fetchServiceActivitiesByIds, fetchTeams, type BoardTeamEntry } from "@/server/modules/programacao-normalizada/catalogs";
import {
  addProgrammingTeam,
  authorizeProgrammingNormalizadaAction,
  cancelProgrammingStage,
  changeCompletedStageWorkStatus,
  completeProgrammingStage,
  getProgrammingHistoryResponse,
  postponeProgrammingStage,
  reopenProgrammingStage,
  removeProgrammingTeam,
  saveProgrammingStage,
  setProgrammingPendenciaFlag,
  setProgrammingWorkCompletionStatus,
} from "@/server/modules/programacao-normalizada/handlers";
import { normalizeIsoDate, normalizePositiveInteger, normalizeText, normalizeUniqueTextArray, resolveAppUserName } from "@/server/modules/programacao-normalizada/normalizers";
import {
  fetchAppUsersByIds,
  fetchProgrammingPlanForProject,
  fetchProgrammingStageById,
  fetchProgrammingStageList,
} from "@/server/modules/programacao-normalizada/queries";
import type {
  AppUserLookupRow,
  ProgrammingStageListStatusChip,
  ProgrammingStageRow,
  ServiceActivityRow,
} from "@/server/modules/programacao-normalizada/types";

const STAGE_LIST_STATUS_CHIPS: ProgrammingStageListStatusChip[] = ["TODAS", "PROGRAMADAS", "PENDENCIAS", "ATRASADAS", "ADIADAS"];
const STAGE_LIST_MAX_PAGE_SIZE = 100;
// Exportacao (CSV/ENEL/ENEL NOVO) ignora a paginacao de tela e busca tudo que
// bate no filtro atual, ate este teto (guia_backend regra 26 — limite explicito).
const STAGE_LIST_EXPORT_MAX_ROWS = 5000;

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

async function getProgrammingStageListResponse(request: NextRequest, resolution: AuthenticatedAppUserContext) {
  const params = request.nextUrl.searchParams;
  const today = todayIsoDate();

  const dateFrom = normalizeIsoDate(params.get("dateFrom")) ?? today;
  const dateTo = normalizeIsoDate(params.get("dateTo")) ?? today;
  const statusChipRaw = normalizeText(params.get("statusChip")).toUpperCase() as ProgrammingStageListStatusChip;
  const statusChip = STAGE_LIST_STATUS_CHIPS.includes(statusChipRaw) ? statusChipRaw : "TODAS";
  const teamIds = normalizeUniqueTextArray(normalizeText(params.get("teamIds")).split(",").filter(Boolean));
  const search = normalizeText(params.get("search")).toLowerCase();
  const municipality = normalizeText(params.get("municipality")).toLowerCase();
  const isExportRequest = params.get("forExport") === "1";
  const page = isExportRequest ? 1 : normalizePositiveInteger(params.get("page")) ?? 1;
  const pageSize = isExportRequest
    ? STAGE_LIST_EXPORT_MAX_ROWS
    : Math.min(normalizePositiveInteger(params.get("pageSize")) ?? 50, STAGE_LIST_MAX_PAGE_SIZE);

  const allProjects = await fetchProjects(resolution.supabase, resolution.appUser.tenant_id);

  let projectIdsFromSearch: string[] | null = null;
  if (search || municipality) {
    const matches = allProjects.filter((project) => {
      const matchesSearch = search ? project.sob.toLowerCase().includes(search) : true;
      const matchesMunicipality = municipality ? project.city_text.toLowerCase().includes(municipality) : true;
      return matchesSearch && matchesMunicipality;
    });
    projectIdsFromSearch = matches.map((project) => project.id);
  }

  let rows: ProgrammingStageRow[] = [];
  let total = 0;
  try {
    const result = await fetchProgrammingStageList({
      supabase: resolution.supabase,
      filters: { tenantId: resolution.appUser.tenant_id, dateFrom, dateTo, statusChip, teamIds, search, municipality, page, pageSize },
      projectIdsFromSearch,
    });
    rows = result.rows;
    total = result.total;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao carregar lista da Programacao Normalizada.";
    return NextResponse.json({ message }, { status: 500 });
  }

  const projectMap = new Map(allProjects.map((project) => [project.id, project]));
  const allTeamIds = Array.from(new Set(rows.flatMap((row) => (row.programming_team ?? []).map((team) => team.team_id))));
  const allActivityIds = Array.from(new Set(rows.flatMap((row) => (row.programming_activity ?? []).map((activity) => activity.service_activity_id))));
  const allUserIds = rows.flatMap((row) => [row.created_by, row.updated_by]);
  const [teams, activities, users] = await Promise.all([
    fetchTeams(resolution.supabase, resolution.appUser.tenant_id),
    fetchServiceActivitiesByIds(resolution.supabase, resolution.appUser.tenant_id, allActivityIds),
    fetchAppUsersByIds({ supabase: resolution.supabase, tenantId: resolution.appUser.tenant_id, ids: allUserIds }),
  ]);
  const teamMap = new Map(teams.filter((team) => allTeamIds.includes(team.id)).map((team) => [team.id, team]));
  const activityMap = new Map(activities.map((activity) => [activity.id, activity]));
  const userMap = new Map(users.map((user) => [user.id, user]));

  const list = rows.map((row) => {
    const project = projectMap.get(row.project_id);
    return {
      ...mapStageRowToDto(row, teamMap, activityMap, userMap),
      projectCode: normalizeText(project?.sob) || row.project_id,
      city: normalizeText(project?.city_text),
    };
  });

  // Truncamento (achado 13): no export (page 1, pageSize = teto) a lista pagina
  // por PROJETO. Se ha mais projetos que o teto, o export saiu parcial.
  const returnedProjectCount = new Set(list.map((item) => item.projectId)).size;
  const truncated = isExportRequest && total > returnedProjectCount;

  return NextResponse.json({ list, total, page, pageSize, dateFrom, dateTo, truncated });
}

function mapStageRowToDto(
  stage: ProgrammingStageRow,
  teamMap: Map<string, BoardTeamEntry>,
  activityMap: Map<string, ServiceActivityRow>,
  userMap: Map<string, AppUserLookupRow>,
) {
  return {
    id: stage.id,
    projectId: stage.project_id,
    executionDate: stage.execution_date,
    etapaNumber: stage.etapa_number,
    etapaUnica: stage.etapa_unica,
    etapaFinal: stage.etapa_final,
    status: stage.status,
    workCompletionStatus: stage.work_completion_status,
    isPendencia: stage.is_pendencia === true,
    serviceDescription: normalizeText(stage.service_description),
    period: stage.period,
    startTime: stage.start_time,
    endTime: stage.end_time,
    expectedMinutes: stage.expected_minutes,
    outageStartTime: stage.outage_start_time,
    outageEndTime: stage.outage_end_time,
    feeder: normalizeText(stage.feeder),
    campoEletrico: normalizeText(stage.campo_eletrico),
    affectedCustomers: stage.affected_customers,
    sgdTypeId: stage.sgd_type_id,
    electricalEqCatalogId: stage.electrical_eq_catalog_id,
    support: normalizeText(stage.support),
    supportItemId: stage.support_item_id,
    posteQty: Number(stage.poste_qty ?? 0),
    estruturaQty: Number(stage.estrutura_qty ?? 0),
    trafoQty: Number(stage.trafo_qty ?? 0),
    redeQty: Number(stage.rede_qty ?? 0),
    note: normalizeText(stage.note),
    resolvePendenciaDeId: stage.resolve_pendencia_de_id,
    copiedFromId: stage.copied_from_id,
    anticipatedById: stage.anticipated_by_id,
    anticipatedAt: stage.anticipated_at,
    cancellationReason: normalizeText(stage.cancellation_reason),
    canceledAt: stage.canceled_at,
    createdByName: resolveAppUserName(userMap.get(stage.created_by ?? "")),
    createdAt: stage.created_at,
    updatedByName: resolveAppUserName(userMap.get(stage.updated_by ?? "")),
    updatedAt: stage.updated_at,
    teams: (stage.programming_team ?? []).map((team) => ({
      id: team.id,
      teamId: team.team_id,
      teamName: teamMap.get(team.team_id)?.name ?? team.team_id,
      status: team.status,
      updatedAt: team.updated_at,
    })),
    activities: (stage.programming_activity ?? []).map((activity) => ({
      id: activity.id,
      serviceActivityId: activity.service_activity_id,
      code: normalizeText(activityMap.get(activity.service_activity_id)?.code),
      description: normalizeText(activityMap.get(activity.service_activity_id)?.description),
      unit: normalizeText(activityMap.get(activity.service_activity_id)?.unit),
      quantity: Number(activity.quantity ?? 0),
    })),
    documents: (stage.programming_document ?? []).map((document) => ({
      id: document.id,
      documentType: document.document_type,
      number: normalizeText(document.number),
      includedAt: document.included_at,
      deliveredAt: document.delivered_at,
    })),
  };
}

async function getProgrammingStageDetailsResponse(request: NextRequest, resolution: AuthenticatedAppUserContext, programmingId: string) {
  const stage = await fetchProgrammingStageById({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    programmingId,
  });

  if (!stage) {
    return NextResponse.json({ message: "Etapa nao encontrada." }, { status: 404 });
  }

  const teamIds = (stage.programming_team ?? []).map((team) => team.team_id);
  const activityIds = (stage.programming_activity ?? []).map((activity) => activity.service_activity_id);

  const [teams, activities, users] = await Promise.all([
    fetchTeams(resolution.supabase, resolution.appUser.tenant_id),
    fetchServiceActivitiesByIds(resolution.supabase, resolution.appUser.tenant_id, activityIds),
    fetchAppUsersByIds({ supabase: resolution.supabase, tenantId: resolution.appUser.tenant_id, ids: [stage.created_by, stage.updated_by] }),
  ]);

  const teamMap = new Map(teams.filter((team) => teamIds.includes(team.id)).map((team) => [team.id, team]));
  const activityMap = new Map(activities.map((activity) => [activity.id, activity]));
  const userMap = new Map(users.map((user) => [user.id, user]));

  return NextResponse.json({ stage: mapStageRowToDto(stage, teamMap, activityMap, userMap) });
}

export async function GET(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para consultar programacao.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const authorizationError = await authorizeProgrammingNormalizadaAction(resolution, "read");
  if (authorizationError) return authorizationError;

  const historyProgrammingId = normalizeText(request.nextUrl.searchParams.get("historyProgrammingId"));
  if (historyProgrammingId) {
    return getProgrammingHistoryResponse(request, historyProgrammingId);
  }

  const detailsProgrammingId = normalizeText(request.nextUrl.searchParams.get("programmingId"));
  if (detailsProgrammingId) {
    return getProgrammingStageDetailsResponse(request, resolution, detailsProgrammingId);
  }

  const projectId = normalizeText(request.nextUrl.searchParams.get("projectId"));
  if (!projectId) {
    return getProgrammingStageListResponse(request, resolution);
  }

  const stages = await fetchProgrammingPlanForProject({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    projectId,
  });

  const teamIds = Array.from(new Set(stages.flatMap((stage) => (stage.programming_team ?? []).map((team) => team.team_id))));
  const activityIds = Array.from(
    new Set(stages.flatMap((stage) => (stage.programming_activity ?? []).map((activity) => activity.service_activity_id))),
  );

  const allUserIds = stages.flatMap((stage) => [stage.created_by, stage.updated_by]);
  const [teams, activities, users] = await Promise.all([
    fetchTeams(resolution.supabase, resolution.appUser.tenant_id),
    fetchServiceActivitiesByIds(resolution.supabase, resolution.appUser.tenant_id, activityIds),
    fetchAppUsersByIds({ supabase: resolution.supabase, tenantId: resolution.appUser.tenant_id, ids: allUserIds }),
  ]);

  const teamMap = new Map(teams.filter((team) => teamIds.includes(team.id)).map((team) => [team.id, team]));
  const activityMap = new Map(activities.map((activity) => [activity.id, activity]));
  const userMap = new Map(users.map((user) => [user.id, user]));

  const plan = stages.map((stage) => mapStageRowToDto(stage, teamMap, activityMap, userMap));

  return NextResponse.json({ plan });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = normalizeText(body?.action).toUpperCase();
  const clonedRequest = new NextRequest(request.url, {
    method: request.method,
    headers: request.headers,
    body: JSON.stringify(body ?? {}),
  });

  if (action === "ADD_TEAM") {
    return addProgrammingTeam(clonedRequest);
  }

  return saveProgrammingStage(clonedRequest, "POST");
}

export async function PUT(request: NextRequest) {
  return saveProgrammingStage(request, "PUT");
}

export async function PATCH(request: NextRequest) {
  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = normalizeText(payload?.action).toUpperCase();

  if (action === "REMOVE_TEAM") return removeProgrammingTeam(request, payload ?? {});
  if (action === "POSTPONE") return postponeProgrammingStage(request, payload ?? {});
  if (action === "CANCEL") return cancelProgrammingStage(request, payload ?? {});
  if (action === "COMPLETE") return completeProgrammingStage(request, payload ?? {});
  if (action === "REOPEN") return reopenProgrammingStage(request, payload ?? {});
  if (action === "SET_WORK_COMPLETION_STATUS") return setProgrammingWorkCompletionStatus(request, payload ?? {});
  if (action === "CHANGE_COMPLETED_WORK_STATUS") return changeCompletedStageWorkStatus(request, payload ?? {});
  if (action === "SET_PENDENCIA") return setProgrammingPendenciaFlag(request, payload ?? {});

  return NextResponse.json({ message: "Acao invalida." }, { status: 400 });
}
