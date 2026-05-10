import type { BillingKind, BillingStatus } from "./types";

export function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

export function normalizeSearchText(value: unknown) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function normalizeHeaderName(value: unknown) {
  return normalizeSearchText(value).replace(/[^a-z0-9]/g, "");
}

export function normalizeCodeToken(value: unknown) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export function toIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parsePositiveDecimal(value: unknown) {
  const normalized = normalizeDecimalText(value);
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Number(parsed.toFixed(6));
}

function normalizeDecimalText(value: unknown) {
  const raw = normalizeText(value).replace(/\s/g, "");
  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    return raw.split(thousandsSeparator).join("").replace(decimalSeparator, ".");
  }

  if (lastComma >= 0) {
    return raw.replace(/\./g, "").replace(",", ".");
  }

  return raw.replace(/,/g, "");
}

export function formatDecimal(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(value);
}

export function billingKindLabel(value: BillingKind | string | null | undefined) {
  return value === "SEM_PRODUCAO" ? "Sem producao" : "Com producao";
}

export function billingStatusLabel(value: BillingStatus | string | null | undefined) {
  if (value === "FECHADA") return "Fechada";
  if (value === "CANCELADA") return "Cancelada";
  return "Aberta";
}

export function normalizeBillingKind(value: unknown): BillingKind {
  const token = normalizeHeaderName(value).toUpperCase();
  if (token === "SEMPRODUCAO" || token === "SEM_PRODUCAO") {
    return "SEM_PRODUCAO";
  }
  return "COM_PRODUCAO";
}

export function parseCsvContent(content: string) {
  const normalized = content.replace(/^\uFEFF/, "");
  const lines = normalized.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return lines.map((line) => line.split(";").map((cell) => cell.trim()));
}

export function downloadCsv(filename: string, rows: string[][]) {
  const escapeCell = (value: string) => {
    const normalized = String(value ?? "");
    if (/[;"\r\n]/.test(normalized)) {
      return `"${normalized.replace(/"/g, '""')}"`;
    }
    return normalized;
  };
  const content = `\uFEFF${rows.map((row) => row.map(escapeCell).join(";")).join("\r\n")}`;
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function readCsvField(row: string[], headerMap: Map<string, number>, name: string) {
  const index = headerMap.get(normalizeHeaderName(name));
  if (index === undefined) {
    return "";
  }
  return normalizeText(row[index]);
}
