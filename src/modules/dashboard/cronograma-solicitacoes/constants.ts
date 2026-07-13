import type { Prioridade, StatusEfetivo, TipoSolicitacao } from "./types";

export const CRONOGRAMA_ENDPOINT = "/api/cronograma-solicitacoes";
export const CRONOGRAMA_META_ENDPOINT = "/api/cronograma-solicitacoes/meta";
export const CRONOGRAMA_ESTADO_ENDPOINT = "/api/cronograma-solicitacoes/estado-programacao";
export const CRONOGRAMA_VERIFY_ENDPOINT = "/api/cronograma-solicitacoes/verify";
export const CRONOGRAMA_CANCEL_ENDPOINT = "/api/cronograma-solicitacoes/cancel";
export const CRONOGRAMA_TIPO_DEFAULTS_ENDPOINT = "/api/cronograma-solicitacoes/tipo-defaults";

export const PAGE_SIZE = 20;

export const TIPO_LABEL: Record<TipoSolicitacao, string> = {
  INSPECAO: "Fiscalizacao",
  AS_BUILT: "As Built",
  LOCACAO: "Locacao",
};

export const PRIORIDADE_LABEL: Record<Prioridade, string> = {
  BAIXA: "Baixa",
  MEDIA: "Media",
  ALTA: "Alta",
};

export const STATUS_LABEL: Record<StatusEfetivo, string> = {
  PENDENTE: "Pendente",
  CONCLUIDO: "Concluido",
  CANCELADO: "Cancelado",
  ATRASADO: "Atrasado",
};

export const SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "prazo", label: "Prazo" },
  { value: "prioridade", label: "Prioridade" },
  { value: "projeto", label: "Projeto" },
  { value: "status", label: "Status" },
  { value: "entrada", label: "Data de Entrada" },
  { value: "atualizacao", label: "Ultima Atualizacao" },
];

export const DEFAULT_FILTERS = {
  tipo: "",
  prioridade: "",
  status: "",
  responsavelId: "",
  projetoId: "",
  municipio: "",
  dataEntradaInicio: "",
  dataEntradaFim: "",
  dataLimiteInicio: "",
  dataLimiteFim: "",
  search: "",
  sort: "prazo",
};
