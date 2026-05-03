import {
  HISTORY_ALLOWED_ACTIONS,
  HISTORY_HIDDEN_FIELDS,
} from "./constants";
import type {
  ActivityCatalogItem,
  DeadlineStatus,
  DeadlineVisualVariant,
  DocumentEntry,
  DocumentKey,
  FormState,
  HistoryChange,
  PeriodMode,
  ProgrammingHistoryItem,
  ProgrammingReasonOptionItem,
  ProgrammingStatus,
  ScheduleItem,
  TeamItem,
} from "./types";
export function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(value: string, amount: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + amount);
  return toIsoDate(date);
}

export function calculateDateDiffInDays(targetDate: string, referenceDate: string) {
  const [targetYear, targetMonth, targetDay] = targetDate.split("-").map(Number);
  const [referenceYear, referenceMonth, referenceDay] = referenceDate.split("-").map(Number);
  const target = new Date(targetYear, targetMonth - 1, targetDay);
  const reference = new Date(referenceYear, referenceMonth - 1, referenceDay);
  const diffMs = target.getTime() - reference.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export function formatDeadlineStatusLabel(daysDiff: number, windowDays: number) {
  if (daysDiff < 0) {
    const absDays = Math.abs(daysDiff);
    return `Vencida ha ${absDays} dia${absDays === 1 ? "" : "s"}`;
  }

  if (daysDiff === 0) {
    return "Vence hoje";
  }

  if (daysDiff <= windowDays) {
    return `Vence em ${daysDiff} dia${daysDiff === 1 ? "" : "s"}`;
  }

  return "Ainda no prazo";
}

export function resolveDeadlineStatus(daysDiff: number, windowDays: number): DeadlineStatus {
  if (daysDiff < 0) {
    return "OVERDUE";
  }

  if (daysDiff === 0) {
    return "TODAY";
  }

  if (daysDiff <= windowDays) {
    return "SOON";
  }

  return "NORMAL";
}

export function resolveDeadlineVisualVariant(daysDiff: number, windowDays: number): DeadlineVisualVariant {
  if (daysDiff <= -30) {
    return "OVERDUE_CRITICAL";
  }

  if (daysDiff < 0) {
    return "OVERDUE";
  }

  if (daysDiff === 0) {
    return "TODAY";
  }

  if (daysDiff <= windowDays) {
    return "SOON";
  }

  return "NORMAL";
}

export function getCurrentYearDateRange(referenceDate: string) {
  const year = referenceDate.slice(0, 4);
  return {
    startDate: `${year}-01-01`,
    endDate: `${year}-12-31`,
  };
}

export function startOfWeekMonday(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const dayOfWeek = date.getDay();
  const offset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  date.setDate(date.getDate() + offset);
  return toIsoDate(date);
}

export function createWeekDates(weekStartDate: string) {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStartDate, index));
}

export function isDateInRange(value: string, startDate: string, endDate: string) {
  return value >= startDate && value <= endDate;
}

export function formatWeekdayShort(value: string) {
  if (!value) {
    return "";
  }

  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "").toUpperCase();
}

export function formatWeekRangeLabel(weekStartDate: string) {
  const weekEndDate = addDays(weekStartDate, 6);
  return `${formatDate(weekStartDate)} a ${formatDate(weekEndDate)}`;
}

export function formatDate(value: string) {
  if (!value) {
    return "-";
  }

  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString("pt-BR");
}

export function formatDateTime(value: string) {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("pt-BR");
}

export function formatAuditActor(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized || "Nao identificado";
}

export function formatWeekday(value: string) {
  if (!value) {
    return "";
  }

  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toLocaleDateString("pt-BR", { weekday: "long" });
}

export function formatExpectedHours(value: number) {
  const minutes = Number(value ?? 0);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return "";
  }

  const totalHours = minutes / 60;
  if (Number.isInteger(totalHours)) {
    return String(totalHours);
  }

  return totalHours.toFixed(2);
}

export function parseTimeToMinutes(value: string) {
  const normalized = String(value ?? "").trim();
  if (!/^\d{2}:\d{2}$/.test(normalized)) {
    return null;
  }

  const [hours, minutes] = normalized.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }

  return (hours * 60) + minutes;
}

export function resolveEnelNovoPeriod(startTime: string, endTime: string) {
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);
  const morningStart = 7 * 60;
  const morningEnd = 12 * 60;
  const afternoonStart = 13 * 60;

  if (
    startMinutes !== null
    && endMinutes !== null
    && startMinutes >= morningStart
    && endMinutes <= morningEnd
  ) {
    return "MANHÃ";
  }

  if (startMinutes !== null && startMinutes >= afternoonStart) {
    return "TARDE";
  }

  return "INTEGRAL";
}

export function normalizeSgdNumberForExport(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "";
  }

  const segments = normalized
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  return segments.join(" / ");
}

