import type { AsbuiltMeasurementFilters, AsbuiltMeasurementFormState } from "./types";

export const ASBUILT_MEASUREMENT_PAGE_SIZE = 20;
export const HISTORY_PAGE_SIZE = 5;

export const INITIAL_FORM: AsbuiltMeasurementFormState = {
  id: null,
  expectedUpdatedAt: null,
  projectId: "",
  projectSearch: "",
  asbuiltMeasurementKind: "COM_PRODUCAO",
  noProductionReasonId: "",
  notes: "",
  activitySearch: "",
  quantity: "",
  rate: "",
  itemObservation: "",
  items: [],
};

export const INITIAL_FILTERS: AsbuiltMeasurementFilters = {
  projectId: "",
  projectSearch: "",
  status: "TODOS",
  asbuiltMeasurementKind: "TODOS",
  noProductionReasonId: "",
};

export const IMPORT_TEMPLATE_HEADERS = [
  "projeto",
  "tipo_medicao_asbuilt",
  "motivo_sem_producao",
  "codigo_atividade",
  "quantidade",
  "taxa",
  "observacao",
] as const;

export const HISTORY_FIELD_LABELS: Record<string, string> = {
  projectId: "Projeto",
  asbuiltMeasurementKind: "Tipo de medicao-asbuilt",
  noProductionReasonId: "Motivo sem producao",
  notes: "Observacao",
  items: "Itens",
  itemCount: "Quantidade de itens",
  totalAmount: "Valor total",
  status: "Status",
};

