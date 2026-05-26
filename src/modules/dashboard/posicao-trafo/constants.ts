import { TrafoPositionFilters } from "./types";

export const PAGE_SIZE = 20;
export const EXPORT_PAGE_SIZE = 100;
export const EXPORT_COOLDOWN_MS = 10_000;
export const HISTORY_PAGE_SIZE = 5;

export const INITIAL_FILTERS: TrafoPositionFilters = {
  stockCenterId: "",
  serialTrackingType: "TODOS",
  materialType: "",
  materialCode: "",
  description: "",
  serialNumber: "",
  lotCode: "",
  projectCode: "",
  teamName: "",
  foremanName: "",
  currentStatus: "TODOS",
  lastOperationKind: "TODOS",
  entryDateFrom: "",
  entryDateTo: "",
};
