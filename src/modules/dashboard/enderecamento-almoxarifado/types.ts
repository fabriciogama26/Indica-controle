export interface AndarConfig {
  numero: number;
  qtdPosicoes: number;
}

export type StorageType = string;

export interface StorageTypeOption {
  code: StorageType;
  label: string;
  usesFloors: boolean;
}

export interface Prateleira {
  id: string;
  coluna: string;
  linha: number;
  tipo: StorageType;
  andares: AndarConfig[];
}

export interface ConfiguracaoMapa {
  colunas: string[];
  linhas: number[];
  prateleiras: Prateleira[];
}

export interface Material {
  codigo: string;
  nome: string;
  unidade: string;
  quantidade: number;
  estoqueMinimo: number;
  estoqueMaximo?: number;
  coluna: string | null;
  linha: number | null;
  andar: number | null;
  posicao: number | null;
}

export type StockCenterOption = {
  id: string;
  name: string;
  centerType: "OWN" | "THIRD_PARTY";
  controlsBalance: boolean;
  centerKind: "PHYSICAL_WAREHOUSE";
  isPhysicalWarehouse: boolean;
};

export type WarehouseConfiguracao = ConfiguracaoMapa & {
  id: string;
  stockCenterId: string;
  updatedAt: string;
};

export type WarehouseMaterial = Material & {
  id: string;
  estoqueMaximo: number | null;
  enderecoId: string | null;
  enderecoUpdatedAt: string | null;
};

export type WarehouseConfigResponse = {
  stockCenters?: StockCenterOption[];
  storageTypes?: StorageTypeOption[];
  configuracao?: WarehouseConfiguracao | null;
  message?: string;
};

export type WarehouseMapResponse = WarehouseConfigResponse & {
  materiais?: WarehouseMaterial[];
};

export type WarehouseConflict = {
  materialId: string;
  codigo: string;
  coluna: string;
  linha: number;
  andar: number;
  posicao: number;
};

export type SaveMapResponse = {
  success?: boolean;
  mapId?: string;
  updatedAt?: string;
  message?: string;
  code?: string;
  conflicts?: WarehouseConflict[];
};

export type AddressMutationResponse = {
  success?: boolean;
  addressId?: string;
  assignedCount?: number;
  clearedCount?: number;
  updatedAt?: string;
  message?: string;
  code?: string;
};

export interface ConfigHistoryShelf {
  coluna: string;
  linha: number;
  tipo: StorageType;
  andares: AndarConfig[];
}

export interface ConfigHistorySnapshot {
  colunas: string[];
  linhas: number[];
  prateleiras: ConfigHistoryShelf[];
}

export type ConfigHistoryEntry = {
  id: string;
  createdAt: string;
  createdByName: string;
  details: {
    before?: ConfigHistorySnapshot;
    after?: ConfigHistorySnapshot;
    colunas?: string[];
    linhas?: number[];
  };
};

export type ConfigHistoryResponse = {
  entries?: ConfigHistoryEntry[];
  total?: number;
  page?: number;
  pageSize?: number;
  message?: string;
};
