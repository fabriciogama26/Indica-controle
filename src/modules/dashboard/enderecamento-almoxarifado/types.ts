export interface AndarConfig {
  numero: number;
  qtdPosicoes: number;
}

export interface Prateleira {
  id: string;
  coluna: string;
  linha: number;
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
  configuracao?: WarehouseConfiguracao | null;
  message?: string;
};

export type WarehouseMapResponse = WarehouseConfigResponse & {
  materiais?: WarehouseMaterial[];
};

export type SaveMapResponse = {
  success?: boolean;
  mapId?: string;
  updatedAt?: string;
  message?: string;
  code?: string;
};

export type AddressMutationResponse = {
  success?: boolean;
  addressId?: string;
  updatedAt?: string;
  message?: string;
  code?: string;
};
