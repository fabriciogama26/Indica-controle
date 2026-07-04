import type { TeamStockFilters } from "./types";

export function buildTeamStockQuery(filters: TeamStockFilters, page: number, pageSize: number) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    teamStatus: filters.teamStatus,
    includeZero: filters.includeZero ? "1" : "0",
  });

  if (filters.teamId) params.set("teamId", filters.teamId);
  if (filters.foreman) params.set("foreman", filters.foreman);
  if (filters.serviceCenter) params.set("serviceCenter", filters.serviceCenter);
  if (filters.materialCode) params.set("materialCode", filters.materialCode);
  if (filters.description) params.set("description", filters.description);
  if (filters.materialType) params.set("materialType", filters.materialType);
  if (filters.unit) params.set("unit", filters.unit);
  if (filters.qtyMin) params.set("qtyMin", filters.qtyMin);
  if (filters.qtyMax) params.set("qtyMax", filters.qtyMax);

  return params.toString();
}

export function formatDecimal(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(value);
}

export function formatSignedDecimal(value: number) {
  const formatted = formatDecimal(Math.abs(value));
  return value > 0 ? `+${formatted}` : value < 0 ? `-${formatted}` : formatted;
}

export function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("pt-BR");
}

export { buildCsvContent, downloadCsvFile } from "@/lib/utils/csv";
