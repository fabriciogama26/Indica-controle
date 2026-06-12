export type TeamStockFilters = {
  teamId: string;
  foreman: string;
  serviceCenter: string;
  materialCode: string;
  description: string;
  materialType: string;
  unit: string;
  teamStatus: "ATIVAS" | "INATIVAS" | "TODAS";
  qtyMin: string;
  qtyMax: string;
  includeZero: boolean;
};

export type TeamOption = {
  id: string;
  name: string;
  foremanName: string;
  serviceCenterName: string;
  isActive: boolean;
};

export type TeamStockItem = {
  teamId: string;
  teamName: string;
  teamIsActive: boolean;
  foremanName: string;
  serviceCenterName: string;
  stockCenterId: string;
  materialId: string;
  materialCode: string;
  description: string;
  unit: string;
  materialType: string;
  balanceQuantity: number;
  lastMovementAt: string | null;
};

export type TeamStockHistoryEntry = {
  id: string;
  transferId: string;
  operationKind: string;
  signedQuantity: number;
  quantity: number;
  entryDate: string;
  changedAt: string;
  projectCode: string;
  serialNumber: string | null;
  lotCode: string | null;
  notes: string | null;
};

export type TeamStockResponse = {
  items?: TeamStockItem[];
  summary?: {
    teamsWithStock: number;
    distinctMaterials: number;
    totalRows: number;
  };
  summaryByUnit?: Array<{ unit: string; balanceQuantity: number }>;
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

export type TeamStockMetaResponse = {
  teams?: TeamOption[];
  foremen?: string[];
  serviceCenters?: string[];
  message?: string;
};

export type TeamStockHistoryResponse = {
  history?: TeamStockHistoryEntry[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};