export function formatExpectedTimeAsClock(value: number) {
  const minutes = Number(value ?? 0);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return "";
  }

  const safeMinutes = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const remainderMinutes = safeMinutes % 60;

  return `${String(hours).padStart(2, "0")}:${String(remainderMinutes).padStart(2, "0")}:00`;
}

export function formatDateExecutionEnelNovo(value: string) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "";
  }

  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return normalized;
  }

  const day = match[3];
  const month = match[2];
  const year = match[1];

  return `${day}/${month}/${year}`;
}

export function formatWeekdayExecutionEnelNovo(value: string) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "";
  }

  const parsed = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  const weekday = parsed.getDay();
  const map = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
  return map[weekday] ?? "";
}

export function formatInfoStatusEtapa(
  etapaNumber: number | null | undefined,
  etapaUnica?: boolean,
  etapaFinal?: boolean,
) {
  if (etapaFinal) {
    return "ETAPA FINAL";
  }

  if (etapaUnica) {
    return "ETAPA ÚNICA";
  }

  const stage = Number(etapaNumber ?? 0);
  if (!Number.isFinite(stage) || stage <= 0) {
    return "";
  }

  return `${stage}ª ETAPA`;
}

export function extractTextAfterDash(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "";
  }

  const parts = normalized.split("-");
  if (parts.length < 2) {
    return normalized;
  }

  const last = parts[parts.length - 1]?.trim();
  return last || normalized;
}

export function extractTextBeforeDash(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "";
  }

  const parts = normalized.split("-");
  if (parts.length < 2) {
    return normalized;
  }

  const first = parts[0]?.trim();
  return first || normalized;
}

export function resolveEnelNovoStatus(schedule: ScheduleItem) {
  const normalizedWorkCompletionStatus = normalizeWorkCompletionCode(schedule.workCompletionStatus);

  if (normalizedWorkCompletionStatus === "CONCLUIDO") {
    return "CONCLUÍDO";
  }

  if (normalizedWorkCompletionStatus === "PARCIAL") {
    return "PARCIAL";
  }

  const displayStatus = getDisplayProgrammingStatus(schedule);
  switch (displayStatus) {
    case "ADIADA":
      return "ADIADO";
    case "CANCELADA":
      return "CANCELADO";
    case "REPROGRAMADA":
      return "REPROGRAMADA";
    case "PROGRAMADA":
    default:
      return "PROGRAMADO";
  }
}

export function isAreaLivreSgd(
  sgdExportColumn: string | null | undefined,
  sgdTypeDescription: string | null | undefined,
) {
  const exportColumn = String(sgdExportColumn ?? "").trim().toUpperCase();
  const description = String(sgdTypeDescription ?? "").trim().toUpperCase();

  return (
    exportColumn === "AREA_LIVRE"
    || exportColumn === "AREA LIVRE"
    || description === "AREA_LIVRE"
    || description === "AREA LIVRE"
  );
}

export function normalizeWorkCompletionCode(value: unknown) {
  const raw = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");

  return raw || "NAO_INFORMADO";
}

export function resolveTeamStructureCode(team?: TeamItem | null) {
  if (!team) {
    return "";
  }

  const normalized = normalizeSearchText(`${team.teamTypeName ?? ""} ${team.name ?? ""}`);
  if (!normalized) {
    return "";
  }

  if (normalized.includes("linha morta") || normalized.includes("morta") || /\bmk\b/.test(normalized)) {
    return "MK";
  }

  if (normalized.includes("cesto") || normalized.includes("ceto")) {
    return "CETO";
  }

  if (normalized.includes("linha viva") || normalized.includes("viva") || /\blv\b/.test(normalized)) {
    return "LV";
  }

  return "";
}

export function resolveScheduleTeamInfo(schedule: ScheduleItem, teamMap: Map<string, TeamItem>) {
  const activeTeam = teamMap.get(schedule.teamId);
  if (activeTeam) {
    return activeTeam;
  }

  return {
    id: schedule.teamId,
    name: schedule.teamName ?? schedule.teamId,
    vehiclePlate: schedule.teamVehiclePlate ?? "",
    serviceCenterName: schedule.teamServiceCenterName ?? "Sem base",
    teamTypeName: schedule.teamTypeName ?? "",
    foremanName: schedule.teamForemanName ?? "",
  } satisfies TeamItem;
}

export function resolveReasonOption(
  reasonOptions: ProgrammingReasonOptionItem[],
  selectedReasonCode: string,
) {
  const normalizedCode = selectedReasonCode.trim().toUpperCase();
  if (!normalizedCode) {
    return null;
  }

  return reasonOptions.find((item) => item.code.toUpperCase() === normalizedCode) ?? null;
}

