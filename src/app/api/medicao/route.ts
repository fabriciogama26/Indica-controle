import { NextRequest, NextResponse } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { parsePagination } from "@/lib/server/apiHelpers";
import { fetchProjectServiceCenterMap } from "@/server/modules/projects/serviceCenters";

import type { MeasurementOrderActivityFilterRow, MeasurementOrderAggregateItem, MeasurementOrderRow, MeasurementOrderStatus, ProgrammingMatchStatus, ProjectServiceTypeProjectRow, SaveMeasurementBatchPayload, SaveMeasurementBatchRpcResult, SaveMeasurementPayload, SaveMeasurementRpcResult, SetMeasurementStatusRpcResult, UpdateStatusPayload } from "@/server/modules/medicao/types";
import { buildMeasurementCycleStart, buildProgrammingMatchKey, findDuplicateMeasurementActivityId, measurementScoreTypeLabel, normalizeIsoDate, normalizeMeasurementItems, normalizeMeasurementKind, normalizePositiveIntegerArray, normalizePositiveNumber, normalizeText, normalizeUuid, resolveAppUserName, resolveMeasurementWorkCompletionStatus } from "@/server/modules/medicao/normalizers";
import { MEASUREMENT_ORDER_SELECT, fetchAppUserMap, fetchFinancialTargetMap, fetchMeasurementOrderDetail, fetchPagedSupabaseRows, fetchPointTargetMap, fetchProjectIsTestMap, fetchTeamCompositionContextSet, fetchTeamTypeResolutionMaps, loadHistory, measurementModuleMigrationHint, resolveOrderTeamType } from "@/server/modules/medicao/queries";
import { loadProgrammingMatchMap } from "@/server/modules/medicao/programmingMatch";
export async function GET(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para consultar ordens de medicao.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const historyOrderId = normalizeUuid(request.nextUrl.searchParams.get("historyOrderId"));
  if (historyOrderId) {
    const history = await loadHistory({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      orderId: historyOrderId,
    });

    if (history === null) {
      return NextResponse.json({ message: "Falha ao carregar historico da ordem de medicao." }, { status: 500 });
    }

    return NextResponse.json({ history });
  }

  const orderId = normalizeUuid(request.nextUrl.searchParams.get("orderId"));
  if (orderId) {
    const detailWindowEndDate = normalizeIsoDate(request.nextUrl.searchParams.get("endDate"));
    const detail = await fetchMeasurementOrderDetail({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      orderId,
      windowEndDate: detailWindowEndDate,
    });

    if (!detail) {
      return NextResponse.json({ message: "Ordem de medicao nao encontrada." }, { status: 404 });
    }

    return NextResponse.json({ order: detail });
  }

  const startDate = normalizeIsoDate(request.nextUrl.searchParams.get("startDate"));
  const endDate = normalizeIsoDate(request.nextUrl.searchParams.get("endDate"));
  const projectId = normalizeUuid(request.nextUrl.searchParams.get("projectId"));
  const teamId = normalizeUuid(request.nextUrl.searchParams.get("teamId"));
  const serviceTypeIdRaw = normalizeText(request.nextUrl.searchParams.get("serviceTypeId"));
  const serviceTypeId = normalizeUuid(serviceTypeIdRaw);
  const activityIdRaw = normalizeText(request.nextUrl.searchParams.get("activityId"));
  const activityId = normalizeUuid(activityIdRaw);
  const statusFilter = normalizeText(request.nextUrl.searchParams.get("status")).toUpperCase();
  const measurementKindFilter = normalizeText(request.nextUrl.searchParams.get("measurementKind")).toUpperCase();
  const noProductionReasonIdFilter = normalizeUuid(request.nextUrl.searchParams.get("noProductionReasonId"));
  const programmingMatchFilter = normalizeText(request.nextUrl.searchParams.get("programmingMatch")).toUpperCase();
  const workCompletionStatusFilterRaw = normalizeText(request.nextUrl.searchParams.get("workCompletionStatus")).toUpperCase();
  const workCompletionStatusFilter = workCompletionStatusFilterRaw === "NAO_INFORMADO"
    ? workCompletionStatusFilterRaw
    : resolveMeasurementWorkCompletionStatus(workCompletionStatusFilterRaw) ?? workCompletionStatusFilterRaw;
  const completionAlertFilter = normalizeText(request.nextUrl.searchParams.get("completionAlert")).toUpperCase();
  const { page, pageSize } = parsePagination(request.nextUrl.searchParams, {
    defaultPageSize: 20,
    maxPageSize: 500,
    maxPage: 10_000,
  });

  if (!startDate || !endDate) {
    return NextResponse.json({ message: "startDate e endDate sao obrigatorios." }, { status: 400 });
  }

  if (serviceTypeIdRaw && !serviceTypeId) {
    return NextResponse.json({ message: "Tipo de Servico invalido." }, { status: 400 });
  }

  if (activityIdRaw && !activityId) {
    return NextResponse.json({ message: "Atividade invalida." }, { status: 400 });
  }

  let serviceTypeProjectIdSet: Set<string> | null = null;
  if (serviceTypeId) {
    const serviceTypeProjectsResult = await fetchPagedSupabaseRows<ProjectServiceTypeProjectRow>((from, to) =>
      resolution.supabase
        .from("project")
        .select("id")
        .eq("tenant_id", resolution.appUser.tenant_id)
        .eq("service_type", serviceTypeId)
        .range(from, to)
        .returns<ProjectServiceTypeProjectRow[]>(),
    );

    if (serviceTypeProjectsResult.error) {
      return NextResponse.json({ message: "Falha ao filtrar projetos por Tipo de Servico." }, { status: 500 });
    }

    serviceTypeProjectIdSet = new Set(serviceTypeProjectsResult.data.map((item) => item.id));
  }

  let activityOrderIdSet: Set<string> | null = null;
  if (activityId) {
    const activityOrdersResult = await fetchPagedSupabaseRows<MeasurementOrderActivityFilterRow>((from, to) =>
      resolution.supabase
        .from("project_measurement_order_items")
        .select("measurement_order_id")
        .eq("tenant_id", resolution.appUser.tenant_id)
        .eq("service_activity_id", activityId)
        .eq("is_active", true)
        .range(from, to)
        .returns<MeasurementOrderActivityFilterRow[]>(),
    );

    if (activityOrdersResult.error) {
      return NextResponse.json({ message: "Falha ao filtrar ordens por atividade." }, { status: 500 });
    }

    activityOrderIdSet = new Set(activityOrdersResult.data.map((item) => item.measurement_order_id));

    if (activityOrderIdSet.size === 0) {
      return NextResponse.json({ orders: [], pagination: { page, pageSize, total: 0 } });
    }
  }

  const startIndex = ((page ?? 1) - 1) * (pageSize ?? 20);

    let pagedQuery = resolution.supabase
      .from("project_measurement_orders")
      .select(MEASUREMENT_ORDER_SELECT, { count: "exact" })
      .eq("tenant_id", resolution.appUser.tenant_id)
      .gte("execution_date", startDate)
      .lte("execution_date", endDate)
      .order("execution_date", { ascending: false })
      .order("updated_at", { ascending: false });

    if (projectId) pagedQuery = pagedQuery.eq("project_id", projectId);
    if (teamId) pagedQuery = pagedQuery.eq("team_id", teamId);
    if (statusFilter && statusFilter !== "TODOS") pagedQuery = pagedQuery.eq("status", statusFilter);
    if (serviceTypeProjectIdSet && serviceTypeProjectIdSet.size > 0) {
      pagedQuery = pagedQuery.in("project_id", Array.from(serviceTypeProjectIdSet));
    }
    if (measurementKindFilter === "COM_PRODUCAO" || measurementKindFilter === "SEM_PRODUCAO") {
      pagedQuery = pagedQuery.eq("measurement_kind", measurementKindFilter);
    }
    if (noProductionReasonIdFilter) {
      pagedQuery = pagedQuery.eq("no_production_reason_id", noProductionReasonIdFilter);
    }
    if (activityOrderIdSet && activityOrderIdSet.size > 0) {
      pagedQuery = pagedQuery.in("id", Array.from(activityOrderIdSet));
    }

    const { data: pagedData, count: pagedCount, error: pagedError } = await pagedQuery
      .range(startIndex, startIndex + (pageSize ?? 20) - 1)
      .returns<MeasurementOrderRow[]>();

    if (pagedError) {
      const hint = measurementModuleMigrationHint(pagedError.message);
      return NextResponse.json({ message: `Falha ao listar ordens de medicao.${hint}`.trim() }, { status: 500 });
    }

    const simpleOrders = pagedData ?? [];
    const simpleTotal = pagedCount ?? 0;

    const simpleProjectIds = Array.from(new Set(simpleOrders.map((item) => item.project_id)));
    const simpleUserIds = Array.from(
      new Set(
        simpleOrders
          .flatMap((item) => [item.created_by, item.updated_by])
          .filter((item): item is string => Boolean(item)),
      ),
    );

    const [
      simpleUserMap,
      simpleProgrammingMatchMap,
      simpleProjectIsTestMap,
      simpleProjectServiceCenterMap,
      simpleTeamCompositionContexts,
    ] = await Promise.all([
      fetchAppUserMap({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        ids: simpleUserIds,
      }),
      loadProgrammingMatchMap({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        windowEndDate: endDate,
        orders: simpleOrders,
      }),
      fetchProjectIsTestMap({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        projectIds: simpleProjectIds,
      }),
      fetchProjectServiceCenterMap({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        projectIds: simpleProjectIds,
      }),
      fetchTeamCompositionContextSet({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        orders: simpleOrders,
      }),
    ]);

    if (simpleTeamCompositionContexts.error) {
      return NextResponse.json({ message: "Falha ao carregar composicoes de equipe das ordens de medicao." }, { status: 500 });
    }

    const simpleBaseOrders = simpleOrders.map((item) => {
      const programmingMatch = simpleProgrammingMatchMap.get(item.id) ?? {
        status: "NAO_PROGRAMADA" as ProgrammingMatchStatus,
        programmingId: null,
        completionStatus: null,
        completionStatusChangedAfterMeasurement: false,
      };
      return {
        id: item.id,
        orderNumber: normalizeText(item.order_number),
        programmingId: item.programming_id,
        projectId: item.project_id,
        teamId: item.team_id,
        executionDate: item.execution_date,
        measurementDate: item.measurement_date,
        voicePoint: Number(item.voice_point ?? 0),
        manualRate: Number(item.manual_rate ?? 0),
        measurementKind: normalizeMeasurementKind(item.measurement_kind),
        noProductionReasonId: item.no_production_reason_id,
        noProductionReasonName: normalizeText(item.no_production_reason_name_snapshot),
        status: item.status,
        notes: normalizeText(item.notes),
        projectCode: normalizeText(item.project_code_snapshot),
        projectServiceCenter: simpleProjectServiceCenterMap.get(item.project_id) ?? "Sem base",
        teamName: normalizeText(item.team_name_snapshot),
        foremanName: normalizeText(item.foreman_name_snapshot),
        cancellationReason: normalizeText(item.cancellation_reason),
        canceledAt: item.canceled_at,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        createdByName: resolveAppUserName(simpleUserMap.get(item.created_by ?? "")),
        updatedByName: resolveAppUserName(simpleUserMap.get(item.updated_by ?? "")),
        projectIsTest: Boolean(simpleProjectIsTestMap.get(item.project_id)),
        hasTeamComposition: simpleTeamCompositionContexts.data.has(
          buildProgrammingMatchKey(item.project_id, item.team_id, item.execution_date),
        ),
        programmingMatchStatus: programmingMatch.status,
        matchedProgrammingId: programmingMatch.programmingId,
        programmingCompletionStatus: programmingMatch.completionStatus,
        programmingCompletionStatusChangedAfterMeasurement: programmingMatch.completionStatusChangedAfterMeasurement,
        minimumBillingAmount: Number(item.minimum_billing_amount ?? 0),
        minimumBillingTeamTypeId: item.minimum_billing_team_type_id,
        minimumBillingTeamTypeName: normalizeText(item.minimum_billing_team_type_name_snapshot),
        minimumBillingScoreTargetId: item.minimum_billing_score_target_id,
        minimumBillingTargetPoints: Number(item.minimum_billing_target_points ?? 0),
        minimumBillingUnitValueSourceActivityId: item.minimum_billing_unit_value_source_activity_id,
        minimumBillingUnitValueGroup: normalizeText(item.minimum_billing_unit_value_group_snapshot),
        minimumBillingUnitValue: Number(item.minimum_billing_unit_value ?? 0),
        minimumBillingCalculatedAt: item.minimum_billing_calculated_at,
      };
    });

    const simpleNonTestOrders = simpleBaseOrders.filter((item) => !item.projectIsTest);

    const simpleFilteredByProgramming = (programmingMatchFilter === "PROGRAMADA" || programmingMatchFilter === "NAO_PROGRAMADA")
      ? simpleNonTestOrders.filter((item) => item.programmingMatchStatus === programmingMatchFilter)
      : simpleNonTestOrders;

    const simpleFilteredByWorkCompletion = workCompletionStatusFilter === "NAO_INFORMADO"
      ? simpleFilteredByProgramming.filter((item) => !item.programmingCompletionStatus)
      : (workCompletionStatusFilter && workCompletionStatusFilter !== "TODOS"
          ? simpleFilteredByProgramming.filter((item) => item.programmingCompletionStatus === workCompletionStatusFilter)
          : simpleFilteredByProgramming);

    const simplePagedBaseOrders = (completionAlertFilter === "SIM" || completionAlertFilter === "NAO")
      ? simpleFilteredByWorkCompletion.filter((item) =>
          completionAlertFilter === "SIM"
            ? item.programmingCompletionStatusChangedAfterMeasurement
            : !item.programmingCompletionStatusChangedAfterMeasurement)
      : simpleFilteredByWorkCompletion;

    const simpleTeamTypeResolutionMaps = await fetchTeamTypeResolutionMaps({
      supabase: resolution.supabase,
      tenantId: resolution.appUser.tenant_id,
      orders: simplePagedBaseOrders,
    });
    const simpleOrderTeamTypeMap = new Map<string, { teamTypeId: string | null; teamTypeName: string; typeLabel: string }>();
    for (const item of simplePagedBaseOrders) {
      const resolvedTeamType = resolveOrderTeamType({
        teamId: item.teamId,
        executionDate: item.executionDate,
        teamTypeByTeam: simpleTeamTypeResolutionMaps.teamTypeByTeam,
        teamTypeNameById: simpleTeamTypeResolutionMaps.teamTypeNameById,
        historyByTeam: simpleTeamTypeResolutionMaps.historyByTeam,
      });
      simpleOrderTeamTypeMap.set(item.id, {
        ...resolvedTeamType,
        typeLabel: measurementScoreTypeLabel(resolvedTeamType.teamTypeName),
      });
    }
    const simpleScoreTeamTypeIds = Array.from(
      new Set(
        Array.from(simpleOrderTeamTypeMap.values())
          .map((item) => item.teamTypeId)
          .filter((item): item is string => Boolean(item)),
      ),
    );
    const [simplePointTargetMap, simpleFinancialTargets] = await Promise.all([
      fetchPointTargetMap({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        teamTypeIds: simpleScoreTeamTypeIds,
      }),
      fetchFinancialTargetMap({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        orders: simplePagedBaseOrders,
        teamTypeIds: simpleScoreTeamTypeIds,
      }),
    ]);

    const simplePagedOrderIds = simplePagedBaseOrders.map((item) => item.id);
    const simpleAggregateItemsResult = simplePagedOrderIds.length
      ? await fetchPagedSupabaseRows<MeasurementOrderAggregateItem>((from, to) =>
          resolution.supabase
            .from("project_measurement_order_items")
            .select("measurement_order_id, total_value, quantity, voice_point")
            .eq("tenant_id", resolution.appUser.tenant_id)
            .eq("is_active", true)
            .in("measurement_order_id", simplePagedOrderIds)
            .range(from, to)
            .returns<MeasurementOrderAggregateItem[]>(),
        )
      : { data: [] as MeasurementOrderAggregateItem[], error: null };

    if (simpleAggregateItemsResult.error) {
      return NextResponse.json({ message: "Falha ao consolidar totais das ordens de medicao." }, { status: 500 });
    }

    const simpleAggregateMap = new Map<string, { totalAmount: number; itemCount: number; scorePoints: number }>();
    for (const item of simpleAggregateItemsResult.data ?? []) {
      const current = simpleAggregateMap.get(item.measurement_order_id) ?? { totalAmount: 0, itemCount: 0, scorePoints: 0 };
      current.totalAmount += Number(item.total_value ?? 0);
      current.itemCount += 1;
      current.scorePoints += Number(item.voice_point ?? 0) * Number(item.quantity ?? 0);
      simpleAggregateMap.set(item.measurement_order_id, current);
    }

    const simplePagedOrders = simplePagedBaseOrders.map((item) => {
      const aggregate = simpleAggregateMap.get(item.id) ?? { totalAmount: 0, itemCount: 0, scorePoints: 0 };
      const teamType = simpleOrderTeamTypeMap.get(item.id) ?? { teamTypeId: null, teamTypeName: "", typeLabel: "Nao identificado" };
      const cycleStart = buildMeasurementCycleStart(item.executionDate);
      const financialTarget = teamType.teamTypeId
        ? simpleFinancialTargets.cycleTargetMap.get(`${cycleStart}:${teamType.teamTypeId}`)
          ?? simpleFinancialTargets.fallbackTargetMap.get(teamType.teamTypeId)
          ?? 0
        : 0;
      return {
        ...item,
        totalAmount: Number(aggregate.totalAmount ?? 0) + Number(item.minimumBillingAmount ?? 0),
        itemCount: Number(aggregate.itemCount ?? 0),
        scorePoints: Number(aggregate.scorePoints ?? 0) + Number(item.minimumBillingTargetPoints ?? 0),
        teamTypeId: teamType.teamTypeId,
        teamTypeName: teamType.typeLabel,
        pointTarget: teamType.teamTypeId ? simplePointTargetMap.get(teamType.teamTypeId) ?? 0 : 0,
        financialTarget,
      };
    });

    return NextResponse.json({
      orders: simplePagedOrders,
      pagination: {
        page: page ?? 1,
        pageSize: pageSize ?? 20,
        total: simpleTotal,
      },
    });
}

