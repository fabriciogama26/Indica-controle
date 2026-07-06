import type { ConfigHistorySnapshot, ConfiguracaoMapa, Prateleira, StorageType, StorageTypeOption, WarehouseMaterial } from "./types";

export const DEFAULT_STORAGE_TYPE_OPTIONS: StorageTypeOption[] = [
  { code: "SHELF", label: "Prateleira", usesFloors: true },
  { code: "PALLET", label: "Pallet", usesFloors: false },
  { code: "BAIA", label: "Baia", usesFloors: false },
];

export function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function buildColumnLabels(count: number) {
  return Array.from({ length: Math.max(1, count) }, (_, index) => {
    let value = "";
    let current = index;
    do {
      value = String.fromCharCode(65 + (current % 26)) + value;
      current = Math.floor(current / 26) - 1;
    } while (current >= 0);
    return value;
  });
}

export function buildLineLabels(count: number) {
  return Array.from({ length: Math.max(1, count) }, (_, index) => index + 1);
}

export function shelfKey(coluna: string, linha: number) {
  return `${coluna}-${linha}`;
}

export function positionCode(coluna: string, linha: number, andar: number, posicao: number) {
  return `${coluna}${linha}-A${andar}-P${posicao}`;
}

export function storageTypeLabel(tipo: StorageType, options: StorageTypeOption[] = DEFAULT_STORAGE_TYPE_OPTIONS) {
  return options.find((option) => option.code === tipo)?.label ?? tipo;
}

export function storageTypeUsesFloors(tipo: StorageType, options: StorageTypeOption[] = DEFAULT_STORAGE_TYPE_OPTIONS) {
  return options.find((option) => option.code === tipo)?.usesFloors ?? true;
}

export function findShelf(config: ConfiguracaoMapa | null, coluna: string, linha: number) {
  return config?.prateleiras.find((shelf) => shelf.coluna === coluna && shelf.linha === linha) ?? null;
}

export function countPositions(config: ConfiguracaoMapa | null) {
  return (config?.prateleiras ?? []).reduce(
    (total, shelf) => total + shelf.andares.reduce((floorTotal, floor) => floorTotal + floor.qtdPosicoes, 0),
    0,
  );
}

export function buildDefaultShelf(coluna: string, linha: number, tipo: StorageType = "SHELF"): Prateleira {
  return {
    id: `local-${coluna}-${linha}`,
    coluna,
    linha,
    tipo,
    andares: [{ numero: 1, qtdPosicoes: 1 }],
  };
}

export function normalizeStorageFloors(
  tipo: StorageType,
  andares: Prateleira["andares"],
  options: StorageTypeOption[] = DEFAULT_STORAGE_TYPE_OPTIONS,
) {
  if (!storageTypeUsesFloors(tipo, options)) {
    return [{ numero: 1, qtdPosicoes: andares[0]?.qtdPosicoes ?? 1 }];
  }

  return andares.length > 0 ? andares : [{ numero: 1, qtdPosicoes: 1 }];
}

export function materialStatus(material: WarehouseMaterial | null | undefined) {
  if (!material) return "vago" as const;
  if (material.estoqueMaximo !== null && material.estoqueMaximo > 0 && material.quantidade >= material.estoqueMaximo * 0.9) {
    return "lotado" as const;
  }
  if (material.quantidade <= material.estoqueMinimo) {
    return "baixo" as const;
  }
  return "ok" as const;
}

export function floorOccupancyCounts(shelf: Prateleira, floorNumber: number, materials: WarehouseMaterial[]) {
  const floor = shelf.andares.find((item) => item.numero === floorNumber);
  const total = floor?.qtdPosicoes ?? 0;

  const occupied = materials.reduce(
    (count, material) =>
      count + material.enderecos.filter(
        (address) => address.coluna === shelf.coluna && address.linha === shelf.linha && address.andar === floorNumber,
      ).length,
    0,
  );

  return { occupied, total };
}

export function summarizeConfigHistoryChanges(
  before: ConfigHistorySnapshot | null | undefined,
  after: ConfigHistorySnapshot | null | undefined,
  storageTypes: StorageTypeOption[] = DEFAULT_STORAGE_TYPE_OPTIONS,
): string[] {
  if (!before || !after) return [];

  const summary: string[] = [];

  if (before.colunas.join(",") !== after.colunas.join(",")) {
    summary.push(`Colunas: ${before.colunas.join(", ") || "-"} -> ${after.colunas.join(", ") || "-"}`);
  }

  if (before.linhas.join(",") !== after.linhas.join(",")) {
    summary.push(`Linhas: ${before.linhas.join(", ") || "-"} -> ${after.linhas.join(", ") || "-"}`);
  }

  const beforeMap = new Map(before.prateleiras.map((shelf) => [shelfKey(shelf.coluna, shelf.linha), shelf]));
  const afterMap = new Map(after.prateleiras.map((shelf) => [shelfKey(shelf.coluna, shelf.linha), shelf]));

  for (const [key, shelf] of afterMap) {
    const beforeShelf = beforeMap.get(key);
    const label = `${shelf.coluna}${shelf.linha}`;

    if (!beforeShelf) {
      summary.push(`Adicionada ${label} (${storageTypeLabel(shelf.tipo, storageTypes)})`);
      continue;
    }

    const beforeSerialized = JSON.stringify({ tipo: beforeShelf.tipo, andares: beforeShelf.andares });
    const afterSerialized = JSON.stringify({ tipo: shelf.tipo, andares: shelf.andares });
    if (beforeSerialized !== afterSerialized) {
      summary.push(`Alterada ${label}: ${storageTypeLabel(beforeShelf.tipo, storageTypes)} -> ${storageTypeLabel(shelf.tipo, storageTypes)}`);
    }
  }

  for (const [key, shelf] of beforeMap) {
    if (!afterMap.has(key)) {
      summary.push(`Removida ${shelf.coluna}${shelf.linha} (${storageTypeLabel(shelf.tipo, storageTypes)})`);
    }
  }

  return summary;
}

export function formatQuantity(value: number, unit: string) {
  const formatted = Number(value || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `${formatted} ${unit}`.trim();
}
