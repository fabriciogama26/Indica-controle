export type StockCenterOption = {
  id: string;
  name: string;
};

export type TrafoPositionFilters = {
  stockCenterId: string;
  materialCode: string;
  serialNumber: string;
  lotCode: string;
  currentStatus: "TODOS" | "EM_ESTOQUE" | "COM_EQUIPE" | "FORA_ESTOQUE";
};

export type TrafoPositionListItem = {
  id: string;
  materialId: string;
  materialCode: string;
  description: string;
  materialType: string;
  serialNumber: string;
  lotCode: string;
  currentStockCenterId: string | null;
  currentStockCenterName: string | null;
  currentStatus: "EM_ESTOQUE" | "COM_EQUIPE" | "FORA_ESTOQUE";
  currentTeamName: string | null;
  currentForemanName: string | null;
  canMove: boolean;
  lastTransferId: string | null;
  lastProjectId: string | null;
  lastProjectCode: string | null;
  lastOperationKind: "ENTRY" | "EXIT" | "TRANSFER" | "REQUISITION" | "RETURN" | "FIELD_RETURN";
  lastEntryDate: string;
  updatedAt: string | null;
  updatedByName: string;
};

export type TrafoPositionListResponse = {
  items?: TrafoPositionListItem[];
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
  operationKind: "ENTRY" | "EXIT" | "TRANSFER" | "REQUISITION" | "RETURN" | "FIELD_RETURN";
  movementType: "ENTRY" | "EXIT" | "TRANSFER";
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
  isReversal: boolean;
  isReversed: boolean;
  reversalReason: string | null;
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
