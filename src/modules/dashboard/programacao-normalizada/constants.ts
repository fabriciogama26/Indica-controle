import { addDaysIso, getFirstDayOfMonthIso, startOfWeekMondayIso } from "./utils";
import type { DocumentFormKey, FormState, StageListFilters, StageListStatusChip } from "./types";

export const DOCUMENT_KEYS: Array<{ key: DocumentFormKey; label: string }> = [
  { key: "sgd", label: "SGD" },
  { key: "pi", label: "PI" },
  { key: "pep", label: "PEP" },
];

export const PROJECT_SEARCH_DEBOUNCE_MS = 300;
export const LIST_SEARCH_DEBOUNCE_MS = 300;
export const HISTORY_PAGE_SIZE = 5;
export const STAGE_LIST_PAGE_SIZE = 50;

export const STATUS_CHIP_OPTIONS: Array<{ value: StageListStatusChip; label: string }> = [
  { value: "TODAS", label: "Todas" },
  { value: "PROGRAMADAS", label: "Programadas" },
  { value: "PENDENCIAS", label: "Pendencias abertas" },
  { value: "ATRASADAS", label: "Atrasadas" },
  { value: "ADIADAS", label: "Adiadas" },
  // "Em espera" = ADIADA sem data (Adiar > Deixar em espera). Ignora o filtro de
  // periodo de proposito: essas etapas nao tem data (achado 9).
  { value: "EM_ESPERA", label: "Em espera" },
  // Interseccao operacional (migration 330): pendencia aberta + vencida + sem
  // Estado do Trabalho lancado. Tambem ignora o filtro de periodo.
  { value: "SEM_RETORNO", label: "Pendencias sem retorno" },
];

export function createDefaultListFilters(todayIso: string): StageListFilters {
  const dateFrom = getFirstDayOfMonthIso(todayIso);

  return {
    dateFrom,
    dateTo: addDaysIso(dateFrom, 90),
    statusChip: "TODAS",
    teamIds: [],
    search: "",
    municipality: "",
  };
}

export const DATE_RANGE_SHORTCUTS: Array<{ label: string; range: (todayIso: string) => { dateFrom: string; dateTo: string } }> = [
  { label: "Hoje", range: (todayIso) => ({ dateFrom: todayIso, dateTo: todayIso }) },
  {
    label: "Esta semana",
    range: (todayIso) => {
      const start = startOfWeekMondayIso(todayIso);
      return { dateFrom: start, dateTo: addDaysIso(start, 6) };
    },
  },
  {
    label: "Mes + 90 dias",
    range: (todayIso) => {
      const dateFrom = getFirstDayOfMonthIso(todayIso);
      return { dateFrom, dateTo: addDaysIso(dateFrom, 90) };
    },
  },
  {
    label: "Proximos 7 dias",
    range: (todayIso) => ({ dateFrom: todayIso, dateTo: addDaysIso(todayIso, 7) }),
  },
];

export function createInitialForm(executionDate: string): FormState {
  return {
    projectId: "",
    projectSearch: "",
    executionDate,
    isPendencia: false,
    teamIds: [],
    teamSearch: "",
    serviceDescription: "",
    period: "INTEGRAL",
    startTime: "08:00",
    endTime: "17:00",
    outageStartTime: "",
    outageEndTime: "",
    feeder: "",
    campoEletrico: "",
    affectedCustomers: "",
    sgdTypeId: "",
    electricalEqCatalogId: "",
    support: "",
    supportItemId: "",
    posteQty: "",
    estruturaQty: "",
    trafoQty: "",
    redeQty: "",
    note: "",
    activitySearch: "",
    activityQuantity: "",
    activities: [],
    documents: {
      sgd: { number: "", includedAt: "", deliveredAt: "" },
      pi: { number: "", includedAt: "", deliveredAt: "" },
      pep: { number: "", includedAt: "", deliveredAt: "" },
    },
  };
}

// Rotulo unico da flag is_pendencia (spec 4.2): pendencia deixou de ser status/
// Estado do trabalho e virou checkbox; a coluna Status exibe este selo quando a
// flag esta ligada, sobre o status de agenda gravado por baixo.
export const PENDENCIA_STATUS_LABEL = "Pendencia";