// Chamada quando a RPC de save/status devolve 409 (CONCURRENT_MODIFICATION /
// MEASUREMENT_ORDER_LOCKED): devolve o estado atual da ordem (ja reconsultado pelo
// chamador) para o cliente saber quem alterou e o que estava tentando mudar, em vez
// de so uma mensagem generica.
function buildMeasurementConflictResponse(params: {
  detail: Awaited<ReturnType<typeof fetchMeasurementOrderDetail>>;
  message: string;
  reason: string | null;
  status: number;
  changedFields?: Record<string, { from: unknown; to: unknown }>;
}) {
  const { detail } = params;
  return NextResponse.json(
    {
      message: params.message,
      reason: params.reason,
      currentRecord: detail,
      currentUpdatedAt: detail?.updatedAt ?? null,
      updatedBy: detail?.updatedByName ?? null,
      ...(params.changedFields ? { changedFields: params.changedFields } : {}),
    },
    { status: params.status },
  );
}

function buildMeasurementChangedFields(
  payload: SaveMeasurementPayload | null,
  current: Awaited<ReturnType<typeof fetchMeasurementOrderDetail>>,
): Record<string, { from: unknown; to: unknown }> {
  if (!payload || !current) return {};
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const add = (field: string, currentValue: unknown, attemptedValue: unknown) => {
    if (attemptedValue === undefined) return;
    if (String(currentValue ?? "") === String(attemptedValue ?? "")) return;
    changes[field] = { from: currentValue, to: attemptedValue };
  };
  add("projectId", current.projectId, normalizeUuid(payload.projectId));
  add("teamId", current.teamId, normalizeUuid(payload.teamId));
  add("executionDate", current.executionDate, normalizeIsoDate(payload.executionDate));
  add("measurementDate", current.measurementDate, normalizeIsoDate(payload.measurementDate));
  add("notes", current.notes, normalizeText(payload.notes) || null);
  return changes;
}

