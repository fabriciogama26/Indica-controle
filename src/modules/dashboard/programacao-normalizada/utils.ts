import { formatDate, formatDateTime } from "@/lib/utils/formatters";

import { HISTORY_ACTION_LABELS, HISTORY_FIELD_LABELS, PENDENCIA_STATUS_LABEL, STAGE_STATUS_LABELS, WORK_COMPLETION_LABELS } from "./constants";
import type { ProgrammingStage } from "./types";

export { formatDate, formatDateTime };

export function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDaysIso(dateIso: string, days: number) {
  const [year, month, day] = dateIso.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

export function getFirstDayOfMonthIso(dateIso: string) {
  const [year, month] = dateIso.split("-").map(Number);
  return toIsoDate(new Date(year, month - 1, 1));
}

export function getLastDayOfMonthIso(dateIso: string) {
  const [year, month] = dateIso.split("-").map(Number);
  return toIsoDate(new Date(year, month, 0));
}

export function startOfWeekMondayIso(dateIso: string) {
  const [year, month, day] = dateIso.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const dayOfWeek = date.getDay();
  const offset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  date.setDate(date.getDate() + offset);
  return toIsoDate(date);
}

// "Ativa" = etapa no calendario (spec 5): recebe equipe, e editavel, conta na
// numeracao — PROGRAMADA/REPROGRAMADA. A flag is_pendencia e ortogonal e nao
// muda o status de agenda; quem sai do calendario e ADIADA/CANCELADA/ANTECIPADA.
export function isActiveStageStatus(status: string) {
  return status === "PROGRAMADA" || status === "REPROGRAMADA";
}

// Coluna Etapa (spec 3.2): SO posicao — Etapa N/Final/Unica. Nunca "Pendencia"
// aqui (a pendencia vive so na coluna Status, via flag). Etapa sem data (em
// espera) ou fora do calendario nao numera.
export function getStageClassificationLabel(stage: {
  etapaUnica: boolean;
  etapaFinal: boolean;
  etapaNumber: number | null;
  workCompletionStatus: string | null;
  status: string;
}) {
  if (!isActiveStageStatus(stage.status)) return "-";
  if (stage.etapaUnica) return "Unica";
  if (stage.etapaFinal) return "Final";
  if (stage.etapaNumber) return `Etapa ${stage.etapaNumber}`;
  return "-";
}

export function getStageStatusLabel(status: string) {
  return STAGE_STATUS_LABELS[status] ?? status;
}

// Pendencia so PREVALECE como status quando a etapa esta aberta: ativa
// (PROGRAMADA/REPROGRAMADA) E nao concluida. Em estado terminal (ADIADA/
// CANCELADA/ANTECIPADA) ou concluida, o status real prevalece e a pendencia vira
// so um marcador secundario de rastreio (achado 8 da auditoria).
export function isPendenciaPrimary(stage: { isPendencia: boolean; status: string; workCompletionStatus: string | null }) {
  return stage.isPendencia && isActiveStageStatus(stage.status) && stage.workCompletionStatus !== "CONCLUIDO";
}

// Coluna Status (spec 3.2): "Pendencia" so quando e pendencia aberta; senao o
// status de agenda real.
export function getStageStatusDisplayLabel(stage: { status: string; isPendencia: boolean; workCompletionStatus: string | null }) {
  if (isPendenciaPrimary(stage)) return PENDENCIA_STATUS_LABEL;
  return getStageStatusLabel(stage.status);
}

export function getWorkCompletionLabel(code: string | null) {
  if (!code) return "Em branco";
  return WORK_COMPLETION_LABELS[code] ?? code;
}

export function sortStagesByDate(stages: ProgrammingStage[]) {
  // Etapa em espera (executionDate null) vai para o fim.
  return [...stages].sort((left, right) => (left.executionDate ?? "9999").localeCompare(right.executionDate ?? "9999"));
}

export function findActiveCompletedStage(stages: ProgrammingStage[]) {
  return stages.find((stage) => isActiveStageStatus(stage.status) && stage.workCompletionStatus === "CONCLUIDO") ?? null;
}

export function getHistoryActionLabel(actionType: string) {
  return HISTORY_ACTION_LABELS[actionType] ?? actionType;
}

export function getHistoryFieldLabel(field: string) {
  return HISTORY_FIELD_LABELS[field] ?? field;
}

export function formatHistoryChangeValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Sim" : "Nao";
  return String(value);
}

// Helpers de export (CSV/ENEL/ENEL NOVO), portados de programacao-simples/utils.ts
// e adaptados ao modelo normalizado (uma linha = uma etapa, ja com as equipes
// agregadas em stage.teams — sem precisar reagrupar por projeto+data).
export function formatWeekday(value: string) {
  if (!value) return "";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("pt-BR", { weekday: "long" });
}

