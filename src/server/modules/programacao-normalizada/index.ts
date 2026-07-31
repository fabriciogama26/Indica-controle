// Fachada publica do modulo server-side da Programacao (modelo normalizado).
//
// Existe para atender a regra de arquitetura do CLAUDE.md: feature nao importa
// regra de dominio de feature irma; a comunicacao passa por contrato explicito.
// Telas de outros dominios que precisam do Estado do Trabalho da Programacao
// importam DAQUI, nunca de `queries.ts`/`handlers.ts` direto, e nunca lendo a
// tabela por conta propria.
//
// Antes do corte para o modelo normalizado, cinco consumidores liam
// `project_programming` direto e reimplementavam "ultimo Estado do Trabalho do
// projeto" com criterios divergentes entre si. O contrato abaixo e o unico ponto
// dessa regra.
//
// O que NAO entra nesta fachada: as RPCs de escrita (`rpc.ts`) e os handlers de
// rota (`handlers.ts`). Escrita na Programacao acontece somente pela propria tela.
export {
  // Estado do Trabalho atual do projeto (Cronograma de Solicitacoes, Dash
  // Operacional Faturamento).
  fetchWorkCompletionByProject,
  type ProgrammingProjectWorkCompletion,

  // Timeline ate uma data de corte (Dashboard Medicao, Dashboard Carteira
  // Operacional).
  fetchWorkCompletionTimelineByProject,
  type ProgrammingCompletionTimelineRow,

  // Recortes da lista de Projetos e guarda de inativacao.
  fetchProjectIdsWithCompletedWork,
  fetchProjectIdsByProgrammingFilter,
  countActiveStagesForProject,

  // Reconciliacao dos dois codigos de catalogo que significam o mesmo estado.
  toCanonicalWorkCompletionCode,

  // Leitura ampla para o Mapa de Programacao (cartoes de situacao por projeto).
  fetchProgrammingStagesForMap,
  type ProgrammingMapStageRow,
  type ProgrammingMapTeamRow,
  fetchTeamIdsProgrammedInPeriod,
} from "./queries";
