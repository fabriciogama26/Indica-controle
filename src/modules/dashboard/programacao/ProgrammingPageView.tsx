"use client";

import { CSSProperties, DragEvent, FormEvent, useCallback, useDeferredValue, useEffect, useState } from "react";

import { useAuth } from "@/hooks/useAuth";

import styles from "./ProgrammingPageView.module.css";

type ViewMode = "week" | "day";
type ScheduleTone =
  | "planned"
  | "partial"
  | "complete"
  | "issue"
  | "rescheduled"
  | "postponed"
  | "cancelled";
type PeriodMode = "integral" | "partial";
type DocumentKey = "sgd" | "pi" | "pep";
type ProgrammingStatus = "PROGRAMADA" | "ADIADA" | "CANCELADA";

type ProjectItem = {
  id: string;
  code: string;
  serviceName: string;
  city: string;
  base: string;
  serviceType: string;
  priority: string;
  note: string;
  hasLocacao: boolean;
  defaultSupportItemId?: string | null;
  defaultSupportLabel?: string | null;
};

type TeamItem = {
  id: string;
  name: string;
  serviceCenterId?: string | null;
  serviceCenterName: string;
  teamTypeName: string;
  foremanName: string;
};

type DocumentEntry = {
  number: string;
  includedAt: string;
  deliveredAt: string;
};

type ActivityCatalogItem = {
  id: string;
  code: string;
  description: string;
  unit: string;
};

type ScheduleActivityItem = {
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
  updatedAt: string;
  expectedMinutes: number;
  activities: ScheduleActivityItem[];
  documents: Record<DocumentKey, DocumentEntry>;
  feeder: string;
  support: string;
  supportItemId: string | null;
  note: string;
  projectBase: string;
  statusReason: string;
  statusChangedAt: string;
  hasIssue: boolean;
  wasRescheduled: boolean;
  lastReschedule: {
    id: string;
    changedAt: string;
    reason: string;
    fromDate: string;
    toDate: string;
  } | null;
};

type SupportOptionItem = {
  id: string;
  description: string;
};

type TeamSummaryItem = {
  teamId: string;
  weekStart: string;
  weekEnd: string;
  workedDays: number;
  capacityDays: number;
  freeDays: number;
  loadPercent: number;
  loadStatus: "FREE" | "NORMAL" | "WARNING" | "OVERLOAD";
};

type DragPayload =
  | { kind: "project"; projectId: string }
  | { kind: "schedule"; scheduleId: string };

type ScheduleFormState = {
  period: PeriodMode;
  startTime: string;
  endTime: string;
  activities: ScheduleActivityItem[];
  activitySearch: string;
  activityQuantity: string;
  documents: Record<DocumentKey, DocumentEntry>;
  feeder: string;
  supportItemId: string;
  note: string;
};

type ModalState = {
  scheduleId: string | null;
  projectId: string;
  teamId: string;
  date: string;
  form: ScheduleFormState;
};

type StatusAction = "cancel" | "postpone";

type CancelModalState = {
  scheduleId: string;
  projectCode: string;
  expectedUpdatedAt: string;
  action: StatusAction;
};

type SaveRequestPayload = {
  id?: string;
  projectId: string;
  teamId: string;
  date: string;
  period: PeriodMode;
  startTime: string;
  endTime: string;
  expectedMinutes: number;
  feeder: string;
  note: string;
  supportItemId?: string;
  expectedUpdatedAt?: string;
  changeReason?: string;
  documents: Record<DocumentKey, { number: string; deliveredAt: string }>;
  activities: Array<{ catalogId: string; quantity: number }>;
};

type ReprogramModalState = {
  projectCode: string;
  payload: SaveRequestPayload;
};

type CopyModalState = {
  sourceTeamId: string;
  targetTeamIds: string[];
};

type FeedbackState = {
  type: "success" | "error";
  message: string;
};

type ProgrammingResponse = {
  projects?: ProjectItem[];
  teams?: TeamItem[];
  supportOptions?: SupportOptionItem[];
  teamSummaries?: TeamSummaryItem[];
  schedules?: Array<{
    id: string;
    projectId: string;
    teamId: string;
    status: ProgrammingStatus;
    date: string;
    period: PeriodMode;
    startTime: string;
    endTime: string;
    updatedAt: string;
    expectedMinutes: number;
    feeder: string;
    support: string;
    supportItemId?: string | null;
    note: string;
    projectBase: string;
    statusReason?: string;
    statusChangedAt?: string;
    wasRescheduled?: boolean;
    lastReschedule?: {
      id: string;
      changedAt: string;
      reason: string;
      fromDate: string;
      toDate: string;
    } | null;
    activities?: ScheduleActivityItem[];
    documents?: Partial<Record<DocumentKey, Partial<DocumentEntry>>>;
  }>;
  message?: string;
};

type ActivityCatalogResponse = {
  items?: Array<{
    id: string;
    code: string;
    description: string;
    unit: string;
  }>;
  message?: string;
};

type SaveProgrammingResponse = {
  id?: string;
  updatedAt?: string;
  warning?: string;
  error?: "conflict";
  currentUpdatedAt?: string | null;
  updatedBy?: string | null;
  changedFields?: string[];
  currentRecord?: {
    id: string;
    executionDate: string;
    startTime: string;
    endTime: string;
    updatedAt: string;
  } | null;
  message?: string;
};

type CopyProgrammingResponse = {
  copiedCount?: number;
  message?: string;
};

const WEEKDAY_LABELS = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SAB"];
const CHANGE_REASON_MIN_LENGTH = 10;
const DOCUMENT_KEYS: Array<{ key: DocumentKey; label: string }> = [
  { key: "sgd", label: "SGD" },
  { key: "pi", label: "PI" },
  { key: "pep", label: "PEP" },
];
const INITIAL_PERIOD_START = toIsoDate(new Date());

function parseIsoDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(value: string, amount: number) {
  const nextDate = parseIsoDate(value);
  nextDate.setDate(nextDate.getDate() + amount);
  return toIsoDate(nextDate);
}

function startOfWeekMonday(value: string) {
  const date = parseIsoDate(value);
  const dayOfWeek = date.getDay();
  const offset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  date.setDate(date.getDate() + offset);
  return toIsoDate(date);
}

function createVisibleDates(startDate: string, viewMode: ViewMode) {
  const normalizedStartDate = viewMode === "week" ? startOfWeekMonday(startDate) : startDate;
  const totalDays = viewMode === "week" ? 7 : 1;
  return Array.from({ length: totalDays }, (_, index) => addDays(normalizedStartDate, index));
}

function formatDateShort(value: string) {
  const date = parseIsoDate(value);
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatBoardDate(value: string) {
  const date = parseIsoDate(value);
  return `${WEEKDAY_LABELS[date.getDay()]} ${String(date.getDate()).padStart(2, "0")}`;
}

function formatPeriodLabel(dates: string[]) {
  if (dates.length === 1) {
    return formatDateShort(dates[0]);
  }

  return `${formatDateShort(dates[0])} a ${formatDateShort(dates[dates.length - 1])}`;
}

function calculateExpectedMinutes(startTime: string, endTime: string, period: PeriodMode) {
  if (startTime && endTime) {
    const [startHour, startMinute] = startTime.split(":").map(Number);
    const [endHour, endMinute] = endTime.split(":").map(Number);
    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;

    if (endMinutes > startMinutes) {
      return endMinutes - startMinutes;
    }
  }

  return period === "integral" ? 480 : 240;
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (!remainingMinutes) {
    return `${hours}h`;
  }

  return `${hours}h${String(remainingMinutes).padStart(2, "0")}min`;
}

function formatDisplayDate(value: string) {
  if (!value) {
    return "";
  }

  return parseIsoDate(value).toLocaleDateString("pt-BR");
}

function formatDisplayDateTime(value: string) {
  if (!value) {
    return "";
  }

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return "";
  }

  return parsedDate.toLocaleString("pt-BR");
}

function createEmptyDocuments(): Record<DocumentKey, DocumentEntry> {
  return {
    sgd: { number: "", includedAt: "", deliveredAt: "" },
    pi: { number: "", includedAt: "", deliveredAt: "" },
    pep: { number: "", includedAt: "", deliveredAt: "" },
  };
}

