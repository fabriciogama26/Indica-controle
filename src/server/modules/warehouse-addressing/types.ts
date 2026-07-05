export type WarehouseStockCenterRow = {
  id: string;
  name: string;
  center_type: "OWN" | "THIRD_PARTY";
  controls_balance: boolean;
};

export type WarehouseTeamStockCenterRow = {
  stock_center_id: string | null;
};

export type WarehouseMapRow = {
  id: string;
  stock_center_id: string;
  colunas: string[];
  linhas: number[];
  updated_at: string;
};

export type WarehouseShelfRow = {
  id: string;
  coluna: string;
  linha: number;
};

export type WarehouseShelfFloorRow = {
  shelf_id: string;
  numero: number;
  qtd_posicoes: number;
};

export type WarehouseAddressRow = {
  id: string;
  material_id: string;
  coluna: string;
  linha: number;
  andar: number;
  posicao: number;
  updated_at: string;
};

export type WarehouseBalanceRow = {
  material_id: string;
  quantity: number | string | null;
};

export type WarehouseMaterialRow = {
  id: string;
  codigo: string;
  descricao: string;
  umb: string | null;
  stock_minimum: number | string | null;
  stock_maximum: number | string | null;
  is_active: boolean;
};

export type SaveWarehouseMapPayload = {
  stockCenterId?: string | null;
  colunas?: string[];
  linhas?: number[];
  prateleiras?: Array<{
    id?: string;
    coluna?: string;
    linha?: number;
    andares?: Array<{
      numero?: number;
      qtdPosicoes?: number;
    }>;
  }>;
  expectedUpdatedAt?: string | null;
};

export type AssignWarehouseAddressPayload = {
  mapId?: string | null;
  materialId?: string | null;
  coluna?: string | null;
  linha?: number | null;
  andar?: number | null;
  posicao?: number | null;
  expectedUpdatedAt?: string | null;
};
