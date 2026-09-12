import type { SerialTrackingType } from "@/lib/materialSerialTracking";

export type StockCenterOption = {
  id: string;
  name: string;
};

export type TrafoPositionOperationFilter =
  | "TODOS"
  | "ENTRY"
  | "EXIT"
  | "TRANSFER"
  | "REQUISITION"
  | "RETURN"
  | "FIELD_RETURN"
  | "RET";

export type TrafoPositionFilters = {
  stockCenterId: string;
  serialTrackingType: "TODOS" | Exclude<SerialTrackingType, "NONE">;
  materialType: string;
  materialCode: string;
  description: string;
  serialNumber: string;
  lotCode: string;
  projectCode: string;
  teamName: string;
  foremanName: string;
  cmd: "TODOS" | "SIM" | "NAO";
  currentStatus: "TODOS" | "EM_ESTOQUE" | "COM_EQUIPE" | "FORA_ESTOQUE" | "RET";
  lastOperationKind: TrafoPositionOperationFilter;
  entryDateFrom: string;
  entryDateTo: string;
};

export type TrafoPositionListItem = {
  id: string;
  materialId: string;
  materialCode: string;
  description: string;
  materialType: string;
  serialTrackingType: SerialTrackingType;
  serialNumber: string;
  lotCode: string;
  currentStockCenterId: string | null;
  currentStockCenterName: string | null;
  currentStatus: "EM_ESTOQUE" | "COM_EQUIPE" | "FORA_ESTOQUE" | "RET";
  currentTeamName: string | null;
  currentForemanName: string | null;
  cmd: boolean;
  canMove: boolean;
  canRetire: boolean;
  retiredAt: string | null;
  retiredReason: string | null;
  retiredByName: string | null;
  lastTransferId: string | null;
  lastProjectId: string | null;
  lastProjectCode: string | null;
  lastOperationKind: "ENTRY" | "EXIT" | "TRANSFER" | "REQUISITION" | "RETURN" | "FIELD_RETURN" | "RET";
  lastEntryDate: string;
  updatedAt: string | null;
  updatedByName: string;
};

export type TrafoPositionSummary = {
  inOwnCount: number;
  withTeamCount: number;
  outsideCount: number;
  retCount: number;
  pendingSerialCount: number;
};

/**
 * Agregado anonimo de `stock_serial_pending_balances`: unidades que ja entraram no
 * estoque mas ainda nao tiveram o serial informado. Nao e unidade rastreada, entao nao
 * aparece na lista de posicoes nem tem serial, LP, CMD, equipe, projeto ou data.
 */
export type PendingSerialBalanceItem = {
  materialId: string;
  materialCode: string;
  description: string;
  serialTrackingType: SerialTrackingType;
  stockCenterId: string;
  stockCenterName: string;
  entryType: string;
  quantity: number;
};

export type TrafoPositionListResponse = {
  items?: TrafoPositionListItem[];
  summary?: TrafoPositionSummary;
  pendingSerialBalances?: PendingSerialBalanceItem[];
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
  };
  message?: string;
};

export type TrafoPositionMetaResponse = {
  stockCenters?: StockCenterOption[];
  message?: string;
};

export type TrafoPositionHistoryEntry = {
  id: string;
  transferId: string;
  operationKind: "ENTRY" | "EXIT" | "TRANSFER" | "REQUISITION" | "RETURN" | "FIELD_RETURN" | "RET";
  movementType: "ENTRY" | "EXIT" | "TRANSFER" | "RET";
  quantity: number;
  entryDate: string;
  changedAt: string;
  projectCode: string;
  fromStockCenterName: string;
  toStockCenterName: string;
  updatedByName: string;
  teamName: string | null;
  foremanName: string | null;
  notes: string | null;
  cmd?: boolean;
  isReversal: boolean;
  isReversed: boolean;
  reversalReason: string | null;
  isRetirement?: boolean;
};

export type TrafoPositionHistoryResponse = {
  history?: TrafoPositionHistoryEntry[];
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
  };
  message?: string;
};
