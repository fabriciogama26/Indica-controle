export type StockCenterOption = {
  id: string;
  name: string;
};

export type TrafoPositionFilters = {
  stockCenterId: string;
  materialCode: string;
  serialNumber: string;
  lotCode: string;
  currentStatus: "TODOS" | "EM_ESTOQUE" | "FORA_ESTOQUE";
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
  currentStatus: "EM_ESTOQUE" | "FORA_ESTOQUE";
  lastTransferId: string | null;
  lastProjectId: string | null;
  lastProjectCode: string | null;
  lastMovementType: "ENTRY" | "EXIT" | "TRANSFER";
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
