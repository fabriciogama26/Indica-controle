import type { BillingFilters, BillingFormState } from "./types";

export const BILLING_PAGE_SIZE = 20;
export const HISTORY_PAGE_SIZE = 5;

export const INITIAL_FORM: BillingFormState = {
  id: null,
  expectedUpdatedAt: null,
  projectId: "",
  projectSearch: "",
  billingKind: "COM_PRODUCAO",
  noProductionReasonId: "",
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
] as const;

export const HISTORY_FIELD_LABELS: Record<string, string> = {
  projectId: "Projeto",
  billingKind: "Tipo de faturamento",
  noProductionReasonId: "Motivo sem producao",
  notes: "Observacao",
  items: "Itens",
  itemCount: "Quantidade de itens",
  totalAmount: "Valor total",
  status: "Status",
};
