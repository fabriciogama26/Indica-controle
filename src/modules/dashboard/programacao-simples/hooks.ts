import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import {
  cancelProgramming,
  copyProgrammingToDates,
  fetchActivityCatalog,
  fetchNextEtapaNumber,
  fetchProgrammingHistory,
  fetchProgrammingSnapshot,
  postponeProgramming,
} from "./api";
import {
  buildConflictAlertDetails,
  buildConflictFeedbackMessage,
  buildReasonText,
  isReasonSelectionValid,
} from "./validators";
import {
  formatDate,
  getDisplayProgrammingStatus,
  isActiveProgrammingStatus,
  normalizeHistoryItemsForDisplay,
} from "./utils";
import { HISTORY_PAGE_SIZE } from "./constants";
import type {
  ActivityCatalogItem,
  AlertModalState,
  ElectricalEqCatalogItem,
  FilterState,
  FormState,
  ProgrammingHistoryItem,
  ProgrammingReasonOptionItem,
  ProgrammingResponse,
  ProjectItem,
  SaveProgrammingResponse,
  ScheduleItem,
  SgdTypeItem,
  StageValidationTeamSummary,
  SupportOptionItem,
  TeamItem,
  WorkCompletionCatalogItem,
} from "./types";

type FeedbackState = { type: "success" | "error"; message: string } | null;
type ErrorLogHandler = (message: string, error?: unknown, context?: Record<string, unknown>) => void | Promise<void>;

export function useProgrammingBoardData(params: {
  accessToken: string | null;
  activeFilters: FilterState;
  weekStartDate: string;
  weekEndDate: string;
  setProjects: Dispatch<SetStateAction<ProjectItem[]>>;
  setTeams: Dispatch<SetStateAction<TeamItem[]>>;
  setSupportOptions: Dispatch<SetStateAction<SupportOptionItem[]>>;
  setSgdTypes: Dispatch<SetStateAction<SgdTypeItem[]>>;
  setElectricalEqCatalog: Dispatch<SetStateAction<ElectricalEqCatalogItem[]>>;
  setWorkCompletionCatalog: Dispatch<SetStateAction<WorkCompletionCatalogItem[]>>;
  setReasonOptions: Dispatch<SetStateAction<ProgrammingReasonOptionItem[]>>;
  setSchedules: Dispatch<SetStateAction<ScheduleItem[]>>;
  setFeedback: Dispatch<SetStateAction<FeedbackState>>;
  onError?: ErrorLogHandler;
}) {
  const {
    accessToken,
    activeFilters,
    weekStartDate,
    weekEndDate,
    setProjects,
    setTeams,
    setSupportOptions,
    setSgdTypes,
    setElectricalEqCatalog,
    setWorkCompletionCatalog,
    setReasonOptions,
    setSchedules,
    setFeedback,
    onError,
  } = params;
  const [isLoadingList, setIsLoadingList] = useState(false);

  const applyBoardSnapshot = useCallback((data: ProgrammingResponse) => {
    const nextProjects = data.projects ?? [];
    const nextTeams = data.teams ?? [];
    const nextSchedules = (data.schedules ?? []).sort((left, right) => {
      if (left.date === right.date) {
        return left.startTime.localeCompare(right.startTime);
      }

      return left.date.localeCompare(right.date);
    });

    setProjects(nextProjects);
    setTeams(nextTeams);
    setSupportOptions(data.supportOptions ?? []);
    setSgdTypes(data.sgdTypes ?? []);
    setElectricalEqCatalog(data.electricalEqCatalog ?? []);
    setWorkCompletionCatalog(data.workCompletionCatalog ?? []);
    setReasonOptions(data.reasonOptions ?? []);
    setSchedules(nextSchedules);
    if (data.activitiesLoadError) {
      setFeedback({
        type: "error",
        message: "Atividades da Programacao nao foram carregadas. Recarregue a tela antes de editar para evitar perda de dados.",
      });
      void onError?.("Atividades da Programacao nao foram carregadas no snapshot principal.", undefined, {
        operation: "load_board_snapshot",
        activitiesLoadError: true,
      });
    }
  }, [
    setElectricalEqCatalog,
    setFeedback,
    setProjects,
    setReasonOptions,
    setSchedules,
    setSgdTypes,
    setSupportOptions,
    setTeams,
    setWorkCompletionCatalog,
    onError,
  ]);

  const fetchBoardSnapshot = useCallback(async () => {
    if (!accessToken) {
      return null;
    }

    const requestStartDate = activeFilters.startDate < weekStartDate ? activeFilters.startDate : weekStartDate;
    const requestEndDate = activeFilters.endDate > weekEndDate ? activeFilters.endDate : weekEndDate;

    setIsLoadingList(true);
    try {
      return fetchProgrammingSnapshot({
        accessToken,
        startDate: requestStartDate,
        endDate: requestEndDate,
      });
    } finally {
      setIsLoadingList(false);
    }
  }, [accessToken, activeFilters.endDate, activeFilters.startDate, weekEndDate, weekStartDate]);

  const loadBoardData = useCallback(async () => {
    try {
      const data = await fetchBoardSnapshot();
      if (!data) {
        return;
      }

      applyBoardSnapshot(data);
    } catch (error) {
      setProjects([]);
      setTeams([]);
      setSchedules([]);
      setSupportOptions([]);
      setSgdTypes([]);
      setElectricalEqCatalog([]);
      setWorkCompletionCatalog([]);
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Falha ao carregar programacao.",
      });
      void onError?.("Falha ao carregar programacao.", error, {
        operation: "load_board_data",
        startDate: activeFilters.startDate,
        endDate: activeFilters.endDate,
        weekStartDate,
        weekEndDate,
      });
    }
  }, [
    applyBoardSnapshot,
    fetchBoardSnapshot,
    setElectricalEqCatalog,
    setFeedback,
    setProjects,
    setSchedules,
    setSgdTypes,
    setSupportOptions,
    setTeams,
    setWorkCompletionCatalog,
    onError,
    activeFilters.endDate,
    activeFilters.startDate,
    weekEndDate,
    weekStartDate,
  ]);

  useEffect(() => {
    void loadBoardData();
  }, [loadBoardData]);

  return {
    applyBoardSnapshot,
    fetchBoardSnapshot,
    isLoadingList,
    loadBoardData,
  };
}

