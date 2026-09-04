// Variantes da tela de Medicao.
//
// A Medicao Comercial e a mesma tela da Medicao com outra origem de dados: as
// equipes vem da categoria COMERCIAL, a ordem carrega os dois eletricistas da
// execucao e nao existe cadastro em massa. Em vez de clonar 3.6 mil linhas de
// PageView (e passar a manter duas copias divergindo), a tela recebe esta
// configuracao e as rotas ja delegam para o mesmo handler no servidor.

export type MeasurementVariantKey = "medicao" | "medicao-comercial";

export type MeasurementVariantConfig = {
  key: MeasurementVariantKey;
  /** Prefixo das rotas da tela: `/api/medicao` ou `/api/medicao-comercial`. */
  apiBase: string;
  /** Liga os dois integrantes da execucao e desliga o cadastro em massa. */
  commercial: boolean;
  /** Rotulo da coluna/campo que identifica quem executou. */
  executorLabel: string;
};

export const TECHNICAL_MEASUREMENT_VARIANT: MeasurementVariantConfig = {
  key: "medicao",
  apiBase: "/api/medicao",
  commercial: false,
  executorLabel: "Encarregado",
};

export const COMMERCIAL_MEASUREMENT_VARIANT: MeasurementVariantConfig = {
  key: "medicao-comercial",
  apiBase: "/api/medicao-comercial",
  commercial: true,
  executorLabel: "Integrantes",
};
