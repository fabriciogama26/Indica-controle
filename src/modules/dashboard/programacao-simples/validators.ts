import { DOCUMENT_KEYS, VALIDATION_FIELD_LABELS } from "./constants";
import type {
  DocumentEntry,
  DocumentKey,
  FilterState,
  ProgrammingReasonOptionItem,
  ProgrammingStatus,
  ProjectItem,
  SaveProgrammingResponse,
  ScheduleItem,
  SgdTypeItem,
  StageValidationTeamSummary,
  TeamItem,
  WorkCompletionCatalogItem,
  WorkCompletionStatus,
} from "./types";
import {
  formatDate,
  formatDateTime,
  isDateInRange,
  isInactiveProgrammingStatus,
  normalizeWorkCompletionCode,
  resolveReasonOption,
} from "./utils";

export function isReasonSelectionValid(
  reasonOptions: ProgrammingReasonOptionItem[],
  selectedReasonCode: string,
  reasonNotes: string,
) {
  const selectedOption = resolveReasonOption(reasonOptions, selectedReasonCode);
  if (!selectedOption) {
    return false;
  }

  if (selectedOption.requiresNotes && !reasonNotes.trim()) {
    return false;
  }

  return true;
}

export function buildReasonText(
  reasonOptions: ProgrammingReasonOptionItem[],
  selectedReasonCode: string,
  reasonNotes: string,
) {
  const selectedOption = resolveReasonOption(reasonOptions, selectedReasonCode);
  if (!selectedOption) {
    return "";
  }

  const notes = reasonNotes.trim();
  if (selectedOption.requiresNotes && !notes) {
    return "";
  }

  return notes ? `${selectedOption.label}: ${notes}` : selectedOption.label;
}

export function isInvalidTimeRange(startTime: string, endTime: string) {
  if (!startTime || !endTime) {
    return false;
  }

  return endTime <= startTime;
}

export function getDocumentRequestedAfterApprovedLabel(documents: Record<DocumentKey, DocumentEntry>) {
  const invalidDocument = DOCUMENT_KEYS.find(({ key }) => {
    const approvedAt = documents[key].approvedAt;
    const requestedAt = documents[key].requestedAt;
    return Boolean(approvedAt && requestedAt && requestedAt > approvedAt);
  });

  return invalidDocument?.label ?? null;
}

export function isNegativeNumericText(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  return /^-\d+([.,]\d+)?$/.test(normalized);
}

export function buildSavedOutsideFiltersMessage(params: {
  date: string;
  status: ProgrammingStatus;
  projectId: string;
  teamIds: string[];
  workCompletionStatus: WorkCompletionStatus | null;
  sgdTypeId: string | null;
  activeFilters: FilterState;
  projectMap: Map<string, ProjectItem>;
  teamMap: Map<string, TeamItem>;
  workCompletionCatalog: WorkCompletionCatalogItem[];
  sgdTypes: SgdTypeItem[];
}) {
  const reasons: string[] = [];

  if (
    !isInactiveProgrammingStatus(params.status)
    && !isDateInRange(params.date, params.activeFilters.startDate, params.activeFilters.endDate)
  ) {
    reasons.push(
      `a Data execucao ${formatDate(params.date)} esta fora do filtro atual (${formatDate(params.activeFilters.startDate)} a ${formatDate(params.activeFilters.endDate)})`,
    );
  }

  if (params.activeFilters.projectId && params.projectId !== params.activeFilters.projectId) {
    const filteredProject = params.projectMap.get(params.activeFilters.projectId)?.code ?? "selecionado";
    reasons.push(`o Projeto filtrado e ${filteredProject}`);
  }

  if (params.activeFilters.municipality) {
    const savedProjectCity = params.projectMap.get(params.projectId)?.city ?? "";
    if (savedProjectCity !== params.activeFilters.municipality) {
      reasons.push(`o Municipio filtrado e ${params.activeFilters.municipality}`);
    }
  }

  if (params.activeFilters.teamId && !params.teamIds.includes(params.activeFilters.teamId)) {
    const filteredTeam = params.teamMap.get(params.activeFilters.teamId)?.name ?? "selecionada";
    reasons.push(`a Equipe filtrada e ${filteredTeam}`);
  }

  if (params.activeFilters.status !== "TODOS" && params.status !== params.activeFilters.status) {
    reasons.push(`o Status filtrado e ${params.activeFilters.status}`);
  }

  if (params.activeFilters.workCompletionStatus !== "TODOS") {
    const savedWorkCompletionStatus = normalizeWorkCompletionCode(params.workCompletionStatus);
    const selectedWorkCompletionStatus = normalizeWorkCompletionCode(params.activeFilters.workCompletionStatus);
    if (selectedWorkCompletionStatus !== savedWorkCompletionStatus) {
      const selectedCatalogItem = params.activeFilters.workCompletionStatus === "NAO_INFORMADO"
        ? null
        : params.workCompletionCatalog.find((item) => item.code === params.activeFilters.workCompletionStatus) ?? null;
      const formattedWorkCompletionStatus = params.activeFilters.workCompletionStatus === "NAO_INFORMADO"
        ? "Nao informado"
        : selectedCatalogItem?.label ?? params.activeFilters.workCompletionStatus;
      reasons.push(`o Estado Trabalho filtrado e ${formattedWorkCompletionStatus}`);
    }
  }

  if (params.activeFilters.sgdTypeId && params.sgdTypeId !== params.activeFilters.sgdTypeId) {
    const filteredSgdType = params.sgdTypes.find((item) => item.id === params.activeFilters.sgdTypeId);
    reasons.push(`o Tipo SGD filtrado e ${filteredSgdType?.description ?? "selecionado"}`);
  }

  if (!reasons.length) {
    return null;
  }

  return `A programacao foi salva, mas pode nao aparecer na lista atual porque ${reasons.join(" e ")}.`;
}

