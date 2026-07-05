import type {
  AddressMutationResponse,
  ConfiguracaoMapa,
  SaveMapResponse,
  WarehouseConfigResponse,
  WarehouseConflict,
  WarehouseMapResponse,
} from "./types";

function authHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
  };
}

export class WarehouseMapConflictError extends Error {
  conflicts: WarehouseConflict[];

  constructor(message: string, conflicts: WarehouseConflict[]) {
    super(message);
    this.name = "WarehouseMapConflictError";
    this.conflicts = conflicts;
  }
}

export async function fetchWarehouseConfig(params: { accessToken: string; stockCenterId?: string | null }) {
  const query = params.stockCenterId ? `?stockCenterId=${encodeURIComponent(params.stockCenterId)}` : "";
  const response = await fetch(`/api/warehouse-addressing/config${query}`, {
    cache: "no-store",
    headers: authHeaders(params.accessToken),
  });
  const data = (await response.json().catch(() => ({}))) as WarehouseConfigResponse;
  if (!response.ok) {
    throw new Error(data.message ?? "Falha ao carregar configuracao do mapa.");
  }
  return data;
}

export async function saveWarehouseConfig(params: {
  accessToken: string;
  stockCenterId: string;
  config: ConfiguracaoMapa;
  expectedUpdatedAt?: string | null;
}) {
  const response = await fetch("/api/warehouse-addressing/config", {
    method: "POST",
    cache: "no-store",
    headers: {
      ...authHeaders(params.accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      stockCenterId: params.stockCenterId,
      colunas: params.config.colunas,
      linhas: params.config.linhas,
      prateleiras: params.config.prateleiras,
      expectedUpdatedAt: params.expectedUpdatedAt ?? null,
    }),
  });
  const data = (await response.json().catch(() => ({}))) as SaveMapResponse;
  if (!response.ok) {
    if (data.code === "ADDRESSES_OUTSIDE_NEW_LAYOUT" && Array.isArray(data.conflicts) && data.conflicts.length > 0) {
      throw new WarehouseMapConflictError(data.message ?? "Falha ao salvar configuracao do mapa.", data.conflicts);
    }
    throw new Error(data.message ?? "Falha ao salvar configuracao do mapa.");
  }
  return data;
}

export async function fetchWarehouseMap(params: { accessToken: string; stockCenterId?: string | null }) {
  const query = params.stockCenterId ? `?stockCenterId=${encodeURIComponent(params.stockCenterId)}` : "";
  const response = await fetch(`/api/warehouse-addressing/map${query}`, {
    cache: "no-store",
    headers: authHeaders(params.accessToken),
  });
  const data = (await response.json().catch(() => ({}))) as WarehouseMapResponse;
  if (!response.ok) {
    throw new Error(data.message ?? "Falha ao carregar mapa do almoxarifado.");
  }
  return data;
}

export async function assignWarehouseAddress(params: {
  accessToken: string;
  mapId: string;
  materialId: string;
  coluna: string;
  linha: number;
  andar: number;
  posicao: number;
  expectedUpdatedAt?: string | null;
}) {
  const response = await fetch("/api/warehouse-addressing/map", {
    method: "POST",
    cache: "no-store",
    headers: {
      ...authHeaders(params.accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  const data = (await response.json().catch(() => ({}))) as AddressMutationResponse;
  if (!response.ok) {
    throw new Error(data.message ?? "Falha ao atribuir endereco.");
  }
  return data;
}

export async function assignWarehouseAddressBatch(params: {
  accessToken: string;
  mapId: string;
  assignments: Array<{
    materialId: string;
    coluna: string;
    linha: number;
    andar: number;
    posicao: number;
  }>;
}) {
  const response = await fetch("/api/warehouse-addressing/map", {
    method: "POST",
    cache: "no-store",
    headers: {
      ...authHeaders(params.accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      mapId: params.mapId,
      assignments: params.assignments,
    }),
  });
  const data = (await response.json().catch(() => ({}))) as AddressMutationResponse;
  if (!response.ok) {
    throw new Error(data.message ?? "Falha ao enderecar materiais em massa.");
  }
  return data;
}

export async function clearWarehouseAddress(params: {
  accessToken: string;
  mapId: string;
  materialId: string;
  expectedUpdatedAt: string;
}) {
  const response = await fetch("/api/warehouse-addressing/map", {
    method: "DELETE",
    cache: "no-store",
    headers: {
      ...authHeaders(params.accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  const data = (await response.json().catch(() => ({}))) as AddressMutationResponse;
  if (!response.ok) {
    throw new Error(data.message ?? "Falha ao remover endereco.");
  }
  return data;
}

export async function clearWarehouseCellAddresses(params: {
  accessToken: string;
  mapId: string;
  coluna: string;
  linha: number;
}) {
  const response = await fetch("/api/warehouse-addressing/map", {
    method: "DELETE",
    cache: "no-store",
    headers: {
      ...authHeaders(params.accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      mapId: params.mapId,
      coluna: params.coluna,
      linha: params.linha,
    }),
  });
  const data = (await response.json().catch(() => ({}))) as AddressMutationResponse;
  if (!response.ok) {
    throw new Error(data.message ?? "Falha ao limpar materiais da posicao.");
  }
  return data;
}