export function formatExpectedHours(value: number | null) {
  const minutes = Number(value ?? 0);
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  const totalHours = minutes / 60;
  return Number.isInteger(totalHours) ? String(totalHours) : totalHours.toFixed(2);
}

export function formatExpectedTimeAsClock(value: number | null) {
  const minutes = Number(value ?? 0);
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  const safeMinutes = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const remainderMinutes = safeMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(remainderMinutes).padStart(2, "0")}:00`;
}

function parseTimeToMinutes(value: string | null) {
  const normalized = String(value ?? "").trim().slice(0, 5);
  if (!/^\d{2}:\d{2}$/.test(normalized)) return null;
  const [hours, minutes] = normalized.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return (hours * 60) + minutes;
}

export function resolveEnelNovoPeriod(startTime: string | null, endTime: string | null) {
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);
  const morningStart = 7 * 60;
  const morningEnd = 12 * 60;
  const afternoonStart = 13 * 60;

  if (startMinutes !== null && endMinutes !== null && startMinutes >= morningStart && endMinutes <= morningEnd) {
    return "MANHÃ";
  }
  if (startMinutes !== null && startMinutes >= afternoonStart) {
    return "TARDE";
  }
  return "INTEGRAL";
}

export function normalizeSgdNumberForExport(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  return normalized.split("/").map((segment) => segment.trim()).filter(Boolean).join(" / ");
}

export function formatDateExecutionEnelNovo(value: string) {
  const normalized = String(value ?? "").trim();
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return normalized;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function formatWeekdayExecutionEnelNovo(value: string) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  const parsed = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  const map = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
  return map[parsed.getDay()] ?? "";
}

export function formatInfoStatusEtapa(etapaNumber: number | null | undefined, etapaUnica?: boolean, etapaFinal?: boolean) {
  if (etapaFinal) return "ETAPA FINAL";
  if (etapaUnica) return "ETAPA ÚNICA";
  const stageNumber = Number(etapaNumber ?? 0);
  if (!Number.isFinite(stageNumber) || stageNumber <= 0) return "";
  return `${stageNumber}ª ETAPA`;
}

export function extractTextAfterDash(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  const parts = normalized.split("-");
  if (parts.length < 2) return normalized;
  return parts[parts.length - 1]?.trim() || normalized;
}

export function extractTextBeforeDash(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  const parts = normalized.split("-");
  if (parts.length < 2) return normalized;
  return parts[0]?.trim() || normalized;
}

const ENEL_STATUS_LABELS: Record<string, string> = {
  PROGRAMADA: "PROGRAMADO",
  REPROGRAMADA: "REPROGRAMADO",
  ADIADA: "ADIADO",
  CANCELADA: "CANCELADO",
  ANTECIPADA: "ANTECIPADA",
};

export function getEnelStatusLabel(status: string) {
  return ENEL_STATUS_LABELS[status] ?? ENEL_STATUS_LABELS.PROGRAMADA;
}

export function isAreaLivreSgd(sgdExportColumn: string | null | undefined, sgdTypeDescription: string | null | undefined) {
  const exportColumn = String(sgdExportColumn ?? "").trim().toUpperCase();
  const description = String(sgdTypeDescription ?? "").trim().toUpperCase();
  return exportColumn === "AREA_LIVRE" || exportColumn === "AREA LIVRE" || description === "AREA_LIVRE" || description === "AREA LIVRE";
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function resolveTeamStructureCode(team?: { teamTypeName?: string; name?: string } | null) {
  if (!team) return "";
  const normalized = normalizeSearchText(`${team.teamTypeName ?? ""} ${team.name ?? ""}`);
  if (!normalized) return "";
  if (normalized.includes("linha morta") || normalized.includes("morta") || /\bmk\b/.test(normalized)) return "MK";
  if (normalized.includes("cesto") || normalized.includes("ceto")) return "CESTO";
  if (normalized.includes("linha viva") || normalized.includes("viva") || /\blv\b/.test(normalized)) return "LV";
  return "";
}

export function formatStructureSummaryByCode(codeCountMap: Record<string, number>) {
  const priorityOrder = ["MK", "CESTO", "LV"];
  const codes = Object.keys(codeCountMap)
    .filter((code) => codeCountMap[code] > 0)
    .sort((left, right) => {
      const leftIndex = priorityOrder.indexOf(left);
      const rightIndex = priorityOrder.indexOf(right);
      if (leftIndex !== -1 && rightIndex !== -1) return leftIndex - rightIndex;
      if (leftIndex !== -1) return -1;
      if (rightIndex !== -1) return 1;
      return left.localeCompare(right);
    });

  if (!codes.length) return "";
  return codes.map((code) => `${codeCountMap[code]} ${code}`).join(" + ");
}