export function buildConflictFeedbackMessage(payload: SaveProgrammingResponse | null, fallback: string) {
  if (payload?.error !== "conflict") {
    return payload?.message ?? fallback;
  }

  const updatedBy = payload.updatedBy?.trim();
  const updatedAt = payload.currentUpdatedAt ? formatDateTime(payload.currentUpdatedAt) : "";
  const changedFields = Array.isArray(payload.changedFields) && payload.changedFields.length
    ? ` Campos em conflito: ${payload.changedFields.join(", ")}.`
    : "";

  return `${payload.message ?? fallback}${updatedBy || updatedAt ? ` Alterada por ${updatedBy ?? "outro usuario"}${updatedAt ? ` em ${updatedAt}` : ""}.` : ""}${changedFields}`;
}

export function buildFieldValidationDetails(fields: string[]) {
  const labels = Array.from(
    new Set(
      fields
        .map((field) => VALIDATION_FIELD_LABELS[field] ?? null)
        .filter((value): value is string => Boolean(value)),
    ),
  );

  return labels.length ? labels.map((label) => `Revise o campo ${label}.`) : [];
}

export function buildConflictAlertDetails(payload: SaveProgrammingResponse | null) {
  if (!payload) {
    return [];
  }

  const details: string[] = [];
  if (payload.reason) {
    details.push(`Codigo do erro: ${payload.reason}.`);
  }

  if (payload.detail) {
    details.push(payload.detail);
  }

  if (payload.updatedBy || payload.currentUpdatedAt) {
    details.push(
      `Ultima alteracao: ${payload.updatedBy?.trim() || "outro usuario"}${payload.currentUpdatedAt ? ` em ${formatDateTime(payload.currentUpdatedAt)}` : ""}.`,
    );
  }

  if (Array.isArray(payload.changedFields) && payload.changedFields.length) {
    details.push(`Campos em conflito: ${payload.changedFields.join(", ")}.`);
  }

  if (payload.currentRecord) {
    details.push(
      `Versao atual: ${formatDate(payload.currentRecord.executionDate)} | ${payload.currentRecord.startTime} - ${payload.currentRecord.endTime}.`,
    );
  }

  return details;
}

export function buildLocalStageConflictSummary(params: {
  schedules: ScheduleItem[];
  teams: TeamItem[];
  projectId: string;
  teamIds: string[];
  enteredEtapaNumber: number;
  excludeProgrammingId?: string | null;
  currentEditingStage?: number | null;
  currentEditingDate?: string | null;
  currentEditingTeamId?: string | null;
}) {
  const teamNameMap = new Map(params.teams.map((item) => [item.id, item.name]));
  const relevantSchedules = params.schedules.filter((item) => {
    if (item.projectId !== params.projectId) {
      return false;
    }

    if (!params.teamIds.includes(item.teamId)) {
      return false;
    }

    if (params.excludeProgrammingId && item.id === params.excludeProgrammingId) {
      return false;
    }

    if (item.etapaNumber === null || item.etapaNumber < params.enteredEtapaNumber) {
      return false;
    }

    return true;
  });

  if (!relevantSchedules.length) {
    return null;
  }

  const summaries = Array.from(new Set(relevantSchedules.map((item) => item.teamId)))
    .map((teamId) => {
      const items = relevantSchedules.filter((item) => item.teamId === teamId);
      const existingStages = Array.from(
        new Set(
          items
            .map((item) => Number(item.etapaNumber ?? 0))
            .filter((stage) => Number.isFinite(stage) && stage >= params.enteredEtapaNumber),
        ),
      ).sort((left, right) => left - right);
      const existingDates = Array.from(new Set(items.map((item) => item.date))).sort();
      const highestStage = existingStages.length ? Math.max(...existingStages) : 0;

      return {
        teamId,
        teamName: teamNameMap.get(teamId) ?? teamId,
        highestStage,
        existingStages,
        existingDates,
      } satisfies StageValidationTeamSummary;
    })
    .filter((item) => item.existingStages.length > 0)
    .sort((left, right) => left.teamName.localeCompare(right.teamName));

  if (
    params.currentEditingTeamId
    && params.currentEditingStage
    && params.currentEditingStage > params.enteredEtapaNumber
  ) {
    const existingSummary = summaries.find((item) => item.teamId === params.currentEditingTeamId);
    if (existingSummary) {
      if (!existingSummary.existingStages.includes(params.currentEditingStage)) {
        existingSummary.existingStages = [...existingSummary.existingStages, params.currentEditingStage].sort((left, right) => left - right);
      }
      if (params.currentEditingDate && !existingSummary.existingDates.includes(params.currentEditingDate)) {
        existingSummary.existingDates = [...existingSummary.existingDates, params.currentEditingDate].sort();
      }
      existingSummary.highestStage = Math.max(existingSummary.highestStage, params.currentEditingStage);
    } else {
      summaries.push({
        teamId: params.currentEditingTeamId,
        teamName: teamNameMap.get(params.currentEditingTeamId) ?? params.currentEditingTeamId,
        highestStage: params.currentEditingStage,
        existingStages: [params.currentEditingStage],
        existingDates: params.currentEditingDate ? [params.currentEditingDate] : [],
      });
      summaries.sort((left, right) => left.teamName.localeCompare(right.teamName));
    }
  }

  if (!summaries.length) {
    return null;
  }

  return {
    enteredEtapaNumber: params.enteredEtapaNumber,
    highestStage: summaries.reduce((current, item) => Math.max(current, item.highestStage), 0),
    teams: summaries,
  };
}

