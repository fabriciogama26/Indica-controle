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
  issuedStageFound: false,
};

export const PI_PAGE_SIZE = 20;

/**
 * Versao do contrato do formulario, conferida pela RPC `save_permission_intervention_form`.
 *
 * Existe para o caso da aba velha durante um deploy: sem ela, acrescentar um
 * campo faria o salvamento daquela aba recusar com "falta a chave X", o que e
 * correto e incompreensivel. Com ela, a recusa vira "recarregue a pagina".
 *
 * SOBE SEMPRE que o conjunto das 41 chaves editaveis mudar, e o valor aqui tem
 * de acompanhar o `v_expected_version` da migration.
 */
export const PI_FORM_PAYLOAD_VERSION = 1;
