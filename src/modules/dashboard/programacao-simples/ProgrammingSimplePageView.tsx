"use client";

import { FormEvent, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import styles from "./ProgrammingSimplePageView.module.css";

type PeriodMode = "integral" | "partial";
type ProgrammingStatus = "PROGRAMADA" | "ADIADA" | "CANCELADA";
type WorkCompletionStatus = "CONCLUIDO" | "PARCIAL";
type DocumentKey = "sgd" | "pi" | "pep";

type ProjectItem = {
  id: string;
  code: string;
  city: string;
  base: string;
  serviceType: string;
  serviceName?: string;
  priority?: string;
  partner?: string;
  utilityResponsible?: string;
  utilityFieldManager?: string;
  street?: string;
  district?: string;
};

type TeamItem = {
  id: string;
  name: string;
  serviceCenterName: string;
  foremanName?: string;
};

type SupportOptionItem = {
  id: string;
  description: string;
};

type SgdTypeItem = {
  id: string;
  description: string;
  exportColumn: "SGD_AT_MT_VYP" | "SGD_BT" | "SGD_TET" | string;
};

type DocumentEntry = {
  number: string;
  approvedAt: string;
  requestedAt: string;
};

type ActivityCatalogItem = {
  id: string;
  code: string;
  description: string;
  unit: string;
};

type ActivityItem = {
  catalogId: string;
  code: string;
  description: string;
  quantity: number;
  unit: string;
};

type ScheduleItem = {
  id: string;
  projectId: string;
  teamId: string;
  status: ProgrammingStatus;
  date: string;
  period: PeriodMode;
  startTime: string;
  endTime: string;
  outageStartTime: string;
  outageEndTime: string;
  updatedAt: string;
  statusReason?: string;
  statusChangedAt?: string;
  expectedMinutes: number;
  feeder: string;
  support: string;
  supportItemId: string | null;
  note: string;
  serviceDescription: string;
  posteQty: number;
  estruturaQty: number;
  trafoQty: number;
  redeQty: number;
  etapaNumber: number | null;
  workCompletionStatus: WorkCompletionStatus | null;
  affectedCustomers: number;
  sgdTypeId: string | null;
  sgdTypeDescription?: string;
  sgdExportColumn?: string;
  activities: ActivityItem[];
  documents: {
    sgd: { number: string; approvedAt: string; requestedAt: string; includedAt?: string; deliveredAt?: string };
    pi: { number: string; approvedAt: string; requestedAt: string; includedAt?: string; deliveredAt?: string };
    pep: { number: string; approvedAt: string; requestedAt: string; includedAt?: string; deliveredAt?: string };
  };
};

type ProgrammingResponse = {
  projects?: ProjectItem[];
  teams?: TeamItem[];
  supportOptions?: SupportOptionItem[];
  sgdTypes?: SgdTypeItem[];
  schedules?: ScheduleItem[];
  message?: string;
};

type ActivityCatalogResponse = {
  items?: ActivityCatalogItem[];
  message?: string;
};

type BatchCreateResponse = {
  success?: boolean;
  insertedCount?: number;
  message?: string;
};

type SaveProgrammingResponse = {
  success?: boolean;
  id?: string;
  message?: string;
};

type HistoryChange = {
  from: string | null;
  to: string | null;
};

type ProgrammingHistoryItem = {
  id: string;
  changedAt: string;
  reason: string;
  action: string;
  changes: Record<string, HistoryChange>;
  metadata: Record<string, unknown>;
};

type ProgrammingHistoryResponse = {
  history?: ProgrammingHistoryItem[];
  message?: string;
};

type FormState = {
  projectId: string;
  date: string;
  period: PeriodMode;
  startTime: string;
  endTime: string;
  outageStartTime: string;
  outageEndTime: string;
  feeder: string;
  supportItemId: string;
  note: string;
  serviceDescription: string;
  posteQty: string;
  estruturaQty: string;
  trafoQty: string;
  redeQty: string;
  etapaNumber: string;
  workCompletionStatus: WorkCompletionStatus | "";
  affectedCustomers: string;
  sgdTypeId: string;
  teamIds: string[];
  teamSearch: string;
  activitySearch: string;
  activityQuantity: string;
  activities: ActivityItem[];
  documents: Record<DocumentKey, DocumentEntry>;
};

type FilterState = {
  startDate: string;
  endDate: string;
  projectId: string;
  teamId: string;
  status: "TODOS" | ProgrammingStatus;
};

const PAGE_SIZE = 20;
const HISTORY_PAGE_SIZE = 5;
const CANCEL_REASON_MIN_LENGTH = 10;
const DOCUMENT_KEYS: Array<{ key: DocumentKey; label: string }> = [
  { key: "sgd", label: "SGD" },
  { key: "pi", label: "PI" },
  { key: "pep", label: "PEP" },
];
const HISTORY_FIELD_LABELS: Record<string, string> = {
  project: "Projeto",
  team: "Equipe",
  executionDate: "Data",
  period: "Periodo",
  startTime: "Hora inicio",
  endTime: "Hora termino",
  outageStartTime: "Inicio de desligamento",
  outageEndTime: "Termino de desligamento",
  expectedMinutes: "Tempo previsto",
  feeder: "Alimentador",
  support: "Apoio",
  note: "Anotacao",
  serviceDescription: "Descricao do servico",
  posteQty: "POSTE",
  estruturaQty: "ESTRUTURA",
  trafoQty: "TRAFO",
  redeQty: "REDE",
  etapaNumber: "ETAPA",
  workCompletionStatus: "Estado Trabalho",
  affectedCustomers: "Nº Clientes Afetados",
  sgdType: "Tipo de SGD",
  sgdNumber: "SGD",
  sgdApprovedAt: "SGD Data Aprovada",
  sgdRequestedAt: "SGD Data Pedido",
  piNumber: "PI",
  piApprovedAt: "PI Data Aprovada",
  piRequestedAt: "PI Data Pedido",
  pepNumber: "PEP",
  pepApprovedAt: "PEP Data Aprovada",
  pepRequestedAt: "PEP Data Pedido",
  status: "Status",
  isActive: "Ativo",
  cancellationReason: "Motivo do cancelamento",
  canceledAt: "Data do cancelamento",
  activities: "Atividades",
};
const HISTORY_ALLOWED_ACTIONS = new Set(["UPDATE", "RESCHEDULE", "ADIADA", "CANCELADA"]);
const HISTORY_HIDDEN_FIELDS = new Set(["isActive", "cancellationReason", "canceledAt", "statusChangedAt"]);

function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(value: string, amount: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + amount);
  return toIsoDate(date);
}

function startOfWeekMonday(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const dayOfWeek = date.getDay();
  const offset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  date.setDate(date.getDate() + offset);
  return toIsoDate(date);
}

function createWeekDates(weekStartDate: string) {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStartDate, index));
}

function isDateInRange(value: string, startDate: string, endDate: string) {
  return value >= startDate && value <= endDate;
}

function formatWeekdayShort(value: string) {
  if (!value) {
    return "";
  }

  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "").toUpperCase();
}

