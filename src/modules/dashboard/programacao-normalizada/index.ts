export { ProgrammingNormalizedPageView } from "./ProgrammingNormalizedPageView";
export type * from "./types";

// Rotulo de etapa (Etapa N / Final / Unica, e o "Era ..." das encerradas).
//
// Exposto na fachada porque a Permissao de Intervencao precisa mostrar a etapa
// vinculada com o MESMO rotulo da Programacao. Reimplementar a regra em outro
// modulo e o que o comentario de `utils.ts` adverte: a classificacao tem duas
// fontes (atual e historica) e escolher caso a caso faz lista, plano e export
// divergirem. Funcao pura, sem acesso a dados — quem consome so precisa passar
// os campos de classificacao que a API ja devolve.
export { getStageDisplayClassification, isActiveStageStatus } from "./utils";
