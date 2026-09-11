/**
 * Contratos da tela da Permissao de Intervencao.
 *
 * `linkedStage` chega CRU do servidor de proposito: o rotulo (`Etapa 2`,
 * `Final`, `Unica`, `Era ...`) e montado por `getStageDisplayClassification`,
 * da fachada da Programacao, que e a fonte unica dessa regra.
 */

export type PiStatus = "DRAFT" | "READY" | "ISSUED" | "CANCELLED";
export type PiLinkStatus = "LINKED" | "PENDING" | "ATTENTION";
export type PiCreationSource = "FROM_PROGRAMMING" | "MANUAL";

export type PiStageClassification = {
  status: string;
  executionDate: string | null;
  etapaNumber: number | null;
  etapaUnica: boolean;
  etapaFinal: boolean;
  classificationSnapshotNumber: number | null;
  classificationSnapshotUnica: boolean | null;
  classificationSnapshotFinal: boolean | null;
  classificationSnapshotExecutionDate: string | null;
  classificationSnapshotAt: string | null;
};

export type PiListItem = {
  id: string;
  piCode: string | null;
  projectId: string;
  projectCode: string;
  projectCity: string;
  workDate: string;
  status: PiStatus;
  linkStatus: PiLinkStatus;
  creationSource: PiCreationSource;
  programmingId: string | null;
  linkedStage: PiStageClassification | null;
  operationAreaCodes: string[];
  voltageLevelCodes: string[];
  primaryOperationAreaCode: string | null;
  primaryVoltageLevelCode: string | null;
  supervisorName: string | null;
  foremanName: string | null;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
};

export type PiListResponse = {
  items?: PiListItem[];
  page?: number;
  pageSize?: number;
  total?: number;
  message?: string;
};

export type PiCatalogOption = { code: string; label: string; sortOrder?: number };

export type PiProjectOption = { id: string; code: string; city: string; address: string };

export type PiReadiness = {
  hasSettings: boolean;
  hasEmergencyPlan: boolean;
  hasActiveTemplate: boolean;
  hasStepTemplates: boolean;
};

export type PiMetaResponse = {
  operationAreas?: PiCatalogOption[];
  voltageLevels?: PiCatalogOption[];
  executionStepTemplates?: Array<{ code: string; description: string; sortOrder?: number }>;
  projects?: PiProjectOption[];
  contractDefaults?: {
    companyName: string | null;
    managerName: string | null;
    managerEmail: string | null;
    managerPhone: string | null;
    contractNumber: string | null;
  } | null;
  readiness?: PiReadiness;
  message?: string;
};

export type PiStageOption = {
  programmingId: string;
  executionDate: string | null;
  classification: PiStageClassification;
  teams: Array<{ teamId: string; teamName: string; foremanName: string | null }>;
  activities: Array<{ code: string; description: string; quantity: string }>;
  feeder: string | null;
  serviceDescription: string | null;
  startTime: string | null;
  endTime: string | null;
  existingPiId: string | null;
  existingPiCode: string | null;
};

export type PiMutationResponse = {
  piId?: string | null;
  piCode?: string | null;
  piStatus?: string | null;
  linkStatus?: string | null;
  programmingId?: string | null;
  updatedAt?: string | null;
  message?: string;
  reason?: string | null;
  errors?: Array<{ code: string; message: string }>;
};

export type PiListFilterState = {
  search: string;
  status: string;
  linkStatus: string;
  operationArea: string;
  voltageLevel: string;
  dateFrom: string;
  dateTo: string;
};
