export type BlockedDateScope = "NACIONAL" | "MUNICIPAL";

export type BlockedDateKind = "FERIADO" | "PONTO_FACULTATIVO" | "OUTRO";

/** Linha completa do cadastro, usada apenas pela tela `/datas-bloqueadas`. */
export type BlockedDateItem = {
  id: string;
  blockedDate: string;
  description: string;
  scope: BlockedDateScope;
  kind: BlockedDateKind;
  municipalityId: string | null;
  municipalityName: string;
  isActive: boolean;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Projecao enxuta consumida pela Programacao, pelo Mapa de Programacao e pela
 * Visualizacao de Programacao. Sem auditoria e sem status: `/api/blocked-dates/vigentes`
 * ja devolve somente datas ativas.
 */
export type ActiveBlockedDate = {
  id: string;
  blockedDate: string;
  description: string;
  scope: BlockedDateScope;
  kind: BlockedDateKind;
  municipalityId: string | null;
  municipalityName: string;
};

export type BlockedDateMunicipalityOption = {
  id: string;
  name: string;
};

export const BLOCKED_DATE_SCOPE_LABELS: Record<BlockedDateScope, string> = {
  NACIONAL: "Nacional",
  MUNICIPAL: "Municipal",
};

export const BLOCKED_DATE_KIND_LABELS: Record<BlockedDateKind, string> = {
  FERIADO: "Feriado",
  PONTO_FACULTATIVO: "Ponto facultativo",
  OUTRO: "Outro",
};