function createDocuments(documents?: Partial<Record<DocumentKey, Partial<DocumentEntry>>>) {
  const fallback = createEmptyDocuments();

  return DOCUMENT_KEYS.reduce(
    (accumulator, documentItem) => {
      const current = documents?.[documentItem.key];
      accumulator[documentItem.key] = {
        number: String(current?.number ?? fallback[documentItem.key].number),
        includedAt: String(current?.includedAt ?? fallback[documentItem.key].includedAt),
        deliveredAt: String(current?.deliveredAt ?? fallback[documentItem.key].deliveredAt),
      };
      return accumulator;
    },
    {} as Record<DocumentKey, DocumentEntry>,
  );
}

function activityOptionLabel(activity: ActivityCatalogItem) {
  return `${activity.code} - ${activity.description}`;
}

function buildDefaultForm(project: ProjectItem, schedule?: ScheduleItem, nextDate?: string, nextTeamId?: string): ModalState {
  return {
    scheduleId: schedule?.id ?? null,
    projectId: project.id,
    teamId: nextTeamId ?? schedule?.teamId ?? "",
    date: nextDate ?? schedule?.date ?? INITIAL_PERIOD_START,
    form: {
      period: schedule?.period ?? "integral",
      startTime: schedule?.startTime ?? "08:00",
      endTime: schedule?.endTime ?? "17:00",
      activities: schedule?.activities.length ? schedule.activities.map((activity) => ({ ...activity })) : [],
      activitySearch: "",
      activityQuantity: "1",
      documents: schedule ? createDocuments(schedule.documents) : createEmptyDocuments(),
      feeder: schedule?.feeder ?? "",
      supportItemId: schedule?.supportItemId ?? project.defaultSupportItemId ?? "",
      note: schedule?.note ?? project.note,
    },
  };
}

function getDocumentState(document: DocumentEntry) {
  if (document.number && document.deliveredAt) {
    return "complete";
  }

  if (document.number || document.includedAt) {
    return "partial";
  }

  return "missing";
}

function detectScheduleIssue(note: string) {
  const normalizedNote = note.trim().toLowerCase();
  if (!normalizedNote) {
    return false;
  }

  return ["atras", "penden", "problema", "issue", "delay"].some((term) => normalizedNote.includes(term));
}

function getScheduleTone(schedule: ScheduleItem): ScheduleTone {
  if (schedule.status === "CANCELADA") {
    return "cancelled";
  }

  if (schedule.status === "ADIADA") {
    return "postponed";
  }

  if (schedule.hasIssue) {
    return "issue";
  }

  if (schedule.wasRescheduled) {
    return "rescheduled";
  }

  const states = DOCUMENT_KEYS.map((item) => getDocumentState(schedule.documents[item.key]));
  if (states.every((item) => item === "complete")) {
    return "complete";
  }

  if (states.some((item) => item !== "missing")) {
    return "partial";
  }

  return "planned";
}

function sortSchedules(items: ScheduleItem[]) {
  return [...items].sort((left, right) => {
    if (left.date === right.date) {
      return left.startTime.localeCompare(right.startTime);
    }

    return left.date.localeCompare(right.date);
  });
}

export function priorityClassName(priority: string) {
  const normalizedPriority = priority.trim().toLowerCase();

  if (normalizedPriority.includes("alta")) {
    return styles.priorityHigh;
  }

  if (normalizedPriority.includes("media") || normalizedPriority.includes("média")) {
    return styles.priorityMedium;
  }

  return styles.priorityLow;
}

function toneClassName(tone: ScheduleTone) {
  if (tone === "cancelled") {
    return styles.scheduleCardCancelled;
  }

  if (tone === "postponed") {
    return styles.scheduleCardPostponed;
  }

  if (tone === "rescheduled") {
    return styles.scheduleCardRescheduled;
  }

  if (tone === "complete") {
    return styles.scheduleCardComplete;
  }

  if (tone === "partial") {
    return styles.scheduleCardPartial;
  }

  if (tone === "issue") {
    return styles.scheduleCardIssue;
  }

  return styles.scheduleCardPlanned;
}

function workloadBarClassName(loadStatus: TeamSummaryItem["loadStatus"]) {
  if (loadStatus === "WARNING") {
    return `${styles.workloadBar} ${styles.workloadBarWarning}`;
  }

  if (loadStatus === "OVERLOAD") {
    return `${styles.workloadBar} ${styles.workloadBarOverload}`;
  }

  return `${styles.workloadBar} ${styles.workloadBarNormal}`;
}

function workloadStatusLabel(summary?: TeamSummaryItem) {
  if (!summary || summary.workedDays <= 0) {
    return "Folga";
  }

  if (summary.loadStatus === "WARNING") {
    return "Alerta";
  }

  if (summary.loadStatus === "OVERLOAD") {
    return "Sobrecarga";
  }

  return "Normal";
}

function workloadPrimaryLabel(summary?: TeamSummaryItem) {
  if (!summary || summary.workedDays <= 0) {
    return "Carga livre";
  }

  return `Carga: ${summary.workedDays}/${summary.capacityDays} dias`;
}

function normalizeSchedule(
  item: NonNullable<ProgrammingResponse["schedules"]>[number],
): ScheduleItem {
  return {
    id: item.id,
    projectId: item.projectId,
    teamId: item.teamId,
    status: item.status,
    date: item.date,
    period: item.period,
    startTime: item.startTime,
    endTime: item.endTime,
    expectedMinutes: Number(item.expectedMinutes ?? 0),
    updatedAt: item.updatedAt,
    activities: (item.activities ?? []).map((activity) => ({
      catalogId: activity.catalogId,
      code: activity.code,
      description: activity.description,
      quantity: Number(activity.quantity ?? 0),
      unit: activity.unit,
    })),
    documents: createDocuments(item.documents),
    feeder: item.feeder ?? "",
    support: item.support ?? "",
    supportItemId: item.supportItemId ?? null,
    note: item.note ?? "",
    projectBase: item.projectBase ?? "Sem base",
    statusReason: item.statusReason ?? "",
    statusChangedAt: item.statusChangedAt ?? "",
    hasIssue: detectScheduleIssue(item.note ?? ""),
    wasRescheduled: Boolean(item.wasRescheduled),
    lastReschedule: item.lastReschedule
      ? {
          id: item.lastReschedule.id ?? "",
          changedAt: item.lastReschedule.changedAt ?? "",
          reason: item.lastReschedule.reason ?? "",
          fromDate: item.lastReschedule.fromDate ?? "",
          toDate: item.lastReschedule.toDate ?? "",
        }
      : null,
  };
}

function buildConflictFeedbackMessage(payload: SaveProgrammingResponse | null, fallback: string) {
  if (payload?.error !== "conflict") {
    return payload?.message ?? fallback;
  }

  const updatedBy = payload.updatedBy?.trim();
  const updatedAt = payload.currentUpdatedAt ? formatDisplayDateTime(payload.currentUpdatedAt) : "";
  const changedFields = Array.isArray(payload.changedFields) && payload.changedFields.length
    ? ` Campos em conflito: ${payload.changedFields.join(", ")}.`
    : "";

  return `${payload.message ?? fallback}${updatedBy || updatedAt ? ` Alterada por ${updatedBy ?? "outro usuario"}${updatedAt ? ` em ${updatedAt}` : ""}.` : ""}${changedFields}`;
}

function findActivityOption(value: string, options: ActivityCatalogItem[]) {
  const normalizedValue = value.trim().toLowerCase();
  if (!normalizedValue) {
    return null;
  }

  return (
    options.find((activity) => {
      return (
        activity.code.toLowerCase() === normalizedValue ||
        activityOptionLabel(activity).toLowerCase() === normalizedValue
      );
    }) ?? null
  );
}

function buildIncludedAtLabel(
  documentKey: DocumentKey,
  document: DocumentEntry,
  previousSchedule?: ScheduleItem,
) {
  if (!document.number.trim()) {
    return "";
  }

  const previousNumber = previousSchedule?.documents[documentKey].number.trim() ?? "";
  if (previousNumber && previousNumber !== document.number.trim()) {
    return "Atualizada ao salvar";
  }

  if (document.includedAt) {
    return formatDisplayDate(document.includedAt);
  }

  return "Automatica ao salvar";
}

