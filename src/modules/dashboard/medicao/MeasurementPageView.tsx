"use client";

import { FormEvent, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import styles from "./MeasurementPageView.module.css";

type MeasurementStatus = "ABERTA" | "FECHADA" | "CANCELADA";
type MeasurementKind = "COM_PRODUCAO" | "SEM_PRODUCAO";
type ProgrammingStatus = "PROGRAMADA" | "REPROGRAMADA" | "ADIADA" | "CANCELADA";
type ProgrammingMatchStatus = "PROGRAMADA" | "NAO_PROGRAMADA";
type WorkCompletionStatus = string | null;
type EconomicWorkCompletionStatus = "CONCLUIDO" | "PARCIAL";

type ProjectItem = {
  id: string;
  code: string;
  serviceName: string;
};

type TeamItem = {
  id: string;
  name: string;
  foremanName: string;
};

type ScheduleActivity = {
  id?: string;
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
  electricalField: string;
  workCompletionStatus?: WorkCompletionStatus;
  activities: ScheduleActivity[];
};

type WorkCompletionCatalogItem = {
  code: string;
  label: string;
};

type ProgrammingResponse = {
  projects?: ProjectItem[];
  teams?: TeamItem[];
  schedules?: ScheduleItem[];
  workCompletionCatalog?: WorkCompletionCatalogItem[];
  message?: string;
};

type ActivityCatalogItem = {
  id: string;
  code: string;
  description: string;
  unit: string;
  unitValue: number;
  voicePoint: number;
};

type ActivityCatalogResponse = {
  items?: ActivityCatalogItem[];
};

type NoProductionReasonItem = {
  id: string;
  code: string;
  name: string;
};

type MeasurementMetaResponse = {
  noProductionReasons?: NoProductionReasonItem[];
  workCompletionCatalog?: WorkCompletionCatalogItem[];
  message?: string;
};

type RateSuggestionSource = "ELECTRICAL_FIELD" | "PREVIOUS_MEASUREMENT" | "MANUAL";

type RateSuggestionResponse = {
  projectId?: string;
  rate?: number | null;
  source?: RateSuggestionSource;
  message?: string;
};

type MeasurementRow = {
  rowId: string;
  activityId: string;
  programmingActivityId: string | null;
  projectActivityForecastId: string | null;
  code: string;
  description: string;
  unit: string;
  quantity: string;
  mvaQuantity: string;
  workedHours: string;
  voicePoint: string;
  unitValue: string;
  observation: string;
};

type OrderItem = {
  id: string;
  orderNumber: string;
  programmingId: string | null;
  projectId: string;
  teamId: string;
  executionDate: string;
  measurementDate: string;
  voicePoint: number;
  manualRate: number;
  measurementKind: MeasurementKind;
  noProductionReasonId: string | null;
  noProductionReasonName: string;
  status: MeasurementStatus;
  notes: string;
  projectCode: string;
  teamName: string;
  foremanName: string;
  updatedAt: string;
  totalAmount: number;
  itemCount: number;
  programmingMatchStatus: ProgrammingMatchStatus;
  matchedProgrammingId: string | null;
  programmingCompletionStatus: WorkCompletionStatus;
  programmingCompletionStatusChangedAfterMeasurement: boolean;
};

type OrderListResponse = {
  orders?: OrderItem[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

type OrderDetailItem = {
  id: string;
  activityId: string;
  programmingActivityId: string | null;
  projectActivityForecastId: string | null;
  code: string;
  description: string;
  unit: string;
  quantity: number;
  mvaQuantity: number | null;
  workedHours: number | null;
  voicePoint: number;
  manualRate: number;
  unitValue: number;
  totalValue: number;
  observation: string;
};

type OrderDetail = {
  id: string;
  orderNumber: string;
  programmingId: string | null;
  projectId: string;
  teamId: string;
  teamName: string;
  foremanName: string;
  executionDate: string;
  measurementDate: string;
  voicePoint: number;
  manualRate: number;
  measurementKind: MeasurementKind;
  noProductionReasonId: string | null;
  noProductionReasonName: string;
  status: MeasurementStatus;
  notes: string;
  programmingMatchStatus: ProgrammingMatchStatus;
  matchedProgrammingId: string | null;
  programmingCompletionStatus: WorkCompletionStatus;
  programmingCompletionStatusChangedAfterMeasurement: boolean;
  items: OrderDetailItem[];
  updatedAt: string;
};

type OrderDetailResponse = {
  order?: OrderDetail;
  message?: string;
};

type OrderHistoryEntry = {
  id: string;
  action: string;
  reason: string;
  changes?: Record<string, { from?: unknown; to?: unknown }>;
  metadata?: Record<string, unknown>;
  changedAt: string;
  changedByName: string;
};

type OrderHistoryResponse = {
  history?: OrderHistoryEntry[];
  message?: string;
};

type MassImportIssue = {
  rowNumber: number;
  column: string;
  value: string;
  error: string;
};

type ParsedMassImportRow = {
  rowNumber: number;
  projectCode: string;
  projectRaw: string;
  teamName: string;
  teamRaw: string;
  executionDate: string | null;
  executionDateRaw: string;
  voiceCode: string;
  voiceRaw: string;
  quantity: number | null;
  quantityRaw: string;
  mvaQuantity: number | null;
  mvaQuantityRaw: string;
  workedHours: number | null;
  workedHoursRaw: string;
  manualRate: number | null;
  manualRateRaw: string;
  measurementKind: MeasurementKind;
  measurementKindRaw: string;
  noProductionReasonId: string | null;
  noProductionReasonName: string;
  noProductionReasonRaw: string;
};

type MassImportErrorReportData = {
  fileName: string;
  content: string;
  errorRows: number;
  totalIssues: number;
};

type MassImportResultSummary = {
  status: "success" | "partial" | "error";
  message: string;
  successCount: number;
  errorRows: number;
  alreadyRegisteredRows: number;
};

type MassImportBatchResultItem = {
  rowIndex: number | null;
  rowNumbers: number[];
  success: boolean;
  alreadyRegistered: boolean;
  reason: string | null;
  message: string;
  measurementOrderId: string | null;
};

type MassImportBatchResponse = {
  success?: boolean;
  status?: number;
  message?: string;
  savedCount?: number;
  errorCount?: number;
  alreadyRegisteredCount?: number;
  alreadyRegisteredRows?: number;
  results?: MassImportBatchResultItem[];
};

type StatusAction = "FECHAR" | "CANCELAR" | "ABRIR";

const PAGE_SIZE = 20;
const EXPORT_PAGE_SIZE = 200;
const HISTORY_PAGE_SIZE = 5;
const HISTORY_FIELD_LABELS: Record<string, string> = {
  projectId: "Projeto",
  teamId: "Equipe",
  executionDate: "Data execucao",
  manualRate: "Taxa manual",
  measurementKind: "Tipo da medicao",
  noProductionReason: "Motivo sem producao",
  itemCount: "Quantidade de itens",
  status: "Status",
};

type Filters = {
  startDate: string;
  endDate: string;
  projectId: string;
  teamId: string;
  status: "TODOS" | MeasurementStatus;
  measurementKind: "TODOS" | MeasurementKind;
  noProductionReasonId: string;
  programmingMatch: "TODOS" | ProgrammingMatchStatus;
  workCompletionStatus: "TODOS" | "NAO_INFORMADO" | string;
  completionAlert: "TODOS" | "SIM" | "NAO";
};

type FormState = {
  id: string | null;
  expectedUpdatedAt: string | null;
  orderNumber: string;
  status: MeasurementStatus;
  originalTeamId: string;
  originalExecutionDate: string;
  teamNameSnapshot: string;
  foremanNameSnapshot: string;
  programmingId: string;
  projectId: string;
  teamId: string;
  executionDate: string;
  measurementDate: string;
  manualRate: string;
  measurementKind: MeasurementKind;
  noProductionReasonId: string;
  notes: string;
  activitySearch: string;
  activityQuantity: string;
  activityMvaQuantity: string;
  activityWorkedHours: string;
  items: MeasurementRow[];
};

function buildOrdersQuery(filters: Filters, page: number, pageSize = PAGE_SIZE) {
  const params = new URLSearchParams();
  params.set("startDate", filters.startDate);
  params.set("endDate", filters.endDate);
  params.set("status", filters.status);
  params.set("measurementKind", filters.measurementKind);
  params.set("programmingMatch", filters.programmingMatch);
  params.set("workCompletionStatus", filters.workCompletionStatus);
  params.set("completionAlert", filters.completionAlert);
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  if (filters.projectId) params.set("projectId", filters.projectId);
  if (filters.teamId) params.set("teamId", filters.teamId);
  if (filters.noProductionReasonId) params.set("noProductionReasonId", filters.noProductionReasonId);
  return params.toString();
}

function toIsoDate(value: Date) {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function yearRange(today: string) {
  const year = today.slice(0, 4);
  return { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
}

function scrollDashboardContentToTop() {
  if (typeof window === "undefined") return;
  const content = document.querySelector<HTMLElement>('[data-main-content-scroll="true"]');
  if (content) {
    content.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function createRowId() {
  return `med-row-${Math.random().toString(36).slice(2, 10)}`;
}

function createForm(today: string): FormState {
  return {
    id: null,
    expectedUpdatedAt: null,
    orderNumber: "",
    status: "ABERTA",
    originalTeamId: "",
    originalExecutionDate: "",
    teamNameSnapshot: "",
    foremanNameSnapshot: "",
    programmingId: "",
    projectId: "",
    teamId: "",
    executionDate: today,
    measurementDate: today,
    manualRate: "1",
    measurementKind: "COM_PRODUCAO",
    noProductionReasonId: "",
    notes: "",
    activitySearch: "",
    activityQuantity: "1",
    activityMvaQuantity: "",
    activityWorkedHours: "",
    items: [],
  };
}

function parsePositiveNumber(value: string | number) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Number(parsed.toFixed(6));
}

function parseNonNegativeNumber(value: string | number) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Number(parsed.toFixed(6));
}

function formatDate(value: string) {
  if (!value) return "-";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("pt-BR");
}

function formatDateTime(value: string) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("pt-BR");
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function measurementKindLabel(value: MeasurementKind) {
  return value === "SEM_PRODUCAO" ? "Sem producao" : "Com producao";
}

function rateSuggestionSourceLabel(source: RateSuggestionSource) {
  if (source === "ELECTRICAL_FIELD") return "Taxa vinculada ao ponto eletrico desta programacao.";
  if (source === "PREVIOUS_MEASUREMENT") return "Taxa sugerida com base na ultima medicao deste projeto.";
  return "Taxa em preenchimento manual.";
}

function isMvaHourUnit(value: string) {
  const normalized = normalizeSearchText(value).replace(/\s+/g, "");
  return (
    normalized.includes("mva*hora")
    || normalized.includes("mva/hora")
    || normalized.includes("mvahora")
    || normalized.includes("mva*h")
  );
}

function programmingMatchLabel(status: ProgrammingMatchStatus) {
  return status === "PROGRAMADA" ? "Programada" : "Nao programada";
}

function normalizeWorkCompletionCodeToken(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
}

function resolveEconomicWorkCompletionStatus(value: unknown): EconomicWorkCompletionStatus | null {
  const token = normalizeWorkCompletionCodeToken(value);
  if (
    token === "CONCLUIDO"
    || token === "COMPLETO"
    || token.startsWith("CONCLUIDO")
  ) {
    return "CONCLUIDO";
  }

  if (token === "PARCIAL" || token.startsWith("PARCIAL")) {
    return "PARCIAL";
  }

  return null;
}

function workCompletionStatusLabel(status: WorkCompletionStatus, labelMap: Map<string, string>) {
  if (!status) return "-";

  const economicStatus = resolveEconomicWorkCompletionStatus(status);
  if (economicStatus) {
    return labelMap.get(economicStatus) ?? economicStatus;
  }

  const normalized = String(status).trim().toUpperCase();
  return labelMap.get(normalized) ?? normalized;
}

function formatHistoryActionLabel(action: string) {
  const normalized = String(action ?? "").toUpperCase();
  if (normalized === "CREATE") return "Cadastro";
  if (normalized === "UPDATE") return "Edicao";
  if (normalized === "CLOSE") return "Fechamento";
  if (normalized === "CANCEL") return "Cancelamento";
  return normalized || "Atualizacao";
}

function formatHistoryValue(value: unknown) {
  if (value === null || value === undefined) return "-";
  const normalized = String(value).trim();
  return normalized || "-";
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeCodeToken(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

function normalizeCodeTokenLoose(value: string) {
  return normalizeCodeToken(value).replace(/o/g, "0");
}

function normalizeMeasurementKindInput(value: string): MeasurementKind {
  const normalized = normalizeSearchText(value)
    .replace(/[^a-z0-9]/g, "");
  return normalized.includes("semproducao") ? "SEM_PRODUCAO" : "COM_PRODUCAO";
}

function buildActivityLookupQueries(rawValue: string) {
  const input = String(rawValue ?? "").trim();
  if (!input) return [] as string[];

  const candidates = new Set<string>();
  candidates.add(input);

  const byPipe = input.split("|")[0]?.trim();
  if (byPipe) candidates.add(byPipe);

  const byDash = input.split("-")[0]?.trim();
  if (byDash) candidates.add(byDash);

  const codePart = input.split(/[|\-]/)[0]?.trim() ?? "";
  if (codePart) {
    const zeroToO = codePart.replace(/0/g, "O");
    const oToZero = codePart.replace(/[oO]/g, "0");
    if (zeroToO && zeroToO !== codePart) candidates.add(zeroToO);
    if (oToZero && oToZero !== codePart) candidates.add(oToZero);
  }

  const normalized = normalizeSearchText(input);
  if (normalized.includes(" - ")) {
    const codePart = normalized.split(" - ")[0]?.trim();
    if (codePart) candidates.add(codePart);
  }

  return Array.from(candidates).filter((item) => item.length >= 2);
}

function activityOptionLabel(item: ActivityCatalogItem) {
  return `${item.code} - ${item.description}`;
}

function buildImportCodeCandidates(rawValue: string) {
  const input = String(rawValue ?? "").trim();
  if (!input) return [] as string[];

  const candidates = new Set<string>();
  candidates.add(input);

  const byPipe = input.split("|")[0]?.trim();
  if (byPipe) candidates.add(byPipe);

  const byLabel = input.split(" - ")[0]?.trim();
  if (byLabel) candidates.add(byLabel);

  const bySpace = input.split(/\s+/)[0]?.trim();
  if (bySpace) candidates.add(bySpace);

  const byUnderscore = input.split("_")[0]?.trim();
  if (byUnderscore) candidates.add(byUnderscore);

  return Array.from(candidates)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function findActivityOptionByImportCode(value: string, options: ActivityCatalogItem[]) {
  const candidates = buildImportCodeCandidates(value);
  if (!candidates.length) return null;

  const normalizedCandidates = new Set(candidates.map((item) => normalizeSearchText(item)).filter(Boolean));
  const tokenCandidates = new Set(candidates.map((item) => normalizeCodeToken(item)).filter(Boolean));
  const looseTokenCandidates = new Set(candidates.map((item) => normalizeCodeTokenLoose(item)).filter(Boolean));

  const exactCodeMatches = options.filter((item) => normalizedCandidates.has(normalizeSearchText(item.code)));
  if (exactCodeMatches.length === 1) return exactCodeMatches[0];
  if (exactCodeMatches.length > 1) return null;

  const exactLabelMatches = options.filter((item) => normalizedCandidates.has(normalizeSearchText(activityOptionLabel(item))));
  if (exactLabelMatches.length === 1) return exactLabelMatches[0];
  if (exactLabelMatches.length > 1) return null;

  const exactTokenMatches = options.filter((item) => tokenCandidates.has(normalizeCodeToken(item.code)));
  if (exactTokenMatches.length === 1) return exactTokenMatches[0];
  if (exactTokenMatches.length > 1) return null;

  const exactLooseTokenMatches = options.filter((item) => looseTokenCandidates.has(normalizeCodeTokenLoose(item.code)));
  if (exactLooseTokenMatches.length === 1) return exactLooseTokenMatches[0];
  if (exactLooseTokenMatches.length > 1) return null;

  return null;
}

function findActivityOption(value: string, options: ActivityCatalogItem[]) {
  const normalized = normalizeSearchText(value);
  if (!normalized) return null;
  const codeCandidate = normalized.split("-")[0]?.trim();
  const codeCandidateToken = normalizeCodeToken(codeCandidate);
  const codeCandidateTokenLoose = normalizeCodeTokenLoose(codeCandidate);
  const exact = options.find((item) => {
    const codeToken = normalizeCodeToken(item.code);
    const codeTokenLoose = normalizeCodeTokenLoose(item.code);
    return (
      (codeCandidateToken && codeToken === codeCandidateToken)
      || (codeCandidateTokenLoose && codeTokenLoose === codeCandidateTokenLoose)
      || normalizeSearchText(item.code) === normalized
      || normalizeSearchText(activityOptionLabel(item)) === normalized
    );
  });

  if (exact) return exact;

  return options.find((item) => {
    const code = normalizeSearchText(item.code);
    const label = normalizeSearchText(activityOptionLabel(item));
    const codeToken = normalizeCodeToken(item.code);
    const codeTokenLoose = normalizeCodeTokenLoose(item.code);
    return (
      code === normalized
      || label === normalized
      || code === codeCandidate
      || normalized.startsWith(`${code} -`)
      || normalized.startsWith(`${code}|`)
      || (codeCandidateToken && (codeToken === codeCandidateToken || codeToken.startsWith(codeCandidateToken)))
      || (codeCandidateTokenLoose && (codeTokenLoose === codeCandidateTokenLoose || codeTokenLoose.startsWith(codeCandidateTokenLoose)))
      || label.includes(normalized)
    );
  }) ?? null;
}

function findActivitySelectionOption(value: string, options: ActivityCatalogItem[]) {
  return findActivityOption(value, options) ?? findActivityOptionByImportCode(value, options);
}

function findProjectOption(value: string, options: ProjectItem[]) {
  const normalized = normalizeSearchText(value);
  if (!normalized) return null;

  return options.find((item) => normalizeSearchText(item.code) === normalized) ?? null;
}

function findTeamOption(value: string, options: TeamItem[]) {
  const normalized = normalizeSearchText(value);
  const token = normalizeCodeToken(value);
  if (!normalized && !token) return null;

  const exactByName = options.find((item) => normalizeSearchText(item.name) === normalized);
  if (exactByName) return exactByName;
  if (token) {
    const exactByToken = options.find((item) => normalizeCodeToken(item.name) === token);
    if (exactByToken) return exactByToken;
  }
  return options.find((item) => item.id === value) ?? null;
}

function normalizeHeader(value: string) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}

function parseCsvLine(line: string, delimiter: "," | ";") {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"") {
      if (inQuotes && line[index + 1] === "\"") {
        current += "\"";
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (char === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseCsv(content: string) {
  const lines = content
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return { headers: [] as string[], rows: [] as string[][] };

  const delimiter: "," | ";" = lines[0].includes(";") ? ";" : ",";
  const headers = parseCsvLine(lines[0], delimiter);
  const rows = lines.slice(1).map((line) => parseCsvLine(line, delimiter));
  return { headers, rows };
}

function csvEscape(value: string) {
  const normalized = String(value ?? "");
  if (normalized.includes(";") || normalized.includes("\"") || normalized.includes("\n")) {
    return `"${normalized.replace(/"/g, "\"\"")}"`;
  }
  return normalized;
}

function createMassImportErrorReport(issues: MassImportIssue[]): MassImportErrorReportData | null {
  if (!issues.length) return null;
  const sorted = [...issues].sort((left, right) => {
    if (left.rowNumber !== right.rowNumber) return left.rowNumber - right.rowNumber;
    return left.column.localeCompare(right.column);
  });
  const errorRows = new Set(sorted.map((item) => item.rowNumber)).size;
  const lines = [
    "linha;coluna;valor;erro",
    ...sorted.map((issue) => [
      csvEscape(String(issue.rowNumber)),
      csvEscape(issue.column),
      csvEscape(issue.value),
      csvEscape(issue.error),
    ].join(";")),
  ];
  return {
    fileName: `medicao_import_erros_${toIsoDate(new Date())}.csv`,
    content: `\uFEFF${lines.join("\n")}\n`,
    errorRows,
    totalIssues: sorted.length,
  };
}

function downloadMassImportErrorReport(report: MassImportErrorReportData | null) {
  if (!report) return;
  const content = report.content;
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = report.fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

function parseImportDate(value: string) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
    const [day, month, year] = trimmed.split("/");
    return `${year}-${month}-${day}`;
  }
  return null;
}

function scheduleImportPriority(status: ProgrammingStatus) {
  if (status === "PROGRAMADA") return 0;
  if (status === "REPROGRAMADA") return 1;
  if (status === "ADIADA") return 2;
  return 3;
}

function resolveImportScheduleCandidate(candidates: ScheduleItem[]) {
  const byTeam = new Map<string, ScheduleItem[]>();
  for (const schedule of candidates) {
    const current = byTeam.get(schedule.teamId) ?? [];
    current.push(schedule);
    byTeam.set(schedule.teamId, current);
  }

  if (byTeam.size !== 1) {
    return { schedule: null as ScheduleItem | null, reason: "MULTIPLE_TEAMS" as const };
  }

  const teamCandidates = Array.from(byTeam.values())[0];
  teamCandidates.sort((left, right) => {
    const statusDiff = scheduleImportPriority(left.status) - scheduleImportPriority(right.status);
    if (statusDiff !== 0) return statusDiff;
    return left.id.localeCompare(right.id);
  });

  return { schedule: teamCandidates[0] ?? null, reason: null as null };
}

function findNoProductionReasonOption(value: string, options: NoProductionReasonItem[]) {
  const normalized = normalizeSearchText(value);
  if (!normalized) return null;

  return options.find((item) =>
    normalizeSearchText(item.name) === normalized
    || normalizeSearchText(item.code) === normalized
    || normalizeSearchText(`${item.code} - ${item.name}`) === normalized,
  ) ?? null;
}

function findDuplicateFormActivityId(items: Array<{ activityId: string }>) {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.activityId)) {
      return item.activityId;
    }
    seen.add(item.activityId);
  }
  return null;
}

export function MeasurementPageView() {
  const { session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const today = useMemo(() => toIsoDate(new Date()), []);
  const initialFilters = useMemo(
    () => ({
      ...yearRange(today),
      projectId: "",
      teamId: "",
      status: "TODOS" as const,
      measurementKind: "TODOS" as const,
      noProductionReasonId: "",
      programmingMatch: "TODOS" as const,
      workCompletionStatus: "TODOS" as const,
      completionAlert: "TODOS" as const,
    }),
    [today],
  );

  const [form, setForm] = useState<FormState>(() => createForm(today));
  const [formProjectSearch, setFormProjectSearch] = useState("");
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [teams, setTeams] = useState<TeamItem[]>([]);
  const [, setSchedules] = useState<ScheduleItem[]>([]);
  const [activityOptions, setActivityOptions] = useState<ActivityCatalogItem[]>([]);
  const [noProductionReasons, setNoProductionReasons] = useState<NoProductionReasonItem[]>([]);
  const [workCompletionCatalog, setWorkCompletionCatalog] = useState<WorkCompletionCatalogItem[]>([]);
  const [filterDraft, setFilterDraft] = useState<Filters>(initialFilters);
  const [filterProjectSearch, setFilterProjectSearch] = useState("");
  const [activeFilters, setActiveFilters] = useState<Filters>(initialFilters);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [filteredOrdersTotalAmount, setFilteredOrdersTotalAmount] = useState(0);
  const [detailOrder, setDetailOrder] = useState<OrderDetail | null>(null);
  const [historyOrder, setHistoryOrder] = useState<{ id: string; orderNumber: string } | null>(null);
  const [historyEntries, setHistoryEntries] = useState<OrderHistoryEntry[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [statusOrder, setStatusOrder] = useState<OrderItem | null>(null);
  const [statusAction, setStatusAction] = useState<StatusAction>("CANCELAR");
  const [statusReason, setStatusReason] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const [isLoadingSources, setIsLoadingSources] = useState(false);
  const [isLoadingMeta, setIsLoadingMeta] = useState(false);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [isLoadingFilteredTotal, setIsLoadingFilteredTotal] = useState(false);
  const [isRefreshingList, setIsRefreshingList] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isChangingStatus, setIsChangingStatus] = useState(false);
  const [isImportingMass, setIsImportingMass] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingDetails, setIsExportingDetails] = useState(false);
  const [isMassImportModalOpen, setIsMassImportModalOpen] = useState(false);
  const [massImportFile, setMassImportFile] = useState<File | null>(null);
  const [massImportErrorReport, setMassImportErrorReport] = useState<MassImportErrorReportData | null>(null);
  const [massImportResult, setMassImportResult] = useState<MassImportResultSummary | null>(null);
  const [isLoadingRateSuggestion, setIsLoadingRateSuggestion] = useState(false);
  const [rateSuggestionSource, setRateSuggestionSource] = useState<RateSuggestionSource | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const hasManualRateUserOverrideRef = useRef(false);
  const refreshRequestedRef = useRef(false);
  const refreshHadErrorRef = useRef(false);
  const deferredActivitySearch = useDeferredValue(form.activitySearch);

  const projectMap = useMemo(() => new Map(projects.map((item) => [item.id, item])), [projects]);
  const teamMap = useMemo(() => new Map(teams.map((item) => [item.id, item])), [teams]);
  const workCompletionFilterOptions = useMemo(() => {
    const map = new Map<string, { code: string; label: string }>();

    for (const item of workCompletionCatalog) {
      const code = normalizeWorkCompletionCodeToken(item.code);
      if (!code || map.has(code)) {
        continue;
      }

      map.set(code, {
        code,
        label: String(item.label ?? "").trim() || code,
      });
    }

    return Array.from(map.values());
  }, [workCompletionCatalog]);
  const workCompletionLabelMap = useMemo(() => {
    const map = new Map<string, string>();

    for (const item of workCompletionCatalog) {
      const rawCode = String(item.code ?? "").trim().toUpperCase();
      const normalizedCode = normalizeWorkCompletionCodeToken(item.code);
      const label = String(item.label ?? "").trim();
      if (rawCode) {
        map.set(rawCode, label || rawCode);
      }
      if (normalizedCode) {
        map.set(normalizedCode, label || normalizedCode);
      }

      const economicStatus = resolveEconomicWorkCompletionStatus(item.code);
      if (economicStatus) {
        map.set(economicStatus, label || economicStatus);
      }
    }

    if (!map.has("CONCLUIDO")) {
      map.set("CONCLUIDO", "Concluido");
    }

    if (!map.has("PARCIAL")) {
      map.set("PARCIAL", "Parcial");
    }

    return map;
  }, [workCompletionCatalog]);
  const resolvedActivityOptions = useMemo(() => {
    const byId = new Map<string, ActivityCatalogItem>();
    for (const item of activityOptions) {
      if (!byId.has(item.id)) {
        byId.set(item.id, item);
      }
    }
    return Array.from(byId.values());
  }, [activityOptions]);
  const selectedActivityOption = useMemo(
    () => findActivitySelectionOption(form.activitySearch, resolvedActivityOptions),
    [form.activitySearch, resolvedActivityOptions],
  );
  const selectedActivityIsMvaHour = Boolean(selectedActivityOption && isMvaHourUnit(selectedActivityOption.unit));

  useEffect(() => {
    if (form.measurementKind === "SEM_PRODUCAO") return;
    setForm((current) => {
      if (selectedActivityIsMvaHour) {
        if (current.activityQuantity === "") return current;
        return { ...current, activityQuantity: "" };
      }
      if (!selectedActivityIsMvaHour && !current.activityQuantity.trim()) {
        return { ...current, activityQuantity: "1" };
      }
      return current;
    });
  }, [selectedActivityIsMvaHour, form.measurementKind]);

  const totalAmount = useMemo(() => {
    if (form.measurementKind === "SEM_PRODUCAO") {
      return 0;
    }
    const manualRate = parsePositiveNumber(form.manualRate) ?? 1;
    return form.items.reduce((sum, item) => {
      const voicePoint = parsePositiveNumber(item.voicePoint) ?? 1;
      const quantity = parsePositiveNumber(item.quantity) ?? 0;
      const unitValue = parseNonNegativeNumber(item.unitValue) ?? 0;
      return sum + (voicePoint * quantity * manualRate * unitValue);
    }, 0);
  }, [form.items, form.manualRate, form.measurementKind]);
  const shouldShowRateSuggestionHint = !form.id && form.measurementKind === "COM_PRODUCAO" && Boolean(form.projectId);
  const rateSuggestionHint = shouldShowRateSuggestionHint
    ? (
      isLoadingRateSuggestion
        ? "Buscando taxa sugerida..."
        : (
          rateSuggestionSource === "MANUAL" && !hasManualRateUserOverrideRef.current && !form.manualRate.trim()
            ? "Nenhuma taxa anterior encontrada para este projeto. Preencha manualmente."
            : (rateSuggestionSource ? rateSuggestionSourceLabel(rateSuggestionSource) : "")
        )
    )
    : "";
  const canSubmitStatusReason = Boolean(statusOrder) && statusReason.trim().length >= 10 && !isChangingStatus;
  const isEditing = Boolean(form.id);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const historyTotalPages = Math.max(1, Math.ceil(historyEntries.length / HISTORY_PAGE_SIZE));
  const pagedHistoryEntries = useMemo(
    () => historyEntries.slice((historyPage - 1) * HISTORY_PAGE_SIZE, historyPage * HISTORY_PAGE_SIZE),
    [historyEntries, historyPage],
  );

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  useEffect(() => {
    if (historyPage > historyTotalPages) {
      setHistoryPage(historyTotalPages);
    }
  }, [historyPage, historyTotalPages]);

  const fetchOrdersPage = useCallback(
    async (targetPage: number, filters: Filters, pageSize = PAGE_SIZE) => {
      if (!accessToken) {
        return null;
      }

      const response = await fetch(`/api/medicao?${buildOrdersQuery(filters, targetPage, pageSize)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const data = (await response.json().catch(() => null)) as OrderListResponse | null;
      if (!response.ok) {
        throw new Error(data?.message ?? "Falha ao carregar ordens de medicao.");
      }

      return {
        orders: data?.orders ?? [],
        pagination: data?.pagination ?? { page: targetPage, pageSize, total: data?.orders?.length ?? 0 },
      };
    },
    [accessToken],
  );

  const loadAllOrdersForExport = useCallback(async () => {
    if (!accessToken) {
      return [] as OrderItem[];
    }

    const collected: OrderItem[] = [];
    let exportPage = 1;
    let exportTotalPages = 1;

    do {
      const result = await fetchOrdersPage(exportPage, activeFilters, EXPORT_PAGE_SIZE);
      if (!result) {
        return [] as OrderItem[];
      }

      collected.push(...result.orders);
      exportTotalPages = Math.max(1, Math.ceil((result.pagination.total ?? 0) / EXPORT_PAGE_SIZE));
      exportPage += 1;
    } while (exportPage <= exportTotalPages);

    return collected;
  }, [accessToken, activeFilters, fetchOrdersPage]);

  useEffect(() => {
    if (!accessToken) {
      setProjects([]);
      setTeams([]);
      setSchedules([]);
      setIsLoadingSources(false);
      return;
    }

    let ignore = false;
    async function loadSources() {
      setIsLoadingSources(true);
      try {
        const sourceStartDate = form.executionDate && form.executionDate < activeFilters.startDate ? form.executionDate : activeFilters.startDate;
        const sourceEndDate = form.executionDate && form.executionDate > activeFilters.endDate ? form.executionDate : activeFilters.endDate;
        const response = await fetch(`/api/programacao?startDate=${sourceStartDate}&endDate=${sourceEndDate}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
        const data = (await response.json().catch(() => null)) as ProgrammingResponse | null;
        if (!response.ok) throw new Error(data?.message ?? "Falha ao carregar Programacao para Medicao.");
        if (ignore) return;
        setProjects(data?.projects ?? []);
        setTeams(data?.teams ?? []);
        setSchedules(data?.schedules ?? []);
      } catch (error) {
        if (!ignore && refreshRequestedRef.current) {
          refreshHadErrorRef.current = true;
        }
        if (!ignore) {
          setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao carregar Programacao para Medicao." });
        }
      } finally {
        if (!ignore) setIsLoadingSources(false);
      }
    }

    void loadSources();
    return () => {
      ignore = true;
    };
  }, [accessToken, activeFilters.endDate, activeFilters.startDate, form.executionDate, refreshTick]);

  useEffect(() => {
    if (!accessToken) {
      setNoProductionReasons([]);
      setWorkCompletionCatalog([]);
      setIsLoadingMeta(false);
      return;
    }

    let ignore = false;
    async function loadMeasurementMeta() {
      setIsLoadingMeta(true);
      try {
        const response = await fetch("/api/medicao/meta", {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
        const data = (await response.json().catch(() => null)) as MeasurementMetaResponse | null;
        if (!response.ok) throw new Error(data?.message ?? "Falha ao carregar metadados da medicao.");
        if (ignore) return;
        setNoProductionReasons(data?.noProductionReasons ?? []);
        setWorkCompletionCatalog(data?.workCompletionCatalog ?? []);
      } catch (error) {
        if (!ignore && refreshRequestedRef.current) {
          refreshHadErrorRef.current = true;
        }
        if (!ignore) {
          setNoProductionReasons([]);
          setWorkCompletionCatalog([]);
          setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao carregar metadados da medicao." });
        }
      } finally {
        if (!ignore) {
          setIsLoadingMeta(false);
        }
      }
    }

    void loadMeasurementMeta();
    return () => {
      ignore = true;
    };
  }, [accessToken, refreshTick]);

  useEffect(() => {
    if (!accessToken) {
      setOrders([]);
      setTotal(0);
      setIsLoadingOrders(false);
      return;
    }

    let ignore = false;
    async function loadOrders() {
      setIsLoadingOrders(true);
      try {
        const result = await fetchOrdersPage(page, activeFilters);
        if (ignore) return;
        setOrders(result?.orders ?? []);
        setTotal(result?.pagination.total ?? 0);
        setPage(result?.pagination.page ?? page);
      } catch (error) {
        if (!ignore && refreshRequestedRef.current) {
          refreshHadErrorRef.current = true;
        }
        if (!ignore) {
          setOrders([]);
          setTotal(0);
          setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao carregar ordens de medicao." });
        }
      } finally {
        if (!ignore) setIsLoadingOrders(false);
      }
    }

    void loadOrders();
    return () => {
      ignore = true;
    };
  }, [accessToken, activeFilters, fetchOrdersPage, page, refreshTick]);

  useEffect(() => {
    if (!accessToken) {
      setFilteredOrdersTotalAmount(0);
      setIsLoadingFilteredTotal(false);
      return;
    }

    let ignore = false;
    async function loadFilteredOrdersTotalAmount() {
      setIsLoadingFilteredTotal(true);
      try {
        const exportOrders = await loadAllOrdersForExport();
        if (ignore) return;
        const sum = exportOrders.reduce(
          (accumulator, order) => accumulator + (Number.isFinite(order.totalAmount) ? order.totalAmount : 0),
          0,
        );
        setFilteredOrdersTotalAmount(sum);
      } catch {
        if (!ignore && refreshRequestedRef.current) {
          refreshHadErrorRef.current = true;
        }
        if (!ignore) {
          setFilteredOrdersTotalAmount(0);
        }
      } finally {
        if (!ignore) {
          setIsLoadingFilteredTotal(false);
        }
      }
    }

    void loadFilteredOrdersTotalAmount();
    return () => {
      ignore = true;
    };
  }, [accessToken, loadAllOrdersForExport, refreshTick]);

  useEffect(() => {
    if (!isRefreshingList) {
      return;
    }

    if (isLoadingSources || isLoadingMeta || isLoadingOrders || isLoadingFilteredTotal) {
      return;
    }

    setIsRefreshingList(false);
    if (refreshRequestedRef.current && !refreshHadErrorRef.current) {
      setFeedback({ type: "success", message: "Lista atualizada com os dados mais recentes." });
    }
    refreshRequestedRef.current = false;
    refreshHadErrorRef.current = false;
  }, [isLoadingFilteredTotal, isLoadingMeta, isLoadingOrders, isLoadingSources, isRefreshingList]);

  useEffect(() => {
    if (!accessToken || deferredActivitySearch.trim().length < 2) {
      setActivityOptions([]);
      return;
    }

    let ignore = false;
    async function loadActivityCatalog() {
      const response = await fetch(`/api/medicao/activities/catalog?q=${encodeURIComponent(deferredActivitySearch)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const data = (await response.json().catch(() => null)) as ActivityCatalogResponse | null;
      if (!ignore) setActivityOptions(data?.items ?? []);
    }

    void loadActivityCatalog();
    return () => {
      ignore = true;
    };
  }, [accessToken, deferredActivitySearch]);

  useEffect(() => {
    if (!form.projectId) return;
    const projectCode = projectMap.get(form.projectId)?.code ?? "";
    if (projectCode && projectCode !== formProjectSearch) {
      setFormProjectSearch(projectCode);
    }
  }, [form.projectId, formProjectSearch, projectMap]);

  useEffect(() => {
    if (!accessToken || form.id || form.measurementKind === "SEM_PRODUCAO" || !form.projectId) {
      setIsLoadingRateSuggestion(false);
      setRateSuggestionSource(null);
      return;
    }

    let ignore = false;
    async function loadRateSuggestion() {
      setIsLoadingRateSuggestion(true);
      try {
        const response = await fetch(`/api/medicao/rate-suggestion?projectId=${form.projectId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
        const data = (await response.json().catch(() => null)) as RateSuggestionResponse | null;
        if (!response.ok) {
          throw new Error(data?.message ?? "Falha ao buscar taxa sugerida.");
        }
        if (ignore) return;

        const source = data?.source ?? "MANUAL";
        const suggestedRate = parsePositiveNumber(data?.rate ?? "");
        setRateSuggestionSource(source);

        if (hasManualRateUserOverrideRef.current) return;
        setForm((current) => {
          if (current.id || current.projectId !== form.projectId || current.measurementKind === "SEM_PRODUCAO") {
            return current;
          }

          const nextManualRate = suggestedRate !== null ? String(suggestedRate) : "";
          if (current.manualRate === nextManualRate) {
            return current;
          }

          return { ...current, manualRate: nextManualRate };
        });
      } catch (error) {
        if (!ignore) {
          setRateSuggestionSource(null);
          setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao buscar taxa sugerida." });
        }
      } finally {
        if (!ignore) {
          setIsLoadingRateSuggestion(false);
        }
      }
    }

    void loadRateSuggestion();
    return () => {
      ignore = true;
    };
  }, [accessToken, form.id, form.measurementKind, form.projectId]);

  useEffect(() => {
    if (!filterDraft.projectId) return;
    const projectCode = projectMap.get(filterDraft.projectId)?.code ?? "";
    if (projectCode && projectCode !== filterProjectSearch) {
      setFilterProjectSearch(projectCode);
    }
  }, [filterDraft.projectId, filterProjectSearch, projectMap]);

  function resetForm() {
    hasManualRateUserOverrideRef.current = false;
    setRateSuggestionSource(null);
    setForm(createForm(today));
    setFormProjectSearch("");
  }

  function handleMeasurementKindChange(nextKind: MeasurementKind) {
    setForm((current) => ({
      ...current,
      measurementKind: nextKind,
      noProductionReasonId: nextKind === "COM_PRODUCAO" ? "" : current.noProductionReasonId,
      manualRate: nextKind === "SEM_PRODUCAO" ? "1" : current.manualRate,
      activitySearch: "",
      activityQuantity: "1",
      activityMvaQuantity: "",
      activityWorkedHours: "",
      items: nextKind === "SEM_PRODUCAO" ? [] : current.items,
    }));
  }

  function recalculateItemsWithMeasurementRate() {
    if (form.measurementKind === "SEM_PRODUCAO" || !form.items.length) {
      return;
    }

    setForm((current) => ({
      ...current,
      items: current.items.map((item) => ({ ...item })),
    }));
    setFeedback({ type: "success", message: "Totais recalculados com a taxa unica da medicao." });
  }

  function updateRow(rowId: string, field: "quantity" | "mvaQuantity" | "workedHours" | "observation", value: string) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item) => {
        if (item.rowId !== rowId) return item;
        const next = { ...item, [field]: value };
        if (isMvaHourUnit(next.unit) || next.mvaQuantity || next.workedHours) {
          const mvaQuantity = parsePositiveNumber(next.mvaQuantity);
          const workedHours = parsePositiveNumber(next.workedHours);
          if (mvaQuantity && workedHours) {
            next.quantity = String(Number((mvaQuantity * workedHours).toFixed(6)));
          } else if (field === "mvaQuantity" || field === "workedHours") {
            next.quantity = "";
          }
        }
        return next;
      }),
    }));
  }

  function removeRow(rowId: string) {
    setForm((current) => ({ ...current, items: current.items.filter((item) => item.rowId !== rowId) }));
  }

  async function addActivity() {
    if (form.measurementKind === "SEM_PRODUCAO") {
      setFeedback({ type: "error", message: "Ordem sem producao nao permite adicionar atividades." });
      return;
    }

    let option = findActivityOption(form.activitySearch, resolvedActivityOptions);
    if (!option && accessToken && form.activitySearch.trim().length >= 2) {
      try {
        const lookupQueries = buildActivityLookupQueries(form.activitySearch);
        const responses = await Promise.all(
          lookupQueries.map(async (query) => {
            const response = await fetch(`/api/medicao/activities/catalog?q=${encodeURIComponent(query)}`, {
              headers: { Authorization: `Bearer ${accessToken}` },
              cache: "no-store",
            });
            const data = (await response.json().catch(() => null)) as ActivityCatalogResponse | null;
            return response.ok ? (data?.items ?? []) : [];
          }),
        );

        const byId = new Map<string, ActivityCatalogItem>();
        for (const item of responses.flat()) {
          if (!byId.has(item.id)) {
            byId.set(item.id, item);
          }
        }

        const fetchedItems = Array.from(byId.values());
        option = findActivityOption(form.activitySearch, [...resolvedActivityOptions, ...fetchedItems]);
      } catch {
        // Mantem fluxo local sem interromper o usuario quando a consulta de fallback falha.
      }
    }

    if (!option) {
      setFeedback({ type: "error", message: "Atividade nao encontrada. Selecione uma opcao da lista." });
      return;
    }

    if (accessToken) {
      const refreshed = await resolveActivityByCode(option.code);
      if (refreshed) {
        option = refreshed;
      }
    }

    if (form.items.some((item) => item.activityId === option.id)) {
      setFeedback({ type: "error", message: "Atividade ja adicionada na ordem." });
      return;
    }

    const isCompositeActivity = isMvaHourUnit(option.unit);
    const mvaQuantity = parsePositiveNumber(form.activityMvaQuantity);
    const workedHours = parsePositiveNumber(form.activityWorkedHours);
    const quantity = isCompositeActivity
      ? ((mvaQuantity && workedHours) ? Number((mvaQuantity * workedHours).toFixed(6)) : null)
      : parsePositiveNumber(form.activityQuantity);
    if (!quantity) {
      setFeedback({
        type: "error",
        message: isCompositeActivity
          ? "Para unidade MVA*hora informe Potencia (MVA) e Horas validas."
          : "Informe quantidade valida para incluir a atividade.",
      });
      return;
    }

    setForm((current) => ({
      ...current,
      activitySearch: "",
      activityQuantity: "1",
      activityMvaQuantity: "",
      activityWorkedHours: "",
      items: [
        ...current.items,
        {
          rowId: createRowId(),
          activityId: option.id,
          programmingActivityId: null,
          projectActivityForecastId: null,
          code: option.code,
          description: option.description,
          unit: option.unit,
          quantity: String(quantity),
          mvaQuantity: isCompositeActivity ? String(mvaQuantity) : "",
          workedHours: isCompositeActivity ? String(workedHours) : "",
          voicePoint: String(option.voicePoint ?? 1),
          unitValue: String(option.unitValue ?? 0),
          observation: "",
        },
      ],
    }));
    setFeedback(null);
  }

  function downloadMassTemplate() {
    const model = "\uFEFFprojeto;data;equipe;tipo_medicao;motivo_sem_producao;voz;quantidade;mva;horas;taxa\nA0123456789;2026-03-25;MK-01;COM_PRODUCAO;;TH0108;1;;;1,00\nA0123456789;2026-03-25;MK-01;COM_PRODUCAO;;COD_MVAH;;15;2;1,00\nA0123456790;2026-03-25;MK-02;SEM_PRODUCAO;Apoio;;;;;\n";
    const blob = new Blob([model], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "modelo_medicao_cadastro_em_massa.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }

  async function resolveActivityByCode(codeValue: string) {
    if (!accessToken) {
      return findActivityOptionByImportCode(codeValue, resolvedActivityOptions);
    }

    const lookupQueries = buildActivityLookupQueries(codeValue);
    const responses = await Promise.all(
      lookupQueries.map(async (query) => {
        const response = await fetch(`/api/medicao/activities/catalog?q=${encodeURIComponent(query)}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
        const data = (await response.json().catch(() => null)) as ActivityCatalogResponse | null;
        return response.ok ? (data?.items ?? []) : [];
      }),
    );

    const unique = new Map<string, ActivityCatalogItem>();
    for (const item of responses.flat()) {
      if (!unique.has(item.id)) {
        unique.set(item.id, item);
      }
    }

    const remote = findActivityOptionByImportCode(codeValue, Array.from(unique.values()));
    if (remote) return remote;
    return findActivityOptionByImportCode(codeValue, resolvedActivityOptions);
  }

  async function handleMassImportFile(file: File) {
    if (!accessToken) return;

    setIsImportingMass(true);
    setMassImportErrorReport(null);
    setMassImportResult(null);
    try {
      const importIssues: MassImportIssue[] = [];
      const content = await file.text();
      const { headers, rows } = parseCsv(content);
      if (!headers.length || !rows.length) {
        importIssues.push({
          rowNumber: 1,
          column: "arquivo",
          value: file.name,
          error: "Arquivo CSV vazio ou invalido.",
        });
        const report = createMassImportErrorReport(importIssues);
        setMassImportErrorReport(report);
        setMassImportResult({
          status: "error",
          message: "Arquivo CSV vazio ou invalido para cadastro em massa.",
          successCount: 0,
          errorRows: report?.errorRows ?? 0,
          alreadyRegisteredRows: 0,
        });
        setFeedback({ type: "error", message: "Arquivo CSV vazio ou invalido para cadastro em massa." });
        return;
      }

      const headerMap = new Map(headers.map((header, index) => [normalizeHeader(header), index]));
      const projectIndex = headerMap.get("projeto") ?? headerMap.get("project") ?? headerMap.get("sob");
      const dateIndex = headerMap.get("data") ?? headerMap.get("date");
      const teamIndex = headerMap.get("equipe") ?? headerMap.get("team");
      const measurementKindIndex = headerMap.get("tipo_medicao") ?? headerMap.get("tipomedicao") ?? headerMap.get("tipo") ?? headerMap.get("measurementkind");
      const noProductionReasonIndex = headerMap.get("motivo_sem_producao") ?? headerMap.get("motivosemproducao") ?? headerMap.get("motivo") ?? headerMap.get("no_production_reason");
      const voiceIndex = headerMap.get("voz") ?? headerMap.get("voice") ?? headerMap.get("codigo") ?? headerMap.get("code");
      const quantityIndex = headerMap.get("quantidade") ?? headerMap.get("qtd") ?? headerMap.get("qty");
      const mvaQuantityIndex = headerMap.get("mva") ?? headerMap.get("potencia_mva") ?? headerMap.get("potencia");
      const workedHoursIndex = headerMap.get("horas") ?? headerMap.get("hora") ?? headerMap.get("worked_hours") ?? headerMap.get("hours");
      const manualRateIndex = headerMap.get("taxa") ?? headerMap.get("taxa manual") ?? headerMap.get("manual rate") ?? headerMap.get("manualrate") ?? headerMap.get("rate");

      const missingColumns: string[] = [];
      if (projectIndex === undefined) missingColumns.push("projeto");
      if (dateIndex === undefined) missingColumns.push("data");
      if (teamIndex === undefined) missingColumns.push("equipe");
      if (measurementKindIndex === undefined) missingColumns.push("tipo_medicao");
      if (noProductionReasonIndex === undefined) missingColumns.push("motivo_sem_producao");
      if (voiceIndex === undefined) missingColumns.push("voz");
      if (manualRateIndex === undefined) missingColumns.push("taxa");
      if (projectIndex === undefined || dateIndex === undefined || teamIndex === undefined || measurementKindIndex === undefined || noProductionReasonIndex === undefined || voiceIndex === undefined || manualRateIndex === undefined) {
        for (const column of missingColumns) {
          importIssues.push({
            rowNumber: 1,
            column,
            value: "",
            error: "Coluna obrigatoria ausente no arquivo.",
          });
        }
        const report = createMassImportErrorReport(importIssues);
        setMassImportErrorReport(report);
        setMassImportResult({
          status: "error",
          message: "Modelo invalido. Use colunas: projeto,data,equipe,tipo_medicao,motivo_sem_producao,voz,quantidade,mva,horas,taxa.",
          successCount: 0,
          errorRows: report?.errorRows ?? 0,
          alreadyRegisteredRows: 0,
        });
        setFeedback({ type: "error", message: "Modelo invalido. Use colunas: projeto,data,equipe,tipo_medicao,motivo_sem_producao,voz,quantidade,mva,horas,taxa." });
        return;
      }

      const parsedRows: ParsedMassImportRow[] = rows.map((row, rowIndex) => {
        const projectRaw = String(row[projectIndex] ?? "").trim();
        const dateRaw = String(row[dateIndex] ?? "").trim();
        const teamRaw = String(row[teamIndex] ?? "").trim();
        const measurementKindRaw = String(row[measurementKindIndex] ?? "").trim();
        const noProductionReasonRaw = String(row[noProductionReasonIndex] ?? "").trim();
        const voiceRaw = String(row[voiceIndex] ?? "").trim();
        const quantityRaw = quantityIndex === undefined ? "" : String(row[quantityIndex] ?? "").trim();
        const mvaQuantityRaw = mvaQuantityIndex === undefined ? "" : String(row[mvaQuantityIndex] ?? "").trim();
        const workedHoursRaw = workedHoursIndex === undefined ? "" : String(row[workedHoursIndex] ?? "").trim();
        const manualRateRaw = String(row[manualRateIndex] ?? "").trim();
        const executionDate = parseImportDate(dateRaw);
        const measurementKind = normalizeMeasurementKindInput(measurementKindRaw);
        const quantity = measurementKind === "SEM_PRODUCAO" ? null : parsePositiveNumber(quantityRaw);
        const mvaQuantity = measurementKind === "SEM_PRODUCAO" ? null : parsePositiveNumber(mvaQuantityRaw);
        const workedHours = measurementKind === "SEM_PRODUCAO" ? null : parsePositiveNumber(workedHoursRaw);
        const manualRate = measurementKind === "SEM_PRODUCAO" ? null : parsePositiveNumber(manualRateRaw);
        const matchedNoProductionReason = measurementKind === "SEM_PRODUCAO"
          ? findNoProductionReasonOption(noProductionReasonRaw, noProductionReasons)
          : null;
        return {
          rowNumber: rowIndex + 2,
          projectCode: projectRaw,
          projectRaw,
          teamName: teamRaw,
          teamRaw,
          executionDate,
          executionDateRaw: dateRaw,
          measurementKind,
          measurementKindRaw,
          noProductionReasonId: matchedNoProductionReason?.id ?? null,
          noProductionReasonName: matchedNoProductionReason?.name ?? "",
          noProductionReasonRaw,
          voiceCode: voiceRaw,
          voiceRaw,
          quantity,
          quantityRaw,
          mvaQuantity,
          mvaQuantityRaw,
          workedHours,
          workedHoursRaw,
          manualRate,
          manualRateRaw,
        };
      });

      const validRows: ParsedMassImportRow[] = [];
      for (const row of parsedRows) {
        let hasError = false;
        if (!row.projectCode) {
          importIssues.push({ rowNumber: row.rowNumber, column: "projeto", value: row.projectRaw, error: "Projeto obrigatorio." });
          hasError = true;
        }
        if (!row.executionDate) {
          importIssues.push({ rowNumber: row.rowNumber, column: "data", value: row.executionDateRaw, error: "Data invalida. Use YYYY-MM-DD ou DD/MM/YYYY." });
          hasError = true;
        }
        if (!row.teamName) {
          importIssues.push({ rowNumber: row.rowNumber, column: "equipe", value: row.teamRaw, error: "Equipe obrigatoria." });
          hasError = true;
        }
        if (!row.measurementKindRaw) {
          importIssues.push({ rowNumber: row.rowNumber, column: "tipo_medicao", value: row.measurementKindRaw, error: "Tipo da medicao obrigatorio." });
          hasError = true;
        }
        if (row.measurementKind === "SEM_PRODUCAO") {
          if (!row.noProductionReasonId) {
            importIssues.push({ rowNumber: row.rowNumber, column: "motivo_sem_producao", value: row.noProductionReasonRaw, error: "Motivo de sem producao invalido ou nao encontrado." });
            hasError = true;
          }
        } else {
          if (!row.voiceCode) {
            importIssues.push({ rowNumber: row.rowNumber, column: "voz", value: row.voiceRaw, error: "Codigo da atividade obrigatorio." });
            hasError = true;
          }
          if (!row.manualRate) {
            importIssues.push({ rowNumber: row.rowNumber, column: "taxa", value: row.manualRateRaw, error: "Taxa invalida. Informe numero maior que zero." });
            hasError = true;
          }
        }
        if (!hasError) {
          validRows.push(row);
        }
      }

      if (!validRows.length) {
        const report = createMassImportErrorReport(importIssues);
        setMassImportErrorReport(report);
        setMassImportResult({
          status: "error",
          message: "Nenhuma linha valida para importar.",
          successCount: 0,
          errorRows: report?.errorRows ?? 0,
          alreadyRegisteredRows: 0,
        });
        setFeedback({ type: "error", message: "Nenhuma linha valida para importar. Baixe o arquivo de erros para corrigir." });
        return;
      }

      const dates = validRows.map((row) => row.executionDate as string).sort();
      const startDate = dates[0];
      const endDate = dates[dates.length - 1];

      const scheduleResponse = await fetch(`/api/programacao?startDate=${startDate}&endDate=${endDate}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const scheduleData = (await scheduleResponse.json().catch(() => null)) as ProgrammingResponse | null;
      if (!scheduleResponse.ok) {
        throw new Error(scheduleData?.message ?? "Falha ao carregar programacoes para cadastro em massa.");
      }

      const importProjects = Array.from(new Map([...(projects ?? []), ...((scheduleData?.projects ?? []) as ProjectItem[])].map((item) => [item.id, item])).values());
      const importTeams = Array.from(new Map([...(teams ?? []), ...((scheduleData?.teams ?? []) as TeamItem[])].map((item) => [item.id, item])).values());
      const importSchedules = scheduleData?.schedules ?? [];
      const importProjectCodeById = new Map(importProjects.map((item) => [item.id, normalizeSearchText(item.code)]));
      const importProjectLabelById = new Map(importProjects.map((item) => [item.id, item.code]));
      const importProjectByCode = new Map(importProjects.map((item) => [normalizeSearchText(item.code), item]));

      const scheduleLookup = new Map<string, ScheduleItem[]>();
      for (const schedule of importSchedules) {
        const projectCode = importProjectCodeById.get(schedule.projectId) ?? "";
        if (!projectCode) continue;
        const key = `${projectCode}|${schedule.date}`;
        const current = scheduleLookup.get(key) ?? [];
        current.push(schedule);
        scheduleLookup.set(key, current);
      }

      const uniqueVoiceCodes = Array.from(new Set(validRows.map((row) => row.voiceCode)));
      const activityByCode = new Map<string, ActivityCatalogItem>();
      for (const codeKey of uniqueVoiceCodes) {
        const resolved = await resolveActivityByCode(codeKey);
        if (resolved) {
          activityByCode.set(normalizeSearchText(codeKey), resolved);
        }
      }

      const grouped = new Map<string, {
        context: {
          programmingId: string | null;
          projectId: string;
          teamId: string;
          executionDate: string;
          manualRate: number;
          measurementKind: MeasurementKind;
          noProductionReasonId: string | null;
        };
        items: Map<string, { activity: ActivityCatalogItem; quantity: number; mvaQuantity: number | null; workedHours: number | null }>;
        rowNumbers: Set<number>;
      }>();

      for (const row of validRows) {
        const projectKey = normalizeSearchText(row.projectCode);
        const matchedProject = importProjectByCode.get(projectKey) ?? null;
        if (!matchedProject) {
          importIssues.push({
            rowNumber: row.rowNumber,
            column: "projeto",
            value: row.projectCode,
            error: "Projeto nao encontrado.",
          });
          continue;
        }

        const matchedTeam = findTeamOption(row.teamName, importTeams);
        if (!matchedTeam) {
          importIssues.push({
            rowNumber: row.rowNumber,
            column: "equipe",
            value: row.teamName,
            error: "Equipe nao encontrada.",
          });
          continue;
        }

        const scheduleKey = `${projectKey}|${row.executionDate}`;
        const candidates = scheduleLookup.get(scheduleKey) ?? [];
        let selectedSchedule: ScheduleItem | null = null;
        if (candidates.length) {
          const filteredByRowTeam = candidates.filter((item) => item.teamId === matchedTeam.id);
          if (filteredByRowTeam.length) {
            const byTeam = resolveImportScheduleCandidate(filteredByRowTeam);
            selectedSchedule = byTeam.schedule;
          }
        }

        const activity = row.measurementKind === "COM_PRODUCAO"
          ? activityByCode.get(normalizeSearchText(row.voiceCode))
          : null;
        if (row.measurementKind === "COM_PRODUCAO" && !activity) {
          importIssues.push({
            rowNumber: row.rowNumber,
            column: "voz",
            value: row.voiceCode,
            error: "Atividade nao encontrada no catalogo da medicao.",
          });
          continue;
        }

        let resolvedQuantity = row.quantity;
        const resolvedMvaQuantity = row.mvaQuantity;
        const resolvedWorkedHours = row.workedHours;
        if (row.measurementKind === "COM_PRODUCAO" && activity) {
          const requiresMvaHour = isMvaHourUnit(activity.unit);
          const hasOnlyOneCompositeField = (row.mvaQuantity && !row.workedHours) || (!row.mvaQuantity && row.workedHours);
          if (hasOnlyOneCompositeField) {
            importIssues.push({
              rowNumber: row.rowNumber,
              column: row.mvaQuantity ? "horas" : "mva",
              value: row.mvaQuantity ? row.workedHoursRaw : row.mvaQuantityRaw,
              error: "Informe MVA e Horas juntos para atividade composta.",
            });
            continue;
          }

          if (row.mvaQuantity && row.workedHours) {
            resolvedQuantity = Number((row.mvaQuantity * row.workedHours).toFixed(6));
          } else if (requiresMvaHour) {
            importIssues.push({
              rowNumber: row.rowNumber,
              column: "mva/horas",
              value: `${row.mvaQuantityRaw} | ${row.workedHoursRaw}`,
              error: "Para unidade MVA*hora informe MVA e Horas. Quantidade nao e permitida.",
            });
            continue;
          } else if (!row.quantity) {
            importIssues.push({
              rowNumber: row.rowNumber,
              column: "quantidade",
              value: row.quantityRaw,
              error: "Quantidade invalida. Informe numero maior que zero.",
            });
            continue;
          }
        }

        const projectId = selectedSchedule?.projectId ?? matchedProject.id;
        const teamId = selectedSchedule?.teamId ?? matchedTeam.id;
        const executionDate = selectedSchedule?.date ?? (row.executionDate as string);
        const manualRate = row.measurementKind === "SEM_PRODUCAO" ? 1 : (row.manualRate as number);

        const groupingKey = `${projectId}|${teamId}|${executionDate}`;
        const group = grouped.get(groupingKey) ?? {
          context: {
            programmingId: selectedSchedule?.id ?? null,
            projectId,
            teamId,
            executionDate,
            manualRate,
            measurementKind: row.measurementKind,
            noProductionReasonId: row.noProductionReasonId,
          },
          items: new Map(),
          rowNumbers: new Set<number>(),
        };
        if (group.context.measurementKind !== row.measurementKind) {
          importIssues.push({
            rowNumber: row.rowNumber,
            column: "tipo_medicao",
            value: row.measurementKindRaw,
            error: "Tipo da medicao divergente para o mesmo Projeto + Equipe + Data.",
          });
          continue;
        }
        if ((group.context.noProductionReasonId ?? "") !== (row.noProductionReasonId ?? "")) {
          importIssues.push({
            rowNumber: row.rowNumber,
            column: "motivo_sem_producao",
            value: row.noProductionReasonRaw,
            error: "Motivo de sem producao divergente para o mesmo Projeto + Equipe + Data.",
          });
          continue;
        }
        if (Math.abs(group.context.manualRate - manualRate) > 0.000001) {
          importIssues.push({
            rowNumber: row.rowNumber,
            column: "taxa",
            value: row.manualRateRaw,
            error: "Taxa divergente para o mesmo Projeto + Equipe + Data. Use uma unica taxa por ordem.",
          });
          continue;
        }
        if (row.measurementKind === "COM_PRODUCAO" && activity) {
          const current = group.items.get(activity.id);
          const quantity = resolvedQuantity as number;
          if (current) {
            current.quantity = Number((current.quantity + quantity).toFixed(6));
            current.mvaQuantity = null;
            current.workedHours = null;
          } else {
            group.items.set(activity.id, {
              activity,
              quantity,
              mvaQuantity: resolvedMvaQuantity,
              workedHours: resolvedWorkedHours,
            });
          }
        }
        group.rowNumbers.add(row.rowNumber);
        grouped.set(groupingKey, group);
      }

      if (!grouped.size) {
        const report = createMassImportErrorReport(importIssues);
        const alreadyRegisteredRows = 0;
        setMassImportErrorReport(report);
        setMassImportResult({
          status: "error",
          message: `Nenhuma ordem valida foi montada para salvar.${alreadyRegisteredRows ? ` ${alreadyRegisteredRows} linhas ja cadastradas.` : ""}`,
          successCount: 0,
          errorRows: report?.errorRows ?? 0,
          alreadyRegisteredRows,
        });
        setFeedback({ type: "error", message: "Nenhuma ordem valida foi montada para salvar. Baixe o arquivo de erros para corrigir." });
        return;
      }

      const batchRows = Array.from(grouped.values()).map((group) => ({
        rowNumbers: Array.from(group.rowNumbers.values()).sort((a, b) => a - b),
        programmingId: group.context.programmingId ?? undefined,
        projectId: group.context.projectId,
        teamId: group.context.teamId,
        executionDate: group.context.executionDate,
        measurementDate: group.context.executionDate,
        measurementKind: group.context.measurementKind,
        noProductionReasonId: group.context.noProductionReasonId ?? undefined,
        voicePoint: 1,
        manualRate: group.context.manualRate,
        notes: "Cadastro em massa (CSV)",
        items: group.context.measurementKind === "SEM_PRODUCAO" ? [] : Array.from(group.items.values()).map((entry) => ({
          activityId: entry.activity.id,
          quantity: entry.quantity,
          mvaQuantity: entry.mvaQuantity,
          workedHours: entry.workedHours,
          voicePoint: entry.activity.voicePoint,
          unitValue: entry.activity.unitValue,
        })),
      }));

      const batchResponse = await fetch("/api/medicao", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          action: "BATCH_IMPORT_PARTIAL",
          rows: batchRows,
        }),
      });

      const batchData = (await batchResponse.json().catch(() => null)) as MassImportBatchResponse | null;
      if (!batchResponse.ok || batchData?.success !== true) {
        const responseMessage = batchData?.message ?? "Falha no cadastro em massa da medicao.";
        const alreadyRegisteredRows = Number(batchData?.alreadyRegisteredRows ?? 0);
        for (const result of batchData?.results ?? []) {
          if (result.success) continue;
          const rowIndex = typeof result.rowIndex === "number" && result.rowIndex > 0 ? result.rowIndex - 1 : -1;
          const source = rowIndex >= 0 ? batchRows[rowIndex] : null;
          const projectLabel = source?.projectId ? (importProjectLabelById.get(source.projectId) ?? "Projeto") : "Projeto";
          const contextValue = `${projectLabel} | ${source?.executionDate ?? "-"}`;
          const rowNumbers = Array.isArray(result.rowNumbers) && result.rowNumbers.length
            ? result.rowNumbers
            : source?.rowNumbers ?? [];
          for (const rowNumber of rowNumbers) {
            importIssues.push({
              rowNumber,
              column: result.alreadyRegistered ? "registro" : "salvamento",
              value: contextValue,
              error: result.message || responseMessage,
            });
          }
        }

        if (!importIssues.length) {
          importIssues.push({
            rowNumber: 1,
            column: "salvamento",
            value: file.name,
            error: responseMessage,
          });
        }

        const report = createMassImportErrorReport(importIssues);
        const duplicateHint = alreadyRegisteredRows ? ` ${alreadyRegisteredRows} linhas ja cadastradas.` : "";
        setMassImportErrorReport(report);
        setMassImportResult({
          status: "error",
          message: `${responseMessage}${duplicateHint}`.trim(),
          successCount: 0,
          errorRows: report?.errorRows ?? 0,
          alreadyRegisteredRows,
        });
        setFeedback({
          type: "error",
          message: `Falha na importacao em massa. Baixe o CSV de erros para corrigir.${duplicateHint}`,
        });
        return;
      }

      const successCount = Number(batchData.savedCount ?? 0);
      const alreadyRegisteredRows = Number(batchData.alreadyRegisteredRows ?? 0);
      const saveFailures: string[] = [];
      for (const result of batchData.results ?? []) {
        if (result.success) continue;
        const rowIndex = typeof result.rowIndex === "number" && result.rowIndex > 0 ? result.rowIndex - 1 : -1;
        const source = rowIndex >= 0 ? batchRows[rowIndex] : null;
        const projectLabel = source?.projectId ? (importProjectLabelById.get(source.projectId) ?? "Projeto") : "Projeto";
        const contextValue = `${projectLabel} | ${source?.executionDate ?? "-"}`;
        const failureMessage = result.message || "Erro ao salvar ordem.";
        const rowNumbers = Array.isArray(result.rowNumbers) && result.rowNumbers.length
          ? result.rowNumbers
          : source?.rowNumbers ?? [];

        if (!result.alreadyRegistered) {
          saveFailures.push(`${contextValue}: ${failureMessage}`);
        }

        for (const rowNumber of rowNumbers) {
          importIssues.push({
            rowNumber,
            column: result.alreadyRegistered ? "registro" : "salvamento",
            value: contextValue,
            error: failureMessage,
          });
        }
      }

      const backendErrorCount = Number(batchData.errorCount ?? 0);
      if (!importIssues.length && backendErrorCount > 0) {
        importIssues.push({
          rowNumber: 1,
          column: "salvamento",
          value: file.name,
          error: `${backendErrorCount} linhas retornaram erro sem detalhamento por linha.`,
        });
      }

      if (successCount) {
        setActiveFilters((current) => ({ ...current }));
      }

      const report = createMassImportErrorReport(importIssues);
      setMassImportErrorReport(report);

      if (!successCount) {
        const hint = saveFailures.length ? ` ${saveFailures.slice(0, 2).join(" | ")}` : "";
        const errorRows = report?.errorRows ?? 0;
        const duplicateHint = alreadyRegisteredRows ? ` ${alreadyRegisteredRows} linhas ja cadastradas.` : "";
        setMassImportResult({
          status: "error",
          message: `Cadastro em massa sem sucesso. 0 ordens salvas e ${errorRows} linhas com erro.${duplicateHint}${hint}`,
          successCount: 0,
          errorRows,
          alreadyRegisteredRows,
        });
        setFeedback({ type: "error", message: `Cadastro em massa sem sucesso. 0 ordens salvas e ${errorRows} linhas com erro.${duplicateHint}${hint}` });
        return;
      }

      if (importIssues.length) {
        const errorRows = report?.errorRows ?? 0;
        const duplicateHint = alreadyRegisteredRows ? ` ${alreadyRegisteredRows} linhas ja cadastradas.` : "";
        setMassImportResult({
          status: "partial",
          message: `Cadastro em massa parcial: ${successCount} ordens salvas e ${errorRows} linhas com erro.${duplicateHint}`,
          successCount,
          errorRows,
          alreadyRegisteredRows,
        });
        setFeedback({ type: "success", message: `Cadastro em massa parcial: ${successCount} ordens salvas e ${errorRows} linhas com erro.${duplicateHint}` });
      } else {
        setMassImportResult({
          status: "success",
          message: "Incluido com sucesso.",
          successCount,
          errorRows: 0,
          alreadyRegisteredRows: 0,
        });
        setFeedback({ type: "success", message: `Cadastro em massa concluido com sucesso. ${successCount} ordens salvas.` });
      }
    } catch (error) {
      setMassImportResult({
        status: "error",
        message: error instanceof Error ? error.message : "Falha no cadastro em massa da medicao.",
        successCount: 0,
        errorRows: 0,
        alreadyRegisteredRows: 0,
      });
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha no cadastro em massa da medicao." });
    } finally {
      setIsImportingMass(false);
    }
  }

  function openMassImportModal() {
    setMassImportFile(null);
    setMassImportErrorReport(null);
    setMassImportResult(null);
    setIsMassImportModalOpen(true);
  }

  function closeMassImportModal() {
    if (isImportingMass) return;
    setMassImportFile(null);
    setMassImportErrorReport(null);
    setMassImportResult(null);
    setIsMassImportModalOpen(false);
  }

  async function submitMassImport() {
    if (!massImportFile) return;
    await handleMassImportFile(massImportFile);
  }

  function downloadLastMassImportErrorReport() {
    downloadMassImportErrorReport(massImportErrorReport);
  }

  async function loadOrderDetail(orderId: string) {
    if (!accessToken) return null;
    const response = await fetch(`/api/medicao?orderId=${orderId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    const data = (await response.json().catch(() => null)) as OrderDetailResponse | null;
    if (!response.ok || !data?.order) {
      throw new Error(data?.message ?? "Falha ao carregar ordem de medicao.");
    }
    return data.order;
  }

  async function startEdit(orderId: string) {
    try {
      const order = await loadOrderDetail(orderId);
      if (!order) return;
      hasManualRateUserOverrideRef.current = true;
      setRateSuggestionSource(null);
      setForm({
        id: order.id,
        expectedUpdatedAt: order.updatedAt,
        orderNumber: order.orderNumber,
        status: order.status,
        originalTeamId: order.teamId,
        originalExecutionDate: order.executionDate,
        teamNameSnapshot: order.teamName,
        foremanNameSnapshot: order.foremanName,
        programmingId: order.programmingId ?? "",
        projectId: order.projectId,
        teamId: order.teamId,
        executionDate: order.executionDate,
        measurementDate: order.measurementDate,
        manualRate: String(order.manualRate),
        measurementKind: order.measurementKind,
        noProductionReasonId: order.measurementKind === "SEM_PRODUCAO" ? (order.noProductionReasonId ?? "") : "",
        notes: order.notes,
        activitySearch: "",
        activityQuantity: "1",
        activityMvaQuantity: "",
        activityWorkedHours: "",
        items: order.items.map((item) => ({
          rowId: createRowId(),
          activityId: item.activityId,
          programmingActivityId: item.programmingActivityId,
          projectActivityForecastId: item.projectActivityForecastId,
          code: item.code,
          description: item.description,
          unit: item.unit,
          quantity: String(item.quantity),
          mvaQuantity: item.mvaQuantity === null ? "" : String(item.mvaQuantity),
          workedHours: item.workedHours === null ? "" : String(item.workedHours),
          voicePoint: String(item.voicePoint),
          unitValue: String(item.unitValue),
          observation: item.observation,
        })),
      });
      if (findDuplicateFormActivityId(order.items)) {
        setFeedback({ type: "error", message: "Esta ordem possui atividade duplicada. Remova as linhas repetidas antes de salvar." });
      }
      setDetailOrder(null);
      closeHistoryModal();
      closeStatusModal();
      scrollDashboardContentToTop();
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao carregar ordem para edicao." });
    }
  }


  async function submitOrder(event: FormEvent) {
    event.preventDefault();
    if (!accessToken) return;

    const matchedProject = findProjectOption(formProjectSearch, projects);
    if (!matchedProject) {
      setFeedback({ type: "error", message: "Projeto invalido. Selecione um projeto da lista." });
      return;
    }

    const selectedProjectId = matchedProject.id;
    const manualRate = parsePositiveNumber(form.manualRate);
    if (form.measurementKind === "COM_PRODUCAO" && !manualRate) {
      setFeedback({ type: "error", message: "Taxa manual e obrigatoria." });
      return;
    }

    if (form.measurementKind === "SEM_PRODUCAO" && !form.noProductionReasonId) {
      setFeedback({ type: "error", message: "Selecione o motivo de sem producao." });
      return;
    }

    const invalidCompositeItem = form.items.find((item) => {
      const mvaQuantity = parsePositiveNumber(item.mvaQuantity);
      const workedHours = parsePositiveNumber(item.workedHours);
      const hasOnlyOneCompositeField = (mvaQuantity && !workedHours) || (!mvaQuantity && workedHours);
      return hasOnlyOneCompositeField;
    });
    if (invalidCompositeItem) {
      setFeedback({ type: "error", message: `Atividade ${invalidCompositeItem.code} exige MVA e Horas juntos quando preenchidos.` });
      return;
    }

    const missingCompositeValuesItem = form.items.find((item) => {
      if (!isMvaHourUnit(item.unit)) return false;
      const mvaQuantity = parsePositiveNumber(item.mvaQuantity);
      const workedHours = parsePositiveNumber(item.workedHours);
      return !(mvaQuantity && workedHours);
    });
    if (missingCompositeValuesItem) {
      setFeedback({ type: "error", message: `Atividade ${missingCompositeValuesItem.code} com unidade MVA*hora exige MVA e Horas. Quantidade nao e permitida.` });
      return;
    }

    const items = form.items
      .map((item) => {
        const mvaQuantity = parsePositiveNumber(item.mvaQuantity);
        const workedHours = parsePositiveNumber(item.workedHours);
        const derivedQuantity = (mvaQuantity && workedHours)
          ? Number((mvaQuantity * workedHours).toFixed(6))
          : null;
        const isComposite = isMvaHourUnit(item.unit);
        return {
          activityId: item.activityId,
          programmingActivityId: item.programmingActivityId,
          projectActivityForecastId: item.projectActivityForecastId,
          quantity: isComposite ? derivedQuantity : (derivedQuantity ?? parsePositiveNumber(item.quantity)),
          mvaQuantity: mvaQuantity ?? null,
          workedHours: workedHours ?? null,
          voicePoint: parsePositiveNumber(item.voicePoint),
          unitValue: parseNonNegativeNumber(item.unitValue),
          observation: item.observation,
        };
      })
      .filter((item) => item.activityId && item.quantity !== null && item.voicePoint !== null);

    if (form.measurementKind === "COM_PRODUCAO" && (!items.length || items.length !== form.items.length)) {
      setFeedback({ type: "error", message: "Revise os itens: atividade, quantidade e pontos sao obrigatorios." });
      return;
    }

    if (form.measurementKind === "SEM_PRODUCAO" && form.items.length) {
      setFeedback({ type: "error", message: "Medicao sem producao nao pode conter atividades." });
      return;
    }

    if (findDuplicateFormActivityId(items)) {
      setFeedback({ type: "error", message: "A mesma atividade nao pode ser repetida na ordem de medicao." });
      return;
    }

    if (!selectedProjectId || !form.teamId || !form.executionDate) {
      setFeedback({ type: "error", message: "Projeto, Equipe e Data de execucao sao obrigatorios." });
      return;
    }

    const measurementDateToSave = form.executionDate || today;

    const orderVoicePoint = form.measurementKind === "SEM_PRODUCAO" ? 1 : (items[0]?.voicePoint ?? 1);

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/medicao", {
        method: form.id ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          id: form.id,
          programmingId: form.id ? undefined : form.programmingId,
          projectId: selectedProjectId || undefined,
          teamId: form.teamId || undefined,
          executionDate: form.executionDate || undefined,
          measurementDate: measurementDateToSave,
          measurementKind: form.measurementKind,
          noProductionReasonId: form.measurementKind === "SEM_PRODUCAO" ? form.noProductionReasonId || undefined : undefined,
          voicePoint: orderVoicePoint,
          manualRate: form.measurementKind === "SEM_PRODUCAO" ? 1 : manualRate,
          notes: form.notes,
          expectedUpdatedAt: form.expectedUpdatedAt,
          items: form.measurementKind === "SEM_PRODUCAO" ? [] : items,
        }),
      });

      const data = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        throw new Error(data?.message ?? "Falha ao salvar ordem de medicao.");
      }

      setFeedback({ type: "success", message: data?.message ?? "Ordem de medicao salva com sucesso." });
      resetForm();
      setActiveFilters((current) => ({ ...current }));
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao salvar ordem de medicao." });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function openDetail(orderId: string) {
    try {
      const order = await loadOrderDetail(orderId);
      if (!order) return;
      setDetailOrder(order);
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao carregar detalhes da ordem." });
    }
  }

  async function openHistory(order: OrderItem) {
    if (!accessToken) return;
    setHistoryOrder({ id: order.id, orderNumber: order.orderNumber });
    setHistoryEntries([]);
    setHistoryPage(1);
    setIsLoadingHistory(true);
    try {
      const response = await fetch(`/api/medicao?historyOrderId=${order.id}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const data = (await response.json().catch(() => null)) as OrderHistoryResponse | null;
      if (!response.ok) {
        throw new Error(data?.message ?? "Falha ao carregar historico da ordem.");
      }
      setHistoryEntries(data?.history ?? []);
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao carregar historico da ordem." });
      setHistoryEntries([]);
    } finally {
      setIsLoadingHistory(false);
    }
  }

  function closeHistoryModal() {
    setHistoryOrder(null);
    setHistoryEntries([]);
    setHistoryPage(1);
  }

  function openCancelModal(order: OrderItem) {
    setStatusOrder(order);
    setStatusAction("CANCELAR");
    setStatusReason("");
  }

  function openReopenModal(order: OrderItem) {
    setStatusOrder(order);
    setStatusAction("ABRIR");
    setStatusReason("");
  }

  function closeStatusModal() {
    if (isChangingStatus) return;
    setStatusOrder(null);
    setStatusAction("CANCELAR");
    setStatusReason("");
  }

  function refreshMeasurementList() {
    if (!accessToken || isRefreshingList) {
      return;
    }

    refreshRequestedRef.current = true;
    refreshHadErrorRef.current = false;
    setIsRefreshingList(true);
    setRefreshTick((current) => current + 1);
  }

  async function submitStatusChange(order: OrderItem, action: StatusAction, reason = "") {
    if (!accessToken) return;
    if ((action === "CANCELAR" || action === "ABRIR") && reason.trim().length < 10) {
      setFeedback({ type: "error", message: action === "ABRIR" ? "Motivo da reabertura deve ter no minimo 10 caracteres." : "Motivo do cancelamento deve ter no minimo 10 caracteres." });
      return false;
    }

    setIsChangingStatus(true);
    try {
      const response = await fetch("/api/medicao", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ id: order.id, action, reason: reason.trim(), expectedUpdatedAt: order.updatedAt }),
      });

      const data = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        throw new Error(data?.message ?? "Falha ao alterar status da ordem.");
      }

      setFeedback({ type: "success", message: data?.message ?? "Status atualizado com sucesso." });
      setActiveFilters((current) => ({ ...current }));
      return true;
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao alterar status da ordem." });
      return false;
    } finally {
      setIsChangingStatus(false);
    }
  }

  async function confirmStatusReasonAction() {
    if (!statusOrder) return;
    const success = await submitStatusChange(statusOrder, statusAction, statusReason);
    if (success) {
      closeStatusModal();
    }
  }

  function applyFilters() {
    const matchedProject = findProjectOption(filterProjectSearch, projects);
    if (filterProjectSearch.trim() && !matchedProject) {
      setFeedback({ type: "error", message: "Projeto invalido no filtro. Selecione um projeto da lista." });
      return;
    }

    const nextFilters = { ...filterDraft, projectId: matchedProject?.id ?? "" };
    setFilterDraft(nextFilters);
    setFilterProjectSearch(matchedProject?.code ?? "");
    setPage(1);
    setActiveFilters(nextFilters);
  }

  function clearFilters() {
    setFilterDraft(initialFilters);
    setPage(1);
    setActiveFilters(initialFilters);
    setFilterProjectSearch("");
  }

  async function exportOrdersCsv() {
    if (!total) {
      setFeedback({ type: "error", message: "Nenhuma ordem encontrada para exportar com os filtros atuais." });
      return;
    }

    setIsExporting(true);
    try {
      const exportOrders = await loadAllOrdersForExport();
      if (!exportOrders.length) {
        throw new Error("Nenhuma ordem encontrada para exportar com os filtros atuais.");
      }

      const header = [
        "Ordem",
        "Projeto",
        "Data execucao",
        "Equipe",
        "Encarregado",
        "Tipo da medicao",
        "Motivo sem producao",
        "Programacao",
        "Status execucao",
        "Itens",
        "Valor total",
        "Status",
        "Atualizado em",
      ];
      const rows = exportOrders.map((order) => {
        const executionStatusLabel = workCompletionStatusLabel(order.programmingCompletionStatus, workCompletionLabelMap);
        const executionStatus = order.programmingCompletionStatusChangedAfterMeasurement
          ? `${executionStatusLabel} (Atualizado apos medicao)`
          : executionStatusLabel;
        return [
          order.orderNumber,
          order.projectCode,
          formatDate(order.executionDate),
          order.teamName,
          order.foremanName || "-",
          measurementKindLabel(order.measurementKind),
          order.noProductionReasonName || "-",
          programmingMatchLabel(order.programmingMatchStatus),
          executionStatus,
          String(order.itemCount),
          formatCurrency(order.totalAmount),
          order.status,
          formatDateTime(order.updatedAt),
        ];
      });
      const csvLines = [header, ...rows].map((line) => line.map((item) => csvEscape(item)).join(";"));
      const csv = `\uFEFF${csvLines.join("\n")}`;
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ordens_medicao_${toIsoDate(new Date())}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao exportar ordens de medicao." });
    } finally {
      setIsExporting(false);
    }
  }

  async function exportOrdersDetailedCsv() {
    if (!total) {
      setFeedback({ type: "error", message: "Nenhuma ordem encontrada para exportar detalhamento." });
      return;
    }
    if (!accessToken) return;

    setIsExportingDetails(true);
    try {
      const exportOrders = await loadAllOrdersForExport();
      if (!exportOrders.length) {
        throw new Error("Nenhuma ordem encontrada para exportar detalhamento.");
      }

      const detailResults = await Promise.allSettled(exportOrders.map((order) => loadOrderDetail(order.id)));
      const details = detailResults
        .filter((result): result is PromiseFulfilledResult<OrderDetail | null> => result.status === "fulfilled")
        .map((result) => result.value)
        .filter((item): item is OrderDetail => Boolean(item));
      const failedCount = detailResults.length - details.length;

      if (!details.length) {
        throw new Error("Falha ao carregar detalhes das ordens para exportar.");
      }

      const header = [
        "Ordem",
        "Projeto",
        "Data execucao",
        "Equipe",
        "Encarregado",
        "Tipo da medicao",
        "Motivo sem producao",
        "Programacao",
        "Status execucao",
        "Status ordem",
        "Codigo atividade",
        "Descricao atividade",
        "Unidade",
        "Pontos",
        "MVA",
        "Horas",
        "Quantidade",
        "Taxa manual",
        "Valor unitario",
        "Total item",
        "Observacao",
        "Atualizado em",
      ];

      const rows: string[][] = [];
      for (const detail of details) {
        const summary = exportOrders.find((order) => order.id === detail.id);
        const projectCode = summary?.projectCode ?? projectMap.get(detail.projectId)?.code ?? detail.projectId;
        const teamName = summary?.teamName ?? teamMap.get(detail.teamId)?.name ?? detail.teamId;
        const foremanName = summary?.foremanName ?? teamMap.get(detail.teamId)?.foremanName ?? "-";
        const programmingLabel = programmingMatchLabel(detail.programmingMatchStatus);
        const executionStatusLabel = workCompletionStatusLabel(detail.programmingCompletionStatus, workCompletionLabelMap);
        const executionStatus = detail.programmingCompletionStatusChangedAfterMeasurement
          ? `${executionStatusLabel} (Atualizado apos medicao)`
          : executionStatusLabel;

        const detailItems = detail.items.length ? detail.items : [{
          id: `${detail.id}-empty`,
          activityId: "",
          programmingActivityId: null,
          projectActivityForecastId: null,
          code: "",
          description: "",
          unit: "",
          quantity: 0,
          mvaQuantity: null,
          workedHours: null,
          voicePoint: 0,
          manualRate: detail.manualRate,
          unitValue: 0,
          totalValue: 0,
          observation: "",
        }];

        for (const item of detailItems) {
          const itemRate = item.manualRate || detail.manualRate;
          const totalItem = item.totalValue || (item.voicePoint * item.quantity * itemRate * item.unitValue);
          rows.push([
            detail.orderNumber,
            projectCode,
            formatDate(detail.executionDate),
            teamName,
            foremanName || "-",
            measurementKindLabel(detail.measurementKind),
            detail.noProductionReasonName || "-",
            programmingLabel,
            executionStatus,
            detail.status,
            item.code || "-",
            item.description || "-",
            item.unit || "-",
            item.voicePoint ? item.voicePoint.toLocaleString("pt-BR") : "0",
            item.mvaQuantity ? item.mvaQuantity.toLocaleString("pt-BR") : "-",
            item.workedHours ? item.workedHours.toLocaleString("pt-BR") : "-",
            item.quantity ? item.quantity.toLocaleString("pt-BR") : "0",
            itemRate.toLocaleString("pt-BR"),
            formatCurrency(item.unitValue),
            formatCurrency(totalItem),
            item.observation || "-",
            formatDateTime(detail.updatedAt),
          ]);
        }
      }

      const csvLines = [header, ...rows].map((line) => line.map((item) => csvEscape(item)).join(";"));
      const csv = `\uFEFF${csvLines.join("\n")}`;
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ordens_medicao_detalhamento_${toIsoDate(new Date())}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      if (failedCount > 0) {
        setFeedback({ type: "success", message: `Detalhamento exportado com sucesso. ${failedCount} ordens foram ignoradas por falha ao carregar detalhes.` });
      }
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao exportar detalhamento da medicao." });
    } finally {
      setIsExportingDetails(false);
    }
  }

  const formForemanName = form.id
    && form.teamId === form.originalTeamId
    && form.executionDate === form.originalExecutionDate
    ? form.foremanNameSnapshot
    : (teamMap.get(form.teamId)?.foremanName ?? "");

  return (
    <section className={styles.wrapper}>
      {feedback ? <div className={feedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError}>{feedback.message}</div> : null}

      <article className={`${styles.card} ${form.id ? styles.editingCard : ""}`}>
        <h2 className={styles.cardTitle}>Cadastro de Ordem de Medicao</h2>
        <form id="measurement-order-form" className={styles.formGrid} onSubmit={submitOrder}>
          <label className={styles.field}>
            <span>Projeto <span className="requiredMark">*</span></span>
            <input
              value={formProjectSearch}
              onChange={(event) => {
                const nextValue = event.target.value;
                const matched = findProjectOption(nextValue, projects);
                setFormProjectSearch(nextValue);
                hasManualRateUserOverrideRef.current = false;
                setRateSuggestionSource(null);
                setForm((current) => ({
                  ...current,
                  projectId: matched?.id ?? "",
                  programmingId: "",
                  items: current.id ? current.items : [],
                }));
              }}
              list="medicao-project-filter-list"
              placeholder="Digite o codigo do projeto"
            />
          </label>
          <label className={styles.field}>
            <span>Equipe <span className="requiredMark">*</span></span>
            <select
              value={form.teamId}
              onChange={(event) => setForm((current) => ({ ...current, teamId: event.target.value, programmingId: "", items: current.id ? current.items : [] }))}
            >
              <option value="">Selecione</option>
              {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            <span>Data execucao <span className="requiredMark">*</span></span>
            <input
              type="date"
              value={form.executionDate}
              onChange={(event) => setForm((current) => ({ ...current, executionDate: event.target.value, programmingId: "", items: current.id ? current.items : [] }))}
            />
          </label>
          <label className={styles.field}>
            <span>Tipo da medicao <span className="requiredMark">*</span></span>
            <select value={form.measurementKind} onChange={(event) => handleMeasurementKindChange(event.target.value as MeasurementKind)}>
              <option value="COM_PRODUCAO">Com producao</option>
              <option value="SEM_PRODUCAO">Sem producao</option>
            </select>
          </label>
          <label className={styles.field}><span>Encarregado</span><input value={formForemanName} readOnly /></label>
          <label className={styles.field}>
            <span>Motivo sem producao{form.measurementKind === "SEM_PRODUCAO" ? " *" : ""}</span>
            <select
              value={form.noProductionReasonId}
              onChange={(event) => setForm((current) => ({ ...current, noProductionReasonId: event.target.value }))}
              disabled={form.measurementKind !== "SEM_PRODUCAO"}
            >
              <option value="">Selecione</option>
              {noProductionReasons.map((reason) => <option key={reason.id} value={reason.id}>{reason.name}</option>)}
            </select>
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}><span>Observacoes</span><textarea rows={3} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label>
          {isLoadingSources ? <div className={`${styles.formActions} ${styles.actions}`}><span className={styles.loadingHint}>Atualizando dados...</span></div> : null}
        </form>

        <div className={styles.subCard}>
          <div className={styles.tableHeader}>
            <h3 className={styles.tableTitle}>Atividades da Ordem</h3>
            <span className={styles.tableHint}>
              {form.measurementKind === "SEM_PRODUCAO"
                ? "Sem producao: a ordem sera salva sem atividades e com total zero."
                : "Formula: pontos x quantidade x taxa x valor unitario"}
            </span>
          </div>
          <div className={styles.inlineForm}>
            <label className={styles.field}><span>Atividade</span><input value={form.activitySearch} disabled={form.measurementKind === "SEM_PRODUCAO"} onChange={(event) => {
              const nextSearch = event.target.value;
              const selected = findActivitySelectionOption(nextSearch, resolvedActivityOptions);
              const nextIsMvaHour = Boolean(selected && isMvaHourUnit(selected.unit));
              setForm((current) => ({
                ...current,
                activitySearch: nextSearch,
                activityQuantity: nextIsMvaHour ? "" : (current.activityQuantity || "1"),
              }));
            }} list="medicao-activity-list" /></label>
            <label className={`${styles.field} ${styles.compactField}`}>
              <span>Taxa unica da medicao {form.measurementKind === "COM_PRODUCAO" ? <span className="requiredMark">*</span> : null}</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={form.manualRate}
                disabled={form.measurementKind === "SEM_PRODUCAO"}
                onChange={(event) => {
                  hasManualRateUserOverrideRef.current = true;
                  setRateSuggestionSource("MANUAL");
                  setForm((current) => ({ ...current, manualRate: event.target.value }));
                }}
              />
              {rateSuggestionHint ? <small className={styles.fieldHint}>{rateSuggestionHint}</small> : null}
            </label>
            <label className={`${styles.field} ${styles.compactField}`}><span>Quantidade</span><input type="number" min="0.01" step="0.01" value={form.activityQuantity} placeholder={selectedActivityIsMvaHour ? "Calculada por MVA x Horas" : ""} disabled={form.measurementKind === "SEM_PRODUCAO" || selectedActivityIsMvaHour} onChange={(event) => setForm((current) => ({ ...current, activityQuantity: event.target.value }))} /></label>
            <label className={`${styles.field} ${styles.compactField}`}><span>Potencia (MVA)</span><input type="number" min="0.01" step="0.01" value={form.activityMvaQuantity} disabled={form.measurementKind === "SEM_PRODUCAO"} onChange={(event) => setForm((current) => ({ ...current, activityMvaQuantity: event.target.value }))} /></label>
            <label className={`${styles.field} ${styles.compactField}`}><span>Horas</span><input type="number" min="0.01" step="0.01" value={form.activityWorkedHours} disabled={form.measurementKind === "SEM_PRODUCAO"} onChange={(event) => setForm((current) => ({ ...current, activityWorkedHours: event.target.value }))} /></label>
            <div className={styles.actions}>
              <button type="button" className={styles.secondaryButton} onClick={() => void addActivity()} disabled={form.measurementKind === "SEM_PRODUCAO"}>Adicionar</button>
              {isEditing && form.measurementKind === "COM_PRODUCAO" && form.items.length ? (
                <button type="button" className={styles.ghostButton} onClick={recalculateItemsWithMeasurementRate}>
                  Recalcular totais
                </button>
              ) : null}
            </div>
          </div>

          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead><tr><th>Codigo</th><th>Descricao</th><th>Unidade</th><th>Pontos</th><th>Taxa aplicada</th><th>MVA</th><th>Horas</th><th>Quantidade</th><th>Valor unitario</th><th>Total</th><th>Observacao</th><th>Acoes</th></tr></thead>
              <tbody>
                {form.items.length ? form.items.map((item) => {
                  const voicePoint = parsePositiveNumber(item.voicePoint) ?? 1;
                  const rate = parsePositiveNumber(form.manualRate) ?? 1;
                  const qty = parsePositiveNumber(item.quantity) ?? 0;
                  const unitValue = parseNonNegativeNumber(item.unitValue) ?? 0;
                  const isComposite = isMvaHourUnit(item.unit);
                  const mvaQuantity = parsePositiveNumber(item.mvaQuantity);
                  const workedHours = parsePositiveNumber(item.workedHours);
                  const rowTotal = voicePoint * rate * qty * unitValue;
                  return (
                    <tr key={item.rowId}>
                      <td>{item.code}</td><td>{item.description}</td><td>{item.unit}</td>
                      <td><input className={styles.tableInput} value={item.voicePoint} readOnly /></td>
                      <td><input className={styles.tableInput} value={rate.toLocaleString("pt-BR")} readOnly /></td>
                      <td>
                        {isComposite ? (
                          <input className={styles.tableInput} type="number" min="0.01" step="0.01" value={item.mvaQuantity} onChange={(event) => updateRow(item.rowId, "mvaQuantity", event.target.value)} />
                        ) : "-"}
                      </td>
                      <td>
                        {isComposite ? (
                          <input className={styles.tableInput} type="number" min="0.01" step="0.01" value={item.workedHours} onChange={(event) => updateRow(item.rowId, "workedHours", event.target.value)} />
                        ) : "-"}
                      </td>
                      <td><input className={styles.tableInput} type="number" min="0.01" step="0.01" value={item.quantity} readOnly={isComposite || Boolean(mvaQuantity && workedHours)} onChange={(event) => updateRow(item.rowId, "quantity", event.target.value)} /></td>
                      <td><input className={styles.tableInput} type="number" value={item.unitValue} readOnly /></td>
                      <td>{formatCurrency(rowTotal)}</td>
                      <td><input className={styles.tableInput} value={item.observation} onChange={(event) => updateRow(item.rowId, "observation", event.target.value)} /></td>
                      <td><button type="button" className={styles.ghostButton} onClick={() => removeRow(item.rowId)}>Remover</button></td>
                    </tr>
                  );
                }) : <tr><td colSpan={12} className={styles.emptyRow}>{form.measurementKind === "SEM_PRODUCAO" ? "Ordem sem producao: nenhuma atividade deve ser adicionada." : "Nenhuma atividade adicionada."}</td></tr>}
              </tbody>
            </table>
          </div>
          <div className={styles.summaryBar}><div><span>Itens</span><strong>{form.items.length}</strong></div><div><span>Valor total</span><strong>{formatCurrency(totalAmount)}</strong></div></div>
          <div className={styles.actions}>
            <button type="submit" form="measurement-order-form" className={styles.primaryButton} disabled={isSubmitting}>
              {isSubmitting ? "Salvando..." : form.id ? "Salvar alteracoes" : "Salvar ordem"}
            </button>
            {!isEditing ? (
              <button type="button" className={styles.secondaryButton} onClick={openMassImportModal}>
                Cadastro em massa
              </button>
            ) : null}
            {form.id ? <button type="button" className={styles.ghostButton} onClick={resetForm}>Cancelar edicao</button> : null}
          </div>
        </div>
      </article>

      <article className={styles.card}>
        <h2 className={styles.cardTitle}>Filtros</h2>
        <div className={styles.filterGrid}>
          <label className={styles.field}><span>Data inicial</span><input type="date" value={filterDraft.startDate} onChange={(event) => setFilterDraft((current) => ({ ...current, startDate: event.target.value }))} /></label>
          <label className={styles.field}><span>Data final</span><input type="date" value={filterDraft.endDate} onChange={(event) => setFilterDraft((current) => ({ ...current, endDate: event.target.value }))} /></label>
          <label className={styles.field}>
            <span>Projeto</span>
            <input
              value={filterProjectSearch}
              onChange={(event) => {
                setFilterProjectSearch(event.target.value);
                if (!event.target.value.trim()) {
                  setFilterDraft((current) => ({ ...current, projectId: "" }));
                }
              }}
              list="medicao-project-filter-list"
              placeholder="Digite o codigo do projeto"
            />
          </label>
          <label className={styles.field}>
            <span>Equipe</span>
            <select value={filterDraft.teamId} onChange={(event) => setFilterDraft((current) => ({ ...current, teamId: event.target.value }))}>
              <option value="">Todas</option>
              {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </label>
          <label className={styles.field}><span>Status</span><select value={filterDraft.status} onChange={(event) => setFilterDraft((current) => ({ ...current, status: event.target.value as Filters["status"] }))}><option value="TODOS">Todos</option><option value="ABERTA">Aberta</option><option value="FECHADA">Fechada</option><option value="CANCELADA">Cancelada</option></select></label>
          <label className={styles.field}>
            <span>Tipo</span>
            <select value={filterDraft.measurementKind} onChange={(event) => setFilterDraft((current) => ({ ...current, measurementKind: event.target.value as Filters["measurementKind"] }))}>
              <option value="TODOS">Todos</option>
              <option value="COM_PRODUCAO">Com producao</option>
              <option value="SEM_PRODUCAO">Sem producao</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Motivo sem producao</span>
            <select value={filterDraft.noProductionReasonId} onChange={(event) => setFilterDraft((current) => ({ ...current, noProductionReasonId: event.target.value }))}>
              <option value="">Todos</option>
              {noProductionReasons.map((reason) => <option key={reason.id} value={reason.id}>{reason.name}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            <span>Programacao</span>
            <select value={filterDraft.programmingMatch} onChange={(event) => setFilterDraft((current) => ({ ...current, programmingMatch: event.target.value as Filters["programmingMatch"] }))}>
              <option value="TODOS">Todos</option>
              <option value="PROGRAMADA">Programada</option>
              <option value="NAO_PROGRAMADA">Nao programada</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Estado Trabalho</span>
            <select value={filterDraft.workCompletionStatus} onChange={(event) => setFilterDraft((current) => ({ ...current, workCompletionStatus: event.target.value as Filters["workCompletionStatus"] }))}>
              <option value="TODOS">Todos</option>
              {workCompletionFilterOptions
                .map((item) => (
                  <option key={item.code} value={item.code}>{item.label}</option>
                ))}
              <option value="NAO_INFORMADO">Nao informado</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Alerta Status execucao</span>
            <select value={filterDraft.completionAlert} onChange={(event) => setFilterDraft((current) => ({ ...current, completionAlert: event.target.value as Filters["completionAlert"] }))}>
              <option value="TODOS">Todos</option>
              <option value="SIM">Com alerta</option>
              <option value="NAO">Sem alerta</option>
            </select>
          </label>
        </div>
        <div className={styles.actions}><button type="button" className={styles.primaryButton} onClick={applyFilters}>Aplicar</button><button type="button" className={styles.ghostButton} onClick={clearFilters}>Limpar</button></div>
      </article>

      <article className={styles.card}>
        <div className={styles.tableHeader}>
          <h2 className={styles.cardTitle}>Lista de Ordens de Medicao</h2>
          <div className={styles.tableHeaderActions}>
            {isLoadingOrders ? <span className={styles.loadingHint}>Carregando...</span> : null}
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => void exportOrdersCsv()}
              disabled={isExporting || isExportingDetails || isRefreshingList || isLoadingOrders || total <= 0}
            >
              {isExporting ? "Exportando..." : "Exportar Excel (CSV)"}
            </button>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => void exportOrdersDetailedCsv()}
              disabled={isExportingDetails || isExporting || isRefreshingList || isLoadingOrders || total <= 0}
            >
              {isExportingDetails ? "Gerando..." : "Detalhamento (CSV)"}
            </button>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={refreshMeasurementList}
              disabled={isRefreshingList || isLoadingSources || isLoadingMeta || isLoadingOrders || isLoadingFilteredTotal || isExporting || isExportingDetails}
            >
              {isRefreshingList ? "Atualizando..." : "Atualizar lista"}
            </button>
          </div>
        </div>
        <div className={styles.summaryBar}>
          <div>
            <span>Ordens</span>
            <strong>{total}</strong>
          </div>
          <div>
            <span>Valor total</span>
            <strong>{formatCurrency(filteredOrdersTotalAmount)}</strong>
          </div>
        </div>
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead><tr><th>Ordem</th><th>Projeto</th><th>Data execucao</th><th>Equipe</th><th>Encarregado</th><th>Tipo</th><th>Motivo sem producao</th><th>Programacao</th><th>Status execucao</th><th>Itens</th><th>Valor total</th><th>Status</th><th>Atualizado em</th><th>Acoes</th></tr></thead>
            <tbody>
              {orders.length ? orders.map((order) => (
                <tr key={order.id} className={order.status === "CANCELADA" ? styles.inactiveRow : ""}>
                  <td>{order.orderNumber}</td>
                  <td>{order.projectCode}</td>
                  <td>{formatDate(order.executionDate)}</td>
                  <td>{order.teamName}</td>
                  <td>{order.foremanName || "-"}</td>
                  <td>{measurementKindLabel(order.measurementKind)}</td>
                  <td>{order.noProductionReasonName || "-"}</td>
                  <td>{programmingMatchLabel(order.programmingMatchStatus)}</td>
                  <td>
                    <div className={styles.executionStatusStack}>
                      <span>{workCompletionStatusLabel(order.programmingCompletionStatus, workCompletionLabelMap)}</span>
                      {order.programmingCompletionStatusChangedAfterMeasurement ? (
                        <span className={`${styles.statusTagDanger} ${styles.executionStatusAlert}`}>Atualizado apos medicao</span>
                      ) : null}
                    </div>
                  </td>
                  <td>{order.itemCount}</td>
                  <td>{formatCurrency(order.totalAmount)}</td>
                  <td><span className={order.status === "ABERTA" ? styles.statusTag : styles.statusTagDanger}>{order.status}</span></td>
                  <td>{formatDateTime(order.updatedAt)}</td>
                  <td className={styles.actionsCell}>
                    <div className={styles.tableActions}>
                      <button
                        type="button"
                        className={`${styles.actionButton} ${styles.actionView}`}
                        onClick={() => void openDetail(order.id)}
                        aria-label={`Detalhes da ordem ${order.orderNumber}`}
                        title="Detalhes"
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
                        onClick={() => void openHistory(order)}
                        aria-label={`Historico da ordem ${order.orderNumber}`}
                        title="Historico"
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
                      <button
                        type="button"
                        className={`${styles.actionButton} ${styles.actionEdit}`}
                        disabled={order.status !== "ABERTA"}
                        onClick={() => void startEdit(order.id)}
                        aria-label={`Editar ordem ${order.orderNumber}`}
                        title="Editar"
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
                        className={`${styles.actionButton} ${styles.actionCancel}`}
                        disabled={order.status === "CANCELADA" || isChangingStatus}
                        onClick={() => openCancelModal(order)}
                        aria-label={`Cancelar ordem ${order.orderNumber}`}
                        title="Cancelar"
                      >
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" />
                          <path
                            d="m9.5 9.5 5 5m0-5-5 5"
                            stroke="currentColor"
                            strokeWidth="1.7"
                            strokeLinecap="round"
                          />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className={`${styles.actionButton} ${styles.actionClose}`}
                        disabled={(order.status !== "ABERTA" && order.status !== "FECHADA") || isChangingStatus}
                        onClick={() => {
                          if (order.status === "ABERTA") {
                            void submitStatusChange(order, "FECHAR");
                            return;
                          }
                          if (order.status === "FECHADA") {
                            openReopenModal(order);
                          }
                        }}
                        aria-label={`${order.status === "FECHADA" ? "Abrir" : "Fechar"} ordem ${order.orderNumber}`}
                        title={order.status === "FECHADA" ? "Abrir" : "Fechar"}
                      >
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" />
                          {order.status === "FECHADA" ? (
                            <path
                              d="M12 8v8m-4-4h8"
                              stroke="currentColor"
                              strokeWidth="1.7"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          ) : (
                            <path
                              d="m8.5 12 2.2 2.2 4.8-4.8"
                              stroke="currentColor"
                              strokeWidth="1.7"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          )}
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              )) : <tr><td colSpan={14} className={styles.emptyRow}>{isLoadingOrders ? "Carregando ordens..." : "Nenhuma ordem encontrada."}</td></tr>}
            </tbody>
          </table>
        </div>

        <div className={styles.pagination}>
          <span>
            Pagina {Math.min(page, totalPages)} de {totalPages} | Total: {total}
          </span>
          <div className={styles.paginationActions}>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1 || isLoadingOrders}
            >
              Anterior
            </button>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={page >= totalPages || isLoadingOrders}
            >
              Proxima
            </button>
          </div>
        </div>
      </article>

      {detailOrder ? (
        <div className={styles.modalOverlay} onClick={() => setDetailOrder(null)}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Detalhes da Ordem {detailOrder.orderNumber}</h4>
                <p className={styles.modalSubtitle}>ID da ordem: {detailOrder.id}</p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={() => setDetailOrder(null)}>
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              <div className={styles.detailGrid}>
                <div><strong>Projeto:</strong> {projectMap.get(detailOrder.projectId)?.code ?? "-"}</div>
                <div><strong>Equipe:</strong> {detailOrder.teamName || teamMap.get(detailOrder.teamId)?.name || "-"}</div>
                <div><strong>Encarregado:</strong> {detailOrder.foremanName || teamMap.get(detailOrder.teamId)?.foremanName || "-"}</div>
                <div><strong>Data execucao:</strong> {formatDate(detailOrder.executionDate)}</div>
                <div><strong>Tipo da medicao:</strong> {measurementKindLabel(detailOrder.measurementKind)}</div>
                <div><strong>Motivo sem producao:</strong> {detailOrder.noProductionReasonName || "-"}</div>
                <div><strong>Programacao:</strong> {programmingMatchLabel(detailOrder.programmingMatchStatus)}</div>
                <div><strong>Status execucao:</strong> {workCompletionStatusLabel(detailOrder.programmingCompletionStatus, workCompletionLabelMap)}</div>
                <div><strong>Status da ordem:</strong> {detailOrder.status}</div>
                <div><strong>Taxa manual:</strong> {detailOrder.manualRate.toLocaleString("pt-BR")}</div>
                <div className={styles.detailWide}><strong>Observacoes:</strong> {detailOrder.notes || "-"}</div>
              </div>

              {detailOrder.programmingCompletionStatusChangedAfterMeasurement ? (
                <div className={styles.feedbackError}>
                  Alerta: o status CONCLUIDO/PARCIAL da programacao foi atualizado apos o registro desta medicao.
                </div>
              ) : null}

              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead><tr><th>Codigo</th><th>Descricao</th><th>Unidade</th><th>Pontos</th><th>MVA</th><th>Horas</th><th>Quantidade</th><th>Taxa</th><th>Valor unitario</th><th>Total</th><th>Observacao</th></tr></thead>
                  <tbody>
                    {detailOrder.items.length ? detailOrder.items.map((item) => (
                      <tr key={item.id}>
                        <td>{item.code}</td>
                        <td>{item.description}</td>
                        <td>{item.unit}</td>
                        <td>{item.voicePoint.toLocaleString("pt-BR")}</td>
                        <td>{item.mvaQuantity ? item.mvaQuantity.toLocaleString("pt-BR") : "-"}</td>
                        <td>{item.workedHours ? item.workedHours.toLocaleString("pt-BR") : "-"}</td>
                        <td>{item.quantity.toLocaleString("pt-BR")}</td>
                        <td>{item.manualRate.toLocaleString("pt-BR")}</td>
                        <td>{formatCurrency(item.unitValue)}</td>
                        <td>{formatCurrency(item.totalValue)}</td>
                        <td>{item.observation || "-"}</td>
                      </tr>
                    )) : <tr><td colSpan={11} className={styles.emptyRow}>Nenhum item encontrado.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </article>
        </div>
      ) : null}

      {historyOrder ? (
        <div className={styles.modalOverlay} onClick={closeHistoryModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Historico da Ordem {historyOrder.orderNumber}</h4>
                <p className={styles.modalSubtitle}>ID da ordem: {historyOrder.id}</p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={closeHistoryModal}>
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              {isLoadingHistory ? <p>Carregando historico...</p> : null}
              {!isLoadingHistory && historyEntries.length === 0 ? <p>Nenhuma alteracao registrada.</p> : null}

              {!isLoadingHistory && pagedHistoryEntries.length > 0 ? pagedHistoryEntries.map((entry) => (
                <article key={entry.id} className={styles.historyCard}>
                  <header className={styles.historyCardHeader}>
                    <strong>{formatHistoryActionLabel(entry.action)}</strong>
                    <span>{formatDateTime(entry.changedAt)} | {entry.changedByName || "-"}</span>
                  </header>
                  {entry.reason ? <p className={styles.historyReason}>Motivo: {entry.reason}</p> : null}
                  <div className={styles.historyChanges}>
                    {Object.entries(entry.changes ?? {}).length ? Object.entries(entry.changes ?? {}).map(([field, change]) => (
                      <div key={field} className={styles.historyChangeItem}>
                        <strong>{HISTORY_FIELD_LABELS[field] ?? field}</strong>
                        <span>De: {formatHistoryValue(change.from)}</span>
                        <span>Para: {formatHistoryValue(change.to)}</span>
                      </div>
                    )) : <div className={styles.historyChangeItem}><span>Sem alteracoes detalhadas.</span></div>}
                  </div>
                </article>
              )) : null}

              {!isLoadingHistory && historyEntries.length > 0 ? (
                <div className={styles.pagination}>
                  <span>
                    Pagina {Math.min(historyPage, historyTotalPages)} de {historyTotalPages} | Total: {historyEntries.length}
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
                      onClick={() => setHistoryPage((current) => Math.min(historyTotalPages, current + 1))}
                      disabled={historyPage >= historyTotalPages}
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

      {statusOrder ? (
        <div className={styles.modalOverlay} onClick={closeStatusModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>{statusAction === "ABRIR" ? "Abrir Ordem de Medicao" : "Cancelar Ordem de Medicao"}</h4>
                <p className={styles.modalSubtitle}>
                  Ordem {statusOrder.orderNumber} {statusAction === "ABRIR" ? "sera reaberta." : "sera cancelada."}
                </p>
              </div>
            </header>

            <div className={styles.modalBody}>
              <label className={styles.field}>
                <span>{statusAction === "ABRIR" ? "Motivo da reabertura" : "Motivo do cancelamento"} <span className="requiredMark">*</span></span>
                <textarea
                  rows={4}
                  value={statusReason}
                  onChange={(event) => setStatusReason(event.target.value)}
                  placeholder={statusAction === "ABRIR" ? "Descreva o motivo da reabertura (minimo 10 caracteres)" : "Descreva o motivo do cancelamento (minimo 10 caracteres)"}
                />
              </label>

              <div className={styles.actions}>
                <button type="button" className={styles.ghostButton} onClick={closeStatusModal} disabled={isChangingStatus}>
                  Voltar
                </button>
                <button
                  type="button"
                  className={statusAction === "ABRIR" ? styles.primaryButton : styles.dangerButton}
                  onClick={() => void confirmStatusReasonAction()}
                  disabled={!canSubmitStatusReason}
                >
                  {isChangingStatus ? (statusAction === "ABRIR" ? "Abrindo..." : "Cancelando...") : (statusAction === "ABRIR" ? "Confirmar abertura" : "Confirmar cancelamento")}
                </button>
              </div>
            </div>
          </article>
        </div>
      ) : null}

      {isMassImportModalOpen ? (
        <div className={styles.modalOverlay} onClick={closeMassImportModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Cadastro em massa</h4>
                <p className={styles.modalSubtitle}>Importe um CSV para criar ordens de medicao em lote.</p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={closeMassImportModal}>
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              <section className={styles.importStep}>
                <div className={styles.importStepHeader}>
                  <span className={styles.importStepNumber}>1</span>
                  <div>
                    <strong>Baixe o modelo</strong>
                    <p>Use o arquivo modelo com as colunas obrigatorias.</p>
                  </div>
                </div>
                <button type="button" className={styles.secondaryButton} onClick={downloadMassTemplate}>
                  Baixar modelo CSV
                </button>
              </section>

              <section className={styles.importStep}>
                <div className={styles.importStepHeader}>
                  <span className={styles.importStepNumber}>2</span>
                  <div>
                    <strong>Preencha a planilha</strong>
                    <p>Colunas obrigatorias: projeto, data, equipe, tipo_medicao, motivo_sem_producao, voz, taxa. Para atividade MVA*hora, informe mva e horas.</p>
                  </div>
                </div>
              </section>

              <section className={styles.importStep}>
                <div className={styles.importStepHeader}>
                  <span className={styles.importStepNumber}>3</span>
                  <div>
                    <strong>Envie o arquivo</strong>
                    <p>Somente arquivo CSV.</p>
                  </div>
                </div>
                <label className={styles.importDropzone}>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(event) => setMassImportFile(event.target.files?.[0] ?? null)}
                  />
                  <span>{massImportFile ? massImportFile.name : "Clique para selecionar o arquivo CSV"}</span>
                </label>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() => void submitMassImport()}
                    disabled={!massImportFile || isImportingMass}
                  >
                    {isImportingMass ? "Importando..." : "Importar planilha"}
                  </button>
                  {massImportErrorReport ? (
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={downloadLastMassImportErrorReport}
                    >
                      Baixar erros (CSV)
                    </button>
                  ) : null}
                </div>
                {massImportResult ? (
                  <div className={massImportResult.status === "error" ? styles.feedbackError : styles.feedbackSuccess}>
                    <strong>{massImportResult.status === "success" ? "Incluido com sucesso." : massImportResult.status === "partial" ? "Importacao parcial." : "Importacao com erros."}</strong>
                    <div>{massImportResult.successCount} ordens salvas.</div>
                    {massImportResult.errorRows > 0 ? <div>{massImportResult.errorRows} linhas com erro.</div> : null}
                    {massImportResult.alreadyRegisteredRows > 0 ? <div>{massImportResult.alreadyRegisteredRows} linhas ja cadastradas.</div> : null}
                    {massImportResult.message ? <div>{massImportResult.message}</div> : null}
                  </div>
                ) : null}
              </section>
            </div>
          </article>
        </div>
      ) : null}

      <datalist id="medicao-activity-list">{resolvedActivityOptions.map((item) => <option key={item.id} value={activityOptionLabel(item)} />)}</datalist>
      <datalist id="medicao-project-filter-list">
        {projects.map((item) => (
          <option key={item.id} value={item.code}>
            {item.serviceName}
          </option>
        ))}
      </datalist>
    </section>
  );
}

