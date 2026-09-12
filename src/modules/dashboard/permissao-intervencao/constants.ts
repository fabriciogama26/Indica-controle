import type { PiCreationSource, PiLinkStatus, PiListFilterState, PiStatus } from "./types";

export const PI_STATUS_LABELS: Record<PiStatus, string> = {
  DRAFT: "Rascunho",
  READY: "Pronta",
  ISSUED: "Emitida",
  CANCELLED: "Cancelada",
};

export const PI_LINK_STATUS_LABELS: Record<PiLinkStatus, string> = {
  LINKED: "Vinculada",
  PENDING: "Pendente",
  ATTENTION: "Atencao",
};

export const PI_CREATION_SOURCE_LABELS: Record<PiCreationSource, string> = {
  FROM_PROGRAMMING: "Com Programacao",
  MANUAL: "Sem Programacao",
};

export const EMPTY_PI_FILTERS: PiListFilterState = {
  search: "",
  status: "",
  linkStatus: "",
  operationArea: "",
  voltageLevel: "",
  dateFrom: "",
  dateTo: "",
};

export const PI_PAGE_SIZE = 20;
