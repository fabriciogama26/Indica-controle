"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { useErrorLogger } from "@/hooks/useErrorLogger";
import { useExportCooldown } from "@/hooks/useExportCooldown";
import { supabase } from "@/lib/supabase/client";
import styles from "./ProgrammingSimplePageView.module.css";
import {
  ProgrammingAlertModal,
  ProgrammingCancelModal,
  ProgrammingDeadlinePanel,
  ProgrammingDeadlineModal,
  ProgrammingDetailsModal,
  ProgrammingHistoryModal,
  ProgrammingPostponeModal,
  ProgrammingStageConflictModal,
  ProgrammingWeeklyCalendarPanel,
} from "./components";
import {
  cancelProgramming,
  fetchProgrammingHistory,
  postponeProgramming,
  saveProgramming,
  validateProgrammingStageConflict,
} from "./api";
import {
  DEADLINE_CAROUSEL_PAGE_SIZE,
  DEADLINE_WINDOW_LONG_DAYS,
  DEADLINE_WINDOW_SHORT_DAYS,
  DOCUMENT_KEYS,
  HISTORY_PAGE_SIZE,
  PAGE_SIZE,
} from "./constants";
import {
  buildDeadlineCsvContent,
  buildEnelCsvContent,
  buildEnelNovoWorkbookData,
  buildProgrammingCsvContent,
} from "./exports";
import { useProgrammingActivityCatalog, useProgrammingBoardData, useProgrammingEtapaSuggestion } from "./hooks";
import {
  addDays,
  calculateDateDiffInDays,
  calculateExpectedMinutes,
  createInitialForm,
  createWeekDates,
  findActivityOption,
  formatDate,
  formatDateTime,
  formatDeadlineStatusLabel,
  getCurrentYearDateRange,
  getDisplayProgrammingStatus,
  isActiveProgrammingStatus,
  isDateInRange,
  isInactiveProgrammingStatus,
  isWorkCompleted,
  normalizeHistoryItemsForDisplay,
  normalizeSgdNumberForExport,
  normalizeWorkCompletionCode,
  parseNonNegativeInteger,
  parseOptionalPositiveInteger,
  resolveDeadlineStatus,
  resolveDeadlineVisualVariant,
  resolveReasonOption,
  resolveScheduleTeamInfo,
  startOfWeekMonday,
  toIsoDate,
} from "./utils";
import {
  buildConflictAlertDetails,
  buildConflictFeedbackMessage,
  buildFieldValidationDetails,
  buildLocalStageConflictSummary,
  buildReasonText,
  buildSavedOutsideFiltersMessage,
  getDocumentRequestedAfterApprovedLabel,
  isInvalidTimeRange,
  isNegativeNumericText,
  isReasonSelectionValid,
} from "./validators";
import type {
  PeriodMode,
  WorkCompletionStatus,
  DocumentKey,
  ProjectItem,
  TeamItem,
  SupportOptionItem,
  ProgrammingReasonOptionItem,
  SgdTypeItem,
  ElectricalEqCatalogItem,
  WorkCompletionCatalogItem,
  DocumentEntry,
  ScheduleItem,
  StageValidationTeamSummary,
  ProgrammingHistoryItem,
  AlertModalState,
  FormState,
  FilterState,
  DeadlineStatus,
  DeadlineViewMode,
  ProgrammingSimplePageViewMode,
} from "./types";


function downloadCsvFile(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}


