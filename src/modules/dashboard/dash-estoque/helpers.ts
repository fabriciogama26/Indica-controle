import type { ScatterOperation, ScatterPoint, ScatterQuantityBand, ScatterScale } from "./types";

export const operationLabels: Record<ScatterOperation, string> = {
  REQUISITION: "Requisicao",
  RETURN: "Devolucao",
};

export const evolutionKeys = [
  { key: "entry", label: "Entrada", color: "#2563eb" },
  { key: "exit", label: "Saida", color: "#dc2626" },
  { key: "transfer", label: "Transferencia", color: "#64748b" },
  { key: "requisition", label: "Requisicao", color: "#7c3aed" },
  { key: "return", label: "Devolucao", color: "#059669" },
  { key: "fieldReturn", label: "Retorno campo", color: "#d97706" },
] as const;

export const evolutionEstimatedValueHelp =
  "Valor estimado mensal = soma de (quantidade movimentada x preco unitario do material) dos itens validos do mes, respeitando os filtros aplicados e excluindo estornos/movimentos estornados.";

const scatterQuantityPalette = [
  { color: "#64748b", stroke: "#334155" },
  { color: "#2563eb", stroke: "#1d4ed8" },
  { color: "#0891b2", stroke: "#0e7490" },
  { color: "#059669", stroke: "#047857" },
  { color: "#65a30d", stroke: "#4d7c0f" },
  { color: "#ca8a04", stroke: "#a16207" },
  { color: "#d97706", stroke: "#b45309" },
  { color: "#dc2626", stroke: "#b91c1c" },
  { color: "#9333ea", stroke: "#7e22ce" },
  { color: "#db2777", stroke: "#be185d" },
  { color: "#4f46e5", stroke: "#4338ca" },
  { color: "#0f766e", stroke: "#115e59" },
] as const;

export function getCurrentYearPeriod() {
  const year = new Date().getFullYear();
  return {
    start: `${year}-01-01`,
    end: `${year}-12-31`,
  };
}

export function formatDecimal(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatPercent(value: number) {
  return `${formatDecimal(value)}%`;
}

export function formatDate(value: string | null) {
  if (!value) return "Sem movimento";
  const normalized = value.slice(0, 10);
  const [year, month, day] = normalized.split("-");
  if (!year || !month || !day) return "Sem movimento";
  return `${day}/${month}/${year}`;
}

export function formatExportDate() {
  return new Date().toISOString().slice(0, 10);
}

export function formatFileNamePart(value: string) {
  return normalizeTextForFileName(value).toLowerCase();
}

function normalizeTextForFileName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "materiais";
}

export function maxValue(values: number[]) {
  return Math.max(1, ...values.map((value) => Number(value) || 0));
}

export function truncateLabel(value: string, maxLength = 22) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

export function scaleScatterValue(value: number, max: number, scale: ScatterScale) {
  if (max <= 0) return 0;
  const normalized = Math.max(0, value) / max;
  if (scale === "sqrt") return Math.sqrt(normalized);
  return normalized;
}

export function scatterOffset(seed: string, index: number, expanded: boolean) {
  const base = seed.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) + index * 17;
  const angle = (base % 360) * (Math.PI / 180);
  const distance = expanded ? 8 + (base % 9) : 4 + (base % 5);
  return {
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance,
  };
}

function hslToHex(hue: number, saturation: number, lightness: number) {
  const normalizedSaturation = saturation / 100;
  const normalizedLightness = lightness / 100;
  const chroma = (1 - Math.abs(2 * normalizedLightness - 1)) * normalizedSaturation;
  const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = normalizedLightness - chroma / 2;
  const [red, green, blue] =
    hue < 60 ? [chroma, second, 0] :
      hue < 120 ? [second, chroma, 0] :
        hue < 180 ? [0, chroma, second] :
          hue < 240 ? [0, second, chroma] :
            hue < 300 ? [second, 0, chroma] :
              [chroma, 0, second];

  return `#${[red, green, blue]
    .map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

function getScatterQuantityPalette(index: number) {
  if (index < scatterQuantityPalette.length) return scatterQuantityPalette[index];

  const hue = (index * 47) % 360;
  const saturation = 66 + (index % 4) * 4;
  const lightness = 36 + (index % 3) * 5;
  return {
    color: hslToHex(hue, saturation, lightness),
    stroke: hslToHex(hue, Math.min(86, saturation + 8), Math.max(24, lightness - 10)),
  };
}

export function buildScatterQuantityBands(points: ScatterPoint[]) {
  const maxQuantity = maxValue(points.map((point) => point.quantity));
  const thresholds = [10, 20, 30, 40, 50, 100, 200];
  for (let upper = 400; upper < maxQuantity + 200; upper += 200) {
    thresholds.push(upper);
  }

  return thresholds.map<ScatterQuantityBand>((upper, index) => {
    const minExclusive = index === 0 ? 0 : thresholds[index - 1];
    const palette = getScatterQuantityPalette(index);
    return {
      minExclusive,
      maxInclusive: upper,
      label: index === 0 ? `<= ${upper}` : `${minExclusive + 1}-${upper}`,
      color: palette.color,
      stroke: palette.stroke,
    };
  });
}

export function isScatterQuantityInBand(quantity: number, band: ScatterQuantityBand) {
  return quantity <= band.maxInclusive && (band.minExclusive === 0 ? quantity >= 0 : quantity > band.minExclusive);
}

export function getScatterQuantityBand(quantity: number, bands: ScatterQuantityBand[]) {
  return bands.find((band) => isScatterQuantityInBand(quantity, band)) ?? bands[bands.length - 1];
}
