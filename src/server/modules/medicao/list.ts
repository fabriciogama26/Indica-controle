// Pipeline de listagem paginada de ordens de Medicao.
//
// Separado de queries.ts porque e um fluxo proprio: pre-resolucao de filtros por
// Tipo de Servico/Atividade, consulta paginada, pos-filtros em memoria e
// consolidacao de totais/metas. Consumido pelo handler GET e pela exportacao.

import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";
import { fetchProjectServiceCenterMap } from "@/server/modules/projects/serviceCenters";
import { loadProgrammingMatchMap } from "./programmingMatch";
import type { MeasurementOrderActivityFilterRow, MeasurementOrderAggregateItem, MeasurementOrderRow, ProgrammingMatchStatus, ProjectServiceTypeProjectRow } from "./types";
import { buildMeasurementCycleStart, buildProgrammingMatchKey, measurementScoreTypeLabel, normalizeMeasurementKind, normalizeText, resolveAppUserName } from "./normalizers";
import {
  MEASUREMENT_ORDER_SELECT,
  fetchAppUserMap,
  fetchFinancialTargetMap,
  fetchPagedSupabaseRows,
  fetchPointTargetMap,
  fetchProjectIsTestMap,
  fetchTeamCompositionContextSet,
  fetchTeamTypeResolutionMaps,
  measurementModuleMigrationHint,
  resolveOrderTeamType,
} from "./queries";

