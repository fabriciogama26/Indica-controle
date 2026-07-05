import type { TeamStockFilters } from "./types";
import { DEFAULT_PAGE_SIZE, DEFAULT_EXPORT_PAGE_SIZE, DEFAULT_HISTORY_PAGE_SIZE } from "@/lib/constants/pagination";

export const PAGE_SIZE = DEFAULT_PAGE_SIZE;
export const EXPORT_PAGE_SIZE = DEFAULT_EXPORT_PAGE_SIZE;
export const HISTORY_PAGE_SIZE = DEFAULT_HISTORY_PAGE_SIZE;
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
