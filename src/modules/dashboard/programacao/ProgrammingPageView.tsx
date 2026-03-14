"use client";

import { CSSProperties, DragEvent, FormEvent, useDeferredValue, useEffect, useState } from "react";

import { useAuth } from "@/hooks/useAuth";

import styles from "./ProgrammingPageView.module.css";

type ViewMode = "week" | "day";
type ScheduleTone = "planned" | "partial" | "complete" | "issue";
type PeriodMode = "integral" | "partial";
type DocumentKey = "sgd" | "pi" | "pep";

type ProjectItem = {
  id: string;
  code: string;
  serviceName: string;
  city: string;
  base: string;
  serviceType: string;
  priority: string;
  note: string;
};

type TeamItem = {
  id: string;
  name: string;
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
  date: string;
  period: PeriodMode;
  startTime: string;
  endTime: string;
  expectedMinutes: number;
  activities: ScheduleActivityItem[];
  documents: Record<DocumentKey, DocumentEntry>;
  feeder: string;
  support: string;
  note: string;
  projectBase: string;
  hasIssue: boolean;
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
  support: string;
  note: string;
};

type ModalState = {
  scheduleId: string | null;
  projectId: string;
  teamId: string;
  date: string;
  form: ScheduleFormState;
};

type FeedbackState = {
  type: "success" | "error";
  message: string;
};

