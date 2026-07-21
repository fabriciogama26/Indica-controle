import { useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import {
  addProgrammingTeam,
  cancelProgrammingStage,
  changeCompletedStageWorkStatus,
  completeProgrammingStage,
  fetchActivityCatalog,
  fetchProgrammingMeta,
  fetchProgrammingPlan,
  fetchProgrammingStageHistory,
  fetchProgrammingStageList,
  postponeProgrammingStage,
  removeProgrammingTeam,
  reopenProgrammingStage,
  saveProgrammingStage,
  setProgrammingPendenciaFlag,
  setProgrammingWorkCompletionStatus,
  type SaveStageRequestBody,
} from "./api";
import { HISTORY_PAGE_SIZE, STAGE_LIST_PAGE_SIZE } from "./constants";
import type {
  ActionResponse,
  ActivityCatalogItem,
  FeedbackState,
  HistoryItem,
  HistoryModalTarget,
  MetaResponse,
  ProgrammingStage,
  SaveStageResponse,
  StageListFilters,
  StageListItem,
} from "./types";

type ErrorLogHandler = (message: string, error?: unknown, context?: Record<string, unknown>) => void | Promise<void>;

export function useProgrammingMeta(params: { accessToken: string | null; onError?: ErrorLogHandler }) {
  const { accessToken, onError } = params;
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [isLoadingMeta, setIsLoadingMeta] = useState(false);

  const loadMeta = useCallback(async () => {
    if (!accessToken) return;
    setIsLoadingMeta(true);
    try {
      const data = await fetchProgrammingMeta({ accessToken });
      setMeta(data);
    } catch (error) {
      setMeta(null);
      void onError?.("Falha ao carregar catalogo de programacao normalizada.", error, { operation: "load_meta" });
    } finally {
      setIsLoadingMeta(false);
    }
  }, [accessToken, onError]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  return { meta, isLoadingMeta, reloadMeta: loadMeta };
}

export function useActivityCatalogSearch(params: { accessToken: string | null; query: string; onError?: ErrorLogHandler }) {
  const { accessToken, query, onError } = params;
  const [activityOptions, setActivityOptions] = useState<ActivityCatalogItem[]>([]);
  const [isLoadingActivities, setIsLoadingActivities] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (!accessToken || trimmed.length < 2) {
      setActivityOptions([]);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsLoadingActivities(true);
      try {
        const items = await fetchActivityCatalog({ accessToken, query: trimmed, signal: controller.signal });
        setActivityOptions(items);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setActivityOptions([]);
          void onError?.("Falha ao buscar catalogo de atividades.", error, { operation: "search_activity_catalog" });
        }
      } finally {
        setIsLoadingActivities(false);
      }
    }, 220);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [accessToken, query, onError]);

  return { activityOptions, isLoadingActivities };
}

