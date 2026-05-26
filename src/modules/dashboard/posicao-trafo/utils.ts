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
  params.set("serialTrackingType", filters.serialTrackingType);
  params.set("lastOperationKind", filters.lastOperationKind);

  if (filters.stockCenterId) params.set("stockCenterId", filters.stockCenterId);
  if (filters.materialType) params.set("materialType", filters.materialType);
  if (filters.materialCode) params.set("materialCode", filters.materialCode);
  if (filters.description) params.set("description", filters.description);
  if (filters.serialNumber) params.set("serialNumber", filters.serialNumber);
  if (filters.lotCode) params.set("lotCode", filters.lotCode);
  if (filters.projectCode) params.set("projectCode", filters.projectCode);
  if (filters.teamName) params.set("teamName", filters.teamName);
  if (filters.foremanName) params.set("foremanName", filters.foremanName);
  if (filters.entryDateFrom) params.set("entryDateFrom", filters.entryDateFrom);
  if (filters.entryDateTo) params.set("entryDateTo", filters.entryDateTo);

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
