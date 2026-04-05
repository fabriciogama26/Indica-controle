import type { FilterState, FormState } from "./types";

export const HISTORY_PAGE_SIZE = 15;
export const HISTORY_EXPORT_PAGE_SIZE = 100;

export const HISTORY_FIELD_LABELS: Record<string, string> = {
  operationKind: "Operacao",
  teamName: "Equipe",
  foremanName: "Encarregado",
  fromStockCenterId: "Centro de estoque",
  toStockCenterId: "Centro da equipe",
  originalTransferId: "Transferencia original",
  reversalTransferId: "Transferencia de estorno",
  projectId: "Projeto",
  projectCode: "Projeto",
  materialCode: "Material (codigo)",
  description: "Descricao",
  reversalReasonCode: "Motivo padrao do estorno",
  reversalReasonNotes: "Observacao do motivo",
  quantity: "Quantidade",
  serialNumber: "Serial",
  lotCode: "LP",
  entryDate: "Data da operacao",
  entryType: "Tipo",
  reversalReason: "Motivo do estorno",
  notes: "Observacao",
};

export const IMPORT_TEMPLATE_HEADERS = [
  "operacao",
  "centro_estoque",
  "equipe",
  "projeto",
  "material_codigo",
  "quantidade",
  "serial",
  "lp",
  "data_operacao",
  "observacao",
] as const;

export const INITIAL_FORM: FormState = {
  operationKind: "REQUISITION",
  stockCenterId: "",
  teamId: "",
  teamName: "",
  foremanName: "",
  projectCode: "",
  projectId: "",
  materialCode: "",
  materialId: "",
  description: "",
  quantity: "",
  serialNumber: "",
  lotCode: "",
  entryDate: new Date().toISOString().slice(0, 10),
  entryType: "",
  notes: "",
  items: [],
};

export const INITIAL_FILTERS: FilterState = {
  startDate: "",
  endDate: "",
  operationKind: "TODOS",
  teamId: "",
  projectCode: "",
  materialCode: "",
  entryType: "TODOS",
  reversalStatus: "TODOS",
};