export const STAGE_STATUS_LABELS: Record<string, string> = {
  PROGRAMADA: "Programada",
  REPROGRAMADA: "Reprogramada",
  ADIADA: "Adiada",
  CANCELADA: "Cancelada",
  ANTECIPADA: "Antecipada",
};

export const WORK_COMPLETION_LABELS: Record<string, string> = {
  PARCIAL_PLANEJADO: "Parcial planejado",
  PARCIAL_NAO_PLANEJADO: "Parcial nao planejado",
  BENEFICIO_ATINGIDO: "Beneficio atingido",
  CONCLUIDO: "Concluido",
  ANTECIPADO: "Antecipado",
};

// Opcoes do select editavel de "Estado do trabalho" na lista/card. ANTECIPADO
// fica de fora de proposito — e automatico, nunca escolhido pelo usuario.
// CONCLUIDO reusa a acao Concluir (guard de unico ativo + antecipacao em
// cascata) em vez de gravar o valor direto — ver changeWorkCompletionStatus.
export const WORK_COMPLETION_SELECT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Em branco" },
  { value: "PARCIAL_PLANEJADO", label: "Parcial planejado" },
  { value: "PARCIAL_NAO_PLANEJADO", label: "Parcial nao planejado" },
  { value: "BENEFICIO_ATINGIDO", label: "Beneficio atingido" },
  { value: "CONCLUIDO", label: "Concluido" },
];

// Mesma ideia de HISTORY_FIELD_LABELS/formatHistoryAction de programacao-simples,
// adaptada aos action_type/changes gravados pelas RPCs desta tela (migration 311).
export const HISTORY_ACTION_LABELS: Record<string, string> = {
  CREATE_STAGE: "Cadastro",
  UPDATE_STAGE: "Edicao",
  ADD_TEAM: "Adicao de equipe",
  REMOVE_TEAM: "Remocao de equipe",
  POSTPONE_STAGE: "Adiamento",
  CREATED_FROM_POSTPONE: "Criada por adiamento",
  CANCEL_STAGE: "Cancelamento",
  ANTICIPATE_STAGE: "Encerramento antecipado",
  COMPLETE_STAGE: "Conclusao",
  RESTORE_ANTICIPATED_STAGE: "Restauracao de antecipada",
  REOPEN_STAGE: "Reabertura",
  RECLASSIFY_STAGE: "Reclassificacao",
  SET_WORK_COMPLETION_STATUS: "Estado do trabalho",
  CHANGE_COMPLETED_WORK_STATUS: "Saida de Concluido",
  SET_PENDENCIA_FLAG: "Pendencia",
  CORRECT_STAGE_DATE: "Correcao de data",
};

export const HISTORY_FIELD_LABELS: Record<string, string> = {
  executionDate: "Data execucao",
  period: "Periodo",
  startTime: "Hora inicio",
  endTime: "Hora termino",
  outageStartTime: "Inicio de desligamento",
  outageEndTime: "Termino de desligamento",
  feeder: "Alimentador",
  campoEletrico: "Ponto Eletrico",
  affectedCustomers: "Nº Clientes Afetados",
  sgdTypeId: "Tipo de SGD",
  electricalEqCatalogId: "No EQ",
  support: "Apoio",
  supportItemId: "Apoio",
  posteQty: "Poste",
  estruturaQty: "Estrutura",
  trafoQty: "Trafo",
  redeQty: "Rede",
  serviceDescription: "Descricao do servico",
  note: "Anotacao",
  status: "Status",
  workCompletionStatus: "Estado Trabalho",
  isPendencia: "Pendencia",
  resolvePendenciaDeId: "Etapa de origem da pendencia",
  newProgrammingId: "Nova etapa (adiamento)",
  sourceProgrammingId: "Etapa de origem",
  anticipatedById: "Etapa que antecipou",
  anticipatedCount: "Etapas antecipadas",
  restoredCount: "Etapas restauradas",
};