export function ProgrammingPageView() {
  const { session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [periodStart, setPeriodStart] = useState(INITIAL_PERIOD_START);
  const [pendingSearch, setPendingSearch] = useState("");
  const [pendingBaseFilter, setPendingBaseFilter] = useState("Todas");
  const [pendingCityFilter, setPendingCityFilter] = useState("Todas");
  const [pendingTypeFilter, setPendingTypeFilter] = useState("Todas");
  const [boardBaseFilter, setBoardBaseFilter] = useState("Todas");
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [teams, setTeams] = useState<TeamItem[]>([]);
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [draggingItem, setDraggingItem] = useState<DragPayload | null>(null);
  const [activeDropSlot, setActiveDropSlot] = useState<string | null>(null);
  const [modalState, setModalState] = useState<ModalState | null>(null);
  const [cancelModalState, setCancelModalState] = useState<CancelModalState | null>(null);
  const [reprogramModalState, setReprogramModalState] = useState<ReprogramModalState | null>(null);
  const [copyModalState, setCopyModalState] = useState<CopyModalState | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [reprogramReason, setReprogramReason] = useState("");
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [isBoardLoading, setIsBoardLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [activityOptions, setActivityOptions] = useState<ActivityCatalogItem[]>([]);
  const [supportOptions, setSupportOptions] = useState<SupportOptionItem[]>([]);
  const [teamSummaries, setTeamSummaries] = useState<TeamSummaryItem[]>([]);

  const visibleDates = createVisibleDates(periodStart, viewMode);
  const rangeStart = visibleDates[0] ?? INITIAL_PERIOD_START;
  const rangeEnd = visibleDates[visibleDates.length - 1] ?? rangeStart;
  const periodLabel = formatPeriodLabel(visibleDates);
  const deferredActivitySearch = useDeferredValue(modalState?.form.activitySearch ?? "");

  const pendingBaseOptions = ["Todas", ...Array.from(new Set(projects.map((item) => item.base)))];
  const boardBaseOptions = ["Todas", ...Array.from(new Set(teams.map((item) => item.serviceCenterName || "Sem base")))];
  const cityOptions = ["Todas", ...Array.from(new Set(projects.map((item) => item.city)))];
  const serviceTypeOptions = ["Todas", ...Array.from(new Set(projects.map((item) => item.serviceType)))];
  const teamSelectionOptions = teams.filter(
    (team) => boardBaseFilter === "Todas" || (team.serviceCenterName || "Sem base") === boardBaseFilter,
  );
  const activeSelectedTeamIds = selectedTeamIds.filter((teamId) => teamSelectionOptions.some((team) => team.id === teamId));
  const visibleTeams = teams.filter(
    (team) =>
      teamSelectionOptions.some((option) => option.id === team.id) &&
      (activeSelectedTeamIds.length === 0 || activeSelectedTeamIds.includes(team.id)),
  );
  const visibleTeamIds = new Set(visibleTeams.map((team) => team.id));
  const filteredBoardSchedules = schedules.filter((item) => visibleTeamIds.has(item.teamId));
  const teamSummaryMap = new Map(teamSummaries.map((item) => [item.teamId, item]));
  const projectOccurrencesInPeriod = schedules.reduce((accumulator, schedule) => {
    if (!visibleDates.includes(schedule.date)) {
      return accumulator;
    }

    accumulator.set(schedule.projectId, (accumulator.get(schedule.projectId) ?? 0) + 1);
    return accumulator;
  }, new Map<string, number>());
  const programmedProjectOccurrences = schedules.reduce((accumulator, schedule) => {
    if (!visibleDates.includes(schedule.date) || schedule.status !== "PROGRAMADA") {
      return accumulator;
    }

    accumulator.set(schedule.projectId, (accumulator.get(schedule.projectId) ?? 0) + 1);
    return accumulator;
  }, new Map<string, number>());
  const filteredPendingProjects = projects.filter((project) => {
    if (pendingSearch.trim()) {
      const query = pendingSearch.trim().toLowerCase();
      const matchesText =
        project.code.toLowerCase().includes(query) ||
        project.serviceType.toLowerCase().includes(query) ||
        project.city.toLowerCase().includes(query);

      if (!matchesText) {
        return false;
      }
    }

    if (pendingBaseFilter !== "Todas" && project.base !== pendingBaseFilter) {
      return false;
    }

    if (pendingCityFilter !== "Todas" && project.city !== pendingCityFilter) {
      return false;
    }

    if (pendingTypeFilter !== "Todas" && project.serviceType !== pendingTypeFilter) {
      return false;
    }

    return true;
  });
  const pendingProjectsCount = filteredPendingProjects.filter((project) => !programmedProjectOccurrences.has(project.id)).length;
  const pendingProjects = filteredPendingProjects.slice(0, 5);
  const totalTeams = teamSelectionOptions.length;
  const selectedTeamsCount = visibleTeams.length;
  const scheduledInPeriod = filteredBoardSchedules.filter(
    (item) => visibleDates.includes(item.date) && item.status === "PROGRAMADA",
  );
  const totalWorkload = visibleTeams.reduce(
    (total, team) => total + (teamSummaryMap.get(team.id)?.loadPercent ?? 0),
    0,
  );
  const averageWorkload = visibleTeams.length ? Math.round(totalWorkload / visibleTeams.length) : 0;
  const freeTeams = visibleTeams.filter((team) => (teamSummaryMap.get(team.id)?.workedDays ?? 0) === 0).length;
  const timelineStyle = {
    gridTemplateColumns: `repeat(${visibleDates.length}, minmax(${viewMode === "week" ? 96 : 180}px, 1fr))`,
  } satisfies CSSProperties;
  const activeProject = modalState ? projects.find((item) => item.id === modalState.projectId) ?? null : null;
  const activeTeam = modalState ? teams.find((item) => item.id === modalState.teamId) ?? null : null;
  const editingSchedule = modalState?.scheduleId
    ? schedules.find((item) => item.id === modalState.scheduleId) ?? null
    : null;
  const expectedDuration = modalState
    ? formatDuration(calculateExpectedMinutes(modalState.form.startTime, modalState.form.endTime, modalState.form.period))
    : "0h";
  const canSubmitCancellation = cancelReason.trim().length >= CHANGE_REASON_MIN_LENGTH && !isCancelling;
  const canSubmitReprogram = reprogramReason.trim().length >= CHANGE_REASON_MIN_LENGTH && !isSaving;
  const selectedTeamSummaryLabel =
    activeSelectedTeamIds.length === 0 || activeSelectedTeamIds.length === teamSelectionOptions.length
      ? "Todas"
      : `${activeSelectedTeamIds.length} selecionada(s)`;
  const copySourceTeams = teamSelectionOptions.filter((team) =>
    schedules.some(
      (schedule) =>
        schedule.teamId === team.id &&
        schedule.status === "PROGRAMADA" &&
        visibleDates.includes(schedule.date),
    ),
  );
  const copyTargetTeams = copyModalState
    ? teamSelectionOptions.filter((team) => team.id !== copyModalState.sourceTeamId)
    : [];

  useEffect(() => {
    setSelectedTeamIds((current) => current.filter((teamId) => teams.some((team) => team.id === teamId)));
  }, [teams]);

  useEffect(() => {
    setCopyModalState((current) => {
      if (!current) {
        return current;
      }

      const sourceExists = copySourceTeams.some((team) => team.id === current.sourceTeamId);
      if (!sourceExists) {
        if (!copySourceTeams.length) {
          return null;
        }

        const nextSourceTeamId = copySourceTeams[0].id;
        const nextTargetTeamIds = current.targetTeamIds.filter((teamId) => teamId !== nextSourceTeamId);
        return {
          sourceTeamId: nextSourceTeamId,
          targetTeamIds: nextTargetTeamIds,
        };
      }

      const allowedTargetIds = new Set(
        teamSelectionOptions.filter((team) => team.id !== current.sourceTeamId).map((team) => team.id),
      );
      const nextTargetTeamIds = current.targetTeamIds.filter((teamId) => allowedTargetIds.has(teamId));
      if (nextTargetTeamIds.length === current.targetTeamIds.length) {
        return current;
      }

      return {
        ...current,
        targetTeamIds: nextTargetTeamIds,
      };
    });
  }, [copySourceTeams, teamSelectionOptions]);

  const applyBoardSnapshot = useCallback((data: ProgrammingResponse | null) => {
    setProjects(data?.projects ?? []);
    setTeams(data?.teams ?? []);
    setSupportOptions(data?.supportOptions ?? []);
    setTeamSummaries(data?.teamSummaries ?? []);
    setSchedules(sortSchedules((data?.schedules ?? []).map(normalizeSchedule)));
  }, []);

  const fetchBoardSnapshot = useCallback(async () => {
    if (!accessToken) {
      return null;
    }

    setIsBoardLoading(true);
    try {
      const response = await fetch(`/api/programacao?startDate=${rangeStart}&endDate=${rangeEnd}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });

      const data = (await response.json().catch(() => null)) as ProgrammingResponse | null;
      if (!response.ok) {
        throw new Error(data?.message ?? "Falha ao carregar programacao.");
      }

      return data;
    } finally {
      setIsBoardLoading(false);
    }
  }, [accessToken, rangeEnd, rangeStart]);

  const loadBoardData = useCallback(async () => {
    try {
      const data = await fetchBoardSnapshot();
      applyBoardSnapshot(data);
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Falha ao carregar programacao.",
      });
    }
  }, [applyBoardSnapshot, fetchBoardSnapshot]);

  useEffect(() => {
    void loadBoardData();
  }, [loadBoardData]);

  useEffect(() => {
    if (!accessToken || !modalState || deferredActivitySearch.trim().length < 2) {
      setActivityOptions([]);
      return;
    }

    let ignore = false;

    async function loadCatalog() {
      try {
        const response = await fetch(
          `/api/projects/activity-forecast/catalog?q=${encodeURIComponent(deferredActivitySearch.trim())}`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            cache: "no-store",
          },
        );

        const data = (await response.json().catch(() => null)) as ActivityCatalogResponse | null;
        if (!response.ok) {
          throw new Error(data?.message ?? "Falha ao pesquisar atividades.");
        }

        if (ignore) {
          return;
        }

        setActivityOptions(
          (data?.items ?? []).map((item) => ({
            id: item.id,
            code: item.code,
            description: item.description,
            unit: item.unit,
          })),
        );
      } catch {
        if (!ignore) {
          setActivityOptions([]);
        }
      }
    }

    void loadCatalog();

    return () => {
      ignore = true;
    };
  }, [accessToken, deferredActivitySearch, modalState]);

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!modalState && !cancelModalState && !reprogramModalState && !copyModalState) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [cancelModalState, copyModalState, modalState, reprogramModalState]);

  function shiftPeriod(direction: "previous" | "next") {
    const step = viewMode === "week" ? 7 : 1;
    setPeriodStart((current) => addDays(current, direction === "previous" ? -step : step));
  }

  function toggleTeamSelection(teamId: string) {
    setSelectedTeamIds((current) =>
      current.includes(teamId) ? current.filter((item) => item !== teamId) : [...current, teamId],
    );
  }

  function clearTeamSelection() {
    setSelectedTeamIds([]);
  }

  function openScheduleModalFromDrop(teamId: string, date: string) {
    if (!draggingItem) {
      return;
    }

    if (draggingItem.kind === "project") {
      const project = projects.find((item) => item.id === draggingItem.projectId);
      if (!project) {
        return;
      }

      setModalState(buildDefaultForm(project, undefined, date, teamId));
      setFeedback(null);
      setActiveDropSlot(null);
      return;
    }

    const existingSchedule = schedules.find((item) => item.id === draggingItem.scheduleId);
    if (!existingSchedule) {
      return;
    }

    const project = projects.find((item) => item.id === existingSchedule.projectId);
    if (!project) {
      return;
    }

    setModalState(buildDefaultForm(project, existingSchedule, date, teamId));
    setFeedback(null);
    setActiveDropSlot(null);
  }

  function openScheduleModalFromCard(scheduleId: string) {
    const schedule = schedules.find((item) => item.id === scheduleId);
    if (!schedule) {
      return;
    }

    const project = projects.find((item) => item.id === schedule.projectId);
    if (!project) {
      return;
    }

    setModalState(buildDefaultForm(project, schedule));
    setFeedback(null);
  }

  function openCancellationModal() {
    openStatusModal("cancel");
  }

  function openPostponeModal() {
    openStatusModal("postpone");
  }

  function openStatusModal(action: StatusAction) {
    if (!editingSchedule || !activeProject) {
      return;
    }

    setCancelModalState({
      scheduleId: editingSchedule.id,
      projectCode: activeProject.code,
      expectedUpdatedAt: editingSchedule.updatedAt,
      action,
    });
    setCancelReason("");
    setFeedback(null);
  }

  function closeCancellationModal() {
    if (isCancelling) {
      return;
    }

    setCancelModalState(null);
    setCancelReason("");
  }

  function closeReprogramModal() {
    if (isSaving) {
      return;
    }

    setReprogramModalState(null);
    setReprogramReason("");
  }

  function toggleCopyTargetTeam(teamId: string) {
    setCopyModalState((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        targetTeamIds: current.targetTeamIds.includes(teamId)
          ? current.targetTeamIds.filter((item) => item !== teamId)
          : [...current.targetTeamIds, teamId],
      };
    });
  }

  function updateCopySourceTeam(teamId: string) {
    setCopyModalState((current) =>
      current
        ? {
            sourceTeamId: teamId,
            targetTeamIds: current.targetTeamIds.filter((item) => item !== teamId),
          }
        : current,
    );
  }

  function openCopyModal() {
    if (!copySourceTeams.length) {
      setFeedback({
        type: "error",
        message: "Nenhuma equipe possui programacoes ativas no periodo visivel para copiar.",
      });
      return;
    }

    setFeedback(null);
    setCopyModalState({
      sourceTeamId: copySourceTeams[0].id,
      targetTeamIds: [],
    });
  }

  function closeCopyModal() {
    setCopyModalState(null);
  }

  function updateModalField<Key extends keyof ScheduleFormState>(field: Key, value: ScheduleFormState[Key]) {
    setModalState((current) => (current ? { ...current, form: { ...current.form, [field]: value } } : current));
  }

  function updateDocumentField(documentKey: DocumentKey, field: keyof DocumentEntry, value: string) {
    setModalState((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        form: {
          ...current.form,
          documents: {
            ...current.form.documents,
            [documentKey]: {
              ...current.form.documents[documentKey],
              [field]: value,
            },
          },
        },
      };
    });
  }

  function addActivity() {
    setModalState((current) => {
      if (!current) {
        return current;
      }

      const selectedActivity = findActivityOption(current.form.activitySearch, activityOptions);
      const quantity = Number(current.form.activityQuantity);

      if (!selectedActivity || !Number.isFinite(quantity) || quantity <= 0) {
        setFeedback({
          type: "error",
          message: "Selecione uma atividade valida e informe uma quantidade maior que zero.",
        });
        return current;
      }

      const existingActivityIndex = current.form.activities.findIndex((activity) => activity.catalogId === selectedActivity.id);
      const nextActivities = [...current.form.activities];

      if (existingActivityIndex >= 0) {
        nextActivities[existingActivityIndex] = {
          ...nextActivities[existingActivityIndex],
          quantity,
        };
      } else {
        nextActivities.push({
          catalogId: selectedActivity.id,
          code: selectedActivity.code,
          description: selectedActivity.description,
          quantity,
          unit: selectedActivity.unit,
        });
      }

      setFeedback(null);

      return {
        ...current,
        form: {
          ...current.form,
          activities: nextActivities,
          activitySearch: "",
          activityQuantity: "1",
        },
      };
    });
  }

  function updateActivityDraft(field: "activitySearch" | "activityQuantity", value: string) {
    setModalState((current) =>
      current
        ? {
            ...current,
            form: {
              ...current.form,
              [field]: value,
            },
          }
        : current,
    );
  }

  function updateActivityQuantity(index: number, value: string) {
    const quantity = Number(value);

    setModalState((current) => {
      if (!current) {
        return current;
      }

      const nextActivities = [...current.form.activities];
      if (!Number.isFinite(quantity) || quantity <= 0 || !nextActivities[index]) {
        return current;
      }

      nextActivities[index] = {
        ...nextActivities[index],
        quantity,
      };

      return {
        ...current,
        form: {
          ...current.form,
          activities: nextActivities,
        },
      };
    });
  }

  function removeActivity(index: number) {
    setModalState((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        form: {
          ...current.form,
          activities: current.form.activities.filter((_, activityIndex) => activityIndex !== index),
        },
      };
    });
  }

  function handlePeriodModeChange(period: PeriodMode) {
    setModalState((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        form: {
          ...current.form,
          period,
          startTime: "08:00",
          endTime: period === "integral" ? "17:00" : "12:00",
        },
      };
    });
  }

  async function refreshBoardAfterMutation(successMessage: string, warning?: string | null) {
    try {
      const boardData = await fetchBoardSnapshot();
      applyBoardSnapshot(boardData);
    } catch {
      if (!warning) {
        setFeedback({
          type: "success",
          message: `${successMessage} Programacao salva com sucesso, mas houve falha ao atualizar a visualizacao.`,
        });
      }
    }
  }

  async function persistSchedule(payload: SaveRequestPayload) {
    if (!accessToken) {
      return;
    }

    setIsSaving(true);

    try {
      const method = payload.id ? "PUT" : "POST";
      const response = await fetch("/api/programacao", {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json().catch(() => null)) as SaveProgrammingResponse | null;
      if (!response.ok) {
        throw new Error(buildConflictFeedbackMessage(data, "Falha ao salvar programacao."));
      }

      setModalState(null);
      setCancelModalState(null);
      setReprogramModalState(null);
      setCancelReason("");
      setReprogramReason("");
      const successMessage = data?.message ?? "Programacao salva com sucesso.";
      setFeedback({
        type: "success",
        message: successMessage,
      });
      await refreshBoardAfterMutation(successMessage, data?.warning);
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Falha ao salvar programacao.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!modalState || !accessToken) {
      return;
    }

    const expectedMinutes = calculateExpectedMinutes(
      modalState.form.startTime,
      modalState.form.endTime,
      modalState.form.period,
    );

    if (expectedMinutes <= 0) {
      setFeedback({
        type: "error",
        message: "Informe um horario valido para a programacao.",
      });
      return;
    }

    const payload: SaveRequestPayload = {
      id: modalState.scheduleId ?? undefined,
      projectId: modalState.projectId,
      teamId: modalState.teamId,
      date: modalState.date,
      period: modalState.form.period,
      startTime: modalState.form.startTime,
      endTime: modalState.form.endTime,
      expectedMinutes,
      feeder: modalState.form.feeder.trim(),
      supportItemId: modalState.form.supportItemId || undefined,
      note: modalState.form.note.trim(),
      expectedUpdatedAt: editingSchedule?.updatedAt ?? undefined,
      documents: DOCUMENT_KEYS.reduce(
        (accumulator, documentItem) => {
          const currentDocument = modalState.form.documents[documentItem.key];
          accumulator[documentItem.key] = {
            number: currentDocument.number.trim(),
            deliveredAt: currentDocument.deliveredAt,
          };
          return accumulator;
        },
        {} as Record<DocumentKey, { number: string; deliveredAt: string }>,
      ),
      activities: modalState.form.activities
        .filter((item) => item.quantity > 0)
        .map((item) => ({
          catalogId: item.catalogId,
          quantity: item.quantity,
        })),
    };

    const currentSchedule = editingSchedule;
    const isReschedule = currentSchedule?.status === "PROGRAMADA"
      ? (
          currentSchedule.date !== payload.date ||
          currentSchedule.teamId !== payload.teamId ||
          currentSchedule.startTime !== payload.startTime ||
          currentSchedule.endTime !== payload.endTime
        )
      : false;

    if (isReschedule && activeProject) {
      setReprogramModalState({
        projectCode: activeProject.code,
        payload,
      });
      setReprogramReason("");
      return;
    }

    await persistSchedule(payload);
  }

  async function handleConfirmReprogram() {
    if (!reprogramModalState || reprogramReason.trim().length < CHANGE_REASON_MIN_LENGTH) {
      return;
    }

    await persistSchedule({
      ...reprogramModalState.payload,
      changeReason: reprogramReason.trim(),
    });
  }

  async function handleCancelSchedule() {
    if (!accessToken || !cancelModalState || !cancelReason.trim()) {
      return;
    }

    setIsCancelling(true);

    try {
      const response = await fetch("/api/programacao", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: cancelModalState.scheduleId,
          action: cancelModalState.action === "postpone" ? "ADIAR" : "CANCELAR",
          reason: cancelReason.trim(),
          expectedUpdatedAt: cancelModalState.expectedUpdatedAt,
        }),
      });

      const data = (await response.json().catch(() => null)) as SaveProgrammingResponse | null;
      if (!response.ok) {
        throw new Error(buildConflictFeedbackMessage(data, "Falha ao alterar status da programacao."));
      }

      setModalState(null);
      setCancelModalState(null);
      setCancelReason("");
      const successMessage =
        data?.message ??
        (cancelModalState.action === "postpone"
          ? `Programacao do projeto ${cancelModalState.projectCode} adiada com sucesso.`
          : `Programacao do projeto ${cancelModalState.projectCode} cancelada com sucesso.`);
      setFeedback({
        type: "success",
        message: successMessage,
      });
      await refreshBoardAfterMutation(successMessage, data?.warning);
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Falha ao alterar status da programacao.",
      });
    } finally {
      setIsCancelling(false);
    }
  }

  async function handleCopyProgramming() {
    if (!accessToken || !copyModalState || !copyModalState.targetTeamIds.length) {
      return;
    }

    setIsCopying(true);

    try {
      const response = await fetch("/api/programacao", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "COPY",
          sourceTeamId: copyModalState.sourceTeamId,
          targetTeamIds: copyModalState.targetTeamIds,
          startDate: rangeStart,
          endDate: rangeEnd,
        }),
      });

      const data = (await response.json().catch(() => null)) as CopyProgrammingResponse | null;
      if (!response.ok) {
        throw new Error(data?.message ?? "Falha ao copiar programacao para as equipes selecionadas.");
      }
      const successMessage = data?.message ?? "Programacao copiada com sucesso.";
      setFeedback({
        type: "success",
        message: successMessage,
      });
      setCopyModalState(null);
      await refreshBoardAfterMutation(successMessage);
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Falha ao copiar programacao.",
      });
    } finally {
      setIsCopying(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>, teamId: string, date: string) {
    event.preventDefault();
    openScheduleModalFromDrop(teamId, date);
    setDraggingItem(null);
  }

  return (
    <section className={styles.page}>
      {feedback ? (
        <div className={feedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError}>{feedback.message}</div>
      ) : null}

      <div className={styles.surface}>
        <aside className={styles.pendingPanel}>
          <header className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>Operacao</p>
              <h2>Projetos Pendentes</h2>
            </div>
            <span className={styles.counter}>{pendingProjectsCount}</span>
          </header>

          <div className={styles.pendingFilters}>
            <label className={styles.searchField}>
              <span className={styles.searchLabel}>Buscar projeto...</span>
              <input
                type="search"
                value={pendingSearch}
                onChange={(event) => setPendingSearch(event.target.value)}
                placeholder="Buscar projeto..."
              />
            </label>

            <div className={styles.filterGrid}>
              <label className={styles.field}>
                <span>Base</span>
                <select value={pendingBaseFilter} onChange={(event) => setPendingBaseFilter(event.target.value)}>
                  {pendingBaseOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.field}>
                <span>Cidade</span>
                <select value={pendingCityFilter} onChange={(event) => setPendingCityFilter(event.target.value)}>
                  {cityOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label className={`${styles.field} ${styles.fieldWide}`}>
                <span>Servico</span>
                <select value={pendingTypeFilter} onChange={(event) => setPendingTypeFilter(event.target.value)}>
                  {serviceTypeOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className={styles.pendingList}>
            {isBoardLoading && !projects.length ? (
              <div className={styles.emptyState}>Carregando backlog de programacao...</div>
            ) : null}

            {!isBoardLoading && !filteredPendingProjects.length ? (
              <div className={styles.emptyState}>
                Nenhum projeto pendente para os filtros atuais.
              </div>
            ) : null}

            {!isBoardLoading && filteredPendingProjects.length > pendingProjects.length ? (
              <div className={styles.listHelper}>
                Exibindo os 5 primeiros projetos filtrados para facilitar a leitura.
              </div>
            ) : null}

            {pendingProjects.map((project) => (
              <article
                key={project.id}
                className={
                  projectOccurrencesInPeriod.has(project.id)
                    ? `${styles.projectCard} ${styles.projectCardScheduled}`
                    : styles.projectCard
                }
                draggable
                onDragStart={() => {
                  setDraggingItem({ kind: "project", projectId: project.id });
                  setFeedback(null);
                }}
                onDragEnd={() => {
                  setDraggingItem(null);
                  setActiveDropSlot(null);
                }}
              >
                <div className={styles.projectCardTop}>
                  <strong>{project.code}</strong>
                  <span className={`${styles.priorityTag} ${priorityClassName(project.priority)}`}>{project.priority}</span>
                </div>

                <div className={styles.projectMeta}>
                  <span>{project.city}</span>
                </div>

                <div className={styles.projectFooter}>
                  <div className={styles.projectBadges}>
                    <span className={styles.serviceTypeTag}>{project.serviceType}</span>
                    <span className={project.hasLocacao ? styles.locationReadyTag : styles.locationPendingTag}>
                      {project.hasLocacao ? "Locacao OK" : "Sem locacao"}
                    </span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </aside>

        <div className={styles.boardPanel}>
          <header className={styles.boardHeader}>
            <div className={styles.boardTitle}>
              <div>
                <p className={styles.eyebrow}>Planejamento</p>
                <h2>Programacao de Equipes</h2>
              </div>

              <div className={styles.headerStats}>
                <div className={styles.statCard}>
                  <span>Programadas</span>
                  <strong>{scheduledInPeriod.length}</strong>
                </div>
                <div className={styles.statCard}>
                  <span>Carga media</span>
                  <strong>{averageWorkload}%</strong>
                </div>
                <div className={`${styles.statCard} ${styles.statCardWide}`}>
                  <span>Equipes</span>
                  <div className={styles.teamStatRows}>
                    <div className={styles.teamStatRow}>
                      <div className={styles.teamStatInfo}>
                        <small>Total</small>
                        <strong>{totalTeams}</strong>
                      </div>
                      <div className={`${styles.teamStatBar} ${styles.teamStatBarTotal}`}>
                        <span style={{ width: totalTeams > 0 ? "100%" : "0%" }} />
                      </div>
                    </div>
                    <div className={styles.teamStatRow}>
                      <div className={styles.teamStatInfo}>
                        <small>Livres</small>
                        <strong>{freeTeams}</strong>
                      </div>
                      <div className={`${styles.teamStatBar} ${styles.teamStatBarFree}`}>
                        <span style={{ width: totalTeams > 0 ? `${(freeTeams / totalTeams) * 100}%` : "0%" }} />
                      </div>
                    </div>
                    <div className={styles.teamStatRow}>
                      <div className={styles.teamStatInfo}>
                        <small>Selecionadas</small>
                        <strong>{selectedTeamsCount}</strong>
                      </div>
                      <div className={`${styles.teamStatBar} ${styles.teamStatBarSelected}`}>
                        <span
                          style={{ width: totalTeams > 0 ? `${(selectedTeamsCount / totalTeams) * 100}%` : "0%" }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className={styles.toolbar}>
              <div className={styles.periodBlock}>
                <span className={styles.periodLabel}>Periodo: {periodLabel}</span>
                <div className={styles.periodActions}>
                  <button type="button" className={styles.iconButton} onClick={() => shiftPeriod("previous")}>
                    &lt;
                  </button>
                  <button type="button" className={styles.iconButton} onClick={() => shiftPeriod("next")}>
                    &gt;
                  </button>
                </div>
              </div>

              <label className={styles.inlineField}>
                <span>Base</span>
                <select value={boardBaseFilter} onChange={(event) => setBoardBaseFilter(event.target.value)}>
                  {boardBaseOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <details className={styles.teamFilterMenu}>
                <summary className={styles.teamFilterTrigger}>
                  Equipes: {selectedTeamSummaryLabel}
                </summary>

                <div className={styles.teamFilterPopover}>
                  <button type="button" className={styles.ghostButton} onClick={clearTeamSelection}>
                    Mostrar todas
                  </button>

                  <div className={styles.teamFilterList}>
                    {teamSelectionOptions.map((team) => (
                      <label key={team.id} className={styles.teamFilterOption}>
                        <input
                          type="checkbox"
                          checked={activeSelectedTeamIds.includes(team.id)}
                          onChange={() => toggleTeamSelection(team.id)}
                        />
                        <span>{team.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </details>

              <button
                type="button"
                className={styles.secondaryButton}
                onClick={openCopyModal}
                disabled={!copySourceTeams.length || isBoardLoading}
              >
                Copiar programacao
              </button>

              <div className={styles.viewSwitcher}>
                <button
                  type="button"
                  className={viewMode === "week" ? styles.viewButtonActive : styles.viewButton}
                  onClick={() => setViewMode("week")}
                >
                  Semana
                </button>
                <button
                  type="button"
                  className={viewMode === "day" ? styles.viewButtonActive : styles.viewButton}
                  onClick={() => setViewMode("day")}
                >
                  Dia
                </button>
              </div>
            </div>
          </header>

          <div className={styles.timelineShell}>
            <div className={styles.timelineHeader}>
              <div className={styles.teamColumnHeader}>Equipes</div>
              <div className={styles.dateColumns} style={timelineStyle}>
                {visibleDates.map((date) => (
                  <div key={date} className={styles.dateHeaderCell}>
                    {formatBoardDate(date)}
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.timelineRows}>
              {!isBoardLoading && !teams.length ? (
                <div className={styles.emptyState}>Nenhuma equipe ativa encontrada para o tenant atual.</div>
              ) : null}

              {visibleTeams.map((team) => {
                const loadSummary = teamSummaryMap.get(team.id);
                const loadPercent = Math.max(loadSummary?.loadPercent ?? 0, 8);

                return (
                  <div key={team.id} className={styles.teamRow}>
                    <aside className={styles.teamSummary}>
                      <div className={styles.teamSummaryTop}>
                        <div>
                          <h3>{team.name}</h3>
                          <p>{team.foremanName}</p>
                        </div>
                        <span className={styles.teamBaseTag}>{team.serviceCenterName}</span>
                      </div>

                      <div className={styles.workloadBlock}>
                        <div className={styles.workloadLabel}>
                          <span>{workloadPrimaryLabel(loadSummary)}</span>
                          <span>{workloadStatusLabel(loadSummary)}</span>
                        </div>
                        <div className={workloadBarClassName(loadSummary?.loadStatus ?? "FREE")}>
                          <span style={{ width: `${loadPercent}%` }} />
                        </div>
                      </div>
                    </aside>

                    <div className={styles.teamTimeline} style={timelineStyle}>
                      {visibleDates.map((date) => {
                        const slotKey = `${team.id}-${date}`;
                        const slotSchedules = filteredBoardSchedules.filter(
                          (item) => item.teamId === team.id && item.date === date,
                        );

                        return (
                          <div
                            key={slotKey}
                            className={activeDropSlot === slotKey ? styles.timelineCellActive : styles.timelineCell}
                            onDragOver={(event) => event.preventDefault()}
                            onDragEnter={() => draggingItem && setActiveDropSlot(slotKey)}
                            onDrop={(event) => handleDrop(event, team.id, date)}
                          >
                            {slotSchedules.length ? (
                              slotSchedules.map((schedule) => {
                                const project = projects.find((item) => item.id === schedule.projectId);
                                if (!project) {
                                  return null;
                                }

                                const tone = getScheduleTone(schedule);

                                return (
                                  <button
                                    key={schedule.id}
                                    type="button"
                                    className={`${styles.scheduleCard} ${toneClassName(tone)}`}
                                    draggable
                                    onDragStart={() => {
                                      setDraggingItem({ kind: "schedule", scheduleId: schedule.id });
                                      setFeedback(null);
                                    }}
                                    onDragEnd={() => {
                                      setDraggingItem(null);
                                      setActiveDropSlot(null);
                                    }}
                                    onClick={() => openScheduleModalFromCard(schedule.id)}
                                  >
                                    <div className={styles.scheduleCardHeader}>
                                      <strong>{project.code}</strong>
                                    </div>
                                    <div className={styles.documentsRow}>
                                      {DOCUMENT_KEYS.map((documentItem) => {
                                        const state = getDocumentState(schedule.documents[documentItem.key]);

                                        return (
                                          <span key={documentItem.key} className={styles.documentStatus}>
                                            {documentItem.label}
                                            <i
                                              className={
                                                state === "complete"
                                                  ? styles.dotComplete
                                                  : state === "partial"
                                                    ? styles.dotPartial
                                                    : styles.dotMissing
                                              }
                                            />
                                          </span>
                                        );
                                      })}
                                    </div>
                                  </button>
                                );
                              })
                            ) : (
                              <div className={styles.emptyCell}>
                                <span>Livre</span>
                                <small>
                                  {draggingItem ? "Solte aqui para programar" : "Arraste um projeto para este slot"}
                                </small>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <footer className={styles.legend}>
            <span className={styles.legendItem}>
              <i className={styles.legendPlanned} />
              Planejado
            </span>
            <span className={styles.legendItem}>
              <i className={styles.legendRescheduled} />
              Reprogramada
            </span>
            <span className={styles.legendItem}>
              <i className={styles.legendPostponed} />
              Adiada
            </span>
            <span className={styles.legendItem}>
              <i className={styles.legendCancelled} />
              Cancelada
            </span>
            <span className={styles.legendItem}>
              <i className={styles.legendPartial} />
              Documentacao parcial
            </span>
            <span className={styles.legendItem}>
              <i className={styles.legendComplete} />
              Documentacao completa
            </span>
            <span className={styles.legendItem}>
              <i className={styles.legendIssue} />
              Atraso ou problema
            </span>
          </footer>
        </div>
      </div>

      <datalist id="programming-activity-list">
        {activityOptions.map((activity) => (
          <option key={activity.id} value={activityOptionLabel(activity)} />
        ))}
      </datalist>

      {modalState ? (
        <div className={styles.modalOverlay} onClick={() => !isSaving && !reprogramModalState && setModalState(null)}>
          <div className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.eyebrow}>Programacao</p>
                <h3>Programar Obra</h3>
              </div>
              <button
                type="button"
                className={styles.modalCloseButton}
                onClick={() => setModalState(null)}
                disabled={isSaving}
              >
                Fechar
              </button>
            </div>

            <form className={styles.modalBody} onSubmit={handleSaveSchedule}>
              <section className={styles.modalSection}>
                <div className={styles.sectionHeader}>
                  <h4>Informacoes basicas</h4>
                  <span>Tempo previsto: {expectedDuration}</span>
                </div>

                <div className={styles.modalGrid}>
                  <div className={styles.field}>
                    <span>ID da programacao</span>
                    <div className={styles.infoValue}>{modalState.scheduleId ?? "Nova programacao"}</div>
                  </div>
                  <div className={styles.field}>
                    <span>Projeto</span>
                    <div className={styles.infoValue}>
                      {activeProject ? `${activeProject.code} - ${activeProject.serviceName}` : ""}
                    </div>
                  </div>
                  <div className={styles.field}>
                    <span>Equipe</span>
                    <div className={styles.infoValue}>{activeTeam?.name ?? ""}</div>
                  </div>
                  <div className={styles.field}>
                    <span>Data de execucao</span>
                    <div className={styles.infoValue}>{formatDisplayDate(modalState.date)}</div>
                  </div>
                  <label className={styles.field}>
                    <span>Periodo</span>
                    <select
                      value={modalState.form.period}
                      onChange={(event) => handlePeriodModeChange(event.target.value as PeriodMode)}
                    >
                      <option value="integral">Integral</option>
                      <option value="partial">Parcial</option>
                    </select>
                  </label>
                </div>

                {editingSchedule?.lastReschedule ? (
                  <div className={styles.basicInfoMeta}>
                    <div className={styles.basicInfoMetaItem}>
                      <span>Ultima reprogramacao</span>
                      <strong>
                        {formatDisplayDate(editingSchedule.lastReschedule.fromDate)}
                        {" -> "}
                        {formatDisplayDate(editingSchedule.lastReschedule.toDate)}
                      </strong>
                      <small>Registrada em {formatDisplayDateTime(editingSchedule.lastReschedule.changedAt)}</small>
                    </div>
                    <div className={styles.basicInfoMetaItem}>
                      <span>ID da reprogramacao</span>
                      <strong>{editingSchedule.lastReschedule.id}</strong>
                      <small>
                        {editingSchedule.lastReschedule.reason
                          ? `Motivo: ${editingSchedule.lastReschedule.reason}`
                          : "Motivo nao informado"}
                      </small>
                    </div>
                  </div>
                ) : null}

                {editingSchedule?.status === "ADIADA" && editingSchedule.statusReason ? (
                  <div className={styles.basicInfoMeta}>
                    <div className={styles.basicInfoMetaItem}>
                      <span>Motivo do adiamento</span>
                      <strong>{editingSchedule.statusReason}</strong>
                      <small>
                        {editingSchedule.statusChangedAt
                          ? `Registrado em ${formatDisplayDateTime(editingSchedule.statusChangedAt)}`
                          : "Registrado no historico da programacao"}
                      </small>
                    </div>
                  </div>
                ) : null}
              </section>

              <section className={styles.modalSection}>
                <div className={styles.sectionHeader}>
                  <h4>Horario</h4>
                </div>

                <div className={styles.modalGrid}>
                  <label className={styles.field}>
                    <span>Hora inicio</span>
                    <input
                      type="time"
                      value={modalState.form.startTime}
                      onChange={(event) => updateModalField("startTime", event.target.value)}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Hora termino</span>
                    <input
                      type="time"
                      value={modalState.form.endTime}
                      onChange={(event) => updateModalField("endTime", event.target.value)}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Tempo previsto</span>
                    <input value={expectedDuration} readOnly />
                  </label>
                </div>
              </section>

              <section className={styles.modalSection}>
                <div className={styles.sectionHeader}>
                  <h4>Atividades</h4>
                  <button type="button" className={styles.secondaryButton} onClick={addActivity}>
                    Incluir atividade
                  </button>
                </div>

                <div className={styles.activityComposer}>
                  <label className={styles.field}>
                    <span>Codigo da atividade</span>
                    <input
                      list="programming-activity-list"
                      value={modalState.form.activitySearch}
                      onChange={(event) => updateActivityDraft("activitySearch", event.target.value)}
                      placeholder="Digite o codigo e selecione a atividade"
                    />
                  </label>

                  <label className={styles.field}>
                    <span>Quantidade</span>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={modalState.form.activityQuantity}
                      onChange={(event) => updateActivityDraft("activityQuantity", event.target.value)}
                    />
                  </label>
                </div>

                <div className={styles.activitiesList}>
                  {modalState.form.activities.length ? (
                    modalState.form.activities.map((activity, index) => (
                      <div key={activity.catalogId} className={styles.activityCard}>
                        <div className={styles.activityCardHeader}>
                          <strong>{activity.code}</strong>
                          <span>{activity.description}</span>
                        </div>

                        <div className={styles.activityCardBody}>
                          <label className={styles.field}>
                            <span>Quantidade</span>
                            <input
                              type="number"
                              min="0.01"
                              step="0.01"
                              value={activity.quantity}
                              onChange={(event) => updateActivityQuantity(index, event.target.value)}
                            />
                          </label>

                          <div className={styles.field}>
                            <span>Unidade</span>
                            <div className={styles.infoValue}>{activity.unit}</div>
                          </div>
                        </div>

                        <button type="button" className={styles.ghostButton} onClick={() => removeActivity(index)}>
                          Remover
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className={styles.emptyStateInline}>
                      Nenhuma atividade incluida nesta programacao.
                    </div>
                  )}
                </div>
              </section>

              <section className={styles.modalSection}>
                <div className={styles.sectionHeader}>
                  <h4>Documentos</h4>
                </div>

                <div className={styles.documentsGrid}>
                  {DOCUMENT_KEYS.map((documentItem) => {
                    const document = modalState.form.documents[documentItem.key];
                    const showDates = Boolean(document.number.trim());

                    return (
                      <div key={documentItem.key} className={styles.documentCard}>
                        <label className={styles.field}>
                          <span>{documentItem.label}</span>
                          <input
                            value={document.number}
                            onChange={(event) => updateDocumentField(documentItem.key, "number", event.target.value)}
                            placeholder={`Numero ${documentItem.label}`}
                          />
                        </label>

                        {showDates ? (
                          <div className={styles.documentDates}>
                            <div className={`${styles.field} ${styles.documentInfo}`}>
                              <span>Data inclusao</span>
                              <div className={styles.infoValue}>
                                {buildIncludedAtLabel(documentItem.key, document, editingSchedule ?? undefined)}
                              </div>
                            </div>

                            <label className={styles.field}>
                              <span>Data entrega</span>
                              <input
                                type="date"
                                value={document.deliveredAt}
                                onChange={(event) =>
                                  updateDocumentField(documentItem.key, "deliveredAt", event.target.value)
                                }
                              />
                            </label>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className={styles.modalSection}>
                <div className={styles.sectionHeader}>
                  <h4>Campos adicionais</h4>
                </div>

                <div className={styles.modalGrid}>
                  <label className={styles.field}>
                    <span>Alimentador</span>
                    <input
                      value={modalState.form.feeder}
                      onChange={(event) => updateModalField("feeder", event.target.value)}
                      placeholder="Ex.: AL-09"
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Apoio</span>
                    <select
                      value={modalState.form.supportItemId}
                      onChange={(event) => updateModalField("supportItemId", event.target.value)}
                    >
                      <option value="">Selecione o apoio</option>
                      {supportOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.description}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={`${styles.field} ${styles.fieldWide}`}>
                    <span>Anotacao</span>
                    <textarea
                      value={modalState.form.note}
                      onChange={(event) => updateModalField("note", event.target.value)}
                      rows={4}
                      placeholder="Observacoes operacionais, dependencia de documentos, apoio ou riscos."
                    />
                  </label>
                </div>
                {activeProject?.defaultSupportItemId ? (
                  <p className={styles.helperText}>
                    Apoio sugerido automaticamente pela locacao: {activeProject.defaultSupportLabel ?? "Guarda Municipal"}.
                  </p>
                ) : null}
              </section>

              <div className={styles.modalActions}>
                {modalState.scheduleId && editingSchedule?.status === "PROGRAMADA" ? (
                  <button type="button" className={styles.secondaryButton} onClick={openPostponeModal} disabled={isSaving}>
                    Adiar programacao
                  </button>
                ) : null}
                {modalState.scheduleId && editingSchedule?.status === "PROGRAMADA" ? (
                  <button type="button" className={styles.dangerButton} onClick={openCancellationModal} disabled={isSaving}>
                    Cancelar programacao
                  </button>
                ) : null}
                <button type="submit" className={styles.primaryButton} disabled={isSaving}>
                  {isSaving
                    ? "Salvando..."
                    : editingSchedule?.status === "PROGRAMADA"
                      ? "Salvar programacao"
                      : "Programar novamente"}
                </button>
                <button type="button" className={styles.ghostButton} onClick={() => setModalState(null)} disabled={isSaving}>
                  Fechar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {copyModalState ? (
        <div className={styles.modalOverlay} onClick={() => !isCopying && closeCopyModal()}>
          <div className={styles.confirmationCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.eyebrow}>Programacao</p>
                <h3>Copiar Programacao</h3>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={() => closeCopyModal()} disabled={isCopying}>
                Fechar
              </button>
            </div>

            <div className={styles.modalBody}>
              <p className={styles.modalText}>
                Copia toda a linha programada da equipe de origem no periodo visivel para as equipes selecionadas.
              </p>

              <label className={styles.inlineField}>
                <span>Copiar de</span>
                <select
                  value={copyModalState.sourceTeamId}
                  onChange={(event) => updateCopySourceTeam(event.target.value)}
                  disabled={isCopying}
                >
                  {copySourceTeams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </label>

              <p className={styles.helperText}>
                Periodo visivel: {periodLabel}. Somente programacoes em status PROGRAMADA da equipe de origem entram na copia.
              </p>

              <div className={styles.copyTeamHeader}>
                <span>Para</span>
                <div className={styles.copyTeamActions}>
                  <button
                    type="button"
                    className={styles.ghostButton}
                    onClick={() =>
                      setCopyModalState((current) =>
                        current ? { ...current, targetTeamIds: copyTargetTeams.map((team) => team.id) } : current,
                      )
                    }
                    disabled={isCopying || !copyTargetTeams.length}
                  >
                    Marcar todas
                  </button>
                  <button
                    type="button"
                    className={styles.ghostButton}
                    onClick={() =>
                      setCopyModalState((current) => (current ? { ...current, targetTeamIds: [] } : current))
                    }
                    disabled={isCopying || !copyModalState.targetTeamIds.length}
                  >
                    Limpar
                  </button>
                </div>
              </div>

              {copyTargetTeams.length ? (
                <div className={styles.copyTeamList}>
                  {copyTargetTeams.map((team) => (
                    <label key={team.id} className={styles.copyTeamOption}>
                      <input
                        type="checkbox"
                        checked={copyModalState.targetTeamIds.includes(team.id)}
                        onChange={() => toggleCopyTargetTeam(team.id)}
                        disabled={isCopying}
                      />
                      <div>
                        <strong>{team.name}</strong>
                        <small>{team.serviceCenterName}</small>
                      </div>
                    </label>
                  ))}
                </div>
              ) : (
                <p className={styles.helperText}>Nenhuma outra equipe disponivel no filtro atual para receber a copia.</p>
              )}

              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => void handleCopyProgramming()}
                  disabled={!copyModalState.targetTeamIds.length || isCopying}
                >
                  {isCopying ? "Copiando..." : "Copiar programacao"}
                </button>
                <button type="button" className={styles.ghostButton} onClick={() => closeCopyModal()} disabled={isCopying}>
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {reprogramModalState ? (
        <div className={styles.modalOverlay} onClick={closeReprogramModal}>
          <div className={styles.confirmationCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.eyebrow}>Programacao</p>
                <h3>Validar Reprogramacao</h3>
              </div>
              <button
                type="button"
                className={styles.modalCloseButton}
                onClick={closeReprogramModal}
                disabled={isSaving}
              >
                Fechar
              </button>
            </div>

            <div className={styles.modalBody}>
              <p className={styles.modalText}>
                Informe o motivo da reprogramacao do projeto {reprogramModalState.projectCode}. A alteracao so sera gravada
                apos esta validacao.
              </p>

              <label className={styles.field}>
                <span>
                  Motivo da reprogramacao <span className="requiredMark">*</span>
                </span>
                <textarea
                  value={reprogramReason}
                  onChange={(event) => setReprogramReason(event.target.value)}
                  rows={4}
                  placeholder={`Descreva o motivo com no minimo ${CHANGE_REASON_MIN_LENGTH} caracteres`}
                  disabled={isSaving}
                />
              </label>

              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => void handleConfirmReprogram()}
                  disabled={!canSubmitReprogram}
                >
                  {isSaving ? "Validando..." : "Validar reprogramacao"}
                </button>
                <button type="button" className={styles.ghostButton} onClick={closeReprogramModal} disabled={isSaving}>
                  Voltar
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {cancelModalState ? (
        <div className={styles.modalOverlay} onClick={closeCancellationModal}>
          <div className={styles.confirmationCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.eyebrow}>Programacao</p>
                <h3>Cancelar Programacao</h3>
              </div>
              <button
                type="button"
                className={styles.modalCloseButton}
                onClick={closeCancellationModal}
                disabled={isCancelling}
              >
                Fechar
              </button>
            </div>

            <div className={styles.modalBody}>
              <p className={styles.modalText}>
                {cancelModalState.action === "postpone"
                  ? `Informe o motivo do adiamento da programacao do projeto ${cancelModalState.projectCode}. O registro saira da grade ativa, continuara no historico e podera ser reprogramado depois.`
                  : `Informe o motivo do cancelamento da programacao do projeto ${cancelModalState.projectCode}. O registro sera retirado da grade ativa, mas continuara no historico.`}
              </p>

              <label className={styles.field}>
                <span>
                  {cancelModalState.action === "postpone" ? "Motivo do adiamento" : "Motivo do cancelamento"}{" "}
                  <span className="requiredMark">*</span>
                </span>
                <textarea
                  value={cancelReason}
                  onChange={(event) => setCancelReason(event.target.value)}
                  rows={4}
                  placeholder={
                    cancelModalState.action === "postpone"
                      ? "Descreva o motivo do adiamento"
                      : "Descreva o motivo do cancelamento"
                  }
                  disabled={isCancelling}
                />
              </label>

              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={cancelModalState.action === "postpone" ? styles.secondaryButton : styles.dangerButton}
                  onClick={() => void handleCancelSchedule()}
                  disabled={!canSubmitCancellation}
                >
                  {isCancelling
                    ? cancelModalState.action === "postpone"
                      ? "Adiando..."
                      : "Cancelando..."
                    : `Validar ${cancelModalState.action === "postpone" ? "adiamento" : "cancelamento"}`}
                </button>
                <button type="button" className={styles.ghostButton} onClick={closeCancellationModal} disabled={isCancelling}>
                  Voltar
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