export function useProgrammingStageList(params: {
  accessToken: string | null;
  filters: StageListFilters;
  onError?: ErrorLogHandler;
}) {
  const { accessToken, filters, onError } = params;
  const [items, setItems] = useState<StageListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const teamIdsKey = filters.teamIds.join(",");

  useEffect(() => {
    setPage(1);
  }, [filters.dateFrom, filters.dateTo, filters.statusChip, filters.search, filters.municipality, teamIdsKey]);

  const loadList = useCallback(async () => {
    if (!accessToken) return;

    setIsLoadingList(true);
    try {
      const data = await fetchProgrammingStageList({ accessToken, filters, page, pageSize: STAGE_LIST_PAGE_SIZE });
      setItems(data.list ?? []);
      setTotal(data.total ?? 0);
    } catch (error) {
      setItems([]);
      setTotal(0);
      void onError?.("Falha ao carregar lista de programacoes.", error, { operation: "load_stage_list" });
    } finally {
      setIsLoadingList(false);
    }
  }, [accessToken, filters, page, onError]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  return { items, total, page, setPage, isLoadingList, reloadList: loadList };
}

export function useProgrammingPlan(params: {
  accessToken: string | null;
  projectId: string;
  onError?: ErrorLogHandler;
}) {
  const { accessToken, projectId, onError } = params;
  const [stages, setStages] = useState<ProgrammingStage[]>([]);
  const [isLoadingPlan, setIsLoadingPlan] = useState(false);

  const loadPlan = useCallback(async () => {
    if (!accessToken || !projectId) {
      setStages([]);
      return;
    }

    setIsLoadingPlan(true);
    try {
      const plan = await fetchProgrammingPlan({ accessToken, projectId });
      setStages(plan);
    } catch (error) {
      setStages([]);
      void onError?.("Falha ao carregar plano de programacao.", error, { operation: "load_plan", projectId });
    } finally {
      setIsLoadingPlan(false);
    }
  }, [accessToken, projectId, onError]);

  useEffect(() => {
    void loadPlan();
  }, [loadPlan]);

  return { stages, isLoadingPlan, reloadPlan: loadPlan };
}

export function useHistoryModal(params: { accessToken: string | null; onError: ErrorLogHandler }) {
  const { accessToken, onError } = params;
  const [historyTarget, setHistoryTarget] = useState<HistoryModalTarget | null>(null);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);

  async function openHistory(stage: HistoryModalTarget) {
    if (!accessToken) return;
    setHistoryTarget(stage);
    setHistoryItems([]);
    setHistoryPage(1);
    setIsLoadingHistory(true);
    try {
      const history = await fetchProgrammingStageHistory({ accessToken, programmingId: stage.id });
      setHistoryItems(history);
    } catch (error) {
      await onError("Falha ao carregar historico da etapa.", error, { operation: "load_history", programmingId: stage.id });
    } finally {
      setIsLoadingHistory(false);
    }
  }

  const totalHistoryPages = Math.max(1, Math.ceil(historyItems.length / HISTORY_PAGE_SIZE));
  const pagedHistoryItems = historyItems.slice((historyPage - 1) * HISTORY_PAGE_SIZE, historyPage * HISTORY_PAGE_SIZE);

  return {
    historyTarget,
    setHistoryTarget,
    historyItems,
    pagedHistoryItems,
    historyPage,
    totalHistoryPages,
    isLoadingHistory,
    openHistory,
    onPreviousHistoryPage: () => setHistoryPage((current) => Math.max(1, current - 1)),
    onNextHistoryPage: () => setHistoryPage((current) => Math.min(totalHistoryPages, current + 1)),
  };
}

