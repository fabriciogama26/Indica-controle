/** Relatorio de conferencia das tags de uma versao de template. */
export type PiTemplateTagReport = {
  missing: string[];
  missingRequired: string[];
  unknown: string[];
  present: string[];
};

export type PiTemplateItem = {
  id: string;
  version: number;
  originalFilename: string;
  checksumSha256: string;
  tagReport: Partial<PiTemplateTagReport>;
  isActive: boolean;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
};

export type PiTemplateListResponse = {
  items?: PiTemplateItem[];
  hasActiveTemplate?: boolean;
  message?: string;
};

export type PiTemplateMutationResponse = {
  templateId?: string;
  version?: number | null;
  previousVersion?: number | null;
  updatedAt?: string | null;
  tagReport?: Partial<PiTemplateTagReport>;
  message?: string;
  reason?: string | null;
  code?: string;
  details?: string[];
};

/** `full` preenche as 23 linhas do Plano de Execucao, o pior caso de layout. */
export type PiPreviewVariant = "default" | "full";
