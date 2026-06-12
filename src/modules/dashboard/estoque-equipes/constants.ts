import type { TeamStockFilters } from "./types";

export const PAGE_SIZE = 20;
export const EXPORT_PAGE_SIZE = 100;
export const HISTORY_PAGE_SIZE = 5;
export const EXPORT_COOLDOWN_MS = 10_000;

export const INITIAL_FILTERS: TeamStockFilters = {
  teamId: "",
  foreman: "",
  serviceCenter: "",
  materialCode: "",
  description: "",
  materialType: "",
  unit: "",
  teamStatus: "ATIVAS",
  qtyMin: "",
  qtyMax: "",
  includeZero: false,
};
