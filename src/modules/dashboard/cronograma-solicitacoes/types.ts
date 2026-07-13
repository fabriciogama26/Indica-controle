export type TipoSolicitacao = "INSPECAO" | "AS_BUILT" | "LOCACAO";
export type Prioridade = "BAIXA" | "MEDIA" | "ALTA";
export type StatusArmazenado = "PENDENTE" | "CONCLUIDO" | "CANCELADO";
export type StatusEfetivo = StatusArmazenado | "ATRASADO";

export type SolicitacaoItem = {
  id: string;
  projetoId: string;
  projetoCodigo: string;
  projetoMunicipio: string;
  projetoEndereco: string;
  projetoPrioridade: string;
  tipo: TipoSolicitacao;
  prioridade: Prioridade;
  dataEntrada: string;
  dataLimite: string;
  dataConclusao: string | null;
  status: StatusArmazenado;
  statusEfetivo: StatusEfetivo;
  diasRestantes: number | null;
  diasAtraso: number | null;
  responsavelId: string;
  responsavelNome: string;
  solicitanteId: string;
  solicitanteNome: string;
  observacao: string | null;
  justificativaPrioridade: string | null;
  motivoCancelamento: string | null;
  estadoProgramacaoSnapshot: string | null;
  estadoProgramacaoAtual: string;
  prazoObra: string | null;
  programacaoId: string | null;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

export type SolicitacaoSummary = {
  total: number;
  pendentes: number;
  concluidas: number;
  atrasadas: number;
  vencendoHoje: number;
  vencendoProximos3: number;
};

export type ListResponse = {
  items: SolicitacaoItem[];
  pagination: { page: number; pageSize: number; total: number };
  summary: SolicitacaoSummary;
  today: string;
  message?: string;
};

export type MetaOption = { value: string; label: string };
export type ResponsavelOption = { id: string; nome: string };
export type ProjetoOption = {
  id: string;
  codigo: string;
  municipio: string;
  endereco: string;
  prioridade: string;
};

export type MetaResponse = {
  tipos: MetaOption[];
  prioridades: MetaOption[];
  status: MetaOption[];
  responsaveis: ResponsavelOption[];
  projetos: ProjetoOption[];
  asbuiltProjetoIds: string[];
  defaultTipo: string | null;
  message?: string;
};

export type TipoDefaultUser = {
  userId: string;
  userName: string;
  defaultTipo: string | null;
};

export type TipoDefaultsResponse = {
  users: TipoDefaultUser[];
  message?: string;
};

export type EstadoResponse = {
  projetoId: string;
  projetoCodigo: string;
  municipio: string;
  endereco: string;
  prioridade: string;
  estadoProgramacao: string;
  estadoToken: string;
  programacaoId: string | null;
  allowed: boolean;
  blockMessage: string | null;
  message?: string;
};

export type FilterState = {
  tipo: string;
  prioridade: string;
  status: string;
  responsavelId: string;
  projetoId: string;
  municipio: string;
  dataEntradaInicio: string;
  dataEntradaFim: string;
  dataLimiteInicio: string;
  dataLimiteFim: string;
  search: string;
  sort: string;
};

export type FormState = {
  id: string | null;
  projetoId: string;
  projetoBusca: string;
  tipo: TipoSolicitacao;
  prioridade: Prioridade;
  dataEntrada: string;
  dataLimite: string;
  responsavelId: string;
  observacao: string;
  justificativaPrioridade: string;
  expectedUpdatedAt: string | null;
};
