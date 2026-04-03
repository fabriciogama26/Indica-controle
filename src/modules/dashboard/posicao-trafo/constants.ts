import { TrafoPositionFilters } from "./types";

export const PAGE_SIZE = 20;
export const EXPORT_PAGE_SIZE = 200;
export const EXPORT_COOLDOWN_MS = 10_000;

export const INITIAL_FILTERS: TrafoPositionFilters = {
  stockCenterId: "",
  materialCode: "",
  serialNumber: "",
  lotCode: "",
  currentStatus: "TODOS",
};
