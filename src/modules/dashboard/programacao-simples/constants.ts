import type { DocumentKey, ProgrammingStatus } from "./types";

// =============================================================================
// CORTE: Programacao Simples em SOMENTE LEITURA
// =============================================================================
// A tela continua ACESSIVEL para pesquisa: filtros, listagem, detalhes,
// historico e as tres extracoes (CSV, ENEL, ENEL NOVO) seguem funcionando. O que
// sai do ar e a ESCRITA — cadastro, edicao, copia, equipe, adiar, reprogramar,
// cancelar e lancamento de Estado do Trabalho.
//
// Esta constante controla apenas a INTERFACE. A barreira real e de servidor,
// em `PROGRAMMING_SIMPLES_READ_ONLY` (src/server/modules/programacao/handlers.ts):
// mesmo uma chamada direta a API e recusada com 423. As duas precisam andar
// juntas — desligar so esta aqui deixaria botao que sempre falha; desligar so a
// do servidor deixaria a API aberta.
//
// PARA REABRIR A ESCRITA: trocar esta para `false` E a do servidor.
export const PROGRAMACAO_SIMPLES_SOMENTE_LEITURA = true;

export const PROGRAMACAO_SIMPLES_SOMENTE_LEITURA_AVISO =
  "Somente leitura: esta tela foi congelada e nao aceita mais lancamentos. "
  + "Consulta, filtros, detalhes, historico e extracoes continuam disponiveis. "
  + "Para cadastrar ou alterar programacao, use a tela Programacao (Normalizada).";

export const PAGE_SIZE = 20;
export const HISTORY_PAGE_SIZE = 5;
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

export const HISTORY_ALLOWED_ACTIONS = new Set(["UPDATE", "RESCHEDULE", "ADIADA", "CANCELADA", "ADD_TEAM", "TRANSFER_TEAM"]);
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

export const ENEL_NOVO_OPERATIONAL_STATUS_LABELS: Record<ProgrammingStatus, string> = {
  PROGRAMADA: "PROGRAMADO",
  REPROGRAMADA: "REPROGRAMADO",
  ADIADA: "ADIADO",
  CANCELADA: "CANCELADO",
  ANTECIPADA: "ANTECIPADA",
  TRANSFERIDA: "TRANSFERIDA",
};
