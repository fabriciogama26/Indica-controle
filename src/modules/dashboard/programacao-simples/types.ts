export type PeriodMode = "integral" | "partial";
export type ProgrammingStatus = "PROGRAMADA" | "REPROGRAMADA" | "ADIADA" | "CANCELADA";
export type WorkCompletionStatus = string;
export type DocumentKey = "sgd" | "pi" | "pep";

export type ProjectItem = {
  id: string;
  code: string;
  executionDeadline?: string | null;
  city: string;
  base: string;
  serviceType: string;
  serviceName?: string;
  priority?: string;
  partner?: string;
  utilityResponsible?: string;
  utilityFieldManager?: string;
  street?: string;
  district?: string;
};

export type TeamItem = {
  id: string;
  name: string;
  vehiclePlate?: string;
  serviceCenterName: string;
  teamTypeName?: string;
  foremanName?: string;
};

export type SupportOptionItem = {
  id: string;
  description: string;
};

export type ProgrammingReasonOptionItem = {
  code: string;
  label: string;
  requiresNotes: boolean;
};

export type SgdTypeItem = {
  id: string;
  description: string;
  exportColumn: "SGD_AT_MT_VYP" | "SGD_BT" | "SGD_TET" | string;
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

export type DocumentEntry = {
  number: string;
  approvedAt: string;
  requestedAt: string;
};

export type ActivityCatalogItem = {
  id: string;
  code: string;
  description: string;
  unit: string;
};

export type ActivityItem = {
  catalogId: string;
  code: string;
  description: string;
  quantity: number;
  unit: string;
};

export type ScheduleItem = {
  id: string;
  projectId: string;
  teamId: string;
  teamName?: string;
  teamServiceCenterName?: string;
  teamTypeName?: string;
  teamForemanName?: string;
  teamVehiclePlate?: string;
  status: ProgrammingStatus;
  isReprogrammed?: boolean;
  date: string;
  period: PeriodMode;
  startTime: string;
  endTime: string;
  outageStartTime: string;
  outageEndTime: string;
  createdAt: string;
  updatedAt: string;
  createdByName: string;
  updatedByName: string;
  statusReason?: string;
  statusChangedAt?: string;
  expectedMinutes: number;
  feeder: string;
  support: string;
  supportItemId: string | null;
  note: string;
  electricalField: string;
  serviceDescription: string;
  posteQty: number;
  estruturaQty: number;
  trafoQty: number;
  redeQty: number;
  etapaNumber: number | null;
  etapaUnica: boolean;
  etapaFinal: boolean;
  workCompletionStatus: WorkCompletionStatus | null;
  affectedCustomers: number;
  sgdTypeId: string | null;
  electricalEqCatalogId: string | null;
  electricalEqCode?: string;
  sgdTypeDescription?: string;
  sgdExportColumn?: string;
  activitiesLoaded?: boolean;
  activities: ActivityItem[];
  documents: {
    sgd: { number: string; approvedAt: string; requestedAt: string; includedAt?: string; deliveredAt?: string };
    pi: { number: string; approvedAt: string; requestedAt: string; includedAt?: string; deliveredAt?: string };
    pep: { number: string; approvedAt: string; requestedAt: string; includedAt?: string; deliveredAt?: string };
  };
};

export type ProgrammingResponse = {
  projects?: ProjectItem[];
  teams?: TeamItem[];
  supportOptions?: SupportOptionItem[];
  sgdTypes?: SgdTypeItem[];
  electricalEqCatalog?: ElectricalEqCatalogItem[];
  workCompletionCatalog?: WorkCompletionCatalogItem[];
  reasonOptions?: ProgrammingReasonOptionItem[];
  schedules?: ScheduleItem[];
  activitiesLoadError?: boolean;
  nextEtapaNumber?: number;
  message?: string;
};

export type StageValidationTeamSummary = {
  teamId: string;
  teamName: string;
  highestStage: number;
  existingStages: number[];
  existingDates: string[];
};

export type StageValidationResponse = {
  enteredEtapaNumber?: number;
  hasConflict?: boolean;
  highestStage?: number;
  teams?: StageValidationTeamSummary[];
  message?: string;
};

export type ActivityCatalogResponse = {
  items?: ActivityCatalogItem[];
  message?: string;
};

export type BatchCreateResponse = {
  success?: boolean;
  insertedCount?: number;
  message?: string;
  enteredEtapaNumber?: number;
  hasConflict?: boolean;
  highestStage?: number;
  teams?: StageValidationTeamSummary[];
};

export type SaveProgrammingResponse = {
  success?: boolean;
  id?: string;
  updatedAt?: string;
  schedule?: ScheduleItem | null;
  warning?: string;
  error?: "conflict";
  reason?: string | null;
  detail?: string | null;
  currentUpdatedAt?: string | null;
  updatedBy?: string | null;
  changedFields?: string[];
  currentRecord?: {
    id: string;
    projectId?: string;
    teamId?: string;
    status?: string;
    executionDate: string;
    startTime: string;
    endTime: string;
    updatedAt: string;
  } | null;
  message?: string;
  enteredEtapaNumber?: number;
  hasConflict?: boolean;
  highestStage?: number;
  teams?: StageValidationTeamSummary[];
};

export type HistoryChange = {
  from: string | null;
  to: string | null;
};

export type ProgrammingHistoryItem = {
  id: string;
  changedAt: string;
  changedByName?: string;
  reason: string;
  action: string;
  changes: Record<string, HistoryChange>;
  metadata: Record<string, unknown>;
};

export type ProgrammingHistoryResponse = {
  history?: ProgrammingHistoryItem[];
  message?: string;
};

export type AlertModalState = {
  title: string;
  message: string;
  details?: string[];
  reason?: string | null;
  spotlightTitle?: string;
  spotlightMessage?: string;
  guidanceMessage?: string;
  showWorkCompletionSelector?: boolean;
  workCompletionTarget?: {
    id: string;
    expectedUpdatedAt: string;
  } | null;
};

export type FormState = {
  projectId: string;
  projectSearch: string;
  date: string;
  period: PeriodMode;
  startTime: string;
  endTime: string;
  outageStartTime: string;
  outageEndTime: string;
  feeder: string;
  supportItemId: string;
  note: string;
  electricalField: string;
  serviceDescription: string;
  posteQty: string;
  estruturaQty: string;
  trafoQty: string;
  redeQty: string;
  etapaNumber: string;
  etapaUnica: boolean;
  etapaFinal: boolean;
  workCompletionStatus: WorkCompletionStatus | "";
  affectedCustomers: string;
  sgdTypeId: string;
  electricalEqCatalogId: string;
  teamIds: string[];
  teamSearch: string;
  activitySearch: string;
  activityQuantity: string;
  activities: ActivityItem[];
  documents: Record<DocumentKey, DocumentEntry>;
};

export type FilterState = {
  startDate: string;
  endDate: string;
  projectSearch: string;
  projectId: string;
  municipality: string;
  teamId: string;
  status: "TODOS" | ProgrammingStatus;
  workCompletionStatus: "TODOS" | WorkCompletionStatus | "NAO_INFORMADO";
  sgdTypeId: string;
};

export type DeadlineStatus = "OVERDUE" | "TODAY" | "SOON" | "NORMAL";
export type DeadlineVisualVariant = "OVERDUE_CRITICAL" | "OVERDUE" | "TODAY" | "SOON" | "NORMAL";
export type DeadlineViewMode = "15" | "30";
export type ProgrammingSimplePageViewMode = "cadastro" | "visualizacao";
