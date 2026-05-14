export type StockCenterOption = {
  id: string;
  name: string;
  centerType: "OWN" | "THIRD_PARTY";
  controlsBalance: boolean;
};

export type CurrentStockFilters = {
  stockCenterId: string;
  materialCode: string;
  description: string;
  qtyMin: string;
  qtyMax: string;
  onlyPositive: "SIM" | "TODOS";
};

export type CurrentStockListItem = {
  stockCenterId: string;
  stockCenterName: string;
  materialId: string;
  materialCode: string;
  description: string;
  unit: string;
  materialType: string;
  balanceQuantity: number;
  lastMovementAt: string | null;
};

export type CurrentStockUnitSummary = {
  unit: string;
  balanceQuantity: number;
};

export type CurrentStockListResponse = {
  items?: CurrentStockListItem[];
  summaryByUnit?: CurrentStockUnitSummary[];
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
  };
  message?: string;
};

export type CurrentStockMetaResponse = {
  stockCenters?: StockCenterOption[];
  message?: string;
};

export type CurrentStockHistoryEntry = {
  id: string;
  transferId: string;
  movementType: "ENTRY" | "EXIT" | "TRANSFER";
  operationKind?: "ENTRY" | "EXIT" | "TRANSFER" | "REQUISITION" | "RETURN" | "FIELD_RETURN";
  teamName?: string | null;
  foremanName?: string | null;
  signedQuantity: number;
  quantity: number;
  entryDate: string;
  changedAt: string;
  projectCode: string;
  fromStockCenterName: string;
  toStockCenterName: string;
  updatedByName: string;
  serialNumber: string | null;
  lotCode: string | null;
  notes: string | null;
  isReversal: boolean;
  isReversed: boolean;
  reversalReason: string | null;
};

export type CurrentStockHistoryFilters = {
  operationKind: "TODOS" | "ENTRY" | "EXIT" | "TRANSFER" | "REQUISITION" | "RETURN" | "FIELD_RETURN";
  originText: string;
};

export type CurrentStockHistoryResponse = {
  history?: CurrentStockHistoryEntry[];
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
  };
  message?: string;
};
