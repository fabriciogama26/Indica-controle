// Classificacao e ordenacao de apresentacao do Dashboard Estoque, sobre a lista de
// materiais ja agregada pela RPC (migration 439).
//
// As funcoes sao as mesmas que viviam em `src/app/api/dash-estoque/route.ts` ate 2026-09-14.
// Ficam no Node de proposito: operam sobre poucas linhas por material (nao sobre movimentacao
// bruta) e mantem a ordenacao `localeCompare("pt-BR")` sem depender da collation do banco.
import type { DashboardMaterialRow, OptionRow, ScatterMaterialRow, ScatterUnitRow } from "./aggregates";

const DASH_SCATTER_ROWS_PER_UNIT = 25;
const DASH_SCATTER_ROWS_PER_OPERATION = 200;

export type MaterialAggregate = DashboardMaterialRow & {
  estimatedValue: number;
};

type MaterialDetail = {
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

function toTimestamp(value: string | null) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareText(left: string, right: string) {
  return String(left ?? "").localeCompare(String(right ?? ""), "pt-BR");
}

export function buildMaterialAggregates(rows: DashboardMaterialRow[]): MaterialAggregate[] {
  return rows
    .map((item) => ({
      ...item,
      estimatedValue: item.balanceQuantity * item.unitPrice,
    }))
    .sort((left, right) => compareText(left.materialCode, right.materialCode));
}

export function buildSummaryByUnit(materials: MaterialAggregate[]) {
  return Array.from(
    materials.reduce((summary, item) => {
      const current = summary.get(item.unit) ?? { unit: item.unit, balanceQuantity: 0, materialCount: 0 };
      current.balanceQuantity += item.balanceQuantity;
      current.materialCount += 1;
      summary.set(item.unit, current);
      return summary;
    }, new Map<string, { unit: string; balanceQuantity: number; materialCount: number }>()),
    ([, value]) => value,
  ).sort((left, right) => compareText(left.unit, right.unit));
}

export function sortOptions(options: OptionRow[]) {
  return [...options].sort((left, right) => compareText(left.label, right.label));
}

export function buildCriticalRows(items: MaterialAggregate[], criticalQty: number) {
  return items
    .filter((item) => item.balanceQuantity <= criticalQty)
    .sort((left, right) => left.balanceQuantity - right.balanceQuantity || compareText(left.materialCode, right.materialCode))
    .slice(0, 12)
    .map((item) => ({
      materialId: item.materialId,
      materialCode: item.materialCode,
      description: item.description,
      unit: item.unit,
      balanceQuantity: item.balanceQuantity,
      status: item.balanceQuantity <= 0 ? "ZERADO" : "CRITICO",
    }));
}

export function buildTopBalanceRows(items: MaterialAggregate[]) {
  return [...items]
    .sort((left, right) => right.balanceQuantity - left.balanceQuantity)
    .slice(0, 12)
    .map((item) => ({
      materialId: item.materialId,
      materialCode: item.materialCode,
      description: item.description,
      unit: item.unit,
      balanceQuantity: item.balanceQuantity,
    }));
}

function buildMaterialDetail(item: MaterialAggregate, extra: Partial<Pick<MaterialDetail, "idleDays" | "abcPercentage">> = {}): MaterialDetail {
  return {
    materialId: item.materialId,
    materialCode: item.materialCode,
    description: item.description,
    unit: item.unit,
    materialType: item.materialType,
    unitPrice: item.unitPrice,
    balanceQuantity: item.balanceQuantity,
    estimatedValue: item.estimatedValue,
    lastMovementAt: item.lastMovementAt,
    ...extra,
  };
}

export function buildIdleBuckets(items: MaterialAggregate[]) {
  const now = new Date();
  const buckets = [
    { key: "ate30", label: "Ate 30 dias", minDays: 0, maxDays: 30, materialCount: 0, balanceQuantity: 0, materials: [] as MaterialDetail[] },
    { key: "31a60", label: "31 a 60 dias", minDays: 31, maxDays: 60, materialCount: 0, balanceQuantity: 0, materials: [] as MaterialDetail[] },
    { key: "61a90", label: "61 a 90 dias", minDays: 61, maxDays: 90, materialCount: 0, balanceQuantity: 0, materials: [] as MaterialDetail[] },
    { key: "mais90", label: "Mais de 90 dias", minDays: 91, maxDays: null, materialCount: 0, balanceQuantity: 0, materials: [] as MaterialDetail[] },
    { key: "semData", label: "Sem movimento", minDays: null, maxDays: null, materialCount: 0, balanceQuantity: 0, materials: [] as MaterialDetail[] },
  ];

  for (const item of items) {
    let bucket = buckets[buckets.length - 1];
    let idleDays: number | null = null;
    if (item.lastMovementAt) {
      const lastMovementTimestamp = toTimestamp(item.lastMovementAt);
      if (lastMovementTimestamp > 0) {
        idleDays = Math.max(0, Math.floor((now.getTime() - lastMovementTimestamp) / 86400000));
        bucket = buckets.find((candidate) => {
          if (candidate.minDays === null) return false;
          if (candidate.maxDays === null) return idleDays !== null && idleDays >= candidate.minDays;
          return idleDays !== null && idleDays >= candidate.minDays && idleDays <= candidate.maxDays;
        }) ?? bucket;
      }
    }

    bucket.materialCount += 1;
    bucket.balanceQuantity += item.balanceQuantity;
    bucket.materials.push(buildMaterialDetail(item, { idleDays }));
  }

  return buckets.map(({ key, label, materialCount, balanceQuantity, materials }) => ({
    key,
    label,
    materialCount,
    balanceQuantity,
    materials: materials.sort((left, right) => compareText(left.materialCode, right.materialCode)),
  }));
}

export function buildAbcRows(items: MaterialAggregate[], mode: "value" | "quantity" = "value") {
  const rankedItems = [...items]
    .map((item) => ({
      ...item,
      estimatedValue: item.balanceQuantity * item.unitPrice,
      abcMetric: mode === "quantity" ? Math.max(0, item.balanceQuantity) : item.balanceQuantity * item.unitPrice,
    }))
    .sort((left, right) => right.abcMetric - left.abcMetric);
  const totalMetric = rankedItems.reduce((sum, item) => sum + item.abcMetric, 0);
  let cumulative = 0;
  const classes = new Map([
    ["A", { className: "A" as const, materialCount: 0, estimatedValue: 0, balanceQuantity: 0, metricValue: 0, materials: [] as MaterialDetail[] }],
    ["B", { className: "B" as const, materialCount: 0, estimatedValue: 0, balanceQuantity: 0, metricValue: 0, materials: [] as MaterialDetail[] }],
    ["C", { className: "C" as const, materialCount: 0, estimatedValue: 0, balanceQuantity: 0, metricValue: 0, materials: [] as MaterialDetail[] }],
  ]);

  for (const item of rankedItems) {
    cumulative += item.abcMetric;
    const percentage = totalMetric > 0 ? (cumulative / totalMetric) * 100 : 100;
    const className = percentage <= 80 ? "A" : percentage <= 95 ? "B" : "C";
    const row = classes.get(className)!;
    row.materialCount += 1;
    row.estimatedValue += item.estimatedValue;
    row.balanceQuantity += item.balanceQuantity;
    row.metricValue += item.abcMetric;
    row.materials.push(buildMaterialDetail(item, {
      abcPercentage: totalMetric > 0 ? (item.abcMetric / totalMetric) * 100 : 0,
    }));
  }

  return Array.from(classes.values()).map((row) => ({
    className: row.className,
    materialCount: row.materialCount,
    estimatedValue: row.estimatedValue,
    balanceQuantity: row.balanceQuantity,
    percentage: totalMetric > 0 ? (row.metricValue / totalMetric) * 100 : 0,
    materials: row.materials,
  }));
}

export function buildScatterRows(rows: ScatterMaterialRow[]) {
  // O corte precisa ser por UMB: quantidades em M e UN tem ordens de grandeza
  // diferentes e um corte global esconderia unidades inteiras do grafico.
  const byOperationUnit = new Map<string, ScatterMaterialRow[]>();
  for (const row of rows) {
    const unit = row.unit || "SEM UMB";
    const key = `${row.operationKind}:${unit}`;
    const normalizedRow = { ...row, unit };
    const bucket = byOperationUnit.get(key);
    if (bucket) bucket.push(normalizedRow);
    else byOperationUnit.set(key, [normalizedRow]);
  }

  const byOperation = new Map<"REQUISITION" | "RETURN", ScatterMaterialRow[]>();
  for (const bucket of byOperationUnit.values()) {
    const topRows = bucket
      .sort((left, right) => right.quantity - left.quantity)
      .slice(0, DASH_SCATTER_ROWS_PER_UNIT);
    const operationKind = topRows[0].operationKind;
    const target = byOperation.get(operationKind);
    if (target) target.push(...topRows);
    else byOperation.set(operationKind, topRows);
  }

  return Array.from(byOperation.values()).flatMap((bucket) =>
    bucket
      .sort((left, right) => right.quantity - left.quantity)
      .slice(0, DASH_SCATTER_ROWS_PER_OPERATION)
      .map((row) => ({
        materialId: row.materialId,
        materialCode: row.materialCode,
        description: row.description,
        unit: row.unit,
        operationKind: row.operationKind,
        quantity: row.quantity,
        operationCount: row.operationCount,
        projectCount: row.projectCount,
        currentBalance: row.currentBalance,
      })),
  );
}

export function sortScatterSummaryByUnit(rows: ScatterUnitRow[]) {
  return [...rows]
    .map((row) => ({ ...row, unit: row.unit || "SEM UMB" }))
    .sort(
      (left, right) =>
        left.operationKind.localeCompare(right.operationKind) ||
        compareText(left.unit, right.unit),
    );
}
