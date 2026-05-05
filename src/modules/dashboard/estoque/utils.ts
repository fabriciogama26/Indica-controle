import { CurrentStockFilters } from "./types";

export function normalizeText(value: string | null | undefined) {
  return String(value ?? "").trim();
}

export function formatDateTime(value: string | null) {
  if (!value) return "-";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("pt-BR");
}

export function formatInteger(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatDecimal(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(value);
}

export function formatSignedDecimal(value: number) {
  const formatted = formatDecimal(Math.abs(value));
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

export function buildCurrentStockQuery(
  filters: CurrentStockFilters,
  page: number,
  pageSize: number,
) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  params.set("onlyPositive", filters.onlyPositive);

  if (filters.stockCenterId) params.set("stockCenterId", filters.stockCenterId);
  if (filters.materialCode) params.set("materialCode", filters.materialCode);
  if (filters.description) params.set("description", filters.description);
  if (filters.qtyMin) params.set("qtyMin", filters.qtyMin);
  if (filters.qtyMax) params.set("qtyMax", filters.qtyMax);

  return params.toString();
}

export function csvEscape(value: string | number | null | undefined) {
  const normalized = String(value ?? "").replace(/\r?\n|\r/g, " ").trim();
  if (normalized.includes(";") || normalized.includes("\"")) {
    return `"${normalized.replace(/"/g, "\"\"")}"`;
  }

  return normalized;
}

export function downloadCsvFile(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  anchor.click();

  URL.revokeObjectURL(url);
}

export function toIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
