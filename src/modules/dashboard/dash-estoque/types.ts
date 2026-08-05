export type Option = {
  id: string;
  label: string;
};

export type StockCenterOption = {
  id: string;
  name: string;
  controlsBalance: boolean;
};

export type Summary = {
  materialCount: number;
  totalBalanceQuantity: number;
  totalEstimatedValue: number;
  criticalCount: number;
  zeroCount: number;
  movementCount: number;
  totalMovementQuantity: number;
};

export type UnitSummary = {
  unit: string;
  balanceQuantity: number;
  materialCount: number;
};

export type CriticalMaterial = {
  materialId: string;
  materialCode: string;
  description: string;
  unit: string;
  balanceQuantity: number;
  status: "ZERADO" | "CRITICO";
};

export type TopBalanceMaterial = {
  materialId: string;
  materialCode: string;
  description: string;
  unit: string;
  balanceQuantity: number;
};

export type MaterialDetail = {
  materialId: string;
  materialCode: string;
  description: string;
  unit: string;
  materialType: string;
  unitPrice: number;
  balanceQuantity: number;
  estimatedValue: number;
  lastMovementAt: string | null;
  idleDays?: number | null;
  abcPercentage?: number;
};

export type IdleBucket = {
  key: string;
  label: string;
  materialCount: number;
  balanceQuantity: number;
  materials: MaterialDetail[];
};

export type AbcRow = {
  className: "A" | "B" | "C";
  materialCount: number;
  estimatedValue: number;
  balanceQuantity: number;
  percentage: number;
  materials: MaterialDetail[];
};

export type EvolutionRow = {
  period: string;
  label: string;
  estimatedValue: number;
  entry: number;
  exit: number;
  transfer: number;
  requisition: number;
  return: number;
  fieldReturn: number;
};

export type ScatterPoint = {
  materialId: string;
  materialCode: string;
  description: string;
  unit: string;
  operationKind: "REQUISITION" | "RETURN";
  quantity: number;
  operationCount: number;
  projectCount: number;
  currentBalance: number;
};

export type ScatterUnitSummary = {
  operationKind: "REQUISITION" | "RETURN";
  unit: string;
  quantity: number;
  materialCount: number;
  operationCount: number;
};

export type DashboardResponse = {
  message?: string;
  filters?: {
    stockCenters: StockCenterOption[];
    teams: Option[];
    projects: Option[];
  };
  appliedFilters?: {
    startDate: string;
    endDate: string;
    stockCenterId: string | null;
    teamId: string | null;
    projectId: string | null;
    materialCode: string;
    materialType: string;
    criticalQty: number;
  };
  summary?: Summary;
  summaryByUnit?: UnitSummary[];
  criticalMaterials?: CriticalMaterial[];
  topBalanceMaterials?: TopBalanceMaterial[];
  idleBuckets?: IdleBucket[];
  abcRows?: AbcRow[];
  abcQuantityRows?: AbcRow[];
  movementEvolution?: EvolutionRow[];
  scatterSummaryByUnit?: ScatterUnitSummary[];
  scatter?: ScatterPoint[];
};

export type ScatterOperation = "REQUISITION" | "RETURN";
export type ScatterScale = "sqrt" | "linear";
export type AbcMode = "value" | "quantity";

export type ScatterQuantityBand = {
  minExclusive: number;
  maxInclusive: number;
  label: string;
  color: string;
  stroke: string;
};

export type MaterialModalState = {
  title: string;
  subtitle: string;
  rows: MaterialDetail[];
  showAbcPercentage?: boolean;
} | null;

export type FeedbackState = { type: "success" | "error"; message: string } | null;

export type DashboardFilterValues = {
  startDate: string;
  endDate: string;
  stockCenterId: string;
  teamId: string;
  projectId: string;
  materialCode: string;
  materialType: string;
  criticalQty: string;
};
