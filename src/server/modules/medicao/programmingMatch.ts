// Match entre ordem de Medicao e Programacao, e resolucao do Estado do Trabalho
// na janela consultada.
//
// Separado de queries.ts por ser a parte mais cara e mais autocontida do modulo:
// e ela que a exportacao de detalhamento chamava UMA VEZ POR ORDEM antes do lote.

import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";
import {
  fetchCanceledProgrammingStageIdsForMeasurement,
  fetchProgrammingCompletionRowsForMeasurement,
  fetchProgrammingStagesForMeasurementMatch,
  fetchProgrammingWorkCompletionHistoryForMeasurement,
} from "@/server/modules/programacao-normalizada";
import type { MeasurementOrderRow, ProgrammingMatchRow, ProgrammingWorkCompletionHistoryRow, ProgrammingMatchStatus, ProgrammingWorkCompletionStatus } from "./types";
import { buildProgrammingMatchKey, buildProgrammingProjectDateKey, isCanceledProgrammingStatus, normalizeIsoDate, programmingStatusPriority, resolveMeasurementWorkCompletionStatus } from "./normalizers";

export function buildProjectWorkCompletionTimeline(
  rows: Array<Pick<ProgrammingMatchRow, "project_id" | "execution_date" | "work_completion_status" | "updated_at">>,
) {
  const result = new Map<string, Array<{ executionDate: string; completionStatus: ProgrammingWorkCompletionStatus; updatedAt: string }>>();
  for (const row of rows) {
    const completionStatus = resolveMeasurementWorkCompletionStatus(row.work_completion_status);
    const executionDate = normalizeIsoDate(row.execution_date);
    if (!completionStatus || !executionDate) {
      continue;
    }

    const current = result.get(row.project_id) ?? [];
    current.push({
      executionDate,
      completionStatus,
      updatedAt: String(row.updated_at),
    });
    result.set(row.project_id, current);
  }

  for (const items of result.values()) {
    items.sort((left, right) => {
      const byExecutionDate = String(right.executionDate).localeCompare(String(left.executionDate));
      if (byExecutionDate !== 0) {
        return byExecutionDate;
      }

      return String(right.updatedAt).localeCompare(String(left.updatedAt));
    });
  }

  return result;
}

export function resolveProjectWorkCompletionAtWindowEnd(
  timeline: Map<string, Array<{ executionDate: string; completionStatus: ProgrammingWorkCompletionStatus; updatedAt: string }>>,
  projectId: string | null | undefined,
  windowEndDate: string,
) {
  const normalizedWindowEndDate = normalizeIsoDate(windowEndDate);
  if (!projectId || !normalizedWindowEndDate) {
    return null;
  }

  for (const item of timeline.get(projectId) ?? []) {
    if (item.executionDate <= normalizedWindowEndDate) {
      return item;
    }
  }

  return null;
}

export function resolveProgrammingHistoryProjectDateKey(
  row: ProgrammingWorkCompletionHistoryRow,
  programmingProjectDateMap: Map<string, string>,
) {
  // `programming_history` nunca carrega data propria (ver tipo acima) — a
  // chave projeto+data e sempre a ATUAL da etapa (janela consultada). Se a
  // etapa nao esta na janela, `get` devolve undefined e a linha e descartada
  // pelo chamador — mesmo efeito pratico do fallback que o legado tinha.
  return programmingProjectDateMap.get(row.programming_id) ?? null;
}

export function extractWorkCompletionStatusFromChanges(changes: Record<string, unknown> | null) {
  const change = changes?.workCompletionStatus;
  if (!change || typeof change !== "object") {
    return null;
  }

  return resolveMeasurementWorkCompletionStatus((change as { to?: unknown }).to);
}

export function selectBestProgrammingMatch(candidates: ProgrammingMatchRow[]) {
  if (!candidates.length) {
    return null;
  }

  return [...candidates].sort((left, right) => {
    const byStatus = programmingStatusPriority(left.status) - programmingStatusPriority(right.status);
    if (byStatus !== 0) {
      return byStatus;
    }
    return String(right.updated_at).localeCompare(String(left.updated_at));
  })[0];
}

