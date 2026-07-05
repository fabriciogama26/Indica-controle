import type { ConfiguracaoMapa, Prateleira, WarehouseMaterial } from "./types";

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

export function findShelf(config: ConfiguracaoMapa | null, coluna: string, linha: number) {
  return config?.prateleiras.find((shelf) => shelf.coluna === coluna && shelf.linha === linha) ?? null;
}

export function countPositions(config: ConfiguracaoMapa | null) {
  return (config?.prateleiras ?? []).reduce(
    (total, shelf) => total + shelf.andares.reduce((floorTotal, floor) => floorTotal + floor.qtdPosicoes, 0),
    0,
  );
}

export function buildDefaultShelf(coluna: string, linha: number): Prateleira {
  return {
    id: `local-${coluna}-${linha}`,
    coluna,
    linha,
    andares: [{ numero: 1, qtdPosicoes: 1 }],
  };
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

export function floorOccupancyStatus(shelf: Prateleira, floorNumber: number, materials: WarehouseMaterial[]) {
  const floor = shelf.andares.find((item) => item.numero === floorNumber);
  if (!floor) return "empty" as const;

  const occupied = materials.filter(
    (material) =>
      material.coluna === shelf.coluna
      && material.linha === shelf.linha
      && material.andar === floorNumber,
  ).length;

  if (occupied === 0) return "empty" as const;
  if (occupied >= floor.qtdPosicoes) return "full" as const;
  return "partial" as const;
}

export function formatQuantity(value: number, unit: string) {
  const formatted = Number(value || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `${formatted} ${unit}`.trim();
}