function formatWeekRangeLabel(weekStartDate: string) {
  const weekEndDate = addDays(weekStartDate, 6);
  return `${formatDate(weekStartDate)} a ${formatDate(weekEndDate)}`;
}

function formatDate(value: string) {
  if (!value) {
    return "-";
  }

  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString("pt-BR");
}

function formatDateTime(value: string) {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("pt-BR");
}

function formatWeekday(value: string) {
  if (!value) {
    return "";
  }

  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toLocaleDateString("pt-BR", { weekday: "long" });
}

function calculateExpectedMinutes(startTime: string, endTime: string, period: PeriodMode) {
  const [startHour, startMinute] = startTime.split(":").map(Number);
  const [endHour, endMinute] = endTime.split(":").map(Number);
  const startTotal = startHour * 60 + startMinute;
  const endTotal = endHour * 60 + endMinute;

  if (Number.isFinite(startTotal) && Number.isFinite(endTotal) && endTotal > startTotal) {
    return endTotal - startTotal;
  }

  return period === "integral" ? 480 : 240;
}

function createEmptyDocuments(): Record<DocumentKey, DocumentEntry> {
  return {
    sgd: { number: "", approvedAt: "", requestedAt: "" },
    pi: { number: "", approvedAt: "", requestedAt: "" },
    pep: { number: "", approvedAt: "", requestedAt: "" },
  };
}

function createInitialForm(initialDate: string): FormState {
  return {
    projectId: "",
    date: initialDate,
    period: "integral",
    startTime: "08:00",
    endTime: "17:00",
    outageStartTime: "",
    outageEndTime: "",
    feeder: "",
    supportItemId: "",
    note: "",
    serviceDescription: "",
    posteQty: "0",
    estruturaQty: "0",
    trafoQty: "0",
    redeQty: "0",
    etapaNumber: "",
    workCompletionStatus: "",
    affectedCustomers: "0",
    sgdTypeId: "",
    teamIds: [],
    teamSearch: "",
    activitySearch: "",
    activityQuantity: "1",
    activities: [],
    documents: createEmptyDocuments(),
  };
}

