"use client";

import { FormEvent, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { useExportCooldown } from "@/hooks/useExportCooldown";
import { supabase } from "@/lib/supabase/client";
import styles from "./ProgrammingSimplePageView.module.css";

type PeriodMode = "integral" | "partial";
type ProgrammingStatus = "PROGRAMADA" | "REPROGRAMADA" | "ADIADA" | "CANCELADA";
type WorkCompletionStatus = string;
type DocumentKey = "sgd" | "pi" | "pep";

type ProjectItem = {
  id: string;
  code: string;
  executionDeadline?: string | null;
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
  vehiclePlate?: string;
  serviceCenterName: string;
  teamTypeName?: string;
  foremanName?: string;
};

type SupportOptionItem = {
  id: string;
  description: string;
};

type ProgrammingReasonOptionItem = {
  code: string;
  label: string;
  requiresNotes: boolean;
};

type SgdTypeItem = {
  id: string;
  description: string;
  exportColumn: "SGD_AT_MT_VYP" | "SGD_BT" | "SGD_TET" | string;
};

type ElectricalEqCatalogItem = {
  id: string;
  code: string;
  label: string;
};

type WorkCompletionCatalogItem = {
  code: string;
  label: string;
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
  teamName?: string;
  teamServiceCenterName?: string;
  teamTypeName?: string;
  teamForemanName?: string;
  teamVehiclePlate?: string;
  status: ProgrammingStatus;
  isReprogrammed?: boolean;
  date: string;
  period: PeriodMode;
  startTime: string;
  endTime: string;
  outageStartTime: string;
  outageEndTime: string;
  createdAt: string;
  updatedAt: string;
  createdByName: string;
  updatedByName: string;
  statusReason?: string;
  statusChangedAt?: string;
  expectedMinutes: number;
  feeder: string;
  support: string;
  supportItemId: string | null;
  note: string;
  electricalField: string;
  serviceDescription: string;
  posteQty: number;
  estruturaQty: number;
  trafoQty: number;
  redeQty: number;
  etapaNumber: number | null;
  etapaUnica: boolean;
  etapaFinal: boolean;
  workCompletionStatus: WorkCompletionStatus | null;
  affectedCustomers: number;
  sgdTypeId: string | null;
  electricalEqCatalogId: string | null;
  electricalEqCode?: string;
  sgdTypeDescription?: string;
  sgdExportColumn?: string;
  activitiesLoaded?: boolean;
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
  electricalEqCatalog?: ElectricalEqCatalogItem[];
  workCompletionCatalog?: WorkCompletionCatalogItem[];
  reasonOptions?: ProgrammingReasonOptionItem[];
  schedules?: ScheduleItem[];
  activitiesLoadError?: boolean;
  nextEtapaNumber?: number;
  message?: string;
};

type StageValidationTeamSummary = {
  teamId: string;
  teamName: string;
  highestStage: number;
  existingStages: number[];
  existingDates: string[];
};

type StageValidationResponse = {
  enteredEtapaNumber?: number;
  hasConflict?: boolean;
  highestStage?: number;
  teams?: StageValidationTeamSummary[];
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
  enteredEtapaNumber?: number;
  hasConflict?: boolean;
  highestStage?: number;
  teams?: StageValidationTeamSummary[];
};

type SaveProgrammingResponse = {
  success?: boolean;
  id?: string;
  updatedAt?: string;
  schedule?: ScheduleItem | null;
  warning?: string;
  error?: "conflict";
  reason?: string | null;
  detail?: string | null;
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
  enteredEtapaNumber?: number;
  hasConflict?: boolean;
  highestStage?: number;
  teams?: StageValidationTeamSummary[];
};

type HistoryChange = {
  from: string | null;
  to: string | null;
};

type ProgrammingHistoryItem = {
  id: string;
  changedAt: string;
  changedByName?: string;
  reason: string;
  action: string;
  changes: Record<string, HistoryChange>;
  metadata: Record<string, unknown>;
};

type ProgrammingHistoryResponse = {
  history?: ProgrammingHistoryItem[];
  message?: string;
};

type AlertModalState = {
  title: string;
  message: string;
  details?: string[];
};

type FormState = {
  projectId: string;
  projectSearch: string;
  date: string;
  period: PeriodMode;
  startTime: string;
  endTime: string;
  outageStartTime: string;
  outageEndTime: string;
  feeder: string;
  supportItemId: string;
  note: string;
  electricalField: string;
  serviceDescription: string;
  posteQty: string;
  estruturaQty: string;
  trafoQty: string;
  redeQty: string;
  etapaNumber: string;
  etapaUnica: boolean;
  etapaFinal: boolean;
  workCompletionStatus: WorkCompletionStatus | "";
  affectedCustomers: string;
  sgdTypeId: string;
  electricalEqCatalogId: string;
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
  projectSearch: string;
  projectId: string;
  teamId: string;
  status: "TODOS" | ProgrammingStatus;
  workCompletionStatus: "TODOS" | WorkCompletionStatus | "NAO_INFORMADO";
  sgdTypeId: string;
};

type DeadlineStatus = "OVERDUE" | "TODAY" | "SOON" | "NORMAL";
type DeadlineVisualVariant = "OVERDUE_CRITICAL" | "OVERDUE" | "TODAY" | "SOON" | "NORMAL";
type DeadlineViewMode = "15" | "30";

const PAGE_SIZE = 20;
const HISTORY_PAGE_SIZE = 5;
const DEADLINE_CAROUSEL_PAGE_SIZE = 6;
const DEADLINE_WINDOW_SHORT_DAYS = 15;
const DEADLINE_WINDOW_LONG_DAYS = 30;
const DOCUMENT_KEYS: Array<{ key: DocumentKey; label: string }> = [
  { key: "sgd", label: "SGD" },
  { key: "pi", label: "PI" },
  { key: "pep", label: "PEP" },
];
const HISTORY_FIELD_LABELS: Record<string, string> = {
  project: "Projeto",
  team: "Equipe",
  executionDate: "Data execucao",
  period: "Periodo",
  startTime: "Hora inicio",
  endTime: "Hora termino",
  outageStartTime: "Inicio de desligamento",
  outageEndTime: "Termino de desligamento",
  expectedMinutes: "Tempo previsto",
  feeder: "Alimentador",
  support: "Apoio",
  note: "Anotacao",
  electricalField: "Nº EQ (numero)",
  serviceDescription: "Descricao do servico",
  posteQty: "POSTE",
  estruturaQty: "ESTRUTURA",
  trafoQty: "TRAFO",
  redeQty: "REDE",
  etapaNumber: "ETAPA",
  etapaUnica: "ETAPA ÚNICA",
  etapaFinal: "ETAPA FINAL",
  workCompletionStatus: "Estado Trabalho",
  affectedCustomers: "Nº Clientes Afetados",
  electricalEq: "Nº EQ",
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
const VALIDATION_FIELD_LABELS: Record<string, string> = {
  projectId: "Projeto (SOB)",
  teamIds: "Equipes",
  date: "Data execucao",
  period: "Periodo",
  startTime: "Hora inicio",
  endTime: "Hora termino",
  outageStartTime: "Inicio de desligamento",
  outageEndTime: "Termino de desligamento",
  feeder: "Alimentador",
  electricalField: "Nº EQ (numero)",
  posteQty: "POSTE",
  estruturaQty: "ESTRUTURA",
  trafoQty: "TRAFO",
  redeQty: "REDE",
  etapaNumber: "ETAPA",
  workCompletionStatus: "Estado Trabalho",
  affectedCustomers: "Nº Clientes Afetados",
  electricalEqCatalogId: "Nº EQ",
  sgdTypeId: "Tipo de SGD",
  changeReason: "Motivo da reprogramacao",
};

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

function calculateDateDiffInDays(targetDate: string, referenceDate: string) {
  const [targetYear, targetMonth, targetDay] = targetDate.split("-").map(Number);
  const [referenceYear, referenceMonth, referenceDay] = referenceDate.split("-").map(Number);
  const target = new Date(targetYear, targetMonth - 1, targetDay);
  const reference = new Date(referenceYear, referenceMonth - 1, referenceDay);
  const diffMs = target.getTime() - reference.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function formatDeadlineStatusLabel(daysDiff: number, windowDays: number) {
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

function resolveDeadlineStatus(daysDiff: number, windowDays: number): DeadlineStatus {
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

function resolveDeadlineVisualVariant(daysDiff: number, windowDays: number): DeadlineVisualVariant {
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

function getCurrentYearDateRange(referenceDate: string) {
  const year = referenceDate.slice(0, 4);
  return {
    startDate: `${year}-01-01`,
    endDate: `${year}-12-31`,
  };
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

function formatAuditActor(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized || "Nao identificado";
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

function formatExpectedHours(value: number) {
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

function parseTimeToMinutes(value: string) {
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

function resolveEnelNovoPeriod(startTime: string, endTime: string) {
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

function normalizeSgdNumberForExport(value: string | null | undefined) {
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

function formatExpectedTimeAsClock(value: number) {
  const minutes = Number(value ?? 0);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return "";
  }

  const safeMinutes = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const remainderMinutes = safeMinutes % 60;

  return `${String(hours).padStart(2, "0")}:${String(remainderMinutes).padStart(2, "0")}:00`;
}

function formatDateExecutionEnelNovo(value: string) {
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

function formatWeekdayExecutionEnelNovo(value: string) {
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

function formatInfoStatusEtapa(
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

function extractTextAfterDash(value: string | null | undefined) {
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

function extractTextBeforeDash(value: string | null | undefined) {
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

function resolveEnelNovoStatus(schedule: ScheduleItem) {
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

function isAreaLivreSgd(
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

function normalizeWorkCompletionCode(value: unknown) {
  const raw = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");

  return raw || "NAO_INFORMADO";
}

function resolveTeamStructureCode(team?: TeamItem | null) {
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

function resolveScheduleTeamInfo(schedule: ScheduleItem, teamMap: Map<string, TeamItem>) {
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

function resolveReasonOption(
  reasonOptions: ProgrammingReasonOptionItem[],
  selectedReasonCode: string,
) {
  const normalizedCode = selectedReasonCode.trim().toUpperCase();
  if (!normalizedCode) {
    return null;
  }

  return reasonOptions.find((item) => item.code.toUpperCase() === normalizedCode) ?? null;
}

function isReasonSelectionValid(
  reasonOptions: ProgrammingReasonOptionItem[],
  selectedReasonCode: string,
  reasonNotes: string,
) {
  const selectedOption = resolveReasonOption(reasonOptions, selectedReasonCode);
  if (!selectedOption) {
    return false;
  }

  if (selectedOption.requiresNotes && !reasonNotes.trim()) {
    return false;
  }

  return true;
}

function buildReasonText(
  reasonOptions: ProgrammingReasonOptionItem[],
  selectedReasonCode: string,
  reasonNotes: string,
) {
  const selectedOption = resolveReasonOption(reasonOptions, selectedReasonCode);
  if (!selectedOption) {
    return "";
  }

  const notes = reasonNotes.trim();
  if (selectedOption.requiresNotes && !notes) {
    return "";
  }

  return notes ? `${selectedOption.label}: ${notes}` : selectedOption.label;
}

function formatStructureSummaryByCode(codeCountMap: Record<string, number>) {
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

function calculateExpectedMinutes(startTime: string, endTime: string, _period: PeriodMode) {
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

function isInvalidTimeRange(startTime: string, endTime: string) {
  if (!startTime || !endTime) {
    return false;
  }

  return endTime <= startTime;
}

function getDocumentRequestedAfterApprovedLabel(documents: Record<DocumentKey, DocumentEntry>) {
  const invalidDocument = DOCUMENT_KEYS.find(({ key }) => {
    const approvedAt = documents[key].approvedAt;
    const requestedAt = documents[key].requestedAt;
    return Boolean(approvedAt && requestedAt && requestedAt > approvedAt);
  });

  return invalidDocument?.label ?? null;
}

function isNegativeNumericText(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  return /^-\d+([.,]\d+)?$/.test(normalized);
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

function isWorkCompleted(workCompletionStatus: ScheduleItem["workCompletionStatus"] | string | null | undefined) {
  const normalized = normalizeWorkCompletionCode(workCompletionStatus);
  return normalized === "CONCLUIDO" || normalized === "COMPLETO";
}

function scheduleCardClassName(status: ProgrammingStatus, workCompletionStatus: ScheduleItem["workCompletionStatus"]) {
  if (isWorkCompleted(workCompletionStatus)) {
    return styles.weekCardCompleted;
  }

  if (status === "REPROGRAMADA") {
    return styles.weekCardRescheduled;
  }

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

function isActiveProgrammingStatus(status: ProgrammingStatus) {
  return status === "PROGRAMADA" || status === "REPROGRAMADA";
}

function getDisplayProgrammingStatus(schedule: Pick<ScheduleItem, "status" | "isReprogrammed">): ProgrammingStatus {
  if (schedule.status === "PROGRAMADA" && schedule.isReprogrammed) {
    return "REPROGRAMADA";
  }

  return schedule.status;
}

function buildSavedOutsideFiltersMessage(params: {
  date: string;
  status: ProgrammingStatus;
  projectId: string;
  teamIds: string[];
  workCompletionStatus: WorkCompletionStatus | null;
  sgdTypeId: string | null;
  activeFilters: FilterState;
  projectMap: Map<string, ProjectItem>;
  teamMap: Map<string, TeamItem>;
  workCompletionCatalog: WorkCompletionCatalogItem[];
  sgdTypes: SgdTypeItem[];
}) {
  const reasons: string[] = [];

  if (
    !isInactiveProgrammingStatus(params.status)
    && !isDateInRange(params.date, params.activeFilters.startDate, params.activeFilters.endDate)
  ) {
    reasons.push(
      `a Data execucao ${formatDate(params.date)} esta fora do filtro atual (${formatDate(params.activeFilters.startDate)} a ${formatDate(params.activeFilters.endDate)})`,
    );
  }

  if (params.activeFilters.projectId && params.projectId !== params.activeFilters.projectId) {
    const filteredProject = params.projectMap.get(params.activeFilters.projectId)?.code ?? "selecionado";
    reasons.push(`o Projeto filtrado e ${filteredProject}`);
  }

  if (params.activeFilters.teamId && !params.teamIds.includes(params.activeFilters.teamId)) {
    const filteredTeam = params.teamMap.get(params.activeFilters.teamId)?.name ?? "selecionada";
    reasons.push(`a Equipe filtrada e ${filteredTeam}`);
  }

  if (params.activeFilters.status !== "TODOS" && params.status !== params.activeFilters.status) {
    reasons.push(`o Status filtrado e ${params.activeFilters.status}`);
  }

  if (params.activeFilters.workCompletionStatus !== "TODOS") {
    const savedWorkCompletionStatus = normalizeWorkCompletionCode(params.workCompletionStatus);
    const selectedWorkCompletionStatus = normalizeWorkCompletionCode(params.activeFilters.workCompletionStatus);
    if (selectedWorkCompletionStatus !== savedWorkCompletionStatus) {
      const selectedCatalogItem = params.activeFilters.workCompletionStatus === "NAO_INFORMADO"
        ? null
        : params.workCompletionCatalog.find((item) => item.code === params.activeFilters.workCompletionStatus) ?? null;
      const formattedWorkCompletionStatus = params.activeFilters.workCompletionStatus === "NAO_INFORMADO"
        ? "Nao informado"
        : selectedCatalogItem?.label ?? params.activeFilters.workCompletionStatus;
      reasons.push(`o Estado Trabalho filtrado e ${formattedWorkCompletionStatus}`);
    }
  }

  if (params.activeFilters.sgdTypeId && params.sgdTypeId !== params.activeFilters.sgdTypeId) {
    const filteredSgdType = params.sgdTypes.find((item) => item.id === params.activeFilters.sgdTypeId);
    reasons.push(`o Tipo SGD filtrado e ${filteredSgdType?.description ?? "selecionado"}`);
  }

  if (!reasons.length) {
    return null;
  }

  return `A programacao foi salva, mas pode nao aparecer na lista atual porque ${reasons.join(" e ")}.`;
}

function buildConflictFeedbackMessage(payload: SaveProgrammingResponse | null, fallback: string) {
  if (payload?.error !== "conflict") {
    return payload?.message ?? fallback;
  }

  const updatedBy = payload.updatedBy?.trim();
  const updatedAt = payload.currentUpdatedAt ? formatDateTime(payload.currentUpdatedAt) : "";
  const changedFields = Array.isArray(payload.changedFields) && payload.changedFields.length
    ? ` Campos em conflito: ${payload.changedFields.join(", ")}.`
    : "";

  return `${payload.message ?? fallback}${updatedBy || updatedAt ? ` Alterada por ${updatedBy ?? "outro usuario"}${updatedAt ? ` em ${updatedAt}` : ""}.` : ""}${changedFields}`;
}

function buildFieldValidationDetails(fields: string[]) {
  const labels = Array.from(
    new Set(
      fields
        .map((field) => VALIDATION_FIELD_LABELS[field] ?? null)
        .filter((value): value is string => Boolean(value)),
    ),
  );

  return labels.length ? labels.map((label) => `Revise o campo ${label}.`) : [];
}

function buildConflictAlertDetails(payload: SaveProgrammingResponse | null) {
  if (!payload) {
    return [];
  }

  const details: string[] = [];
  if (payload.reason) {
    details.push(`Codigo do erro: ${payload.reason}.`);
  }

  if (payload.detail) {
    details.push(payload.detail);
  }

  if (payload.updatedBy || payload.currentUpdatedAt) {
    details.push(
      `Ultima alteracao: ${payload.updatedBy?.trim() || "outro usuario"}${payload.currentUpdatedAt ? ` em ${formatDateTime(payload.currentUpdatedAt)}` : ""}.`,
    );
  }

  if (Array.isArray(payload.changedFields) && payload.changedFields.length) {
    details.push(`Campos em conflito: ${payload.changedFields.join(", ")}.`);
  }

  if (payload.currentRecord) {
    details.push(
      `Versao atual: ${formatDate(payload.currentRecord.executionDate)} | ${payload.currentRecord.startTime} - ${payload.currentRecord.endTime}.`,
    );
  }

  return details;
}

function buildLocalStageConflictSummary(params: {
  schedules: ScheduleItem[];
  teams: TeamItem[];
  projectId: string;
  teamIds: string[];
  enteredEtapaNumber: number;
  excludeProgrammingId?: string | null;
  currentEditingStage?: number | null;
  currentEditingDate?: string | null;
  currentEditingTeamId?: string | null;
}) {
  const teamNameMap = new Map(params.teams.map((item) => [item.id, item.name]));
  const relevantSchedules = params.schedules.filter((item) => {
    if (item.projectId !== params.projectId) {
      return false;
    }

    if (!params.teamIds.includes(item.teamId)) {
      return false;
    }

    if (params.excludeProgrammingId && item.id === params.excludeProgrammingId) {
      return false;
    }

    if (item.etapaNumber === null || item.etapaNumber < params.enteredEtapaNumber) {
      return false;
    }

    return true;
  });

  if (!relevantSchedules.length) {
    return null;
  }

  const summaries = Array.from(new Set(relevantSchedules.map((item) => item.teamId)))
    .map((teamId) => {
      const items = relevantSchedules.filter((item) => item.teamId === teamId);
      const existingStages = Array.from(
        new Set(
          items
            .map((item) => Number(item.etapaNumber ?? 0))
            .filter((stage) => Number.isFinite(stage) && stage >= params.enteredEtapaNumber),
        ),
      ).sort((left, right) => left - right);
      const existingDates = Array.from(new Set(items.map((item) => item.date))).sort();
      const highestStage = existingStages.length ? Math.max(...existingStages) : 0;

      return {
        teamId,
        teamName: teamNameMap.get(teamId) ?? teamId,
        highestStage,
        existingStages,
        existingDates,
      } satisfies StageValidationTeamSummary;
    })
    .filter((item) => item.existingStages.length > 0)
    .sort((left, right) => left.teamName.localeCompare(right.teamName));

  if (
    params.currentEditingTeamId
    && params.currentEditingStage
    && params.currentEditingStage > params.enteredEtapaNumber
  ) {
    const existingSummary = summaries.find((item) => item.teamId === params.currentEditingTeamId);
    if (existingSummary) {
      if (!existingSummary.existingStages.includes(params.currentEditingStage)) {
        existingSummary.existingStages = [...existingSummary.existingStages, params.currentEditingStage].sort((left, right) => left - right);
      }
      if (params.currentEditingDate && !existingSummary.existingDates.includes(params.currentEditingDate)) {
        existingSummary.existingDates = [...existingSummary.existingDates, params.currentEditingDate].sort();
      }
      existingSummary.highestStage = Math.max(existingSummary.highestStage, params.currentEditingStage);
    } else {
      summaries.push({
        teamId: params.currentEditingTeamId,
        teamName: teamNameMap.get(params.currentEditingTeamId) ?? params.currentEditingTeamId,
        highestStage: params.currentEditingStage,
        existingStages: [params.currentEditingStage],
        existingDates: params.currentEditingDate ? [params.currentEditingDate] : [],
      });
      summaries.sort((left, right) => left.teamName.localeCompare(right.teamName));
    }
  }

  if (!summaries.length) {
    return null;
  }

  return {
    enteredEtapaNumber: params.enteredEtapaNumber,
    highestStage: summaries.reduce((current, item) => Math.max(current, item.highestStage), 0),
    teams: summaries,
  };
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
  const [activityOptions, setActivityOptions] = useState<ActivityCatalogItem[]>([]);
  const [page, setPage] = useState(1);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingActivities, setIsLoadingActivities] = useState(false);
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

  const deferredActivitySearch = useDeferredValue(form.activitySearch);
  const isEditing = Boolean(editingScheduleId);
  const currentEditingSchedule = useMemo(
    () => (editingScheduleId ? schedules.find((item) => item.id === editingScheduleId) ?? null : null),
    [editingScheduleId, schedules],
  );
  const canSubmitCancellation = isReasonSelectionValid(reasonOptions, cancelReasonCode, cancelReasonNotes) && !isCancelling;
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
  }, [activeFilters.endDate, activeFilters.projectId, activeFilters.sgdTypeId, activeFilters.startDate, activeFilters.status, activeFilters.teamId, activeFilters.workCompletionStatus, schedules]);

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
          executionDeadline,
          daysDiff,
        };
      })
      .filter((item): item is {
        id: string;
        sob: string;
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
    }
  }, []);

  const fetchBoardSnapshot = useCallback(async () => {
    if (!accessToken) {
      return null;
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
        throw new Error(data.message ?? "Falha ao carregar programacao.");
      }

      return data;
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
    }
  }, [applyBoardSnapshot, fetchBoardSnapshot]);

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

  useEffect(() => {
    if (isEditing) {
      return;
    }

    setIsEtapaManuallyEdited(false);
  }, [form.projectId, form.date, form.teamIds, isEditing]);

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
        const params = new URLSearchParams({
          nextEtapaProjectId: form.projectId,
          nextEtapaDate: form.date,
          nextEtapaTeamIds: form.teamIds.join(","),
        });

        const response = await fetch(`/api/programacao?${params.toString()}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          signal: controller.signal,
        });

        const data = (await response.json().catch(() => ({}))) as ProgrammingResponse;
        if (!response.ok || !data.nextEtapaNumber) {
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

          return { ...current, etapaNumber: String(data.nextEtapaNumber) };
        });
        setInvalidFields((current) => current.filter((item) => item !== "etapaNumber"));
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          return;
        }
      }
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [accessToken, form.date, form.etapaFinal, form.etapaUnica, form.projectId, form.teamIds, isEditing, isEtapaManuallyEdited, isVisualizationMode]);

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
    const query = new URLSearchParams({
      etapaValidationProjectId: params.projectId,
      etapaValidationTeamIds: params.teamIds.join(","),
      etapaValidationNumber: String(params.etapaNumber),
    });

    if (params.excludeProgrammingId) {
      query.set("etapaValidationExcludeProgrammingId", params.excludeProgrammingId);
    }
    if (params.currentEditingStage) {
      query.set("etapaValidationCurrentStage", String(params.currentEditingStage));
    }
    if (params.currentEditingDate) {
      query.set("etapaValidationCurrentDate", params.currentEditingDate);
    }
    if (params.currentEditingTeamId) {
      query.set("etapaValidationCurrentTeamId", params.currentEditingTeamId);
    }

    const response = await fetch(`/api/programacao?${query.toString()}`, {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const data = (await response.json().catch(() => ({}))) as StageValidationResponse;
    if (!response.ok) {
      throw new Error(data.message ?? "Falha ao validar a etapa da programacao.");
    }

    if (data.hasConflict && Array.isArray(data.teams) && data.teams.length) {
      return {
        enteredEtapaNumber: Number(data.enteredEtapaNumber ?? params.etapaNumber),
        highestStage: Number(data.highestStage ?? 0),
        teams: data.teams,
      };
    }

    return null;
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
    if (!accessToken || !cancelTarget) {
      return;
    }

    const selectedReasonText = buildReasonText(reasonOptions, cancelReasonCode, cancelReasonNotes);
    if (!selectedReasonText) {
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
          reason: selectedReasonText,
          expectedUpdatedAt: cancelTarget.updatedAt,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as SaveProgrammingResponse;
      if (!response.ok) {
        setFeedback({
          type: "error",
          message: buildConflictFeedbackMessage(data, "Falha ao cancelar programacao."),
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
      } catch {
        if (!data.warning) {
          setFeedback({
            type: "success",
            message: `${data.message ?? "Programacao cancelada com sucesso."} Programacao salva com sucesso, mas houve falha ao atualizar a visualizacao.`,
          });
        }
      }
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
      const response = await fetch("/api/programacao", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          id: postponeTarget.id,
          action: "ADIAR",
          reason: selectedReasonText,
          newDate: postponeDate,
          expectedUpdatedAt: postponeTarget.updatedAt,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as SaveProgrammingResponse;
      if (!response.ok) {
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
      } catch {
        if (!data.warning) {
          setFeedback({
            type: "success",
            message: `${data.message ?? "Programacao adiada com sucesso."} Programacao salva com sucesso, mas houve falha ao atualizar a visualizacao.`,
          });
        }
      }
    } catch {
      setFeedback({
        type: "error",
        message: "Falha ao adiar programacao.",
      });
      openAlertModal("Falha ao validar adiamento", "Falha ao adiar programacao.");
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

      const executeSaveRequest = (token: string) => fetch("/api/programacao", {
        method: editingScheduleId ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: requestBody,
      });

      let response = await executeSaveRequest(initialAccessToken);
      if (response.status === 401) {
        const refreshedAccessToken = await resolveLatestAccessToken();
        if (refreshedAccessToken && refreshedAccessToken !== initialAccessToken) {
          response = await executeSaveRequest(refreshedAccessToken);
        }
      }

      const data = (await response.json().catch(() => ({}))) as BatchCreateResponse & SaveProgrammingResponse;
      if (!response.ok || (editingScheduleId ? !data.id : !data.success)) {
        if (data.hasConflict && Array.isArray(data.teams) && data.teams.length) {
          setStageConflictModal({
            enteredEtapaNumber: Number(data.enteredEtapaNumber ?? etapaNumber),
            highestStage: Number(data.highestStage ?? 0),
            teams: data.teams,
          });
        }

        showSubmitFeedback(
          "error",
          buildConflictFeedbackMessage(
            data,
            editingScheduleId ? "Falha ao editar programacao." : "Falha ao cadastrar programacao em lote.",
          ),
        );
        if (!(data.hasConflict && Array.isArray(data.teams) && data.teams.length)) {
          openAlertModal(
            data.error === "conflict"
              ? (editingScheduleId ? "Conflito ao salvar edicao" : "Conflito ao cadastrar programacao")
              : (editingScheduleId ? "Falha ao salvar edicao" : "Falha ao cadastrar programacao"),
            buildConflictFeedbackMessage(
              data,
              editingScheduleId ? "Falha ao editar programacao." : "Falha ao cadastrar programacao em lote.",
            ),
            buildConflictAlertDetails(data),
          );
        }
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
      } catch {
        if (!data.warning) {
          showSubmitFeedback(
            "success",
            `${successMessage}${hiddenByFiltersWarning ? ` ${hiddenByFiltersWarning}` : ""} Programacao salva com sucesso, mas houve falha ao atualizar a visualizacao.`,
          );
        }
      }
    } catch {
      const message = editingScheduleId ? "Falha ao editar programacao." : "Falha ao cadastrar programacao em lote.";
      showSubmitFeedback(
        "error",
        message,
      );
      openAlertModal(
        editingScheduleId ? "Falha ao salvar edicao" : "Falha ao cadastrar programacao",
        message,
      );
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
      const header = ["SOB", "Data limite", "Status do prazo", "Dias para vencimento", "Faixa", "Janela selecionada"];
      const rows = deadlineSobCards.map((item) => [
        item.sob,
        formatDate(item.executionDeadline),
        item.statusLabel,
        item.daysDiff,
        item.rangeLabel,
        `${deadlineWindowDays} dias`,
      ]);

      const csvLines = [header, ...rows].map((line) => line.map((item) => escapeCsvValue(item)).join(";"));
      const csv = `\uFEFF${csvLines.join("\n")}`;
      const exportDate = new Date().toISOString().slice(0, 10);
      downloadCsvFile(csv, `prazos_obras_${deadlineWindowDays}dias_${exportDate}.csv`);
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
      const header = [
        "Data execucao",
        "Projeto",
        "Equipe",
        "Base",
        "Hora inicio",
        "Hora termino",
        "Periodo",
        "Nº EQ - Numero",
        "Tipo de SGD",
        "Alimentador",
        "Inicio de desligamento",
        "Termino de desligamento",
        "Apoio",
        "Descricao do servico",
        "Status",
        "Motivo do status",
        "Status alterado em",
        "POSTE",
        "ESTRUTURA",
        "TRAFO",
        "REDE",
        "ETAPA",
        "Estado trabalho",
        "Nº Clientes afetados",
        "SGD",
        "PI",
        "PEP",
        "Criado por",
        "Criado em",
        "Atualizado por",
        "Atualizado em",
      ];
      const rows = filteredSchedules.map((schedule) => {
        const project = projectMap.get(schedule.projectId);
        const team = resolveScheduleTeamInfo(schedule, teamMap);
        const displayStatus = getDisplayProgrammingStatus(schedule);
        return [
          formatDate(schedule.date),
          project?.code ?? schedule.projectId,
          team.name,
          team.serviceCenterName ?? "-",
          schedule.startTime,
          schedule.endTime,
          schedule.period === "integral" ? "Integral" : "Parcial",
          schedule.electricalField || "",
          schedule.sgdTypeDescription || "",
          schedule.feeder || "",
          schedule.outageStartTime || "",
          schedule.outageEndTime || "",
          schedule.support || "",
          schedule.serviceDescription || "",
          displayStatus,
          schedule.statusReason || "",
          formatDateTime(schedule.statusChangedAt ?? ""),
          schedule.posteQty,
          schedule.estruturaQty,
          schedule.trafoQty,
          schedule.redeQty,
          schedule.etapaNumber ?? "",
          schedule.workCompletionStatus ?? "",
          schedule.affectedCustomers,
          schedule.documents?.sgd?.number ?? "",
          schedule.documents?.pi?.number ?? "",
          schedule.documents?.pep?.number ?? "",
          formatAuditActor(schedule.createdByName),
          formatDateTime(schedule.createdAt),
          formatAuditActor(schedule.updatedByName),
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

    if (!enelExportCooldown.tryStart()) {
      setFeedback({
        type: "error",
        message: `Aguarde ${enelExportCooldown.getRemainingSeconds()}s antes de exportar novamente.`,
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
        "ENCARREGADO",
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

      const structureAccumulator = new Map<string, { codeCount: Record<string, number>; teamCount: number }>();
      for (const schedule of filteredSchedules) {
        const key = `${schedule.projectId}__${schedule.date}`;
        const current = structureAccumulator.get(key) ?? { codeCount: {}, teamCount: 0 };
        current.teamCount += 1;

        const teamCode = resolveTeamStructureCode(resolveScheduleTeamInfo(schedule, teamMap));
        if (teamCode) {
          current.codeCount[teamCode] = (current.codeCount[teamCode] ?? 0) + 1;
        }

        structureAccumulator.set(key, current);
      }

      const rows = filteredSchedules.map((schedule) => {
        const project = projectMap.get(schedule.projectId);
        const team = resolveScheduleTeamInfo(schedule, teamMap);
        const scheduleGroupKey = `${schedule.projectId}__${schedule.date}`;
        const structureSummaryGroup = structureAccumulator.get(scheduleGroupKey);
        const displayStatus = getDisplayProgrammingStatus(schedule);
        const periodLabel = schedule.period === "integral" ? "INTEGRAL" : "PARCIAL";
        const sgdExportValue = schedule.electricalField ?? "";
        const sgdExportColumn = (schedule.sgdExportColumn ?? "").trim().toUpperCase();
        const sgdTypeDescription = (schedule.sgdTypeDescription ?? "").trim().toUpperCase();
        const isAreaLivreSgd = sgdExportColumn === "AREA_LIVRE" || sgdExportColumn === "AREA LIVRE"
          || sgdTypeDescription === "AREA_LIVRE" || sgdTypeDescription === "AREA LIVRE";
        const isSgdBt = sgdExportColumn === "SGD_BT" || sgdExportColumn === "SGD BT"
          || sgdTypeDescription === "SGD_BT" || sgdTypeDescription === "SGD BT";
        const isSgdTet = sgdExportColumn === "SGD_TET" || sgdExportColumn === "SGD TET"
          || sgdTypeDescription === "SGD_TET" || sgdTypeDescription === "SGD TET"
          || sgdTypeDescription === "SGD TET";
        const isSgdAtMtVyp = !isAreaLivreSgd && !isSgdBt && !isSgdTet && (
          !sgdExportColumn
          || sgdExportColumn === "SGD_AT_MT_VYP"
          || sgdExportColumn === "SGD AT/MT/VYP"
          || sgdExportColumn === "SGD AT/MT"
          || sgdExportColumn === "SGD AT"
          || sgdExportColumn === "SGD MT"
          || sgdExportColumn === "SGD VYP"
          || sgdTypeDescription === "SGD AT/MT/VYP"
          || sgdTypeDescription === "SGD AT/MT"
          || sgdTypeDescription === "SGD AT"
          || sgdTypeDescription === "SGD MT"
          || sgdTypeDescription === "SGD VYP"
        );
        const sgdAtMtVyp = isSgdAtMtVyp ? sgdExportValue : "";
        const sgdBt = isSgdBt ? sgdExportValue : "";
        const sgdTet = isSgdTet ? sgdExportValue : "";
        const infoStatus = formatInfoStatusEtapa(schedule.etapaNumber, schedule.etapaUnica, schedule.etapaFinal);
        const scheduleCreatedDate = schedule.createdAt ? schedule.createdAt.slice(0, 10) : "";
        const estruturaValue = structureSummaryGroup
          ? formatStructureSummaryByCode(structureSummaryGroup.codeCount)
          : "";

        return [
          project?.base ?? "",
          project?.serviceType ?? "",
          project?.code ?? "",
          formatDate(schedule.date),
          formatWeekday(schedule.date),
          periodLabel,
          schedule.startTime ?? "",
          schedule.endTime ?? "",
          formatExpectedHours(schedule.expectedMinutes ?? 0),
          displayStatus ?? "",
          infoStatus,
          project?.priority ?? "",
          estruturaValue,
          team.foremanName ?? "",
          schedule.support ?? "",
          project?.utilityResponsible ?? "",
          project?.partner ?? "",
          "INDICA",
          schedule.sgdTypeDescription ?? "",
          schedule.affectedCustomers ?? "",
          sgdAtMtVyp,
          sgdBt,
          sgdTet,
          schedule.electricalField ?? "",
          schedule.outageStartTime ?? "",
          schedule.outageEndTime ?? "",
          schedule.feeder ?? "",
          project?.street ?? "",
          project?.district ?? "",
          project?.city ?? "",
          schedule.serviceDescription ?? "",
          schedule.statusReason ?? "",
          schedule.statusReason ?? "",
          formatDate(scheduleCreatedDate),
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
      const exportSchedules = filteredSchedules.filter((schedule) => {
        const project = projectMap.get(schedule.projectId);
        const serviceType = String(project?.serviceType ?? "").trim().toUpperCase();
        return serviceType !== "EMERGENCIAL";
      });

      if (!exportSchedules.length) {
        setFeedback({
          type: "error",
          message: "Nenhuma programacao elegivel para EXTRACAO ENEL NOVO (Tipo de Serviço EMERGENCIAL nao entra).",
        });
        return;
      }

      const header = [
        "BASE",
        "Tipo de Serviço",
        "SOB",
        "Data Execução",
        "Dia da semana",
        "Período",
        "Hor Inic obra",
        "Hor Térm obra",
        "Tempo previsto",
        "STATUS",
        "INFO STATUS",
        "PRIORIDADE",
        "Estrutura",
        "Placa",
        "Anotação",
        "Apoio",
        "Responsáveis Ampla",
        "Parceira",
        "Responsável Execução",
        "AREA LIVRE",
        "SOLICITAÇÃO",
        "TIPO DE SGD",
        "NÚMERO SGD",
        "Nº Clientes Afetados",
        "Nº EQ (RE, CO,CF, CC ou TR)",
        "Inic deslig",
        "Térm deslig",
        "Alim",
        "Logradouro",
        "Bairro",
        "Município",
        "Descrição do serviço",
        "Motivo do cancelamento / Parcial / Adiamento",
        "Responsável cancelamento / Parcial / Adiamento",
        "Data da programação",
        "Tipo de avanço",
        "BT / MT",
        "Tipo de rede",
        "Tipo de serviço",
        "Tipo de cabo",
        "Status rede",
        "km",
        "Tipo de equipamento",
        "Status equipamento",
        "Potência equipamento",
        "Qtd equipamentos",
        "Status poste",
        "Tipo poste",
        "Qtd Postes",
        "Qtd Clandestinos",
      ];

      const groupedAccumulator = new Map<string, {
        baseSchedule: ScheduleItem;
        schedules: ScheduleItem[];
        teamLabels: Set<string>;
        plates: Set<string>;
        foremanNames: Set<string>;
      }>();
      for (const schedule of exportSchedules) {
        const key = `${schedule.projectId}__${schedule.date}`;
        const current = groupedAccumulator.get(key) ?? {
          baseSchedule: schedule,
          schedules: [],
          teamLabels: new Set<string>(),
          plates: new Set<string>(),
          foremanNames: new Set<string>(),
        };

        current.schedules.push(schedule);

        const team = resolveScheduleTeamInfo(schedule, teamMap);
        const teamLabel = String(team.name ?? "").trim();
        if (teamLabel) {
          current.teamLabels.add(teamLabel);
        }

        const vehiclePlate = (team.vehiclePlate ?? "").trim();
        if (vehiclePlate) {
          current.plates.add(vehiclePlate);
        }

        const foremanName = String(team.foremanName ?? "").trim();
        if (foremanName) {
          current.foremanNames.add(foremanName);
        }

        groupedAccumulator.set(key, current);
      }

      const rows = Array.from(groupedAccumulator.values()).map((group) => {
        const schedule = group.baseSchedule;
        const project = projectMap.get(schedule.projectId);
        const firstStatusReason = group.schedules
          .map((item) => String(item.statusReason ?? "").trim())
          .find(Boolean) ?? "";
        const firstServiceDescription = group.schedules
          .map((item) => String(item.serviceDescription ?? "").trim())
          .find(Boolean) ?? "";
        const sgdTypeDescription = (schedule.sgdTypeDescription ?? "").trim();
        const isAreaLivre = isAreaLivreSgd(schedule.sgdExportColumn, schedule.sgdTypeDescription);
        const infoStatus = formatInfoStatusEtapa(schedule.etapaNumber, schedule.etapaUnica, schedule.etapaFinal);
        const createdDate = schedule.createdAt ? schedule.createdAt.slice(0, 10) : "";
        const estruturaValue = Array.from(group.teamLabels).sort((a, b) => a.localeCompare(b)).join("|");
        const plateValue = Array.from(group.plates).sort((a, b) => a.localeCompare(b)).join(" - ");
        const foremanNamesValue = Array.from(group.foremanNames).sort((a, b) => a.localeCompare(b)).join(" / ");
        const numEqValue = `${(schedule.electricalField ?? "").trim()}${(schedule.electricalEqCode ?? "").trim()}`;
        const serviceDescriptionValue = firstServiceDescription
          || (project?.serviceName ?? "").trim();

        return [
          extractTextAfterDash(project?.base ?? ""),
          project?.serviceType ?? "",
          project?.code ?? "",
          formatDateExecutionEnelNovo(schedule.date),
          formatWeekdayExecutionEnelNovo(schedule.date),
          resolveEnelNovoPeriod(schedule.startTime, schedule.endTime),
          schedule.startTime ?? "",
          schedule.endTime ?? "",
          formatExpectedTimeAsClock(schedule.expectedMinutes ?? 0),
          resolveEnelNovoStatus(schedule),
          infoStatus,
          project?.priority ?? "",
          estruturaValue,
          plateValue,
          schedule.note ?? "",
          schedule.support ?? "",
          project?.utilityFieldManager ?? "",
          extractTextBeforeDash(project?.partner ?? ""),
          foremanNamesValue,
          isAreaLivre ? "SIM" : "NAO",
          isAreaLivre ? "NAO" : "SIM",
          sgdTypeDescription,
          normalizeSgdNumberForExport(schedule.documents?.sgd?.number),
          schedule.affectedCustomers ?? "",
          numEqValue,
          schedule.outageStartTime ?? "",
          schedule.outageEndTime ?? "",
          schedule.feeder ?? "",
          project?.street ?? "",
          project?.district ?? "",
          project?.city ?? "",
          serviceDescriptionValue,
          firstStatusReason,
          "",
          formatDate(createdDate),
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          schedule.posteQty ?? "",
          "",
        ];
      });

      const XLSX = await import("xlsx");
      const worksheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
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
          <article className={styles.card}>
          <h3 className={styles.cardTitle}>Prazos das Obras</h3>
          <div className={styles.deadlineSummaryGrid}>
            <article className={`${styles.deadlineSummaryCard} ${styles.deadlineSummaryToday}`}>
              <strong>Vence hoje</strong>
              <span>{deadlineSummary.dueToday}</span>
            </article>
            <article className={`${styles.deadlineSummaryCard} ${styles.deadlineSummarySoon}`}>
              <strong>Vence em breve</strong>
              <span>{deadlineSummary.dueSoon}</span>
            </article>
            <article className={`${styles.deadlineSummaryCard} ${styles.deadlineSummaryOverdue}`}>
              <strong>Vencida</strong>
              <span>{deadlineSummary.overdue}</span>
            </article>
            <article className={`${styles.deadlineSummaryCard} ${styles.deadlineSummaryNormal}`}>
              <strong>No prazo</strong>
              <span>{deadlineSummary.normal}</span>
            </article>
          </div>

          <div className={`${styles.sectionHeader} ${styles.deadlineSectionHeader}`}>
            <div>
              <h4>{deadlineWindowHeading}</h4>
              <p>Cards por obra com data limite, status do prazo e alerta visual.</p>
            </div>
            <div className={styles.deadlineViewToggle} role="group" aria-label="Janela de prazo dos cards SOB">
              <button
                type="button"
                className={`${styles.deadlineViewToggleButton} ${deadlineViewMode === "15" ? styles.deadlineViewToggleButtonActive : ""}`}
                onClick={() => setDeadlineViewMode("15")}
              >
                15 dias
              </button>
              <button
                type="button"
                className={`${styles.deadlineViewToggleButton} ${deadlineViewMode === "30" ? styles.deadlineViewToggleButtonActive : ""}`}
                onClick={() => setDeadlineViewMode("30")}
              >
                30 dias
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setIsDeadlineModalOpen(true)}
              >
                Ver todos
              </button>
            </div>
          </div>

          {deadlineSobPages.length ? (
            <div className={styles.deadlineCarouselWrapper}>
              <button
                type="button"
                className={styles.deadlineCarouselButton}
                onClick={() => setDeadlineCarouselPage((current) => Math.max(0, current - 1))}
                disabled={deadlineCarouselPage === 0}
                aria-label="Pagina anterior dos cards SOB"
              >
                {"<"}
              </button>
              <div className={styles.deadlineCarouselViewport}>
                <div
                  className={styles.deadlineCarouselTrack}
                  style={{ transform: `translateX(-${deadlineCarouselPage * 100}%)` }}
                >
                  {deadlineSobPages.map((pageItems, pageIndex) => (
                    <div key={`deadline-page-${pageIndex}`} className={styles.deadlineCarouselPage}>
                      {pageItems.map((item) => (
                        <article
                          key={item.id}
                          className={`${styles.deadlineSobCard} ${
                            item.visualVariant === "OVERDUE_CRITICAL"
                              ? styles.deadlineSobCardOverdueCritical
                              : item.visualVariant === "OVERDUE"
                                ? styles.deadlineSobCardOverdue
                                : item.visualVariant === "TODAY"
                                  ? styles.deadlineSobCardToday
                                  : item.visualVariant === "SOON"
                                    ? styles.deadlineSobCardSoon
                                    : styles.deadlineSobCardNormal
                          }`}
                        >
                          <strong>SOB {item.sob}</strong>
                          <span>Data limite: {formatDate(item.executionDeadline)}</span>
                          <span>Status: {item.statusLabel}</span>
                        </article>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              <button
                type="button"
                className={styles.deadlineCarouselButton}
                onClick={() => setDeadlineCarouselPage((current) => Math.min(totalDeadlineCarouselPages - 1, current + 1))}
                disabled={deadlineCarouselPage >= totalDeadlineCarouselPages - 1}
                aria-label="Proxima pagina dos cards SOB"
              >
                {">"}
              </button>
            </div>
          ) : (
            <p className={styles.emptyHint}>
              Nenhuma obra com data limite ate {deadlineWindowDays} dias a frente.
            </p>
          )}

          {deadlineSobPages.length ? (
            <p className={styles.deadlineCarouselPageInfo}>
              Pagina {deadlineCarouselPage + 1} de {totalDeadlineCarouselPages}
            </p>
          ) : null}
        </article>

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
          <span className={`${styles.weekLegendItem} ${styles.weekLegendRescheduled}`}>Reprogramado</span>
          <span className={`${styles.weekLegendItem} ${styles.weekLegendCompleted}`}>Concluido</span>
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
                  <small>{team.foremanName || "Sem encarregado"}</small>
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
                          const displayStatus = getDisplayProgrammingStatus(schedule);
                          const hasSgd = Boolean(schedule.documents?.sgd?.approvedAt?.trim());
                          const hasPi = Boolean(schedule.documents?.pi?.approvedAt?.trim());
                          const isAreaLivreSgdType = (schedule.sgdExportColumn ?? "").toUpperCase() === "AREA_LIVRE";

                          return (
                            <article
                              key={schedule.id}
                              className={`${styles.weekCard} ${scheduleCardClassName(displayStatus, schedule.workCompletionStatus)}`}
                            >
                              <div className={styles.weekCardTop}>
                                <strong>{sob}</strong>
                              </div>

                              <div className={styles.weekIndicators}>
                                {isAreaLivreSgdType ? (
                                  <span className={styles.weekIndicatorOn}>AREA LIVRE</span>
                                ) : (
                                  <>
                                    <span className={hasSgd ? styles.weekIndicatorOn : styles.weekIndicatorOff}>SGD</span>
                                    <span className={hasPi ? styles.weekIndicatorOn : styles.weekIndicatorOff}>PI</span>
                                  </>
                                )}
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

      {isDeadlineModalOpen ? (
        <div className={styles.modalOverlay} onClick={() => setIsDeadlineModalOpen(false)}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Todos os prazos das obras ({deadlineWindowDays} dias)</h4>
                <p className={styles.modalSubtitle}>
                  Total: {deadlineSobCards.length} | Janela: ate {deadlineWindowDays} dias | Concluidas nao entram.
                </p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={() => setIsDeadlineModalOpen(false)}>
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              <div className={styles.deadlineModalActions}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => void handleExportDeadlineModalCsv()}
                  disabled={isExportingDeadlineModal || !deadlineSobCards.length}
                >
                  {isExportingDeadlineModal ? "Exportando..." : "Exportar Excel (CSV)"}
                </button>
              </div>

              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>SOB</th>
                      <th>Data limite</th>
                      <th>Status do prazo</th>
                      <th>Dias para vencimento</th>
                      <th>Faixa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deadlineSobCards.length ? (
                      deadlineSobCards.map((item) => (
                        <tr key={`deadline-modal-${item.id}`}>
                          <td>{item.sob}</td>
                          <td>{formatDate(item.executionDeadline)}</td>
                          <td>{item.statusLabel}</td>
                          <td>{item.daysDiff}</td>
                          <td>{item.rangeLabel}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td className={styles.emptyRow} colSpan={5}>
                          Nenhuma obra encontrada para a janela selecionada.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </article>
        </div>
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
                <p><strong>Status:</strong> {getDisplayProgrammingStatus(detailsTarget)}</p>
                <p><strong>Criado por:</strong> {formatAuditActor(detailsTarget.createdByName)}</p>
                <p><strong>Criado em:</strong> {formatDateTime(detailsTarget.createdAt)}</p>
                <p><strong>Atualizado por:</strong> {formatAuditActor(detailsTarget.updatedByName)}</p>
                <p><strong>Atualizado em:</strong> {formatDateTime(detailsTarget.updatedAt)}</p>
                <p><strong>Projeto:</strong> {projectMap.get(detailsTarget.projectId)?.code ?? detailsTarget.projectId}</p>
                <p><strong>Equipe:</strong> {resolveScheduleTeamInfo(detailsTarget, teamMap).name}</p>
                <p><strong>Data execucao:</strong> {formatDate(detailsTarget.date)}</p>
                <p><strong>Horario:</strong> {detailsTarget.startTime} - {detailsTarget.endTime}</p>
                <p><strong>Inicio de desligamento:</strong> {detailsTarget.outageStartTime || "-"}</p>
                <p><strong>Termino de desligamento:</strong> {detailsTarget.outageEndTime || "-"}</p>
                <p><strong>POSTE:</strong> {detailsTarget.posteQty}</p>
                <p><strong>ESTRUTURA:</strong> {detailsTarget.estruturaQty}</p>
                <p><strong>TRAFO:</strong> {detailsTarget.trafoQty}</p>
                <p><strong>REDE:</strong> {detailsTarget.redeQty}</p>
                <p><strong>ETAPA:</strong> {detailsTarget.etapaNumber ?? "-"}</p>
                <p><strong>ETAPA ÚNICA:</strong> {detailsTarget.etapaUnica ? "Sim" : "Nao"}</p>
                <p><strong>ETAPA FINAL:</strong> {detailsTarget.etapaFinal ? "Sim" : "Nao"}</p>
                <p><strong>Estado Trabalho:</strong> {detailsTarget.workCompletionStatus || "-"}</p>
                <p><strong>Nº Clientes Afetados:</strong> {detailsTarget.affectedCustomers}</p>
                <p><strong>Tipo de SGD:</strong> {detailsTarget.sgdTypeDescription || "-"}</p>
                <p><strong>Numero SGD:</strong> {normalizeSgdNumberForExport(detailsTarget.documents?.sgd?.number) || "-"}</p>
                <p><strong>Nº EQ (tipo):</strong> {detailsTarget.electricalEqCode || "-"}</p>
                <p><strong>Apoio:</strong> {detailsTarget.support || "-"}</p>
                <p><strong>Alimentador:</strong> {detailsTarget.feeder || "-"}</p>
                <p><strong>Nº EQ (numero):</strong> {detailsTarget.electricalField || "-"}</p>
                <p className={styles.detailWide}><strong>Descricao do servico:</strong> {detailsTarget.serviceDescription || "-"}</p>
                <p className={styles.detailWide}><strong>Anotacao:</strong> {detailsTarget.note || "-"}</p>
                {isInactiveProgrammingStatus(getDisplayProgrammingStatus(detailsTarget)) ? (
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
                          <span>{formatDateTime(item.changedAt)} | {formatAuditActor(item.changedByName)}</span>
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
                registro sera criado para a nova data com status REPROGRAMADA. A nova data deve ser posterior a data
                atual da programacao.
              </p>

              <label className={styles.field}>
                <span>
                  Nova data da programacao <span className="requiredMark">*</span>
                </span>
                <input
                  type="date"
                  value={postponeDate}
                  onChange={(event) => setPostponeDate(event.target.value)}
                  min={postponeTarget ? addDays(postponeTarget.date, 1) : today}
                  disabled={isPostponing}
                />
              </label>

              <label className={styles.field}>
                <span>
                  Motivo do adiamento <span className="requiredMark">*</span>
                </span>
                <select
                  value={postponeReasonCode}
                  onChange={(event) => setPostponeReasonCode(event.target.value)}
                  disabled={isPostponing}
                >
                  <option value="">Selecione</option>
                  {reasonOptions.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.label}
                    </option>
                  ))}
                </select>
                {resolveReasonOption(reasonOptions, postponeReasonCode)?.requiresNotes ? (
                  <textarea
                    value={postponeReasonNotes}
                    onChange={(event) => setPostponeReasonNotes(event.target.value)}
                    rows={3}
                    placeholder="Descreva a observacao complementar do motivo."
                    disabled={isPostponing}
                  />
                ) : null}
              </label>

              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => void confirmPostpone()}
                  disabled={isPostponing}
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
                Selecione o motivo do cancelamento. Quando o motivo exigir observacao, preencha o campo complementar.
              </p>

              <label className={styles.field}>
                <span>
                  Motivo do cancelamento <span className="requiredMark">*</span>
                </span>
                <select
                  value={cancelReasonCode}
                  onChange={(event) => setCancelReasonCode(event.target.value)}
                >
                  <option value="">Selecione</option>
                  {reasonOptions.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.label}
                    </option>
                  ))}
                </select>
                {resolveReasonOption(reasonOptions, cancelReasonCode)?.requiresNotes ? (
                  <textarea
                    value={cancelReasonNotes}
                    onChange={(event) => setCancelReasonNotes(event.target.value)}
                    rows={3}
                    placeholder="Descreva a observacao complementar do motivo."
                  />
                ) : null}
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

      {alertModal ? (
        <div className={styles.modalOverlay} onClick={closeAlertModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>{alertModal.title}</h4>
                <p className={styles.modalSubtitle}>Revise os dados antes de tentar novamente.</p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={closeAlertModal}>
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              <div className={styles.warningCard}>
                <p>{alertModal.message}</p>
              </div>

              {alertModal.details?.length ? (
                <div className={styles.historyCard}>
                  <div className={styles.historyCardHeader}>
                    <strong>Possiveis pontos para revisar</strong>
                  </div>
                  <ul className={styles.alertList}>
                    {alertModal.details.map((detail) => (
                      <li key={detail}>{detail}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </article>
        </div>
      ) : null}

      {stageConflictModal ? (
        <div className={styles.modalOverlay} onClick={() => setStageConflictModal(null)}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Conflito de ETAPA</h4>
                <p className={styles.modalSubtitle}>
                  A ETAPA {stageConflictModal.enteredEtapaNumber} conflita com o historico ja existente para este projeto.
                </p>
              </div>
              <button
                type="button"
                className={styles.modalCloseButton}
                onClick={() => setStageConflictModal(null)}
              >
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              <div className={styles.warningCard}>
                <p>
                  <strong>Maior etapa encontrada:</strong> {stageConflictModal.highestStage}
                </p>
                <p>
                  Corrija o campo <strong>ETAPA</strong> no formulario antes de tentar salvar novamente.
                </p>
              </div>

              <div className={styles.historyList}>
                {stageConflictModal.teams.map((team) => (
                  <article key={team.teamId} className={styles.historyCard}>
                    <div className={styles.historyCardHeader}>
                      <strong>{team.teamName}</strong>
                      <span>Maior etapa: {team.highestStage}</span>
                    </div>
                    <div className={styles.historyChanges}>
                      <div className={styles.historyChangeItem}>
                        <strong>Etapas ja encontradas</strong>
                        <span>{team.existingStages.join(", ")}</span>
                      </div>
                      <div className={styles.historyChangeItem}>
                        <strong>Datas encontradas</strong>
                        <span>{team.existingDates.length ? team.existingDates.map(formatDate).join(", ") : "-"}</span>
                      </div>
                    </div>
                  </article>
                ))}
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
