import type { Prioridade, StatusArmazenado, StatusEfetivo, TipoSolicitacao } from "./normalizers";

export type SolicitacaoRow = {
  id: string;
  tenant_id: string;
  projeto_id: string;
  projeto_codigo: string;
  tipo_solicitacao: TipoSolicitacao;
  prioridade: Prioridade;
  data_entrada: string;
  data_limite: string;
  data_conclusao: string | null;
  status: StatusArmazenado;
  responsavel_id: string;
  solicitante_id: string;
  observacao: string | null;
  justificativa_prioridade: string | null;
  motivo_cancelamento: string | null;
  estado_programacao_snapshot: string | null;
  programacao_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

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

export type ListFilters = {
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
};

export type CreatePayload = {
  projetoId: string;
  tipo: string;
  prioridade: string;
  dataEntrada: string;
  dataLimite: string | null;
  responsavelId: string;
  observacao: string | null;
  justificativaPrioridade: string | null;
};

export type UpdatePayload = CreatePayload & {
  id: string;
  expectedUpdatedAt: string | null;
};

export type ProjectLookupRow = {
  id: string;
  sob: string;
  city_text: string | null;
  street: string | null;
  neighborhood: string | null;
  priority_text: string | null;
  execution_deadline: string | null;
  is_active: boolean;
};