export function formatStructureSummaryByCode(codeCountMap: Record<string, number>) {
  const priorityOrder = ["MK", "CETO", "LV"];
  const codes = Object.keys(codeCountMap)
    .filter((code) => codeCountMap[code] > 0)
    .sort((left, right) => {
      const leftIndex = priorityOrder.indexOf(left);
      const rightIndex = priorityOrder.indexOf(right);

      if (leftIndex !== -1 && rightIndex !== -1) {
        return leftIndex - rightIndex;
      }
      if (leftIndex !== -1) {
        return -1;
      }
      if (rightIndex !== -1) {
        return 1;
      }

      return left.localeCompare(right);
    });

  if (!codes.length) {
    return "";
  }

  return codes.map((code) => `${codeCountMap[code]} ${code}`).join(" + ");
}

export function calculateExpectedMinutes(startTime: string, endTime: string, _period: PeriodMode) {
  void _period;
  const [startHour, startMinute] = startTime.split(":").map(Number);
  const [endHour, endMinute] = endTime.split(":").map(Number);
  const startTotal = startHour * 60 + startMinute;
  const endTotal = endHour * 60 + endMinute;

  if (Number.isFinite(startTotal) && Number.isFinite(endTotal) && endTotal > startTotal) {
    return endTotal - startTotal;
  }

  return 0;
}

export function createEmptyDocuments(): Record<DocumentKey, DocumentEntry> {
  return {
    sgd: { number: "", approvedAt: "", requestedAt: "" },
    pi: { number: "", approvedAt: "", requestedAt: "" },
    pep: { number: "", approvedAt: "", requestedAt: "" },
  };
}

export function createInitialForm(initialDate: string): FormState {
  return {
    projectId: "",
    projectSearch: "",
    date: initialDate,
    period: "integral",
    startTime: "08:00",
    endTime: "17:00",
    outageStartTime: "",
    outageEndTime: "",
    feeder: "",
    supportItemId: "",
    note: "",
    electricalField: "",
    serviceDescription: "",
    posteQty: "0",
    estruturaQty: "0",
    trafoQty: "0",
    redeQty: "0",
    etapaNumber: "",
    etapaUnica: false,
    etapaFinal: false,
    workCompletionStatus: "",
    affectedCustomers: "0",
    sgdTypeId: "",
    electricalEqCatalogId: "",
    teamIds: [],
    teamSearch: "",
    activitySearch: "",
    activityQuantity: "1",
    activities: [],
    documents: createEmptyDocuments(),
  };
}

export function activityOptionLabel(item: ActivityCatalogItem) {
  return `${item.code} - ${item.description}`;
}

export function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function findActivityOption(value: string, options: ActivityCatalogItem[]) {
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

export function parseNonNegativeInteger(value: string) {
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

export function parseOptionalPositiveInteger(value: string) {
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

export function normalizeHistoryChangeMap(value: Record<string, unknown>) {
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

export function normalizeHistoryItemsForDisplay(items: ProgrammingHistoryItem[]) {
  return items
    .map((item) => {
      const action = item.action.trim().toUpperCase();
      if (!HISTORY_ALLOWED_ACTIONS.has(action)) {
        return null;
      }

      const rawChanges = normalizeHistoryChangeMap(item.changes ?? {});

      if (action === "ADIADA" || action === "CANCELADA") {
        const statusChange = rawChanges.status;
        const executionDateChange = rawChanges.executionDate;
        const relevantChanges = Object.fromEntries(
          Object.entries({
            ...(statusChange ? { status: statusChange } : {}),
            ...(executionDateChange ? { executionDate: executionDateChange } : {}),
          }),
        );

        if (!Object.keys(relevantChanges).length) {
          return null;
        }

        return {
          ...item,
          changes: relevantChanges,
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

export function parseActivitiesSnapshot(value: string | null) {
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

export function formatHistoryValue(field: string, value: string | null) {
  if (!value) {
    return "-";
  }

  if (
    field === "etapaNumber"
    || field === "posteQty"
    || field === "estruturaQty"
    || field === "trafoQty"
    || field === "redeQty"
    || field === "affectedCustomers"
  ) {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) {
      return String(Math.trunc(numericValue));
    }
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

export function formatHistoryAction(action: string) {
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

export function isWorkCompleted(workCompletionStatus: ScheduleItem["workCompletionStatus"] | string | null | undefined) {
  const normalized = normalizeWorkCompletionCode(workCompletionStatus);
  return normalized === "CONCLUIDO" || normalized === "COMPLETO";
}

export function isInactiveProgrammingStatus(status: ProgrammingStatus) {
  return status === "ADIADA" || status === "CANCELADA";
}

export function isActiveProgrammingStatus(status: ProgrammingStatus) {
  return status === "PROGRAMADA" || status === "REPROGRAMADA";
}

export function getDisplayProgrammingStatus(schedule: Pick<ScheduleItem, "status" | "isReprogrammed">): ProgrammingStatus {
  if (schedule.status === "PROGRAMADA" && schedule.isReprogrammed) {
    return "REPROGRAMADA";
  }

  return schedule.status;
}

export function escapeCsvValue(value: string | number) {
  const raw = String(value ?? "").replace(/\r?\n|\r/g, " ").trim();
  if (raw.includes(";") || raw.includes('"')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}