export function useProgrammingStageActions(params: {
  accessToken: string | null;
  setFeedback: Dispatch<SetStateAction<FeedbackState>>;
  onSuccess: () => void | Promise<void>;
  onError: ErrorLogHandler;
}) {
  const { accessToken, setFeedback, onSuccess, onError } = params;
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function runAction<T extends { success?: boolean; message?: string; reason?: string | null }>(
    operation: string,
    context: Record<string, unknown>,
    call: () => Promise<{ ok: boolean; status: number; data: T }>,
  ) {
    setIsSubmitting(true);
    setFeedback(null);
    try {
      const { ok, data } = await call();
      if (!ok) {
        setFeedback({ type: "error", message: data.message ?? "Falha ao processar a operacao." });
        await onError(data.message ?? "Falha ao processar a operacao.", undefined, { operation, ...context, reason: data.reason ?? null });
        return { ok: false as const, data };
      }

      setFeedback({ type: "success", message: data.message ?? "Operacao realizada com sucesso." });
      await onSuccess();
      return { ok: true as const, data };
    } catch (error) {
      setFeedback({ type: "error", message: "Falha ao processar a operacao." });
      await onError("Falha ao processar a operacao.", error, { operation, ...context });
      return { ok: false as const, data: null };
    } finally {
      setIsSubmitting(false);
    }
  }

  async function saveStage(body: SaveStageRequestBody, isEditing: boolean) {
    if (!accessToken) return { ok: false as const, data: null };
    return runAction<SaveStageResponse>("save_stage", { projectId: body.projectId, programmingId: body.programmingId }, () =>
      saveProgrammingStage({ accessToken, isEditing, body }),
    );
  }

  async function addTeam(programmingId: string, teamId: string) {
    if (!accessToken) return { ok: false as const, data: null };
    return runAction<SaveStageResponse>("add_team", { programmingId, teamId }, () => addProgrammingTeam({ accessToken, programmingId, teamId }));
  }

  async function removeTeam(programmingTeamId: string, expectedUpdatedAt: string) {
    if (!accessToken) return { ok: false as const, data: null };
    return runAction<ActionResponse>("remove_team", { programmingTeamId }, () =>
      removeProgrammingTeam({ accessToken, programmingTeamId, expectedUpdatedAt }),
    );
  }

  // newExecutionDate null = "deixar em espera" (ADIADA sem data); com data = remarcar.
  async function postpone(programmingId: string, newExecutionDate: string | null, reason: string, expectedUpdatedAt: string) {
    if (!accessToken) return { ok: false as const, data: null };
    return runAction<ActionResponse>("postpone_stage", { programmingId }, () =>
      postponeProgrammingStage({ accessToken, programmingId, newExecutionDate, reason, expectedUpdatedAt }),
    );
  }

  async function togglePendencia(programmingId: string, isPendencia: boolean, expectedUpdatedAt: string) {
    if (!accessToken) return { ok: false as const, data: null };
    return runAction<ActionResponse>("toggle_pendencia", { programmingId, isPendencia }, () =>
      setProgrammingPendenciaFlag({ accessToken, programmingId, isPendencia, expectedUpdatedAt }),
    );
  }

  async function cancel(programmingId: string, reason: string, expectedUpdatedAt: string) {
    if (!accessToken) return { ok: false as const, data: null };
    return runAction<ActionResponse>("cancel_stage", { programmingId }, () =>
      cancelProgrammingStage({ accessToken, programmingId, reason, expectedUpdatedAt }),
    );
  }

  async function complete(programmingId: string, expectedUpdatedAt: string) {
    if (!accessToken) return { ok: false as const, data: null };
    return runAction<ActionResponse>("complete_stage", { programmingId }, () =>
      completeProgrammingStage({ accessToken, programmingId, expectedUpdatedAt }),
    );
  }

  async function reopen(programmingId: string, expectedUpdatedAt: string) {
    if (!accessToken) return { ok: false as const, data: null };
    return runAction<ActionResponse>("reopen_stage", { programmingId }, () =>
      reopenProgrammingStage({ accessToken, programmingId, expectedUpdatedAt }),
    );
  }

  async function setWorkCompletionStatus(programmingId: string, workCompletionStatus: string | null, expectedUpdatedAt: string) {
    if (!accessToken) return { ok: false as const, data: null };
    return runAction<ActionResponse>("set_work_completion_status", { programmingId, workCompletionStatus }, () =>
      setProgrammingWorkCompletionStatus({ accessToken, programmingId, workCompletionStatus, expectedUpdatedAt }),
    );
  }

  // Sair de CONCLUIDO num unico commit transacional (achado 4): reabre, restaura
  // as antecipadas e aplica o novo estado numa so RPC — nunca deixa o projeto
  // reaberto sem o estado por falha entre duas chamadas.
  async function changeCompletedWorkStatus(programmingId: string, newWorkCompletionStatus: string | null, expectedUpdatedAt: string) {
    if (!accessToken) return { ok: false as const, data: null };
    return runAction<ActionResponse>("change_completed_work_status", { programmingId, newWorkCompletionStatus }, () =>
      changeCompletedStageWorkStatus({ accessToken, programmingId, newWorkCompletionStatus, expectedUpdatedAt }),
    );
  }

  // "Estado do trabalho" no select da lista/card: Concluido reusa a acao Concluir
  // (guarda de unico ativo + antecipacao); sair de Concluido usa a RPC unica
  // change_completed_stage_work_status (reabre + aplica o novo estado atomicamente).
  async function changeWorkCompletionStatus(stage: Pick<StageListItem, "id" | "workCompletionStatus" | "updatedAt">, nextValue: string | null) {
    if (nextValue === "CONCLUIDO") {
      return complete(stage.id, stage.updatedAt);
    }

    if (stage.workCompletionStatus === "CONCLUIDO") {
      return changeCompletedWorkStatus(stage.id, nextValue, stage.updatedAt);
    }

    return setWorkCompletionStatus(stage.id, nextValue, stage.updatedAt);
  }

  return { isSubmitting, saveStage, addTeam, removeTeam, postpone, togglePendencia, cancel, complete, reopen, setWorkCompletionStatus, changeCompletedWorkStatus, changeWorkCompletionStatus };
}
