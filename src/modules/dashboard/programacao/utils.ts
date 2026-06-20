import type {
  ActivityCatalogItem,
  DocumentEntry,
  DocumentKey,
  ModalState,
  PeriodMode,
  ProgrammingResponse,
  ProjectItem,
  SaveProgrammingResponse,
  ScheduleItem,
  ScheduleTone,
  TeamSummaryItem,
  ViewMode,
} from "./types";

export const WEEKDAY_LABELS = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SAB"];
export const CHANGE_REASON_MIN_LENGTH = 10;
export const DOCUMENT_KEYS: Array<{ key: DocumentKey; label: string }> = [
  { key: "sgd", label: "SGD" },
  { key: "pi", label: "PI" },
  { key: "pep", label: "PEP" },
];
export const INITIAL_PERIOD_START = toIsoDate(new Date());

export function parseIsoDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function toIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(value: string, amount: number) {
  const nextDate = parseIsoDate(value);
  nextDate.setDate(nextDate.getDate() + amount);
  return toIsoDate(nextDate);
}

export function startOfWeekMonday(value: string) {
  const date = parseIsoDate(value);
  const dayOfWeek = date.getDay();
  const offset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  date.setDate(date.getDate() + offset);
  return toIsoDate(date);
}

export function createVisibleDates(startDate: string, viewMode: ViewMode) {
  const normalizedStartDate = viewMode === "week" ? startOfWeekMonday(startDate) : startDate;
  const totalDays = viewMode === "week" ? 7 : 1;
  return Array.from({ length: totalDays }, (_, index) => addDays(normalizedStartDate, index));
}

export function formatDateShort(value: string) {
  const date = parseIsoDate(value);
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function formatBoardDate(value: string) {
  const date = parseIsoDate(value);
  return `${WEEKDAY_LABELS[date.getDay()]} ${String(date.getDate()).padStart(2, "0")}`;
}

export function formatPeriodLabel(dates: string[]) {
  if (dates.length === 1) {
    return formatDateShort(dates[0]);
  }

  return `${formatDateShort(dates[0])} a ${formatDateShort(dates[dates.length - 1])}`;
}

export function calculateExpectedMinutes(startTime: string, endTime: string, period: PeriodMode) {
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

export function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (!remainingMinutes) {
    return `${hours}h`;
  }

  return `${hours}h${String(remainingMinutes).padStart(2, "0")}min`;
}

export function formatDisplayDate(value: string) {
  if (!value) {
    return "";
  }

  return parseIsoDate(value).toLocaleDateString("pt-BR");
}

export function formatDisplayDateTime(value: string) {
  if (!value) {
    return "";
  }

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return "";
  }

  return parsedDate.toLocaleString("pt-BR");
}

export function createEmptyDocuments(): Record<DocumentKey, DocumentEntry> {
  return {
    sgd: { number: "", includedAt: "", deliveredAt: "" },
    pi: { number: "", includedAt: "", deliveredAt: "" },
    pep: { number: "", includedAt: "", deliveredAt: "" },
  };
}

export function createDocuments(documents?: Partial<Record<DocumentKey, Partial<DocumentEntry>>>) {
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

export function activityOptionLabel(activity: ActivityCatalogItem) {
  return `${activity.code} - ${activity.description}`;
}

export function buildDefaultForm(project: ProjectItem, schedule?: ScheduleItem, nextDate?: string, nextTeamId?: string): ModalState {
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

export function getDocumentState(document: DocumentEntry) {
  if (document.number && document.deliveredAt) {
    return "complete";
  }

  if (document.number || document.includedAt) {
    return "partial";
  }

  return "missing";
}

export function detectScheduleIssue(note: string) {
  const normalizedNote = note.trim().toLowerCase();
  if (!normalizedNote) {
    return false;
  }

  return ["atras", "penden", "problema", "issue", "delay"].some((term) => normalizedNote.includes(term));
}

export function getScheduleTone(schedule: ScheduleItem): ScheduleTone {
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

export function sortSchedules(items: ScheduleItem[]) {
  return [...items].sort((left, right) => {
    if (left.date === right.date) {
      return left.startTime.localeCompare(right.startTime);
    }

    return left.date.localeCompare(right.date);
  });
}

export function workloadStatusLabel(summary?: TeamSummaryItem) {
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

export function workloadPrimaryLabel(summary?: TeamSummaryItem) {
  if (!summary || summary.workedDays <= 0) {
    return "Carga livre";
  }

  return `Carga: ${summary.workedDays}/${summary.capacityDays} dias`;
}

export function normalizeSchedule(
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

export function buildConflictFeedbackMessage(payload: SaveProgrammingResponse | null, fallback: string) {
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

export function findActivityOption(value: string, options: ActivityCatalogItem[]) {
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

export function buildIncludedAtLabel(
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