function activityOptionLabel(item: ActivityCatalogItem) {
  return `${item.code} - ${item.description}`;
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function findActivityOption(value: string, options: ActivityCatalogItem[]) {
  const normalized = normalizeSearchText(value);
  if (!normalized) {
    return null;
  }

  const codeCandidate = normalized.split("-")[0]?.trim();
  return options.find((item) => {
    const code = normalizeSearchText(item.code);
    const label = normalizeSearchText(activityOptionLabel(item));

    return (
      code === normalized ||
      label === normalized ||
      code === codeCandidate ||
      normalized.startsWith(`${code} -`) ||
      label.includes(normalized)
    );
  }) ?? null;
}

function parseNonNegativeInteger(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return 0;
  }

  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

function parseOptionalPositiveInteger(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

function normalizeHistoryChangeMap(value: Record<string, unknown>) {
  const normalized: Record<string, HistoryChange> = {};

  for (const [field, rawChange] of Object.entries(value ?? {})) {
    if (!rawChange || typeof rawChange !== "object" || Array.isArray(rawChange)) {
      continue;
    }

    const recordChange = rawChange as { from?: unknown; to?: unknown };
    const from = recordChange.from === null || recordChange.from === undefined ? null : String(recordChange.from);
    const to = recordChange.to === null || recordChange.to === undefined ? null : String(recordChange.to);

    if (from === to) {
      continue;
    }

    normalized[field] = { from, to };
  }

  return normalized;
}

function normalizeHistoryItemsForDisplay(items: ProgrammingHistoryItem[]) {
  return items
    .map((item) => {
      const action = item.action.trim().toUpperCase();
      if (!HISTORY_ALLOWED_ACTIONS.has(action)) {
        return null;
      }

      const rawChanges = normalizeHistoryChangeMap(item.changes ?? {});

      if (action === "ADIADA" || action === "CANCELADA") {
        const statusChange = rawChanges.status;
        if (!statusChange) {
          return null;
        }

        return {
          ...item,
          changes: { status: statusChange },
        };
      }

      const filteredEntries = Object.entries(rawChanges).filter(([field]) => !HISTORY_HIDDEN_FIELDS.has(field));
      if (!filteredEntries.length) {
        return null;
      }

      return {
        ...item,
        changes: Object.fromEntries(filteredEntries),
      };
    })
    .filter((item): item is ProgrammingHistoryItem => item !== null);
}

function parseActivitiesSnapshot(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Array<{ code?: string; quantity?: number }> | null;
    if (!Array.isArray(parsed)) {
      return value;
    }

    const summarized = parsed
      .map((item) => {
        const code = String(item.code ?? "").trim();
        const quantity = Number(item.quantity ?? 0);
        if (!code || !Number.isFinite(quantity)) {
          return null;
        }
        return `${code} (${quantity})`;
      })
      .filter((item): item is string => Boolean(item));

    return summarized.length ? summarized.join(", ") : "-";
  } catch {
    return value;
  }
}

function formatHistoryValue(field: string, value: string | null) {
  if (!value) {
    return "-";
  }

  if (field === "executionDate") {
    return formatDate(value);
  }

  if (
    field === "sgdApprovedAt"
    || field === "sgdRequestedAt"
    || field === "piApprovedAt"
    || field === "piRequestedAt"
    || field === "pepApprovedAt"
    || field === "pepRequestedAt"
  ) {
    return formatDate(value);
  }

  if (field === "canceledAt" || field === "statusChangedAt") {
    return formatDateTime(value);
  }

  if (field === "period") {
    return value === "INTEGRAL" ? "Integral" : value === "PARCIAL" ? "Parcial" : value;
  }

  if (field === "isActive") {
    return value === "true" ? "Sim" : "Nao";
  }

  if (field === "activities") {
    return parseActivitiesSnapshot(value) ?? "-";
  }

  return value;
}

function formatHistoryAction(action: string) {
  const normalized = action.trim().toUpperCase();
  if (normalized === "BATCH_CREATE" || normalized === "CREATE") {
    return "Cadastro";
  }
  if (normalized === "UPDATE") {
    return "Edicao";
  }
  if (normalized === "RESCHEDULE") {
    return "Reprogramacao";
  }
  if (normalized === "CANCELADA") {
    return "Cancelamento";
  }
  if (normalized === "ADIADA") {
    return "Adiamento";
  }
  return action || "-";
}

function scheduleStatusClassName(status: ProgrammingStatus) {
  if (status === "ADIADA") {
    return styles.weekCardPostponed;
  }

  if (status === "CANCELADA") {
    return styles.weekCardCancelled;
  }

  return styles.weekCardPlanned;
}

function isInactiveProgrammingStatus(status: ProgrammingStatus) {
  return status === "ADIADA" || status === "CANCELADA";
}

function escapeCsvValue(value: string | number) {
  const raw = String(value ?? "").replace(/\r?\n|\r/g, " ").trim();
  if (raw.includes(";") || raw.includes('"')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function downloadCsvFile(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

type ProgrammingSimplePageViewMode = "cadastro" | "visualizacao";

export function ProgrammingSimplePageView({ mode = "cadastro" }: { mode?: ProgrammingSimplePageViewMode }) {
  const { session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const formCardRef = useRef<HTMLElement | null>(null);
  const isVisualizationMode = mode === "visualizacao";

  const today = useMemo(() => toIsoDate(new Date()), []);
  const [form, setForm] = useState<FormState>(() => createInitialForm(today));
  const [weekStartDate, setWeekStartDate] = useState(() => startOfWeekMonday(today));
  const [filterDraft, setFilterDraft] = useState<FilterState>({
    startDate: today,
    endDate: addDays(today, 6),
    projectId: "",
    teamId: "",
    status: "TODOS",
  });
  const [activeFilters, setActiveFilters] = useState<FilterState>({
    startDate: today,
    endDate: addDays(today, 6),
    projectId: "",
    teamId: "",
    status: "TODOS",
  });

  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [teams, setTeams] = useState<TeamItem[]>([]);
  const [supportOptions, setSupportOptions] = useState<SupportOptionItem[]>([]);
  const [sgdTypes, setSgdTypes] = useState<SgdTypeItem[]>([]);
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [activityOptions, setActivityOptions] = useState<ActivityCatalogItem[]>([]);
  const [page, setPage] = useState(1);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingActivities, setIsLoadingActivities] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingEnel, setIsExportingEnel] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editingExpectedUpdatedAt, setEditingExpectedUpdatedAt] = useState<string | null>(null);
  const [editChangeReason, setEditChangeReason] = useState("");
  const [detailsTarget, setDetailsTarget] = useState<ScheduleItem | null>(null);
  const [historyTarget, setHistoryTarget] = useState<ScheduleItem | null>(null);
  const [historyItems, setHistoryItems] = useState<ProgrammingHistoryItem[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<ScheduleItem | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);
  const [postponeTarget, setPostponeTarget] = useState<ScheduleItem | null>(null);
  const [postponeReason, setPostponeReason] = useState("");
  const [postponeDate, setPostponeDate] = useState("");
  const [isPostponing, setIsPostponing] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const deferredActivitySearch = useDeferredValue(form.activitySearch);
  const isEditing = Boolean(editingScheduleId);
  const canSubmitCancellation = cancelReason.trim().length >= CANCEL_REASON_MIN_LENGTH && !isCancelling;
  const canSubmitPostpone = Boolean(postponeDate)
    && postponeTarget !== null
    && postponeDate !== postponeTarget.date
    && postponeReason.trim().length >= CANCEL_REASON_MIN_LENGTH
    && !isPostponing;
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
  const teamMap = useMemo(() => new Map(teams.map((item) => [item.id, item])), [teams]);
  const weekDates = useMemo(() => createWeekDates(weekStartDate), [weekStartDate]);
  const weekEndDate = weekDates[weekDates.length - 1] ?? weekStartDate;

  const filteredSchedules = useMemo(() => {
    return schedules.filter((item) => {
      const shouldApplyDateFilter = !isInactiveProgrammingStatus(item.status);
      if (shouldApplyDateFilter && !isDateInRange(item.date, activeFilters.startDate, activeFilters.endDate)) {
        return false;
      }

      if (activeFilters.projectId && item.projectId !== activeFilters.projectId) {
        return false;
      }

      if (activeFilters.teamId && item.teamId !== activeFilters.teamId) {
        return false;
      }

      if (activeFilters.status !== "TODOS" && item.status !== activeFilters.status) {
        return false;
      }

      return true;
    });
  }, [activeFilters.endDate, activeFilters.projectId, activeFilters.startDate, activeFilters.status, activeFilters.teamId, schedules]);

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

  const loadBoardData = useCallback(async () => {
    if (!accessToken) {
      return;
    }

    const requestStartDate = activeFilters.startDate < weekStartDate ? activeFilters.startDate : weekStartDate;
    const requestEndDate = activeFilters.endDate > weekEndDate ? activeFilters.endDate : weekEndDate;

    setIsLoadingList(true);
    try {
      const response = await fetch(
        `/api/programacao?startDate=${requestStartDate}&endDate=${requestEndDate}`,
        {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      const data = (await response.json().catch(() => ({}))) as ProgrammingResponse;
      if (!response.ok) {
        setProjects([]);
        setTeams([]);
        setSchedules([]);
        setSupportOptions([]);
        setSgdTypes([]);
        setFeedback({
          type: "error",
          message: data.message ?? "Falha ao carregar programacao.",
        });
        return;
      }

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
      setSchedules(nextSchedules);
    } catch {
      setProjects([]);
      setTeams([]);
      setSchedules([]);
      setSupportOptions([]);
      setSgdTypes([]);
      setFeedback({
        type: "error",
        message: "Falha ao carregar programacao.",
      });
    } finally {
      setIsLoadingList(false);
    }
  }, [accessToken, activeFilters.endDate, activeFilters.startDate, weekEndDate, weekStartDate]);

  useEffect(() => {
    void loadBoardData();
  }, [loadBoardData]);

  useEffect(() => {
    if (!accessToken || deferredActivitySearch.trim().length < 2) {
      setActivityOptions([]);
      setIsLoadingActivities(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsLoadingActivities(true);
      try {
        const response = await fetch(
          `/api/projects/activity-forecast/catalog?q=${encodeURIComponent(deferredActivitySearch.trim())}`,
          {
            cache: "no-store",
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
            signal: controller.signal,
          },
        );

        const data = (await response.json().catch(() => ({}))) as ActivityCatalogResponse;
        if (!response.ok) {
          setActivityOptions([]);
          return;
        }

        setActivityOptions(data.items ?? []);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setActivityOptions([]);
        }
      } finally {
        setIsLoadingActivities(false);
      }
    }, 220);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [accessToken, deferredActivitySearch]);

  useEffect(() => {
    setPage(1);
  }, [activeFilters.projectId, activeFilters.status, activeFilters.teamId, schedules]);

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
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateFilterField<Key extends keyof FilterState>(field: Key, value: FilterState[Key]) {
    setFilterDraft((current) => ({ ...current, [field]: value }));
  }

  function toggleTeam(teamId: string) {
    setForm((current) => ({
      ...current,
      teamIds: current.teamIds.includes(teamId)
        ? current.teamIds.filter((item) => item !== teamId)
        : [...current.teamIds, teamId],
    }));
  }

  function selectAllVisibleTeams() {
    setForm((current) => ({
      ...current,
      teamIds: Array.from(new Set([...current.teamIds, ...visibleTeamOptions.map((team) => team.id)])),
    }));
  }

  function clearSelectedTeams() {
    setForm((current) => ({ ...current, teamIds: [] }));
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
    if (schedule.status !== "PROGRAMADA") {
      setFeedback({
        type: "error",
        message: "Somente programacoes com status PROGRAMADA podem entrar em edicao.",
      });
      return;
    }

    setEditingScheduleId(schedule.id);
    setEditingTeamId(schedule.teamId);
    setEditingExpectedUpdatedAt(schedule.updatedAt);
    setEditChangeReason("");
    setForm((current) => ({
      ...current,
      projectId: schedule.projectId,
      date: schedule.date,
      period: schedule.period,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      outageStartTime: schedule.outageStartTime ?? "",
      outageEndTime: schedule.outageEndTime ?? "",
      feeder: schedule.feeder ?? "",
      supportItemId: schedule.supportItemId ?? "",
      note: schedule.note ?? "",
      serviceDescription: schedule.serviceDescription ?? "",
      posteQty: String(schedule.posteQty ?? 0),
      estruturaQty: String(schedule.estruturaQty ?? 0),
      trafoQty: String(schedule.trafoQty ?? 0),
      redeQty: String(schedule.redeQty ?? 0),
      etapaNumber: schedule.etapaNumber === null ? "" : String(schedule.etapaNumber),
      workCompletionStatus: schedule.workCompletionStatus ?? "",
      affectedCustomers: String(schedule.affectedCustomers ?? 0),
      sgdTypeId: schedule.sgdTypeId ?? "",
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
    setEditChangeReason("");
    setForm(createInitialForm(today));
    setFeedback(null);
  }

  function openCancelModal(schedule: ScheduleItem) {
    if (schedule.status !== "PROGRAMADA") {
      setFeedback({
        type: "error",
        message: "Somente programacoes com status PROGRAMADA podem ser canceladas.",
      });
      return;
    }

    setCancelTarget(schedule);
    setCancelReason("");
    setFeedback(null);
  }

  function openPostponeModal(schedule: ScheduleItem) {
    if (schedule.status !== "PROGRAMADA") {
      setFeedback({
        type: "error",
        message: "Somente programacoes com status PROGRAMADA podem ser adiadas.",
      });
      return;
    }

    setPostponeTarget(schedule);
    setPostponeReason("");
    setPostponeDate(schedule.date);
    setFeedback(null);
  }

  function closeCancelModal() {
    setCancelTarget(null);
    setCancelReason("");
  }

  function closePostponeModal() {
    if (isPostponing) {
      return;
    }

    setPostponeTarget(null);
    setPostponeReason("");
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
      const response = await fetch(`/api/programacao?historyProgrammingId=${encodeURIComponent(schedule.id)}`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const data = (await response.json().catch(() => ({}))) as ProgrammingHistoryResponse;

      if (!response.ok) {
        setFeedback({ type: "error", message: data.message ?? "Falha ao carregar historico da programacao." });
        return;
      }

      const normalizedHistory = normalizeHistoryItemsForDisplay(data.history ?? []);

      setHistoryItems(normalizedHistory);
    } catch {
      setFeedback({ type: "error", message: "Falha ao carregar historico da programacao." });
    } finally {
      setIsLoadingHistory(false);
    }
  }

  async function confirmCancellation() {
    if (!accessToken || !cancelTarget || cancelReason.trim().length < CANCEL_REASON_MIN_LENGTH) {
      return;
    }

    setIsCancelling(true);

    try {
      const response = await fetch("/api/programacao", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          id: cancelTarget.id,
          action: "CANCELAR",
          reason: cancelReason.trim(),
          expectedUpdatedAt: cancelTarget.updatedAt,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        setFeedback({
          type: "error",
          message: data.message ?? "Falha ao cancelar programacao.",
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
      await loadBoardData();
    } catch {
      setFeedback({
        type: "error",
        message: "Falha ao cancelar programacao.",
      });
    } finally {
      setIsCancelling(false);
    }
  }

  async function confirmPostpone() {
    if (!accessToken || !postponeTarget || !canSubmitPostpone) {
      return;
    }

    setIsPostponing(true);

    try {
      const response = await fetch("/api/programacao", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          id: postponeTarget.id,
          action: "ADIAR",
          reason: postponeReason.trim(),
          newDate: postponeDate,
          expectedUpdatedAt: postponeTarget.updatedAt,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        setFeedback({
          type: "error",
          message: data.message ?? "Falha ao adiar programacao.",
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
      await loadBoardData();
    } catch {
      setFeedback({
        type: "error",
        message: "Falha ao adiar programacao.",
      });
    } finally {
      setIsPostponing(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!accessToken) {
      setFeedback({ type: "error", message: "Sessao invalida para salvar programacao." });
      return;
    }

    if (!form.teamIds.length) {
      setFeedback({
        type: "error",
        message: "Selecione ao menos uma equipe para cadastrar a programacao.",
      });
      return;
    }

    if (editingScheduleId && (form.teamIds.length !== 1 || form.teamIds[0] !== editingTeamId)) {
      setFeedback({
        type: "error",
        message: "Na edicao desta tela, a equipe original deve ser mantida.",
      });
      return;
    }

    const expectedMinutes = calculateExpectedMinutes(form.startTime, form.endTime, form.period);
    if (expectedMinutes <= 0) {
      setFeedback({ type: "error", message: "Informe um horario valido para a programacao." });
      return;
    }

    if ((form.outageStartTime && !form.outageEndTime) || (!form.outageStartTime && form.outageEndTime)) {
      setFeedback({
        type: "error",
        message: "Informe inicio e termino de desligamento.",
      });
      return;
    }

    if (form.outageStartTime && form.outageEndTime && form.outageEndTime <= form.outageStartTime) {
      setFeedback({
        type: "error",
        message: "Termino de desligamento deve ser maior que inicio.",
      });
      return;
    }

    if (!form.sgdTypeId) {
      setFeedback({
        type: "error",
        message: "Tipo de SGD e obrigatorio para salvar a programacao.",
      });
      return;
    }

    const posteQty = parseNonNegativeInteger(form.posteQty);
    const estruturaQty = parseNonNegativeInteger(form.estruturaQty);
    const trafoQty = parseNonNegativeInteger(form.trafoQty);
    const redeQty = parseNonNegativeInteger(form.redeQty);
    const etapaNumber = parseOptionalPositiveInteger(form.etapaNumber);
    const affectedCustomers = parseNonNegativeInteger(form.affectedCustomers);
    if (posteQty === null || estruturaQty === null || trafoQty === null || redeQty === null || affectedCustomers === null) {
      setFeedback({
        type: "error",
        message: "POSTE, ESTRUTURA, TRAFO, REDE e Nº Clientes Afetados devem ser numeros inteiros maiores ou iguais a zero.",
      });
      return;
    }

    if (etapaNumber === null) {
      setFeedback({
        type: "error",
        message: "ETAPA e obrigatoria.",
      });
      return;
    }

    if (etapaNumber === undefined) {
      setFeedback({
        type: "error",
        message: "ETAPA deve ser um numero inteiro maior que zero.",
      });
      return;
    }

    if (isEditing && !form.workCompletionStatus) {
      setFeedback({
        type: "error",
        message: "Estado Trabalho e obrigatorio na edicao.",
      });
      return;
    }

    setIsSaving(true);
    setFeedback(null);

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
        supportItemId: form.supportItemId || undefined,
        note: form.note.trim(),
        serviceDescription: form.serviceDescription.trim(),
        posteQty,
        estruturaQty,
        trafoQty,
        redeQty,
        etapaNumber: etapaNumber ?? undefined,
        workCompletionStatus: isEditing ? form.workCompletionStatus : undefined,
        affectedCustomers,
        sgdTypeId: form.sgdTypeId || undefined,
        documents: DOCUMENT_KEYS.reduce(
          (accumulator, item) => {
            accumulator[item.key] = {
              number: form.documents[item.key].number.trim(),
              approvedAt: form.documents[item.key].approvedAt || undefined,
              requestedAt: form.documents[item.key].requestedAt || undefined,
            };
            return accumulator;
          },
          {} as Record<DocumentKey, { number: string; approvedAt?: string; requestedAt?: string }>,
        ),
        activities: form.activities
          .filter((item) => item.quantity > 0)
          .map((item) => ({ catalogId: item.catalogId, quantity: item.quantity })),
      };

      const response = await fetch("/api/programacao", {
        method: editingScheduleId ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(
          editingScheduleId
            ? {
                ...basePayload,
                id: editingScheduleId,
                teamId: form.teamIds[0],
                expectedUpdatedAt: editingExpectedUpdatedAt,
                changeReason: editChangeReason.trim() || undefined,
              }
            : {
                action: "BATCH_CREATE",
                ...basePayload,
                teamIds: form.teamIds,
              },
        ),
      });

      const data = (await response.json().catch(() => ({}))) as BatchCreateResponse & SaveProgrammingResponse;
      if (!response.ok || (editingScheduleId ? !data.id : !data.success)) {
        setFeedback({
          type: "error",
          message: data.message ?? (editingScheduleId ? "Falha ao editar programacao." : "Falha ao cadastrar programacao em lote."),
        });
        return;
      }

      setFeedback({
        type: "success",
        message: data.message ?? (editingScheduleId ? "Programacao editada com sucesso." : "Programacao cadastrada com sucesso."),
      });
      setEditingScheduleId(null);
      setEditingTeamId(null);
      setEditingExpectedUpdatedAt(null);
      setEditChangeReason("");
      setForm(createInitialForm(today));
      await loadBoardData();
    } catch {
      setFeedback({
        type: "error",
        message: editingScheduleId ? "Falha ao editar programacao." : "Falha ao cadastrar programacao em lote.",
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

    setFeedback(null);
    setActiveFilters(filterDraft);
    setWeekStartDate(startOfWeekMonday(filterDraft.startDate));
  }

  function clearFilters() {
    const reset: FilterState = {
      startDate: today,
      endDate: addDays(today, 6),
      projectId: "",
      teamId: "",
      status: "TODOS",
    };
    setFilterDraft(reset);
    setActiveFilters(reset);
    setWeekStartDate(startOfWeekMonday(reset.startDate));
    setFeedback(null);
  }

  async function handleExportCsv() {
    if (!filteredSchedules.length) {
      setFeedback({
        type: "error",
        message: "Nenhuma programacao encontrada para exportar com os filtros atuais.",
      });
      return;
    }

    setIsExporting(true);
    try {
      const header = ["Data", "Projeto", "Equipe", "Base", "Horario", "Periodo", "Status", "Atualizado em"];
      const rows = filteredSchedules.map((schedule) => {
        const project = projectMap.get(schedule.projectId);
        const team = teamMap.get(schedule.teamId);
        return [
          formatDate(schedule.date),
          project?.code ?? schedule.projectId,
          team?.name ?? schedule.teamId,
          team?.serviceCenterName ?? "-",
          `${schedule.startTime} - ${schedule.endTime}`,
          schedule.period === "integral" ? "Integral" : "Parcial",
          schedule.status,
          formatDateTime(schedule.updatedAt),
        ];
      });

      const csvLines = [header, ...rows].map((line) => line.map((item) => escapeCsvValue(item)).join(";"));
      const csv = `\uFEFF${csvLines.join("\n")}`;
      const exportDate = new Date().toISOString().slice(0, 10);
      downloadCsvFile(csv, `programacao_simples_${exportDate}.csv`);
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

    setIsExportingEnel(true);
    try {
      const header = [
        "BASE",
        "Tipo de Serviço",
        "SOB",
        "Data Execução",
        "Dia da semana",
        "Período",
        "Hor Inic Obra",
        "Hor Térm Obra",
        "Tempo Previsto",
        "STATUS",
        "INFO STATUS",
        "PRIORIDADE",
        "Estrutura",
        "Anotação",
        "Apoio",
        "Responsáveis Enel",
        "Parceira",
        "Responsável Execução",
        "Tipo de SGD",
        "Nº Clientes Afetados",
        "SGD AT/MT/VyP",
        "SGD BT",
        "SGD TeT",
        "Nº EQ (RE, CO, CF, CC ou TR)",
        "Inic deslig",
        "Térm deslig",
        "Alim.",
        "Logradouro",
        "Bairro",
        "Município",
        "Descrição do serviço",
        "Motivo do Cancelamento / Parcial / Adiamento",
        "Observação do Cancelamento / Parcial / Adiamento",
        "Data da programação",
        "Trafo - kVA",
        "Observação",
        "Estado Trabalho",
        "Data Energização",
        "PEP",
        "Serviço",
        "COM INSTALAÇÃO DE MEDIDOR?",
        "OBSERVAÇÃO SOBRE PADRÃO DO CLIENTE",
        "Mão de obra",
        "Gestor de campo",
      ];

      const rows = filteredSchedules.map((schedule) => {
        const project = projectMap.get(schedule.projectId);
        const team = teamMap.get(schedule.teamId);
        const periodLabel = schedule.period === "integral" ? "Integral" : "Parcial";
        const sgdNumber = schedule.documents?.sgd?.number ?? "";
        const sgdExportColumn = schedule.sgdExportColumn ?? "";
        const sgdAtMtVyp = (!sgdExportColumn || sgdExportColumn === "SGD_AT_MT_VYP") ? sgdNumber : "";
        const sgdBt = sgdExportColumn === "SGD_BT" ? sgdNumber : "";
        const sgdTet = sgdExportColumn === "SGD_TET" ? sgdNumber : "";
        const infoStatus = schedule.etapaNumber ? `${schedule.etapaNumber} ETAPA` : "";

        return [
          project?.base ?? "",
          project?.serviceType ?? "",
          project?.code ?? "",
          formatDate(schedule.date),
          formatWeekday(schedule.date),
          periodLabel,
          schedule.startTime ?? "",
          schedule.endTime ?? "",
          schedule.expectedMinutes ?? "",
          schedule.status ?? "",
          infoStatus,
          project?.priority ?? "",
          schedule.estruturaQty ?? "",
          schedule.note ?? "",
          schedule.support ?? "",
          project?.utilityResponsible ?? "",
          project?.partner ?? "",
          team?.foremanName ?? team?.name ?? "",
          schedule.sgdTypeDescription ?? "",
          schedule.affectedCustomers ?? "",
          sgdAtMtVyp,
          sgdBt,
          sgdTet,
          "1",
          schedule.outageStartTime ?? "",
          schedule.outageEndTime ?? "",
          schedule.feeder ?? "",
          project?.street ?? "",
          project?.district ?? "",
          project?.city ?? "",
          schedule.serviceDescription ?? "",
          schedule.statusReason ?? "",
          schedule.statusReason ?? "",
          formatDate(schedule.date),
          schedule.trafoQty ?? "",
          schedule.note ?? "",
          schedule.workCompletionStatus ?? "",
          "",
          schedule.documents?.pep?.number ?? "",
          project?.serviceType ?? "",
          "",
          "",
          "",
          project?.utilityFieldManager ?? "",
        ];
      });

      const csvLines = [header, ...rows].map((line) => line.map((item) => escapeCsvValue(item)).join(";"));
      const csv = `\uFEFF${csvLines.join("\n")}`;
      const exportDate = new Date().toISOString().slice(0, 10);
      downloadCsvFile(csv, `programacao_enel_excel_${exportDate}.csv`);
    } finally {
      setIsExportingEnel(false);
    }
  }

  return (
    <section className={styles.wrapper}>
      {feedback ? (
        <div className={feedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError}>{feedback.message}</div>
      ) : null}

      {!isVisualizationMode ? (
        <article ref={formCardRef} className={`${styles.card} ${isEditing ? styles.editingCard : ""}`}>
        <h3 className={styles.cardTitle}>{isEditing ? "Edicao de Programacao" : "Cadastro de Programacao"}</h3>

        <form className={styles.formGrid} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>
              Projeto <span className="requiredMark">*</span>
            </span>
            <select
              value={form.projectId}
              onChange={(event) => updateFormField("projectId", event.target.value)}
              required
            >
              <option value="">Selecione</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.code} | {project.city} | {project.base}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>
              Data <span className="requiredMark">*</span>
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

          <label className={styles.field}>
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

          <label className={styles.field}>
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

          <label className={styles.field}>
            <span>Inicio de desligamento</span>
            <input
              type="time"
              value={form.outageStartTime}
              onChange={(event) => updateFormField("outageStartTime", event.target.value)}
            />
          </label>

          <label className={styles.field}>
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

          <label className={styles.field}>
            <span>Alimentador</span>
            <input
              type="text"
              value={form.feeder}
              onChange={(event) => updateFormField("feeder", event.target.value)}
              placeholder="Ex.: AL-09"
            />
          </label>

          <label className={styles.field}>
            <span>POSTE (quantidade)</span>
            <input
              type="number"
              min="0"
              step="1"
              value={form.posteQty}
              onChange={(event) => updateFormField("posteQty", event.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span>ESTRUTURA (quantidade)</span>
            <input
              type="number"
              min="0"
              step="1"
              value={form.estruturaQty}
              onChange={(event) => updateFormField("estruturaQty", event.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span>TRAFO (quantidade)</span>
            <input
              type="number"
              min="0"
              step="1"
              value={form.trafoQty}
              onChange={(event) => updateFormField("trafoQty", event.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span>REDE (quantidade)</span>
            <input
              type="number"
              min="0"
              step="1"
              value={form.redeQty}
              onChange={(event) => updateFormField("redeQty", event.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span>
              ETAPA <span className="requiredMark">*</span>
            </span>
            <input
              type="number"
              min="1"
              step="1"
              value={form.etapaNumber}
              onChange={(event) => updateFormField("etapaNumber", event.target.value)}
              placeholder="Ex.: 1"
              required
            />
          </label>

          <label className={styles.field}>
            <span>Nº Clientes Afetados</span>
            <input
              type="number"
              min="0"
              step="1"
              value={form.affectedCustomers}
              onChange={(event) => updateFormField("affectedCustomers", event.target.value)}
            />
          </label>

          <label className={styles.field}>
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
            <label className={styles.field}>
              <span>
                Estado Trabalho <span className="requiredMark">*</span>
              </span>
              <select
                value={form.workCompletionStatus}
                onChange={(event) => updateFormField("workCompletionStatus", event.target.value as WorkCompletionStatus | "")}
                required
              >
                <option value="">Selecione</option>
                <option value="CONCLUIDO">CONCLUIDO</option>
                <option value="PARCIAL">PARCIAL</option>
              </select>
            </label>
          ) : null}

          {editingScheduleId ? (
            <label className={`${styles.field} ${styles.fieldWide}`}>
              <span>Motivo da reprogramacao (obrigatorio se alterar data, horario ou equipe)</span>
              <input
                type="text"
                value={editChangeReason}
                onChange={(event) => setEditChangeReason(event.target.value)}
                placeholder="Informe o motivo quando houver reprogramacao."
              />
            </label>
          ) : null}

          <div className={`${styles.field} ${styles.fieldWide}`}>
            <span>
              Equipes <span className="requiredMark">*</span>
            </span>
            <div className={styles.teamSelectionCard}>
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
                  Modo edicao ativo: esta tela mantem a equipe original da programacao selecionada.
                </p>
              ) : selectedProject ? (
                <p className={styles.helperText}>
                  Base do projeto selecionado: <strong>{selectedProject.base}</strong>. Somente equipes dessa base sao exibidas.
                </p>
              ) : (
                <p className={styles.helperText}>Selecione um projeto para limitar as equipes pela base.</p>
              )}

              <div className={styles.teamList}>
                {visibleTeamOptions.length ? (
                  visibleTeamOptions.map((team) => (
                    <label key={team.id} className={styles.teamOption}>
                      <input
                        type="checkbox"
                        checked={form.teamIds.includes(team.id)}
                        onChange={() => toggleTeam(team.id)}
                        disabled={Boolean(editingScheduleId)}
                      />
                      <div>
                        <strong>{team.name}</strong>
                        <small>{team.serviceCenterName}</small>
                      </div>
                    </label>
                  ))
                ) : (
                  <p className={styles.emptyHint}>Nenhuma equipe disponivel para o filtro atual.</p>
                )}
              </div>
            </div>
          </div>

          <div className={`${styles.field} ${styles.fieldWide}`}>
            <span>Atividades</span>
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
          </div>

          <div className={`${styles.field} ${styles.fieldWide}`}>
            <span>Documentos</span>
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
          </div>

          <div className={`${styles.actions} ${styles.formActions}`}>
            <button
              type="submit"
              className={styles.primaryButton}
              disabled={
                isSaving
                || !form.projectId
                || !form.teamIds.length
                || !form.sgdTypeId
                || !form.etapaNumber.trim()
                || (Boolean(editingScheduleId) && !form.workCompletionStatus)
              }
            >
              {isSaving ? "Salvando..." : editingScheduleId ? "Salvar edicao" : "Cadastrar para equipes selecionadas"}
            </button>
            {editingScheduleId ? (
              <button type="button" className={styles.ghostButton} onClick={cancelEditMode} disabled={isSaving}>
                Cancelar edicao
              </button>
            ) : null}
          </div>
        </form>
        </article>
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
            <select value={filterDraft.projectId} onChange={(event) => updateFilterField("projectId", event.target.value)}>
              <option value="">Todos</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.code}
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
              <option value="ADIADA">Adiada</option>
              <option value="CANCELADA">Cancelada</option>
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
              disabled={isExporting || isExportingEnel || isLoadingList || !filteredSchedules.length}
            >
              {isExporting ? "Extraindo..." : "Extracao Comum"}
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => void handleExportEnelExcel()}
              disabled={isExportingEnel || isExporting || isLoadingList || !filteredSchedules.length}
            >
              {isExportingEnel ? "Gerando..." : "Extracao ENEL"}
            </button>
          </div>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Data</th>
                <th>Projeto</th>
                <th>Equipe</th>
                <th>Base</th>
                <th>Horario</th>
                <th>Periodo</th>
                <th>Status</th>
                <th>Atualizado em</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {pagedSchedules.length ? (
                pagedSchedules.map((schedule) => {
                  const project = projectMap.get(schedule.projectId);
                  const team = teamMap.get(schedule.teamId);
                  return (
                    <tr key={schedule.id} className={schedule.status !== "PROGRAMADA" ? styles.inactiveRow : undefined}>
                      <td>{formatDate(schedule.date)}</td>
                      <td>{project?.code ?? schedule.projectId}</td>
                      <td>{team?.name ?? schedule.teamId}</td>
                      <td>{team?.serviceCenterName ?? "-"}</td>
                      <td>{schedule.startTime} - {schedule.endTime}</td>
                      <td>{schedule.period === "integral" ? "Integral" : "Parcial"}</td>
                      <td>
                        <div className={styles.sobCell}>
                          <span>{schedule.status}</span>
                          {schedule.status !== "PROGRAMADA" ? (
                            <span className={styles.statusTag}>Inativa</span>
                          ) : null}
                        </div>
                      </td>
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
                                disabled={schedule.status !== "PROGRAMADA"}
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
                                disabled={schedule.status !== "PROGRAMADA"}
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
                                disabled={schedule.status !== "PROGRAMADA"}
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
                  <td colSpan={9} className={styles.emptyRow}>
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
        <article className={`${styles.card} ${styles.calendarTopCard}`}>
        <div className={styles.calendarHeader}>
          <h3 className={styles.cardTitle}>Calendario Semanal de Programacao</h3>
          <div className={styles.calendarActions}>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => setWeekStartDate((current) => addDays(current, -7))}
            >
              Semana anterior
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => setWeekStartDate(startOfWeekMonday(today))}
            >
              Semana atual
            </button>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => setWeekStartDate((current) => addDays(current, 7))}
            >
              Proxima semana
            </button>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => void loadBoardData()}
              disabled={isLoadingList}
            >
              {isLoadingList ? "Atualizando..." : "Atualizar"}
            </button>
          </div>
        </div>

        <p className={styles.helperText}>
          Semana exibida: <strong>{formatWeekRangeLabel(weekStartDate)}</strong> (segunda a domingo).
        </p>

        <div className={styles.weekLegend}>
          <span className={`${styles.weekLegendItem} ${styles.weekLegendPlanned}`}>Programado</span>
          <span className={`${styles.weekLegendItem} ${styles.weekLegendPostponed}`}>Adiado</span>
          <span className={`${styles.weekLegendItem} ${styles.weekLegendCancelled}`}>Cancelado</span>
        </div>

        <div className={styles.weekCalendarWrapper}>
          <div className={styles.weekCalendarHeader}>
            <div className={styles.weekCalendarTeamHeader}>Equipe</div>
            {weekDates.map((date) => (
              <div key={date} className={styles.weekCalendarDayHeader}>
                <strong>{formatWeekdayShort(date)}</strong>
                <small>{formatDate(date)}</small>
              </div>
            ))}
          </div>

          {calendarTeams.length ? (
            calendarTeams.map((team) => (
              <div key={team.id} className={styles.weekCalendarRow}>
                <div className={styles.weekCalendarTeamCell}>
                  <strong>{team.name}</strong>
                  <small>{team.serviceCenterName || "-"}</small>
                </div>

                {weekDates.map((date) => {
                  const daySchedules = weeklyScheduleMap.get(`${team.id}__${date}`) ?? [];

                  return (
                    <div key={`${team.id}-${date}`} className={styles.weekCalendarDayCell}>
                      {daySchedules.length ? (
                        daySchedules.map((schedule) => {
                          const project = projectMap.get(schedule.projectId);
                          const sob = project?.code ?? schedule.projectId;
                          const hasSgd = Boolean(schedule.documents?.sgd?.approvedAt?.trim());
                          const hasPi = Boolean(schedule.documents?.pi?.approvedAt?.trim());

                          return (
                            <article
                              key={schedule.id}
                              className={`${styles.weekCard} ${scheduleStatusClassName(schedule.status)}`}
                            >
                              <div className={styles.weekCardTop}>
                                <strong>{sob}</strong>
                              </div>

                              <div className={styles.weekIndicators}>
                                <span className={hasSgd ? styles.weekIndicatorOn : styles.weekIndicatorOff}>SGD</span>
                                <span className={hasPi ? styles.weekIndicatorOn : styles.weekIndicatorOff}>PI</span>
                              </div>

                              <div className={styles.weekCardActions}>
                                <button
                                  type="button"
                                  className={styles.weekActionButton}
                                  onClick={() => setDetailsTarget(schedule)}
                                  title="Ver detalhe"
                                  aria-label={`Ver detalhe da programacao ${sob}`}
                                >
                                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                    <path
                                      d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"
                                      stroke="currentColor"
                                      strokeWidth="1.8"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
                                  </svg>
                                </button>
                                <button
                                  type="button"
                                  className={styles.weekActionButton}
                                  onClick={() => void openHistory(schedule)}
                                  title="Historico"
                                  aria-label={`Historico da programacao ${sob}`}
                                >
                                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                    <path
                                      d="M3.75 12a8.25 8.25 0 1 0 2.25-5.69M3.75 4.75v4h4"
                                      stroke="currentColor"
                                      strokeWidth="1.8"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                    <path d="M12 8.5v3.75l2.5 1.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                                  </svg>
                                </button>
                              </div>
                            </article>
                          );
                        })
                      ) : (
                        <div className={styles.weekEmptyCell}>Sem programacao</div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          ) : (
            <div className={styles.weekCalendarEmpty}>Nenhuma equipe disponivel para os filtros atuais.</div>
          )}
        </div>
        </article>
      ) : null}

      {detailsTarget ? (
        <div className={styles.modalOverlay} onClick={() => setDetailsTarget(null)}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Detalhes da Programacao</h4>
                <p className={styles.modalSubtitle}>ID da programacao: {detailsTarget.id}</p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={() => setDetailsTarget(null)}>
                Fechar
              </button>
            </header>
            <div className={styles.modalBody}>
              <div className={styles.detailsGrid}>
                <p><strong>Status:</strong> {detailsTarget.status}</p>
                <p><strong>Atualizado em:</strong> {formatDateTime(detailsTarget.updatedAt)}</p>
                <p><strong>Projeto:</strong> {projectMap.get(detailsTarget.projectId)?.code ?? detailsTarget.projectId}</p>
                <p><strong>Equipe:</strong> {teamMap.get(detailsTarget.teamId)?.name ?? detailsTarget.teamId}</p>
                <p><strong>Data:</strong> {formatDate(detailsTarget.date)}</p>
                <p><strong>Horario:</strong> {detailsTarget.startTime} - {detailsTarget.endTime}</p>
                <p><strong>Inicio de desligamento:</strong> {detailsTarget.outageStartTime || "-"}</p>
                <p><strong>Termino de desligamento:</strong> {detailsTarget.outageEndTime || "-"}</p>
                <p><strong>POSTE:</strong> {detailsTarget.posteQty}</p>
                <p><strong>ESTRUTURA:</strong> {detailsTarget.estruturaQty}</p>
                <p><strong>TRAFO:</strong> {detailsTarget.trafoQty}</p>
                <p><strong>REDE:</strong> {detailsTarget.redeQty}</p>
                <p><strong>ETAPA:</strong> {detailsTarget.etapaNumber ?? "-"}</p>
                <p><strong>Estado Trabalho:</strong> {detailsTarget.workCompletionStatus || "-"}</p>
                <p><strong>Nº Clientes Afetados:</strong> {detailsTarget.affectedCustomers}</p>
                <p><strong>Tipo de SGD:</strong> {detailsTarget.sgdTypeDescription || "-"}</p>
                <p><strong>Apoio:</strong> {detailsTarget.support || "-"}</p>
                <p><strong>Alimentador:</strong> {detailsTarget.feeder || "-"}</p>
                <p className={styles.detailWide}><strong>Descricao do servico:</strong> {detailsTarget.serviceDescription || "-"}</p>
                <p className={styles.detailWide}><strong>Anotacao:</strong> {detailsTarget.note || "-"}</p>
                {detailsTarget.status !== "PROGRAMADA" ? (
                  <>
                    <p><strong>Data do cancelamento/adiamento:</strong> {formatDateTime(detailsTarget.statusChangedAt ?? "")}</p>
                    <p className={styles.detailWide}>
                      <strong>Motivo do cancelamento/adiamento:</strong> {detailsTarget.statusReason || "-"}
                    </p>
                  </>
                ) : null}
              </div>
            </div>
          </article>
        </div>
      ) : null}

      {historyTarget ? (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            setHistoryTarget(null);
            setHistoryPage(1);
          }}
        >
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Historico da Programacao</h4>
                <p className={styles.modalSubtitle}>ID da programacao: {historyTarget.id}</p>
              </div>
              <button
                type="button"
                className={styles.modalCloseButton}
                onClick={() => {
                  setHistoryTarget(null);
                  setHistoryPage(1);
                }}
              >
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              {isLoadingHistory ? <p className={styles.emptyHint}>Carregando historico...</p> : null}
              {!isLoadingHistory && historyItems.length === 0 ? (
                <p className={styles.emptyHint}>Nenhuma alteracao registrada.</p>
              ) : null}
              {!isLoadingHistory && historyItems.length > 0 ? (
                <div className={styles.historyList}>
                  {pagedHistoryItems.map((item) => {
                    const changedFields = Object.entries(item.changes ?? {}).filter(([, change]) => {
                      return (change.from ?? "") !== (change.to ?? "");
                    });

                    return (
                      <article key={item.id} className={styles.historyCard}>
                        <header className={styles.historyCardHeader}>
                          <strong>{formatHistoryAction(item.action)}</strong>
                          <span>{formatDateTime(item.changedAt)}</span>
                        </header>

                        <div className={styles.historyChanges}>
                          {changedFields.length ? (
                            changedFields.map(([field, change]) => (
                              <div key={field} className={styles.historyChangeItem}>
                                <strong>{HISTORY_FIELD_LABELS[field] ?? field}</strong>
                                <span>De: {formatHistoryValue(field, change.from)}</span>
                                <span>Para: {formatHistoryValue(field, change.to)}</span>
                              </div>
                            ))
                          ) : (
                            <p className={styles.emptyHint}>Nenhum campo alterado nesse evento.</p>
                          )}
                        </div>

                        <p><strong>Motivo:</strong> {item.reason || "-"}</p>
                      </article>
                    );
                  })}
                </div>
              ) : null}
              {!isLoadingHistory && historyItems.length > 0 ? (
                <div className={styles.historyPagination}>
                  <span>
                    Pagina {Math.min(historyPage, totalHistoryPages)} de {totalHistoryPages} | Total: {historyItems.length}
                  </span>
                  <div className={styles.paginationActions}>
                    <button
                      type="button"
                      className={styles.ghostButton}
                      onClick={() => setHistoryPage((current) => Math.max(1, current - 1))}
                      disabled={historyPage <= 1}
                    >
                      Anterior
                    </button>
                    <button
                      type="button"
                      className={styles.ghostButton}
                      onClick={() => setHistoryPage((current) => Math.min(totalHistoryPages, current + 1))}
                      disabled={historyPage >= totalHistoryPages}
                    >
                      Proxima
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </article>
        </div>
      ) : null}

      {postponeTarget ? (
        <div className={styles.modalOverlay} onClick={closePostponeModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <h4>Adiar Programacao</h4>
              <button type="button" className={styles.modalCloseButton} onClick={closePostponeModal} disabled={isPostponing}>
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              <p>
                Informe o motivo e a nova data da programacao. A programacao atual sera marcada como ADIADA e um novo
                registro sera criado para a nova data.
              </p>

              <label className={styles.field}>
                <span>
                  Nova data da programacao <span className="requiredMark">*</span>
                </span>
                <input
                  type="date"
                  value={postponeDate}
                  onChange={(event) => setPostponeDate(event.target.value)}
                  disabled={isPostponing}
                />
              </label>

              <label className={styles.field}>
                <span>
                  Motivo do adiamento <span className="requiredMark">*</span>
                </span>
                <textarea
                  value={postponeReason}
                  onChange={(event) => setPostponeReason(event.target.value)}
                  rows={4}
                  placeholder={`Descreva o motivo com no minimo ${CANCEL_REASON_MIN_LENGTH} caracteres`}
                  disabled={isPostponing}
                />
              </label>

              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => void confirmPostpone()}
                  disabled={!canSubmitPostpone}
                >
                  {isPostponing ? "Adiando..." : "Validar adiamento"}
                </button>
                <button type="button" className={styles.ghostButton} onClick={closePostponeModal} disabled={isPostponing}>
                  Voltar
                </button>
              </div>
            </div>
          </article>
        </div>
      ) : null}

      {cancelTarget ? (
        <div className={styles.modalOverlay} onClick={closeCancelModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <h4>Cancelar Programacao</h4>
              <button type="button" className={styles.modalCloseButton} onClick={closeCancelModal} disabled={isCancelling}>
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              <p>
                Informe o motivo do cancelamento. O botao validar so fica ativo quando o motivo tiver no minimo{" "}
                {CANCEL_REASON_MIN_LENGTH} caracteres.
              </p>

              <label className={styles.field}>
                <span>
                  Motivo do cancelamento <span className="requiredMark">*</span>
                </span>
                <textarea
                  value={cancelReason}
                  onChange={(event) => setCancelReason(event.target.value)}
                  rows={4}
                  placeholder="Descreva o motivo do cancelamento"
                />
              </label>

              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.dangerButton}
                  onClick={() => void confirmCancellation()}
                  disabled={!canSubmitCancellation}
                >
                  {isCancelling ? "Cancelando..." : "Validar cancelamento"}
                </button>
                <button type="button" className={styles.ghostButton} onClick={closeCancelModal} disabled={isCancelling}>
                  Voltar
                </button>
              </div>
            </div>
          </article>
        </div>
      ) : null}

      <datalist id="programming-simple-activity-list">
        {activityOptions.map((item) => (
          <option key={item.id} value={item.code} label={item.description} />
        ))}
      </datalist>
    </section>
  );
}