export async function loadProgrammingMatchMap(params: {
  supabase: AuthenticatedAppUserContext["supabase"];
  tenantId: string;
  windowEndDate: string;
  orders: Array<Pick<MeasurementOrderRow, "id" | "project_id" | "team_id" | "execution_date" | "created_at" | "programming_completion_status_snapshot">>;
}) {
  if (!params.orders.length) {
    return new Map<string, {
      status: ProgrammingMatchStatus;
      programmingId: string | null;
      completionStatus: ProgrammingWorkCompletionStatus;
      completionStatusChangedAfterMeasurement: boolean;
    }>();
  }

  const projectIds = Array.from(new Set(params.orders.map((item) => item.project_id).filter((item): item is string => Boolean(item))));
  const executionDates = params.orders.map((item) => item.execution_date).sort();
  const startDate = executionDates[0];
  const endDate = executionDates[executionDates.length - 1];

  const [programmingStages, canceledProgrammingRows, projectCompletionRows, projectCompletionHistoryRows] = await Promise.all([
    fetchProgrammingStagesForMeasurementMatch({
      supabase: params.supabase,
      tenantId: params.tenantId,
      projectIds,
      startDate,
      endDate,
    }),
    fetchCanceledProgrammingStageIdsForMeasurement({
      supabase: params.supabase,
      tenantId: params.tenantId,
      projectIds,
    }),
    fetchProgrammingCompletionRowsForMeasurement({
      supabase: params.supabase,
      tenantId: params.tenantId,
      projectIds,
      windowEndDate: params.windowEndDate,
    }),
    fetchProgrammingWorkCompletionHistoryForMeasurement({
      supabase: params.supabase,
      tenantId: params.tenantId,
      projectIds,
    }),
  ]);

  // Modelo normalizado: 1 linha de `programming` = 1 etapa, com N equipes em
  // `programming_team` (filha) — diferente do legado (1 linha por equipe).
  // "Match exato" (achar por projeto+equipe+data) precisa de 1 linha sintetica
  // por equipe ATIVA da etapa, reaproveitando o MESMO formato `ProgrammingMatchRow`
  // e a mesma logica de agrupamento/prioridade que ja existia (nao muda).
  const data: ProgrammingMatchRow[] = [];
  for (const stage of programmingStages) {
    const activeTeamIds = (stage.programming_team ?? [])
      .filter((team) => team.status === "ATIVA")
      .map((team) => team.team_id);

    if (!activeTeamIds.length) {
      // Etapa sem equipe ativa: ainda entra no "match por projeto+data" (usa
      // team_id vazio, que nunca bate numa chave exata de pedido — so serve
      // pro groupedByProjectDate abaixo).
      data.push({
        id: stage.id,
        project_id: stage.project_id,
        team_id: "",
        execution_date: stage.execution_date,
        status: stage.status,
        work_completion_status: stage.work_completion_status,
        updated_at: stage.updated_at,
      });
      continue;
    }

    for (const teamId of activeTeamIds) {
      data.push({
        id: stage.id,
        project_id: stage.project_id,
        team_id: teamId,
        execution_date: stage.execution_date,
        status: stage.status,
        work_completion_status: stage.work_completion_status,
        updated_at: stage.updated_at,
      });
    }
  }

  const programmingProjectDateMap = new Map<string, string>();
  const programmingStatusMap = new Map<string, string>();
  for (const row of data ?? []) {
    programmingProjectDateMap.set(row.id, buildProgrammingProjectDateKey(row.project_id, row.execution_date));
    programmingStatusMap.set(row.id, row.status);
  }

  const canceledProgrammingIds = new Set(canceledProgrammingRows.map((item) => item.id));
  const projectWorkCompletionTimeline = buildProjectWorkCompletionTimeline(projectCompletionRows);

  const projectDateWorkCompletionStatusMap = new Map<string, { completionStatus: ProgrammingWorkCompletionStatus; updatedAt: string }>();
  for (const row of data ?? []) {
    if (isCanceledProgrammingStatus(row.status)) {
      continue;
    }

    const projectDateKey = buildProgrammingProjectDateKey(row.project_id, row.execution_date);
    const completionStatus = resolveMeasurementWorkCompletionStatus(row.work_completion_status);
    if (!completionStatus) {
      continue;
    }

    const current = projectDateWorkCompletionStatusMap.get(projectDateKey);
    if (!current || String(row.updated_at) > String(current.updatedAt)) {
      projectDateWorkCompletionStatusMap.set(projectDateKey, {
        completionStatus,
        updatedAt: String(row.updated_at),
      });
    }
  }

  const projectDateWorkCompletionHistoryMap = new Map<string, { completionStatus: ProgrammingWorkCompletionStatus; updatedAt: string }>();
  for (const row of projectCompletionHistoryRows) {
    if (canceledProgrammingIds.has(row.programming_id) || isCanceledProgrammingStatus(programmingStatusMap.get(row.programming_id))) {
      continue;
    }

    const projectDateKey = resolveProgrammingHistoryProjectDateKey(row, programmingProjectDateMap);
    if (!projectDateKey || projectDateWorkCompletionHistoryMap.has(projectDateKey)) {
      continue;
    }

    projectDateWorkCompletionHistoryMap.set(projectDateKey, {
      completionStatus: extractWorkCompletionStatusFromChanges(row.changes),
      updatedAt: String(row.created_at),
    });
  }

  const grouped = new Map<string, ProgrammingMatchRow[]>();
  const groupedByProjectDate = new Map<string, ProgrammingMatchRow[]>();
  for (const row of data ?? []) {
    const key = buildProgrammingMatchKey(row.project_id, row.team_id, row.execution_date);
    const current = grouped.get(key) ?? [];
    current.push(row);
    grouped.set(key, current);

    const projectDateKey = buildProgrammingProjectDateKey(row.project_id, row.execution_date);
    const projectDateCurrent = groupedByProjectDate.get(projectDateKey) ?? [];
    projectDateCurrent.push(row);
    groupedByProjectDate.set(projectDateKey, projectDateCurrent);
  }

  const result = new Map<string, {
    status: ProgrammingMatchStatus;
    programmingId: string | null;
    completionStatus: ProgrammingWorkCompletionStatus;
    completionStatusChangedAfterMeasurement: boolean;
  }>();

  for (const order of params.orders) {
    const teamKey = buildProgrammingMatchKey(order.project_id, order.team_id, order.execution_date);
    const exactMatch = selectBestProgrammingMatch(grouped.get(teamKey) ?? []);
    const projectDateKey = buildProgrammingProjectDateKey(order.project_id, order.execution_date);
    const projectDateMatch = selectBestProgrammingMatch(groupedByProjectDate.get(projectDateKey) ?? []);
    const completionMatch = exactMatch ?? projectDateMatch;

    const projectDateWorkCompletionStatus = projectDateWorkCompletionHistoryMap.get(projectDateKey)
      ?? projectDateWorkCompletionStatusMap.get(projectDateKey)
      ?? null;
    const projectWorkCompletionStatus = resolveProjectWorkCompletionAtWindowEnd(
      projectWorkCompletionTimeline,
      order.project_id,
      params.windowEndDate,
    );
    const currentCompletion = isCanceledProgrammingStatus(completionMatch?.status)
      ? null
      : resolveMeasurementWorkCompletionStatus(completionMatch?.work_completion_status);
    const snapshotCompletion = resolveMeasurementWorkCompletionStatus(order.programming_completion_status_snapshot);
    const programmingCompletion = projectWorkCompletionStatus?.completionStatus
      ?? currentCompletion
      ?? (projectDateWorkCompletionStatus ? projectDateWorkCompletionStatus.completionStatus : null);
    const programmingCompletionUpdatedAt = projectWorkCompletionStatus?.updatedAt
      ?? (currentCompletion
        ? (completionMatch?.updated_at ?? null)
        : (projectDateWorkCompletionStatus?.updatedAt ?? null));
    const effectiveCompletion = programmingCompletion
      ?? snapshotCompletion
      ?? null;
    const changedBySnapshot = Boolean(
      snapshotCompletion
      && programmingCompletion
      && snapshotCompletion !== programmingCompletion,
    );

    const changedAfterMeasurementWithoutSnapshot = Boolean(
      !snapshotCompletion
      && effectiveCompletion
      && programmingCompletionUpdatedAt
      && new Date(programmingCompletionUpdatedAt).getTime() > new Date(order.created_at).getTime(),
    );

    result.set(order.id, {
      status: exactMatch ? "PROGRAMADA" : "NAO_PROGRAMADA",
      programmingId: exactMatch?.id ?? null,
      completionStatus: effectiveCompletion,
      completionStatusChangedAfterMeasurement: changedBySnapshot || changedAfterMeasurementWithoutSnapshot,
    });
  }

  return result;
}

