import { useCallback, useDeferredValue, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import { fetchActivityCatalog, fetchNextEtapaNumber, fetchProgrammingSnapshot } from "./api";
import type {
  ActivityCatalogItem,
  ElectricalEqCatalogItem,
  FilterState,
  FormState,
  ProgrammingReasonOptionItem,
  ProgrammingResponse,
  ProjectItem,
  ScheduleItem,
  SgdTypeItem,
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
