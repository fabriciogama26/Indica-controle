"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ExportProgressModal } from "@/components/ui/ExportProgressModal";
import { useAuth } from "@/hooks/useAuth";
import { useErrorLogger } from "@/hooks/useErrorLogger";
import { useExportCooldown } from "@/hooks/useExportCooldown";
import { downloadCsvFile } from "@/lib/utils/csv";
import {
  ProgrammingDeadlineModal,
  ProgrammingDeadlinePanel,
} from "@/modules/dashboard/programacao-simples/components";
import {
  DEADLINE_CAROUSEL_PAGE_SIZE,
  DEADLINE_WINDOW_EXTENDED_DAYS,
  DEADLINE_WINDOW_LONG_DAYS,
  DEADLINE_WINDOW_MAX_DAYS,
  DEADLINE_WINDOW_SHORT_DAYS,
} from "@/modules/dashboard/programacao-simples/constants";
import { buildDeadlineCsvContent } from "@/modules/dashboard/programacao-simples/exports";
import {
  formatDeadlineStatusLabel,
  resolveDeadlineStatus,
  resolveDeadlineVisualVariant,
} from "@/modules/dashboard/programacao-simples/utils";
import type {
  DeadlineStatus,
  DeadlineViewMode,
} from "@/modules/dashboard/programacao-simples/types";
import styles from "./MapProgrammingPageView.module.css";

type ProjectSituationKey =
  | "PORTFOLIO"
  | "CONCLUDED"
  | "TO_REPROGRAM"
  | "REVIEW_STAGES"
  | "INTERRUPTED_COMPLETED"
  | "PENDING"
  | "PARTIAL_PLANNED"
  | "PARTIAL"
  | "BENEFIT_REACHED"
  | "INTERRUPTED"
  | "WITHOUT_STATUS"
  | "NEVER_PROGRAMMED";

type PriorityLevel = "NORMAL" | "ATTENTION" | "PRIORITY" | "INCONSISTENCY";

type MapProject = {
  id: string;
  sob: string;
  projectName: string;
  contract: string;
  serviceCenter: string;
  priority: string;
  serviceType: string;
  city: string;
  executionDeadline: string;
  latestProgrammingId: string | null;
  latestDate: string;
  latestProgrammingStatus: string;
  latestWorkCompletionStatus: string | null;
  latestWorkCompletionLabel: string;
  latestTeamName: string;
  latestForemanName: string;
  latestStageLabel: string;
  programmingCount: number;
  stageCount: number;
  reason: string;
  daysSinceLatest: number | null;
  priorityLevel: PriorityLevel;
  stageReviewRequired: boolean;
  stageReviewStageLabel: string;
  stageReviewNextStageLabel: string;
  stageReviewStatus: string;
  stageReviewDate: string;
  interruptedCompletedRequired: boolean;
  interruptedCompletedStageLabel: string;
  interruptedCompletedStatus: string;
  interruptedCompletedWorkCompletionStatus: string;
  interruptedCompletedDate: string;
  hasFutureActiveProgramming: boolean;
  completed: boolean;
  interrupted: boolean;
  withoutStatus: boolean;
  actionRequired: boolean;
  neverProgrammed: boolean;
};

type StatusCard = {
  key: ProjectSituationKey;
  title: string;
  description: string;
  count: number;
  projects: MapProject[];
};

type TeamWithoutProgramming = {
  id: string;
  name: string;
  vehiclePlate: string;
  serviceCenter: string;
  teamType: string;
  foremanName: string;
  active: boolean;
};

type TransferEvent = {
  id: string;
  changedAt: string;
  reason: string;
  teamId: string;
  teamName: string;
  sourceProjectId: string;
  sourceProjectCode: string;
  sourceServiceCenter: string;
  sourceProgrammingId: string;
  sourceDate: string;
  sourceStage: string;
  destinationProjectId: string;
  destinationProjectCode: string;
  destinationServiceCenter: string;
  destinationProgrammingId: string;
  newProgrammingId: string;
  destinationDate: string;
  destinationStage: string;
};

type MapProgrammingResponse = {
  filters?: {
    startDate: string | null;
    endDate: string | null;
    generatedAt: string;
    teamPeriodEnabled: boolean;
  };
  summary?: {
    portfolioProjectCount: number;
    actionRequiredProjectCount: number;
    concludedProjectCount: number;
    toReprogramProjectCount: number;
    stageReviewProjectCount: number;
    interruptedCompletedProjectCount: number;
    neverProgrammedProjectCount: number;
    interruptedProjectCount: number;
    withoutStatusProjectCount: number;
    activeTeamCount: number;
    teamsWithoutProgrammingCount: number;
    programmedTeamCount: number;
  };
  statusCards?: StatusCard[];
  priorityProjects?: MapProject[];
  neverProgrammedProjects?: MapProject[];
  teamsWithoutProgramming?: TeamWithoutProgramming[];
  transferEvents?: TransferEvent[];
  message?: string;
};

type FilterState = {
  startDate: string;
  endDate: string;
  projectSearch: string;
  teamSearch: string;
  serviceCenter: string;
};

const TABLE_PAGE_SIZE = 8;

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: string, amount: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return toIsoDate(value);
}

