import { TrafoPositionFilters } from "./types";

export function normalizeText(value: string | null | undefined) {
  return String(value ?? "").trim();
}

export function formatDate(value: string | null) {
  if (!value) return "-";

  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString("pt-BR");
}

export function formatDateTime(value: string | null) {
  if (!value) return "-";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("pt-BR");
}

export function buildTrafoPositionQuery(filters: TrafoPositionFilters, page: number, pageSize: number) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  params.set("currentStatus", filters.currentStatus);

  if (filters.stockCenterId) params.set("stockCenterId", filters.stockCenterId);
  if (filters.materialCode) params.set("materialCode", filters.materialCode);
  if (filters.serialNumber) params.set("serialNumber", filters.serialNumber);
  if (filters.lotCode) params.set("lotCode", filters.lotCode);

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