// Pipeline de listagem paginada de ordens de Medicao.
//
// Recebe filtros JA normalizados: o parse e a validacao 400 continuam no handler
// GET. Aqui so entra acesso a dados, para que a exportacao possa reusar a mesma
// consulta sem forjar um NextRequest e chamar a rota por HTTP.
//
// Atencao ao contrato: `total` vem do count da consulta ao banco, mas tres filtros
// (programmingMatch, workCompletionStatus, completionAlert) e o descarte de projeto
// de teste sao aplicados em memoria DEPOIS da pagina. Entao `total` e aproximado e a
// pagina pode vir com menos itens que `pageSize` -- comportamento preexistente,
// preservado de proposito.
export async function listMeasurementOrdersPage(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  startDate: string;
  endDate: string;
  projectId: string | null;
  teamId: string | null;
  serviceTypeId: string | null;
  activityId: string | null;
  statusFilter: string;
  measurementKindFilter: string;
  noProductionReasonIdFilter: string | null;
  programmingMatchFilter: string;
  workCompletionStatusFilter: string;
  completionAlertFilter: string;
  page: number | null;
  pageSize: number | null;
}) {
  const {
    supabase, tenantId, startDate, endDate, projectId, teamId, serviceTypeId, activityId,
    statusFilter, measurementKindFilter, noProductionReasonIdFilter, programmingMatchFilter,
    workCompletionStatusFilter, completionAlertFilter, page, pageSize,
  } = params;

  let serviceTypeProjectIdSet: Set<string> | null = null;
  if (serviceTypeId) {
    const serviceTypeProjectsResult = await fetchPagedSupabaseRows<ProjectServiceTypeProjectRow>((from, to) =>
      supabase
        .from("project")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("service_type", serviceTypeId)
        .range(from, to)
        .returns<ProjectServiceTypeProjectRow[]>(),
    );

    if (serviceTypeProjectsResult.error) {
      return { ok: false as const, message: "Falha ao filtrar projetos por Tipo de Servico." };
    }

    serviceTypeProjectIdSet = new Set(serviceTypeProjectsResult.data.map((item) => item.id));
  }

  let activityOrderIdSet: Set<string> | null = null;
  if (activityId) {
    const activityOrdersResult = await fetchPagedSupabaseRows<MeasurementOrderActivityFilterRow>((from, to) =>
      supabase
        .from("project_measurement_order_items")
        .select("measurement_order_id")
        .eq("tenant_id", tenantId)
        .eq("service_activity_id", activityId)
        .eq("is_active", true)
        .range(from, to)
        .returns<MeasurementOrderActivityFilterRow[]>(),
    );

    if (activityOrdersResult.error) {
      return { ok: false as const, message: "Falha ao filtrar ordens por atividade." };
    }

    activityOrderIdSet = new Set(activityOrdersResult.data.map((item) => item.measurement_order_id));

    if (activityOrderIdSet.size === 0) {
      return { ok: true as const, orders: [], total: 0 };
    }
  }

  const startIndex = ((page ?? 1) - 1) * (pageSize ?? 20);

    let pagedQuery = supabase
      .from("project_measurement_orders")
      .select(MEASUREMENT_ORDER_SELECT, { count: "exact" })
      .eq("tenant_id", tenantId)
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
      return { ok: false as const, message: `Falha ao listar ordens de medicao.${hint}`.trim() };
    }

    const simpleOrders = pagedData ?? [];
    const simpleTotal = pagedCount ?? 0;

    const simpleProjectIds = Array.from(new Set(simpleOrders.map((item) => item.project_id).filter((item): item is string => Boolean(item))));
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
        supabase: supabase,
        tenantId: tenantId,
        ids: simpleUserIds,
      }),
      loadProgrammingMatchMap({
        supabase: supabase,
        tenantId: tenantId,
        windowEndDate: endDate,
        orders: simpleOrders,
      }),
      fetchProjectIsTestMap({
        supabase: supabase,
        tenantId: tenantId,
        projectIds: simpleProjectIds,
      }),
      fetchProjectServiceCenterMap({
        supabase: supabase,
        tenantId: tenantId,
        projectIds: simpleProjectIds,
      }),
      fetchTeamCompositionContextSet({
        supabase: supabase,

        tenantId: tenantId,
        orders: simpleOrders,
      }),
    ]);

    if (simpleTeamCompositionContexts.error) {
      return { ok: false as const, message: "Falha ao carregar composicoes de equipe das ordens de medicao." };
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
        projectServiceCenter: item.project_id ? (simpleProjectServiceCenterMap.get(item.project_id) ?? "Sem base") : "Sem projeto",
        teamName: normalizeText(item.team_name_snapshot),
        foremanName: normalizeText(item.foreman_name_snapshot),
        cancellationReason: normalizeText(item.cancellation_reason),
        canceledAt: item.canceled_at,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        createdByName: resolveAppUserName(simpleUserMap.get(item.created_by ?? "")),
        updatedByName: resolveAppUserName(simpleUserMap.get(item.updated_by ?? "")),
        projectIsTest: item.project_id ? Boolean(simpleProjectIsTestMap.get(item.project_id)) : false,
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
      supabase: supabase,
      tenantId: tenantId,
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
        supabase: supabase,
        tenantId: tenantId,
        teamTypeIds: simpleScoreTeamTypeIds,
      }),
      fetchFinancialTargetMap({
        supabase: supabase,
        tenantId: tenantId,
        orders: simplePagedBaseOrders,
        teamTypeIds: simpleScoreTeamTypeIds,
      }),
    ]);

    const simplePagedOrderIds = simplePagedBaseOrders.map((item) => item.id);
    const simpleAggregateItemsResult = simplePagedOrderIds.length
      ? await fetchPagedSupabaseRows<MeasurementOrderAggregateItem>((from, to) =>
          supabase
            .from("project_measurement_order_items")
            .select("measurement_order_id, total_value, quantity, voice_point")
            .eq("tenant_id", tenantId)
            .eq("is_active", true)
            .in("measurement_order_id", simplePagedOrderIds)
            .range(from, to)
            .returns<MeasurementOrderAggregateItem[]>(),
        )
      : { data: [] as MeasurementOrderAggregateItem[], error: null };

    if (simpleAggregateItemsResult.error) {
      return { ok: false as const, message: "Falha ao consolidar totais das ordens de medicao." };
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

  return { ok: true as const, orders: simplePagedOrders, total: simpleTotal };
}