export function useProgrammingActivityCatalog(params: {
  accessToken: string | null;
  search: string;
  onError?: ErrorLogHandler;
}) {
  const { accessToken, onError, search } = params;
  const deferredSearch = useDeferredValue(search);
  const [activityOptions, setActivityOptions] = useState<ActivityCatalogItem[]>([]);
  const [isLoadingActivities, setIsLoadingActivities] = useState(false);

  useEffect(() => {
    if (!accessToken || deferredSearch.trim().length < 2) {
      setActivityOptions([]);
      setIsLoadingActivities(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsLoadingActivities(true);
      try {
        const data = await fetchActivityCatalog({
          accessToken,
          query: deferredSearch.trim(),
          signal: controller.signal,
        });
        setActivityOptions(data?.items ?? []);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setActivityOptions([]);
          void onError?.("Falha ao carregar catalogo de atividades da Programacao.", error, {
            operation: "load_activity_catalog",
            queryLength: deferredSearch.trim().length,
          });
        }
      } finally {
        setIsLoadingActivities(false);
      }
    }, 220);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [accessToken, onError, deferredSearch]);

  return {
    activityOptions,
    isLoadingActivities,
  };
}

export function useProgrammingEtapaSuggestion(params: {
  accessToken: string | null;
  form: FormState;
  isEditing: boolean;
  isEtapaManuallyEdited: boolean;
  isVisualizationMode: boolean;
  setForm: Dispatch<SetStateAction<FormState>>;
  setInvalidFields: Dispatch<SetStateAction<string[]>>;
  setIsEtapaManuallyEdited: Dispatch<SetStateAction<boolean>>;
  onError?: ErrorLogHandler;
}) {
  const {
    accessToken,
    form,
    isEditing,
    isEtapaManuallyEdited,
    isVisualizationMode,
    setForm,
    setInvalidFields,
    setIsEtapaManuallyEdited,
    onError,
  } = params;

  useEffect(() => {
    if (isEditing) {
      return;
    }

    setIsEtapaManuallyEdited(false);
  }, [form.projectId, form.date, form.teamIds, isEditing, setIsEtapaManuallyEdited]);

  useEffect(() => {
    if (isVisualizationMode || isEditing || !accessToken) {
      return;
    }

    if (!form.projectId || !form.date || !form.teamIds.length || form.etapaUnica || form.etapaFinal) {
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const nextEtapaNumber = await fetchNextEtapaNumber({
          accessToken,
          projectId: form.projectId,
          date: form.date,
          teamIds: form.teamIds,
          signal: controller.signal,
        });
        if (!nextEtapaNumber) {
          return;
        }

        setForm((current) => {
          if (current.projectId !== form.projectId || current.date !== form.date) {
            return current;
          }

          const sameTeamSelection =
            current.teamIds.length === form.teamIds.length
            && current.teamIds.every((teamId) => form.teamIds.includes(teamId));

          if (!sameTeamSelection) {
            return current;
          }

          if (isEtapaManuallyEdited && current.etapaNumber.trim()) {
            return current;
          }

          return { ...current, etapaNumber: String(nextEtapaNumber) };
        });
        setInvalidFields((current) => current.filter((item) => item !== "etapaNumber"));
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          void onError?.("Falha ao sugerir proxima ETAPA da Programacao.", error, {
            operation: "suggest_next_etapa",
            projectId: form.projectId,
            date: form.date,
            teamCount: form.teamIds.length,
          });
          return;
        }
      }
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [
    accessToken,
    form.date,
    form.etapaFinal,
    form.etapaUnica,
    form.projectId,
    form.teamIds,
    isEditing,
    isEtapaManuallyEdited,
    isVisualizationMode,
    onError,
    setForm,
    setInvalidFields,
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// useHistoryModal
// ─────────────────────────────────────────────────────────────────────────────

export function useHistoryModal(params: {
  accessToken: string | null;
  setFeedback: Dispatch<SetStateAction<FeedbackState>>;
  onError: ErrorLogHandler;
}) {
  const { accessToken, setFeedback, onError } = params;
  const [historyTarget, setHistoryTarget] = useState<ScheduleItem | null>(null);
  const [historyItems, setHistoryItems] = useState<ProgrammingHistoryItem[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const totalHistoryPages = Math.max(1, Math.ceil(historyItems.length / HISTORY_PAGE_SIZE));
  const pagedHistoryItems = useMemo(() => {
    const start = (historyPage - 1) * HISTORY_PAGE_SIZE;
    return historyItems.slice(start, start + HISTORY_PAGE_SIZE);
  }, [historyItems, historyPage]);

  async function openHistory(schedule: ScheduleItem) {
    if (!accessToken) {
      setFeedback({ type: "error", message: "Sessao invalida para consultar historico." });
      return;
    }

    setHistoryTarget(schedule);
    setHistoryItems([]);
    setHistoryPage(1);
    setIsLoadingHistory(true);

    try {
      const data = await fetchProgrammingHistory({ accessToken, programmingId: schedule.id });
      setHistoryItems(normalizeHistoryItemsForDisplay(data.history ?? []));
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Falha ao carregar historico da programacao.",
      });
      await onError("Falha ao carregar historico da programacao.", error, {
        operation: "load_history",
        programmingId: schedule.id,
        projectId: schedule.projectId,
        teamId: schedule.teamId,
        status: schedule.status,
      });
    } finally {
      setIsLoadingHistory(false);
    }
  }

  return {
    historyTarget,
    historyItems,
    setHistoryTarget,
    pagedHistoryItems,
    historyPage,
    setHistoryPage,
    totalHistoryPages,
    isLoadingHistory,
    openHistory,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared callback types for modal hooks
// ─────────────────────────────────────────────────────────────────────────────

type OpenAlertModalFn = (
  title: string,
  message: string,
  details?: string[],
  extra?: Partial<AlertModalState>,
) => void;

type OpenProjectCompletedAlertModalFn = (params: {
  title: string;
  payload: SaveProgrammingResponse;
}) => void;

// ─────────────────────────────────────────────────────────────────────────────
// useCancelModal
// ─────────────────────────────────────────────────────────────────────────────

export function useCancelModal(params: {
  accessToken: string | null;
  reasonOptions: ProgrammingReasonOptionItem[];
  editingScheduleId: string | null;
  onCancelEditMode: () => void;
  openAlertModal: OpenAlertModalFn;
  openProjectCompletedAlertModal: OpenProjectCompletedAlertModalFn;
  fetchBoardSnapshot: () => Promise<ProgrammingResponse | null>;
  applyBoardSnapshot: (data: ProgrammingResponse) => void;
  setFeedback: Dispatch<SetStateAction<FeedbackState>>;
  onError: ErrorLogHandler;
}) {
  const {
    accessToken,
    reasonOptions,
    editingScheduleId,
    onCancelEditMode,
    openAlertModal,
    openProjectCompletedAlertModal,
    fetchBoardSnapshot,
    applyBoardSnapshot,
    setFeedback,
    onError,
  } = params;

  const [cancelTarget, setCancelTarget] = useState<ScheduleItem | null>(null);
  const [cancelReasonCode, setCancelReasonCode] = useState("");
  const [cancelReasonNotes, setCancelReasonNotes] = useState("");
  const [cancelScope, setCancelScope] = useState<"individual" | "group">("individual");
  const [isCancelling, setIsCancelling] = useState(false);

  const canSubmitCancellation = isReasonSelectionValid(reasonOptions, cancelReasonCode, cancelReasonNotes) && !isCancelling;

  function openCancelModal(schedule: ScheduleItem) {
    if (!isActiveProgrammingStatus(getDisplayProgrammingStatus(schedule))) {
      setFeedback({ type: "error", message: "Somente programacoes ativas podem ser canceladas." });
      return;
    }

    if (!reasonOptions.length) {
      setFeedback({
        type: "error",
        message: "Catalogo de motivos indisponivel. Aplique a migration 135 para usar cancelamento por select.",
      });
      return;
    }

    setCancelTarget(schedule);
    setCancelReasonCode("");
    setCancelReasonNotes("");
    setCancelScope("individual");
    setFeedback(null);
  }

  function closeCancelModal() {
    setCancelTarget(null);
    setCancelReasonCode("");
    setCancelReasonNotes("");
    setCancelScope("individual");
  }

  async function confirmCancellation() {
    if (!accessToken || !cancelTarget) return;

    const selectedReasonText = buildReasonText(reasonOptions, cancelReasonCode, cancelReasonNotes);
    if (!selectedReasonText) return;

    setIsCancelling(true);

    try {
      const { ok, data } = await cancelProgramming({
        accessToken,
        id: cancelTarget.id,
        reason: selectedReasonText,
        scope: cancelScope,
        expectedUpdatedAt: cancelTarget.updatedAt,
      });

      if (!ok) {
        const message = buildConflictFeedbackMessage(data, "Falha ao cancelar programacao.");
        setFeedback({ type: "error", message });
        if (data.reason === "PROJECT_COMPLETED_REQUIRES_REOPEN") {
          openProjectCompletedAlertModal({ title: "Projeto concluido exige reabertura", payload: data });
        } else {
          openAlertModal(
            data.error === "conflict" ? "Conflito ao validar cancelamento" : "Falha ao validar cancelamento",
            message,
            buildConflictAlertDetails(data),
          );
        }
        await onError("Falha ao cancelar programacao.", undefined, {
          operation: "cancel_programming",
          programmingId: cancelTarget.id,
          projectId: cancelTarget.projectId,
          teamId: cancelTarget.teamId,
          status: cancelTarget.status,
          scope: cancelScope,
          expectedUpdatedAt: cancelTarget.updatedAt,
          responseMessage: message,
          responseError: data.error ?? null,
        });
        return;
      }

      if (editingScheduleId === cancelTarget.id) {
        onCancelEditMode();
      }

      closeCancelModal();
      setFeedback({ type: "success", message: data.message ?? "Programacao cancelada com sucesso." });

      try {
        const boardData = await fetchBoardSnapshot();
        if (boardData) applyBoardSnapshot(boardData);
      } catch (refreshError) {
        await onError("Programacao cancelada, mas houve falha ao atualizar a visualizacao.", refreshError, {
          operation: "refresh_after_cancel",
          programmingId: cancelTarget.id,
          projectId: cancelTarget.projectId,
          teamId: cancelTarget.teamId,
          scope: cancelScope,
        });
        if (!data.warning) {
          setFeedback({
            type: "success",
            message: `${data.message ?? "Programacao cancelada com sucesso."} Programacao salva com sucesso, mas houve falha ao atualizar a visualizacao.`,
          });
        }
      }
    } catch (error) {
      setFeedback({ type: "error", message: "Falha ao cancelar programacao." });
      await onError("Falha ao cancelar programacao.", error, {
        operation: "cancel_programming",
        programmingId: cancelTarget.id,
        projectId: cancelTarget.projectId,
        teamId: cancelTarget.teamId,
        status: cancelTarget.status,
        scope: cancelScope,
        expectedUpdatedAt: cancelTarget.updatedAt,
      });
    } finally {
      setIsCancelling(false);
    }
  }

  return {
    cancelTarget,
    cancelReasonCode,
    setCancelReasonCode,
    cancelReasonNotes,
    setCancelReasonNotes,
    cancelScope,
    setCancelScope,
    isCancelling,
    canSubmitCancellation,
    openCancelModal,
    closeCancelModal,
    confirmCancellation,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// usePostponeModal
// ─────────────────────────────────────────────────────────────────────────────

export function usePostponeModal(params: {
  accessToken: string | null;
  reasonOptions: ProgrammingReasonOptionItem[];
  editingScheduleId: string | null;
  onCancelEditMode: () => void;
  openAlertModal: OpenAlertModalFn;
  openProjectCompletedAlertModal: OpenProjectCompletedAlertModalFn;
  fetchBoardSnapshot: () => Promise<ProgrammingResponse | null>;
  applyBoardSnapshot: (data: ProgrammingResponse) => void;
  setFeedback: Dispatch<SetStateAction<FeedbackState>>;
  onError: ErrorLogHandler;
}) {
  const {
    accessToken,
    reasonOptions,
    editingScheduleId,
    onCancelEditMode,
    openAlertModal,
    openProjectCompletedAlertModal,
    fetchBoardSnapshot,
    applyBoardSnapshot,
    setFeedback,
    onError,
  } = params;

  const [postponeTarget, setPostponeTarget] = useState<ScheduleItem | null>(null);
  const [postponeReasonCode, setPostponeReasonCode] = useState("");
  const [postponeReasonNotes, setPostponeReasonNotes] = useState("");
  const [postponeDate, setPostponeDate] = useState("");
  const [isPostponing, setIsPostponing] = useState(false);

  function openPostponeModal(schedule: ScheduleItem) {
    if (!isActiveProgrammingStatus(getDisplayProgrammingStatus(schedule))) {
      setFeedback({ type: "error", message: "Somente programacoes ativas podem ser adiadas." });
      return;
    }

    if (!reasonOptions.length) {
      setFeedback({
        type: "error",
        message: "Catalogo de motivos indisponivel. Aplique a migration 135 para usar adiamento por select.",
      });
      return;
    }

    setPostponeTarget(schedule);
    setPostponeReasonCode("");
    setPostponeReasonNotes("");
    setPostponeDate("");
    setFeedback(null);
  }

  function closePostponeModal() {
    if (isPostponing) return;
    setPostponeTarget(null);
    setPostponeReasonCode("");
    setPostponeReasonNotes("");
    setPostponeDate("");
  }

  async function confirmPostpone() {
    if (!accessToken || !postponeTarget) {
      openAlertModal("Falha ao validar adiamento", "Sessao invalida para validar o adiamento.");
      return;
    }

    if (postponeDate && postponeDate <= postponeTarget.date) {
      openAlertModal(
        "Conflito na nova data",
        "A nova data da programacao precisa ser posterior a data atual.",
        [`Data atual da programacao: ${formatDate(postponeTarget.date)}.`],
      );
      return;
    }

    const selectedReasonText = buildReasonText(reasonOptions, postponeReasonCode, postponeReasonNotes);
    if (!selectedReasonText) {
      openAlertModal(
        "Motivo do adiamento incompleto",
        "Selecione o motivo do adiamento. Quando o motivo exigir observacao, preencha o campo complementar.",
      );
      return;
    }

    setIsPostponing(true);
    setFeedback(null);

    try {
      const { ok, data } = await postponeProgramming({
        accessToken,
        id: postponeTarget.id,
        reason: selectedReasonText,
        newDate: postponeDate || undefined,
        expectedUpdatedAt: postponeTarget.updatedAt,
      });

      if (!ok) {
        const message = buildConflictFeedbackMessage(data, "Falha ao adiar programacao.");
        setFeedback({ type: "error", message });
        if (data.reason === "PROJECT_COMPLETED_REQUIRES_REOPEN") {
          openProjectCompletedAlertModal({ title: "Projeto concluido exige reabertura", payload: data });
        } else {
          openAlertModal(
            data.error === "conflict" ? "Conflito ao validar adiamento" : "Falha ao validar adiamento",
            message,
            buildConflictAlertDetails(data),
          );
        }
        await onError("Falha ao adiar programacao.", undefined, {
          operation: "postpone_programming",
          programmingId: postponeTarget.id,
          projectId: postponeTarget.projectId,
          teamId: postponeTarget.teamId,
          status: postponeTarget.status,
          expectedUpdatedAt: postponeTarget.updatedAt,
          newDate: postponeDate || null,
          responseMessage: message,
          responseError: data.error ?? null,
        });
        return;
      }

      if (editingScheduleId === postponeTarget.id) {
        onCancelEditMode();
      }

      closePostponeModal();
      setFeedback({ type: "success", message: data.message ?? "Programacao adiada com sucesso." });

      try {
        const boardData = await fetchBoardSnapshot();
        if (boardData) applyBoardSnapshot(boardData);
      } catch (refreshError) {
        await onError("Programacao adiada, mas houve falha ao atualizar a visualizacao.", refreshError, {
          operation: "refresh_after_postpone",
          programmingId: postponeTarget.id,
          projectId: postponeTarget.projectId,
          teamId: postponeTarget.teamId,
          newDate: postponeDate || null,
        });
        if (!data.warning) {
          setFeedback({
            type: "success",
            message: `${data.message ?? "Programacao adiada com sucesso."} Programacao salva com sucesso, mas houve falha ao atualizar a visualizacao.`,
          });
        }
      }
    } catch (error) {
      setFeedback({ type: "error", message: "Falha ao adiar programacao." });
      openAlertModal("Falha ao validar adiamento", "Falha ao adiar programacao.");
      await onError("Falha ao adiar programacao.", error, {
        operation: "postpone_programming",
        programmingId: postponeTarget.id,
        projectId: postponeTarget.projectId,
        teamId: postponeTarget.teamId,
        status: postponeTarget.status,
        expectedUpdatedAt: postponeTarget.updatedAt,
        newDate: postponeDate || null,
      });
    } finally {
      setIsPostponing(false);
    }
  }

  return {
    postponeTarget,
    postponeReasonCode,
    setPostponeReasonCode,
    postponeReasonNotes,
    setPostponeReasonNotes,
    postponeDate,
    setPostponeDate,
    isPostponing,
    openPostponeModal,
    closePostponeModal,
    confirmPostpone,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// useCopyToDatesModal
// ─────────────────────────────────────────────────────────────────────────────

type CopyToDatesDraftRow = {
  id: string;
  date: string;
  etapaNumber: string;
  teamIds: string[];
};

function createCopyToDatesDraftRow(etapaNumber = "", teamIds: string[] = []): CopyToDatesDraftRow {
  const randomSuffix = Math.random().toString(36).slice(2);
  return { id: `copy-date-${Date.now()}-${randomSuffix}`, date: "", etapaNumber, teamIds };
}

export function useCopyToDatesModal(params: {
  accessToken: string | null;
  teams: TeamItem[];
  schedules: ScheduleItem[];
  openAlertModal: OpenAlertModalFn;
  setFeedback: Dispatch<SetStateAction<FeedbackState>>;
  setStageConflictModal: Dispatch<SetStateAction<{
    enteredEtapaNumber: number;
    highestStage: number;
    teams: StageValidationTeamSummary[];
  } | null>>;
  fetchBoardSnapshot: () => Promise<ProgrammingResponse | null>;
  applyBoardSnapshot: (data: ProgrammingResponse) => void;
  onError: ErrorLogHandler;
}) {
  const {
    accessToken,
    teams,
    schedules,
    openAlertModal,
    setFeedback,
    setStageConflictModal,
    fetchBoardSnapshot,
    applyBoardSnapshot,
    onError,
  } = params;

  const [copyToDatesTarget, setCopyToDatesTarget] = useState<ScheduleItem | null>(null);
  const [copyToDatesRows, setCopyToDatesRows] = useState<CopyToDatesDraftRow[]>([]);
  const [isCopyingToDates, setIsCopyingToDates] = useState(false);

  function resolveCopyToDatesDefaultTeamIds(schedule: ScheduleItem) {
    const groupTeamIds = schedules
      .filter((item) =>
        item.projectId === schedule.projectId
        && item.date === schedule.date
        && item.etapaNumber === schedule.etapaNumber
        && !item.etapaUnica
        && !item.etapaFinal
        && isActiveProgrammingStatus(getDisplayProgrammingStatus(item)),
      )
      .map((item) => item.teamId)
      .filter(Boolean);

    const uniqueTeamIds = Array.from(new Set(groupTeamIds));
    return uniqueTeamIds.length ? uniqueTeamIds : [schedule.teamId].filter(Boolean);
  }

  function openCopyToDatesModal(schedule: ScheduleItem) {
    const displayStatus = getDisplayProgrammingStatus(schedule);
    if (!isActiveProgrammingStatus(displayStatus)) {
      openAlertModal("Copia indisponivel", "Somente programacoes ativas podem ser copiadas para outras datas.");
      return;
    }

    if (schedule.etapaUnica || schedule.etapaFinal) {
      openAlertModal(
        "Copia bloqueada",
        "Programacoes marcadas como ETAPA UNICA ou ETAPA FINAL nao podem ser copiadas para outras datas.",
      );
      return;
    }

    if (!schedule.etapaNumber || schedule.etapaNumber < 1) {
      openAlertModal(
        "ETAPA obrigatoria",
        "A programacao de origem precisa ter uma ETAPA numerica para permitir copia incrementada.",
      );
      return;
    }

    const defaultTeamIds = resolveCopyToDatesDefaultTeamIds(schedule);
    setCopyToDatesTarget(schedule);
    setCopyToDatesRows([createCopyToDatesDraftRow(String(schedule.etapaNumber + 1), defaultTeamIds)]);
    setFeedback(null);
  }

  function closeCopyToDatesModal() {
    if (isCopyingToDates) return;
    setCopyToDatesTarget(null);
    setCopyToDatesRows([]);
  }

  function updateCopyToDatesRow(rowId: string, field: "date" | "etapaNumber", value: string) {
    setCopyToDatesRows((current) =>
      current.map((row) =>
        row.id === rowId
          ? { ...row, [field]: field === "etapaNumber" ? value.replace(/\D/g, "") : value }
          : row,
      ),
    );
  }

  function toggleCopyToDatesTeam(rowId: string, teamId: string) {
    setCopyToDatesRows((current) =>
      current.map((row) => {
        if (row.id !== rowId) return row;
        const nextTeamIds = row.teamIds.includes(teamId)
          ? row.teamIds.filter((item) => item !== teamId)
          : [...row.teamIds, teamId];
        return { ...row, teamIds: nextTeamIds };
      }),
    );
  }

  function selectAllCopyToDatesTeams(rowId: string) {
    setCopyToDatesRows((current) =>
      current.map((row) => (row.id === rowId ? { ...row, teamIds: teams.map((team) => team.id) } : row)),
    );
  }

  function clearCopyToDatesTeams(rowId: string) {
    setCopyToDatesRows((current) =>
      current.map((row) => (row.id === rowId ? { ...row, teamIds: [] } : row)),
    );
  }

  function addCopyToDatesRow() {
    setCopyToDatesRows((current) => {
      const currentEtapas = current
        .map((row) => Number(row.etapaNumber))
        .filter((value) => Number.isInteger(value) && value > 0);
      const baseEtapa = copyToDatesTarget?.etapaNumber ?? 0;
      const nextEtapa = Math.max(baseEtapa, ...currentEtapas) + 1;
      const previousTeamIds = current[current.length - 1]?.teamIds
        ?? (copyToDatesTarget ? resolveCopyToDatesDefaultTeamIds(copyToDatesTarget) : []);
      return [...current, createCopyToDatesDraftRow(String(nextEtapa), previousTeamIds)];
    });
  }

  function removeCopyToDatesRow(rowId: string) {
    setCopyToDatesRows((current) =>
      current.length > 1 ? current.filter((row) => row.id !== rowId) : current,
    );
  }

  async function confirmCopyToDates() {
    if (!accessToken || !copyToDatesTarget) {
      openAlertModal("Falha ao validar copia", "Sessao invalida para copiar a programacao.");
      return;
    }

    const sourceEtapaNumber = copyToDatesTarget.etapaNumber ?? 0;
    const normalizedTargets = copyToDatesRows.map((row) => ({
      date: row.date,
      etapaNumber: Number(row.etapaNumber),
      teamIds: Array.from(new Set(row.teamIds.filter(Boolean))),
    }));

    const invalidRows = normalizedTargets.filter(
      (row) => !row.date || !Number.isInteger(row.etapaNumber) || row.etapaNumber <= 0 || !row.teamIds.length,
    );
    if (invalidRows.length) {
      openAlertModal("Revise as datas da copia", "Informe Data destino, ETAPA numerica e ao menos uma equipe em todas as linhas.");
      return;
    }

    const repeatedDates = normalizedTargets.map((row) => row.date).filter((date, index, dates) => dates.indexOf(date) !== index);
    if (repeatedDates.length) {
      openAlertModal("Datas duplicadas", "Cada data destino deve aparecer apenas uma vez no modal.");
      return;
    }

    if (normalizedTargets.some((row) => row.date === copyToDatesTarget.date)) {
      openAlertModal("Data original bloqueada", "A data original da programacao nao pode ser selecionada como destino da copia.");
      return;
    }

    const repeatedEtapas = normalizedTargets.map((row) => row.etapaNumber).filter((etapa, index, etapas) => etapas.indexOf(etapa) !== index);
    if (repeatedEtapas.length) {
      openAlertModal("ETAPAs duplicadas", "Cada data destino deve receber uma ETAPA diferente.");
      return;
    }

    if (normalizedTargets.some((row) => row.etapaNumber <= sourceEtapaNumber)) {
      openAlertModal("ETAPA invalida", `As ETAPAs de destino devem ser maiores que a etapa atual (${sourceEtapaNumber}).`);
      return;
    }

    setIsCopyingToDates(true);
    setFeedback(null);

    try {
      const { ok, data } = await copyProgrammingToDates({
        accessToken,
        sourceProgrammingId: copyToDatesTarget.id,
        expectedUpdatedAt: copyToDatesTarget.updatedAt,
        targets: normalizedTargets,
      });

      if (!ok) {
        const message = data.message ?? "Falha ao copiar programacao para as datas selecionadas.";
        setFeedback({ type: "error", message });
        if (data.hasConflict && Array.isArray(data.teams) && data.teams.length) {
          setStageConflictModal({
            enteredEtapaNumber: Number(data.enteredEtapaNumber ?? 0),
            highestStage: Number(data.highestStage ?? 0),
            teams: data.teams,
          });
        }
        openAlertModal("Falha ao validar copia", message, data.detail ? [data.detail] : undefined);
        await onError("Falha ao copiar programacao para datas.", undefined, {
          operation: "copy_programming_to_dates",
          programmingId: copyToDatesTarget.id,
          projectId: copyToDatesTarget.projectId,
          teamId: copyToDatesTarget.teamId,
          sourceDate: copyToDatesTarget.date,
          targetDates: normalizedTargets.map((item) => item.date),
          targetTeamIds: normalizedTargets.flatMap((item) => item.teamIds),
          responseMessage: message,
          responseReason: data.reason ?? null,
        });
        return;
      }

      setCopyToDatesTarget(null);
      setCopyToDatesRows([]);
      setFeedback({ type: "success", message: data.message ?? "Programacao copiada com sucesso." });

      try {
        const boardData = await fetchBoardSnapshot();
        if (boardData) applyBoardSnapshot(boardData);
      } catch (refreshError) {
        await onError("Programacao copiada, mas houve falha ao atualizar a visualizacao.", refreshError, {
          operation: "refresh_after_copy_to_dates",
          programmingId: copyToDatesTarget.id,
          targetDates: normalizedTargets.map((item) => item.date),
          targetTeamIds: normalizedTargets.flatMap((item) => item.teamIds),
        });
        setFeedback({
          type: "success",
          message: `${data.message ?? "Programacao copiada com sucesso."} Programacao salva com sucesso, mas houve falha ao atualizar a visualizacao.`,
        });
      }
    } catch (error) {
      setFeedback({ type: "error", message: "Falha ao copiar programacao para as datas selecionadas." });
      openAlertModal("Falha ao validar copia", "Falha ao copiar programacao para as datas selecionadas.");
      await onError("Falha ao copiar programacao para datas.", error, {
        operation: "copy_programming_to_dates",
        programmingId: copyToDatesTarget.id,
        projectId: copyToDatesTarget.projectId,
        teamId: copyToDatesTarget.teamId,
        targetTeamIds: normalizedTargets.flatMap((item) => item.teamIds),
      });
    } finally {
      setIsCopyingToDates(false);
    }
  }

  return {
    copyToDatesTarget,
    copyToDatesRows,
    isCopyingToDates,
    openCopyToDatesModal,
    closeCopyToDatesModal,
    updateCopyToDatesRow,
    toggleCopyToDatesTeam,
    selectAllCopyToDatesTeams,
    clearCopyToDatesTeams,
    addCopyToDatesRow,
    removeCopyToDatesRow,
    confirmCopyToDates,
  };
}
