import { NextRequest, NextResponse } from "next/server";
import { SupabaseClient } from "@supabase/supabase-js";

import { resolveAuthenticatedAppUser, type AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";
import { requirePageAction, type PageAction } from "@/lib/server/pageAuthorization";
import type {
  AddTeamToProgrammingPayload,
  AddTeamToProgrammingResponse,
  BatchCreateProgrammingPayload,
  BatchCreateProgrammingResponse,
  CancelProgrammingPayload,
  CopyProgrammingPayload,
  CopyProgrammingResponse,
  CopyProgrammingToDatesPayload,
  CopyProgrammingToDatesResponse,
  ForemanConflictLookupRow,
  ProgrammingRow,
  ProgrammingTimeConflictLookupRow,
  ProjectConcludedProgrammingContext,
  ProjectConflictLookupRow,
  SaveProgrammingPayload,
  TeamConflictLookupRow,
  WorkCompletionStatusRpcResult,
} from "./types";
import {
  markFutureProgrammingStagesAnticipatedViaRpc,
  resolveInitialProjectWorkCompletionStatus,
  resolveProgrammingEqCatalog,
  resolveProgrammingSgdType,
  resolveProgrammingWorkCompletionStatus,
  saveProgrammingBatchFullViaRpc,
  saveProgrammingFullViaRpc,
} from "./rpc";
import {
  fetchProgrammingActivitiesForSave,
  fetchProgrammingById,
  fetchProgrammingConflictPayload,
  fetchProgrammingResponseItem,
  fetchProgrammingStageValidation,
} from "./queries";
import {
  buildProjectCompletedConflictResponse,
  formatTime,
  getInvalidRequestedDateLabel,
  isCompletedWorkStatus,
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
  normalizeSgdNumber,
  normalizeStringArray,
  normalizeText,
  normalizeTime,
  normalizeUniqueTextArray,
  normalizeWorkCompletionStatus,
} from "./normalizers";

export const PROGRAMMING_PAGE_KEY = "programacao-simples";

export async function authorizeProgrammingAction(context: AuthenticatedAppUserContext, action: PageAction) {
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

export async function resolveTeamTimeConflictDetailedMessage(params: {
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

export async function resolveProjectCompletedProgrammingContext(params: {
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

export async function copyProgramming(request: NextRequest) {
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
  ).filter((id) => id !== sourceTeamId);

  if (!sourceTeamId || !targetTeamIds.length) {
    return NextResponse.json({ message: "Informe ao menos uma equipe de destino diferente da equipe de origem." }, { status: 400 });
  }

  if (!startDate || !endDate) {
    return NextResponse.json({ message: "Informe o periodo visivel para copiar a linha da equipe." }, { status: 400 });
  }

  const { data: concluídoInPeriod } = await resolution.supabase
    .from("project_programming")
    .select("project_id")
    .eq("tenant_id", resolution.appUser.tenant_id)
    .eq("team_id", sourceTeamId)
    .gte("execution_date", startDate)
    .lte("execution_date", endDate)
    .neq("status", "CANCELADA")
    .eq("work_completion_status", "CONCLUIDO")
    .limit(1);

  if (concluídoInPeriod && concluídoInPeriod.length > 0) {
    return NextResponse.json(
      {
        message:
          "O periodo selecionado contem projetos com Estado Trabalho CONCLUIDO. Altere o Estado Trabalho para diferente de CONCLUIDO antes de copiar a linha.",
        reason: "COPY_PERIOD_HAS_CONCLUIDO",
      },
      { status: 409 },
    );
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

export async function copyProgrammingToDates(request: NextRequest) {
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

  const completedProjectContext = await resolveProjectCompletedProgrammingContext({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    projectId: source.project_id,
  });

  if (completedProjectContext) {
    return NextResponse.json(
      buildProjectCompletedConflictResponse({
        message:
          "Este projeto esta com Estado Trabalho CONCLUIDO. Antes de copiar para outras datas, edite uma programacao e altere o Estado Trabalho para diferente de CONCLUIDO.",
        context: completedProjectContext,
      }),
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

  if (targetEtapas.some((etapa) => etapa <= source.etapa_number!)) {
    return NextResponse.json(
      { message: `As ETAPAs de destino devem ser maiores que a etapa atual da programacao de origem (${source.etapa_number}).` },
      { status: 400 },
    );
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

  const initialWorkCompletionStatus = await resolveInitialProjectWorkCompletionStatus({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    projectId: source.project_id,
  });

  if (!initialWorkCompletionStatus.ok) {
    return NextResponse.json(
      {
        success: false,
        reason: "WORK_COMPLETION_STATUS_REQUIRED",
        message: initialWorkCompletionStatus.message,
      } satisfies CopyProgrammingToDatesResponse,
      { status: initialWorkCompletionStatus.status },
    );
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
        workCompletionStatus: initialWorkCompletionStatus.workCompletionStatus,
        affectedCustomers: Number(model.affected_customers ?? 0),
        sgdTypeId: model.sgd_type_id,
        electricalEqCatalogId: model.electrical_eq_catalog_id,
        documents: buildDocuments(model),
        activities,
        historyActionOverride: "COPY",
        historyReason: "Copia de programacao para outras datas.",
        copiedFromProgrammingId: model.id,
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

export async function addTeamToProgramming(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para adicionar equipe a programacao.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const authorizationError = await authorizeProgrammingAction(resolution, "create");
  if (authorizationError) return authorizationError;

  const payload = (await request.json().catch(() => null)) as AddTeamToProgrammingPayload | null;
  const sourceProgrammingId = normalizeText(payload?.sourceProgrammingId);
  const targetTeamId = normalizeText(payload?.targetTeamId);
  const expectedUpdatedAt = normalizeText(payload?.expectedUpdatedAt);

  if (!sourceProgrammingId || !targetTeamId) {
    return NextResponse.json(
      { success: false, message: "Informe a programacao modelo e a equipe que sera adicionada." } satisfies AddTeamToProgrammingResponse,
      { status: 400 },
    );
  }

  if (!expectedUpdatedAt) {
    return NextResponse.json(
      { success: false, message: "Atualize a lista antes de adicionar equipe a programacao." } satisfies AddTeamToProgrammingResponse,
      { status: 409 },
    );
  }

  const source = await fetchProgrammingById(resolution.supabase, resolution.appUser.tenant_id, sourceProgrammingId);
  if (!source) {
    return NextResponse.json(
      { success: false, message: "Programacao modelo nao encontrada." } satisfies AddTeamToProgrammingResponse,
      { status: 404 },
    );
  }

  if (source.updated_at !== expectedUpdatedAt) {
    return NextResponse.json(
      { success: false, message: "Esta programacao foi alterada por outro usuario. Recarregue a lista antes de adicionar equipe." } satisfies AddTeamToProgrammingResponse,
      { status: 409 },
    );
  }

  if (!["PROGRAMADA", "REPROGRAMADA"].includes(source.status)) {
    return NextResponse.json(
      { success: false, message: "Somente programacoes ativas podem receber nova equipe." } satisfies AddTeamToProgrammingResponse,
      { status: 409 },
    );
  }

  const completedProjectContext = await resolveProjectCompletedProgrammingContext({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    projectId: source.project_id,
  });

  if (completedProjectContext) {
    return NextResponse.json(
      buildProjectCompletedConflictResponse({
        message:
          "Este projeto esta com Estado Trabalho CONCLUIDO. Antes de adicionar equipe, altere o Estado Trabalho para diferente de CONCLUIDO.",
        context: completedProjectContext,
      }),
      { status: 409 },
    );
  }

  const { data: targetTeams, error: targetTeamError } = await resolution.supabase
    .from("teams")
    .select("id, name")
    .eq("tenant_id", resolution.appUser.tenant_id)
    .eq("ativo", true)
    .eq("id", targetTeamId)
    .returns<Array<{ id: string; name: string | null }>>();

  if (targetTeamError) {
    return NextResponse.json(
      { success: false, message: "Falha ao validar a equipe selecionada." } satisfies AddTeamToProgrammingResponse,
      { status: 500 },
    );
  }

  const targetTeam = targetTeams?.[0] ?? null;
  const targetTeamName = normalizeText(targetTeam?.name) || targetTeamId;
  if (!targetTeam) {
    return NextResponse.json(
      { success: false, message: "A equipe selecionada esta inativa ou nao pertence ao tenant atual." } satisfies AddTeamToProgrammingResponse,
      { status: 400 },
    );
  }

  let duplicateQuery = resolution.supabase
    .from("project_programming")
    .select("id")
    .eq("tenant_id", resolution.appUser.tenant_id)
    .eq("project_id", source.project_id)
    .eq("team_id", targetTeamId)
    .eq("execution_date", source.execution_date)
    .in("status", ["PROGRAMADA", "REPROGRAMADA"])
    .limit(1);

  if (source.etapa_number) {
    duplicateQuery = duplicateQuery
      .eq("etapa_number", source.etapa_number)
      .eq("etapa_unica", false)
      .eq("etapa_final", false);
  } else {
    duplicateQuery = duplicateQuery
      .is("etapa_number", null)
      .eq("etapa_unica", Boolean(source.etapa_unica))
      .eq("etapa_final", Boolean(source.etapa_final));
  }

  const { data: duplicateRows, error: duplicateError } = await duplicateQuery.returns<Array<{ id: string }>>();
  if (duplicateError) {
    return NextResponse.json(
      { success: false, message: "Falha ao verificar se a equipe ja esta nesta programacao." } satisfies AddTeamToProgrammingResponse,
      { status: 500 },
    );
  }

  if (duplicateRows?.length) {
    return NextResponse.json(
      { success: false, reason: "TEAM_ALREADY_IN_PROGRAMMING", message: `A equipe ${targetTeamName} ja esta nesta programacao.` } satisfies AddTeamToProgrammingResponse,
      { status: 409 },
    );
  }

  if (source.etapa_number) {
    const stageConflicts = await fetchProgrammingStageValidation({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      projectId: source.project_id,
      teamIds: [targetTeamId],
      enteredEtapaNumber: source.etapa_number,
    });

    if (stageConflicts.length) {
      return NextResponse.json(
        {
          success: false,
          reason: "ETAPA_CONFLICT",
          enteredEtapaNumber: source.etapa_number,
          hasConflict: true,
          highestStage: stageConflicts.reduce((current, item) => Math.max(current, item.highestStage), 0),
          teams: stageConflicts,
          message: "A equipe selecionada possui ETAPA igual ou maior no historico deste projeto.",
        } satisfies AddTeamToProgrammingResponse,
        { status: 409 },
      );
    }
  }

  const { data: timeConflicts, error: timeConflictError } = await resolution.supabase
    .from("project_programming")
    .select("id, project_id, start_time, end_time")
    .eq("tenant_id", resolution.appUser.tenant_id)
    .eq("team_id", targetTeamId)
    .eq("execution_date", source.execution_date)
    .in("status", ["PROGRAMADA", "REPROGRAMADA"])
    .lt("start_time", source.end_time)
    .gt("end_time", source.start_time)
    .limit(1)
    .returns<Array<{ id: string; project_id: string; start_time: string | null; end_time: string | null }>>();

  if (timeConflictError) {
    return NextResponse.json(
      { success: false, message: "Falha ao validar conflitos de horario da equipe." } satisfies AddTeamToProgrammingResponse,
      { status: 500 },
    );
  }

  if (timeConflicts?.length) {
    const detailedConflictMessage = await resolveTeamTimeConflictDetailedMessage({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      executionDate: source.execution_date,
      startTime: source.start_time,
      endTime: source.end_time,
      teamIds: [targetTeamId],
    });

    return NextResponse.json(
      {
        success: false,
        reason: "TEAM_TIME_CONFLICT",
        message: detailedConflictMessage ?? `A equipe ${targetTeamName} possui conflito de horario nesta data.`,
      } satisfies AddTeamToProgrammingResponse,
      { status: 409 },
    );
  }

  if (source.work_completion_status) {
    const selectedWorkCompletionStatus = await resolveProgrammingWorkCompletionStatus({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      workCompletionStatus: source.work_completion_status,
    });

    if (!selectedWorkCompletionStatus) {
      return NextResponse.json(
        {
          success: false,
          reason: "WORK_COMPLETION_STATUS_INACTIVE",
          message: "O Estado Trabalho da programacao modelo nao esta ativo no catalogo do tenant atual.",
        } satisfies AddTeamToProgrammingResponse,
        { status: 409 },
      );
    }
  }

  const activities = await fetchProgrammingActivitiesForSave({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    programmingId: source.id,
  }) ?? [];

  const documents: NonNullable<SaveProgrammingPayload["documents"]> = {
    sgd: {
      number: normalizeSgdNumber(source.sgd_number) ?? "",
      approvedAt: source.sgd_included_at ?? "",
      requestedAt: source.sgd_delivered_at ?? "",
      includedAt: source.sgd_included_at ?? "",
      deliveredAt: source.sgd_delivered_at ?? "",
    },
    pi: {
      number: normalizeText(source.pi_number),
      approvedAt: source.pi_included_at ?? "",
      requestedAt: source.pi_delivered_at ?? "",
      includedAt: source.pi_included_at ?? "",
      deliveredAt: source.pi_delivered_at ?? "",
    },
    pep: {
      number: normalizeText(source.pep_number),
      approvedAt: source.pep_included_at ?? "",
      requestedAt: source.pep_delivered_at ?? "",
      includedAt: source.pep_included_at ?? "",
      deliveredAt: source.pep_delivered_at ?? "",
    },
  };

  const saveResult = await saveProgrammingFullViaRpc({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    actorUserId: resolution.appUser.id,
    projectId: source.project_id,
    teamId: targetTeamId,
    executionDate: source.execution_date,
    period: source.period,
    startTime: source.start_time,
    endTime: source.end_time,
    expectedMinutes: Number(source.expected_minutes ?? 0),
    outageStartTime: source.outage_start_time,
    outageEndTime: source.outage_end_time,
    feeder: source.feeder,
    support: source.support,
    supportItemId: source.support_item_id,
    note: source.note,
    electricalField: source.campo_eletrico,
    serviceDescription: source.service_description,
    posteQty: Number(source.poste_qty ?? 0),
    estruturaQty: Number(source.estrutura_qty ?? 0),
    trafoQty: Number(source.trafo_qty ?? 0),
    redeQty: Number(source.rede_qty ?? 0),
    etapaNumber: source.etapa_number,
    etapaUnica: Boolean(source.etapa_unica),
    etapaFinal: Boolean(source.etapa_final),
    workCompletionStatus: source.work_completion_status,
    affectedCustomers: Number(source.affected_customers ?? 0),
    sgdTypeId: source.sgd_type_id,
    electricalEqCatalogId: source.electrical_eq_catalog_id,
    documents,
    activities,
    historyActionOverride: "CREATE",
    historyReason: "Adicao de equipe em programacao existente.",
    copiedFromProgrammingId: source.id,
    historyMetadata: {
      source: "programacao-api",
      action: "ADD_TEAM",
      sourceProgrammingId: source.id,
      sourceTeamId: source.team_id,
      targetTeamId,
      sourceExecutionDate: source.execution_date,
      sourceEtapaNumber: source.etapa_number,
      sourceEtapaUnica: Boolean(source.etapa_unica),
      sourceEtapaFinal: Boolean(source.etapa_final),
    },
  });

  if (!saveResult.ok) {
    return NextResponse.json(
      {
        success: false,
        reason: "reason" in saveResult ? saveResult.reason ?? null : null,
        detail: "detail" in saveResult ? saveResult.detail ?? null : null,
        message: saveResult.message ?? "Falha ao adicionar equipe a programacao.",
      } satisfies AddTeamToProgrammingResponse,
      { status: saveResult.status },
    );
  }

  return NextResponse.json({
    success: true,
    id: saveResult.programmingId,
    addedCount: 1,
    message: `Equipe ${targetTeamName} adicionada a programacao.`,
  } satisfies AddTeamToProgrammingResponse);
}

export async function saveProgrammingBatch(request: NextRequest) {
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

export async function saveProgramming(request: NextRequest, method: "POST" | "PUT") {
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

  if (method === "PUT" && currentProgramming && (currentProgramming.status === "CANCELADA" || currentProgramming.status === "ADIADA")) {
    return NextResponse.json(
      { message: "Nao e possivel editar uma programacao cancelada ou adiada. Crie uma nova programacao." },
      { status: 409 },
    );
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

  if (isPotentialReschedule && changeReason && changeReason.trim().length < 10) {
    return NextResponse.json({ message: "O motivo de reprogramacao deve ter ao menos 10 caracteres." }, { status: 400 });
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

  if (method === "PUT" && isCompletedWorkStatus(normalizedWorkCompletionStatus) && etapaNumber !== null) {
    const anticipatedStagesResult = await markFutureProgrammingStagesAnticipatedViaRpc({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      actorUserId: resolution.appUser.id,
      sourceProgrammingId: persistedProgrammingId,
      sourceEtapaNumber: etapaNumber,
    });

    if (!anticipatedStagesResult.ok) {
      return NextResponse.json(
        {
          message: `Programacao salva como CONCLUIDO, mas houve falha ao atualizar etapas futuras para ANTECIPADO. ${anticipatedStagesResult.message}`,
          reason: anticipatedStagesResult.reason ?? null,
          detail: "detail" in anticipatedStagesResult ? anticipatedStagesResult.detail ?? null : null,
        },
        { status: anticipatedStagesResult.status },
      );
    }
  }

  if (
    method === "PUT"
    && isCompletedWorkStatus(currentProgramming?.work_completion_status ?? null)
    && !isCompletedWorkStatus(normalizedWorkCompletionStatus)
    && etapaNumber !== null
  ) {
    const { error: revertAnticipatedError } = await resolution.supabase
      .from("project_programming")
      .update({ work_completion_status: null, updated_by: resolution.appUser.id })
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("project_id", projectId)
      .gt("etapa_number", etapaNumber)
      .in("status", ["PROGRAMADA", "REPROGRAMADA"])
      .eq("work_completion_status", "ANTECIPADA");

    if (revertAnticipatedError) {
      return NextResponse.json(
        {
          message: `Programacao salva, mas houve falha ao reverter etapas ANTECIPADA. ${revertAnticipatedError.message}`,
          reason: "ANTICIPATED_REVERT_FAILED",
        },
        { status: 500 },
      );
    }
  }

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

export async function saveProgrammingWorkCompletionStatus(request: NextRequest, payload: CancelProgrammingPayload) {
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

  const programmingBeforeReopen = await fetchProgrammingById(
    resolution.supabase,
    resolution.appUser.tenant_id,
    programmingId,
  );

  if (
    programmingBeforeReopen
    && (programmingBeforeReopen.status === "CANCELADA" || programmingBeforeReopen.status === "ADIADA")
  ) {
    return NextResponse.json(
      { message: "Nao e possivel alterar o Estado Trabalho de uma programacao cancelada ou adiada." },
      { status: 409 },
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

  if (
    programmingBeforeReopen
    && isCompletedWorkStatus(programmingBeforeReopen.work_completion_status)
    && programmingBeforeReopen.etapa_number !== null
  ) {
    const { error: revertAnticipatedError } = await resolution.supabase
      .from("project_programming")
      .update({ work_completion_status: null, updated_by: resolution.appUser.id })
      .eq("tenant_id", resolution.appUser.tenant_id)
      .eq("project_id", programmingBeforeReopen.project_id)
      .gt("etapa_number", programmingBeforeReopen.etapa_number)
      .in("status", ["PROGRAMADA", "REPROGRAMADA"])
      .eq("work_completion_status", "ANTECIPADA");

    if (revertAnticipatedError) {
      return NextResponse.json(
        {
          message: `Estado Trabalho salvo, mas houve falha ao reverter etapas ANTECIPADA. ${revertAnticipatedError.message}`,
          reason: "ANTICIPATED_REVERT_FAILED",
        },
        { status: 500 },
      );
    }
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
