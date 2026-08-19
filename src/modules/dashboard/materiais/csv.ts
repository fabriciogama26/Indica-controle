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
  categoryName: string | null;
  subcategoryName: string | null;
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

function normalizeText(value: string) {
  return String(value ?? "").trim();
}

export function normalizeCsvHeader(value: string) {
  return normalizeText(value)
    .replace(/^\uFEFF/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function normalizeLookupText(value: string) {
  return normalizeCsvHeader(value);
}

export function resolveCsvValue(row: Record<string, string>, aliases: string[]) {
  for (const alias of aliases) {
    const value = row[alias];
    if (value !== undefined) {
      return value;
    }
  }

  return "";
}

export function normalizeSerialTrackingInput(value: string): SerialTrackingType | null {
  const normalized = normalizeCsvHeader(value);
  if (!normalized || normalized === "nao" || normalized === "none" || normalized === "sem_rastreio") {
    return "NONE";
  }

  if (normalized === "trafo" || normalized === "transformador") {
    return "TRAFO";
  }

  if (normalized === "religador") {
    return "RELIGADOR";
  }

  if (normalized === "chave" || normalized === "chaves") {
    return "CHAVE";
  }

  return null;
}

export function parseNonNegativeCurrency(value: string) {
  const raw = normalizeText(value);
  if (!raw) {
    return 0;
  }

  const withoutSpaces = raw.replace(/\s+/g, "");
  const lastComma = withoutSpaces.lastIndexOf(",");
  const lastDot = withoutSpaces.lastIndexOf(".");
  const decimalSeparator = lastComma > lastDot ? "," : lastDot > -1 ? "." : "";
  const normalized = decimalSeparator
    ? withoutSpaces
        .replace(new RegExp(`\\${decimalSeparator === "," ? "." : ","}`, "g"), "")
        .replace(decimalSeparator, ".")
    : withoutSpaces;
  const parsed = Number(normalized);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Number(parsed.toFixed(2));
}

export function buildMassImportTemplateCsv() {
  return "\uFEFFcodigo;descricao;categoria;subcategoria;tipo;umb;preco;estoque_minimo;estoque_maximo;rastreio_por_serial\nMAT-001;Cabo multiplexado;Cabos e condutores;Cabo multiplexado;NOVO;M;12,50;10;100;NAO\nMAT-002;Religador automatico;Protecao e manobra;Religador;NOVO;UN;0;1;;RELIGADOR\nMAT-003;Chave faca;Protecao e manobra;Chave seccionadora/faca;SUCATA;UN;;0;;CHAVE\n";
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
    material.categoryName ?? "",
    material.subcategoryName ?? "",
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
