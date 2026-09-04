// Tipos compartilhados da tela de Medicao (tecnica e comercial).
//
// Extraidos de `MeasurementPageView.tsx` junto com `utils.ts`: o PageView esta
// acima do teto de linhas do CLAUDE.md e a modularizacao comeca pelo que e puro
// (tipos e funcoes sem React), que `utils.ts` tambem precisa importar sem criar
// ciclo com o componente.

export type MeasurementStatus = "ABERTA" | "FECHADA" | "CANCELADA";
export type MeasurementKind = "COM_PRODUCAO" | "SEM_PRODUCAO";
export type ProgrammingStatus = "PROGRAMADA" | "REPROGRAMADA" | "ADIADA" | "CANCELADA";
export type ProgrammingMatchStatus = "PROGRAMADA" | "NAO_PROGRAMADA";
export type WorkCompletionStatus = string | null;
export type EconomicWorkCompletionStatus = "CONCLUIDO" | "PARCIAL" | "PARCIAL_PLANEJADO_BENEFICIO_ATINGIDO";

export type ProjectItem = {
  id: string;
  code: string;
  serviceName: string;
};

export type TeamItem = {
  id: string;
  name: string;
  foremanName: string;
};


export type ActivityCatalogItem = {
  id: string;
  code: string;
  description: string;
  unit: string;
  unitValue: number;
  voicePoint: number;
};

export type RateSuggestionSource = "ELECTRICAL_FIELD" | "PREVIOUS_MEASUREMENT" | "MANUAL";