async function saveMeasurementOrder(request: NextRequest, method: "POST" | "PUT") {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para salvar ordem de medicao.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const payload = (await request.json().catch(() => null)) as SaveMeasurementPayload | null;
  const orderId = normalizeUuid(payload?.id);
  const programmingId = normalizeUuid(payload?.programmingId);
  const projectId = normalizeUuid(payload?.projectId);
  const teamId = normalizeUuid(payload?.teamId);
  const executionDate = normalizeIsoDate(payload?.executionDate);
  const measurementDate = normalizeIsoDate(payload?.measurementDate);
  const voicePoint = normalizePositiveNumber(payload?.voicePoint);
  const manualRate = normalizePositiveNumber(payload?.manualRate);
  const measurementKind = normalizeMeasurementKind(payload?.measurementKind);
  const noProductionReasonId = normalizeUuid(payload?.noProductionReasonId);
  const notes = normalizeText(payload?.notes) || null;
  const expectedUpdatedAt = normalizeText(payload?.expectedUpdatedAt) || null;

  if (method === "PUT" && !orderId) {
    return NextResponse.json({ message: "Ordem de medicao invalida para edicao." }, { status: 400 });
  }

  if (method === "PUT" && (!projectId || !teamId || !executionDate)) {
    return NextResponse.json({ message: "Na edicao, Projeto, Equipe e Data de execucao sao obrigatorios." }, { status: 400 });
  }

  if (method === "POST" && !programmingId && (!projectId || !teamId || !executionDate)) {
    return NextResponse.json({ message: "Informe Projeto, Equipe e Data de execucao para cadastrar a medicao sem programacao." }, { status: 400 });
  }

  if (!measurementDate) {
    return NextResponse.json({ message: "Data da medicao e obrigatoria." }, { status: 400 });
  }

  const items = normalizeMeasurementItems(payload?.items);

  if (measurementKind === "COM_PRODUCAO") {
    if (noProductionReasonId) {
      return NextResponse.json({ message: "Motivo sem producao so pode ser informado para tipo Sem producao." }, { status: 400 });
    }

    if (voicePoint === null || manualRate === null) {
      return NextResponse.json({ message: "Para medicao com producao, pontos e taxa manual sao obrigatorios." }, { status: 400 });
    }

    if (!items.length) {
      return NextResponse.json({ message: "Informe ao menos uma atividade valida na ordem de medicao." }, { status: 400 });
    }
  }

  if (measurementKind === "SEM_PRODUCAO") {
    if (!noProductionReasonId) {
      return NextResponse.json({ message: "Selecione o motivo de sem producao." }, { status: 400 });
    }

    if (items.length) {
      return NextResponse.json({ message: "Medicao sem producao nao pode conter atividades." }, { status: 400 });
    }
  }

  if (findDuplicateMeasurementActivityId(items)) {
    return NextResponse.json(
      { message: "A mesma atividade nao pode ser repetida na ordem de medicao.", reason: "DUPLICATE_MEASUREMENT_ACTIVITY" },
      { status: 400 },
    );
  }

  const { data, error } = await resolution.supabase.rpc("save_project_measurement_order", {
    p_tenant_id: resolution.appUser.tenant_id,
    p_actor_user_id: resolution.appUser.id,
    p_measurement_order_id: method === "PUT" ? orderId : null,
    p_programming_id: programmingId,
    p_project_id: projectId,
    p_team_id: teamId,
    p_execution_date: executionDate,
    p_measurement_date: measurementDate,
    p_voice_point: voicePoint ?? 1,
    p_manual_rate: manualRate ?? 1,
    p_notes: notes,
    p_measurement_kind: measurementKind,
    p_no_production_reason_id: measurementKind === "SEM_PRODUCAO" ? noProductionReasonId : null,
    p_items: items,
    p_expected_updated_at: expectedUpdatedAt,
  });

  if (error) {
    const hint = measurementModuleMigrationHint(error.message);
    return NextResponse.json({ message: `Falha ao salvar ordem de medicao.${hint}`.trim() }, { status: 500 });
  }

  const result = (data ?? {}) as SaveMeasurementRpcResult;
  if (result.success !== true) {
    const status = Number(result.status ?? 400);
    if (status === 409 && orderId) {
      const detail = await fetchMeasurementOrderDetail({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        orderId,
      });
      return buildMeasurementConflictResponse({
        detail,
        message: result.message ?? "Falha ao salvar ordem de medicao.",
        reason: result.reason ?? null,
        status,
        changedFields: buildMeasurementChangedFields(payload, detail),
      });
    }
    return NextResponse.json({ message: result.message ?? "Falha ao salvar ordem de medicao.", reason: result.reason ?? null }, { status });
  }

  const persistedOrderId = normalizeUuid(result.measurement_order_id ?? "");
  if (!persistedOrderId) {
    return NextResponse.json({ message: "Ordem salva, mas nao foi possivel retornar o identificador." }, { status: 500 });
  }

  const detail = await fetchMeasurementOrderDetail({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    orderId: persistedOrderId,
  });

  return NextResponse.json({
    success: true,
    id: persistedOrderId,
    updatedAt: result.updated_at ?? null,
    order: detail,
    message: result.message ?? "Ordem de medicao salva com sucesso.",
  });
}

