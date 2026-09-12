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
  people?: PiPersonOption[];
  teams?: PiTeamOption[];
  projects?: PiProjectOption[];
  contractDefaults?: {
    companyName: string | null;
    managerName: string | null;
    managerEmail: string | null;
    managerPhone: string | null;
    contractNumber: string | null;
  } | null;
  readiness?: PiReadiness;
  /** Se o contrato configurou cargo para cada papel. Sem configuracao, a tela nao filtra. */
  roleFilterConfigured?: { foreman: boolean; supervisor: boolean };
  supervisorRequiredTeamCount?: number;
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

// ---------------------------------------------------------------------------
// Detalhe e formulario
// ---------------------------------------------------------------------------

export type PiPersonOption = {
  id: string;
  name: string;
  registration: string | null;
  /** Papeis que o cargo da pessoa habilita. Vazio = contrato sem cargo configurado. */
  roles: Array<"FOREMAN" | "SUPERVISOR">;
};
export type PiTeamOption = { id: string; name: string };

export type PiExecutionStepRow = {
  id?: string;
  sortOrder?: number;
  workZone: string | null;
  teamId: string | null;
  teamName: string | null;
  activity: string | null;
  origin: "TEMPLATE" | "PROGRAMMING" | "MANUAL";
};

export type PiComparisonRow = {
  field: string;
  label: string;
  programmingValue: string;
  piValue: string;
  divergent: boolean;
};

/**
 * Campos editaveis da PI, no formato que a tela mantem em estado.
 *
 * Tudo string para o formulario nao ter de lidar com nulo em `<input>`; a
 * conversao para nulo acontece no envio. `hasInterferingInstallation` e a
 * excecao: `null` e um estado real ("nao informado") e deixa as duas caixas do
 * documento vazias.
 */
export type PiFormState = {
  primaryOperationAreaCode: string;
  primaryVoltageLevelCode: string;
  operationAreas: string[];
  contactOperationAreas: string[];
  voltageLevels: string[];
  interferingVoltageLevels: string[];
  managerName: string;
  companyName: string;
  contractNumber: string;
  managerPhone: string;
  managerEmail: string;
  utilityContactName: string;
  utilityContactPhone: string;
  utilityContactEmail: string;
  activityDescription: string;
  workPlan: string;
  liveWorkAuthorization: string;
  preApr: string;
  emergencyAuthorization: string;
  startTime: string;
  endDate: string;
  endTime: string;
  secondaryDate: string;
  secondaryStartTime: string;
  installationDescription: string;
  feeder: string;
  address: string;
  coordX: string;
  coordY: string;
  blockedElements: string;
  cutElements: string;
  hasInterferingInstallation: boolean | null;
  interferingDescription: string;
  trafficInstructions: string;
  supervisorPersonId: string;
  supervisorAlternatePersonId: string;
  foremanPersonId: string;
  foremanAlternatePersonId: string;
  authorPersonId: string;
  validatorPersonId: string;
  observations: string;
};

export type PiDetailResponse = {
  pi?: Record<string, unknown>;
  project?: { id: string; code: string; city: string | null; address: string; serviceDescription: string | null } | null;
  operationAreas?: string[];
  contactOperationAreas?: string[];
  voltageLevels?: string[];
  interferingVoltageLevels?: string[];
  executionSteps?: PiExecutionStepRow[];
  comparison?: PiComparisonRow[];
  message?: string;
};

export type PiHistoryEntry = {
  id: string;
  actionType: string;
  reason: string | null;
  changes: Record<string, { from: unknown; to: unknown }>;
  metadata: Record<string, unknown>;
  createdByName: string;
  createdAt: string;
};
