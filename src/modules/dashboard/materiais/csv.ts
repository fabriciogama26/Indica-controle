import { SerialTrackingType, serialTrackingLabel } from "@/lib/materialSerialTracking";
import { escapeCsvValue } from "@/lib/utils/csv";
import { formatAuditActor, formatDateTime } from "@/lib/utils/formatters";

export type MassImportIssue = {
  rowNumber: number;
  column: string;
  value: string;
  error: string;
};

export type MassImportErrorReportData = {
  fileName: string;
  content: string;
  errorRows: number;
  totalIssues: number;
};

type MaterialCsvItem = {
  codigo: string;
  descricao: string;
  categoria: string | null;
  subcategoria: string | null;
  tipo: string;
  serialTrackingType: SerialTrackingType;
  umb: string | null;
  unitPrice: number;
  stockMinimum: number;
  stockMaximum: number | null;
  isActive: boolean;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

function toCsv(lines: Array<Array<string | number>>) {
  return `\uFEFF${lines.map((line) => line.map((item) => escapeCsvValue(item)).join(";")).join("\n")}`;
}

export function buildMaterialsCsv(materialItems: MaterialCsvItem[]) {
  const header = [
    "Codigo",
    "Descricao",
    "Categoria",
    "Subcategoria",
    "Tipo",
    "Rastreio por serial",
    "UMB",
    "Preco",
    "Estoque minimo",
    "Estoque maximo",
    "Status",
    "Registrado por",
    "Registrado em",
    "Atualizado por",
    "Atualizado em",
  ];
  const rows = materialItems.map((material) => [
    material.codigo,
    material.descricao,
    material.categoria ?? "",
    material.subcategoria ?? "",
    material.tipo,
    serialTrackingLabel(material.serialTrackingType),
    material.umb ?? "",
    material.unitPrice.toFixed(2),
    material.stockMinimum.toFixed(2),
    material.stockMaximum === null ? "" : material.stockMaximum.toFixed(2),
    material.isActive ? "Ativo" : "Inativo",
    formatAuditActor(material.createdByName),
    formatDateTime(material.createdAt),
    formatAuditActor(material.updatedByName),
    formatDateTime(material.updatedAt),
  ]);

  return toCsv([header, ...rows]);
}

function buildMassImportErrorCsv(issues: MassImportIssue[]) {
  const header = ["linha", "coluna", "valor", "erro"];
  const rows = issues.map((issue) => [
    issue.rowNumber,
    issue.column,
    issue.value,
    issue.error,
  ]);
  return toCsv([header, ...rows]);
}

export function createMassImportErrorReport(issues: MassImportIssue[]) {
  if (!issues.length) {
    return null;
  }

  const errorRows = new Set(issues.map((issue) => issue.rowNumber)).size;
  return {
    fileName: `materiais_erros_${new Date().toISOString().slice(0, 10)}.csv`,
    content: buildMassImportErrorCsv(issues),
    errorRows,
    totalIssues: issues.length,
  };
}