type ProgrammingResponse = {
  projects?: ProjectItem[];
  teams?: TeamItem[];
  schedules?: Array<{
    id: string;
    projectId: string;
    teamId: string;
    date: string;
    period: PeriodMode;
    startTime: string;
    endTime: string;
    expectedMinutes: number;
    feeder: string;
    support: string;
    note: string;
    projectBase: string;
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
  message?: string;
};

const WEEKDAY_LABELS = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SAB"];
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
      support: schedule?.support ?? "",
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
  if (schedule.hasIssue) {
    return "issue";
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

function getLoadPercentage(teamId: string, dates: string[], schedules: ScheduleItem[]) {
  const visibleDates = new Set(dates);

  return Math.min(
    100,
    schedules
      .filter((schedule) => schedule.teamId === teamId && visibleDates.has(schedule.date))
      .reduce((total, schedule) => total + (schedule.period === "integral" ? 40 : 20), 0),
  );
}

function sortSchedules(items: ScheduleItem[]) {
  return [...items].sort((left, right) => {
    if (left.date === right.date) {
      return left.startTime.localeCompare(right.startTime);
    }

    return left.date.localeCompare(right.date);
  });
}

function priorityClassName(priority: string) {
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

function normalizeSchedule(
  item: NonNullable<ProgrammingResponse["schedules"]>[number],
): ScheduleItem {
  return {
    id: item.id,
    projectId: item.projectId,
    teamId: item.teamId,
    date: item.date,
    period: item.period,
    startTime: item.startTime,
    endTime: item.endTime,
    expectedMinutes: Number(item.expectedMinutes ?? 0),
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
    note: item.note ?? "",
    projectBase: item.projectBase ?? "Sem base",
    hasIssue: detectScheduleIssue(item.note ?? ""),
  };
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
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [teams, setTeams] = useState<TeamItem[]>([]);
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [draggingItem, setDraggingItem] = useState<DragPayload | null>(null);
  const [activeDropSlot, setActiveDropSlot] = useState<string | null>(null);
  const [modalState, setModalState] = useState<ModalState | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [isBoardLoading, setIsBoardLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [activityOptions, setActivityOptions] = useState<ActivityCatalogItem[]>([]);

  const visibleDates = createVisibleDates(periodStart, viewMode);
  const rangeStart = visibleDates[0] ?? INITIAL_PERIOD_START;
  const rangeEnd = visibleDates[visibleDates.length - 1] ?? rangeStart;
  const periodLabel = formatPeriodLabel(visibleDates);
  const deferredActivitySearch = useDeferredValue(modalState?.form.activitySearch ?? "");

  const baseOptions = ["Todas", ...Array.from(new Set(projects.map((item) => item.base)))];
  const cityOptions = ["Todas", ...Array.from(new Set(projects.map((item) => item.city)))];
  const serviceTypeOptions = ["Todas", ...Array.from(new Set(projects.map((item) => item.serviceType)))];
  const scheduledProjectIds = new Set(
    schedules.filter((item) => visibleDates.includes(item.date)).map((item) => item.projectId),
  );
  const filteredBoardSchedules = schedules.filter((item) => boardBaseFilter === "Todas" || item.projectBase === boardBaseFilter);
  const pendingProjects = projects.filter((project) => {
    if (scheduledProjectIds.has(project.id)) {
      return false;
    }

    if (pendingSearch.trim()) {
      const query = pendingSearch.trim().toLowerCase();
      const matchesText =
        project.code.toLowerCase().includes(query) ||
        project.serviceName.toLowerCase().includes(query) ||
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
  const scheduledInPeriod = filteredBoardSchedules.filter((item) => visibleDates.includes(item.date));
  const totalWorkload = teams.reduce((total, team) => total + getLoadPercentage(team.id, visibleDates, filteredBoardSchedules), 0);
  const averageWorkload = teams.length ? Math.round(totalWorkload / teams.length) : 0;
  const freeTeams = teams.filter((team) => getLoadPercentage(team.id, visibleDates, filteredBoardSchedules) === 0).length;
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

  useEffect(() => {
    if (!accessToken) {
      setProjects([]);
      setTeams([]);
      setSchedules([]);
      return;
    }

    let ignore = false;

    async function loadBoard() {
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

        if (ignore) {
          return;
        }

        setProjects(data?.projects ?? []);
        setTeams(data?.teams ?? []);
        setSchedules(sortSchedules((data?.schedules ?? []).map(normalizeSchedule)));
      } catch (error) {
        if (ignore) {
          return;
        }

        setFeedback({
          type: "error",
          message: error instanceof Error ? error.message : "Falha ao carregar programacao.",
        });
      } finally {
        if (!ignore) {
          setIsBoardLoading(false);
        }
      }
    }

    void loadBoard();

    return () => {
      ignore = true;
    };
  }, [accessToken, rangeEnd, rangeStart]);

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

  function shiftPeriod(direction: "previous" | "next") {
    const step = viewMode === "week" ? 7 : 1;
    setPeriodStart((current) => addDays(current, direction === "previous" ? -step : step));
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

    const payload = {
      id: modalState.scheduleId ?? undefined,
      projectId: modalState.projectId,
      teamId: modalState.teamId,
      date: modalState.date,
      period: modalState.form.period,
      startTime: modalState.form.startTime,
      endTime: modalState.form.endTime,
      expectedMinutes,
      feeder: modalState.form.feeder.trim(),
      support: modalState.form.support.trim(),
      note: modalState.form.note.trim(),
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

    setIsSaving(true);

    try {
      const method = modalState.scheduleId ? "PUT" : "POST";
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
        throw new Error(data?.message ?? "Falha ao salvar programacao.");
      }

      const reloadResponse = await fetch(`/api/programacao?startDate=${rangeStart}&endDate=${rangeEnd}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const reloadData = (await reloadResponse.json().catch(() => null)) as ProgrammingResponse | null;
      if (!reloadResponse.ok) {
        throw new Error(reloadData?.message ?? "Programacao salva, mas falhou ao recarregar a grade.");
      }

      setProjects(reloadData?.projects ?? []);
      setTeams(reloadData?.teams ?? []);
      setSchedules(sortSchedules((reloadData?.schedules ?? []).map(normalizeSchedule)));
      setModalState(null);
      setFeedback({
        type: "success",
        message: data?.message ?? "Programacao salva com sucesso.",
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Falha ao salvar programacao.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>, teamId: string, date: string) {
    event.preventDefault();
    openScheduleModalFromDrop(teamId, date);
    setDraggingItem(null);
  }

  return (
    <section className={styles.page}>
      <div className={styles.surface}>
        <aside className={styles.pendingPanel}>
          <header className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>Operacao</p>
              <h2>Projetos Pendentes</h2>
            </div>
            <span className={styles.counter}>{pendingProjects.length}</span>
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
                  {baseOptions.map((option) => (
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

          {feedback ? (
            <div className={feedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError}>
              {feedback.message}
            </div>
          ) : null}

          <div className={styles.pendingList}>
            {isBoardLoading && !projects.length ? (
              <div className={styles.emptyState}>Carregando backlog de programacao...</div>
            ) : null}

            {!isBoardLoading && !pendingProjects.length ? (
              <div className={styles.emptyState}>
                Nenhum projeto pendente para os filtros atuais.
              </div>
            ) : null}

            {pendingProjects.map((project) => (
              <article
                key={project.id}
                className={styles.projectCard}
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

                <p className={styles.projectService}>{project.serviceName}</p>

                <div className={styles.projectMeta}>
                  <span>{project.city}</span>
                  <span>{project.base}</span>
                </div>

                <div className={styles.projectFooter}>
                  <span>{project.serviceType}</span>
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
                <div className={styles.statCard}>
                  <span>Equipes livres</span>
                  <strong>{freeTeams}</strong>
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
                  {baseOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

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

              {teams.map((team) => {
                const load = getLoadPercentage(team.id, visibleDates, filteredBoardSchedules);

                return (
                  <div key={team.id} className={styles.teamRow}>
                    <aside className={styles.teamSummary}>
                      <div className={styles.teamSummaryTop}>
                        <div>
                          <h3>{team.name}</h3>
                          <p>{team.foremanName}</p>
                        </div>
                        <span className={styles.teamBaseTag}>{team.teamTypeName}</span>
                      </div>

                      <div className={styles.workloadBlock}>
                        <div className={styles.workloadLabel}>
                          <span>{load === 0 ? "Carga livre" : `Carga: ${load}%`}</span>
                          <span>{load < 60 ? "Folga" : load < 90 ? "Equilibrada" : "Alta"}</span>
                        </div>
                        <div className={styles.workloadBar}>
                          <span style={{ width: `${Math.max(load, 8)}%` }} />
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
        <div className={styles.modalOverlay} onClick={() => !isSaving && setModalState(null)}>
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
                    <input
                      value={modalState.form.support}
                      onChange={(event) => updateModalField("support", event.target.value)}
                      placeholder="Ex.: guindauto"
                    />
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
              </section>

              {feedback ? (
                <div className={feedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError}>
                  {feedback.message}
                </div>
              ) : null}

              <div className={styles.modalActions}>
                <button type="submit" className={styles.primaryButton} disabled={isSaving}>
                  {isSaving ? "Salvando..." : "Salvar programacao"}
                </button>
                <button type="button" className={styles.ghostButton} onClick={() => setModalState(null)} disabled={isSaving}>
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