export function ProgrammingSimplePageView({ mode = "cadastro" }: { mode?: ProgrammingSimplePageViewMode }) {
  const { session } = useAuth();
  const logError = useErrorLogger("programacao_simples");
  const accessToken = session?.accessToken ?? null;
  const formCardRef = useRef<HTMLElement | null>(null);
  const feedbackRef = useRef<HTMLDivElement | null>(null);
  const isVisualizationMode = mode === "visualizacao";

  const today = useMemo(() => toIsoDate(new Date()), []);
  const currentYearDateRange = useMemo(() => getCurrentYearDateRange(today), [today]);
  const [form, setForm] = useState<FormState>(() => createInitialForm(today));
  const [weekStartDate, setWeekStartDate] = useState(() => startOfWeekMonday(today));
  const [filterDraft, setFilterDraft] = useState<FilterState>({
    startDate: currentYearDateRange.startDate,
    endDate: currentYearDateRange.endDate,
    projectSearch: "",
    projectId: "",
    municipality: "",
    teamId: "",
    status: "TODOS",
    workCompletionStatus: "TODOS",
    sgdTypeId: "",
  });
  const [activeFilters, setActiveFilters] = useState<FilterState>({
    startDate: currentYearDateRange.startDate,
    endDate: currentYearDateRange.endDate,
    projectSearch: "",
    projectId: "",
    municipality: "",
    teamId: "",
    status: "TODOS",
    workCompletionStatus: "TODOS",
    sgdTypeId: "",
  });

  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [teams, setTeams] = useState<TeamItem[]>([]);
  const [supportOptions, setSupportOptions] = useState<SupportOptionItem[]>([]);
  const [sgdTypes, setSgdTypes] = useState<SgdTypeItem[]>([]);
  const [electricalEqCatalog, setElectricalEqCatalog] = useState<ElectricalEqCatalogItem[]>([]);
  const [workCompletionCatalog, setWorkCompletionCatalog] = useState<WorkCompletionCatalogItem[]>([]);
  const [reasonOptions, setReasonOptions] = useState<ProgrammingReasonOptionItem[]>([]);
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [page, setPage] = useState(1);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingEnel, setIsExportingEnel] = useState(false);
  const [isExportingEnelNovo, setIsExportingEnelNovo] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editingExpectedUpdatedAt, setEditingExpectedUpdatedAt] = useState<string | null>(null);
  const [editChangeReasonCode, setEditChangeReasonCode] = useState("");
  const [editChangeReasonNotes, setEditChangeReasonNotes] = useState("");
  const [detailsTarget, setDetailsTarget] = useState<ScheduleItem | null>(null);
  const [historyTarget, setHistoryTarget] = useState<ScheduleItem | null>(null);
  const [historyItems, setHistoryItems] = useState<ProgrammingHistoryItem[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [deadlineViewMode, setDeadlineViewMode] = useState<DeadlineViewMode>("15");
  const [deadlineCarouselPage, setDeadlineCarouselPage] = useState(0);
  const [isDeadlineModalOpen, setIsDeadlineModalOpen] = useState(false);
  const [isExportingDeadlineModal, setIsExportingDeadlineModal] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<ScheduleItem | null>(null);
  const [cancelReasonCode, setCancelReasonCode] = useState("");
  const [cancelReasonNotes, setCancelReasonNotes] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);
  const [postponeTarget, setPostponeTarget] = useState<ScheduleItem | null>(null);
  const [postponeReasonCode, setPostponeReasonCode] = useState("");
  const [postponeReasonNotes, setPostponeReasonNotes] = useState("");
  const [postponeDate, setPostponeDate] = useState("");
  const [isPostponing, setIsPostponing] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [alertModal, setAlertModal] = useState<AlertModalState | null>(null);
  const [invalidFields, setInvalidFields] = useState<string[]>([]);
  const [isEtapaManuallyEdited, setIsEtapaManuallyEdited] = useState(false);
  const [stageConflictModal, setStageConflictModal] = useState<{
    enteredEtapaNumber: number;
    highestStage: number;
    teams: StageValidationTeamSummary[];
  } | null>(null);
  const commonExportCooldown = useExportCooldown();
  const enelExportCooldown = useExportCooldown();
  const deadlineModalExportCooldown = useExportCooldown();
  const resolveLatestAccessToken = useCallback(async () => {
    if (!supabase) {
      return accessToken;
    }

    const { data, error } = await supabase.auth.getSession();
    if (error) {
      return accessToken;
    }

    const refreshedAccessToken = data.session?.access_token?.trim() ?? "";
    return refreshedAccessToken || accessToken;
  }, [accessToken]);

  const { activityOptions, isLoadingActivities } = useProgrammingActivityCatalog({
    accessToken,
    search: form.activitySearch,
    onError: logError,
  });
  useProgrammingEtapaSuggestion({
    accessToken,
    form,
    isEditing: Boolean(editingScheduleId),
    isEtapaManuallyEdited,
    isVisualizationMode,
    setForm,
    setInvalidFields,
    setIsEtapaManuallyEdited,
    onError: logError,
  });
  const isEditing = Boolean(editingScheduleId);
  const currentEditingSchedule = useMemo(
    () => (editingScheduleId ? schedules.find((item) => item.id === editingScheduleId) ?? null : null),
    [editingScheduleId, schedules],
  );
  const canSubmitCancellation = isReasonSelectionValid(reasonOptions, cancelReasonCode, cancelReasonNotes) && !isCancelling;
  const safeFormLogContext = () => ({
    mode: isEditing ? "edit" : "batch_create",
    projectId: form.projectId || null,
    teamCount: form.teamIds.length,
    date: form.date || null,
    startTime: form.startTime || null,
    endTime: form.endTime || null,
    editingScheduleId,
    hasActivitiesLoaded: currentEditingSchedule?.activitiesLoaded ?? null,
    activityCount: form.activities.length,
    hasEtapaUnica: form.etapaUnica,
    hasEtapaFinal: form.etapaFinal,
    hasWorkCompletionStatus: Boolean(form.workCompletionStatus),
    documentKeysWithNumber: DOCUMENT_KEYS.filter((item) => Boolean(form.documents[item.key].number.trim())).map((item) => item.key),
  });
  const selectedProject = projects.find((item) => item.id === form.projectId) ?? null;
  const availableTeams = useMemo(() => {
    if (!selectedProject) {
      return teams;
    }

    return teams.filter((team) => team.serviceCenterName === selectedProject.base);
  }, [selectedProject, teams]);

  const visibleTeamOptions = useMemo(() => {
    const search = form.teamSearch.trim().toLowerCase();
    if (!search) {
      return availableTeams;
    }

    return availableTeams.filter((team) => team.name.toLowerCase().includes(search));
  }, [availableTeams, form.teamSearch]);

  const projectMap = useMemo(() => new Map(projects.map((item) => [item.id, item])), [projects]);
  const municipalityOptions = useMemo(
    () => Array.from(new Set(projects.map((item) => item.city).filter(Boolean))).sort((left, right) => left.localeCompare(right)),
    [projects],
  );
  const teamMap = useMemo(() => new Map(teams.map((item) => [item.id, item])), [teams]);
  const workCompletionLabelMap = useMemo(
    () => new Map(workCompletionCatalog.map((item) => [item.code, item.label])),
    [workCompletionCatalog],
  );
  const originalEditingTeamName = editingTeamId ? teamMap.get(editingTeamId)?.name ?? editingTeamId : "";
  const selectedEditingTeamId = isEditing ? form.teamIds[0] ?? "" : "";
  const selectedEditingTeamName = selectedEditingTeamId ? teamMap.get(selectedEditingTeamId)?.name ?? selectedEditingTeamId : "";
  const hasEditingTeamChanged = Boolean(isEditing && editingTeamId && selectedEditingTeamId && selectedEditingTeamId !== editingTeamId);
  const weekDates = useMemo(() => createWeekDates(weekStartDate), [weekStartDate]);
  const weekEndDate = weekDates[weekDates.length - 1] ?? weekStartDate;
  const { applyBoardSnapshot, fetchBoardSnapshot, isLoadingList, loadBoardData } = useProgrammingBoardData({
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
    onError: logError,
  });

  const filteredSchedules = useMemo(() => {
    const filtered = schedules.filter((item) => {
      const displayStatus = getDisplayProgrammingStatus(item);
      const shouldApplyDateFilter = !isInactiveProgrammingStatus(displayStatus);
      if (shouldApplyDateFilter && !isDateInRange(item.date, activeFilters.startDate, activeFilters.endDate)) {
        return false;
      }

      if (activeFilters.projectId && item.projectId !== activeFilters.projectId) {
        return false;
      }

      if (activeFilters.municipality) {
        const scheduleProjectCity = projectMap.get(item.projectId)?.city ?? "";
        if (scheduleProjectCity !== activeFilters.municipality) {
          return false;
        }
      }

      if (activeFilters.teamId && item.teamId !== activeFilters.teamId) {
        return false;
      }

      if (activeFilters.status !== "TODOS" && displayStatus !== activeFilters.status) {
        return false;
      }

      if (activeFilters.workCompletionStatus !== "TODOS") {
        const scheduleWorkCompletionStatus = normalizeWorkCompletionCode(item.workCompletionStatus);
        const selectedWorkCompletionStatus = normalizeWorkCompletionCode(activeFilters.workCompletionStatus);
        if (scheduleWorkCompletionStatus !== selectedWorkCompletionStatus) {
          return false;
        }
      }

      if (activeFilters.sgdTypeId && item.sgdTypeId !== activeFilters.sgdTypeId) {
        return false;
      }

      return true;
    });
    filtered.sort((left, right) => {
      if (left.date !== right.date) {
        return right.date.localeCompare(left.date);
      }

      if (left.createdAt !== right.createdAt) {
        return right.createdAt.localeCompare(left.createdAt);
      }

      if (left.startTime !== right.startTime) {
        return right.startTime.localeCompare(left.startTime);
      }

      return right.updatedAt.localeCompare(left.updatedAt);
    });
    return filtered;
  }, [activeFilters.endDate, activeFilters.municipality, activeFilters.projectId, activeFilters.sgdTypeId, activeFilters.startDate, activeFilters.status, activeFilters.teamId, activeFilters.workCompletionStatus, projectMap, schedules]);

  const totalPages = Math.max(1, Math.ceil(filteredSchedules.length / PAGE_SIZE));
  const pagedSchedules = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredSchedules.slice(start, start + PAGE_SIZE);
  }, [filteredSchedules, page]);
  const totalHistoryPages = Math.max(1, Math.ceil(historyItems.length / HISTORY_PAGE_SIZE));
  const pagedHistoryItems = useMemo(() => {
    const start = (historyPage - 1) * HISTORY_PAGE_SIZE;
    return historyItems.slice(start, start + HISTORY_PAGE_SIZE);
  }, [historyItems, historyPage]);
  const calendarTeams = useMemo(() => {
    const selectedTeams = activeFilters.teamId
      ? teams.filter((team) => team.id === activeFilters.teamId)
      : teams;

    return [...selectedTeams].sort((left, right) => left.name.localeCompare(right.name));
  }, [activeFilters.teamId, teams]);
  const weeklySchedules = useMemo(
    () => filteredSchedules.filter((item) => isDateInRange(item.date, weekStartDate, weekEndDate)),
    [filteredSchedules, weekEndDate, weekStartDate],
  );
  const weeklyScheduleMap = useMemo(() => {
    const scheduleMap = new Map<string, ScheduleItem[]>();

    for (const schedule of weeklySchedules) {
      const key = `${schedule.teamId}__${schedule.date}`;
      const list = scheduleMap.get(key) ?? [];
      list.push(schedule);
      scheduleMap.set(key, list);
    }

    for (const list of scheduleMap.values()) {
      list.sort((left, right) => left.startTime.localeCompare(right.startTime));
    }

    return scheduleMap;
  }, [weeklySchedules]);

  const concludedProjectIds = useMemo(() => {
    const ids = new Set<string>();
    for (const schedule of schedules) {
      if (isWorkCompleted(schedule.workCompletionStatus)) {
        ids.add(schedule.projectId);
      }
    }
    return ids;
  }, [schedules]);

  const deadlineWindowDays = useMemo(
    () => (deadlineViewMode === "15" ? DEADLINE_WINDOW_SHORT_DAYS : DEADLINE_WINDOW_LONG_DAYS),
    [deadlineViewMode],
  );

  const deadlineProjects = useMemo(() => {
    return projects
      .map((project) => {
        if (concludedProjectIds.has(project.id)) {
          return null;
        }

        const executionDeadline = (project.executionDeadline ?? "").trim();
        if (!executionDeadline || !/^\d{4}-\d{2}-\d{2}$/.test(executionDeadline)) {
          return null;
        }

        const daysDiff = calculateDateDiffInDays(executionDeadline, today);
        return {
          id: project.id,
          sob: project.code,
          serviceCenter: project.base || "Sem base",
          executionDeadline,
          daysDiff,
        };
      })
      .filter((item): item is {
        id: string;
        sob: string;
        serviceCenter: string;
        executionDeadline: string;
        daysDiff: number;
      } => Boolean(item));
  }, [concludedProjectIds, projects, today]);

  const deadlineSummary = useMemo(() => {
    const overdue = deadlineProjects.filter((item) => resolveDeadlineStatus(item.daysDiff, deadlineWindowDays) === "OVERDUE").length;
    const dueToday = deadlineProjects.filter((item) => resolveDeadlineStatus(item.daysDiff, deadlineWindowDays) === "TODAY").length;
    const dueSoon = deadlineProjects.filter((item) => resolveDeadlineStatus(item.daysDiff, deadlineWindowDays) === "SOON").length;
    const normal = deadlineProjects.filter((item) => resolveDeadlineStatus(item.daysDiff, deadlineWindowDays) === "NORMAL").length;

    return { overdue, dueToday, dueSoon, normal };
  }, [deadlineProjects, deadlineWindowDays]);

  const deadlineSobCards = useMemo(() => {
    const priorityByStatus: Record<DeadlineStatus, number> = {
      TODAY: 0,
      SOON: 1,
      OVERDUE: 2,
      NORMAL: 3,
    };

    return deadlineProjects
      .filter((item) => item.daysDiff <= deadlineWindowDays)
      .map((item) => {
        const deadlineStatus = resolveDeadlineStatus(item.daysDiff, deadlineWindowDays);
        return {
          ...item,
          deadlineStatus,
          visualVariant: resolveDeadlineVisualVariant(item.daysDiff, deadlineWindowDays),
          statusLabel: formatDeadlineStatusLabel(item.daysDiff, deadlineWindowDays),
          rangeLabel: item.daysDiff < 0 ? "Vencida" : item.daysDiff <= DEADLINE_WINDOW_SHORT_DAYS ? "Ate 15 dias" : "16 a 30 dias",
        };
      })
      .sort((left, right) => {
        const priorityDiff = priorityByStatus[left.deadlineStatus] - priorityByStatus[right.deadlineStatus];
        if (priorityDiff !== 0) {
          return priorityDiff;
        }

        if (left.deadlineStatus === "TODAY") {
          return left.sob.localeCompare(right.sob);
        }

        if (left.deadlineStatus === "SOON") {
          if (left.daysDiff === right.daysDiff) {
            return left.sob.localeCompare(right.sob);
          }
          return left.daysDiff - right.daysDiff;
        }

        if (left.deadlineStatus === "OVERDUE") {
          if (left.daysDiff === right.daysDiff) {
            return left.sob.localeCompare(right.sob);
          }
          return right.daysDiff - left.daysDiff;
        }

        if (left.daysDiff === right.daysDiff) {
          return left.sob.localeCompare(right.sob);
        }

        return left.daysDiff - right.daysDiff;
      });
  }, [deadlineProjects, deadlineWindowDays]);

  const deadlineSobPages = useMemo(() => {
    const pages: Array<typeof deadlineSobCards> = [];
    for (let start = 0; start < deadlineSobCards.length; start += DEADLINE_CAROUSEL_PAGE_SIZE) {
      pages.push(deadlineSobCards.slice(start, start + DEADLINE_CAROUSEL_PAGE_SIZE));
    }
    return pages;
  }, [deadlineSobCards]);

  const totalDeadlineCarouselPages = Math.max(1, deadlineSobPages.length);
  const deadlineWindowHeading = deadlineViewMode === "15"
    ? "SOB com vencimento ate 15 dias"
    : "SOB com vencimento ate 30 dias";

  useEffect(() => {
    setPage(1);
  }, [activeFilters.municipality, activeFilters.projectId, activeFilters.status, activeFilters.teamId, schedules]);

  useEffect(() => {
    setDeadlineCarouselPage(0);
  }, [deadlineViewMode]);

  useEffect(() => {
    setDeadlineCarouselPage((current) => {
      if (!deadlineSobPages.length) {
        return 0;
      }

      const lastPage = deadlineSobPages.length - 1;
      if (current > lastPage) {
        return lastPage;
      }

      if (current < 0) {
        return 0;
      }

      return current;
    });
  }, [deadlineSobPages]);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }

    setForm((current) => {
      const validTeamIds = current.teamIds.filter((teamId) =>
        availableTeams.some((team) => team.id === teamId),
      );

      if (validTeamIds.length === current.teamIds.length) {
        return current;
      }

      return { ...current, teamIds: validTeamIds };
    });
  }, [availableTeams, selectedProject]);

  function updateFormField<Key extends keyof FormState>(field: Key, value: FormState[Key]) {
    if (field === "etapaNumber") {
      setIsEtapaManuallyEdited(Boolean(String(value).trim()));
    }

    if (field === "etapaUnica" || field === "etapaFinal") {
      const nextEtapaUnica = Boolean(value);
      if (nextEtapaUnica) {
        setIsEtapaManuallyEdited(false);
      }
    }

    setForm((current) => {
      if (field === "period") {
        const nextPeriod = value as PeriodMode;

        return {
          ...current,
          period: nextPeriod,
          endTime: nextPeriod === "partial" ? "12:00" : "17:00",
        };
      }

      if (field === "etapaUnica") {
        const nextEtapaUnica = Boolean(value);
        return {
          ...current,
          etapaUnica: nextEtapaUnica,
          etapaFinal: nextEtapaUnica ? false : current.etapaFinal,
          etapaNumber: nextEtapaUnica || current.etapaFinal ? "" : current.etapaNumber,
        };
      }

      if (field === "etapaFinal") {
        const nextEtapaFinal = Boolean(value);
        return {
          ...current,
          etapaFinal: nextEtapaFinal,
          etapaUnica: nextEtapaFinal ? false : current.etapaUnica,
          etapaNumber: nextEtapaFinal || current.etapaUnica ? "" : current.etapaNumber,
        };
      }

      return { ...current, [field]: value };
    });
    setInvalidFields((current) => {
      if (field === "etapaUnica" || field === "etapaFinal") {
        return current.filter((item) => item !== "etapaUnica" && item !== "etapaFinal" && item !== "etapaNumber");
      }

      return current.filter((item) => item !== String(field));
    });
  }

  function updateFilterField<Key extends keyof FilterState>(field: Key, value: FilterState[Key]) {
    setFilterDraft((current) => ({ ...current, [field]: value }));
  }

  function handleFilterProjectSearchChange(value: string) {
    const searchValue = value;
    const matchedProject = projects.find((item) => item.code.toLowerCase() === searchValue.trim().toLowerCase()) ?? null;

    setFilterDraft((current) => ({
      ...current,
      projectSearch: searchValue,
      projectId: matchedProject?.id ?? "",
    }));
  }

  async function validateStageConflict(params: {
    projectId: string;
    teamIds: string[];
    etapaNumber: number;
    excludeProgrammingId?: string | null;
    currentEditingStage?: number | null;
    currentEditingDate?: string | null;
    currentEditingTeamId?: string | null;
  }) {
    if (!accessToken) {
      throw new Error("Sessao invalida para validar a etapa da programacao.");
    }

    return validateProgrammingStageConflict({
      accessToken,
      ...params,
    });
  }

  function handleProjectSobChange(value: string) {
    const searchValue = value;
    const matchedProject = projects.find((item) => item.code.toLowerCase() === searchValue.trim().toLowerCase()) ?? null;

    setForm((current) => ({
      ...current,
      projectSearch: searchValue,
      projectId: matchedProject?.id ?? "",
    }));
    setInvalidFields((current) => current.filter((item) => item !== "projectId"));
  }

  function toggleTeam(teamId: string) {
    if (editingScheduleId) {
      setForm((current) => ({ ...current, teamIds: [teamId] }));
      setInvalidFields((current) => current.filter((item) => item !== "teamIds"));
      return;
    }

    setForm((current) => ({
      ...current,
      teamIds: current.teamIds.includes(teamId)
        ? current.teamIds.filter((item) => item !== teamId)
        : [...current.teamIds, teamId],
    }));
    setInvalidFields((current) => current.filter((item) => item !== "teamIds"));
  }

  function selectAllVisibleTeams() {
    setForm((current) => ({
      ...current,
      teamIds: Array.from(new Set([...current.teamIds, ...visibleTeamOptions.map((team) => team.id)])),
    }));
    setInvalidFields((current) => current.filter((item) => item !== "teamIds"));
  }

  function clearSelectedTeams() {
    if (editingScheduleId) {
      return;
    }

    setForm((current) => ({ ...current, teamIds: [] }));
  }

  function isFieldInvalid(field: string) {
    return invalidFields.includes(field);
  }

  function updateDocument(documentKey: DocumentKey, field: keyof DocumentEntry, value: string) {
    setForm((current) => ({
      ...current,
      documents: {
        ...current.documents,
        [documentKey]: {
          ...current.documents[documentKey],
          [field]: value,
        },
      },
    }));
  }

  function addActivity() {
    const selectedActivity = findActivityOption(form.activitySearch, activityOptions);
    const quantity = Number(form.activityQuantity);

    if (!selectedActivity || !Number.isFinite(quantity) || quantity <= 0) {
      setFeedback({
        type: "error",
        message: "Selecione uma atividade valida e informe uma quantidade maior que zero.",
      });
      return;
    }

    setForm((current) => {
      const existingIndex = current.activities.findIndex((item) => item.catalogId === selectedActivity.id);
      const nextActivities = [...current.activities];

      if (existingIndex >= 0) {
        nextActivities[existingIndex] = { ...nextActivities[existingIndex], quantity };
      } else {
        nextActivities.push({
          catalogId: selectedActivity.id,
          code: selectedActivity.code,
          description: selectedActivity.description,
          quantity,
          unit: selectedActivity.unit,
        });
      }

      return {
        ...current,
        activities: nextActivities,
        activitySearch: "",
        activityQuantity: "1",
      };
    });

    setFeedback(null);
  }

  function updateActivityQuantity(index: number, value: string) {
    const quantity = Number(value);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return;
    }

    setForm((current) => {
      const next = [...current.activities];
      if (!next[index]) {
        return current;
      }

      next[index] = { ...next[index], quantity };
      return { ...current, activities: next };
    });
  }

  function removeActivity(index: number) {
    setForm((current) => ({
      ...current,
      activities: current.activities.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  function startEditSchedule(schedule: ScheduleItem) {
    if (!isActiveProgrammingStatus(getDisplayProgrammingStatus(schedule))) {
      setFeedback({
        type: "error",
        message: "Somente programacoes ativas podem entrar em edicao.",
      });
      return;
    }

    if (schedule.activitiesLoaded === false) {
      setFeedback({
        type: "error",
        message: "Nao foi possivel carregar as atividades desta programacao. Recarregue a tela antes de editar.",
      });
      openAlertModal(
        "Edicao bloqueada por seguranca",
        "As atividades da programacao nao foram carregadas. Recarregue a tela para evitar sobrescrever dados.",
      );
      return;
    }

    setEditingScheduleId(schedule.id);
    setEditingTeamId(schedule.teamId);
    setEditingExpectedUpdatedAt(schedule.updatedAt);
    setEditChangeReasonCode("");
    setEditChangeReasonNotes("");
    setIsEtapaManuallyEdited(true);
    setForm((current) => ({
      ...current,
      projectId: schedule.projectId,
      projectSearch: projectMap.get(schedule.projectId)?.code ?? "",
      date: schedule.date,
      period: schedule.period,
      startTime: schedule.startTime,
      endTime: schedule.endTime || (schedule.period === "partial" ? "12:00" : "17:00"),
      outageStartTime: schedule.outageStartTime ?? "",
      outageEndTime: schedule.outageEndTime ?? "",
      feeder: schedule.feeder ?? "",
      supportItemId: schedule.supportItemId ?? "",
      note: schedule.note ?? "",
      electricalField: schedule.electricalField ?? "",
      serviceDescription: schedule.serviceDescription ?? "",
      posteQty: String(schedule.posteQty ?? 0),
      estruturaQty: String(schedule.estruturaQty ?? 0),
      trafoQty: String(schedule.trafoQty ?? 0),
      redeQty: String(schedule.redeQty ?? 0),
      etapaNumber: schedule.etapaNumber === null ? "" : String(schedule.etapaNumber),
      etapaUnica: Boolean(schedule.etapaUnica),
      etapaFinal: Boolean(schedule.etapaFinal),
      workCompletionStatus: schedule.workCompletionStatus ?? "",
      affectedCustomers: String(schedule.affectedCustomers ?? 0),
      sgdTypeId: schedule.sgdTypeId ?? "",
      electricalEqCatalogId: schedule.electricalEqCatalogId ?? "",
      teamIds: [schedule.teamId],
      activities: schedule.activities ?? [],
      documents: {
        sgd: {
          number: schedule.documents?.sgd?.number ?? "",
          approvedAt: schedule.documents?.sgd?.approvedAt ?? schedule.documents?.sgd?.includedAt ?? "",
          requestedAt: schedule.documents?.sgd?.requestedAt ?? schedule.documents?.sgd?.deliveredAt ?? "",
        },
        pi: {
          number: schedule.documents?.pi?.number ?? "",
          approvedAt: schedule.documents?.pi?.approvedAt ?? schedule.documents?.pi?.includedAt ?? "",
          requestedAt: schedule.documents?.pi?.requestedAt ?? schedule.documents?.pi?.deliveredAt ?? "",
        },
        pep: {
          number: schedule.documents?.pep?.number ?? "",
          approvedAt: schedule.documents?.pep?.approvedAt ?? schedule.documents?.pep?.includedAt ?? "",
          requestedAt: schedule.documents?.pep?.requestedAt ?? schedule.documents?.pep?.deliveredAt ?? "",
        },
      },
    }));
    requestAnimationFrame(() => {
      formCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    setFeedback(null);
  }

  function cancelEditMode() {
    setEditingScheduleId(null);
    setEditingTeamId(null);
    setEditingExpectedUpdatedAt(null);
    setEditChangeReasonCode("");
    setEditChangeReasonNotes("");
    setIsEtapaManuallyEdited(false);
    setForm(createInitialForm(today));
    setFeedback(null);
    setInvalidFields([]);
  }

  function scrollToTopOfScreen() {
    requestAnimationFrame(() => {
      if (feedbackRef.current) {
        const top = feedbackRef.current.getBoundingClientRect().top + window.scrollY - 20;
        window.scrollTo({ top: Math.max(top, 0), behavior: "smooth" });
        return;
      }

      if (!isVisualizationMode) {
        formCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  function openAlertModal(title: string, message: string, details?: string[]) {
    setAlertModal({
      title,
      message,
      details: details?.filter(Boolean),
    });
  }

  function closeAlertModal() {
    setAlertModal(null);
  }

  function openCancelModal(schedule: ScheduleItem) {
    if (!isActiveProgrammingStatus(getDisplayProgrammingStatus(schedule))) {
      setFeedback({
        type: "error",
        message: "Somente programacoes ativas podem ser canceladas.",
      });
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
    setFeedback(null);
  }

  function openPostponeModal(schedule: ScheduleItem) {
    if (!isActiveProgrammingStatus(getDisplayProgrammingStatus(schedule))) {
      setFeedback({
        type: "error",
        message: "Somente programacoes ativas podem ser adiadas.",
      });
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
    setPostponeDate(schedule.date);
    setFeedback(null);
  }

  function closeCancelModal() {
    setCancelTarget(null);
    setCancelReasonCode("");
    setCancelReasonNotes("");
  }

  function closePostponeModal() {
    if (isPostponing) {
      return;
    }

    setPostponeTarget(null);
    setPostponeReasonCode("");
    setPostponeReasonNotes("");
    setPostponeDate("");
  }

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
      const data = await fetchProgrammingHistory({
        accessToken,
        programmingId: schedule.id,
      });

      const normalizedHistory = normalizeHistoryItemsForDisplay(data.history ?? []);

      setHistoryItems(normalizedHistory);
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Falha ao carregar historico da programacao.",
      });
      await logError("Falha ao carregar historico da programacao.", error, {
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

  async function confirmCancellation() {
    if (!accessToken || !cancelTarget) {
      return;
    }

    const selectedReasonText = buildReasonText(reasonOptions, cancelReasonCode, cancelReasonNotes);
    if (!selectedReasonText) {
      return;
    }

    setIsCancelling(true);

    try {
      const { ok, data } = await cancelProgramming({
        accessToken,
        id: cancelTarget.id,
        reason: selectedReasonText,
        expectedUpdatedAt: cancelTarget.updatedAt,
      });

      if (!ok) {
        const message = buildConflictFeedbackMessage(data, "Falha ao cancelar programacao.");
        setFeedback({ type: "error", message });
        openAlertModal(
          data.error === "conflict" ? "Conflito ao validar cancelamento" : "Falha ao validar cancelamento",
          message,
          buildConflictAlertDetails(data),
        );
        await logError("Falha ao cancelar programacao.", undefined, {
          operation: "cancel_programming",
          programmingId: cancelTarget.id,
          projectId: cancelTarget.projectId,
          teamId: cancelTarget.teamId,
          status: cancelTarget.status,
          expectedUpdatedAt: cancelTarget.updatedAt,
          responseMessage: message,
          responseError: data.error ?? null,
        });
        return;
      }

      if (editingScheduleId === cancelTarget.id) {
        cancelEditMode();
      }

      closeCancelModal();
      setFeedback({
        type: "success",
        message: data.message ?? "Programacao cancelada com sucesso.",
      });
      try {
        const boardData = await fetchBoardSnapshot();
        if (boardData) {
          applyBoardSnapshot(boardData);
        }
      } catch (refreshError) {
        await logError("Programacao cancelada, mas houve falha ao atualizar a visualizacao.", refreshError, {
          operation: "refresh_after_cancel",
          programmingId: cancelTarget.id,
          projectId: cancelTarget.projectId,
          teamId: cancelTarget.teamId,
        });
        if (!data.warning) {
          setFeedback({
            type: "success",
            message: `${data.message ?? "Programacao cancelada com sucesso."} Programacao salva com sucesso, mas houve falha ao atualizar a visualizacao.`,
          });
        }
      }
    } catch (error) {
      setFeedback({
        type: "error",
        message: "Falha ao cancelar programacao.",
      });
      await logError("Falha ao cancelar programacao.", error, {
        operation: "cancel_programming",
        programmingId: cancelTarget.id,
        projectId: cancelTarget.projectId,
        teamId: cancelTarget.teamId,
        status: cancelTarget.status,
        expectedUpdatedAt: cancelTarget.updatedAt,
      });
    } finally {
      setIsCancelling(false);
    }
  }

  async function confirmPostpone() {
    if (!accessToken || !postponeTarget) {
      openAlertModal("Falha ao validar adiamento", "Sessao invalida para validar o adiamento.");
      return;
    }

    if (!postponeDate) {
      openAlertModal(
        "Valide os dados do adiamento",
        "Informe a nova data da programacao antes de validar o adiamento.",
        ["A nova data precisa ser posterior a data atual da programacao."],
      );
      return;
    }

    if (postponeDate <= postponeTarget.date) {
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
    setAlertModal(null);

    try {
      const { ok, data } = await postponeProgramming({
        accessToken,
        id: postponeTarget.id,
        reason: selectedReasonText,
        newDate: postponeDate,
        expectedUpdatedAt: postponeTarget.updatedAt,
      });

      if (!ok) {
        const message = buildConflictFeedbackMessage(data, "Falha ao adiar programacao.");
        setFeedback({
          type: "error",
          message,
        });
        openAlertModal(
          data.error === "conflict" ? "Conflito ao validar adiamento" : "Falha ao validar adiamento",
          message,
          buildConflictAlertDetails(data),
        );
        await logError("Falha ao adiar programacao.", undefined, {
          operation: "postpone_programming",
          programmingId: postponeTarget.id,
          projectId: postponeTarget.projectId,
          teamId: postponeTarget.teamId,
          status: postponeTarget.status,
          expectedUpdatedAt: postponeTarget.updatedAt,
          newDate: postponeDate,
          responseMessage: message,
          responseError: data.error ?? null,
        });
        return;
      }

      if (editingScheduleId === postponeTarget.id) {
        cancelEditMode();
      }

      closePostponeModal();
      setFeedback({
        type: "success",
        message: data.message ?? "Programacao adiada com sucesso.",
      });
      try {
        const boardData = await fetchBoardSnapshot();
        if (boardData) {
          applyBoardSnapshot(boardData);
        }
      } catch (refreshError) {
        await logError("Programacao adiada, mas houve falha ao atualizar a visualizacao.", refreshError, {
          operation: "refresh_after_postpone",
          programmingId: postponeTarget.id,
          projectId: postponeTarget.projectId,
          teamId: postponeTarget.teamId,
          newDate: postponeDate,
        });
        if (!data.warning) {
          setFeedback({
            type: "success",
            message: `${data.message ?? "Programacao adiada com sucesso."} Programacao salva com sucesso, mas houve falha ao atualizar a visualizacao.`,
          });
        }
      }
    } catch (error) {
      setFeedback({
        type: "error",
        message: "Falha ao adiar programacao.",
      });
      openAlertModal("Falha ao validar adiamento", "Falha ao adiar programacao.");
      await logError("Falha ao adiar programacao.", error, {
        operation: "postpone_programming",
        programmingId: postponeTarget.id,
        projectId: postponeTarget.projectId,
        teamId: postponeTarget.teamId,
        status: postponeTarget.status,
        expectedUpdatedAt: postponeTarget.updatedAt,
        newDate: postponeDate,
      });
    } finally {
      setIsPostponing(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    function showSubmitFeedback(type: "success" | "error", message: string) {
      setFeedback({ type, message });
      scrollToTopOfScreen();
    }

    function flagInvalidFields(fields: string[], message: string) {
      setInvalidFields(Array.from(new Set(fields)));
      showSubmitFeedback("error", message);
      openAlertModal(
        "Revise os campos da programacao",
        message,
        buildFieldValidationDetails(fields),
      );
    }

    const initialAccessToken = await resolveLatestAccessToken();
    if (!initialAccessToken) {
      showSubmitFeedback("error", "Sessao invalida para salvar programacao.");
      return;
    }

    const electricalEqNumber = form.electricalField.toUpperCase().replace(/[^A-Z0-9]/g, "").trim();

    if (!form.projectId) {
      flagInvalidFields(["projectId"], "Selecione um Projeto (SOB) valido da lista.");
      return;
    }

    if (!form.teamIds.length) {
      flagInvalidFields(["teamIds"], "Selecione ao menos uma equipe para cadastrar a programacao.");
      return;
    }

    if (editingScheduleId && form.teamIds.length !== 1) {
      flagInvalidFields(["teamIds"], "Na edicao, selecione exatamente uma equipe.");
      return;
    }

    if (isInvalidTimeRange(form.startTime, form.endTime)) {
      flagInvalidFields(["startTime", "endTime"], "Hora termino deve ser maior que hora inicio.");
      return;
    }

    const expectedMinutes = calculateExpectedMinutes(form.startTime, form.endTime, form.period);
    if (expectedMinutes <= 0) {
      flagInvalidFields(["startTime", "endTime"], "Hora termino deve ser maior que hora inicio.");
      return;
    }

    if ((form.outageStartTime && !form.outageEndTime) || (!form.outageStartTime && form.outageEndTime)) {
      flagInvalidFields(["outageStartTime", "outageEndTime"], "Informe inicio e termino de desligamento.");
      return;
    }

    if (form.outageStartTime && form.outageEndTime && form.outageEndTime <= form.outageStartTime) {
      flagInvalidFields(["outageStartTime", "outageEndTime"], "Termino de desligamento deve ser maior que inicio.");
      return;
    }

    const invalidDocumentLabel = getDocumentRequestedAfterApprovedLabel(form.documents);
    if (invalidDocumentLabel) {
      showSubmitFeedback("error", `Data pedido do ${invalidDocumentLabel} nao pode ser maior que a data aprovada.`);
      openAlertModal(
        "Conflito nas datas dos documentos",
        `Data pedido do ${invalidDocumentLabel} nao pode ser maior que a data aprovada.`,
      );
      return;
    }

    if (isNegativeNumericText(form.feeder)) {
      flagInvalidFields(["feeder"], "Alimentador nao pode receber valor negativo.");
      return;
    }

    if (!form.sgdTypeId) {
      flagInvalidFields(["sgdTypeId"], "Tipo de SGD e obrigatorio para salvar a programacao.");
      return;
    }

    if (!electricalEqNumber) {
      flagInvalidFields(["electricalField"], "Informe o numero do Nº EQ (RE, CO, CF, CC ou TR).");
      return;
    }

    if (!/^[A-Z0-9]+$/.test(electricalEqNumber)) {
      flagInvalidFields(["electricalField"], "O numero do Nº EQ deve conter apenas letras e numeros.");
      return;
    }

    if (!form.electricalEqCatalogId) {
      flagInvalidFields(["electricalEqCatalogId"], "Selecione o tipo do Nº EQ (RE, CO, CF, CC ou TR).");
      return;
    }

    const posteQty = parseNonNegativeInteger(form.posteQty);
    const estruturaQty = parseNonNegativeInteger(form.estruturaQty);
    const trafoQty = parseNonNegativeInteger(form.trafoQty);
    const redeQty = parseNonNegativeInteger(form.redeQty);
    const etapaNumberInput = parseOptionalPositiveInteger(form.etapaNumber);
    const affectedCustomers = parseNonNegativeInteger(form.affectedCustomers);
    if (posteQty === null || estruturaQty === null || trafoQty === null || redeQty === null || affectedCustomers === null) {
      flagInvalidFields(
        ["posteQty", "estruturaQty", "trafoQty", "redeQty", "affectedCustomers"],
        "POSTE, ESTRUTURA, TRAFO, REDE e Nº Clientes Afetados devem ser numeros inteiros maiores ou iguais a zero.",
      );
      return;
    }

    if (!form.etapaUnica && !form.etapaFinal && etapaNumberInput === undefined) {
      flagInvalidFields(["etapaNumber"], "ETAPA deve ser um numero inteiro maior que zero.");
      return;
    }

    const etapaNumber = form.etapaUnica || form.etapaFinal
      ? null
      : (etapaNumberInput ?? (isEditing ? (currentEditingSchedule?.etapaNumber ?? null) : null));

    if (!isEditing && !form.etapaUnica && !form.etapaFinal && etapaNumber === null) {
      flagInvalidFields(["etapaNumber"], "ETAPA e obrigatoria no cadastro.");
      return;
    }

    const shouldValidateStageConflict = !form.etapaUnica
      && !form.etapaFinal
      && etapaNumber !== null
      && (
        !isEditing
        || etapaNumber !== (currentEditingSchedule?.etapaNumber ?? null)
      );

    if (shouldValidateStageConflict && etapaNumber !== null) {
      const localStageConflict = buildLocalStageConflictSummary({
        schedules,
        teams,
        projectId: form.projectId,
        teamIds: form.teamIds,
        enteredEtapaNumber: etapaNumber,
        excludeProgrammingId: editingScheduleId,
        currentEditingStage: currentEditingSchedule?.etapaNumber ?? null,
        currentEditingDate: currentEditingSchedule?.date ?? null,
        currentEditingTeamId: currentEditingSchedule?.teamId ?? null,
      });

      if (localStageConflict) {
        setStageConflictModal(localStageConflict);
        flagInvalidFields(["etapaNumber"], "A ETAPA informada conflita com o historico existente da equipe.");
        showSubmitFeedback(
          "error",
          "A ETAPA informada ja existe ou esta abaixo do historico encontrado para este projeto nas equipes selecionadas.",
        );
        return;
      }

      try {
        const stageConflict = await validateStageConflict({
          projectId: form.projectId,
          teamIds: form.teamIds,
          etapaNumber,
          excludeProgrammingId: editingScheduleId,
          currentEditingStage: currentEditingSchedule?.etapaNumber ?? null,
          currentEditingDate: currentEditingSchedule?.date ?? null,
          currentEditingTeamId: currentEditingSchedule?.teamId ?? null,
        });

        if (stageConflict) {
          setStageConflictModal(stageConflict);
          flagInvalidFields(["etapaNumber"], "A ETAPA informada conflita com o historico existente da equipe.");
          showSubmitFeedback(
            "error",
            "A ETAPA informada ja existe ou esta abaixo do historico encontrado para este projeto nas equipes selecionadas.",
          );
          return;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha ao validar a etapa da programacao.";
        showSubmitFeedback(
          "error",
          message,
        );
        openAlertModal("Falha ao validar ETAPA", message);
        await logError("Falha ao validar ETAPA da programacao.", error, {
          operation: "validate_stage_conflict",
          ...safeFormLogContext(),
          etapaNumber,
          excludeProgrammingId: editingScheduleId,
        });
        return;
      }
    }

    const hasRescheduleChanges = Boolean(
      isEditing
      && currentEditingSchedule
      && (
        currentEditingSchedule.projectId !== form.projectId
        || currentEditingSchedule.teamId !== form.teamIds[0]
        || currentEditingSchedule.date !== form.date
        || currentEditingSchedule.startTime !== form.startTime
        || currentEditingSchedule.endTime !== form.endTime
        || currentEditingSchedule.period !== form.period
      )
    );
    const selectedRescheduleReason = buildReasonText(
      reasonOptions,
      editChangeReasonCode,
      editChangeReasonNotes,
    );
    if (hasRescheduleChanges && !selectedRescheduleReason) {
      flagInvalidFields(
        ["changeReason"],
        "Selecione o motivo da reprogramacao. Quando o motivo exigir observacao, preencha o campo complementar.",
      );
      return;
    }

    const operationLogContext = safeFormLogContext();

    setIsSaving(true);
    setFeedback(null);
    setAlertModal(null);
    setInvalidFields([]);

    try {
      const basePayload = {
        projectId: form.projectId,
        date: form.date,
        period: form.period,
        startTime: form.startTime,
        endTime: form.endTime,
        outageStartTime: form.outageStartTime || undefined,
        outageEndTime: form.outageEndTime || undefined,
        expectedMinutes,
        feeder: form.feeder.trim(),
        support: !form.supportItemId && isEditing ? (currentEditingSchedule?.support || undefined) : undefined,
        supportItemId: form.supportItemId || undefined,
        note: form.note.trim(),
        electricalField: electricalEqNumber,
        serviceDescription: form.serviceDescription.trim(),
        posteQty,
        estruturaQty,
        trafoQty,
        redeQty,
        etapaNumber: etapaNumber ?? undefined,
        etapaUnica: form.etapaUnica,
        etapaFinal: form.etapaFinal,
        workCompletionStatus: isEditing ? form.workCompletionStatus : undefined,
        affectedCustomers,
        sgdTypeId: form.sgdTypeId || undefined,
        electricalEqCatalogId: form.electricalEqCatalogId || undefined,
        documents: DOCUMENT_KEYS.reduce(
          (accumulator, item) => {
            const normalizedNumber = item.key === "sgd"
              ? normalizeSgdNumberForExport(form.documents[item.key].number)
              : form.documents[item.key].number.trim();
            accumulator[item.key] = {
              number: normalizedNumber,
              approvedAt: form.documents[item.key].approvedAt || undefined,
              requestedAt: form.documents[item.key].requestedAt || undefined,
            };
            return accumulator;
          },
          {} as Record<DocumentKey, { number: string; approvedAt?: string; requestedAt?: string }>,
        ),
        activities: (isEditing && currentEditingSchedule?.activitiesLoaded === false)
          ? undefined
          : form.activities
              .filter((item) => item.quantity > 0)
              .map((item) => ({ catalogId: item.catalogId, quantity: item.quantity })),
      };

      const requestBody = JSON.stringify(
        editingScheduleId
          ? {
              ...basePayload,
              id: editingScheduleId,
              teamId: form.teamIds[0],
              expectedUpdatedAt: editingExpectedUpdatedAt,
              changeReason: hasRescheduleChanges ? selectedRescheduleReason || undefined : undefined,
            }
          : {
              action: "BATCH_CREATE",
              ...basePayload,
              teamIds: form.teamIds,
            },
      );

      const executeSaveRequest = (token: string) => saveProgramming({
        accessToken: token,
        isEditing: Boolean(editingScheduleId),
        requestBody,
      });

      let saveResult = await executeSaveRequest(initialAccessToken);
      if (saveResult.status === 401) {
        const refreshedAccessToken = await resolveLatestAccessToken();
        if (refreshedAccessToken && refreshedAccessToken !== initialAccessToken) {
          saveResult = await executeSaveRequest(refreshedAccessToken);
        }
      }

      const { data } = saveResult;
      if (!saveResult.ok || (editingScheduleId ? !data.id : !data.success)) {
        const fallbackMessage = editingScheduleId ? "Falha ao editar programacao." : "Falha ao cadastrar programacao em lote.";
        const responseMessage = buildConflictFeedbackMessage(data, fallbackMessage);
        if (data.hasConflict && Array.isArray(data.teams) && data.teams.length) {
          setStageConflictModal({
            enteredEtapaNumber: Number(data.enteredEtapaNumber ?? etapaNumber),
            highestStage: Number(data.highestStage ?? 0),
            teams: data.teams,
          });
        }

        showSubmitFeedback(
          "error",
          responseMessage,
        );
        if (!(data.hasConflict && Array.isArray(data.teams) && data.teams.length)) {
          openAlertModal(
            data.error === "conflict"
              ? (editingScheduleId ? "Conflito ao salvar edicao" : "Conflito ao cadastrar programacao")
              : (editingScheduleId ? "Falha ao salvar edicao" : "Falha ao cadastrar programacao"),
            responseMessage,
            buildConflictAlertDetails(data),
          );
        }
        await logError(fallbackMessage, undefined, {
          operation: editingScheduleId ? "save_programming_edit" : "save_programming_batch",
          ...operationLogContext,
          responseStatus: saveResult.status,
          responseMessage,
          responseError: data.error ?? null,
          hasConflict: Boolean(data.hasConflict),
        });
        return;
      }

      const successMessage =
        data.message ?? (editingScheduleId ? "Programacao editada com sucesso." : "Programacao cadastrada com sucesso.");
      const savedStatus = data.schedule?.status ?? currentEditingSchedule?.status ?? "PROGRAMADA";
      const hiddenByFiltersWarning = buildSavedOutsideFiltersMessage({
        date: data.schedule?.date ?? form.date,
        status: savedStatus,
        projectId: data.schedule?.projectId ?? form.projectId,
        teamIds: data.schedule ? [data.schedule.teamId] : (editingScheduleId ? [form.teamIds[0]] : form.teamIds),
        workCompletionStatus: data.schedule?.workCompletionStatus ?? (form.workCompletionStatus || null),
        sgdTypeId: data.schedule?.sgdTypeId ?? (form.sgdTypeId || null),
        activeFilters,
        projectMap,
        teamMap,
        workCompletionCatalog,
        sgdTypes,
      });
      showSubmitFeedback(
        "success",
        hiddenByFiltersWarning ? `${successMessage} ${hiddenByFiltersWarning}` : successMessage,
      );
      setIsEtapaManuallyEdited(false);
      setEditingScheduleId(null);
      setEditingTeamId(null);
      setEditingExpectedUpdatedAt(null);
      setEditChangeReasonCode("");
      setEditChangeReasonNotes("");
      setForm(createInitialForm(today));
      try {
        const boardData = await fetchBoardSnapshot();
        if (boardData) {
          applyBoardSnapshot(boardData);
        }
      } catch (refreshError) {
        await logError("Programacao salva, mas houve falha ao atualizar a visualizacao.", refreshError, {
          operation: "refresh_after_save",
          ...operationLogContext,
          savedScheduleId: data.id ?? data.schedule?.id ?? null,
        });
        if (!data.warning) {
          showSubmitFeedback(
            "success",
            `${successMessage}${hiddenByFiltersWarning ? ` ${hiddenByFiltersWarning}` : ""} Programacao salva com sucesso, mas houve falha ao atualizar a visualizacao.`,
          );
        }
      }
    } catch (error) {
      const message = editingScheduleId ? "Falha ao editar programacao." : "Falha ao cadastrar programacao em lote.";
      showSubmitFeedback(
        "error",
        message,
      );
      openAlertModal(
        editingScheduleId ? "Falha ao salvar edicao" : "Falha ao cadastrar programacao",
        message,
      );
      await logError(message, error, {
        operation: editingScheduleId ? "save_programming_edit" : "save_programming_batch",
        ...operationLogContext,
      });
    } finally {
      setIsSaving(false);
    }
  }

  function applyFilters() {
    if (filterDraft.startDate > filterDraft.endDate) {
      setFeedback({
        type: "error",
        message: "A data inicial nao pode ser maior que a data final.",
      });
      return;
    }

    if (filterDraft.projectSearch.trim() && !filterDraft.projectId) {
      setFeedback({
        type: "error",
        message: "Selecione um Projeto valido da lista para filtrar.",
      });
      return;
    }

    setFeedback(null);
    setActiveFilters(filterDraft);
    setWeekStartDate(startOfWeekMonday(filterDraft.startDate));
  }

  function clearFilters() {
    const reset: FilterState = {
      startDate: currentYearDateRange.startDate,
      endDate: currentYearDateRange.endDate,
      projectSearch: "",
      projectId: "",
      municipality: "",
      teamId: "",
      status: "TODOS",
      workCompletionStatus: "TODOS",
      sgdTypeId: "",
    };
    setFilterDraft(reset);
    setActiveFilters(reset);
    setWeekStartDate(startOfWeekMonday(reset.startDate));
    setFeedback(null);
  }

  async function handleExportDeadlineModalCsv() {
    if (!deadlineSobCards.length) {
      setFeedback({
        type: "error",
        message: "Nenhum prazo encontrado para exportar na janela selecionada.",
      });
      return;
    }

    if (!deadlineModalExportCooldown.tryStart()) {
      setFeedback({
        type: "error",
        message: `Aguarde ${deadlineModalExportCooldown.getRemainingSeconds()}s antes de exportar novamente.`,
      });
      return;
    }

    setIsExportingDeadlineModal(true);
    try {
      const csv = buildDeadlineCsvContent({
        items: deadlineSobCards,
        deadlineWindowDays,
      });
      const exportDate = new Date().toISOString().slice(0, 10);
      downloadCsvFile(csv, `prazos_obras_${deadlineWindowDays}dias_${exportDate}.csv`);
    } catch (error) {
      setFeedback({
        type: "error",
        message: "Falha ao exportar prazos das obras.",
      });
      await logError("Falha ao exportar prazos das obras.", error, {
        operation: "export_deadline_csv",
        deadlineWindowDays,
        itemCount: deadlineSobCards.length,
      });
    } finally {
      setIsExportingDeadlineModal(false);
    }
  }

  async function handleExportCsv() {
    if (!filteredSchedules.length) {
      setFeedback({
        type: "error",
        message: "Nenhuma programacao encontrada para exportar com os filtros atuais.",
      });
      return;
    }

    if (!commonExportCooldown.tryStart()) {
      setFeedback({
        type: "error",
        message: `Aguarde ${commonExportCooldown.getRemainingSeconds()}s antes de exportar novamente.`,
      });
      return;
    }

    setIsExporting(true);
    try {
      const csv = buildProgrammingCsvContent({
        schedules: filteredSchedules,
        projectMap,
        teamMap,
      });
      const exportDate = new Date().toISOString().slice(0, 10);
      downloadCsvFile(csv, `programacao_simples_${exportDate}.csv`);
    } catch (error) {
      setFeedback({
        type: "error",
        message: "Falha ao exportar programacao em CSV.",
      });
      await logError("Falha ao exportar programacao em CSV.", error, {
        operation: "export_programming_csv",
        itemCount: filteredSchedules.length,
        startDate: activeFilters.startDate,
        endDate: activeFilters.endDate,
      });
    } finally {
      setIsExporting(false);
    }
  }

  async function handleExportEnelExcel() {
    if (!filteredSchedules.length) {
      setFeedback({
        type: "error",
        message: "Nenhuma programacao encontrada para exportar no layout ENEL-EXCEL.",
      });
      return;
    }

    if (!enelExportCooldown.tryStart()) {
      setFeedback({
        type: "error",
        message: `Aguarde ${enelExportCooldown.getRemainingSeconds()}s antes de exportar novamente.`,
      });
      return;
    }

    setIsExportingEnel(true);
    try {
      const csv = buildEnelCsvContent({
        schedules: filteredSchedules,
        projectMap,
        teamMap,
      });
      const exportDate = new Date().toISOString().slice(0, 10);
      downloadCsvFile(csv, `programacao_enel_excel_${exportDate}.csv`);
    } catch (error) {
      setFeedback({
        type: "error",
        message: "Falha ao gerar extracao ENEL.",
      });
      await logError("Falha ao gerar extracao ENEL.", error, {
        operation: "export_enel_csv",
        itemCount: filteredSchedules.length,
        startDate: activeFilters.startDate,
        endDate: activeFilters.endDate,
      });
    } finally {
      setIsExportingEnel(false);
    }
  }

  async function handleExportEnelExcelNovo() {
    if (!filteredSchedules.length) {
      setFeedback({
        type: "error",
        message: "Nenhuma programacao encontrada para exportar no layout EXTRACAO ENEL NOVO.",
      });
      return;
    }

    if (!enelExportCooldown.tryStart()) {
      setFeedback({
        type: "error",
        message: `Aguarde ${enelExportCooldown.getRemainingSeconds()}s antes de exportar novamente.`,
      });
      return;
    }

    setIsExportingEnelNovo(true);
    try {
      const workbookData = buildEnelNovoWorkbookData({
        schedules: filteredSchedules,
        projectMap,
        teamMap,
      });

      if (!workbookData.eligibleCount) {
        setFeedback({
          type: "error",
          message: "Nenhuma programacao elegivel para EXTRACAO ENEL NOVO (Tipo de Serviço EMERGENCIAL nao entra).",
        });
        return;
      }

      const XLSX = await import("xlsx");
      const worksheet = XLSX.utils.aoa_to_sheet([workbookData.header, ...workbookData.rows]);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "EXTRACAO_ENEL");
      const workbookArray = XLSX.write(workbook, {
        bookType: "xlsb",
        type: "array",
      }) as ArrayBuffer;
      const blob = new Blob([workbookArray], {
        type: "application/vnd.ms-excel.sheet.binary.macroEnabled.12",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "PROGRAMAÇÃO_ANGRA_INDICA.xlsb";
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setFeedback({
        type: "error",
        message: "Falha ao gerar EXTRACAO ENEL NOVO.",
      });
      await logError("Falha ao gerar EXTRACAO ENEL NOVO.", error, {
        operation: "export_enel_novo_xlsb",
        itemCount: filteredSchedules.length,
        startDate: activeFilters.startDate,
        endDate: activeFilters.endDate,
      });
    } finally {
      setIsExportingEnelNovo(false);
    }
  }

  return (
    <section className={styles.wrapper}>
      {feedback ? (
        <div
          ref={feedbackRef}
          className={feedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError}
        >
          {feedback.message}
        </div>
      ) : null}

      {!isVisualizationMode ? (
        <>
          <ProgrammingDeadlinePanel
            summary={deadlineSummary}
            windowHeading={deadlineWindowHeading}
            viewMode={deadlineViewMode}
            windowDays={deadlineWindowDays}
            pages={deadlineSobPages}
            carouselPage={deadlineCarouselPage}
            totalPages={totalDeadlineCarouselPages}
            onViewModeChange={setDeadlineViewMode}
            onOpenModal={() => setIsDeadlineModalOpen(true)}
            onPreviousPage={() => setDeadlineCarouselPage((current) => Math.max(0, current - 1))}
            onNextPage={() =>
              setDeadlineCarouselPage((current) => Math.min(totalDeadlineCarouselPages - 1, current + 1))
            }
          />

          <article ref={formCardRef} className={`${styles.card} ${isEditing ? styles.editingCard : ""}`}>
            <h3 className={styles.cardTitle}>{isEditing ? "Edicao de Programacao" : "Cadastro de Programacao"}</h3>

        <form className={styles.formGrid} onSubmit={handleSubmit}>
          <label className={`${styles.field} ${isFieldInvalid("projectId") ? styles.fieldInvalid : ""}`}>
            <span>
              Projeto (SOB) <span className="requiredMark">*</span>
            </span>
            <input
              list="programming-simple-project-list"
              value={form.projectSearch}
              onChange={(event) => handleProjectSobChange(event.target.value)}
              placeholder="Digite o SOB do projeto"
              required
            />
            <datalist id="programming-simple-project-list">
              {projects.map((project) => (
                <option key={project.id} value={project.code}>
                  {project.city} | {project.base}
                </option>
              ))}
            </datalist>
          </label>

          <label className={styles.field}>
            <span>
              Data execucao <span className="requiredMark">*</span>
            </span>
            <input type="date" value={form.date} onChange={(event) => updateFormField("date", event.target.value)} required />
          </label>

          <label className={styles.field}>
            <span>
              Periodo <span className="requiredMark">*</span>
            </span>
            <select
              value={form.period}
              onChange={(event) => updateFormField("period", event.target.value as PeriodMode)}
            >
              <option value="integral">Integral</option>
              <option value="partial">Parcial</option>
            </select>
          </label>

          <label className={`${styles.field} ${isFieldInvalid("startTime") ? styles.fieldInvalid : ""}`}>
            <span>
              Hora inicio <span className="requiredMark">*</span>
            </span>
            <input
              type="time"
              value={form.startTime}
              onChange={(event) => updateFormField("startTime", event.target.value)}
              required
            />
          </label>

          <label className={`${styles.field} ${isFieldInvalid("endTime") ? styles.fieldInvalid : ""}`}>
            <span>
              Hora termino <span className="requiredMark">*</span>
            </span>
            <input
              type="time"
              value={form.endTime}
              onChange={(event) => updateFormField("endTime", event.target.value)}
              required
            />
          </label>

          <label className={`${styles.field} ${isFieldInvalid("outageStartTime") ? styles.fieldInvalid : ""}`}>
            <span>Inicio de desligamento</span>
            <input
              type="time"
              value={form.outageStartTime}
              onChange={(event) => updateFormField("outageStartTime", event.target.value)}
            />
          </label>

          <label className={`${styles.field} ${isFieldInvalid("outageEndTime") ? styles.fieldInvalid : ""}`}>
            <span>Termino de desligamento</span>
            <input
              type="time"
              value={form.outageEndTime}
              onChange={(event) => updateFormField("outageEndTime", event.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span>Apoio</span>
            <select
              value={form.supportItemId}
              onChange={(event) => updateFormField("supportItemId", event.target.value)}
            >
              <option value="">Selecione</option>
              {supportOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.description}
                </option>
              ))}
            </select>
          </label>

          <label className={`${styles.field} ${isFieldInvalid("feeder") ? styles.fieldInvalid : ""}`}>
            <span>Alimentador</span>
            <input
              type="text"
              value={form.feeder}
              onChange={(event) => updateFormField("feeder", event.target.value)}
              placeholder="Ex.: AL-09"
            />
          </label>

          <label className={`${styles.field} ${isFieldInvalid("electricalField") ? styles.fieldInvalid : ""}`}>
            <span>
              Nº EQ - Numero <span className="requiredMark">*</span>
            </span>
            <input
              type="text"
              inputMode="text"
              pattern="[A-Za-z0-9]*"
              value={form.electricalField}
              onChange={(event) => updateFormField("electricalField", event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              placeholder="Ex.: AB1234"
            />
          </label>

          <label className={`${styles.field} ${isFieldInvalid("posteQty") ? styles.fieldInvalid : ""}`}>
            <span>POSTE (quantidade)</span>
            <input
              type="number"
              min="0"
              step="1"
              value={form.posteQty}
              onChange={(event) => updateFormField("posteQty", event.target.value)}
            />
          </label>

          <label className={`${styles.field} ${isFieldInvalid("estruturaQty") ? styles.fieldInvalid : ""}`}>
            <span>ESTRUTURA (quantidade)</span>
            <input
              type="number"
              min="0"
              step="1"
              value={form.estruturaQty}
              onChange={(event) => updateFormField("estruturaQty", event.target.value)}
            />
          </label>

          <label className={`${styles.field} ${isFieldInvalid("trafoQty") ? styles.fieldInvalid : ""}`}>
            <span>TRAFO (quantidade)</span>
            <input
              type="number"
              min="0"
              step="1"
              value={form.trafoQty}
              onChange={(event) => updateFormField("trafoQty", event.target.value)}
            />
          </label>

          <label className={`${styles.field} ${isFieldInvalid("redeQty") ? styles.fieldInvalid : ""}`}>
            <span>REDE (quantidade)</span>
            <input
              type="number"
              min="0"
              step="1"
              value={form.redeQty}
              onChange={(event) => updateFormField("redeQty", event.target.value)}
            />
          </label>

          <label className={`${styles.field} ${isFieldInvalid("etapaNumber") ? styles.fieldInvalid : ""}`}>
            <div className={styles.inlineFieldHeader}>
              <span>
                ETAPA {form.etapaUnica || form.etapaFinal ? null : <span className="requiredMark">*</span>}
              </span>
              <div className={styles.inlineCheckboxGroup}>
                <label className={styles.inlineCheckbox}>
                  <input
                    type="checkbox"
                    checked={form.etapaUnica}
                    onChange={(event) => updateFormField("etapaUnica", event.target.checked)}
                  />
                  ETAPA ÚNICA
                </label>
                <label className={styles.inlineCheckbox}>
                  <input
                    type="checkbox"
                    checked={form.etapaFinal}
                    onChange={(event) => updateFormField("etapaFinal", event.target.checked)}
                  />
                  ETAPA FINAL
                </label>
              </div>
            </div>
            <input
              type="number"
              min="1"
              step="1"
              value={form.etapaNumber}
              onChange={(event) => updateFormField("etapaNumber", event.target.value)}
              disabled={form.etapaUnica || form.etapaFinal}
              placeholder="Ex.: 1"
            />
            <small className={styles.fieldHint}>
              {form.etapaUnica
                ? "Com ETAPA ÚNICA marcada, a coluna INFO STATUS na extracao ENEL usa o texto ETAPA ÚNICA."
                : form.etapaFinal
                  ? "Com ETAPA FINAL marcada, a coluna INFO STATUS na extracao ENEL usa o texto ETAPA FINAL."
                : "A etapa e sugerida automaticamente com base nas programacoes anteriores do mesmo projeto para as equipes selecionadas. Na edicao, se nao alterar esse campo, o valor atual e preservado. ETAPA ÚNICA e ETAPA FINAL sao opcoes excludentes."}
            </small>
          </label>

          <label className={`${styles.field} ${isFieldInvalid("affectedCustomers") ? styles.fieldInvalid : ""}`}>
            <span>Nº Clientes Afetados</span>
            <input
              type="number"
              min="0"
              step="1"
              value={form.affectedCustomers}
              onChange={(event) => updateFormField("affectedCustomers", event.target.value)}
            />
          </label>

          <label className={`${styles.field} ${isFieldInvalid("sgdTypeId") ? styles.fieldInvalid : ""}`}>
            <span>
              Tipo de SGD <span className="requiredMark">*</span>
            </span>
            <select
              value={form.sgdTypeId}
              onChange={(event) => updateFormField("sgdTypeId", event.target.value)}
              required
            >
              <option value="">Selecione</option>
              {sgdTypes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.description}
                </option>
              ))}
            </select>
          </label>

          <label className={`${styles.field} ${isFieldInvalid("electricalEqCatalogId") ? styles.fieldInvalid : ""}`}>
            <span>
              Nº EQ - Tipo (RE, CO, CF, CC ou TR) <span className="requiredMark">*</span>
            </span>
            <select
              value={form.electricalEqCatalogId}
              onChange={(event) => updateFormField("electricalEqCatalogId", event.target.value)}
              required
            >
              <option value="">Selecione</option>
              {electricalEqCatalog.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Descricao do servico</span>
            <input
              type="text"
              value={form.serviceDescription}
              onChange={(event) => updateFormField("serviceDescription", event.target.value)}
              placeholder="Descricao operacional do servico para esta programacao."
            />
          </label>

          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Anotacao</span>
            <textarea
              value={form.note}
              onChange={(event) => updateFormField("note", event.target.value)}
              rows={4}
              placeholder="Observacoes operacionais para todas as equipes selecionadas."
            />
          </label>

          {editingScheduleId ? (
            <label className={`${styles.field} ${isFieldInvalid("workCompletionStatus") ? styles.fieldInvalid : ""}`}>
              <span>Estado do Projeto</span>
              <select
                value={form.workCompletionStatus}
                onChange={(event) => updateFormField("workCompletionStatus", event.target.value as WorkCompletionStatus | "")}
              >
                <option value="">Selecione</option>
                {workCompletionCatalog.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {editingScheduleId ? (
            <label className={`${styles.field} ${styles.fieldWide} ${isFieldInvalid("changeReason") ? styles.fieldInvalid : ""}`}>
              <span>Motivo da reprogramacao (obrigatorio se alterar projeto, equipe, data, horario ou periodo)</span>
              <select
                value={editChangeReasonCode}
                onChange={(event) => setEditChangeReasonCode(event.target.value)}
                disabled={!reasonOptions.length}
              >
                <option value="">Selecione</option>
                {reasonOptions.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.label}
                  </option>
                ))}
              </select>
              {!reasonOptions.length ? (
                <small className={styles.helperText}>
                  Catalogo de motivos indisponivel. Aplique a migration 135 para habilitar a selecao.
                </small>
              ) : null}
              {resolveReasonOption(reasonOptions, editChangeReasonCode)?.requiresNotes ? (
                <textarea
                  value={editChangeReasonNotes}
                  onChange={(event) => setEditChangeReasonNotes(event.target.value)}
                  rows={3}
                  placeholder="Descreva a observacao complementar do motivo."
                />
              ) : null}
            </label>
          ) : null}

          <section className={`${styles.formSection} ${styles.fieldWide}`}>
            <div className={styles.sectionHeader}>
              <h4>
                Equipes <span className="requiredMark">*</span>
              </h4>
              <p>Selecione uma ou mais equipes para receber a programacao do formulario.</p>
            </div>
            <div className={`${styles.teamSelectionCard} ${isFieldInvalid("teamIds") ? styles.teamSelectionCardInvalid : ""}`}>
              <div className={styles.teamSelectionHeader}>
                <input
                  type="text"
                  value={form.teamSearch}
                  onChange={(event) => updateFormField("teamSearch", event.target.value)}
                  placeholder="Buscar equipe..."
                />
                <div className={styles.actions}>
                  <button type="button" className={styles.ghostButton} onClick={selectAllVisibleTeams} disabled={Boolean(editingScheduleId)}>
                    Marcar visiveis
                  </button>
                  <button type="button" className={styles.ghostButton} onClick={clearSelectedTeams} disabled={Boolean(editingScheduleId)}>
                    Limpar
                  </button>
                </div>
              </div>

              {editingScheduleId ? (
                <p className={styles.helperText}>
                  Modo edicao ativo: voce pode trocar a equipe da programacao, mantendo apenas 1 equipe selecionada.
                </p>
              ) : selectedProject ? (
                <p className={styles.helperText}>
                  Base do projeto selecionado: <strong>{selectedProject.base}</strong>. Somente equipes dessa base sao exibidas.
                </p>
              ) : (
                <p className={styles.helperText}>Selecione um projeto para limitar as equipes pela base.</p>
              )}
              {hasEditingTeamChanged ? (
                <div className={styles.warningCard}>
                  <p>
                    Reprogramacao com troca de equipe detectada.
                  </p>
                  <p>
                    Equipe original: <strong>{originalEditingTeamName}</strong> | Nova equipe: <strong>{selectedEditingTeamName}</strong>
                  </p>
                  <p>
                    Para salvar, mantenha o motivo de reprogramacao preenchido.
                  </p>
                </div>
              ) : null}

              <div className={styles.teamList}>
                {visibleTeamOptions.length ? (
                  visibleTeamOptions.map((team) => (
                    <label key={team.id} className={styles.teamOption}>
                      <input
                        type="checkbox"
                        checked={form.teamIds.includes(team.id)}
                        onChange={() => toggleTeam(team.id)}
                      />
                      <div className={styles.teamOptionMeta}>
                        <strong>{team.name}</strong>
                        <small>{team.serviceCenterName}</small>
                        <small>Encarregado: {team.foremanName || "Sem encarregado"}</small>
                      </div>
                    </label>
                  ))
                ) : (
                  <p className={styles.emptyHint}>Nenhuma equipe disponivel para o filtro atual.</p>
                )}
              </div>
            </div>
          </section>

          <section className={`${styles.formSection} ${styles.fieldWide}`}>
            <div className={styles.sectionHeader}>
              <h4>Atividades</h4>
              <p>Inclua o codigo e a quantidade das atividades previstas para a programacao.</p>
            </div>
            <div className={styles.activityComposer}>
              <label className={styles.field}>
                <span>Codigo da atividade</span>
                <input
                  list="programming-simple-activity-list"
                  value={form.activitySearch}
                  onChange={(event) => updateFormField("activitySearch", event.target.value)}
                  placeholder={isLoadingActivities ? "Buscando atividades..." : "Digite codigo e selecione"}
                />
              </label>
              <label className={styles.field}>
                <span>Quantidade</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.activityQuantity}
                  onChange={(event) => updateFormField("activityQuantity", event.target.value)}
                />
              </label>
              <button type="button" className={styles.secondaryButton} onClick={addActivity}>
                Incluir atividade
              </button>
            </div>

            <div className={styles.activitiesList}>
              {form.activities.length ? (
                form.activities.map((item, index) => (
                  <div key={item.catalogId} className={styles.activityRow}>
                    <div>
                      <strong>{item.code}</strong>
                      <small>{item.description}</small>
                    </div>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={item.quantity}
                      onChange={(event) => updateActivityQuantity(index, event.target.value)}
                    />
                    <span>{item.unit}</span>
                    <button type="button" className={styles.ghostButton} onClick={() => removeActivity(index)}>
                      Remover
                    </button>
                  </div>
                ))
              ) : (
                <p className={styles.emptyHint}>Nenhuma atividade incluida.</p>
              )}
            </div>
          </section>

          <section className={`${styles.formSection} ${styles.fieldWide}`}>
            <div className={styles.sectionHeader}>
              <h4>Documentos</h4>
              <p>Preencha os dados dos documentos quando existirem para a programacao.</p>
            </div>
            <div className={styles.documentsGrid}>
              {DOCUMENT_KEYS.map((item) => (
                <div key={item.key} className={styles.documentCard}>
                  <label className={styles.field}>
                    <span>{item.label}</span>
                    <input
                      value={form.documents[item.key].number}
                      onChange={(event) => updateDocument(item.key, "number", event.target.value)}
                      placeholder={`Numero ${item.label}`}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Data aprovada</span>
                    <input
                      type="date"
                      value={form.documents[item.key].approvedAt}
                      onChange={(event) => updateDocument(item.key, "approvedAt", event.target.value)}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Data pedido</span>
                    <input
                      type="date"
                      value={form.documents[item.key].requestedAt}
                      onChange={(event) => updateDocument(item.key, "requestedAt", event.target.value)}
                    />
                  </label>
                </div>
              ))}
            </div>
          </section>

          <div className={`${styles.actions} ${styles.formActions} ${styles.formActionsInline}`}>
            <button
              type="submit"
              className={styles.primaryButton}
              disabled={
                isSaving
                || !form.projectId
                || !form.teamIds.length
                || (isEditing && form.teamIds.length !== 1)
                || !form.sgdTypeId
                || !form.electricalField.trim()
                || !form.electricalEqCatalogId
              }
            >
              {isSaving ? "Salvando..." : editingScheduleId ? "Salvar edicao" : "Cadastrar programacao"}
            </button>
            {editingScheduleId ? (
              <button type="button" className={styles.ghostButton} onClick={cancelEditMode} disabled={isSaving}>
                Cancelar edicao
              </button>
            ) : null}
          </div>
            </form>
          </article>
        </>
      ) : null}

      <article className={styles.card}>
        <h3 className={styles.cardTitle}>Filtros</h3>
        <div className={styles.filterGrid}>
          <label className={styles.field}>
            <span>Data inicial</span>
            <input
              type="date"
              value={filterDraft.startDate}
              onChange={(event) => updateFilterField("startDate", event.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>Data final</span>
            <input type="date" value={filterDraft.endDate} onChange={(event) => updateFilterField("endDate", event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Projeto</span>
            <input
              list="programming-simple-filter-project-list"
              value={filterDraft.projectSearch}
              onChange={(event) => handleFilterProjectSearchChange(event.target.value)}
              placeholder="Todos"
            />
            <datalist id="programming-simple-filter-project-list">
              {projects.map((project) => (
                <option key={project.id} value={project.code}>
                  {project.city} | {project.base}
                </option>
              ))}
            </datalist>
          </label>
          <label className={styles.field}>
            <span>Municipio</span>
            <select
              value={filterDraft.municipality}
              onChange={(event) => updateFilterField("municipality", event.target.value)}
            >
              <option value="">Todos</option>
              {municipalityOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Equipe</span>
            <select value={filterDraft.teamId} onChange={(event) => updateFilterField("teamId", event.target.value)}>
              <option value="">Todas</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Status</span>
            <select
              value={filterDraft.status}
              onChange={(event) => updateFilterField("status", event.target.value as FilterState["status"])}
            >
              <option value="TODOS">Todos</option>
              <option value="PROGRAMADA">Programada</option>
              <option value="REPROGRAMADA">Reprogramada</option>
              <option value="ADIADA">Adiada</option>
              <option value="CANCELADA">Cancelada</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Estado Trabalho</span>
            <select
              value={filterDraft.workCompletionStatus}
              onChange={(event) => updateFilterField("workCompletionStatus", event.target.value as FilterState["workCompletionStatus"])}
            >
              <option value="TODOS">Todos</option>
              {workCompletionCatalog.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
              <option value="NAO_INFORMADO">Nao informado</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Tipo SGD</span>
            <select value={filterDraft.sgdTypeId} onChange={(event) => updateFilterField("sgdTypeId", event.target.value)}>
              <option value="">Todos</option>
              {sgdTypes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.description}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.secondaryButton} onClick={applyFilters} disabled={isLoadingList}>
            Aplicar
          </button>
          <button type="button" className={styles.ghostButton} onClick={clearFilters} disabled={isLoadingList}>
            Limpar
          </button>
        </div>
      </article>

      <article className={styles.card}>
        <div className={styles.tableHeader}>
          <h3 className={styles.cardTitle}>Lista de Programacoes</h3>
          <div className={styles.tableActions}>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => void handleExportCsv()}
              disabled={isExporting || isExportingEnel || isExportingEnelNovo || isLoadingList || !filteredSchedules.length || commonExportCooldown.isCoolingDown}
            >
              {isExporting ? "Exportando..." : "Exportar Excel (CSV)"}
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => void handleExportEnelExcel()}
              disabled={isExportingEnel || isExporting || isExportingEnelNovo || isLoadingList || !filteredSchedules.length || enelExportCooldown.isCoolingDown}
            >
              {isExportingEnel ? "Gerando..." : "Extracao ENEL"}
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => void handleExportEnelExcelNovo()}
              disabled={isExportingEnelNovo || isExportingEnel || isExporting || isLoadingList || !filteredSchedules.length || enelExportCooldown.isCoolingDown}
            >
              {isExportingEnelNovo ? "Gerando..." : "Extracao ENEL NOVO"}
            </button>
          </div>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Data execucao</th>
                <th>Projeto</th>
                <th>Equipe</th>
                <th>Base</th>
                <th>Horario</th>
                <th>Periodo</th>
                <th>Status</th>
                <th>Estado Trabalho</th>
                <th>Atualizado em</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {pagedSchedules.length ? (
                pagedSchedules.map((schedule) => {
                  const project = projectMap.get(schedule.projectId);
                  const team = resolveScheduleTeamInfo(schedule, teamMap);
                  const displayStatus = getDisplayProgrammingStatus(schedule);
                  const workCompletionLabel = schedule.workCompletionStatus
                    ? (workCompletionLabelMap.get(schedule.workCompletionStatus) ?? schedule.workCompletionStatus)
                    : "-";
                  return (
                    <tr key={schedule.id} className={isInactiveProgrammingStatus(displayStatus) ? styles.inactiveRow : undefined}>
                      <td>{formatDate(schedule.date)}</td>
                      <td>{project?.code ?? schedule.projectId}</td>
                      <td>{team.name}</td>
                      <td>{team.serviceCenterName ?? "-"}</td>
                      <td>{schedule.startTime} - {schedule.endTime}</td>
                      <td>{schedule.period === "integral" ? "Integral" : "Parcial"}</td>
                      <td>
                        <div className={styles.sobCell}>
                          <span>{displayStatus}</span>
                          {isInactiveProgrammingStatus(displayStatus) ? (
                            <span className={styles.statusTag}>Inativa</span>
                          ) : null}
                        </div>
                      </td>
                      <td>{workCompletionLabel}</td>
                      <td>{formatDateTime(schedule.updatedAt)}</td>
                      <td className={styles.actionsCell}>
                        <div className={styles.tableActions}>
                          <button
                            type="button"
                            className={`${styles.actionButton} ${styles.actionView}`}
                            onClick={() => setDetailsTarget(schedule)}
                            title="Detalhes"
                            aria-label={`Detalhes da programacao ${project?.code ?? schedule.id}`}
                          >
                            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <path
                                d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"
                                stroke="currentColor"
                                strokeWidth="1.7"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            className={`${styles.actionButton} ${styles.actionHistory}`}
                            onClick={() => void openHistory(schedule)}
                            title="Historico"
                            aria-label={`Historico da programacao ${project?.code ?? schedule.id}`}
                          >
                            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <path
                                d="M3.75 12a8.25 8.25 0 1 0 2.25-5.69M3.75 4.75v4h4"
                                stroke="currentColor"
                                strokeWidth="1.7"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                              <path d="M12 8.5v3.75l2.5 1.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                            </svg>
                          </button>
                          {!isVisualizationMode ? (
                            <>
                              <button
                                type="button"
                                className={`${styles.actionButton} ${styles.actionEdit}`}
                                onClick={() => startEditSchedule(schedule)}
                                title="Edicao"
                                aria-label={`Editar programacao ${project?.code ?? schedule.id}`}
                                disabled={!isActiveProgrammingStatus(displayStatus)}
                              >
                                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                  <path
                                    d="M4.5 19.5h4l9-9a1.4 1.4 0 0 0 0-2l-2-2a1.4 1.4 0 0 0-2 0l-9 9v4Z"
                                    stroke="currentColor"
                                    strokeWidth="1.7"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                  <path d="M12.5 7.5l4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                className={`${styles.actionButton} ${styles.actionPostpone}`}
                                onClick={() => openPostponeModal(schedule)}
                                title="Adiar"
                                aria-label={`Adiar programacao ${project?.code ?? schedule.id}`}
                                disabled={!isActiveProgrammingStatus(displayStatus)}
                              >
                                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                  <path
                                    d="M12 6v6l3.5 2"
                                    stroke="currentColor"
                                    strokeWidth="1.8"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                  <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                className={`${styles.actionButton} ${styles.actionCancel}`}
                                onClick={() => openCancelModal(schedule)}
                                title="Cancelar"
                                aria-label={`Cancelar programacao ${project?.code ?? schedule.id}`}
                                disabled={!isActiveProgrammingStatus(displayStatus)}
                              >
                                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                  <path
                                    d="M6 6l12 12M18 6L6 18"
                                    stroke="currentColor"
                                    strokeWidth="1.9"
                                    strokeLinecap="round"
                                  />
                                </svg>
                              </button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={10} className={styles.emptyRow}>
                    {isLoadingList
                      ? "Carregando programacoes..."
                      : "Nenhuma programacao encontrada para os filtros informados."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className={styles.pagination}>
          <span>
            Pagina {Math.min(page, totalPages)} de {totalPages} | Total: {filteredSchedules.length}
          </span>
          <div className={styles.paginationActions}>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1 || isLoadingList}
            >
              Anterior
            </button>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={page >= totalPages || isLoadingList}
            >
              Proxima
            </button>
          </div>
        </div>
      </article>

      {isVisualizationMode ? (
        <ProgrammingWeeklyCalendarPanel
          weekStartDate={weekStartDate}
          weekDates={weekDates}
          calendarTeams={calendarTeams}
          weeklyScheduleMap={weeklyScheduleMap}
          projectMap={projectMap}
          isLoadingList={isLoadingList}
          onPreviousWeek={() => setWeekStartDate((current) => addDays(current, -7))}
          onCurrentWeek={() => setWeekStartDate(startOfWeekMonday(today))}
          onNextWeek={() => setWeekStartDate((current) => addDays(current, 7))}
          onRefresh={() => void loadBoardData()}
          onOpenDetails={setDetailsTarget}
          onOpenHistory={(schedule) => void openHistory(schedule)}
        />
      ) : null}

      <ProgrammingDeadlineModal
        isOpen={isDeadlineModalOpen}
        items={deadlineSobCards}
        windowDays={deadlineWindowDays}
        isExporting={isExportingDeadlineModal}
        onClose={() => setIsDeadlineModalOpen(false)}
        onExport={() => void handleExportDeadlineModalCsv()}
      />
      <ProgrammingDetailsModal
        target={detailsTarget}
        projectMap={projectMap}
        teamMap={teamMap}
        onClose={() => setDetailsTarget(null)}
      />
      <ProgrammingHistoryModal
        target={historyTarget}
        items={historyItems}
        pagedItems={pagedHistoryItems}
        isLoading={isLoadingHistory}
        page={historyPage}
        totalPages={totalHistoryPages}
        onClose={() => {
          setHistoryTarget(null);
          setHistoryPage(1);
        }}
        onPreviousPage={() => setHistoryPage((current) => Math.max(1, current - 1))}
        onNextPage={() => setHistoryPage((current) => Math.min(totalHistoryPages, current + 1))}
      />
      <ProgrammingPostponeModal
        target={postponeTarget}
        reasonOptions={reasonOptions}
        reasonCode={postponeReasonCode}
        reasonNotes={postponeReasonNotes}
        date={postponeDate}
        minDate={postponeTarget ? addDays(postponeTarget.date, 1) : today}
        isSubmitting={isPostponing}
        onClose={closePostponeModal}
        onConfirm={() => void confirmPostpone()}
        onDateChange={setPostponeDate}
        onReasonCodeChange={setPostponeReasonCode}
        onReasonNotesChange={setPostponeReasonNotes}
      />
      <ProgrammingCancelModal
        target={cancelTarget}
        reasonOptions={reasonOptions}
        reasonCode={cancelReasonCode}
        reasonNotes={cancelReasonNotes}
        canSubmit={canSubmitCancellation}
        isSubmitting={isCancelling}
        onClose={closeCancelModal}
        onConfirm={() => void confirmCancellation()}
        onReasonCodeChange={setCancelReasonCode}
        onReasonNotesChange={setCancelReasonNotes}
      />
      <ProgrammingAlertModal modal={alertModal} onClose={closeAlertModal} />
      <ProgrammingStageConflictModal modal={stageConflictModal} onClose={() => setStageConflictModal(null)} />

      <datalist id="programming-simple-activity-list">
        {activityOptions.map((item) => (
          <option key={item.id} value={item.code} label={item.description} />
        ))}
      </datalist>
    </section>
  );
}
