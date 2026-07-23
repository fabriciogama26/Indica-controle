export type ProgrammingStageStatus = "PROGRAMADA" | "REPROGRAMADA" | "ADIADA" | "CANCELADA" | "ANTECIPADA";
export type ProgrammingTeamStatus = "ATIVA" | "REMOVIDA" | "TRANSFERIDA";
export type ProgrammingPeriod = "INTEGRAL" | "PARCIAL";
export type ProgrammingDocumentType = "SGD" | "PI" | "PEP";

export type ProjectItem = {
  id: string;
  code: string;
  city: string;
  serviceCenter: string;
  executionDeadline: string | null;
  base: string;
  serviceType: string;
  serviceName: string;
  priority: string;
  partner: string;
  utilityResponsible: string;
  utilityFieldManager: string;
  street: string;
  district: string;
};

export type TeamItem = {
  id: string;
  name: string;
  vehiclePlate: string;
  teamTypeName: string;
  foremanName: string;
  serviceCenterName: string;
};

export type SgdTypeItem = {
  id: string;
  description: string;
  exportColumn: string;
};

export type ElectricalEqCatalogItem = {
  id: string;
  code: string;
  label: string;
};

export type WorkCompletionCatalogItem = {
  code: string;
  label: string;
};

export type ReasonOptionItem = {
  code: string;
  label: string;
  requiresNotes: boolean;
};

export type SupportOptionItem = {
  id: string;
  description: string;
};

export type MetaResponse = {
  projects: ProjectItem[];
  teams: TeamItem[];
  sgdTypes: SgdTypeItem[];
  electricalEqCatalog: ElectricalEqCatalogItem[];
  workCompletionCatalog: WorkCompletionCatalogItem[];
  reasonOptions: ReasonOptionItem[];
  supportOptions: SupportOptionItem[];
  message?: string;
};

export type StageTeam = {
  id: string;
  teamId: string;
  teamName: string;
  status: ProgrammingTeamStatus;
  updatedAt: string;
};

export type StageActivity = {
  id: string;
  serviceActivityId: string;
  code: string;
  description: string;
  unit: string;
  quantity: number;
};

export type StageDocument = {
  id: string;
  documentType: ProgrammingDocumentType;
  number: string;
  includedAt: string | null;
  deliveredAt: string | null;
};

export type ProgrammingStage = {
  id: string;
  projectId: string;
  executionDate: string | null;
  etapaNumber: number | null;
  etapaUnica: boolean;
  etapaFinal: boolean;
  status: ProgrammingStageStatus;
  workCompletionStatus: string | null;
  isPendencia: boolean;
  serviceDescription: string;
  period: ProgrammingPeriod | null;
  startTime: string | null;
  endTime: string | null;
  expectedMinutes: number | null;
  outageStartTime: string | null;
  outageEndTime: string | null;
  feeder: string;
  campoEletrico: string;
  affectedCustomers: number | null;
  sgdTypeId: string | null;
  electricalEqCatalogId: string | null;
  support: string;
  supportItemId: string | null;
  posteQty: number;
  estruturaQty: number;
  trafoQty: number;
  redeQty: number;
  note: string;
  resolvePendenciaDeId: string | null;
  copiedFromId: string | null;
  anticipatedById: string | null;
  anticipatedAt: string | null;
  cancellationReason: string;
  canceledAt: string | null;
  createdByName: string;
  createdAt: string;
  updatedByName: string;
  updatedAt: string;
  teams: StageTeam[];
  activities: StageActivity[];
  documents: StageDocument[];
};

export type PlanResponse = {
  plan?: ProgrammingStage[];
  message?: string;
};

export type StageDetailsResponse = {
  stage?: ProgrammingStage | null;
  message?: string;
};

export type StageListStatusChip = "TODAS" | "PROGRAMADAS" | "PENDENCIAS" | "ATRASADAS" | "ADIADAS" | "EM_ESPERA" | "SEM_RETORNO";

export type StageListFilters = {
  dateFrom: string;
  dateTo: string;
  statusChip: StageListStatusChip;
  teamIds: string[];
  search: string;
  municipality: string;
};

// Mesma riqueza de campos da etapa (ProgrammingStage) — a lista reusa o DTO do
// backend (mapStageRowToDto) e so agrega projectCode/city, que so fazem sentido
// numa visao cross-projeto (guia_frontend: nao duplicar shape sem necessidade).
export type StageListTeam = StageTeam;

export type StageListItem = ProgrammingStage & {
  projectCode: string;
  city: string;
};

export type StageListResponse = {
  list?: StageListItem[];
  total?: number;
  page?: number;
  pageSize?: number;
  dateFrom?: string;
  dateTo?: string;
  truncated?: boolean;
  today?: string;
  message?: string;
};

export type HistoryModalTarget = {
  id: string;
  executionDate: string | null;
};

export type HistoryItem = {
  id: string;
  changedAt: string;
  actionType: string;
  changedByName: string;
  reason: string;
  changes: Record<string, unknown>;
  metadata: Record<string, unknown>;
  programmingTeamId: string | null;
};

export type HistoryResponse = {
  history?: HistoryItem[];
  message?: string;
};

export type DocumentFormKey = "sgd" | "pi" | "pep";

export type DocumentFormEntry = {
  number: string;
  includedAt: string;
  deliveredAt: string;
};

export type ActivityCatalogItem = {
  id: string;
  code: string;
  description: string;
  unit: string;
};

export type ActivityFormItem = {
  catalogId: string;
  code: string;
  description: string;
  unit: string;
  quantity: string;
};

export type FormState = {
  projectId: string;
  projectSearch: string;
  executionDate: string;
  isPendencia: boolean;
  teamIds: string[];
  teamSearch: string;
  serviceDescription: string;
  period: ProgrammingPeriod;
  startTime: string;
  endTime: string;
  outageStartTime: string;
  outageEndTime: string;
  feeder: string;
  campoEletrico: string;
  affectedCustomers: string;
  sgdTypeId: string;
  electricalEqCatalogId: string;
  support: string;
  supportItemId: string;
  posteQty: string;
  estruturaQty: string;
  trafoQty: string;
  redeQty: string;
  note: string;
  activitySearch: string;
  activityQuantity: string;
  activities: ActivityFormItem[];
  documents: Record<DocumentFormKey, DocumentFormEntry>;
};

export type SaveStageResponse = {
  success?: boolean;
  action?: "INSERT" | "UPDATE";
  programmingId?: string;
  updatedAt?: string;
  stage?: ProgrammingStage | null;
  message?: string;
  reason?: string | null;
  detail?: string | null;
};

export type ActionResponse = {
  success?: boolean;
  message?: string;
  reason?: string | null;
  currentUpdatedAt?: string | null;
  updatedAt?: string;
  newProgrammingId?: string;
  anticipatedCount?: number;
  restoredCount?: number;
};

export type FeedbackState = { type: "success" | "error"; message: string } | null;
