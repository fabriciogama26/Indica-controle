export type BillingKind = "COM_PRODUCAO" | "SEM_PRODUCAO";

export type BillingStatus = "ABERTA" | "FECHADA" | "CANCELADA";

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

export type BillingFormItem = {
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

export type BillingFormState = {
  id: string | null;
  expectedUpdatedAt: string | null;
  projectId: string;
  projectSearch: string;
  billingKind: BillingKind;
  noProductionReasonId: string;
  notes: string;
  activitySearch: string;
  quantity: string;
  rate: string;
  itemObservation: string;
  items: BillingFormItem[];
};

export type BillingFilters = {
  projectId: string;
  projectSearch: string;
  status: "TODOS" | BillingStatus;
  billingKind: "TODOS" | BillingKind;
  noProductionReasonId: string;
};

export type BillingListItem = {
  id: string;
  billingNumber: string;
  projectId: string;
  projectCode: string;
  billingKind: BillingKind;
  noProductionReasonId: string | null;
  noProductionReasonName: string;
  status: BillingStatus;
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

export type BillingDetail = BillingListItem & {
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

export type BillingHistoryEntry = {
  id: string;
  action: string;
  reason: string;
  changes: Record<string, unknown>;
  metadata: Record<string, unknown>;
  changedAt: string;
  changedByName: string;
};

export type BillingListResponse = {
  orders?: BillingListItem[];
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
  };
  message?: string;
};

export type BillingMetaResponse = {
  projects?: ProjectOption[];
  noProductionReasons?: NoProductionReasonOption[];
  message?: string;
};

export type BillingCatalogResponse = {
  items?: ActivityOption[];
  message?: string;
};

export type BillingImportIssue = {
  linha: number;
  coluna: string;
  valor: string;
  erro: string;
};

export type BillingImportResult = {
  success?: boolean;
  savedCount?: number;
  errorCount?: number;
  results?: Array<{
    rowNumbers?: number[];
    success?: boolean;
    message?: string;
    reason?: string | null;
    billingOrderId?: string | null;
  }>;
  message?: string;
};
