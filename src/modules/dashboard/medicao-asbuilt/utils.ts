import type { AsbuiltMeasurementKind, AsbuiltMeasurementStatus } from "./types";

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

export function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const [year, month, day] = value.slice(0, 10).split("-");
  if (!year || !month || !day) return "-";
  return `${day}/${month}/${year}`;
}

export function parseDateInput(value: unknown) {
  const normalized = normalizeText(value);
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  const brMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(normalized);
  const parts = isoMatch
    ? { year: isoMatch[1], month: isoMatch[2], day: isoMatch[3] }
    : brMatch
      ? { year: brMatch[3], month: brMatch[2], day: brMatch[1] }
      : null;

  if (!parts) return null;

  const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  if (
    date.getUTCFullYear() !== Number(parts.year)
    || date.getUTCMonth() + 1 !== Number(parts.month)
    || date.getUTCDate() !== Number(parts.day)
  ) {
    return null;
  }

  return `${parts.year}-${parts.month}-${parts.day}`;
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

export function asbuiltMeasurementKindLabel(value: AsbuiltMeasurementKind | string | null | undefined) {
  return value === "SEM_PRODUCAO" ? "Sem producao" : "Com producao";
}

export function asbuiltMeasurementStatusLabel(value: AsbuiltMeasurementStatus | string | null | undefined) {
  if (value === "FECHADA") return "Fechada";
  if (value === "CANCELADA") return "Cancelada";
  return "Aberta";
}

export function normalizeAsbuiltMeasurementKind(value: unknown): AsbuiltMeasurementKind {
  const token = normalizeHeaderName(value).toUpperCase();
  if (token === "SEMPRODUCAO" || token === "SEM_PRODUCAO") {
    return "SEM_PRODUCAO";
  }
  return "COM_PRODUCAO";
}

export function parseCsvContent(content: string) {
  const normalized = content.replace(/^\uFEFF/, "");
  const lines = normalized.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (!lines.length) return [];

  const delimiter = lines[0].includes(";") ? ";" : ",";
  return lines.map((line) => parseDelimitedLine(line, delimiter));
}

function parseDelimitedLine(line: string, delimiter: ";" | ",") {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === "\"" && inQuotes && next === "\"") {
      current += "\"";
      index += 1;
      continue;
    }

    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
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

