import type { BillingFilters, BillingFormState } from "./types";
import { DEFAULT_PAGE_SIZE, DEFAULT_HISTORY_PAGE_SIZE } from "@/lib/constants/pagination";

export const BILLING_PAGE_SIZE = DEFAULT_PAGE_SIZE;
export const HISTORY_PAGE_SIZE = DEFAULT_HISTORY_PAGE_SIZE;

export const INITIAL_FORM: BillingFormState = {
  id: null,
  expectedUpdatedAt: null,
  projectId: "",
  projectSearch: "",
  billingKind: "COM_PRODUCAO",
  noProductionReasonId: "",
  ingressoDate: "",
  notes: "",
  activitySearch: "",
  quantity: "",
  rate: "",
  itemObservation: "",
  items: [],
};

export const INITIAL_FILTERS: BillingFilters = {
  projectId: "",
  projectSearch: "",
  status: "TODOS",
  billingKind: "TODOS",
  noProductionReasonId: "",
};

export const IMPORT_TEMPLATE_HEADERS = [
  "projeto",
  "tipo_faturamento",
  "motivo_sem_producao",
  "codigo_atividade",
  "quantidade",
  "taxa",
  "observacao",
  "data_ingresso",
] as const;

export const HISTORY_FIELD_LABELS: Record<string, string> = {
  projectId: "Projeto",
  billingKind: "Tipo de faturamento",
  noProductionReasonId: "Motivo sem producao",
  ingressoDate: "Data Ingresso",
  notes: "Observacao",
  items: "Itens",
  itemCount: "Quantidade de itens",
  totalAmount: "Valor total",
  status: "Status",
};
