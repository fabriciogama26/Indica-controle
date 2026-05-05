import type {
  MassImportErrorReportData,
  MassImportIssue,
  TeamOperationKind,
  TeamOperationListItem,
} from "./types";

export function normalizeText(value: string | null | undefined) {
  return String(value ?? "").trim();
}

export function normalizeCode(value: string) {
  return normalizeText(value).toUpperCase();
}

export function normalizeMaterialEntryType(value: string) {
  const normalized = normalizeCode(value);
  if (normalized === "SUCATA" || normalized === "NOVO") {
    return normalized;
  }
  return "";
}

export function normalizeTeamOperationKind(value: unknown) {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (normalized === "REQUISITION" || normalized === "REQUISICAO") return "REQUISITION" as const;
  if (normalized === "RETURN" || normalized === "DEVOLUCAO") return "RETURN" as const;
  if (
    normalized === "FIELD_RETURN"
    || normalized === "RETORNO_DE_CAMPO"
    || normalized === "RETORNO_CAMPO"
    || normalized === "RETORNO DE CAMPO"
  ) return "FIELD_RETURN" as const;
  return null;
}

export function operationKindLabel(value: TeamOperationKind | string | null | undefined) {
  const normalized = normalizeTeamOperationKind(value);
  if (normalized === "REQUISITION") return "Requisicao";
  if (normalized === "RETURN") return "Devolucao";
  if (normalized === "FIELD_RETURN") return "Retorno de campo";
  return "-";
}

export function operationDateLabel(value: TeamOperationKind | string | null | undefined) {
  const normalized = normalizeTeamOperationKind(value);
  if (normalized === "REQUISITION") return "Data da requisicao";
  if (normalized === "RETURN") return "Data da devolucao";
  if (normalized === "FIELD_RETURN") return "Data do retorno de campo";
  return "Data da operacao";
}

export function rowStatusLabel(item: Pick<TeamOperationListItem, "isReversal" | "isReversed">) {
  if (item.isReversal) return "Estorno";
  if (item.isReversed) return "Estornada";
  return null;
}

export function parsePositiveNumber(value: string) {
  const normalized = normalizeText(value).replace(/\s+/g, "");
  if (!/^\d+(?:[,.]\d{1,3})?$/.test(normalized)) return null;
  const parsed = Number(normalized.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Number(parsed.toFixed(3));
}

export function formatDateTime(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("pt-BR");
}

export function formatDate(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("pt-BR");
}

export function toIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildIsoDateFromParts(year: number, month: number, day: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function normalizeDateInput(value: string | null | undefined) {
  const raw = normalizeText(value);
  if (!raw) return null;

  const normalized = raw.replace(/\s+/g, " ");
  const isoPattern = normalized.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/);
  if (isoPattern) {
    return buildIsoDateFromParts(
      Number(isoPattern[1]),
      Number(isoPattern[2]),
      Number(isoPattern[3]),
    );
  }

  const brPattern = normalized.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[T\s].*)?$/);
  if (brPattern) {
    return buildIsoDateFromParts(
      Number(brPattern[3]),
      Number(brPattern[2]),
      Number(brPattern[1]),
    );
  }

  return null;
}

export function formatHistoryActionLabel(value: string) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "CREATE") return "Cadastro";
  if (normalized === "REVERSAL") return "Estorno";
  if (normalized === "UPDATE") return "Edicao";
  return normalized || "Atualizacao";
}

export function formatHistoryValue(value: unknown) {
  if (value === null || value === undefined) return "-";
  const normalized = String(value).trim();
  return normalized || "-";
}

export function isTransformerQuantityValid(quantity: number | null) {
  if (quantity === null) return false;
  return quantity === 1;
}

export function csvEscape(value: string | number | null | undefined) {
  const raw = String(value ?? "").replace(/\r?\n|\r/g, " ").trim();
  if (raw.includes(";") || raw.includes('"')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function normalizeHeaderName(value: string) {
  return normalizeText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function parseCsvContent(content: string) {
  const normalizedContent = content.replace(/^\uFEFF/, "");
  const lines = normalizedContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return [] as Array<Record<string, string>>;
  }

  const delimiter = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(delimiter).map((header) => normalizeHeaderName(header));

  return lines.slice(1).map((line) => {
    const values = line.split(delimiter).map((item) => normalizeText(item));
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    return row;
  });
}

export function readCsvField(row: Record<string, string>, aliases: string[]) {
  for (const alias of aliases) {
    const value = normalizeText(row[alias] ?? "");
    if (value) return value;
  }
  return "";
}

export function createMassImportErrorReport(issues: MassImportIssue[], filePrefix: string) {
  if (!issues.length) return null as MassImportErrorReportData | null;

  const sorted = [...issues].sort((left, right) => {
    if (left.rowNumber !== right.rowNumber) return left.rowNumber - right.rowNumber;
    return left.column.localeCompare(right.column);
  });

  const errorRows = new Set(sorted.map((item) => item.rowNumber)).size;
  const lines = [
    "linha;coluna;valor;erro",
    ...sorted.map((issue) => [
      csvEscape(issue.rowNumber),
      csvEscape(issue.column),
      csvEscape(issue.value),
      csvEscape(issue.error),
    ].join(";")),
  ];

  return {
    fileName: `${filePrefix}_${toIsoDate(new Date())}.csv`,
    content: `\uFEFF${lines.join("\n")}\n`,
    errorRows,
    totalIssues: sorted.length,
  };
}

export function downloadMassImportErrorReport(report: MassImportErrorReportData | null) {
  if (!report) return;
  downloadCsv(report.content, report.fileName);
}