function diffInDays(targetDate: string, baseDate: string) {
  const target = Date.parse(`${targetDate}T00:00:00.000Z`);
  const base = Date.parse(`${baseDate}T00:00:00.000Z`);
  if (!Number.isFinite(target) || !Number.isFinite(base)) {
    return null;
  }
  return Math.round((target - base) / 86_400_000);
}

function formatDate(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return "-";
  }
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatDaysSince(value: number | null) {
  if (value === null) return "-";
  if (value < 0) return `em ${Math.abs(value)} dias`;
  if (value === 0) return "hoje";
  if (value === 1) return "ha 1 dia";
  return `ha ${value} dias`;
}

function resolveDeadlineWindowDays(viewMode: DeadlineViewMode) {
  if (viewMode === "90") return DEADLINE_WINDOW_MAX_DAYS;
  if (viewMode === "60") return DEADLINE_WINDOW_EXTENDED_DAYS;
  if (viewMode === "30") return DEADLINE_WINDOW_LONG_DAYS;
  return DEADLINE_WINDOW_SHORT_DAYS;
}

function formatDeadlineRangeLabel(daysDiff: number) {
  if (daysDiff < 0) return "Vencida";
  if (daysDiff <= DEADLINE_WINDOW_SHORT_DAYS) return "Ate 15 dias";
  if (daysDiff <= DEADLINE_WINDOW_LONG_DAYS) return "16 a 30 dias";
  if (daysDiff <= DEADLINE_WINDOW_EXTENDED_DAYS) return "31 a 60 dias";
  return "61 a 90 dias";
}

function getPriorityLabel(value: PriorityLevel) {
  if (value === "INCONSISTENCY") return "Inconsistencia";
  if (value === "PRIORITY") return "Prioridade";
  if (value === "ATTENTION") return "Atencao";
  return "Normal";
}

function getPriorityClassName(value: PriorityLevel) {
  if (value === "INCONSISTENCY") return styles.priorityInconsistency;
  if (value === "PRIORITY") return styles.priorityHigh;
  if (value === "ATTENTION") return styles.priorityAttention;
  return styles.priorityNormal;
}

function getCardClassName(key: ProjectSituationKey) {
  if (key === "REVIEW_STAGES") return styles.summaryReview;
  if (key === "TO_REPROGRAM" || key === "INTERRUPTED" || key === "INTERRUPTED_COMPLETED" || key === "WITHOUT_STATUS") return styles.summaryDanger;
  if (key === "PENDING" || key === "PARTIAL" || key === "PARTIAL_PLANNED" || key === "BENEFIT_REACHED") return styles.summaryWarning;
  if (key === "CONCLUDED") return styles.summarySuccess;
  return styles.summaryNeutral;
}

