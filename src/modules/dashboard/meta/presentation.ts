// Tipos, constantes e helpers puros da tela Meta.
//
// Extraidos de `MetaPageView.tsx` quando a tela ganhou o seletor de tipo
// operacional (TECNICA/COMERCIAL). Nao ha React aqui: `scrollDashboardContentToTop`
// ficou no PageView de proposito, porque mexe em DOM.
import { escapeCsvValue } from "@/lib/utils/csv";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils/formatters";

export type TeamTypeTarget = {
  id: string;
  name: string;
  dailyValue: number;
  activeTeamCount: number;
  targetId: string | null;
  updatedAt: string | null;
};

export type CycleOption = {
  id: string | null;
  cycleStart: string;
  cycleEnd: string;
  label: string;
  defaultWorkdays: number;
  workedDays: number;
  workdays: number;
  notes: string;
  updatedAt: string | null;
  isEdited: boolean;
  targets?: Array<{
    teamTypeId: string;
    dailyValue: number;
    measuredTeamCount: number;
  }>;
};

export type MetaRegistration = {
  id: string;
  cycleStart: string;
  cycleEnd: string;
  label: string;
  workdays: number;
  defaultWorkdays: number;
  workedDays: number;
  notes: string;
  updatedAt: string | null;
  targetCount: number;
  totalActiveTeams: number;
  totalMeasuredTeams: number;
  totalDailyGoal: number;
  totalCycleGoal: number;
  totalStandardCycleGoal: number;
  totalWorkedCycleGoal: number;
};

export type MetaDetailItem = {
  id: string;
  teamTypeId: string;
  teamTypeName: string;
  dailyValue: number;
  activeTeamCount: number;
  measuredTeamCount: number;
  dailyGoal: number;
  cycleGoal: number;
  standardCycleGoal: number;
  workedCycleGoal: number;
  updatedAt: string;
};

export type MetaDetail = MetaRegistration & {
  items: MetaDetailItem[];
};

export type MetaHistoryEntry = {
  id: string;
  actionType: "CREATE" | "UPDATE";
  reason: string;
  changes: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
  createdByName: string;
};

// Tipo operacional em foco (TECNICA/COMERCIAL). Cada um tem seus tipos de
// equipe, seu ciclo e sua meta -- ver migrations 416 e 417.
export type TeamCategoryOption = {
  id: string;
  code: string;
  name: string;
};

export type MetaResponse = {
  teamCategories?: TeamCategoryOption[];
  teamCategory?: TeamCategoryOption;
  teamTypes?: TeamTypeTarget[];
  cycles?: CycleOption[];
  registrations?: MetaRegistration[];
  message?: string;
};

export type MetaDetailResponse = {
  detail?: MetaDetail;
  message?: string;
};

export type MetaHistoryResponse = {
  history?: MetaHistoryEntry[];
  message?: string;
};

export type SaveResponse = {
  success?: boolean;
  message?: string;
};

export const HISTORY_PAGE_SIZE = 5;
export const META_HISTORY_FIELD_LABELS: Record<string, string> = {
  cycleStart: "Inicio do ciclo",
  cycleEnd: "Fim do ciclo",
  workdays: "Dias uteis",
  defaultWorkdays: "Dias padrao segunda a sexta",
  workedDays: "Média Dias trabalhados",
  notes: "Observacao",
  totalMeasuredTeams: "Equipes medida",
  totalDailyGoal: "Meta diaria",
  totalCycleGoal: "Meta ciclo",
  totalStandardCycleGoal: "Meta ciclo padrao",
  totalWorkedCycleGoal: "Meta ciclo trabalhado",
};

export function buildRegistrationsCsv(registrations: MetaRegistration[]) {
  const header = [
    "Ciclo",
    "Dias uteis",
    "Dias padrao",
    "Média Dias trabalhados",
    "Equipes ativas",
    "Equipes medida",
    "Meta diaria",
    "Meta ciclo",
    "Meta ciclo padrao",
    "Meta ciclo trabalhado",
    "Atualizado em",
  ];
  const rows = registrations.map((registration) => [
    registration.label,
    registration.workdays,
    registration.defaultWorkdays,
    registration.workedDays,
    registration.totalActiveTeams,
    registration.totalMeasuredTeams,
    formatCurrency(registration.totalDailyGoal),
    formatCurrency(registration.totalCycleGoal),
    formatCurrency(registration.totalStandardCycleGoal),
    formatCurrency(registration.totalWorkedCycleGoal),
    formatDateTime(registration.updatedAt),
  ]);
  const csvLines = [header, ...rows].map((line) => line.map((item) => escapeCsvValue(item)).join(";"));
  return `\uFEFF${csvLines.join("\n")}\n`;
}

export function formatInputMoney(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function normalizeMoneyInput(value: string) {
  return value.replace(/[^\d,.]/g, "");
}

export function parseInputMoney(value: string) {
  const normalized = value.trim().replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Number(parsed.toFixed(2));
}

export function formatHistoryActionLabel(action: string) {
  const normalized = String(action ?? "").toUpperCase();
  if (normalized === "CREATE") return "Cadastro";
  if (normalized === "UPDATE") return "Edicao";
  return normalized || "Atualizacao";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function formatMetaHistoryValue(field: string, value: unknown) {
  if (value === null || value === undefined) return "-";

  if (field === "cycleStart" || field === "cycleEnd") {
    return formatDate(String(value));
  }

  if (
    field === "totalDailyGoal"
    || field === "totalCycleGoal"
    || field === "totalStandardCycleGoal"
    || field === "totalWorkedCycleGoal"
  ) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? formatCurrency(parsed) : "-";
  }

  const normalized = String(value).trim();
  return normalized || "-";
}

export function resolveMetaHistoryChanges(entry: MetaHistoryEntry) {
  const from = isRecord(entry.changes.from) ? entry.changes.from : {};
  const to = isRecord(entry.changes.to) ? entry.changes.to : {};
  const fields = Array.from(new Set([...Object.keys(from), ...Object.keys(to)]))
    .filter((field) => META_HISTORY_FIELD_LABELS[field]);

  return fields.map((field) => ({
    field,
    label: META_HISTORY_FIELD_LABELS[field],
    from: from[field],
    to: to[field],
  }));
}

export function isCycleCurrent(cycle: CycleOption) {
  const today = new Date();
  const start = new Date(`${cycle.cycleStart}T00:00:00`);
  const end = new Date(`${cycle.cycleEnd}T23:59:59`);
  return today >= start && today <= end;
}
