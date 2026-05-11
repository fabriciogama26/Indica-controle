import type { SerialTrackingType } from "@/lib/materialSerialTracking";

export type StockCenterOption = {
  id: string;
  name: string;
};

export type TeamOption = {
  id: string;
  name: string;
  stockCenterId: string;
  stockCenterName: string;
  foremanName: string;
  isActive: boolean;
};

export type ProjectOption = {
  id: string;
  projectCode: string;
};

export type MaterialOption = {
  id: string;
  materialCode: string;
  description: string;
  materialType: string;
  isTransformer: boolean;
  serialTrackingType: SerialTrackingType;
};

export type ReversalReasonOption = {
  code: string;
  label: string;
  requiresNotes: boolean;
};

export type MetaResponse = {
  stockCenters?: StockCenterOption[];
  teams?: TeamOption[];
  projects?: ProjectOption[];
  materials?: MaterialOption[];
  reversalReasons?: ReversalReasonOption[];
  fieldReturnOriginName?: string;
  message?: string;
};

export type TeamOperationKind = "REQUISITION" | "RETURN" | "FIELD_RETURN";

export type TeamOperationListItem = {
  id: string;
  transferId: string;
  updatedAt: string;
  updatedByName: string;
  movementType: "TRANSFER";
  operationKind: TeamOperationKind;
  teamId: string;
  teamName: string;
  foremanName: string | null;
  materialId: string;
  materialCode: string;
  description: string;
  isTransformer: boolean;
  serialTrackingType: SerialTrackingType;
  quantity: number;
  serialNumber: string | null;
  lotCode: string | null;
  entryDate: string;
  entryType: "SUCATA" | "NOVO";
  fromStockCenterId: string;
  fromStockCenterName: string;
  toStockCenterId: string;
  toStockCenterName: string;
  projectId: string;
  projectCode: string;
  notes: string | null;
  isReversed: boolean;
  reversalTransferId: string | null;
  isReversal: boolean;
  originalTransferId: string | null;
  reversalReason: string | null;
  reversedAt: string | null;
  technicalOriginStockCenterId?: string | null;
};

export type TeamOperationHistoryEntry = {
  id: string;
  action: "UPDATE" | string;
  changedAt: string;
  changedByName: string;
  changes?: Record<string, { from?: unknown; to?: unknown }>;
};

export type TeamOperationListResponse = {
  history?: TeamOperationListItem[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

export type SerialOption = {
  id: string;
  materialId: string;
  materialCode: string;
  serialTrackingType: SerialTrackingType;
  serialNumber: string;
  lotCode: string;
  currentStockCenterId: string | null;
  updatedAt: string | null;
};

export type SerialOptionsResponse = {
  items?: SerialOption[];
  message?: string;
};

export type TeamOperationHistoryResponse = {
  history?: TeamOperationHistoryEntry[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

export type ImportResponse = {
  success?: boolean;
  summary?: {
    total: number;
    successCount: number;
    errorCount: number;
  };
  results?: Array<{
    rowNumber: number;
    success: boolean;
    transferId?: string;
    message: string;
    reason?: string;
    details?: unknown;
  }>;
  validationIssues?: MassImportIssue[];
  message?: string;
};

export type MassImportIssue = {
  rowNumber: number;
  column: string;
  value: string;
  error: string;
};

export type MassImportErrorReportData = {
  fileName: string;
  content: string;
  errorRows: number;
  totalIssues: number;
};

export type MassImportResultSummary = {
  status: "success" | "partial" | "error";
  message: string;
  successCount: number;
  errorRows: number;
};

export type TeamOperationFormItem = {
  rowId: string;
  materialId: string;
  materialCode: string;
  description: string;
  quantity: number;
  serialNumber: string;
  lotCode: string;
  entryType: "SUCATA" | "NOVO";
  isTransformer: boolean;
  serialTrackingType: SerialTrackingType;
};

export type FormState = {
  operationKind: TeamOperationKind;
  stockCenterId: string;
  teamId: string;
  teamName: string;
  foremanName: string;
  projectCode: string;
  projectId: string;
  materialCode: string;
  materialId: string;
  description: string;
  quantity: string;
  serialNumber: string;
  lotCode: string;
  entryDate: string;
  entryType: "SUCATA" | "NOVO" | "";
  notes: string;
  items: TeamOperationFormItem[];
};

export type FilterState = {
  startDate: string;
  endDate: string;
  operationKind: "TODOS" | TeamOperationKind;
  teamId: string;
  projectCode: string;
  materialCode: string;
  entryType: "TODOS" | "NOVO" | "SUCATA";
  reversalStatus: "TODOS" | "ESTORNADAS" | "NAO_ESTORNADAS" | "ESTORNOS";
};
