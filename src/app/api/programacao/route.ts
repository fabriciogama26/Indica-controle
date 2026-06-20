import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { type PageAction } from "@/lib/server/pageAuthorization";
import {
  BOARD_PROJECT_SELECT_LEGACY,
  BOARD_PROJECT_SELECT_WITH_TEST,
  PROGRAMMING_SELECT_WITH_OUTAGE_STRUCTURE_AND_ENEL,
} from "@/server/modules/programacao/selects";
import type {
  AppUserLookupRow,
  BatchProgrammingRpcItem,
  BatchProgrammingRpcResult,
  BoardProjectBaseRow,
  BoardProjectRow,
  CancelProgrammingPayload,
  CancelProgrammingRpcResult,
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
  ProgrammingWorkCompletionCatalogRow,
  SaveProgrammingRpcResult,
  ServiceCenterRow,
  SupportOptionRow,
  TeamRow,
  TeamTypeRow,
  TeamWeekSummaryRow,
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
} from "@/server/modules/programacao/rpc";
import {
  fetchNextProgrammingStage,
  fetchProgrammingActivities,
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
  isIsoDate,
  isMissingProjectTestColumn,
  normalizeIsoDate,
  normalizeNullableText,
  normalizePositiveInteger,
  normalizeProgrammingStructureFields,
  normalizeQuestionnaireAnswers,
  normalizeSgdNumber,
  normalizeStatusToken,
  normalizeText,
  normalizeWorkCompletionStatus,
  resolveAppUserName,
  startOfWeekMonday,
} from "@/server/modules/programacao/normalizers";
import {
  authorizeProgrammingAction,
  copyProgramming,
  copyProgrammingToDates,
  resolveProjectCompletedProgrammingContext,
  saveProgramming,
  saveProgrammingBatch,
  saveProgrammingWorkCompletionStatus,
} from "@/server/modules/programacao/handlers";


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
