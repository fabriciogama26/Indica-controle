import type { AsbuiltMeasurementFilters, AsbuiltMeasurementFormState } from "./types";
import { DEFAULT_PAGE_SIZE, DEFAULT_HISTORY_PAGE_SIZE } from "@/lib/constants/pagination";

export const ASBUILT_MEASUREMENT_PAGE_SIZE = DEFAULT_PAGE_SIZE;
export const HISTORY_PAGE_SIZE = DEFAULT_HISTORY_PAGE_SIZE;

export const INITIAL_FORM: AsbuiltMeasurementFormState = {
  id: null,
  expectedUpdatedAt: null,
  projectId: "",
  projectSearch: "",
  serviceCoverageEndDate: "",
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
  "servicos_considerados_ate",
  "tipo_medicao_asbuilt",
  "motivo_sem_producao",
  "codigo_atividade",
  "quantidade",
  "taxa",
  "observacao",
] as const;

export const HISTORY_FIELD_LABELS: Record<string, string> = {
  projectId: "Projeto",
  serviceCoverageEndDate: "Servicos considerados ate",
  asbuiltMeasurementKind: "Tipo de medicao-asbuilt",
  noProductionReasonId: "Motivo sem producao",
  notes: "Observacao",
  items: "Itens",
  itemCount: "Quantidade de itens",
  totalAmount: "Valor total",
  status: "Status",
};

