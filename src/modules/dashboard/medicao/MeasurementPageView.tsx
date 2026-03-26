"use client";

import { FormEvent, useDeferredValue, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import styles from "./MeasurementPageView.module.css";

type MeasurementStatus = "ABERTA" | "FECHADA" | "CANCELADA";
type ProgrammingStatus = "PROGRAMADA" | "REPROGRAMADA" | "ADIADA" | "CANCELADA";
type ProgrammingMatchStatus = "PROGRAMADA" | "NAO_PROGRAMADA";
type WorkCompletionStatus = "CONCLUIDO" | "PARCIAL" | null;

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

type ProgrammingResponse = {
  projects?: ProjectItem[];
  teams?: TeamItem[];
  schedules?: ScheduleItem[];
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

type MeasurementRow = {
  rowId: string;
  activityId: string;
  programmingActivityId: string | null;
  projectActivityForecastId: string | null;
  code: string;
  description: string;
  unit: string;
  quantity: string;
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
  voicePoint: number;
  unitValue: number;
  observation: string;
};

type OrderDetail = {
  id: string;
  orderNumber: string;
  programmingId: string | null;
  projectId: string;
  teamId: string;
  executionDate: string;
  measurementDate: string;
  voicePoint: number;
  manualRate: number;
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

const HISTORY_PAGE_SIZE = 5;
const HISTORY_FIELD_LABELS: Record<string, string> = {
  projectId: "Projeto",
  teamId: "Equipe",
  executionDate: "Data execucao",
  manualRate: "Taxa manual",
  itemCount: "Quantidade de itens",
  status: "Status",
};

type Filters = {
  startDate: string;
  endDate: string;
  projectId: string;
  status: "TODOS" | MeasurementStatus;
  programmingMatch: "TODOS" | ProgrammingMatchStatus;
  completionAlert: "TODOS" | "SIM" | "NAO";
};

type FormState = {
  id: string | null;
  expectedUpdatedAt: string | null;
  orderNumber: string;
  status: MeasurementStatus;
  programmingId: string;
  projectId: string;
  teamId: string;
  executionDate: string;
  measurementDate: string;
  manualRate: string;
  notes: string;
  activitySearch: string;
  activityQuantity: string;
  items: MeasurementRow[];
};

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
    programmingId: "",
    projectId: "",
    teamId: "",
    executionDate: today,
    measurementDate: today,
    manualRate: "1",
    notes: "",
    activitySearch: "",
    activityQuantity: "1",
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

function programmingMatchLabel(status: ProgrammingMatchStatus) {
  return status === "PROGRAMADA" ? "Programada" : "Nao programada";
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

export function MeasurementPageView() {
  const { session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const today = useMemo(() => toIsoDate(new Date()), []);
  const initialFilters = useMemo(
    () => ({ ...yearRange(today), projectId: "", status: "TODOS" as const, programmingMatch: "TODOS" as const, completionAlert: "TODOS" as const }),
    [today],
  );

  const [form, setForm] = useState<FormState>(() => createForm(today));
  const [formProjectSearch, setFormProjectSearch] = useState("");
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [teams, setTeams] = useState<TeamItem[]>([]);
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [activityOptions, setActivityOptions] = useState<ActivityCatalogItem[]>([]);
  const [filterDraft, setFilterDraft] = useState<Filters>(initialFilters);
  const [filterProjectSearch, setFilterProjectSearch] = useState("");
  const [activeFilters, setActiveFilters] = useState<Filters>(initialFilters);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [detailOrder, setDetailOrder] = useState<OrderDetail | null>(null);
  const [historyOrder, setHistoryOrder] = useState<{ id: string; orderNumber: string } | null>(null);
  const [historyEntries, setHistoryEntries] = useState<OrderHistoryEntry[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [statusOrder, setStatusOrder] = useState<OrderItem | null>(null);
  const [statusReason, setStatusReason] = useState("");
  const [isLoadingSources, setIsLoadingSources] = useState(false);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
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
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const deferredActivitySearch = useDeferredValue(form.activitySearch);

  const projectMap = useMemo(() => new Map(projects.map((item) => [item.id, item])), [projects]);
  const teamMap = useMemo(() => new Map(teams.map((item) => [item.id, item])), [teams]);
  const resolvedActivityOptions = useMemo(() => {
    const byId = new Map<string, ActivityCatalogItem>();
    for (const item of activityOptions) {
      if (!byId.has(item.id)) {
        byId.set(item.id, item);
      }
    }
    return Array.from(byId.values());
  }, [activityOptions]);

  const totalAmount = useMemo(() => {
    const manualRate = parsePositiveNumber(form.manualRate) ?? 1;
    return form.items.reduce((sum, item) => {
      const voicePoint = parsePositiveNumber(item.voicePoint) ?? 1;
      const quantity = parsePositiveNumber(item.quantity) ?? 0;
      const unitValue = parseNonNegativeNumber(item.unitValue) ?? 0;
      return sum + (voicePoint * quantity * manualRate * unitValue);
    }, 0);
  }, [form.items, form.manualRate]);
  const canSubmitCancelStatus = Boolean(statusOrder) && statusReason.trim().length >= 10 && !isChangingStatus;
  const historyTotalPages = Math.max(1, Math.ceil(historyEntries.length / HISTORY_PAGE_SIZE));
  const pagedHistoryEntries = useMemo(
    () => historyEntries.slice((historyPage - 1) * HISTORY_PAGE_SIZE, historyPage * HISTORY_PAGE_SIZE),
    [historyEntries, historyPage],
  );

  useEffect(() => {
    if (historyPage > historyTotalPages) {
      setHistoryPage(historyTotalPages);
    }
  }, [historyPage, historyTotalPages]);

  useEffect(() => {
    if (!accessToken) {
      setProjects([]);
      setTeams([]);
      setSchedules([]);
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
  }, [accessToken, activeFilters.endDate, activeFilters.startDate, form.executionDate]);

  useEffect(() => {
    if (!accessToken) {
      setOrders([]);
      return;
    }

    let ignore = false;
    async function loadOrders() {
      setIsLoadingOrders(true);
      try {
        const params = new URLSearchParams();
        params.set("startDate", activeFilters.startDate);
        params.set("endDate", activeFilters.endDate);
        params.set("status", activeFilters.status);
        params.set("programmingMatch", activeFilters.programmingMatch);
        params.set("completionAlert", activeFilters.completionAlert);
        if (activeFilters.projectId) params.set("projectId", activeFilters.projectId);
        const response = await fetch(`/api/medicao?${params.toString()}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
        const data = (await response.json().catch(() => null)) as OrderListResponse | null;
        if (!response.ok) throw new Error(data?.message ?? "Falha ao carregar ordens de medicao.");
        if (ignore) return;
        setOrders(data?.orders ?? []);
      } catch (error) {
        if (!ignore) {
          setOrders([]);
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
  }, [accessToken, activeFilters]);

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
    if (!filterDraft.projectId) return;
    const projectCode = projectMap.get(filterDraft.projectId)?.code ?? "";
    if (projectCode && projectCode !== filterProjectSearch) {
      setFilterProjectSearch(projectCode);
    }
  }, [filterDraft.projectId, filterProjectSearch, projectMap]);

  function resetForm() {
    setForm(createForm(today));
    setFormProjectSearch("");
  }

  function updateRow(rowId: string, field: "quantity" | "observation", value: string) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item) => (item.rowId === rowId ? { ...item, [field]: value } : item)),
    }));
  }

  function removeRow(rowId: string) {
    setForm((current) => ({ ...current, items: current.items.filter((item) => item.rowId !== rowId) }));
  }

  async function addActivity() {
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

    const quantity = parsePositiveNumber(form.activityQuantity);
    if (!quantity) {
      setFeedback({ type: "error", message: "Informe quantidade valida para incluir a atividade." });
      return;
    }

    setForm((current) => ({
      ...current,
      activitySearch: "",
      activityQuantity: "1",
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
          voicePoint: String(option.voicePoint ?? 1),
          unitValue: String(option.unitValue ?? 0),
          observation: "",
        },
      ],
    }));
    setFeedback(null);
  }

  function downloadMassTemplate() {
    const model = "\uFEFFprojeto;data;equipe;voz;quantidade\nA0123456789;2026-03-25;MK-01;TH0108;1\n";
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
      return findActivityOption(codeValue, resolvedActivityOptions);
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

    const remote = findActivityOption(codeValue, Array.from(unique.values()));
    if (remote) return remote;
    return findActivityOption(codeValue, resolvedActivityOptions);
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
      const voiceIndex = headerMap.get("voz") ?? headerMap.get("voice") ?? headerMap.get("codigo") ?? headerMap.get("code");
      const quantityIndex = headerMap.get("quantidade") ?? headerMap.get("qtd") ?? headerMap.get("qty");

      const missingColumns: string[] = [];
      if (projectIndex === undefined) missingColumns.push("projeto");
      if (dateIndex === undefined) missingColumns.push("data");
      if (teamIndex === undefined) missingColumns.push("equipe");
      if (voiceIndex === undefined) missingColumns.push("voz");
      if (quantityIndex === undefined) missingColumns.push("quantidade");
      if (projectIndex === undefined || dateIndex === undefined || teamIndex === undefined || voiceIndex === undefined || quantityIndex === undefined) {
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
          message: "Modelo invalido. Use colunas: projeto,data,equipe,voz,quantidade.",
          successCount: 0,
          errorRows: report?.errorRows ?? 0,
          alreadyRegisteredRows: 0,
        });
        setFeedback({ type: "error", message: "Modelo invalido. Use colunas: projeto,data,equipe,voz,quantidade." });
        return;
      }

      const parsedRows: ParsedMassImportRow[] = rows.map((row, rowIndex) => {
        const projectRaw = String(row[projectIndex] ?? "").trim();
        const dateRaw = String(row[dateIndex] ?? "").trim();
        const teamRaw = String(row[teamIndex] ?? "").trim();
        const voiceRaw = String(row[voiceIndex] ?? "").trim();
        const quantityRaw = String(row[quantityIndex] ?? "").trim();
        const executionDate = parseImportDate(dateRaw);
        const quantity = parsePositiveNumber(quantityRaw);
        return {
          rowNumber: rowIndex + 2,
          projectCode: projectRaw,
          projectRaw,
          teamName: teamRaw,
          teamRaw,
          executionDate,
          executionDateRaw: dateRaw,
          voiceCode: voiceRaw,
          voiceRaw,
          quantity,
          quantityRaw,
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
        if (!row.voiceCode) {
          importIssues.push({ rowNumber: row.rowNumber, column: "voz", value: row.voiceRaw, error: "Codigo da atividade obrigatorio." });
          hasError = true;
        }
        if (!row.quantity) {
          importIssues.push({ rowNumber: row.rowNumber, column: "quantidade", value: row.quantityRaw, error: "Quantidade invalida. Informe numero maior que zero." });
          hasError = true;
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
        };
        items: Map<string, { activity: ActivityCatalogItem; quantity: number }>;
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

        const activity = activityByCode.get(normalizeSearchText(row.voiceCode));
        if (!activity) {
          importIssues.push({
            rowNumber: row.rowNumber,
            column: "voz",
            value: row.voiceCode,
            error: "Atividade nao encontrada no catalogo da medicao.",
          });
          continue;
        }

        const projectId = selectedSchedule?.projectId ?? matchedProject.id;
        const teamId = selectedSchedule?.teamId ?? matchedTeam.id;
        const executionDate = selectedSchedule?.date ?? (row.executionDate as string);

        const groupingKey = selectedSchedule?.id ?? `${projectId}|${teamId}|${executionDate}`;
        const group = grouped.get(groupingKey) ?? {
          context: {
            programmingId: selectedSchedule?.id ?? null,
            projectId,
            teamId,
            executionDate,
          },
          items: new Map(),
          rowNumbers: new Set<number>(),
        };
        const current = group.items.get(activity.id);
        const quantity = row.quantity as number;
        if (current) {
          current.quantity = Number((current.quantity + quantity).toFixed(6));
        } else {
          group.items.set(activity.id, { activity, quantity });
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

      const manualRate = parsePositiveNumber(form.manualRate) ?? 1;
      const batchRows = Array.from(grouped.values()).map((group) => ({
        rowNumbers: Array.from(group.rowNumbers.values()).sort((a, b) => a - b),
        programmingId: group.context.programmingId ?? undefined,
        projectId: group.context.projectId,
        teamId: group.context.teamId,
        executionDate: group.context.executionDate,
        measurementDate: group.context.executionDate,
        voicePoint: 1,
        manualRate,
        notes: "Cadastro em massa (CSV)",
        items: Array.from(group.items.values()).map((entry) => ({
          activityId: entry.activity.id,
          quantity: entry.quantity,
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
        throw new Error(batchData?.message ?? "Falha no cadastro em massa da medicao.");
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
      setForm({
        id: order.id,
        expectedUpdatedAt: order.updatedAt,
        orderNumber: order.orderNumber,
        status: order.status,
        programmingId: order.programmingId ?? "",
        projectId: order.projectId,
        teamId: order.teamId,
        executionDate: order.executionDate,
        measurementDate: order.measurementDate,
        manualRate: String(order.manualRate),
        notes: order.notes,
        activitySearch: "",
        activityQuantity: "1",
        items: order.items.map((item) => ({
          rowId: createRowId(),
          activityId: item.activityId,
          programmingActivityId: item.programmingActivityId,
          projectActivityForecastId: item.projectActivityForecastId,
          code: item.code,
          description: item.description,
          unit: item.unit,
          quantity: String(item.quantity),
          voicePoint: String(item.voicePoint),
          unitValue: String(item.unitValue),
          observation: item.observation,
        })),
      });
      setDetailOrder(null);
      closeHistoryModal();
      closeCancelModal();
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
    if (!manualRate) {
      setFeedback({ type: "error", message: "Taxa manual e obrigatoria." });
      return;
    }

    const items = form.items
      .map((item) => ({
        activityId: item.activityId,
        programmingActivityId: item.programmingActivityId,
        projectActivityForecastId: item.projectActivityForecastId,
        quantity: parsePositiveNumber(item.quantity),
        voicePoint: parsePositiveNumber(item.voicePoint),
        unitValue: parseNonNegativeNumber(item.unitValue),
        observation: item.observation,
      }))
      .filter((item) => item.activityId && item.quantity !== null && item.voicePoint !== null);

    if (!items.length || items.length !== form.items.length) {
      setFeedback({ type: "error", message: "Revise os itens: atividade, quantidade e pontos sao obrigatorios." });
      return;
    }

    if (!selectedProjectId || !form.teamId || !form.executionDate) {
      setFeedback({ type: "error", message: "Projeto, Equipe e Data de execucao sao obrigatorios." });
      return;
    }

    const measurementDateToSave = form.executionDate || today;

    const orderVoicePoint = items[0]?.voicePoint ?? 1;

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
          voicePoint: orderVoicePoint,
          manualRate,
          notes: form.notes,
          expectedUpdatedAt: form.expectedUpdatedAt,
          items,
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
    setStatusReason("");
  }

  function closeCancelModal() {
    if (isChangingStatus) return;
    setStatusOrder(null);
    setStatusReason("");
  }

  async function submitStatusChange(order: OrderItem, action: "FECHAR" | "CANCELAR", reason = "") {
    if (!accessToken) return;
    if (action === "CANCELAR" && reason.trim().length < 10) {
      setFeedback({ type: "error", message: "Motivo do cancelamento deve ter no minimo 10 caracteres." });
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

  async function confirmCancelStatus() {
    if (!statusOrder) return;
    const success = await submitStatusChange(statusOrder, "CANCELAR", statusReason);
    if (success) {
      closeCancelModal();
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
    setActiveFilters(nextFilters);
  }

  function clearFilters() {
    setFilterDraft(initialFilters);
    setActiveFilters(initialFilters);
    setFilterProjectSearch("");
  }

  async function exportOrdersCsv() {
    if (!orders.length) {
      setFeedback({ type: "error", message: "Nenhuma ordem encontrada para exportar com os filtros atuais." });
      return;
    }

    setIsExporting(true);
    try {
      const header = [
        "Ordem",
        "Projeto",
        "Data execucao",
        "Equipe",
        "Encarregado",
        "Programacao",
        "Status execucao",
        "Itens",
        "Valor total",
        "Status",
        "Atualizado em",
      ];
      const rows = orders.map((order) => {
        const executionStatus = order.programmingCompletionStatusChangedAfterMeasurement
          ? `${order.programmingCompletionStatus ?? "-"} (Atualizado apos medicao)`
          : (order.programmingCompletionStatus ?? "-");
        return [
          order.orderNumber,
          order.projectCode,
          formatDate(order.executionDate),
          order.teamName,
          order.foremanName || "-",
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
    } finally {
      setIsExporting(false);
    }
  }

  async function exportOrdersDetailedCsv() {
    if (!orders.length) {
      setFeedback({ type: "error", message: "Nenhuma ordem encontrada para exportar detalhamento." });
      return;
    }
    if (!accessToken) return;

    setIsExportingDetails(true);
    try {
      const detailResults = await Promise.allSettled(orders.map((order) => loadOrderDetail(order.id)));
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
        "Programacao",
        "Status execucao",
        "Status ordem",
        "Codigo atividade",
        "Descricao atividade",
        "Unidade",
        "Pontos",
        "Quantidade",
        "Taxa manual",
        "Valor unitario",
        "Total item",
        "Observacao",
        "Atualizado em",
      ];

      const rows: string[][] = [];
      for (const detail of details) {
        const summary = orders.find((order) => order.id === detail.id);
        const projectCode = summary?.projectCode ?? projectMap.get(detail.projectId)?.code ?? detail.projectId;
        const teamName = summary?.teamName ?? teamMap.get(detail.teamId)?.name ?? detail.teamId;
        const foremanName = summary?.foremanName ?? teamMap.get(detail.teamId)?.foremanName ?? "-";
        const programmingLabel = programmingMatchLabel(detail.programmingMatchStatus);
        const executionStatus = detail.programmingCompletionStatusChangedAfterMeasurement
          ? `${detail.programmingCompletionStatus ?? "-"} (Atualizado apos medicao)`
          : (detail.programmingCompletionStatus ?? "-");

        const detailItems = detail.items.length ? detail.items : [{
          id: `${detail.id}-empty`,
          activityId: "",
          programmingActivityId: null,
          projectActivityForecastId: null,
          code: "",
          description: "",
          unit: "",
          quantity: 0,
          voicePoint: 0,
          unitValue: 0,
          observation: "",
        }];

        for (const item of detailItems) {
          const totalItem = item.voicePoint * item.quantity * detail.manualRate * item.unitValue;
          rows.push([
            detail.orderNumber,
            projectCode,
            formatDate(detail.executionDate),
            teamName,
            foremanName || "-",
            programmingLabel,
            executionStatus,
            detail.status,
            item.code || "-",
            item.description || "-",
            item.unit || "-",
            item.voicePoint ? item.voicePoint.toLocaleString("pt-BR") : "0",
            item.quantity ? item.quantity.toLocaleString("pt-BR") : "0",
            detail.manualRate.toLocaleString("pt-BR"),
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
          <label className={styles.field}><span>Encarregado</span><input value={teamMap.get(form.teamId)?.foremanName ?? ""} readOnly /></label>
          <label className={`${styles.field} ${styles.fieldWide}`}><span>Observacoes</span><textarea rows={3} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label>
          {isLoadingSources ? <div className={`${styles.formActions} ${styles.actions}`}><span className={styles.loadingHint}>Atualizando dados...</span></div> : null}
        </form>

        <div className={styles.subCard}>
          <div className={styles.tableHeader}>
            <h3 className={styles.tableTitle}>Atividades da Ordem</h3>
            <span className={styles.tableHint}>Formula: pontos x quantidade x taxa x valor unitario</span>
          </div>
          <div className={styles.inlineForm}>
            <label className={styles.field}><span>Atividade</span><input value={form.activitySearch} onChange={(event) => setForm((current) => ({ ...current, activitySearch: event.target.value }))} list="medicao-activity-list" /></label>
            <label className={`${styles.field} ${styles.compactField}`}><span>Taxa manual <span className="requiredMark">*</span></span><input type="number" min="0.01" step="0.01" value={form.manualRate} onChange={(event) => setForm((current) => ({ ...current, manualRate: event.target.value }))} /></label>
            <label className={`${styles.field} ${styles.compactField}`}><span>Quantidade</span><input type="number" min="0.01" step="0.01" value={form.activityQuantity} onChange={(event) => setForm((current) => ({ ...current, activityQuantity: event.target.value }))} /></label>
            <div className={styles.actions}><button type="button" className={styles.secondaryButton} onClick={() => void addActivity()}>Adicionar</button></div>
          </div>

          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead><tr><th>Codigo</th><th>Descricao</th><th>Unidade</th><th>Pontos</th><th>Quantidade</th><th>Valor unitario</th><th>Total</th><th>Observacao</th><th>Acoes</th></tr></thead>
              <tbody>
                {form.items.length ? form.items.map((item) => {
                  const voicePoint = parsePositiveNumber(item.voicePoint) ?? 1;
                  const rate = parsePositiveNumber(form.manualRate) ?? 1;
                  const qty = parsePositiveNumber(item.quantity) ?? 0;
                  const unitValue = parseNonNegativeNumber(item.unitValue) ?? 0;
                  const rowTotal = voicePoint * rate * qty * unitValue;
                  return (
                    <tr key={item.rowId}>
                      <td>{item.code}</td><td>{item.description}</td><td>{item.unit}</td>
                      <td><input className={styles.tableInput} value={item.voicePoint} readOnly /></td>
                      <td><input className={styles.tableInput} type="number" min="0.01" step="0.01" value={item.quantity} onChange={(event) => updateRow(item.rowId, "quantity", event.target.value)} /></td>
                      <td><input className={styles.tableInput} type="number" value={item.unitValue} readOnly /></td>
                      <td>{formatCurrency(rowTotal)}</td>
                      <td><input className={styles.tableInput} value={item.observation} onChange={(event) => updateRow(item.rowId, "observation", event.target.value)} /></td>
                      <td><button type="button" className={styles.ghostButton} onClick={() => removeRow(item.rowId)}>Remover</button></td>
                    </tr>
                  );
                }) : <tr><td colSpan={9} className={styles.emptyRow}>Nenhuma atividade adicionada.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className={styles.summaryBar}><div><span>Itens</span><strong>{form.items.length}</strong></div><div><span>Valor total</span><strong>{formatCurrency(totalAmount)}</strong></div></div>
          <div className={styles.actions}>
            <button type="submit" form="measurement-order-form" className={styles.primaryButton} disabled={isSubmitting}>
              {isSubmitting ? "Salvando..." : form.id ? "Salvar alteracoes" : "Salvar ordem"}
            </button>
            <button type="button" className={styles.secondaryButton} onClick={openMassImportModal}>
              Cadastro em massa
            </button>
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
          <label className={styles.field}><span>Status</span><select value={filterDraft.status} onChange={(event) => setFilterDraft((current) => ({ ...current, status: event.target.value as Filters["status"] }))}><option value="TODOS">Todos</option><option value="ABERTA">Aberta</option><option value="FECHADA">Fechada</option><option value="CANCELADA">Cancelada</option></select></label>
          <label className={styles.field}>
            <span>Programacao</span>
            <select value={filterDraft.programmingMatch} onChange={(event) => setFilterDraft((current) => ({ ...current, programmingMatch: event.target.value as Filters["programmingMatch"] }))}>
              <option value="TODOS">Todos</option>
              <option value="PROGRAMADA">Programada</option>
              <option value="NAO_PROGRAMADA">Nao programada</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Alerta Concluido/Parcial</span>
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
              disabled={isExporting || isExportingDetails || isLoadingOrders || !orders.length}
            >
              {isExporting ? "Exportando..." : "Exportar Excel (CSV)"}
            </button>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => void exportOrdersDetailedCsv()}
              disabled={isExportingDetails || isExporting || isLoadingOrders || !orders.length}
            >
              {isExportingDetails ? "Gerando..." : "Detalhamento (CSV)"}
            </button>
          </div>
        </div>
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead><tr><th>Ordem</th><th>Projeto</th><th>Data execucao</th><th>Equipe</th><th>Encarregado</th><th>Programacao</th><th>Status execucao</th><th>Itens</th><th>Valor total</th><th>Status</th><th>Atualizado em</th><th>Acoes</th></tr></thead>
            <tbody>
              {orders.length ? orders.map((order) => (
                <tr key={order.id} className={order.status === "CANCELADA" ? styles.inactiveRow : ""}>
                  <td>{order.orderNumber}</td>
                  <td>{order.projectCode}</td>
                  <td>{formatDate(order.executionDate)}</td>
                  <td>{order.teamName}</td>
                  <td>{order.foremanName || "-"}</td>
                  <td>{programmingMatchLabel(order.programmingMatchStatus)}</td>
                  <td>
                    {order.programmingCompletionStatus ?? "-"}
                    {order.programmingCompletionStatusChangedAfterMeasurement ? <span className={styles.statusTagDanger}>Atualizado apos medicao</span> : null}
                  </td>
                  <td>{order.itemCount}</td>
                  <td>{formatCurrency(order.totalAmount)}</td>
                  <td><span className={order.status === "CANCELADA" ? styles.statusTagDanger : styles.statusTag}>{order.status}</span></td>
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
                        disabled={order.status === "CANCELADA"}
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
                        disabled={order.status !== "ABERTA" || isChangingStatus}
                        onClick={() => void submitStatusChange(order, "FECHAR")}
                        aria-label={`Fechar ordem ${order.orderNumber}`}
                        title="Fechar"
                      >
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" />
                          <path
                            d="m8.5 12 2.2 2.2 4.8-4.8"
                            stroke="currentColor"
                            strokeWidth="1.7"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              )) : <tr><td colSpan={12} className={styles.emptyRow}>{isLoadingOrders ? "Carregando ordens..." : "Nenhuma ordem encontrada."}</td></tr>}
            </tbody>
          </table>
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
                <div><strong>Equipe:</strong> {teamMap.get(detailOrder.teamId)?.name ?? "-"}</div>
                <div><strong>Encarregado:</strong> {teamMap.get(detailOrder.teamId)?.foremanName ?? "-"}</div>
                <div><strong>Data execucao:</strong> {formatDate(detailOrder.executionDate)}</div>
                <div><strong>Programacao:</strong> {programmingMatchLabel(detailOrder.programmingMatchStatus)}</div>
                <div><strong>Status execucao:</strong> {detailOrder.programmingCompletionStatus ?? "-"}</div>
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
                  <thead><tr><th>Codigo</th><th>Descricao</th><th>Unidade</th><th>Pontos</th><th>Quantidade</th><th>Valor unitario</th><th>Total</th><th>Observacao</th></tr></thead>
                  <tbody>
                    {detailOrder.items.length ? detailOrder.items.map((item) => (
                      <tr key={item.id}>
                        <td>{item.code}</td>
                        <td>{item.description}</td>
                        <td>{item.unit}</td>
                        <td>{item.voicePoint.toLocaleString("pt-BR")}</td>
                        <td>{item.quantity.toLocaleString("pt-BR")}</td>
                        <td>{formatCurrency(item.unitValue)}</td>
                        <td>{formatCurrency(item.voicePoint * item.quantity * detailOrder.manualRate * item.unitValue)}</td>
                        <td>{item.observation || "-"}</td>
                      </tr>
                    )) : <tr><td colSpan={8} className={styles.emptyRow}>Nenhum item encontrado.</td></tr>}
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
        <div className={styles.modalOverlay} onClick={closeCancelModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Cancelar Ordem de Medicao</h4>
                <p className={styles.modalSubtitle}>Ordem {statusOrder.orderNumber} sera cancelada.</p>
              </div>
            </header>

            <div className={styles.modalBody}>
              <label className={styles.field}>
                <span>Motivo do cancelamento <span className="requiredMark">*</span></span>
                <textarea
                  rows={4}
                  value={statusReason}
                  onChange={(event) => setStatusReason(event.target.value)}
                  placeholder="Descreva o motivo do cancelamento (minimo 10 caracteres)"
                />
              </label>

              <div className={styles.actions}>
                <button type="button" className={styles.ghostButton} onClick={closeCancelModal} disabled={isChangingStatus}>
                  Voltar
                </button>
                <button type="button" className={styles.dangerButton} onClick={() => void confirmCancelStatus()} disabled={!canSubmitCancelStatus}>
                  {isChangingStatus ? "Cancelando..." : "Confirmar cancelamento"}
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
                    <p>Colunas obrigatorias: projeto, data, equipe, voz, quantidade.</p>
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