function exportCsv(filename: string, header: string[], rows: Array<Array<string | number | null>>) {
  const escapeValue = (value: string | number | null) => {
    const text = String(value ?? "");
    if (/[;"\n\r]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };
  const content = `\uFEFF${[header, ...rows].map((row) => row.map(escapeValue).join(";")).join("\n")}`;
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function MapProgrammingPageView() {
  const { session } = useAuth();
  const logError = useErrorLogger("mapa_programacao");
  const today = useMemo(() => toIsoDate(new Date()), []);
  const [draftFilters, setDraftFilters] = useState<FilterState>({
    startDate: "",
    endDate: "",
    projectSearch: "",
    teamSearch: "",
    serviceCenter: "",
  });
  const [activeFilters, setActiveFilters] = useState<FilterState>({
    startDate: "",
    endDate: "",
    projectSearch: "",
    teamSearch: "",
    serviceCenter: "",
  });
  const [data, setData] = useState<MapProgrammingResponse | null>(null);
  const [selectedCardKey, setSelectedCardKey] = useState<ProjectSituationKey | null>(null);
  const [selectedProject, setSelectedProject] = useState<MapProject | null>(null);
  const [selectedCardPage, setSelectedCardPage] = useState(1);
  const [priorityPage, setPriorityPage] = useState(1);
  const [stageReviewPage, setStageReviewPage] = useState(1);
  const [interruptedCompletedPage, setInterruptedCompletedPage] = useState(1);
  const [transferPage, setTransferPage] = useState(1);
  const [neverProgrammedPage, setNeverProgrammedPage] = useState(1);
  const [deadlineViewMode, setDeadlineViewMode] = useState<DeadlineViewMode>("15");
  const [deadlineCarouselPage, setDeadlineCarouselPage] = useState(0);
  const [isDeadlineModalOpen, setIsDeadlineModalOpen] = useState(false);
  const [isExportingDeadlineModal, setIsExportingDeadlineModal] = useState(false);
  const [isExportingCsv, setIsExportingCsv] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const deadlineModalExportCooldown = useExportCooldown();

  const accessToken = session?.accessToken ?? "";

  const loadData = useCallback(async () => {
    if (!accessToken) {
      setFeedback({ type: "error", message: "Sessao invalida para carregar Mapa de Programacao." });
      return;
    }

    setIsLoading(true);
    setFeedback(null);

    try {
      const query = new URLSearchParams();
      if (activeFilters.startDate && activeFilters.endDate) {
        query.set("startDate", activeFilters.startDate);
        query.set("endDate", activeFilters.endDate);
      }

      const response = await fetch(`/api/mapa-programacao?${query.toString()}`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const responseData = (await response.json().catch(() => ({}))) as MapProgrammingResponse;

      if (!response.ok) {
        throw new Error(responseData.message ?? "Falha ao carregar Mapa de Programacao.");
      }

      setData(responseData);
      setSelectedCardKey(null);
      setSelectedProject(null);
      setSelectedCardPage(1);
      setPriorityPage(1);
      setStageReviewPage(1);
      setInterruptedCompletedPage(1);
      setTransferPage(1);
      setNeverProgrammedPage(1);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao carregar Mapa de Programacao.";
      setFeedback({ type: "error", message });
      await logError("Falha ao carregar Mapa de Programacao.", error, {
        operation: "load_map_programming",
        startDate: activeFilters.startDate,
        endDate: activeFilters.endDate,
      });
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, activeFilters.endDate, activeFilters.startDate, logError]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const statusCards = useMemo(() => data?.statusCards ?? [], [data]);

  const serviceCenterOptions = useMemo(() => {
    const values = new Set<string>();
    for (const card of statusCards) {
      for (const project of card.projects) {
        if (project.serviceCenter) values.add(project.serviceCenter);
      }
    }
    for (const team of data?.teamsWithoutProgramming ?? []) {
      if (team.serviceCenter) values.add(team.serviceCenter);
    }
    for (const event of data?.transferEvents ?? []) {
      if (event.sourceServiceCenter) values.add(event.sourceServiceCenter);
      if (event.destinationServiceCenter) values.add(event.destinationServiceCenter);
    }
    return Array.from(values).sort((left, right) => left.localeCompare(right));
  }, [data, statusCards]);

  const selectedCard = statusCards.find((card) => card.key === selectedCardKey) ?? null;
  const stageReviewCard = statusCards.find((card) => card.key === "REVIEW_STAGES") ?? null;
  const interruptedCompletedCard = statusCards.find((card) => card.key === "INTERRUPTED_COMPLETED") ?? null;

  const filterProjects = useCallback((projects: MapProject[]) => {
    const search = normalizeSearch(activeFilters.projectSearch);
    return projects.filter((project) => {
      if (activeFilters.serviceCenter && project.serviceCenter !== activeFilters.serviceCenter) return false;
      if (!search) return true;
      return normalizeSearch([
        project.sob,
        project.projectName,
        project.contract,
        project.serviceCenter,
        project.serviceType,
        project.city,
        project.latestTeamName,
        project.latestForemanName,
        project.latestWorkCompletionLabel,
        project.latestProgrammingStatus,
      ].join(" ")).includes(search);
    });
  }, [activeFilters.projectSearch, activeFilters.serviceCenter]);

  const filteredSelectedProjects = selectedCard ? filterProjects(selectedCard.projects) : [];
  const filteredPriorityProjects = useMemo(
    () => filterProjects(data?.priorityProjects ?? []),
    [data, filterProjects],
  );
  const filteredStageReviewProjects = useMemo(
    () => filterProjects(stageReviewCard?.projects ?? []),
    [filterProjects, stageReviewCard],
  );
  const filteredInterruptedCompletedProjects = useMemo(
    () => filterProjects(interruptedCompletedCard?.projects ?? []),
    [filterProjects, interruptedCompletedCard],
  );
  const filteredNeverProgrammedProjects = useMemo(
    () => filterProjects(data?.neverProgrammedProjects ?? []),
    [data, filterProjects],
  );
  const filteredTransferEvents = useMemo(() => {
    const projectSearch = normalizeSearch(activeFilters.projectSearch);
    const teamSearch = normalizeSearch(activeFilters.teamSearch);

    return (data?.transferEvents ?? []).filter((event) => {
      if (
        activeFilters.serviceCenter
        && event.sourceServiceCenter !== activeFilters.serviceCenter
        && event.destinationServiceCenter !== activeFilters.serviceCenter
      ) {
        return false;
      }

      if (projectSearch) {
        const haystack = normalizeSearch([
          event.sourceProjectCode,
          event.destinationProjectCode,
          event.reason,
          event.sourceDate,
          event.destinationDate,
        ].join(" "));
        if (!haystack.includes(projectSearch)) return false;
      }

      if (teamSearch) {
        const haystack = normalizeSearch(`${event.teamName} ${event.teamId}`);
        if (!haystack.includes(teamSearch)) return false;
      }

      return true;
    });
  }, [activeFilters.projectSearch, activeFilters.serviceCenter, activeFilters.teamSearch, data]);
  const portfolioProjects = useMemo(
    () => statusCards.find((card) => card.key === "PORTFOLIO")?.projects ?? [],
    [statusCards],
  );
  const deadlineWindowDays = useMemo(
    () => resolveDeadlineWindowDays(deadlineViewMode),
    [deadlineViewMode],
  );
  const deadlineProjects = useMemo(() => {
    return filterProjects(portfolioProjects)
      .map((project) => {
        const executionDeadline = project.executionDeadline.trim();
        if (project.completed || !executionDeadline || !/^\d{4}-\d{2}-\d{2}$/.test(executionDeadline)) {
          return null;
        }

        const daysDiff = diffInDays(executionDeadline, today);
        if (daysDiff === null) {
          return null;
        }

        return {
          id: project.id,
          sob: project.sob,
          serviceCenter: project.serviceCenter || "Sem base",
          priority: project.priority || "Sem prioridade",
          workType: project.serviceType || "Sem tipo",
          executionDeadline,
          latestProgrammingDate: project.latestDate,
          reason: project.reason,
          workCompletionStatus: project.latestWorkCompletionLabel === "Nao informado"
            ? ""
            : project.latestWorkCompletionLabel,
          daysDiff,
        };
      })
      .filter((item): item is {
        id: string;
        sob: string;
        serviceCenter: string;
        priority: string;
        workType: string;
        executionDeadline: string;
        latestProgrammingDate: string;
        reason: string;
        workCompletionStatus: string;
        daysDiff: number;
      } => Boolean(item));
  }, [filterProjects, portfolioProjects, today]);
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
          rangeLabel: formatDeadlineRangeLabel(item.daysDiff),
        };
      })
      .sort((left, right) => {
        const priorityDiff = priorityByStatus[left.deadlineStatus] - priorityByStatus[right.deadlineStatus];
        if (priorityDiff !== 0) return priorityDiff;
        if (left.daysDiff === right.daysDiff) return left.sob.localeCompare(right.sob);
        if (left.deadlineStatus === "OVERDUE") return right.daysDiff - left.daysDiff;
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
  const deadlineWindowHeading = `SOB com vencimento ate ${deadlineWindowDays} dias`;

  useEffect(() => {
    setPriorityPage(1);
    setStageReviewPage(1);
    setInterruptedCompletedPage(1);
    setTransferPage(1);
    setNeverProgrammedPage(1);
    setSelectedCardPage(1);
  }, [activeFilters.projectSearch, activeFilters.serviceCenter, activeFilters.teamSearch]);

  useEffect(() => {
    setDeadlineCarouselPage(0);
  }, [activeFilters.projectSearch, activeFilters.serviceCenter, deadlineViewMode]);

  useEffect(() => {
    setDeadlineCarouselPage((current) => {
      if (!deadlineSobPages.length) return 0;
      const lastPage = deadlineSobPages.length - 1;
      if (current > lastPage) return lastPage;
      if (current < 0) return 0;
      return current;
    });
  }, [deadlineSobPages]);

  const filteredTeams = useMemo(() => {
    const search = normalizeSearch(activeFilters.teamSearch);
    return (data?.teamsWithoutProgramming ?? []).filter((team) => {
      if (activeFilters.serviceCenter && team.serviceCenter !== activeFilters.serviceCenter) return false;
      if (!search) return true;
      return normalizeSearch(`${team.name} ${team.foremanName} ${team.serviceCenter} ${team.teamType} ${team.vehiclePlate}`)
        .includes(search);
    });
  }, [activeFilters.serviceCenter, activeFilters.teamSearch, data]);

  const summary = data?.summary;
  const periodLabel = activeFilters.startDate && activeFilters.endDate
    ? `${formatDate(activeFilters.startDate)} a ${formatDate(activeFilters.endDate)}`
    : "Sem periodo";

  function updateDraftField(field: keyof FilterState, value: string) {
    setDraftFilters((current) => ({ ...current, [field]: value }));
  }

  function applyFilters() {
    if ((draftFilters.startDate && !draftFilters.endDate) || (!draftFilters.startDate && draftFilters.endDate)) {
      setFeedback({ type: "error", message: "Informe data inicial e data final, ou deixe as duas em branco." });
      return;
    }
    if (draftFilters.startDate && draftFilters.endDate && draftFilters.endDate < draftFilters.startDate) {
      setFeedback({ type: "error", message: "Data final deve ser maior ou igual a data inicial." });
      return;
    }
    setActiveFilters(draftFilters);
  }

  function clearPeriod() {
    const nextFilters = {
      ...draftFilters,
      startDate: "",
      endDate: "",
    };
    setDraftFilters(nextFilters);
    setActiveFilters(nextFilters);
  }

  function setPeriod(days: number) {
    const nextFilters = {
      ...draftFilters,
      startDate: today,
      endDate: addDays(today, days - 1),
    };
    setDraftFilters(nextFilters);
    setActiveFilters(nextFilters);
  }

  async function handleExportDeadlineModalCsv() {
    if (!deadlineSobCards.length) {
      setFeedback({ type: "error", message: "Nenhum prazo encontrado para exportar na janela selecionada." });
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
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    try {
      const csv = buildDeadlineCsvContent({
        items: deadlineSobCards,
        deadlineWindowDays,
      });
      downloadCsvFile(csv, `prazos_obras_${deadlineWindowDays}dias_${today}.csv`);
    } catch (error) {
      setFeedback({ type: "error", message: "Falha ao exportar prazos das obras." });
      await logError("Falha ao exportar prazos das obras.", error, {
        operation: "export_deadline_csv",
        deadlineWindowDays,
        itemCount: deadlineSobCards.length,
      });
    } finally {
      setIsExportingDeadlineModal(false);
    }
  }

  async function runCsvExport(exporter: () => void) {
    if (isExportingCsv) return;

    setIsExportingCsv(true);
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    try {
      exporter();
    } finally {
      setIsExportingCsv(false);
    }
  }

  function exportProjects(card: StatusCard, projects: MapProject[]) {
    if (!projects.length) {
      setFeedback({ type: "error", message: "Nenhuma obra para exportar." });
      return;
    }

    exportCsv(
      `mapa_programacao_${card.key.toLowerCase()}_${today}.csv`,
      [
        "SOB",
        "Projeto",
        "Centro",
        "Contrato",
        "Tipo",
        "Municipio",
        "Ultima data",
        "Equipe",
        "Encarregado",
        "Estado Trabalho",
        "Status Programacao",
        "Programacoes",
        "Etapas",
        "Dias desde ultima",
        "Motivo",
        "Revisao de etapas",
        "Divergencia",
      ],
      projects.map((project) => [
        project.sob,
        project.projectName,
        project.serviceCenter,
        project.contract,
        project.serviceType,
        project.city,
        formatDate(project.latestDate),
        project.latestTeamName,
        project.latestForemanName,
        project.latestWorkCompletionLabel,
        project.latestProgrammingStatus,
        project.programmingCount,
        project.stageCount,
        project.daysSinceLatest,
        project.reason,
        project.stageReviewRequired
          ? `${project.stageReviewStageLabel} ${project.stageReviewStatus} -> ${project.stageReviewNextStageLabel}`
          : "",
        project.interruptedCompletedRequired
          ? `${project.interruptedCompletedStatus} + ${project.interruptedCompletedWorkCompletionStatus}`
          : "",
      ]),
    );
  }

  function exportTeamsWithoutProgramming() {
    if (!filteredTeams.length) {
      setFeedback({ type: "error", message: "Nenhuma equipe sem programacao para exportar." });
      return;
    }

    exportCsv(
      `mapa_programacao_equipes_sem_programacao_${today}.csv`,
      ["Equipe", "Tipo", "Centro de servico", "Encarregado", "Placa", "Periodo"],
      filteredTeams.map((team) => [
        team.name,
        team.teamType,
        team.serviceCenter,
        team.foremanName,
        team.vehiclePlate,
        periodLabel,
      ]),
    );
  }

  function exportTransferEvents() {
    if (!filteredTransferEvents.length) {
      setFeedback({ type: "error", message: "Nenhuma transferencia para exportar." });
      return;
    }

    exportCsv(
      `mapa_programacao_transferencias_${today}.csv`,
      [
        "Alterado em",
        "Equipe",
        "Origem",
        "Data origem",
        "Etapa origem",
        "Destino",
        "Data destino",
        "Etapa destino",
        "Motivo",
        "Linha origem",
        "Linha criada",
      ],
      filteredTransferEvents.map((event) => [
        formatDateTime(event.changedAt),
        event.teamName,
        event.sourceProjectCode,
        formatDate(event.sourceDate),
        event.sourceStage,
        event.destinationProjectCode,
        formatDate(event.destinationDate),
        event.destinationStage,
        event.reason,
        event.sourceProgrammingId,
        event.newProgrammingId,
      ]),
    );
  }

  return (
    <section className={styles.wrapper}>
      <ExportProgressModal
        open={isExportingCsv}
        title="Gerando..."
        message="Gerando arquivo CSV."
      />
      {feedback ? (
        <div className={feedback.type === "error" ? styles.errorMessage : styles.successMessage}>
          {feedback.message}
        </div>
      ) : null}

      <article className={styles.toolbar}>
        <div>
          <h2>Mapa de Programacao</h2>
          <p>Carteira consolidada por obra e ultima programacao.</p>
        </div>
        <div className={styles.quickActions}>
          <button type="button" className={styles.ghostButton} onClick={clearPeriod} disabled={isLoading}>
            Sem periodo
          </button>
          <button type="button" className={styles.ghostButton} onClick={() => setPeriod(1)} disabled={isLoading}>
            Hoje
          </button>
          <button type="button" className={styles.ghostButton} onClick={() => setPeriod(7)} disabled={isLoading}>
            Semana
          </button>
          <button type="button" className={styles.ghostButton} onClick={() => setPeriod(15)} disabled={isLoading}>
            15 dias
          </button>
          <button type="button" className={styles.ghostButton} onClick={() => setPeriod(30)} disabled={isLoading}>
            30 dias
          </button>
        </div>
      </article>

      <article className={styles.card}>
        <div className={styles.filterGrid}>
          <label className={styles.field}>
            <span>Data inicial</span>
            <input type="date" value={draftFilters.startDate} onChange={(event) => updateDraftField("startDate", event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Data final</span>
            <input type="date" value={draftFilters.endDate} onChange={(event) => updateDraftField("endDate", event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Centro de servico</span>
            <select value={draftFilters.serviceCenter} onChange={(event) => updateDraftField("serviceCenter", event.target.value)}>
              <option value="">Todos</option>
              {serviceCenterOptions.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Obra</span>
            <input value={draftFilters.projectSearch} onChange={(event) => updateDraftField("projectSearch", event.target.value)} placeholder="SOB, projeto, status" />
          </label>
          <label className={styles.field}>
            <span>Equipe</span>
            <input value={draftFilters.teamSearch} onChange={(event) => updateDraftField("teamSearch", event.target.value)} placeholder="Equipe, encarregado, placa" />
          </label>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.primaryButton} onClick={applyFilters} disabled={isLoading}>
            {isLoading ? "Carregando..." : "Aplicar"}
          </button>
          <button type="button" className={styles.secondaryButton} onClick={() => void loadData()} disabled={isLoading}>
            Atualizar
          </button>
        </div>
      </article>

      <div className={styles.overviewGrid}>
        <article className={styles.overviewCard}>
          <span>Total que precisa de acao</span>
          <strong>{summary?.actionRequiredProjectCount ?? 0}</strong>
        </article>
        <article className={styles.overviewCard}>
          <span>Carteira valida</span>
          <strong>{summary?.portfolioProjectCount ?? 0}</strong>
        </article>
        <article className={styles.overviewCard}>
          <span>Concluidas</span>
          <strong>{summary?.concludedProjectCount ?? 0}</strong>
        </article>
        <article className={styles.overviewCard}>
          <span>Para reprogramar</span>
          <strong>{summary?.toReprogramProjectCount ?? 0}</strong>
        </article>
        <article className={styles.overviewCard}>
          <span>Revisao de etapas</span>
          <strong>{summary?.stageReviewProjectCount ?? 0}</strong>
        </article>
        <article className={styles.overviewCard}>
          <span>Interrompidas concluidas</span>
          <strong>{summary?.interruptedCompletedProjectCount ?? 0}</strong>
        </article>
        <article className={styles.overviewCard}>
          <span>Equipes sem programacao</span>
          <strong>{summary?.teamsWithoutProgrammingCount ?? 0}</strong>
        </article>
      </div>

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

      <div className={styles.summaryGrid}>
        {statusCards.map((card) => {
          const visibleCount = filterProjects(card.projects).length;
          return (
            <button
              type="button"
              key={card.key}
              className={`${styles.summaryCard} ${getCardClassName(card.key)}`}
              onClick={() => setSelectedCardKey(card.key)}
            >
              <span>{card.title}</span>
              <strong>{visibleCount}</strong>
              <small>{card.description}</small>
            </button>
          );
        })}
      </div>

      <article className={`${styles.card} ${styles.stageReviewCard}`}>
        <div className={styles.cardHeader}>
          <div>
            <h3>Revisao de etapas</h3>
            <span>Etapas canceladas ou adiadas com etapa ativa posterior, sem renumerar o historico.</span>
          </div>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => {
              if (stageReviewCard) void runCsvExport(() => exportProjects(stageReviewCard, filteredStageReviewProjects));
            }}
            disabled={isExportingCsv || !filteredStageReviewProjects.length}
          >
            {isExportingCsv ? "Exportando..." : "Exportar CSV"}
          </button>
        </div>
        <ProjectTable
          projects={filteredStageReviewProjects}
          page={stageReviewPage}
          onPageChange={setStageReviewPage}
          emptyMessage="Nenhuma revisao de etapas para os filtros atuais."
          onProjectClick={setSelectedProject}
          showStageReviewColumn
        />
      </article>

      <article className={`${styles.card} ${styles.interruptedCompletedCard}`}>
        <div className={styles.cardHeader}>
          <div>
            <h3>Interrompidas com Estado concluido</h3>
            <span>Programacoes canceladas ou adiadas que ainda constam com Estado Trabalho concluido.</span>
          </div>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => {
              if (interruptedCompletedCard) void runCsvExport(() => exportProjects(interruptedCompletedCard, filteredInterruptedCompletedProjects));
            }}
            disabled={isExportingCsv || !filteredInterruptedCompletedProjects.length}
          >
            {isExportingCsv ? "Exportando..." : "Exportar CSV"}
          </button>
        </div>
        <ProjectTable
          projects={filteredInterruptedCompletedProjects}
          page={interruptedCompletedPage}
          onPageChange={setInterruptedCompletedPage}
          emptyMessage="Nenhuma programacao interrompida com Estado Trabalho concluido para os filtros atuais."
          onProjectClick={setSelectedProject}
        />
      </article>

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h3>Rastreio de transferencias</h3>
            <span>Linhas marcadas como TRANSFERIDA e a nova linha criada no destino.</span>
          </div>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => void runCsvExport(exportTransferEvents)}
            disabled={isExportingCsv || !filteredTransferEvents.length}
          >
            {isExportingCsv ? "Exportando..." : "Exportar CSV"}
          </button>
        </div>
        <TransferTable
          events={filteredTransferEvents}
          page={transferPage}
          onPageChange={setTransferPage}
        />
      </article>

      <div className={styles.contentGrid}>
        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h3>Obras prioritarias</h3>
              <span>Indicadores de carteira nao mudam com o periodo; a data afeta apenas equipes.</span>
            </div>
          </div>
          <ProjectTable
            projects={filteredPriorityProjects}
            page={priorityPage}
            onPageChange={setPriorityPage}
            emptyMessage="Nenhuma obra prioritaria para os filtros atuais."
            onProjectClick={setSelectedProject}
          />
        </article>

        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h3>Equipes sem programacao</h3>
              <span>{data?.filters?.teamPeriodEnabled ? periodLabel : "Informe periodo para analisar equipes."}</span>
            </div>
            <button type="button" className={styles.secondaryButton} onClick={() => void runCsvExport(exportTeamsWithoutProgramming)} disabled={isExportingCsv || !data?.filters?.teamPeriodEnabled}>
              {isExportingCsv ? "Exportando..." : "Exportar CSV"}
            </button>
          </div>
          <div className={styles.teamList}>
            {data?.filters?.teamPeriodEnabled ? (
              filteredTeams.length ? filteredTeams.map((team) => (
                <article key={team.id} className={styles.teamItem}>
                  <strong>{team.name}</strong>
                  <span>{team.teamType} | {team.serviceCenter}</span>
                  <span>{team.foremanName}</span>
                  <small>{team.vehiclePlate || "-"}</small>
                </article>
              )) : (
                <div className={styles.emptyState}>Nenhuma equipe sem programacao para os filtros atuais.</div>
              )
            ) : (
              <div className={styles.emptyState}>Periodo nao informado.</div>
            )}
          </div>
        </article>
      </div>

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h3>Obras nunca programadas</h3>
            <span>Carteira valida sem historico em Programacao.</span>
          </div>
        </div>
        <ProjectTable
          projects={filteredNeverProgrammedProjects}
          page={neverProgrammedPage}
          onPageChange={setNeverProgrammedPage}
          emptyMessage="Nenhuma obra nunca programada para os filtros atuais."
          onProjectClick={setSelectedProject}
        />
      </article>

      <ProgrammingDeadlineModal
        isOpen={isDeadlineModalOpen}
        items={deadlineSobCards}
        windowDays={deadlineWindowDays}
        isExporting={isExportingDeadlineModal}
        onClose={() => setIsDeadlineModalOpen(false)}
        onExport={() => void handleExportDeadlineModalCsv()}
      />

      {selectedCard ? (
        <div className={styles.modalBackdrop} role="presentation" onClick={() => setSelectedCardKey(null)}>
          <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="map-programming-modal-title" onClick={(event) => event.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <h3 id="map-programming-modal-title">{selectedCard.title}</h3>
                <span>{filteredSelectedProjects.length} obras</span>
              </div>
              <div className={styles.modalActions}>
                <button type="button" className={styles.secondaryButton} onClick={() => void runCsvExport(() => exportProjects(selectedCard, filteredSelectedProjects))} disabled={isExportingCsv}>
                  {isExportingCsv ? "Exportando..." : "Exportar CSV"}
                </button>
                <button type="button" className={styles.ghostButton} onClick={() => setSelectedCardKey(null)}>
                  Fechar
                </button>
              </div>
            </div>
            <ProjectTable
              projects={filteredSelectedProjects}
              page={selectedCardPage}
              onPageChange={setSelectedCardPage}
              emptyMessage="Nenhuma obra encontrada para os filtros atuais."
              onProjectClick={setSelectedProject}
              showStageReviewColumn={selectedCard.key === "REVIEW_STAGES"}
            />
          </section>
        </div>
      ) : null}

      {selectedProject ? (
        <div className={styles.modalBackdrop} role="presentation" onClick={() => setSelectedProject(null)}>
          <section className={styles.detailModal} role="dialog" aria-modal="true" aria-labelledby="map-programming-project-title" onClick={(event) => event.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <h3 id="map-programming-project-title">ID: {selectedProject.id}</h3>
              </div>
              <button type="button" className={styles.ghostButton} onClick={() => setSelectedProject(null)}>
                Fechar
              </button>
            </div>
            <ProjectMiniCard project={selectedProject} expanded />
          </section>
        </div>
      ) : null}
    </section>
  );
}

function formatStage(value: string) {
  const numericValue = Number(value);
  if (Number.isInteger(numericValue) && numericValue > 0) return `${numericValue} etapa`;
  return value || "-";
}

function TransferTable({
  events,
  page,
  onPageChange,
}: {
  events: TransferEvent[];
  page: number;
  onPageChange: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(events.length / TABLE_PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 1), pageCount);
  const pageEvents = events.slice((safePage - 1) * TABLE_PAGE_SIZE, safePage * TABLE_PAGE_SIZE);

  if (!events.length) {
    return <div className={styles.emptyState}>Nenhuma transferencia encontrada para os filtros atuais.</div>;
  }

  return (
    <div className={styles.tableBlock}>
      <div className={styles.tableWrapper}>
        <table className={styles.compactTable}>
          <thead>
            <tr>
              <th>Alterado em</th>
              <th>Equipe</th>
              <th>Origem</th>
              <th>Destino</th>
              <th>Motivo</th>
            </tr>
          </thead>
          <tbody>
            {pageEvents.map((event) => (
              <tr key={event.id}>
                <td>{formatDateTime(event.changedAt)}</td>
                <td><strong>{event.teamName || "-"}</strong></td>
                <td>
                  <span className={styles.transferRoute}>
                    <strong>{event.sourceProjectCode || "-"}</strong>
                    <small>{formatDate(event.sourceDate)} | {formatStage(event.sourceStage)}</small>
                  </span>
                </td>
                <td>
                  <span className={styles.transferRoute}>
                    <strong>{event.destinationProjectCode || "-"}</strong>
                    <small>{formatDate(event.destinationDate)} | {formatStage(event.destinationStage)}</small>
                  </span>
                </td>
                <td>{event.reason || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.paginationBar}>
        <span>{events.length} transferencias | pagina {safePage} de {pageCount}</span>
        <div className={styles.quickActions}>
          <button type="button" className={styles.ghostButton} onClick={() => onPageChange(safePage - 1)} disabled={safePage <= 1}>
            Anterior
          </button>
          <button type="button" className={styles.ghostButton} onClick={() => onPageChange(safePage + 1)} disabled={safePage >= pageCount}>
            Proxima
          </button>
        </div>
      </div>
    </div>
  );
}

function ProjectTable({
  projects,
  page,
  onPageChange,
  emptyMessage,
  onProjectClick,
  showStageReviewColumn = false,
}: {
  projects: MapProject[];
  page: number;
  onPageChange: (page: number) => void;
  emptyMessage: string;
  onProjectClick: (project: MapProject) => void;
  showStageReviewColumn?: boolean;
}) {
  const pageCount = Math.max(1, Math.ceil(projects.length / TABLE_PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 1), pageCount);
  const pageProjects = projects.slice((safePage - 1) * TABLE_PAGE_SIZE, safePage * TABLE_PAGE_SIZE);

  if (!projects.length) {
    return <div className={styles.emptyState}>{emptyMessage}</div>;
  }

  return (
    <div className={styles.tableBlock}>
      <div className={styles.tableWrapper}>
        <table className={styles.compactTable}>
          <thead>
            <tr>
              <th>SOB</th>
              <th>Ultima data</th>
              <th>Status</th>
              <th>Estado Trabalho</th>
              <th>Equipe</th>
              <th>Encarregado</th>
              <th>Prog.</th>
              <th>Etapas</th>
              {showStageReviewColumn ? <th>Revisao</th> : null}
              <th>Dias</th>
            </tr>
          </thead>
          <tbody>
            {pageProjects.map((project) => (
              <tr
                key={project.id}
                className={
                  project.interruptedCompletedRequired
                    ? styles.interruptedCompletedRow
                    : project.stageReviewRequired
                      ? styles.stageReviewRow
                      : undefined
                }
                onClick={() => onProjectClick(project)}
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onProjectClick(project);
                  }
                }}
              >
                <td><strong>{project.sob}</strong></td>
                <td>{formatDate(project.latestDate)}</td>
                <td>{project.latestProgrammingStatus}</td>
                <td>{project.latestWorkCompletionLabel}</td>
                <td>{project.latestTeamName}</td>
                <td>{project.latestForemanName}</td>
                <td>{project.programmingCount}</td>
                <td>{project.stageCount}</td>
                {showStageReviewColumn ? (
                  <td>
                    {project.stageReviewRequired
                      ? `${project.stageReviewStageLabel} -> ${project.stageReviewNextStageLabel}`
                      : "-"}
                  </td>
                ) : null}
                <td>{formatDaysSince(project.daysSinceLatest)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.paginationBar}>
        <span>{projects.length} obras | pagina {safePage} de {pageCount}</span>
        <div className={styles.quickActions}>
          <button type="button" className={styles.ghostButton} onClick={() => onPageChange(safePage - 1)} disabled={safePage <= 1}>
            Anterior
          </button>
          <button type="button" className={styles.ghostButton} onClick={() => onPageChange(safePage + 1)} disabled={safePage >= pageCount}>
            Proxima
          </button>
        </div>
      </div>
    </div>
  );
}

function ProjectMiniCard({ project, expanded = false }: { project: MapProject; expanded?: boolean }) {
  return (
    <article className={styles.projectCard}>
      <div className={styles.projectCardHeader}>
        <div>
          <strong>{project.sob}</strong>
          <span>{project.projectName}</span>
        </div>
        <span className={`${styles.priorityPill} ${getPriorityClassName(project.priorityLevel)}`}>
          {getPriorityLabel(project.priorityLevel)}
        </span>
      </div>
      <div className={styles.projectMetaGrid}>
        <span>Ultima data <strong>{formatDate(project.latestDate)}</strong></span>
        <span>Equipe <strong>{project.latestTeamName}</strong></span>
        <span>Encarregado <strong>{project.latestForemanName}</strong></span>
        <span>Estado Trabalho <strong>{project.latestWorkCompletionLabel}</strong></span>
        <span>Programacoes <strong>{project.programmingCount}</strong></span>
        <span>Etapas <strong>{project.stageCount}</strong></span>
        <span>Ultima etapa <strong>{project.latestStageLabel}</strong></span>
        {project.stageReviewRequired ? (
          <span className={styles.stageReviewMeta}>
            Revisao etapas
            <strong>
              {`${project.stageReviewStageLabel} ${project.stageReviewStatus} -> ${project.stageReviewNextStageLabel}`}
            </strong>
          </span>
        ) : null}
        {project.interruptedCompletedRequired ? (
          <span className={styles.interruptedCompletedMeta}>
            Status x Estado
            <strong>
              {`${project.interruptedCompletedStageLabel} ${project.interruptedCompletedStatus} + ${project.interruptedCompletedWorkCompletionStatus}`}
            </strong>
          </span>
        ) : null}
        <span>Dias desde ultima <strong>{formatDaysSince(project.daysSinceLatest)}</strong></span>
      </div>
      {expanded && project.reason ? (
        <p className={styles.reasonText}>{project.reason}</p>
      ) : null}
      <div className={styles.projectActions}>
        <Link className={styles.tableLink} href="/programacao-simples">Programar</Link>
        <Link className={styles.tableLink} href="/programacao-simples">Historico</Link>
        <Link className={styles.tableLink} href="/projetos">Detalhes</Link>
      </div>
    </article>
  );
}