async function saveMeasurementOrderBatchPartial(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para importar medicao em lote.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const payload = (await request.json().catch(() => null)) as SaveMeasurementBatchPayload | null;
  const rowsInput = Array.isArray(payload?.rows) ? payload.rows : [];
  if (!rowsInput.length) {
    return NextResponse.json({ message: "Nenhuma linha valida enviada para importacao em massa." }, { status: 400 });
  }

  const rows = rowsInput.map((row, index) => {
    const executionDate = normalizeIsoDate(row.executionDate);
    const measurementDate = normalizeIsoDate(row.measurementDate) ?? executionDate;
    const rowNumbers = normalizePositiveIntegerArray(row.rowNumbers);
    return {
      rowNumbers: rowNumbers.length ? rowNumbers : [index + 2],
      programmingId: normalizeUuid(row.programmingId),
      projectId: normalizeUuid(row.projectId),
      teamId: normalizeUuid(row.teamId),
      executionDate,
      measurementDate,
      voicePoint: normalizePositiveNumber(row.voicePoint) ?? 1,
      manualRate: normalizePositiveNumber(row.manualRate) ?? null,
      measurementKind: normalizeMeasurementKind(row.measurementKind),
      noProductionReasonId: normalizeUuid(row.noProductionReasonId),
      notes: normalizeText(row.notes) || null,
      items: normalizeMeasurementItems(row.items),
    };
  });

  const { data, error } = await resolution.supabase.rpc("save_project_measurement_order_batch_partial", {
    p_tenant_id: resolution.appUser.tenant_id,
    p_actor_user_id: resolution.appUser.id,
    p_rows: rows,
  });

  if (error) {
    const hint = measurementModuleMigrationHint(error.message);
    return NextResponse.json({ message: `Falha ao importar medicao em lote.${hint}`.trim() }, { status: 500 });
  }

  const result = (data ?? {}) as SaveMeasurementBatchRpcResult;
  if (result.success !== true) {
    return NextResponse.json(
      { message: result.message ?? "Falha ao importar medicao em lote.", reason: result.reason ?? null },
      { status: Number(result.status ?? 400) },
    );
  }

  const normalizedResults = (Array.isArray(result.results) ? result.results : []).map((item) => ({
    rowIndex: Number(item.rowIndex ?? 0) || null,
    rowNumbers: normalizePositiveIntegerArray(item.rowNumbers),
    success: item.success === true,
    alreadyRegistered: item.alreadyRegistered === true,
    reason: normalizeText(item.reason) || null,
    message: normalizeText(item.message) || "Falha ao processar linha do lote.",
    measurementOrderId: normalizeUuid(item.measurementOrderId ?? "") ?? null,
  }));

  return NextResponse.json({
    success: true,
    status: Number(result.status ?? 200),
    savedCount: Number(result.savedCount ?? 0),
    errorCount: Number(result.errorCount ?? 0),
    alreadyRegisteredCount: Number(result.alreadyRegisteredCount ?? 0),
    alreadyRegisteredRows: Number(result.alreadyRegisteredRows ?? 0),
    results: normalizedResults,
    message: normalizeText(result.message) || "Importacao parcial da medicao concluida.",
  });
}

