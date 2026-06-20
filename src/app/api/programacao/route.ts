import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";

import { resolveAuthenticatedAppUser, type AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";
import { requirePageAction, type PageAction } from "@/lib/server/pageAuthorization";
import {
  BOARD_PROJECT_SELECT_LEGACY,
  BOARD_PROJECT_SELECT_WITH_TEST,
  PROGRAMMING_SELECT_WITH_OUTAGE_STRUCTURE_AND_ENEL,
} from "@/server/modules/programacao/selects";
import type {
  AppUserLookupRow,
  BatchCreateProgrammingPayload,
  BatchCreateProgrammingResponse,
  BatchProgrammingRpcItem,
  BatchProgrammingRpcResult,
  BoardProjectBaseRow,
  BoardProjectRow,
  CancelProgrammingPayload,
  CancelProgrammingRpcResult,
  CopyProgrammingPayload,
  CopyProgrammingResponse,
  CopyProgrammingToDatesPayload,
  CopyProgrammingToDatesResponse,
  ForemanConflictLookupRow,
  LocationPlanSupportRow,
  PersonRow,
  PostponeProgrammingRpcResult,
  ProgrammingActivityRow,
  ProgrammingConflictPayload,
  ProgrammingConflictRecord,
  ProgrammingEqCatalogRow,
  ProgrammingHistoryListResponse,
  ProgrammingHistoryRow,
  ProgrammingOperationalHistoryRow,
  ProgrammingReasonCatalogRow,
  ProgrammingRow,
  ProgrammingSgdTypeRow,
  ProgrammingStageValidationResponse,
  ProgrammingStageValidationTeamSummary,
  ProgrammingTimeConflictLookupRow,
  ProgrammingWorkCompletionCatalogRow,
  ProjectConcludedProgrammingContext,
  ProjectConflictLookupRow,
  SaveProgrammingPayload,
  SaveProgrammingRpcResult,
  ServiceCenterRow,
  SupportOptionRow,
  TeamConflictLookupRow,
  TeamRow,
  TeamTypeRow,
  TeamWeekSummaryRow,
  WorkCompletionStatusRpcResult,
} from "@/server/modules/programacao/types";
import {
  CATALOG_TTL_MS,
  fetchProjects,
  fetchProjectSupportDefaults,
  fetchProgrammingEqCatalog,
  fetchProgrammingReasonCatalog,
  fetchProgrammingSgdTypes,
  fetchProgrammingWorkCompletionCatalog,
  fetchSupportOptions,
  fetchTeams,
  fetchTeamsByIds,
  type BoardTeamEntry,
  type CatalogCacheEntry,
} from "@/server/modules/programacao/catalogs";
import {
  cancelProgrammingViaRpc,
  postponeProgrammingViaRpc,
  resolveInitialProjectWorkCompletionStatus,
  resolveProgrammingEqCatalog,
  resolveProgrammingSgdType,
  resolveProgrammingWorkCompletionStatus,
  saveProgrammingBatchFullViaRpc,
  saveProgrammingFullViaRpc,
  setProgrammingElectricalFieldViaRpc,
  setProgrammingEnelFieldsViaRpc,
  setProgrammingExecutionResultViaRpc,
} from "@/server/modules/programacao/rpc";
import {
  fetchNextProgrammingStage,
  fetchProgrammingActivities,
  fetchProgrammingActivitiesForSave,
  fetchProgrammingById,
  fetchProgrammingConflictPayload,
  fetchProgrammingHistory,
  fetchProgrammingResponseItem,
  fetchProgrammingRows,
  fetchProgrammingStageValidation,
  fetchProgrammingWeekSummary,
  fetchRescheduledProgrammingIds,
} from "@/server/modules/programacao/queries";
import {
  buildHistoryChangesWithDerivedExecutionDate,
  buildProjectCompletedConflictResponse,
  formatDatePtBr,
  formatTime,
  getInvalidRequestedDateLabel,
  isCompletedWorkStatus,
  isIsoDate,
  isMissingProjectTestColumn,
  isMissingRpcFunctionError,
  isNegativeNumericLikeText,
  normalizeBoolean,
  normalizeElectricalEqNumber,
  normalizeIsoDate,
  normalizeNonNegativeDecimal,
  normalizeNonNegativeInteger,
  normalizeNullableText,
  normalizeOptionalTime,
  normalizePeriod,
  normalizePositiveInteger,
  normalizePositiveNumber,
  normalizeProgrammingDocuments,
  normalizeProgrammingStructureFields,
  normalizeQuestionnaireAnswers,
  normalizeSgdNumber,
  normalizeStatusToken,
  normalizeStringArray,
  normalizeText,
  normalizeTime,
  normalizeUniqueTextArray,
  normalizeWorkCompletionStatus,
  resolveAppUserName,
  startOfWeekMonday,
} from "@/server/modules/programacao/normalizers";

const PROGRAMMING_PAGE_KEY = "programacao-simples";

async function authorizeProgrammingAction(context: AuthenticatedAppUserContext, action: PageAction) {
  const authorization = await requirePageAction({
    context,
    pageKey: PROGRAMMING_PAGE_KEY,
    action,
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


async function resolveTeamTimeConflictDetailedMessage(params: {
  supabase: SupabaseClient;
  tenantId: string;
  executionDate: string;
  startTime: string;
  endTime: string;
  teamIds: string[];
  excludeProgrammingId?: string | null;
}) {
  const uniqueTeamIds = Array.from(new Set(params.teamIds.map((value) => normalizeText(value)).filter(Boolean)));
  if (!uniqueTeamIds.length) {
    return null;
  }

  let conflictQuery = params.supabase
    .from("project_programming")
    .select("id, team_id, project_id, start_time, end_time")
    .eq("tenant_id", params.tenantId)
    .eq("execution_date", params.executionDate)
    .in("team_id", uniqueTeamIds)
    .in("status", ["PROGRAMADA", "REPROGRAMADA"])
    .lt("start_time", params.endTime)
    .gt("end_time", params.startTime)
    .order("team_id", { ascending: true })
    .order("start_time", { ascending: true })
    .limit(1);

  if (params.excludeProgrammingId) {
    conflictQuery = conflictQuery.neq("id", params.excludeProgrammingId);
  }

  const { data: conflictRows, error: conflictError } = await conflictQuery;
  if (conflictError || !Array.isArray(conflictRows) || !conflictRows.length) {
    return null;
  }

  const conflict = conflictRows[0] as ProgrammingTimeConflictLookupRow;

  const [{ data: teamRows }, { data: projectRows }] = await Promise.all([
    params.supabase
      .from("teams")
      .select("id, name, foreman_person_id")
      .eq("tenant_id", params.tenantId)
      .eq("id", conflict.team_id)
      .limit(1),
    params.supabase
      .from("project")
      .select("id, sob")
      .eq("tenant_id", params.tenantId)
      .eq("id", conflict.project_id)
      .limit(1),
  ]);

  const team = (Array.isArray(teamRows) && teamRows.length ? teamRows[0] : null) as TeamConflictLookupRow | null;
  const project = (Array.isArray(projectRows) && projectRows.length ? projectRows[0] : null) as ProjectConflictLookupRow | null;

  let foremanName = "Nao informado";
  const foremanId = normalizeText(team?.foreman_person_id);
  if (foremanId) {
    const { data: foremanRows } = await params.supabase
      .from("people")
      .select("id, nome")
      .eq("tenant_id", params.tenantId)
      .eq("id", foremanId)
      .limit(1);

    const foreman = (Array.isArray(foremanRows) && foremanRows.length ? foremanRows[0] : null) as ForemanConflictLookupRow | null;
    foremanName = normalizeText(foreman?.nome) || "Nao informado";
  }

  const teamName = normalizeText(team?.name) || conflict.team_id;
  const projectCode = normalizeText(project?.sob) || "informada";
  const conflictInterval = `${formatTime(conflict.start_time)} - ${formatTime(conflict.end_time)}`;

  return `Conflito de horario na equipe ${teamName} (Encarregado: ${foremanName}) com a obra ${projectCode}, no intervalo ${conflictInterval}.`;
}

async function resolveProjectCompletedProgrammingContext(params: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
}) {
  const { data: concludedRows, error: concludedError } = await params.supabase
    .from("project_programming")
    .select("id, execution_date, team_id, work_completion_status, updated_at")
    .eq("tenant_id", params.tenantId)
    .eq("project_id", params.projectId)
    .not("work_completion_status", "is", null)
    .order("execution_date", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(50);

  if (concludedError || !Array.isArray(concludedRows) || !concludedRows.length) {
    return null;
  }

  const concluded = concludedRows.find((row) => isCompletedWorkStatus(row.work_completion_status));
  if (!concluded) {
    return null;
  }

  const { data: teamRows } = await params.supabase
    .from("teams")
    .select("id, name, foreman_person_id")
    .eq("tenant_id", params.tenantId)
    .eq("id", concluded.team_id)
    .limit(1);

  const team = (Array.isArray(teamRows) && teamRows.length ? teamRows[0] : null) as TeamConflictLookupRow | null;

  let foremanName = "Nao informado";
  const foremanId = normalizeText(team?.foreman_person_id);
  if (foremanId) {
    const { data: foremanRows } = await params.supabase
      .from("people")
      .select("id, nome")
      .eq("tenant_id", params.tenantId)
      .eq("id", foremanId)
      .limit(1);

    const foreman = (Array.isArray(foremanRows) && foremanRows.length ? foremanRows[0] : null) as ForemanConflictLookupRow | null;
    foremanName = normalizeText(foreman?.nome) || "Nao informado";
  }

  return {
    programmingId: normalizeText(concluded.id),
    executionDate: normalizeText(concluded.execution_date),
    teamId: normalizeText(concluded.team_id),
    teamName: normalizeText(team?.name) || normalizeText(concluded.team_id),
    foremanName,
    workCompletionStatus: normalizeText(concluded.work_completion_status),
    updatedAt: normalizeText(concluded.updated_at),
  } satisfies ProjectConcludedProgrammingContext;
}









async function copyProgramming(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para copiar programacao.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const authorizationError = await authorizeProgrammingAction(resolution, "create");
  if (authorizationError) return authorizationError;

  const payload = (await request.json().catch(() => null)) as CopyProgrammingPayload | null;
  const sourceTeamId = normalizeText(payload?.sourceTeamId);
  const startDate = normalizeIsoDate(payload?.startDate);
  const endDate = normalizeIsoDate(payload?.endDate);
  const targetTeamIds = Array.from(
    new Set((Array.isArray(payload?.targetTeamIds) ? payload?.targetTeamIds : []).map((item) => normalizeText(item)).filter(Boolean)),
  );

  if (!sourceTeamId || !targetTeamIds.length) {
    return NextResponse.json({ message: "Informe a equipe de origem e ao menos uma equipe de destino." }, { status: 400 });
  }

  if (!startDate || !endDate) {
    return NextResponse.json({ message: "Informe o periodo visivel para copiar a linha da equipe." }, { status: 400 });
  }

  const { data, error } = await resolution.supabase.rpc("copy_team_programming_period", {
    p_tenant_id: resolution.appUser.tenant_id,
    p_actor_user_id: resolution.appUser.id,
    p_source_team_id: sourceTeamId,
    p_target_team_ids: targetTeamIds,
    p_visible_start_date: startDate,
    p_visible_end_date: endDate,
  });

  if (error) {
    return NextResponse.json({ message: "Falha ao copiar a linha da equipe no periodo visivel." }, { status: 500 });
  }

  const result = (data ?? {}) as CopyProgrammingResponse & { success?: boolean; status?: number };
  if (result.success !== true) {
    return NextResponse.json(
      { message: result.message ?? "Falha ao copiar a linha da equipe no periodo visivel." },
      { status: Number(result.status ?? 400) },
    );
  }

  return NextResponse.json({
    success: true,
    copiedCount: result.copiedCount ?? 0,
    message: result.message ?? "Programacao copiada com sucesso.",
  } satisfies CopyProgrammingResponse);
}

async function copyProgrammingToDates(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para copiar programacao.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const authorizationError = await authorizeProgrammingAction(resolution, "create");
  if (authorizationError) return authorizationError;

  const payload = (await request.json().catch(() => null)) as CopyProgrammingToDatesPayload | null;
  const sourceProgrammingId = normalizeText(payload?.sourceProgrammingId);
  const expectedUpdatedAt = normalizeText(payload?.expectedUpdatedAt);
  const copyScope = payload?.copyScope === "group" ? "group" : "single";
  const targetsInput = Array.isArray(payload?.targets) ? payload.targets : [];

  if (!sourceProgrammingId) {
    return NextResponse.json({ message: "Informe a programacao de origem para copiar." }, { status: 400 });
  }

  if (!expectedUpdatedAt) {
    return NextResponse.json({ message: "Atualize a grade antes de copiar a programacao." }, { status: 409 });
  }

  if (!targetsInput.length) {
    return NextResponse.json(
      { message: "Informe Data destino e ETAPA valida para cada copia." },
      { status: 400 },
    );
  }

  const source = await fetchProgrammingById(resolution.supabase, resolution.appUser.tenant_id, sourceProgrammingId);
  if (!source) {
    return NextResponse.json({ message: "Programacao de origem nao encontrada." }, { status: 404 });
  }

  if (source.updated_at !== expectedUpdatedAt) {
    return NextResponse.json(
      { message: "Esta programacao foi alterada por outro usuario. Recarregue a grade antes de copiar." },
      { status: 409 },
    );
  }

  if (!["PROGRAMADA", "REPROGRAMADA"].includes(source.status)) {
    return NextResponse.json(
      { message: "Somente programacoes ativas podem ser copiadas para outras datas." },
      { status: 409 },
    );
  }

  if (!source.etapa_number || source.etapa_number < 1 || source.etapa_unica || source.etapa_final) {
    return NextResponse.json(
      { message: "A programacao de origem precisa ter ETAPA numerica e nao pode ser ETAPA UNICA/FINAL para copiar." },
      { status: 409 },
    );
  }

  const { data: groupIds, error: groupError } = await resolution.supabase
    .from("project_programming")
    .select("id")
    .eq("tenant_id", resolution.appUser.tenant_id)
    .eq("project_id", source.project_id)
    .eq("execution_date", source.execution_date)
    .eq("etapa_number", source.etapa_number)
    .eq("etapa_unica", false)
    .in("status", ["PROGRAMADA", "REPROGRAMADA"])
    .returns<Array<{ id: string }>>();

  if (groupError) {
    return NextResponse.json({ message: "Falha ao carregar equipes da programacao de origem." }, { status: 500 });
  }

  const groupRows = (
    await Promise.all(
      (groupIds ?? []).map((item) => fetchProgrammingById(resolution.supabase, resolution.appUser.tenant_id, item.id)),
    )
  ).filter((item): item is ProgrammingRow => Boolean(item));
  if (!groupRows.some((item) => item.id === source.id)) {
    groupRows.push(source);
  }

  const sourceRowsByTeam = new Map(groupRows.map((item) => [item.team_id, item]));
  const defaultTeamIds = copyScope === "group"
    ? Array.from(new Set(groupRows.map((item) => item.team_id).filter(Boolean)))
    : [source.team_id].filter(Boolean);

  const targets = targetsInput.map((item) => {
    const targetTeamIds = Array.from(new Set(normalizeStringArray(item?.teamIds)));
    return {
      date: normalizeIsoDate(item?.date),
      etapaNumber: normalizePositiveInteger(item?.etapaNumber),
      teamIds: targetTeamIds.length ? targetTeamIds : defaultTeamIds,
    };
  });

  if (!targets.length || targets.some((item) => !item.date || item.etapaNumber === null || !item.teamIds.length)) {
    return NextResponse.json(
      { message: "Informe Data destino, ETAPA valida e ao menos uma equipe para cada copia." },
      { status: 400 },
    );
  }

  const targetDates = targets.map((item) => item.date).filter((item): item is string => Boolean(item));
  const targetEtapas = targets.map((item) => item.etapaNumber).filter((item): item is number => item !== null);
  const allTargetTeamIds = Array.from(new Set(targets.flatMap((item) => item.teamIds)));

  if (new Set(targetDates).size !== targetDates.length) {
    return NextResponse.json({ message: "Cada data destino deve aparecer apenas uma vez." }, { status: 400 });
  }

  if (new Set(targetEtapas).size !== targetEtapas.length) {
    return NextResponse.json({ message: "Cada data destino deve receber uma ETAPA diferente." }, { status: 400 });
  }

  if (targetDates.includes(source.execution_date)) {
    return NextResponse.json(
      { message: "A data original da programacao nao pode ser selecionada como destino da copia." },
      { status: 400 },
    );
  }

  const { data: targetTeams, error: targetTeamsError } = await resolution.supabase
    .from("teams")
    .select("id, name")
    .eq("tenant_id", resolution.appUser.tenant_id)
    .eq("ativo", true)
    .in("id", allTargetTeamIds)
    .returns<Array<{ id: string; name: string | null }>>();

  if (targetTeamsError) {
    return NextResponse.json({ message: "Falha ao validar equipes selecionadas para a copia." }, { status: 500 });
  }

  const targetTeamMap = new Map((targetTeams ?? []).map((item) => [item.id, normalizeText(item.name) || item.id]));
  const missingTeamIds = allTargetTeamIds.filter((teamId) => !targetTeamMap.has(teamId));
  if (missingTeamIds.length) {
    return NextResponse.json(
      { message: "Uma ou mais equipes selecionadas estao inativas ou nao pertencem ao tenant atual." },
      { status: 400 },
    );
  }

  const minTargetEtapaByTeam = new Map<string, number>();
  for (const target of targets) {
    for (const teamId of target.teamIds) {
      const current = minTargetEtapaByTeam.get(teamId);
      const etapaNumber = target.etapaNumber ?? 0;
      minTargetEtapaByTeam.set(teamId, current ? Math.min(current, etapaNumber) : etapaNumber);
    }
  }

  const { data: stageRows, error: stageError } = await resolution.supabase
    .from("project_programming")
    .select("team_id, etapa_number, execution_date")
    .eq("tenant_id", resolution.appUser.tenant_id)
    .eq("project_id", source.project_id)
    .in("team_id", allTargetTeamIds)
    .not("etapa_number", "is", null)
    .returns<Array<{ team_id: string; etapa_number: number | null; execution_date: string | null }>>();

  if (stageError) {
    return NextResponse.json({ message: "Falha ao validar etapas existentes para a copia." }, { status: 500 });
  }

  const stageSummary = new Map<string, { highestStage: number; stages: Set<number>; dates: Set<string> }>();
  for (const row of stageRows ?? []) {
    const teamId = normalizeText(row.team_id);
    const stage = Number(row.etapa_number ?? 0);
    const minTargetEtapa = minTargetEtapaByTeam.get(teamId) ?? 0;
    if (!teamId || !Number.isInteger(stage) || stage < minTargetEtapa) continue;
    const current = stageSummary.get(teamId) ?? { highestStage: 0, stages: new Set<number>(), dates: new Set<string>() };
    current.highestStage = Math.max(current.highestStage, stage);
    current.stages.add(stage);
    const date = normalizeText(row.execution_date);
    if (date) current.dates.add(date);
    stageSummary.set(teamId, current);
  }

  const conflictingStages = Array.from(stageSummary.entries())
    .map(([teamId, summary]) => ({
      teamId,
      teamName: targetTeamMap.get(teamId) ?? teamId,
      highestStage: summary.highestStage,
      existingStages: Array.from(summary.stages).sort((left, right) => left - right),
      existingDates: Array.from(summary.dates).sort(),
    }));

  if (conflictingStages.length) {
    return NextResponse.json(
      {
        success: false,
        reason: "ETAPA_CONFLICT",
        enteredEtapaNumber: Math.min(...targetEtapas),
        hasConflict: true,
        highestStage: Math.max(...conflictingStages.map((item) => item.highestStage)),
        teams: conflictingStages,
        message: "A ETAPA informada ja existe ou esta abaixo do historico encontrado para uma ou mais equipes.",
      } satisfies CopyProgrammingToDatesResponse,
      { status: 409 },
    );
  }

  const { data: dateRows, error: dateError } = await resolution.supabase
    .from("project_programming")
    .select("id, project_id, team_id, execution_date, start_time, end_time")
    .eq("tenant_id", resolution.appUser.tenant_id)
    .in("team_id", allTargetTeamIds)
    .in("execution_date", targetDates)
    .in("status", ["PROGRAMADA", "REPROGRAMADA"])
    .returns<Array<{ id: string; project_id: string; team_id: string; execution_date: string; start_time: string | null; end_time: string | null }>>();

  if (dateError) {
    return NextResponse.json({ message: "Falha ao validar conflitos de agenda para a copia." }, { status: 500 });
  }

  for (const target of targets) {
    for (const teamId of target.teamIds) {
      const model = sourceRowsByTeam.get(teamId) ?? source;
      const targetDate = target.date ?? "";
      if (!targetDate) continue;
        const conflict = (dateRows ?? []).find((row) => {
          if (row.team_id !== teamId || row.execution_date !== targetDate) return false;
          if (row.project_id === source.project_id) return true;
          const sourceStart = normalizeText(model.start_time);
          const sourceEnd = normalizeText(model.end_time);
          const rowStart = normalizeText(row.start_time);
          const rowEnd = normalizeText(row.end_time);
          return Boolean(sourceStart && sourceEnd && rowStart && rowEnd && sourceStart < rowEnd && rowStart < sourceEnd);
        });
        if (conflict) {
          return NextResponse.json(
            {
              success: false,
              reason: "TARGET_DATE_CONFLICT",
              message: `A equipe ${targetTeamMap.get(teamId) ?? teamId} ja possui programacao conflitante em ${targetDate}.`,
            } satisfies CopyProgrammingToDatesResponse,
            { status: 409 },
          );
        }
    }
  }

  let copiedCount = 0;
  const activityCache = new Map<string, Array<{ catalogId: string; quantity: number }>>();

  const buildDocuments = (row: ProgrammingRow): NonNullable<SaveProgrammingPayload["documents"]> => ({
    sgd: {
      number: normalizeSgdNumber(row.sgd_number) ?? "",
      approvedAt: row.sgd_included_at ?? "",
      requestedAt: row.sgd_delivered_at ?? "",
      includedAt: row.sgd_included_at ?? "",
      deliveredAt: row.sgd_delivered_at ?? "",
    },
    pi: {
      number: normalizeText(row.pi_number),
      approvedAt: row.pi_included_at ?? "",
      requestedAt: row.pi_delivered_at ?? "",
      includedAt: row.pi_included_at ?? "",
      deliveredAt: row.pi_delivered_at ?? "",
    },
    pep: {
      number: normalizeText(row.pep_number),
      approvedAt: row.pep_included_at ?? "",
      requestedAt: row.pep_delivered_at ?? "",
      includedAt: row.pep_included_at ?? "",
      deliveredAt: row.pep_delivered_at ?? "",
    },
  });

  for (const target of targets) {
    for (const teamId of target.teamIds) {
      const model = sourceRowsByTeam.get(teamId) ?? source;
      let activities = activityCache.get(model.id);
      if (!activities) {
        activities = await fetchProgrammingActivitiesForSave({
          supabase: resolution.supabase,
          tenantId: resolution.appUser.tenant_id,
          programmingId: model.id,
        }) ?? [];
        activityCache.set(model.id, activities);
      }

      const saveResult = await saveProgrammingFullViaRpc({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        actorUserId: resolution.appUser.id,
        projectId: source.project_id,
        teamId,
        executionDate: target.date ?? "",
        period: model.period,
        startTime: model.start_time,
        endTime: model.end_time,
        expectedMinutes: Number(model.expected_minutes ?? 0),
        outageStartTime: model.outage_start_time,
        outageEndTime: model.outage_end_time,
        feeder: model.feeder,
        support: model.support,
        supportItemId: model.support_item_id,
        note: model.note,
        electricalField: model.campo_eletrico,
        serviceDescription: model.service_description,
        posteQty: Number(model.poste_qty ?? 0),
        estruturaQty: Number(model.estrutura_qty ?? 0),
        trafoQty: Number(model.trafo_qty ?? 0),
        redeQty: Number(model.rede_qty ?? 0),
        etapaNumber: target.etapaNumber,
        etapaUnica: false,
        etapaFinal: false,
        workCompletionStatus: null,
        affectedCustomers: Number(model.affected_customers ?? 0),
        sgdTypeId: model.sgd_type_id,
        electricalEqCatalogId: model.electrical_eq_catalog_id,
        documents: buildDocuments(model),
        activities,
        historyActionOverride: "COPY",
        historyReason: "Copia de programacao para outras datas.",
        historyMetadata: {
          source: "programacao-api",
          action: "COPY_TO_DATES",
          copyMode: "single_to_dates_selected_teams",
          selectedFromProgrammingId: source.id,
          sourceProgrammingId: model.id,
          sourceTeamId: model.team_id,
          targetTeamId: teamId,
          sourceExecutionDate: model.execution_date,
          targetExecutionDate: target.date,
          targetEtapaNumber: target.etapaNumber,
        },
      });

      if (!saveResult.ok) {
        return NextResponse.json(
          {
            success: false,
            reason: "reason" in saveResult ? saveResult.reason ?? null : null,
            detail: "detail" in saveResult ? saveResult.detail ?? null : null,
            message: saveResult.message ?? "Falha ao copiar programacao para as datas selecionadas.",
          } satisfies CopyProgrammingToDatesResponse,
          { status: saveResult.status },
        );
      }

      copiedCount += 1;
    }
  }

  return NextResponse.json({
    success: true,
    copiedCount,
    copyBatchId: null,
    copyBatchIds: [],
    sourceCount: allTargetTeamIds.length,
    message: `Programacao copiada para ${allTargetTeamIds.length} equipe(s), totalizando ${copiedCount} registro(s).`,
  } satisfies CopyProgrammingToDatesResponse);
}

export async function GET(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para consultar programacao.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const authorizationError = await authorizeProgrammingAction(resolution, "read");
    if (authorizationError) return authorizationError;

    const historyProgrammingId = normalizeText(request.nextUrl.searchParams.get("historyProgrammingId"));
    if (historyProgrammingId) {
      const historyRows = await fetchProgrammingHistory(
        resolution.supabase,
        resolution.appUser.tenant_id,
        historyProgrammingId,
      );

      return NextResponse.json({
        history: historyRows.map((item) => ({
          id: item.id,
          changedAt: item.created_at,
          changedByName: item.changed_by_name,
          reason: normalizeText(item.reason),
          action: normalizeText(item.metadata?.action),
          changes: buildHistoryChangesWithDerivedExecutionDate(item.changes ?? {}, item.metadata ?? {}),
          metadata: item.metadata ?? {},
        })),
      } satisfies ProgrammingHistoryListResponse);
    }

    const nextEtapaProjectId = normalizeText(request.nextUrl.searchParams.get("nextEtapaProjectId"));
    if (nextEtapaProjectId) {
      const nextEtapaDate = normalizeIsoDate(request.nextUrl.searchParams.get("nextEtapaDate"));
      const nextEtapaTeamIds = normalizeText(request.nextUrl.searchParams.get("nextEtapaTeamIds"))
        .split(",")
        .map((item) => normalizeText(item))
        .filter(Boolean);

      if (!nextEtapaDate || !nextEtapaTeamIds.length) {
        return NextResponse.json(
          { message: "Informe projeto, data de execucao e ao menos uma equipe para calcular a proxima etapa." },
          { status: 400 },
        );
      }

      const nextEtapaNumber = await fetchNextProgrammingStage(
        resolution.supabase,
        resolution.appUser.tenant_id,
        nextEtapaProjectId,
        nextEtapaTeamIds,
        nextEtapaDate,
      );

      return NextResponse.json({
        nextEtapaNumber,
        message: "Proxima etapa calculada com sucesso.",
      });
    }

    const etapaValidationProjectId = normalizeText(request.nextUrl.searchParams.get("etapaValidationProjectId"));
    if (etapaValidationProjectId) {
      const etapaValidationTeamIds = normalizeText(request.nextUrl.searchParams.get("etapaValidationTeamIds"))
        .split(",")
        .map((item) => normalizeText(item))
        .filter(Boolean);
      const etapaValidationNumber = normalizePositiveInteger(
        request.nextUrl.searchParams.get("etapaValidationNumber"),
      );
      const etapaValidationExcludeProgrammingId = normalizeNullableText(
        request.nextUrl.searchParams.get("etapaValidationExcludeProgrammingId"),
      );
      const etapaValidationCurrentStage = normalizePositiveInteger(
        request.nextUrl.searchParams.get("etapaValidationCurrentStage"),
      );
      const etapaValidationCurrentDate = normalizeIsoDate(
        request.nextUrl.searchParams.get("etapaValidationCurrentDate"),
      );
      const etapaValidationCurrentTeamId = normalizeNullableText(
        request.nextUrl.searchParams.get("etapaValidationCurrentTeamId"),
      );

      if (!etapaValidationTeamIds.length || etapaValidationNumber === null) {
        return NextResponse.json(
          { message: "Informe projeto, equipes e etapa valida para validar o historico da programacao." },
          { status: 400 },
        );
      }

      const teamSummaries = await fetchProgrammingStageValidation({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        projectId: etapaValidationProjectId,
        teamIds: etapaValidationTeamIds,
        enteredEtapaNumber: etapaValidationNumber,
        excludeProgrammingId: etapaValidationExcludeProgrammingId,
        currentEditingStage: etapaValidationCurrentStage,
        currentEditingDate: etapaValidationCurrentDate,
        currentEditingTeamId: etapaValidationCurrentTeamId,
      });

      const highestStage = teamSummaries.reduce(
        (current, item) => Math.max(current, item.highestStage),
        0,
      );

      return NextResponse.json({
        enteredEtapaNumber: etapaValidationNumber,
        hasConflict: teamSummaries.length > 0,
        highestStage,
        teams: teamSummaries,
        message: teamSummaries.length
          ? "Ja existem etapas iguais ou maiores para este projeto nas equipes selecionadas."
          : "Nenhum conflito de etapa encontrado para as equipes selecionadas.",
      } satisfies ProgrammingStageValidationResponse);
    }

    const startDate = normalizeIsoDate(request.nextUrl.searchParams.get("startDate"));
    const endDate = normalizeIsoDate(request.nextUrl.searchParams.get("endDate"));

    if (!startDate || !endDate) {
      return NextResponse.json({ message: "startDate e endDate sao obrigatorios." }, { status: 400 });
    }

    const weekStart = startOfWeekMonday(startDate);
    const [projects, teams, programmingRows, supportOptions, teamSummaries, sgdTypes, reasonOptions, eqCatalog, workCompletionCatalog] = await Promise.all([
      fetchProjects(resolution.supabase, resolution.appUser.tenant_id),
      fetchTeams(resolution.supabase, resolution.appUser.tenant_id),
      fetchProgrammingRows(resolution.supabase, resolution.appUser.tenant_id, startDate, endDate),
      fetchSupportOptions(resolution.supabase, resolution.appUser.tenant_id),
      fetchProgrammingWeekSummary(resolution.supabase, resolution.appUser.tenant_id, weekStart),
      fetchProgrammingSgdTypes(resolution.supabase, resolution.appUser.tenant_id),
      fetchProgrammingReasonCatalog(resolution.supabase, resolution.appUser.tenant_id),
      fetchProgrammingEqCatalog(resolution.supabase, resolution.appUser.tenant_id),
      fetchProgrammingWorkCompletionCatalog(resolution.supabase, resolution.appUser.tenant_id),
    ]);

    const activeTeamIds = new Set(teams.map((item) => item.id));
    const missingScheduledTeamIds = Array.from(
      new Set(
        programmingRows
          .map((item) => item.team_id)
          .filter((teamId) => !activeTeamIds.has(teamId)),
      ),
    );
    const extraTeamsForSchedules = await fetchTeamsByIds(
      resolution.supabase,
      resolution.appUser.tenant_id,
      missingScheduledTeamIds,
    );
    const teamLookupMap = new Map(
      [...teams, ...extraTeamsForSchedules].map((item) => [item.id, item]),
    );

    const projectMap = new Map(projects.map((item) => [item.id, item]));
    const filteredProgrammingRows = programmingRows.filter((item) => projectMap.has(item.project_id));
    const sgdTypeMap = new Map(sgdTypes.map((item) => [item.id, item]));
    const eqCatalogMap = new Map(eqCatalog.map((item) => [item.id, item]));
    const supportDefaults = await fetchProjectSupportDefaults({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      projectIds: projects.map((item) => item.id),
      supportOptions,
    });
    const activitiesResult = await fetchProgrammingActivities(
      resolution.supabase,
      resolution.appUser.tenant_id,
      filteredProgrammingRows.map((item) => item.id),
    );
    const programmingIds = filteredProgrammingRows.map((item) => item.id);
    const [rescheduleHistoryMap] = await Promise.all([
      fetchRescheduledProgrammingIds(
        resolution.supabase,
        resolution.appUser.tenant_id,
        programmingIds,
      ),
    ]);
    const programmingUserIds = Array.from(
      new Set(
        filteredProgrammingRows
          .flatMap((item) => [item.created_by, item.updated_by])
          .filter((value): value is string => Boolean(value)),
      ),
    );

    let programmingUsers: AppUserLookupRow[] = [];
    if (programmingUserIds.length > 0) {
      const usersResult = await resolution.supabase
        .from("app_users")
        .select("id, display, login_name")
        .eq("tenant_id", resolution.appUser.tenant_id)
        .in("id", programmingUserIds)
        .returns<AppUserLookupRow[]>();

      if (!usersResult.error) {
        programmingUsers = usersResult.data ?? [];
      }
    }

    const programmingUserMap = new Map(programmingUsers.map((item) => [item.id, item]));

    const boardPayload = {
      projects: projects.map((item) => ({
          id: item.id,
          code: normalizeText(item.sob),
          executionDeadline: item.execution_deadline,
          serviceName: normalizeText(item.service_description) || normalizeText(item.service_type_text) || "Sem descricao",
          city: normalizeText(item.city_text) || "Sem municipio",
          base: normalizeText(item.service_center_text) || "Sem base",
          serviceType: normalizeText(item.service_type_text) || "Sem tipo",
          priority: normalizeText(item.priority_text) || "Sem prioridade",
          partner: normalizeText(item.partner_text),
          utilityResponsible: normalizeText(item.utility_responsible_text),
          utilityFieldManager: normalizeText(item.utility_field_manager_text),
          street: normalizeText(item.street),
          district: normalizeText(item.neighborhood),
          note: normalizeText(item.observation) || normalizeText(item.service_description),
          hasLocacao: Boolean(item.has_locacao),
          defaultSupportItemId: supportDefaults.get(item.id)?.supportItemId ?? null,
          defaultSupportLabel: supportDefaults.get(item.id)?.supportLabel ?? null,
        })),
      teams,
      supportOptions: supportOptions.map((item) => ({
        id: item.id,
        description: normalizeText(item.description),
      })),
      sgdTypes: sgdTypes.map((item) => ({
        id: item.id,
        description: normalizeText(item.description),
        exportColumn: normalizeText(item.export_column),
      })),
      electricalEqCatalog: eqCatalog.map((item) => ({
        id: item.id,
        code: normalizeText(item.code),
        label: normalizeText(item.label_pt) || normalizeText(item.code),
      })),
      reasonOptions: reasonOptions.map((item) => ({
        code: normalizeText(item.code),
        label: normalizeText(item.label_pt),
        requiresNotes: Boolean(item.requires_notes),
      })),
      workCompletionCatalog: workCompletionCatalog.map((item) => ({
        code: normalizeText(item.code),
        label: normalizeText(item.label_pt) || normalizeText(item.code),
      })),
      teamSummaries: teamSummaries.map((item) => ({
        teamId: item.team_id,
        weekStart: item.week_start,
        weekEnd: item.week_end,
        workedDays: Number(item.worked_days ?? 0),
        capacityDays: Number(item.capacity_days ?? 5),
        freeDays: Number(item.free_days ?? 0),
        loadPercent: Number(item.load_percent ?? 0),
        loadStatus: item.load_status ?? "FREE",
      })),
      activitiesLoadError: activitiesResult.hasError,
      schedules: filteredProgrammingRows.map((item) => {
        const project = projectMap.get(item.project_id);
        const sgdType = item.sgd_type_id ? sgdTypeMap.get(item.sgd_type_id) : null;
        const eqCatalog = item.electrical_eq_catalog_id ? eqCatalogMap.get(item.electrical_eq_catalog_id) : null;
        const team = teamLookupMap.get(item.team_id);
        const scheduleActivities = activitiesResult.activityMap.get(item.id) ?? [];

        return {
          id: item.id,
          projectId: item.project_id,
          teamId: item.team_id,
          status: item.status,
          isReprogrammed: item.status === "REPROGRAMADA",
          date: item.execution_date,
          period: item.period === "INTEGRAL" ? "integral" : "partial",
          startTime: formatTime(item.start_time),
          endTime: formatTime(item.end_time),
          outageStartTime: formatTime(item.outage_start_time),
          outageEndTime: formatTime(item.outage_end_time),
          createdAt: item.created_at,
          updatedAt: item.updated_at,
          createdByName: resolveAppUserName(programmingUserMap.get(item.created_by ?? "")),
          updatedByName: resolveAppUserName(programmingUserMap.get(item.updated_by ?? "")),
          expectedMinutes: Number(item.expected_minutes ?? 0),
          posteQty: Number(item.poste_qty ?? 0),
          estruturaQty: Number(item.estrutura_qty ?? 0),
          trafoQty: Number(item.trafo_qty ?? 0),
          redeQty: Number(item.rede_qty ?? 0),
          redeQtyText: normalizeText(item.rede_qty ?? "0"),
          etapaNumber: item.etapa_number === null ? null : Number(item.etapa_number),
          etapaUnica: Boolean(item.etapa_unica ?? false),
          etapaFinal: Boolean(item.etapa_final ?? false),
          workCompletionStatus: normalizeWorkCompletionStatus(item.work_completion_status),
          affectedCustomers: Number(item.affected_customers ?? 0),
          sgdTypeId: item.sgd_type_id,
          electricalEqCatalogId: item.electrical_eq_catalog_id,
          electricalEqCode: normalizeText(eqCatalog?.code),
          sgdTypeDescription: normalizeText(sgdType?.description),
          sgdExportColumn: normalizeText(sgdType?.export_column),
          feeder: normalizeText(item.feeder),
          support: normalizeText(item.support),
          supportItemId: item.support_item_id,
          note: normalizeText(item.note),
          electricalField: normalizeText(item.campo_eletrico),
          serviceDescription: normalizeText(item.service_description),
          activitiesLoaded: !activitiesResult.hasError,
          teamName: normalizeText(team?.name) || item.team_id,
          teamVehiclePlate: normalizeText(team?.vehiclePlate),
          teamServiceCenterName: normalizeText(team?.serviceCenterName),
          teamTypeName: normalizeText(team?.teamTypeName),
          teamForemanName: normalizeText(team?.foremanName),
          projectBase: normalizeText(project?.service_center_text) || "Sem base",
          statusReason: normalizeText(item.cancellation_reason),
          statusChangedAt: item.canceled_at ?? "",
          wasRescheduled: item.status === "REPROGRAMADA" || rescheduleHistoryMap.has(item.id),
          lastReschedule: rescheduleHistoryMap.get(item.id)
            ? {
                id: rescheduleHistoryMap.get(item.id)?.historyId ?? "",
                changedAt: rescheduleHistoryMap.get(item.id)?.changedAt ?? "",
                reason: rescheduleHistoryMap.get(item.id)?.reason ?? "",
                fromDate: rescheduleHistoryMap.get(item.id)?.fromDate ?? "",
                toDate: rescheduleHistoryMap.get(item.id)?.toDate ?? "",
              }
            : null,
          activities: scheduleActivities.map((activity) => ({
            id: activity.id,
            catalogId: activity.service_activity_id,
            code: normalizeText(activity.activity_code),
            description: normalizeText(activity.activity_description),
            quantity: Number(activity.quantity ?? 0),
            unit: normalizeText(activity.activity_unit),
          })),
          documents: {
            sgd: {
              number: normalizeSgdNumber(item.sgd_number) ?? "",
              approvedAt: item.sgd_included_at ?? "",
              requestedAt: item.sgd_delivered_at ?? "",
              includedAt: item.sgd_included_at ?? "",
              deliveredAt: item.sgd_delivered_at ?? "",
            },
            pi: {
              number: normalizeText(item.pi_number),
              approvedAt: item.pi_included_at ?? "",
              requestedAt: item.pi_delivered_at ?? "",
              includedAt: item.pi_included_at ?? "",
              deliveredAt: item.pi_delivered_at ?? "",
            },
            pep: {
              number: normalizeText(item.pep_number),
              approvedAt: item.pep_included_at ?? "",
              requestedAt: item.pep_delivered_at ?? "",
              includedAt: item.pep_included_at ?? "",
              deliveredAt: item.pep_delivered_at ?? "",
            },
          },
        };
      }),
    };
    const boardPayloadSize = JSON.stringify(boardPayload).length;
    if (boardPayloadSize > 100_000) {
      console.warn(`[resp-size] GET /api/programacao board ${Math.round(boardPayloadSize / 1024)}KB tenant=${resolution.appUser.tenant_id}`);
    }
    return NextResponse.json(boardPayload);
  } catch {
    return NextResponse.json({ message: "Falha ao consultar programacao." }, { status: 500 });
  }
}

async function saveProgrammingBatch(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para registrar programacao em lote.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const authorizationError = await authorizeProgrammingAction(resolution, "create");
  if (authorizationError) return authorizationError;

  try {
    const payload = (await request.json().catch(() => null)) as BatchCreateProgrammingPayload | null;
    const projectId = normalizeText(payload?.projectId);
    const teamIds = normalizeUniqueTextArray(payload?.teamIds);
    const executionDate = normalizeIsoDate(payload?.date);
    const period = normalizePeriod(payload?.period);
    const startTime = normalizeTime(payload?.startTime);
    const endTime = normalizeTime(payload?.endTime);
    const outageStartTime = normalizeOptionalTime(payload?.outageStartTime);
    const outageEndTime = normalizeOptionalTime(payload?.outageEndTime);
    const expectedMinutes = normalizePositiveInteger(payload?.expectedMinutes);
    const feeder = normalizeNullableText(payload?.feeder);
    const support = normalizeNullableText(payload?.support);
    const supportItemId = normalizeNullableText(payload?.supportItemId);
    const note = normalizeNullableText(payload?.note);
    const electricalFieldRaw = normalizeNullableText(payload?.electricalField);
    const electricalField = normalizeElectricalEqNumber(payload?.electricalField);
    const serviceDescription = normalizeNullableText(payload?.serviceDescription);
    const posteQty = normalizeNonNegativeInteger(payload?.posteQty);
    const estruturaQty = normalizeNonNegativeInteger(payload?.estruturaQty);
    const trafoQty = normalizeNonNegativeInteger(payload?.trafoQty);
    const redeQty = normalizeNonNegativeDecimal(payload?.redeQty);
    const etapaNumberRaw = normalizeText(payload?.etapaNumber);
    const parsedEtapaNumber = etapaNumberRaw ? normalizePositiveInteger(etapaNumberRaw) : null;
    const etapaUnica = normalizeBoolean(payload?.etapaUnica) ?? false;
    const etapaFinal = normalizeBoolean(payload?.etapaFinal) ?? false;
    const workCompletionStatusRaw = normalizeText(payload?.workCompletionStatus);
    const affectedCustomers = normalizeNonNegativeInteger(payload?.affectedCustomers);
    const sgdTypeId = normalizeNullableText(payload?.sgdTypeId);
    const electricalEqCatalogId = normalizeNullableText(payload?.electricalEqCatalogId);
    const documents = normalizeProgrammingDocuments(payload?.documents);
    const activitiesInput = Array.isArray(payload?.activities) ? payload.activities : [];
    const activities = activitiesInput
      .map((item) => ({
        catalogId: normalizeText(item.catalogId),
        quantity: normalizePositiveNumber(item.quantity),
      }))
      .filter((item): item is { catalogId: string; quantity: number } => Boolean(item.catalogId) && item.quantity !== null);

    if (!projectId) {
      return NextResponse.json({ message: "Selecione um Projeto (SOB) valido da lista." }, { status: 400 });
    }

    const completedProjectContext = await resolveProjectCompletedProgrammingContext({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      projectId,
    });
    if (completedProjectContext) {
      return NextResponse.json(
        buildProjectCompletedConflictResponse({
          message:
            "Este projeto esta com Estado Trabalho CONCLUIDO. Antes de programar novamente, altere o Estado Trabalho para diferente de CONCLUIDO.",
          context: completedProjectContext,
        }),
        { status: 409 },
      );
    }

    if (!teamIds.length) {
      return NextResponse.json({ message: "Selecione ao menos uma equipe para cadastrar a programacao." }, { status: 400 });
    }

    if (etapaUnica && etapaFinal) {
      return NextResponse.json(
        { message: "Selecione apenas uma opcao: ETAPA UNICA ou ETAPA FINAL." },
        { status: 400 },
      );
    }

    if (!executionDate) {
      return NextResponse.json({ message: "Informe a Data execucao da programacao." }, { status: 400 });
    }

    if (!period) {
      return NextResponse.json({ message: "Selecione o Periodo da programacao." }, { status: 400 });
    }

    if (!startTime) {
      return NextResponse.json({ message: "Informe a Hora inicio da programacao." }, { status: 400 });
    }

    if (!endTime) {
      return NextResponse.json({ message: "Informe a Hora termino da programacao." }, { status: 400 });
    }

    if (!expectedMinutes) {
      return NextResponse.json({ message: "Hora termino deve ser maior que hora inicio." }, { status: 400 });
    }

    if (endTime <= startTime) {
      return NextResponse.json(
        { message: "Hora termino deve ser maior que hora inicio." },
        { status: 400 },
      );
    }

    if ((outageStartTime && !outageEndTime) || (!outageStartTime && outageEndTime)) {
      return NextResponse.json(
        { message: "Informe inicio e termino de desligamento." },
        { status: 400 },
      );
    }

    if (outageStartTime && outageEndTime && outageEndTime <= outageStartTime) {
      return NextResponse.json(
        { message: "Termino de desligamento deve ser maior que inicio." },
        { status: 400 },
      );
    }

    const invalidRequestedDateLabel = getInvalidRequestedDateLabel(documents);
    if (invalidRequestedDateLabel) {
      return NextResponse.json(
        { message: `Data pedido do ${invalidRequestedDateLabel} nao pode ser maior que a data aprovada.` },
        { status: 400 },
      );
    }

    if (isNegativeNumericLikeText(feeder)) {
      return NextResponse.json(
        { message: "Alimentador nao pode receber valor negativo." },
        { status: 400 },
      );
    }

    if (posteQty === null || estruturaQty === null || trafoQty === null || redeQty === null) {
      return NextResponse.json(
        { message: "POSTE, ESTRUTURA e TRAFO devem ser inteiros maiores ou iguais a zero. REDE aceita decimal com virgula ou ponto." },
        { status: 400 },
      );
    }

    if (!etapaUnica && !etapaFinal && !etapaNumberRaw) {
      return NextResponse.json(
        { message: "O campo ETAPA e obrigatorio." },
        { status: 400 },
      );
    }

    if (!etapaUnica && !etapaFinal && parsedEtapaNumber === null) {
      return NextResponse.json(
        { message: "O campo ETAPA deve ser um numero inteiro maior que zero." },
        { status: 400 },
      );
    }

    const etapaNumber = etapaUnica || etapaFinal ? null : parsedEtapaNumber;
    if (!etapaUnica && !etapaFinal && etapaNumber !== null) {
      const batchStageConflictSummaries = await fetchProgrammingStageValidation({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        projectId,
        teamIds,
        enteredEtapaNumber: etapaNumber,
      });

      if (batchStageConflictSummaries.length) {
        return NextResponse.json(
          {
            enteredEtapaNumber: etapaNumber,
            hasConflict: true,
            highestStage: batchStageConflictSummaries.reduce((current, item) => Math.max(current, item.highestStage), 0),
            teams: batchStageConflictSummaries,
            message: "A ETAPA informada ja existe ou esta abaixo do historico encontrado para este projeto nas equipes selecionadas.",
          } satisfies BatchCreateProgrammingResponse,
          { status: 409 },
        );
      }
    }

    if (workCompletionStatusRaw) {
      return NextResponse.json(
        { message: "Estado Trabalho so pode ser informado na edicao da programacao." },
        { status: 400 },
      );
    }

    if (affectedCustomers === null) {
      return NextResponse.json(
        { message: "O campo Numero de Clientes Afetados deve ser um inteiro maior ou igual a zero." },
        { status: 400 },
      );
    }

    if (!sgdTypeId) {
      return NextResponse.json(
        { message: "Tipo de SGD e obrigatorio para salvar a programacao." },
        { status: 400 },
      );
    }

    if (!electricalFieldRaw) {
      return NextResponse.json(
        { message: "Informe o numero do Nº EQ (RE, CO, CF, CC ou TR)." },
        { status: 400 },
      );
    }

    if (!electricalField) {
      return NextResponse.json(
        { message: "O numero do Nº EQ deve conter apenas letras e numeros." },
        { status: 400 },
      );
    }

    if (!electricalEqCatalogId) {
      return NextResponse.json(
        { message: "Selecione o tipo do Nº EQ (RE, CO, CF, CC ou TR)." },
        { status: 400 },
      );
    }

    const selectedSgdType = await resolveProgrammingSgdType({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      sgdTypeId,
    });

    if (!selectedSgdType) {
      return NextResponse.json(
        { message: "Tipo de SGD invalido para o tenant atual." },
        { status: 400 },
      );
    }

    const selectedEqCatalog = await resolveProgrammingEqCatalog({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      electricalEqCatalogId,
    });

    if (!selectedEqCatalog) {
      return NextResponse.json(
        { message: "Nº EQ invalido para o tenant atual." },
        { status: 400 },
      );
    }

    const initialWorkCompletionStatus = await resolveInitialProjectWorkCompletionStatus({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      projectId,
    });

    if (!initialWorkCompletionStatus.ok) {
      return NextResponse.json(
        { message: initialWorkCompletionStatus.message },
        { status: initialWorkCompletionStatus.status },
      );
    }

    const fullBatchSaveResult = await saveProgrammingBatchFullViaRpc({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      actorUserId: resolution.appUser.id,
      projectId,
      teamIds,
      executionDate,
      period,
      startTime,
      endTime,
      expectedMinutes,
      outageStartTime,
      outageEndTime,
      feeder,
      support,
      supportItemId,
      note,
      electricalField,
      serviceDescription,
      posteQty,
      estruturaQty,
      trafoQty,
      redeQty,
      etapaNumber,
      etapaUnica,
      etapaFinal,
      workCompletionStatus: initialWorkCompletionStatus.workCompletionStatus,
      affectedCustomers: affectedCustomers ?? 0,
      sgdTypeId,
      electricalEqCatalogId,
      documents,
      activities,
    });

    if (!fullBatchSaveResult.ok) {
      if (fullBatchSaveResult.reason === "TEAM_TIME_CONFLICT") {
        const detailedConflictMessage = await resolveTeamTimeConflictDetailedMessage({
          supabase: resolution.supabase,
          tenantId: resolution.appUser.tenant_id,
          executionDate,
          startTime,
          endTime,
          teamIds,
        });

        return NextResponse.json(
          {
            message: detailedConflictMessage ?? fullBatchSaveResult.message,
            reason: fullBatchSaveResult.reason,
            detail: fullBatchSaveResult.detail ?? null,
          },
          { status: 409 },
        );
      }

      if (fullBatchSaveResult.reason === "FULL_RPC_NOT_AVAILABLE") {
        return NextResponse.json(
          {
            message:
              "Seu ambiente ainda nao suporta REDE decimal transacional no cadastro em lote. Aplique as migrations 228 e 235 e tente novamente.",
            reason: fullBatchSaveResult.reason,
            detail: fullBatchSaveResult.detail ?? null,
          },
          { status: 409 },
        );
      }

      if (
        (fullBatchSaveResult.reason === "BATCH_FULL_CREATE_FAILED"
          || fullBatchSaveResult.reason === "SAVE_PROGRAMMING_FULL_FAILED")
        && !fullBatchSaveResult.detail
        && (
          fullBatchSaveResult.message === "Falha ao cadastrar programacao em lote."
          || fullBatchSaveResult.message === "Falha ao salvar programacao em transacao unica."
        )
      ) {
        return NextResponse.json(
          {
            message:
              "Falha ao cadastrar programacao em lote no banco. Verifique as wrappers base e a migration 228.",
            reason: fullBatchSaveResult.reason,
          },
          { status: 409 },
        );
      }

      return NextResponse.json(
        {
          message: fullBatchSaveResult.message,
          reason: fullBatchSaveResult.reason ?? null,
          detail: fullBatchSaveResult.detail ?? null,
        },
        { status: fullBatchSaveResult.status },
      );
    }

    return NextResponse.json({
      success: true,
      insertedCount: fullBatchSaveResult.insertedCount,
      message: fullBatchSaveResult.message,
    } satisfies BatchCreateProgrammingResponse);
  } catch (error) {
    console.error("saveProgrammingBatch_unhandled", error);
    const detailedMessage = error instanceof Error && error.message
      ? `Falha ao cadastrar programacao em lote: ${error.message}`
      : "Falha ao cadastrar programacao em lote.";

    return NextResponse.json({ message: detailedMessage }, { status: 500 });
  }
}

async function saveProgramming(request: NextRequest, method: "POST" | "PUT") {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: method === "POST" ? "Sessao invalida para registrar programacao." : "Sessao invalida para editar programacao.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const authorizationError = await authorizeProgrammingAction(resolution, method === "POST" ? "create" : "update");
  if (authorizationError) return authorizationError;

  const payload = (await request.json().catch(() => null)) as SaveProgrammingPayload | null;
  const programmingId = normalizeText(payload?.id);
  const projectId = normalizeText(payload?.projectId);
  const teamId = normalizeText(payload?.teamId);
  const executionDate = normalizeIsoDate(payload?.date);
  const period = normalizePeriod(payload?.period);
  const startTime = normalizeTime(payload?.startTime);
  const endTime = normalizeTime(payload?.endTime);
  const outageStartTime = normalizeOptionalTime(payload?.outageStartTime);
  const outageEndTime = normalizeOptionalTime(payload?.outageEndTime);
  const expectedMinutes = normalizePositiveInteger(payload?.expectedMinutes);
  const feeder = normalizeNullableText(payload?.feeder);
  const support = normalizeNullableText(payload?.support);
  const supportItemId = normalizeNullableText(payload?.supportItemId);
  const note = normalizeNullableText(payload?.note);
  const electricalFieldRaw = normalizeNullableText(payload?.electricalField);
  const electricalField = normalizeElectricalEqNumber(payload?.electricalField);
  const serviceDescription = normalizeNullableText(payload?.serviceDescription);
  const posteQty = normalizeNonNegativeInteger(payload?.posteQty);
  const estruturaQty = normalizeNonNegativeInteger(payload?.estruturaQty);
  const trafoQty = normalizeNonNegativeInteger(payload?.trafoQty);
  const redeQty = normalizeNonNegativeDecimal(payload?.redeQty);
  const etapaNumberRaw = normalizeText(payload?.etapaNumber);
  const parsedEtapaNumber = etapaNumberRaw ? normalizePositiveInteger(etapaNumberRaw) : null;
  const etapaUnica = normalizeBoolean(payload?.etapaUnica) ?? false;
  const etapaFinal = normalizeBoolean(payload?.etapaFinal) ?? false;
  const workCompletionStatusRaw = normalizeText(payload?.workCompletionStatus);
  const workCompletionStatus = normalizeWorkCompletionStatus(workCompletionStatusRaw);
  const affectedCustomers = normalizeNonNegativeInteger(payload?.affectedCustomers);
  const sgdTypeId = normalizeNullableText(payload?.sgdTypeId);
  const electricalEqCatalogId = normalizeNullableText(payload?.electricalEqCatalogId);
  const changeReason = normalizeNullableText(payload?.changeReason);
  const expectedUpdatedAt = normalizeText(payload?.expectedUpdatedAt) || null;
  const hasActivitiesPayload = Array.isArray(payload?.activities);
  const activitiesInput = hasActivitiesPayload ? payload?.activities ?? [] : [];
  let activities = activitiesInput
    .map((item) => ({
      catalogId: normalizeText(item.catalogId),
      quantity: normalizePositiveNumber(item.quantity),
    }))
    .filter((item): item is { catalogId: string; quantity: number } => Boolean(item.catalogId) && item.quantity !== null);
  const documents = normalizeProgrammingDocuments(payload?.documents);

  if (method === "PUT" && !programmingId) {
    return NextResponse.json({ message: "Programacao invalida para edicao." }, { status: 400 });
  }

  if (!projectId || !teamId || !executionDate || !period || !startTime || !endTime || !expectedMinutes) {
    return NextResponse.json({ message: "Preencha os campos obrigatorios da programacao." }, { status: 400 });
  }

  if (etapaUnica && etapaFinal) {
    return NextResponse.json(
      { message: "Selecione apenas uma opcao: ETAPA UNICA ou ETAPA FINAL." },
      { status: 400 },
    );
  }

  if (endTime <= startTime) {
    return NextResponse.json(
      { message: "Hora termino deve ser maior que hora inicio." },
      { status: 400 },
    );
  }

  if ((outageStartTime && !outageEndTime) || (!outageStartTime && outageEndTime)) {
    return NextResponse.json(
      { message: "Informe inicio e termino de desligamento." },
      { status: 400 },
    );
  }

  if (outageStartTime && outageEndTime && outageEndTime <= outageStartTime) {
    return NextResponse.json(
      { message: "Termino de desligamento deve ser maior que inicio." },
      { status: 400 },
    );
  }

  const invalidRequestedDateLabel = getInvalidRequestedDateLabel(documents);
  if (invalidRequestedDateLabel) {
    return NextResponse.json(
      { message: `Data pedido do ${invalidRequestedDateLabel} nao pode ser maior que a data aprovada.` },
      { status: 400 },
    );
  }

  if (isNegativeNumericLikeText(feeder)) {
    return NextResponse.json(
      { message: "Alimentador nao pode receber valor negativo." },
      { status: 400 },
    );
  }

  if (posteQty === null || estruturaQty === null || trafoQty === null || redeQty === null) {
    return NextResponse.json(
      { message: "POSTE, ESTRUTURA e TRAFO devem ser inteiros maiores ou iguais a zero. REDE aceita decimal com virgula ou ponto." },
      { status: 400 },
    );
  }

  if (method === "POST" && !etapaUnica && !etapaFinal && !etapaNumberRaw) {
    return NextResponse.json(
      { message: "O campo ETAPA e obrigatorio." },
      { status: 400 },
    );
  }

  if (!etapaUnica && !etapaFinal && etapaNumberRaw && parsedEtapaNumber === null) {
    return NextResponse.json(
      { message: "O campo ETAPA deve ser um numero inteiro maior que zero." },
      { status: 400 },
    );
  }

  const currentProgramming = programmingId
    ? await fetchProgrammingById(resolution.supabase, resolution.appUser.tenant_id, programmingId)
    : null;

  if (programmingId && !currentProgramming) {
    return NextResponse.json({ message: "Programacao nao encontrada." }, { status: 404 });
  }

  if (method === "PUT" && programmingId && !hasActivitiesPayload) {
    const currentActivities = await fetchProgrammingActivitiesForSave({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      programmingId,
    });

    if (currentActivities === null) {
      return NextResponse.json(
        { message: "Falha ao carregar atividades atuais da programacao para salvar com seguranca." },
        { status: 500 },
      );
    }

    activities = currentActivities;
  }

  const existingEtapaNumber = currentProgramming?.etapa_number ?? null;
  const etapaNumber = etapaUnica || etapaFinal
    ? null
    : (
      method === "PUT" && !etapaNumberRaw
        ? existingEtapaNumber
        : parsedEtapaNumber
    );

  const shouldValidateStageConflict = !etapaUnica
    && !etapaFinal
    && etapaNumber !== null
    && (
      method === "POST"
      || etapaNumber !== existingEtapaNumber
    );

  if (shouldValidateStageConflict && etapaNumber !== null) {
    const saveStageConflictSummaries = await fetchProgrammingStageValidation({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      projectId,
      teamIds: [teamId],
      enteredEtapaNumber: etapaNumber,
      excludeProgrammingId: programmingId || null,
      currentEditingStage: currentProgramming?.etapa_number ?? null,
      currentEditingDate: currentProgramming?.execution_date ?? null,
      currentEditingTeamId: currentProgramming?.team_id ?? null,
    });

    if (saveStageConflictSummaries.length) {
      return NextResponse.json(
        {
          enteredEtapaNumber: etapaNumber,
          hasConflict: true,
          highestStage: saveStageConflictSummaries.reduce((current, item) => Math.max(current, item.highestStage), 0),
          teams: saveStageConflictSummaries,
          message: "A ETAPA informada ja existe ou esta abaixo do historico encontrado para este projeto na equipe selecionada.",
        },
        { status: 409 },
      );
    }
  }

  if (workCompletionStatusRaw && !workCompletionStatus) {
    return NextResponse.json(
      { message: "Estado Trabalho invalido." },
      { status: 400 },
    );
  }

  if (workCompletionStatus) {
    const selectedWorkCompletionStatus = await resolveProgrammingWorkCompletionStatus({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      workCompletionStatus,
    });

    if (!selectedWorkCompletionStatus) {
      return NextResponse.json(
        { message: "Estado do Projeto invalido para o tenant atual." },
        { status: 400 },
      );
    }
  }

  if (affectedCustomers === null) {
    return NextResponse.json(
      { message: "O campo Numero de Clientes Afetados deve ser um inteiro maior ou igual a zero." },
      { status: 400 },
    );
  }

  if (!sgdTypeId) {
    return NextResponse.json(
      { message: "Tipo de SGD e obrigatorio para salvar a programacao." },
      { status: 400 },
    );
  }

  if (!electricalFieldRaw) {
    return NextResponse.json(
      { message: "Informe o numero do Nº EQ (RE, CO, CF, CC ou TR)." },
      { status: 400 },
    );
  }

  if (!electricalField) {
    return NextResponse.json(
      { message: "O numero do Nº EQ deve conter apenas letras e numeros." },
      { status: 400 },
    );
  }

  if (!electricalEqCatalogId) {
    return NextResponse.json(
      { message: "Selecione o tipo do Nº EQ (RE, CO, CF, CC ou TR)." },
      { status: 400 },
    );
  }

  const selectedSgdType = await resolveProgrammingSgdType({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    sgdTypeId,
  });

  if (!selectedSgdType) {
    return NextResponse.json(
      { message: "Tipo de SGD invalido para o tenant atual." },
      { status: 400 },
    );
  }

  const selectedEqCatalog = await resolveProgrammingEqCatalog({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    electricalEqCatalogId,
  });

  if (!selectedEqCatalog) {
    return NextResponse.json(
      { message: "Nº EQ invalido para o tenant atual." },
      { status: 400 },
    );
  }

  const completedProjectContext = await resolveProjectCompletedProgrammingContext({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    projectId,
  });

  if (completedProjectContext) {
    if (method === "PUT") {
      const isChangingFromCompletedToAnotherStatus = Boolean(workCompletionStatus) && !isCompletedWorkStatus(workCompletionStatus);
      const isEditingCompletedRecord = normalizeText(currentProgramming?.id) === completedProjectContext.programmingId;
      if (!isEditingCompletedRecord || !isChangingFromCompletedToAnotherStatus) {
        return NextResponse.json(
          buildProjectCompletedConflictResponse({
            message:
              "Este projeto possui Estado Trabalho CONCLUIDO. Para continuar, altere o Estado Trabalho para um valor diferente de CONCLUIDO nesta edicao.",
            context: completedProjectContext,
          }),
          { status: 409 },
        );
      }
    } else {
      return NextResponse.json(
        buildProjectCompletedConflictResponse({
          message:
            "Este projeto esta com Estado Trabalho CONCLUIDO. Antes de programar novamente, altere o Estado Trabalho para diferente de CONCLUIDO.",
          context: completedProjectContext,
        }),
        { status: 409 },
      );
    }
  }

  const initialWorkCompletionStatus = method === "POST"
    ? await resolveInitialProjectWorkCompletionStatus({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        projectId,
      })
    : { ok: true, workCompletionStatus: null } as const;

  if (!initialWorkCompletionStatus.ok) {
    return NextResponse.json(
      { message: initialWorkCompletionStatus.message },
      { status: initialWorkCompletionStatus.status },
    );
  }

  const normalizedWorkCompletionStatus =
    method === "PUT"
      ? workCompletionStatus
      : initialWorkCompletionStatus.workCompletionStatus;

  const isPotentialReschedule = currentProgramming
    ? (
      currentProgramming.project_id !== projectId
      || currentProgramming.execution_date !== executionDate
      || currentProgramming.team_id !== teamId
      || normalizePeriod(currentProgramming.period) !== period
      || formatTime(currentProgramming.start_time) !== formatTime(startTime)
      || formatTime(currentProgramming.end_time) !== formatTime(endTime)
    )
    : false;

  if (isPotentialReschedule && !changeReason) {
    return NextResponse.json({ message: "Selecione um motivo de reprogramacao." }, { status: 400 });
  }

  const fullSaveResult = await saveProgrammingFullViaRpc({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    actorUserId: resolution.appUser.id,
    programmingId: programmingId || null,
    projectId,
    teamId,
    executionDate,
    period,
    startTime,
    endTime,
    expectedMinutes,
    outageStartTime,
    outageEndTime,
    feeder,
    support,
    supportItemId,
    note,
    electricalField,
    serviceDescription,
    posteQty: posteQty ?? 0,
    estruturaQty: estruturaQty ?? 0,
    trafoQty: trafoQty ?? 0,
    redeQty: redeQty ?? 0,
    etapaNumber,
    etapaUnica,
    etapaFinal,
    workCompletionStatus: normalizedWorkCompletionStatus,
    affectedCustomers: affectedCustomers ?? 0,
    sgdTypeId,
    electricalEqCatalogId,
    documents,
    activities,
    expectedUpdatedAt,
    historyReason: isPotentialReschedule ? changeReason : null,
    historyMetadata: {
      source: "programacao-api",
    },
  });

  if (!fullSaveResult.ok) {
    if (fullSaveResult.reason === "TEAM_TIME_CONFLICT") {
      const detailedConflictMessage = await resolveTeamTimeConflictDetailedMessage({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        executionDate,
        startTime,
        endTime,
        teamIds: [teamId],
        excludeProgrammingId: programmingId || null,
      });

      return NextResponse.json(
        {
          message: detailedConflictMessage ?? fullSaveResult.message,
          reason: fullSaveResult.reason,
          detail: fullSaveResult.detail ?? null,
        },
        { status: 409 },
      );
    }

    if (fullSaveResult.reason === "PROGRAMMING_CONFLICT" && programmingId) {
      const conflictPayload = await fetchProgrammingConflictPayload({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        programmingId,
        requested: {
          executionDate,
          teamId,
          startTime,
          endTime,
        },
      });

      return NextResponse.json(
        conflictPayload ?? { error: "conflict", message: fullSaveResult.message },
        { status: 409 },
      );
    }

    if (fullSaveResult.reason === "FULL_RPC_NOT_AVAILABLE") {
      return NextResponse.json(
        {
          message:
            "Seu ambiente ainda nao suporta REDE decimal transacional na Programacao. Aplique a migration 228 e tente novamente.",
          reason: fullSaveResult.reason,
          detail: fullSaveResult.detail ?? null,
        },
        { status: 409 },
      );
    }

    if (
      fullSaveResult.reason === "SAVE_PROGRAMMING_FULL_FAILED"
      && !fullSaveResult.detail
      && fullSaveResult.message === "Falha ao salvar programacao em transacao unica."
    ) {
      return NextResponse.json(
        {
          message:
            "Falha ao salvar programacao no banco. Verifique as wrappers base e a migration 228.",
          reason: fullSaveResult.reason,
        },
        { status: 409 },
      );
    }

    return NextResponse.json(
      {
        message: fullSaveResult.message,
        reason: fullSaveResult.reason ?? null,
        detail: fullSaveResult.detail ?? null,
      },
      { status: fullSaveResult.status },
    );
  }

  const saveResult = {
    ok: true,
    action: fullSaveResult.action,
    programmingId: fullSaveResult.programmingId,
    projectCode: fullSaveResult.projectCode,
    updatedAt: fullSaveResult.updatedAt,
    message: fullSaveResult.message,
  } as const;

  const persistedProgrammingId = saveResult.programmingId;

  if (method === "PUT" && !electricalField) {
    const { error: clearElectricalFieldError } = await resolution.supabase
      .from("project_programming")
      .update({
        campo_eletrico: null,
        updated_by: resolution.appUser.id,
      })
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("id", persistedProgrammingId);

    if (clearElectricalFieldError) {
      return NextResponse.json(
        { message: "Programacao salva, mas houve falha ao limpar o campo Ponto eletrico." },
        { status: 500 },
      );
    }
  }

  const savedSchedule = await fetchProgrammingResponseItem(
    resolution.supabase,
    resolution.appUser.tenant_id,
    persistedProgrammingId,
  );
  const responseWarning = !savedSchedule
    ? "Programacao salva com sucesso, mas houve falha ao atualizar a visualizacao."
    : null;

  return NextResponse.json({
    success: true,
    id: persistedProgrammingId,
    updatedAt: saveResult.updatedAt,
    schedule: savedSchedule,
    warning: responseWarning,
    message: responseWarning ? `${saveResult.message} ${responseWarning}` : saveResult.message,
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const normalizedAction = normalizeText(body?.action).toUpperCase();

  if (normalizedAction === "COPY") {
    const clonedRequest = new NextRequest(request.url, {
      method: request.method,
      headers: request.headers,
      body: JSON.stringify(body),
    });

    return copyProgramming(clonedRequest);
  }

  if (normalizedAction === "COPY_TO_DATES") {
    const clonedRequest = new NextRequest(request.url, {
      method: request.method,
      headers: request.headers,
      body: JSON.stringify(body),
    });

    return copyProgrammingToDates(clonedRequest);
  }

  if (normalizedAction === "BATCH_CREATE") {
    const clonedRequest = new NextRequest(request.url, {
      method: request.method,
      headers: request.headers,
      body: JSON.stringify(body),
    });

    return saveProgrammingBatch(clonedRequest);
  }

  const clonedRequest = new NextRequest(request.url, {
    method: request.method,
    headers: request.headers,
    body: JSON.stringify(body),
  });

  return saveProgramming(clonedRequest, "POST");
}

export async function PUT(request: NextRequest) {
  return saveProgramming(request, "PUT");
}

async function saveProgrammingWorkCompletionStatus(request: NextRequest, payload: CancelProgrammingPayload) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para salvar Estado Trabalho da programacao.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const authorizationError = await authorizeProgrammingAction(resolution, "update");
  if (authorizationError) return authorizationError;

  const programmingId = normalizeText(payload.id);
  const expectedUpdatedAt = normalizeText(payload.expectedUpdatedAt) || null;
  const workCompletionStatus = normalizeWorkCompletionStatus(payload.workCompletionStatus);
  const reason = normalizeNullableText(payload.reason) ?? "Reabertura de projeto concluido pelo modal.";

  if (!programmingId) {
    return NextResponse.json({ message: "Programacao invalida para salvar Estado Trabalho." }, { status: 400 });
  }

  if (!expectedUpdatedAt) {
    return NextResponse.json({ message: "Atualize a grade antes de salvar Estado Trabalho." }, { status: 409 });
  }

  if (!workCompletionStatus) {
    return NextResponse.json({ message: "Selecione um Estado Trabalho para salvar." }, { status: 400 });
  }

  if (isCompletedWorkStatus(workCompletionStatus)) {
    return NextResponse.json(
      { message: "Selecione um Estado Trabalho diferente de CONCLUIDO." },
      { status: 400 },
    );
  }

  const rpcName = "save_project_programming_work_completion_status_full";
  const { data, error } = await resolution.supabase.rpc(rpcName, {
    p_tenant_id: resolution.appUser.tenant_id,
    p_actor_user_id: resolution.appUser.id,
    p_programming_id: programmingId,
    p_expected_updated_at: expectedUpdatedAt,
    p_work_completion_status: workCompletionStatus,
    p_reason: reason,
  });

  if (error) {
    if (isMissingRpcFunctionError(error.message, rpcName)) {
      return NextResponse.json(
        {
          message: "Seu ambiente ainda nao suporta o salvamento transacional do Estado Trabalho. Aplique a migration 229.",
          reason: "WORK_COMPLETION_STATUS_RPC_NOT_AVAILABLE",
        },
        { status: 409 },
      );
    }

    return NextResponse.json(
      {
        message: error.message
          ? `Falha ao salvar Estado Trabalho: ${error.message}`
          : "Falha ao salvar Estado Trabalho.",
      },
      { status: 500 },
    );
  }

  const result = (data ?? {}) as WorkCompletionStatusRpcResult;
  if (result.success !== true) {
    const status = Number(result.status ?? 400);
    if (status === 409) {
      return NextResponse.json(
        {
          error: "conflict",
          reason: result.reason ?? "CONCURRENT_MODIFICATION",
          message: result.message ?? "Esta programacao foi alterada por outro usuario.",
          currentRecord: result.currentRecord ?? null,
          currentUpdatedAt: result.currentUpdatedAt ?? null,
          updatedBy: result.updatedBy ?? null,
          changedFields: result.changedFields ?? ["updatedAt", "workCompletionStatus"],
        },
        { status },
      );
    }

    return NextResponse.json(
      {
        message: result.message ?? "Falha ao salvar Estado Trabalho.",
        reason: result.reason ?? null,
        detail: result.detail ?? null,
      },
      { status },
    );
  }

  const schedule = await fetchProgrammingResponseItem(
    resolution.supabase,
    resolution.appUser.tenant_id,
    programmingId,
  );
  const warning = !schedule
    ? "Estado Trabalho salvo com sucesso, mas houve falha ao atualizar a visualizacao."
    : null;

  return NextResponse.json({
    success: true,
    id: programmingId,
    updatedAt: normalizeText(result.updated_at),
    schedule,
    warning,
    message: warning ? `${result.message ?? "Estado Trabalho salvo com sucesso."} ${warning}` : result.message,
  });
}

export async function PATCH(request: NextRequest) {
  const payload = (await request.json().catch(() => null)) as CancelProgrammingPayload | null;
  const normalizedAction = normalizeText(payload?.action).toUpperCase();

  if (normalizedAction === "SALVAR_ESTADO_TRABALHO") {
    return saveProgrammingWorkCompletionStatus(request, payload ?? {});
  }

  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para cancelar programacao.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const pageAction: PageAction = normalizedAction === "ADIAR" ? "update" : "cancel";
  const authorizationError = await authorizeProgrammingAction(resolution, pageAction);
  if (authorizationError) return authorizationError;

  const programmingId = normalizeText(payload?.id);
  const action = normalizeText(payload?.action).toUpperCase() === "ADIAR" ? "ADIADA" : "CANCELADA";
  const reason = normalizeNullableText(payload?.reason);
  const newDate = normalizeIsoDate(payload?.newDate);
  const expectedUpdatedAt = normalizeText(payload?.expectedUpdatedAt) || null;

  if (!programmingId || !reason) {
    return NextResponse.json({ message: "Informe a programacao e o motivo da alteracao." }, { status: 400 });
  }

  if (!expectedUpdatedAt) {
    return NextResponse.json({ message: "Atualize a grade antes de alterar o status da programacao." }, { status: 409 });
  }

  if (!reason) {
    return NextResponse.json({ message: "Selecione um motivo para continuar." }, { status: 400 });
  }

  const currentProgramming = await fetchProgrammingById(resolution.supabase, resolution.appUser.tenant_id, programmingId);
  if (!currentProgramming) {
    return NextResponse.json({ message: "Programacao nao encontrada." }, { status: 404 });
  }

  const completedProjectContext = await resolveProjectCompletedProgrammingContext({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    projectId: currentProgramming.project_id,
  });

  if (completedProjectContext) {
    return NextResponse.json(
      buildProjectCompletedConflictResponse({
        message:
          "Este projeto possui Estado Trabalho CONCLUIDO. Antes de adiar ou cancelar, edite uma programacao e altere o Estado Trabalho para diferente de CONCLUIDO.",
        context: completedProjectContext,
      }),
      { status: 409 },
    );
  }

  if (action === "ADIADA") {
    if (!newDate) {
      const statusResult = await cancelProgrammingViaRpc({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        actorUserId: resolution.appUser.id,
        programmingId,
        action,
        reason,
        expectedUpdatedAt,
      });

      if (!statusResult.ok) {
        return NextResponse.json(
          { message: statusResult.message, reason: "reason" in statusResult ? statusResult.reason ?? null : null },
          { status: statusResult.status },
        );
      }

      let updatedSchedule: Awaited<ReturnType<typeof fetchProgrammingResponseItem>> = null;
      let warning: string | null = null;

      try {
        updatedSchedule = await fetchProgrammingResponseItem(
          resolution.supabase,
          resolution.appUser.tenant_id,
          statusResult.programmingId,
        );
      } catch {
        warning = "Programacao salva com sucesso, mas houve falha ao atualizar a visualizacao.";
      }

      return NextResponse.json({
        success: true,
        schedule: updatedSchedule,
        warning,
        message: warning ? `${statusResult.message} ${warning}` : statusResult.message,
      });
    }

    if (newDate <= currentProgramming.execution_date) {
      return NextResponse.json(
        { message: "Informe uma nova data posterior a data atual da programacao." },
        { status: 400 },
      );
    }

    const postponeResult = await postponeProgrammingViaRpc({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      actorUserId: resolution.appUser.id,
      programmingId,
      newExecutionDate: newDate,
      reason,
      expectedUpdatedAt,
    });

    if (!postponeResult.ok) {
      if (postponeResult.reason === "PROGRAMMING_CONFLICT") {
        const conflictPayload = await fetchProgrammingConflictPayload({
          supabase: resolution.supabase,
          tenantId: resolution.appUser.tenant_id,
          programmingId,
          requested: {
            executionDate: newDate,
            teamId: currentProgramming.team_id,
            startTime: formatTime(currentProgramming.start_time),
            endTime: formatTime(currentProgramming.end_time),
            status: "ADIADA",
          },
        });

      return NextResponse.json(
          conflictPayload ?? { error: "conflict", message: postponeResult.message, reason: postponeResult.reason ?? null },
          { status: 409 },
        );
      }

      return NextResponse.json(
        {
          message: postponeResult.message,
          reason: postponeResult.reason ?? null,
          detail: "detail" in postponeResult ? (postponeResult.detail ?? null) : null,
        },
        { status: postponeResult.status },
      );
    }

    let updatedSchedule: Awaited<ReturnType<typeof fetchProgrammingResponseItem>> = null;
    let newSchedule: Awaited<ReturnType<typeof fetchProgrammingResponseItem>> = null;
    let warning: string | null = null;

    try {
      [updatedSchedule, newSchedule] = await Promise.all([
        fetchProgrammingResponseItem(resolution.supabase, resolution.appUser.tenant_id, programmingId),
        fetchProgrammingResponseItem(resolution.supabase, resolution.appUser.tenant_id, postponeResult.newProgrammingId),
      ]);

      if (!updatedSchedule || !newSchedule) {
        warning = "Programacao salva com sucesso, mas houve falha ao atualizar a visualizacao.";
      }
    } catch {
      warning = "Programacao salva com sucesso, mas houve falha ao atualizar a visualizacao.";
    }

    return NextResponse.json({
      success: true,
      id: programmingId,
      newId: postponeResult.newProgrammingId,
      updatedAt: postponeResult.updatedAt,
      schedule: updatedSchedule,
      newSchedule,
      warning,
      message: warning ? `${postponeResult.message} ${warning}` : postponeResult.message,
    });
  }

  const cancelResult = await cancelProgrammingViaRpc({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    actorUserId: resolution.appUser.id,
    programmingId,
    action,
    reason,
    expectedUpdatedAt,
  });

  if (!cancelResult.ok) {
    if (cancelResult.reason === "PROGRAMMING_CONFLICT") {
      const conflictPayload = await fetchProgrammingConflictPayload({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        programmingId,
        requested: {
          executionDate: currentProgramming.execution_date,
          teamId: currentProgramming.team_id,
          startTime: formatTime(currentProgramming.start_time),
          endTime: formatTime(currentProgramming.end_time),
          status: action,
        },
      });

      return NextResponse.json(
        conflictPayload ?? { error: "conflict", message: cancelResult.message, reason: cancelResult.reason ?? null },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { message: cancelResult.message, reason: cancelResult.reason ?? null },
      { status: cancelResult.status },
    );
  }

  let updatedSchedule: Awaited<ReturnType<typeof fetchProgrammingResponseItem>> = null;
  let warning: string | null = null;

  try {
    updatedSchedule = await fetchProgrammingResponseItem(
      resolution.supabase,
      resolution.appUser.tenant_id,
      programmingId,
    );
    if (!updatedSchedule) {
      warning = "Programacao salva com sucesso, mas houve falha ao atualizar a visualizacao.";
    }
  } catch {
    warning = "Programacao salva com sucesso, mas houve falha ao atualizar a visualizacao.";
  }

  return NextResponse.json({
    success: true,
    id: programmingId,
    updatedAt: cancelResult.updatedAt,
    schedule: updatedSchedule,
    warning,
    message: warning ? `${cancelResult.message} ${warning}` : cancelResult.message,
  });
}
