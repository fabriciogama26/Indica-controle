import type { DocumentKey } from "./types";

export const PAGE_SIZE = 20;
export const HISTORY_PAGE_SIZE = 5;
export const DEADLINE_CAROUSEL_PAGE_SIZE = 6;
export const DEADLINE_WINDOW_SHORT_DAYS = 15;
export const DEADLINE_WINDOW_LONG_DAYS = 30;

export const DOCUMENT_KEYS: Array<{ key: DocumentKey; label: string }> = [
  { key: "sgd", label: "SGD" },
  { key: "pi", label: "PI" },
  { key: "pep", label: "PEP" },
];

export const HISTORY_FIELD_LABELS: Record<string, string> = {
  project: "Projeto",
  team: "Equipe",
  executionDate: "Data execucao",
  period: "Periodo",
  startTime: "Hora inicio",
  endTime: "Hora termino",
  outageStartTime: "Inicio de desligamento",
  outageEndTime: "Termino de desligamento",
  expectedMinutes: "Tempo previsto",
  feeder: "Alimentador",
  support: "Apoio",
  note: "Anotacao",
  electricalField: "Nº EQ (numero)",
  serviceDescription: "Descricao do servico",
  posteQty: "POSTE",
  estruturaQty: "ESTRUTURA",
  trafoQty: "TRAFO",
  redeQty: "REDE",
  etapaNumber: "ETAPA",
  etapaUnica: "ETAPA ÚNICA",
  etapaFinal: "ETAPA FINAL",
  workCompletionStatus: "Estado Trabalho",
  affectedCustomers: "Nº Clientes Afetados",
  electricalEq: "Nº EQ",
  sgdType: "Tipo de SGD",
  sgdNumber: "SGD",
  sgdApprovedAt: "SGD Data Aprovada",
  sgdRequestedAt: "SGD Data Pedido",
  piNumber: "PI",
  piApprovedAt: "PI Data Aprovada",
  piRequestedAt: "PI Data Pedido",
  pepNumber: "PEP",
  pepApprovedAt: "PEP Data Aprovada",
  pepRequestedAt: "PEP Data Pedido",
  status: "Status",
  isActive: "Ativo",
  cancellationReason: "Motivo do cancelamento",
  canceledAt: "Data do cancelamento",
  activities: "Atividades",
};

export const HISTORY_ALLOWED_ACTIONS = new Set(["UPDATE", "RESCHEDULE", "ADIADA", "CANCELADA"]);
export const HISTORY_HIDDEN_FIELDS = new Set(["isActive", "cancellationReason", "canceledAt", "statusChangedAt"]);

export const VALIDATION_FIELD_LABELS: Record<string, string> = {
  projectId: "Projeto (SOB)",
  teamIds: "Equipes",
  date: "Data execucao",
  period: "Periodo",
  startTime: "Hora inicio",
  endTime: "Hora termino",
  outageStartTime: "Inicio de desligamento",
  outageEndTime: "Termino de desligamento",
  feeder: "Alimentador",
  electricalField: "Nº EQ (numero)",
  posteQty: "POSTE",
  estruturaQty: "ESTRUTURA",
  trafoQty: "TRAFO",
  redeQty: "REDE",
  etapaNumber: "ETAPA",
  workCompletionStatus: "Estado Trabalho",
  affectedCustomers: "Nº Clientes Afetados",
  electricalEqCatalogId: "Nº EQ",
  sgdTypeId: "Tipo de SGD",
  changeReason: "Motivo da reprogramacao",
};