export async function POST(request: NextRequest) {
  const preview = (await request.clone().json().catch(() => null)) as { action?: string } | null;
  const action = normalizeText(preview?.action).toUpperCase();
  if (action === "BATCH_IMPORT_PARTIAL") {
    return saveMeasurementOrderBatchPartial(request);
  }
  return saveMeasurementOrder(request, "POST");
}

export async function PUT(request: NextRequest) {
  return saveMeasurementOrder(request, "PUT");
}

export async function PATCH(request: NextRequest) {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: "Sessao invalida para alterar status da ordem de medicao.",
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
  }

  const payload = (await request.json().catch(() => null)) as UpdateStatusPayload | null;
  const orderId = normalizeUuid(payload?.id);
  const action = normalizeText(payload?.action).toUpperCase();
  const expectedUpdatedAt = normalizeText(payload?.expectedUpdatedAt) || null;
  const reason = normalizeText(payload?.reason) || null;

  if (!orderId || (action !== "FECHAR" && action !== "CANCELAR" && action !== "ABRIR")) {
    return NextResponse.json({ message: "Informe ordem e acao valida para atualizar o status." }, { status: 400 });
  }

  if (!expectedUpdatedAt) {
    return NextResponse.json({ message: "Atualize a lista antes de alterar o status da ordem." }, { status: 409 });
  }

  if ((action === "CANCELAR" || action === "ABRIR") && (!reason || reason.length < 10)) {
    return NextResponse.json({ message: action === "ABRIR" ? "Informe motivo da reabertura com no minimo 10 caracteres." : "Informe motivo do cancelamento com no minimo 10 caracteres." }, { status: 400 });
  }

  const { data, error } = await resolution.supabase.rpc("set_project_measurement_order_status", {
    p_tenant_id: resolution.appUser.tenant_id,
    p_actor_user_id: resolution.appUser.id,
    p_measurement_order_id: orderId,
    p_action: action,
    p_reason: reason,
    p_expected_updated_at: expectedUpdatedAt,
  });

  if (error) {
    return NextResponse.json({ message: "Falha ao alterar status da ordem de medicao." }, { status: 500 });
  }

  const result = (data ?? {}) as SetMeasurementStatusRpcResult;
  if (result.success !== true) {
    const status = Number(result.status ?? 400);
    if (status === 409) {
      const detail = await fetchMeasurementOrderDetail({
        supabase: resolution.supabase,
        tenantId: resolution.appUser.tenant_id,
        orderId,
      });
      const targetStatus: MeasurementOrderStatus = action === "FECHAR" ? "FECHADA" : action === "CANCELAR" ? "CANCELADA" : "ABERTA";
      return buildMeasurementConflictResponse({
        detail,
        message: result.message ?? "Falha ao alterar status da ordem de medicao.",
        reason: result.reason ?? null,
        status,
        changedFields: { status: { from: detail?.status ?? null, to: targetStatus } },
      });
    }
    return NextResponse.json({ message: result.message ?? "Falha ao alterar status da ordem de medicao.", reason: result.reason ?? null }, { status });
  }

  const detail = await fetchMeasurementOrderDetail({
    supabase: resolution.supabase,
    tenantId: resolution.appUser.tenant_id,
    orderId,
  });

  return NextResponse.json({
    success: true,
    id: orderId,
    updatedAt: result.updated_at ?? null,
    status: result.measurement_status ?? null,
    order: detail,
    message: result.message ?? "Status da ordem de medicao atualizado com sucesso.",
  });
}
