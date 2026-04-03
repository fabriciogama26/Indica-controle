import { CurrentStockFilters } from "./types";

export const PAGE_SIZE = 20;
export const EXPORT_PAGE_SIZE = 200;
export const EXPORT_COOLDOWN_MS = 10_000;
export const HISTORY_PAGE_SIZE = 5;

export const INITIAL_FILTERS: CurrentStockFilters = {
  stockCenterId: "",
  materialCode: "",
  description: "",
  qtyMin: "",
  qtyMax: "",
  onlyPositive: "SIM",
};
