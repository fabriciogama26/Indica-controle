export type AsbuiltMeasurementKind = "COM_PRODUCAO" | "SEM_PRODUCAO";

export type AsbuiltMeasurementStatus = "ABERTA" | "FECHADA" | "CANCELADA";

export type FeedbackState = {
  type: "success" | "error";
  message: string;
};

export type ProjectOption = {
  id: string;
  code: string;
  label: string;
};

export type ActivityOption = {
  id: string;
  code: string;
  description: string;
  unit: string;
  voicePoint: number;
  unitValue: number;
  isActive: boolean;
};

export type NoProductionReasonOption = {
  id: string;
  code: string;
  name: string;
};

export type AsbuiltMeasurementFormItem = {
  rowId: string;
  activityId: string;
  code: string;
  description: string;
  unit: string;
  voicePoint: number;
  unitValue: number;
  activityIsActive: boolean;
  quantity: string;
  rate: string;
  observation: string;
};

export type AsbuiltMeasurementFormState = {
  id: string | null;
  expectedUpdatedAt: string | null;
  projectId: string;
  projectSearch: string;
  asbuiltMeasurementKind: AsbuiltMeasurementKind;
  noProductionReasonId: string;
  notes: string;
  activitySearch: string;
  quantity: string;
  rate: string;
  itemObservation: string;
  items: AsbuiltMeasurementFormItem[];
};

export type AsbuiltMeasurementFilters = {
  projectId: string;
  projectSearch: string;
  status: "TODOS" | AsbuiltMeasurementStatus;
  asbuiltMeasurementKind: "TODOS" | AsbuiltMeasurementKind;
  noProductionReasonId: string;
};

export type AsbuiltMeasurementListItem = {
  id: string;
  asbuiltMeasurementNumber: string;
  projectId: string;
  projectCode: string;
  asbuiltMeasurementKind: AsbuiltMeasurementKind;
  noProductionReasonId: string | null;
  noProductionReasonName: string;
  status: AsbuiltMeasurementStatus;
  notes: string;
  cancellationReason: string;
  canceledAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdByName: string;
  updatedByName: string;
  itemCount: number;
  totalAmount: number;
};

export type AsbuiltMeasurementDetail = AsbuiltMeasurementListItem & {
  items: Array<{
    id: string;
    activityId: string;
    code: string;
    description: string;
    unit: string;
    voicePoint: number;
    unitValue: number;
    activityIsActive: boolean;
    quantity: number;
    rate: number;
    totalValue: number;
    observation: string;
  }>;
};

export type AsbuiltMeasurementHistoryEntry = {
  id: string;
  action: string;
  reason: string;
  changes: Record<string, unknown>;
  metadata: Record<string, unknown>;
  changedAt: string;
  changedByName: string;
};

export type AsbuiltMeasurementListResponse = {
  orders?: AsbuiltMeasurementListItem[];
  summary?: {
    totalAmount: number;
    itemCount: number;
  };
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
  };
  message?: string;
};

export type AsbuiltMeasurementMetaResponse = {
  projects?: ProjectOption[];
  noProductionReasons?: NoProductionReasonOption[];
  message?: string;
};

export type AsbuiltMeasurementCatalogResponse = {
  items?: ActivityOption[];
  message?: string;
};

export type AsbuiltMeasurementImportIssue = {
  linha: number;
  coluna: string;
  valor: string;
  erro: string;
};

export type AsbuiltMeasurementImportResult = {
  success?: boolean;
  savedCount?: number;
  errorCount?: number;
  results?: Array<{
    rowNumbers?: number[];
    success?: boolean;
    message?: string;
    reason?: string | null;
    asbuiltMeasurementOrderId?: string | null;
  }>;
  message?: string;
};

