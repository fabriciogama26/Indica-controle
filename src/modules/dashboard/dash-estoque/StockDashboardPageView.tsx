"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ActionIcon } from "@/components/ui/ActionIcon";
import { CsvExportButton } from "@/components/ui/CsvExportButton";
import { ExportProgressModal } from "@/components/ui/ExportProgressModal";
import { useAuth } from "@/hooks/useAuth";
import { useErrorLogger } from "@/hooks/useErrorLogger";
import { buildCsvContent, downloadCsvFile } from "@/lib/utils/csv";
import styles from "./StockDashboardPageView.module.css";

type Option = {
  id: string;
  label: string;
};

type StockCenterOption = {
  id: string;
  name: string;
  controlsBalance: boolean;
};

type Summary = {
  materialCount: number;
  totalBalanceQuantity: number;
  totalEstimatedValue: number;
  criticalCount: number;
  zeroCount: number;
  movementCount: number;
  totalMovementQuantity: number;
};

type UnitSummary = {
  unit: string;
  balanceQuantity: number;
  materialCount: number;
};

type CriticalMaterial = {
  materialId: string;
  materialCode: string;
  description: string;
  unit: string;
  balanceQuantity: number;
  status: "ZERADO" | "CRITICO";
};

type TopBalanceMaterial = {
  materialId: string;
  materialCode: string;
  description: string;
  unit: string;
  balanceQuantity: number;
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

type IdleBucket = {
  key: string;
  label: string;
  materialCount: number;
  balanceQuantity: number;
  materials: MaterialDetail[];
};

type AbcRow = {
  className: "A" | "B" | "C";
  materialCount: number;
  estimatedValue: number;
  balanceQuantity: number;
  percentage: number;
  materials: MaterialDetail[];
};

type EvolutionRow = {
  period: string;
  label: string;
  estimatedValue: number;
  entry: number;
  exit: number;
  transfer: number;
  requisition: number;
  return: number;
  fieldReturn: number;
};

type ScatterPoint = {
  materialId: string;
  materialCode: string;
  description: string;
  unit: string;
  operationKind: "REQUISITION" | "RETURN";
  quantity: number;
  operationCount: number;
  projectCount: number;
  currentBalance: number;
};

type ScatterUnitSummary = {
  operationKind: "REQUISITION" | "RETURN";
  unit: string;
  quantity: number;
  materialCount: number;
  operationCount: number;
};

type DashboardResponse = {
  message?: string;
  filters?: {
    stockCenters: StockCenterOption[];
    teams: Option[];
    projects: Option[];
  };
  appliedFilters?: {
    startDate: string;
    endDate: string;
    stockCenterId: string | null;
    teamId: string | null;
    projectId: string | null;
    materialCode: string;
    materialType: string;
    criticalQty: number;
  };
  summary?: Summary;
  summaryByUnit?: UnitSummary[];
  criticalMaterials?: CriticalMaterial[];
  topBalanceMaterials?: TopBalanceMaterial[];
  idleBuckets?: IdleBucket[];
  abcRows?: AbcRow[];
  abcQuantityRows?: AbcRow[];
  movementEvolution?: EvolutionRow[];
  scatterSummaryByUnit?: ScatterUnitSummary[];
  scatter?: ScatterPoint[];
};

type ScatterOperation = "REQUISITION" | "RETURN";
type ScatterScale = "sqrt" | "linear";
type AbcMode = "value" | "quantity";

type ScatterQuantityBand = {
  minExclusive: number;
  maxInclusive: number;
  label: string;
  color: string;
  stroke: string;
};

type MaterialModalState = {
  title: string;
  subtitle: string;
  rows: MaterialDetail[];
  showAbcPercentage?: boolean;
} | null;

const operationLabels: Record<ScatterOperation, string> = {
  REQUISITION: "Requisicao",
  RETURN: "Devolucao",
};

const evolutionKeys = [
  { key: "entry", label: "Entrada", color: "#2563eb" },
  { key: "exit", label: "Saida", color: "#dc2626" },
  { key: "transfer", label: "Transferencia", color: "#64748b" },
  { key: "requisition", label: "Requisicao", color: "#7c3aed" },
  { key: "return", label: "Devolucao", color: "#059669" },
  { key: "fieldReturn", label: "Retorno campo", color: "#d97706" },
] as const;

const evolutionEstimatedValueHelp =
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

function getCurrentYearPeriod() {
  const year = new Date().getFullYear();
  return {
    start: `${year}-01-01`,
    end: `${year}-12-31`,
  };
}

function formatDecimal(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number.isFinite(value) ? value : 0);
}

function formatPercent(value: number) {
  return `${formatDecimal(value)}%`;
}

function formatDate(value: string | null) {
  if (!value) return "Sem movimento";
  const normalized = value.slice(0, 10);
  const [year, month, day] = normalized.split("-");
  if (!year || !month || !day) return "Sem movimento";
  return `${day}/${month}/${year}`;
}

function formatExportDate() {
  return new Date().toISOString().slice(0, 10);
}

function formatFileNamePart(value: string) {
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

function maxValue(values: number[]) {
  return Math.max(1, ...values.map((value) => Number(value) || 0));
}

function truncateLabel(value: string, maxLength = 22) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function scaleScatterValue(value: number, max: number, scale: ScatterScale) {
  if (max <= 0) return 0;
  const normalized = Math.max(0, value) / max;
  if (scale === "sqrt") return Math.sqrt(normalized);
  return normalized;
}

function scatterOffset(seed: string, index: number, expanded: boolean) {
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

function buildScatterQuantityBands(points: ScatterPoint[]) {
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

function isScatterQuantityInBand(quantity: number, band: ScatterQuantityBand) {
  return quantity <= band.maxInclusive && (band.minExclusive === 0 ? quantity >= 0 : quantity > band.minExclusive);
}

function getScatterQuantityBand(quantity: number, bands: ScatterQuantityBand[]) {
  return bands.find((band) => isScatterQuantityInBand(quantity, band)) ?? bands[bands.length - 1];
}

function BarList<T extends { materialId: string; materialCode: string; description: string; unit: string; balanceQuantity: number }>(props: {
  rows: T[];
  variant?: "critical" | "default";
  emptyLabel: string;
}) {
  const max = maxValue(props.rows.map((row) => Math.abs(row.balanceQuantity)));

  return (
    <div className={styles.barList}>
      {props.rows.length ? (
        props.rows.map((row) => {
          const width = Math.max(4, (Math.abs(row.balanceQuantity) / max) * 100);
          return (
            <div key={row.materialId} className={styles.barRow}>
              <div className={styles.barRowLabel}>
                <strong>{row.materialCode}</strong>
                <span>{truncateLabel(row.description)}</span>
              </div>
              <div className={styles.barRowTrack}>
                <div
                  className={props.variant === "critical" ? styles.barRowFillCritical : styles.barRowFill}
                  style={{ width: `${width}%` }}
                />
              </div>
              <div className={styles.barRowValue}>
                {formatDecimal(row.balanceQuantity)} {row.unit}
              </div>
            </div>
          );
        })
      ) : (
        <div className={styles.emptyChart}>{props.emptyLabel}</div>
      )}
    </div>
  );
}

function IdleChart({ rows, onSelectBucket }: { rows: IdleBucket[]; onSelectBucket: (row: IdleBucket) => void }) {
  const max = maxValue(rows.map((row) => row.materialCount));

  return (
    <div className={styles.columnChart}>
      {rows.length ? (
        rows.map((row) => {
          const height = Math.max(4, (row.materialCount / max) * 100);
          return (
            <button
              key={row.key}
              type="button"
              className={styles.columnGroupButton}
              onClick={() => onSelectBucket(row)}
              aria-label={`Ver materiais da faixa ${row.label}`}
            >
              <div className={styles.columnValue}>{row.materialCount}</div>
              <div className={styles.columnTrack}>
                <div className={styles.columnFill} style={{ height: `${height}%` }} />
              </div>
              <strong>{row.label}</strong>
              <span>{formatDecimal(row.balanceQuantity)}</span>
            </button>
          );
        })
      ) : (
        <div className={styles.emptyChart}>Nenhum material encontrado.</div>
      )}
    </div>
  );
}

function AbcChart({ rows, mode, onSelectRow }: { rows: AbcRow[]; mode: AbcMode; onSelectRow: (row: AbcRow) => void }) {
  const total = rows.reduce((sum, row) => sum + (mode === "quantity" ? Math.max(0, row.balanceQuantity) : row.estimatedValue), 0);
  const metricLabel = mode === "quantity" ? "Quantidade" : "Valor";

  return (
    <div className={styles.abcBlock}>
      <div className={styles.abcStack}>
        {rows.map((row) => (
          <div
            key={row.className}
            className={row.className === "A" ? styles.abcA : row.className === "B" ? styles.abcB : styles.abcC}
            style={{ width: `${total > 0 ? Math.max(8, row.percentage) : 33.33}%` }}
          >
            {row.className}
          </div>
        ))}
      </div>
      <div className={styles.compactTableWrapper}>
        <table className={styles.compactTable}>
          <thead>
            <tr>
              <th>Classe</th>
              <th>Materiais</th>
              <th>{metricLabel}</th>
              <th>%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.className}
                className={styles.clickableTableRow}
                role="button"
                tabIndex={0}
                onClick={() => onSelectRow(row)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectRow(row);
                  }
                }}
              >
                <td><strong>{row.className}</strong></td>
                <td>{row.materialCount}</td>
                <td>{mode === "quantity" ? formatDecimal(row.balanceQuantity) : formatCurrency(row.estimatedValue)}</td>
                <td>{formatPercent(row.percentage)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MaterialDetailsModal({
  modal,
  isExporting,
  onClose,
  onExport,
}: {
  modal: MaterialModalState;
  isExporting: boolean;
  onClose: () => void;
  onExport: () => void;
}) {
  if (!modal) return null;

  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-label={modal.title}>
      <div className={`${styles.modal} ${styles.materialModal}`}>
        <div className={styles.modalHeader}>
          <div>
            <h2>{modal.title}</h2>
            <p>{modal.subtitle}</p>
          </div>
          <div className={styles.chartActions}>
            <CsvExportButton
              onClick={onExport}
              disabled={!modal.rows.length || isExporting}
              isLoading={isExporting}
              className={styles.expandButton}
              idleLabel="Exportar CSV"
              loadingLabel="Exportando..."
              modalMessage="Gerando CSV dos materiais do modal."
            />
            <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Fechar modal de materiais">
              x
            </button>
          </div>
        </div>
        <div className={styles.modalBody}>
          <div className={styles.materialModalSummary}>
            <span>{modal.rows.length} materiais</span>
            <strong>{formatCurrency(modal.rows.reduce((sum, row) => sum + row.estimatedValue, 0))}</strong>
          </div>
          <div className={styles.compactTableWrapper}>
            <table className={styles.compactTable}>
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Descricao</th>
                  <th>Tipo</th>
                  <th>UMB</th>
                  <th>Saldo</th>
                  <th>Valor estimado</th>
                  {modal.showAbcPercentage ? <th>% ABC</th> : null}
                  <th>Ult. mov.</th>
                  <th>Dias</th>
                </tr>
              </thead>
              <tbody>
                {modal.rows.map((row) => (
                  <tr key={row.materialId}>
                    <td><strong>{row.materialCode}</strong></td>
                    <td>{row.description}</td>
                    <td>{row.materialType}</td>
                    <td>{row.unit}</td>
                    <td>{formatDecimal(row.balanceQuantity)}</td>
                    <td>{formatCurrency(row.estimatedValue)}</td>
                    {modal.showAbcPercentage ? <td>{formatPercent(row.abcPercentage ?? 0)}</td> : null}
                    <td>{formatDate(row.lastMovementAt)}</td>
                    <td>{row.idleDays == null ? "-" : formatDecimal(row.idleDays)}</td>
                  </tr>
                ))}
                {!modal.rows.length ? (
                  <tr>
                    <td colSpan={modal.showAbcPercentage ? 9 : 8} className={styles.emptyRow}>Sem materiais.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function EvolutionChart({ rows }: { rows: EvolutionRow[] }) {
  const max = maxValue(rows.flatMap((row) => evolutionKeys.map((item) => Number(row[item.key]) || 0)));

  return (
    <div className={styles.evolutionBlock}>
      <div className={styles.legend}>
        {evolutionKeys.map((item) => (
          <span key={item.key}>
            <i style={{ background: item.color }} />
            {item.label}
          </span>
        ))}
      </div>
      <div className={styles.evolutionChart}>
        {rows.length ? (
          rows.map((row) => (
            <div key={row.period} className={styles.evolutionGroup}>
              <div className={styles.evolutionBars}>
                {evolutionKeys.map((item) => (
                  <div key={item.key} className={styles.evolutionBarItem}>
                    <span className={styles.evolutionBarValue}>{formatDecimal(Number(row[item.key]) || 0)}</span>
                    <div
                      className={styles.evolutionBar}
                      title={`${item.label}: ${formatDecimal(Number(row[item.key]) || 0)} operacoes`}
                      style={{
                        height: `${Math.max(2, ((Number(row[item.key]) || 0) / max) * 100)}%`,
                        background: item.color,
                      }}
                    />
                  </div>
                ))}
              </div>
              <div className={styles.evolutionPeriodLabel}>
                <strong>{row.label}</strong>
                <span>{formatCurrency(row.estimatedValue)}</span>
              </div>
            </div>
          ))
        ) : (
          <div className={styles.emptyChart}>Nenhuma movimentacao no periodo.</div>
        )}
      </div>
    </div>
  );
}

function ScatterChart({
  rows,
  operation,
  scale,
  expanded = false,
  selectedMaterialId = null,
  onSelectPoint,
}: {
  rows: ScatterPoint[];
  operation: ScatterOperation;
  scale: ScatterScale;
  expanded?: boolean;
  selectedMaterialId?: string | null;
  onSelectPoint?: (materialId: string | null) => void;
}) {
  const filtered = rows.filter((row) => row.operationKind === operation);
  const selectedPoint = selectedMaterialId
    ? filtered.find((row) => row.materialId === selectedMaterialId) ?? null
    : null;
  const visiblePoints = selectedPoint ? [selectedPoint] : filtered;
  const maxQuantity = selectedPoint
    ? Math.max(1, selectedPoint.quantity / (scale === "sqrt" ? 0.36 : 0.55))
    : maxValue(filtered.map((row) => row.quantity));
  const maxCount = selectedPoint
    ? Math.max(1, selectedPoint.operationCount / (scale === "sqrt" ? 0.36 : 0.55))
    : maxValue(filtered.map((row) => row.operationCount));
  const maxBalance = maxValue(filtered.map((row) => Math.abs(row.currentBalance)));
  const quantityBands = buildScatterQuantityBands(filtered);
  const visibleBands = quantityBands.filter((band) =>
    filtered.some((point) => isScatterQuantityInBand(point.quantity, band)),
  );
  const viewBox = expanded ? "0 0 1100 470" : "0 0 820 320";
  const axis = expanded
    ? { left: 64, right: 1040, top: 34, bottom: 390, width: 976, height: 356 }
    : { left: 48, right: 790, top: 24, bottom: 270, width: 742, height: 246 };

  return (
    <div className={expanded ? styles.scatterGridExpanded : styles.scatterGrid}>
      <div className={styles.scatterCanvas}>
        {filtered.length ? (
          <div className={styles.scatterLegend} aria-label="Legenda por quantidade">
            <strong>Quantidade</strong>
            {visibleBands.map((band) => (
              <span key={band.label}>
                <i style={{ backgroundColor: band.color }} />
                {band.label}
              </span>
            ))}
          </div>
        ) : null}
        {filtered.length ? (
          <svg viewBox={viewBox} role="img" aria-label={`Dispersao ${operationLabels[operation]}`}>
            <line x1={axis.left} y1={axis.bottom} x2={axis.right} y2={axis.bottom} className={styles.axisLine} />
            <line x1={axis.left} y1={axis.top} x2={axis.left} y2={axis.bottom} className={styles.axisLine} />
            <text x={axis.right} y={expanded ? 438 : 300} textAnchor="end" className={styles.axisLabel}>Quantidade</text>
            <text x={axis.left} y={expanded ? 22 : 16} className={styles.axisLabel}>Operacoes</text>
            {visiblePoints.map((point, index) => {
              const quantityBand = getScatterQuantityBand(point.quantity, quantityBands);
              const offset = scatterOffset(point.materialCode, index, expanded);
              const scaledX = Math.min(1, scaleScatterValue(point.quantity, maxQuantity, scale));
              const scaledY = Math.min(1, scaleScatterValue(point.operationCount, maxCount, scale));
              const x = axis.left + scaledX * axis.width + (selectedPoint ? 0 : offset.x);
              const y = axis.bottom - scaledY * axis.height + (selectedPoint ? 0 : offset.y);
              const radius = selectedPoint
                ? expanded ? 18 : 12
                : (expanded ? 4 : 3) + scaleScatterValue(Math.abs(point.currentBalance), maxBalance, "sqrt") * (expanded ? 10 : 7);
              const cx = Math.max(axis.left + radius, Math.min(axis.right - radius, x));
              const cy = Math.max(axis.top + radius, Math.min(axis.bottom - radius, y));
              return (
                <g key={`${point.operationKind}-${point.materialId}`}>
                  <circle
                    cx={cx}
                    cy={cy}
                    r={radius}
                    className={`${styles.scatterPoint} ${selectedPoint ? styles.scatterPointActive : ""}`}
                    style={{ fill: `${quantityBand.color}cc`, stroke: quantityBand.stroke }}
                    onClick={() => onSelectPoint?.(point.materialId)}
                  />
                  {selectedPoint ? (
                    <text x={Math.min(axis.right - 150, cx + radius + 12)} y={cy + 5} className={styles.scatterPointLabel}>
                      {point.materialCode} | {formatDecimal(point.quantity)} {point.unit}
                    </text>
                  ) : null}
                  <title>
                    {`${point.materialCode} - ${point.description} | ${formatDecimal(point.quantity)} ${point.unit} | ${point.operationCount} operacoes | saldo ${formatDecimal(point.currentBalance)}`}
                  </title>
                </g>
              );
            })}
          </svg>
        ) : (
          <div className={styles.emptyChart}>Nenhum ponto para a operacao selecionada.</div>
        )}
      </div>

      <div className={styles.scatterTableWrapper}>
        <div className={styles.scatterTableHeader}>
          <span>{filtered.length} materiais</span>
          {selectedPoint ? (
            <button type="button" className={styles.clearFocusButton} onClick={() => onSelectPoint?.(null)}>
              Todos
            </button>
          ) : null}
        </div>
        <table className={styles.compactTable}>
          <thead>
            <tr>
              <th>Material</th>
              <th>UMB</th>
              <th>Quantidade</th>
              <th>Operacoes</th>
              <th>Projetos</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((point) => (
              <tr
                key={`scatter-table-${point.operationKind}-${point.materialId}`}
                className={selectedPoint?.materialId === point.materialId ? styles.scatterRowActive : undefined}
              >
                <td>
                  <button
                    type="button"
                    className={styles.scatterRowButton}
                    title={point.description}
                    onClick={() => onSelectPoint?.(point.materialId)}
                  >
                    <strong>{point.materialCode}</strong>
                    <span>{truncateLabel(point.description)}</span>
                  </button>
                </td>
                <td>{point.unit || "SEM UMB"}</td>
                <td>{formatDecimal(point.quantity)}</td>
                <td>{point.operationCount}</td>
                <td>{point.projectCount}</td>
              </tr>
            ))}
            {!filtered.length ? (
              <tr>
                <td colSpan={5} className={styles.emptyRow}>Sem dados.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ScatterUnitStrip({ rows }: { rows: ScatterUnitSummary[] }) {
  if (!rows.length) return null;

  return (
    <div className={`${styles.unitStrip} ${styles.scatterUnitStrip}`}>
      {rows.map((item) => (
        <div key={`${item.operationKind}-${item.unit}`} className={styles.unitPill}>
          <span>{item.unit}</span>
          <strong>{formatDecimal(item.quantity)}</strong>
        </div>
      ))}
    </div>
  );
}

export function StockDashboardPageView() {
  const { session } = useAuth();
  const logError = useErrorLogger("dash_estoque");
  const hasLoadedInitialDashboard = useRef(false);
  const currentPeriod = useMemo(() => getCurrentYearPeriod(), []);
  const [startDate, setStartDate] = useState(currentPeriod.start);
  const [endDate, setEndDate] = useState(currentPeriod.end);
  const [stockCenterId, setStockCenterId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [materialCode, setMaterialCode] = useState("");
  const [materialType, setMaterialType] = useState("");
  const [criticalQty, setCriticalQty] = useState("5");
  const [scatterOperation, setScatterOperation] = useState<ScatterOperation>("REQUISITION");
  const [scatterScale, setScatterScale] = useState<ScatterScale>("sqrt");
  const [abcMode, setAbcMode] = useState<AbcMode>("value");
  const [isScatterExpanded, setIsScatterExpanded] = useState(false);
  const [selectedScatterMaterialId, setSelectedScatterMaterialId] = useState<string | null>(null);
  const [materialModal, setMaterialModal] = useState<MaterialModalState>(null);
  const [isExportingMaterialModal, setIsExportingMaterialModal] = useState(false);
  const [stockCenters, setStockCenters] = useState<StockCenterOption[]>([]);
  const [teams, setTeams] = useState<Option[]>([]);
  const [projects, setProjects] = useState<Option[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryByUnit, setSummaryByUnit] = useState<UnitSummary[]>([]);
  const [criticalMaterials, setCriticalMaterials] = useState<CriticalMaterial[]>([]);
  const [topBalanceMaterials, setTopBalanceMaterials] = useState<TopBalanceMaterial[]>([]);
  const [idleBuckets, setIdleBuckets] = useState<IdleBucket[]>([]);
  const [abcRows, setAbcRows] = useState<AbcRow[]>([]);
  const [abcQuantityRows, setAbcQuantityRows] = useState<AbcRow[]>([]);
  const [movementEvolution, setMovementEvolution] = useState<EvolutionRow[]>([]);
  const [scatterSummaryByUnit, setScatterSummaryByUnit] = useState<ScatterUnitSummary[]>([]);
  const [scatter, setScatter] = useState<ScatterPoint[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isExportingScatter, setIsExportingScatter] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const loadDashboard = useCallback(async () => {
    if (!session?.accessToken) return;

    const params = new URLSearchParams();
    params.set("startDate", startDate);
    params.set("endDate", endDate);
    params.set("criticalQty", criticalQty || "5");
    if (stockCenterId) params.set("stockCenterId", stockCenterId);
    if (teamId) params.set("teamId", teamId);
    if (projectId) params.set("projectId", projectId);
    if (materialCode.trim()) params.set("materialCode", materialCode.trim());
    if (materialType) params.set("materialType", materialType);

    setIsLoading(true);
    try {
      const response = await fetch(`/api/dash-estoque?${params.toString()}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      const payload = (await response.json().catch(() => ({}))) as DashboardResponse;

      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao carregar Dashboard Estoque.");
      }

      setStockCenters(payload.filters?.stockCenters ?? []);
      setTeams(payload.filters?.teams ?? []);
      setProjects(payload.filters?.projects ?? []);
      setSummary(payload.summary ?? null);
      setSummaryByUnit(payload.summaryByUnit ?? []);
      setCriticalMaterials(payload.criticalMaterials ?? []);
      setTopBalanceMaterials(payload.topBalanceMaterials ?? []);
      setIdleBuckets(payload.idleBuckets ?? []);
      setAbcRows(payload.abcRows ?? []);
      setAbcQuantityRows(payload.abcQuantityRows ?? []);
      setMovementEvolution(payload.movementEvolution ?? []);
      setScatterSummaryByUnit(payload.scatterSummaryByUnit ?? []);
      setScatter(payload.scatter ?? []);
      setMaterialModal(null);
      setIsExportingMaterialModal(false);
      setFeedback({ type: "success", message: "Dashboard Estoque atualizado." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao carregar Dashboard Estoque.";
      setFeedback({ type: "error", message });
      await logError("Falha ao carregar Dashboard Estoque", error, {
        startDate,
        endDate,
        stockCenterId,
        teamId,
        projectId,
        materialCode,
        materialType,
      });
    } finally {
      setIsLoading(false);
    }
  }, [criticalQty, endDate, logError, materialCode, materialType, projectId, session?.accessToken, startDate, stockCenterId, teamId]);

  const selectedScatterPoint = useMemo(
    () => scatter.find((row) => row.operationKind === scatterOperation && row.materialId === selectedScatterMaterialId) ?? null,
    [scatter, scatterOperation, selectedScatterMaterialId],
  );

  const activeScatterRows = useMemo(
    () => scatter.filter((row) => row.operationKind === scatterOperation),
    [scatter, scatterOperation],
  );

  const activeScatterUnitSummary = useMemo(
    () => {
      const operationRows = scatterSummaryByUnit.filter((row) => row.operationKind === scatterOperation);
      const operationByUnit = new Map(operationRows.map((row) => [row.unit, row]));
      const displayUnits = Array.from(
        new Set([
          ...summaryByUnit.map((row) => row.unit),
          ...operationRows.map((row) => row.unit),
        ]),
      );

      return displayUnits.map(
        (unit) =>
          operationByUnit.get(unit) ?? {
            operationKind: scatterOperation,
            unit,
            quantity: 0,
            materialCount: 0,
            operationCount: 0,
          },
      );
    },
    [scatterOperation, scatterSummaryByUnit, summaryByUnit],
  );

  const handleScatterOperationChange = (nextOperation: ScatterOperation) => {
    setScatterOperation(nextOperation);
    setSelectedScatterMaterialId(null);
  };

  const openIdleMaterials = (row: IdleBucket) => {
    setMaterialModal({
      title: `Materiais sem giro | ${row.label}`,
      subtitle: `${row.materialCount} materiais | saldo ${formatDecimal(row.balanceQuantity)}`,
      rows: row.materials,
    });
  };

  const openAbcMaterials = (row: AbcRow) => {
    const metricLabel = abcMode === "value" ? formatCurrency(row.estimatedValue) : formatDecimal(row.balanceQuantity);
    setMaterialModal({
      title: `Curva ABC | Classe ${row.className}`,
      subtitle: `${row.materialCount} materiais | ${metricLabel} | ${formatPercent(row.percentage)}`,
      rows: row.materials,
      showAbcPercentage: true,
    });
  };

  const exportScatterRows = async () => {
    if (!activeScatterRows.length || isExportingScatter) return;

    setIsExportingScatter(true);
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    try {
      const csv = buildCsvContent(
        ["Operacao", "Material", "Descricao", "UMB", "Quantidade", "Operacoes", "Projetos", "Saldo atual"],
        activeScatterRows.map((row) => [
          operationLabels[row.operationKind],
          row.materialCode,
          row.description,
          row.unit,
          formatDecimal(row.quantity),
          row.operationCount,
          row.projectCount,
          formatDecimal(row.currentBalance),
        ]),
      );

      downloadCsvFile(csv, `dispersao_materiais_${scatterOperation.toLowerCase()}_${formatExportDate()}.csv`);
    } finally {
      setIsExportingScatter(false);
    }
  };

  const exportMaterialModalRows = async () => {
    if (!materialModal?.rows.length || isExportingMaterialModal) return;

    setIsExportingMaterialModal(true);
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    try {
      const headers = [
        "Material",
        "Descricao",
        "Tipo",
        "UMB",
        "Saldo",
        "Preco unitario",
        "Valor estimado",
        ...(materialModal.showAbcPercentage ? ["% ABC"] : []),
        "Ultima movimentacao",
        "Dias sem giro",
      ];
      const csv = buildCsvContent(
        headers,
        materialModal.rows.map((row) => [
          row.materialCode,
          row.description,
          row.materialType,
          row.unit,
          formatDecimal(row.balanceQuantity),
          formatDecimal(row.unitPrice),
          formatDecimal(row.estimatedValue),
          ...(materialModal.showAbcPercentage ? [formatPercent(row.abcPercentage ?? 0)] : []),
          formatDate(row.lastMovementAt),
          row.idleDays == null ? "" : formatDecimal(row.idleDays),
        ]),
      );

      downloadCsvFile(csv, `${formatFileNamePart(materialModal.title)}_${formatExportDate()}.csv`);
    } finally {
      setIsExportingMaterialModal(false);
    }
  };

  useEffect(() => {
    if (!session?.accessToken) {
      hasLoadedInitialDashboard.current = false;
      return;
    }
    if (hasLoadedInitialDashboard.current) return;
    hasLoadedInitialDashboard.current = true;
    void loadDashboard();
  }, [loadDashboard, session?.accessToken]);

  useEffect(() => {
    setSelectedScatterMaterialId(null);
  }, [scatter]);

  return (
    <section className={styles.wrapper}>
      <ExportProgressModal
        open={isExportingScatter}
        title="Gerando..."
        message="Gerando arquivo CSV."
      />
      <MaterialDetailsModal
        modal={materialModal}
        isExporting={isExportingMaterialModal}
        onClose={() => setMaterialModal(null)}
        onExport={() => void exportMaterialModalRows()}
      />
      {feedback ? (
        <div className={feedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError}>
          {feedback.message}
        </div>
      ) : null}

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Filtros</h2>
            <p className={styles.cardSubtitle}>Recorte por periodo, centro, equipe, projeto, material e tipo.</p>
          </div>
          <button type="button" className={styles.primaryButton} onClick={() => void loadDashboard()} disabled={isLoading}>
            {isLoading ? "Filtrando..." : "Filtrar"}
          </button>
        </div>

        <div className={styles.filterGrid}>
          <label className={styles.field}>
            <span>Data inicial</span>
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} disabled={isLoading} />
          </label>
          <label className={styles.field}>
            <span>Data final</span>
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} disabled={isLoading} />
          </label>
          <label className={styles.field}>
            <span>Centro de estoque</span>
            <select value={stockCenterId} onChange={(event) => setStockCenterId(event.target.value)} disabled={isLoading}>
              <option value="">Todos</option>
              {stockCenters.map((center) => (
                <option key={center.id} value={center.id}>{center.name}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Equipe</span>
            <select value={teamId} onChange={(event) => setTeamId(event.target.value)} disabled={isLoading}>
              <option value="">Todas</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>{team.label}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Projeto</span>
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)} disabled={isLoading}>
              <option value="">Todos</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.label}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Material</span>
            <input value={materialCode} onChange={(event) => setMaterialCode(event.target.value)} placeholder="Codigo" disabled={isLoading} />
          </label>
          <label className={styles.field}>
            <span>Tipo</span>
            <select value={materialType} onChange={(event) => setMaterialType(event.target.value)} disabled={isLoading}>
              <option value="">Todos</option>
              <option value="NOVO">NOVO</option>
              <option value="SUCATA">SUCATA</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Limite critico</span>
            <input value={criticalQty} onChange={(event) => setCriticalQty(event.target.value)} inputMode="decimal" disabled={isLoading} />
          </label>
        </div>
      </article>

      <div className={styles.summaryGrid}>
        <div className={styles.metric}><span>Materiais</span><strong>{summary?.materialCount ?? 0}</strong></div>
        <div className={styles.metric}><span>Criticos</span><strong>{summary?.criticalCount ?? 0}</strong></div>
        <div className={styles.metric}><span>Zerados</span><strong>{summary?.zeroCount ?? 0}</strong></div>
        <div className={styles.metric}><span>Valor estimado</span><strong>{formatCurrency(summary?.totalEstimatedValue ?? 0)}</strong></div>
      </div>

      <article className={styles.card}>
        <div className={styles.cardHeaderCompact}>
          <div>
            <h2 className={styles.cardTitle}>Estoque</h2>
            <p className={styles.cardSubtitle}>Saldo atual consolidado por UMB.</p>
          </div>
        </div>
        <div className={styles.unitStrip}>
          {summaryByUnit.map((item) => (
            <div key={item.unit} className={styles.unitPill}>
              <span>{item.unit}</span>
              <strong>{formatDecimal(item.balanceQuantity)}</strong>
            </div>
          ))}
        </div>
      </article>

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Dispersao de materiais</h2>
            <p className={styles.cardSubtitle}>Quantidade movimentada por numero de operacoes.</p>
          </div>
          <div className={styles.chartActions}>
            <div className={styles.segmented}>
              <button
                type="button"
                className={scatterOperation === "REQUISITION" ? styles.segmentActive : styles.segment}
                onClick={() => handleScatterOperationChange("REQUISITION")}
              >
                Requisicao
              </button>
              <button
                type="button"
                className={scatterOperation === "RETURN" ? styles.segmentActive : styles.segment}
                onClick={() => handleScatterOperationChange("RETURN")}
              >
                Devolucao
              </button>
            </div>
            <div className={styles.segmented}>
              <button
                type="button"
                className={scatterScale === "sqrt" ? styles.segmentActive : styles.segment}
                onClick={() => setScatterScale("sqrt")}
              >
                Raiz
              </button>
              <button
                type="button"
                className={scatterScale === "linear" ? styles.segmentActive : styles.segment}
                onClick={() => setScatterScale("linear")}
              >
                Linear
              </button>
            </div>
            <button type="button" className={styles.expandButton} onClick={() => setIsScatterExpanded(true)}>
              Expandir
            </button>
            <CsvExportButton
              onClick={() => void exportScatterRows()}
              disabled={!activeScatterRows.length}
              isLoading={isExportingScatter}
              className={styles.expandButton}
              idleLabel="Exportar CSV"
              showProgressModal={false}
            />
          </div>
        </div>
        <ScatterUnitStrip rows={activeScatterUnitSummary} />
        <ScatterChart
          rows={scatter}
          operation={scatterOperation}
          scale={scatterScale}
          selectedMaterialId={selectedScatterMaterialId}
          onSelectPoint={setSelectedScatterMaterialId}
        />
      </article>

      <div className={styles.chartGrid}>
        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2 className={styles.cardTitle}>Materiais criticos e zerados</h2>
              <p className={styles.cardSubtitle}>Menores saldos no recorte atual.</p>
            </div>
          </div>
          <BarList rows={criticalMaterials} variant="critical" emptyLabel="Nenhum material critico encontrado." />
        </article>

        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2 className={styles.cardTitle}>Top materiais por saldo</h2>
              <p className={styles.cardSubtitle}>Maiores saldos consolidados por material.</p>
            </div>
          </div>
          <BarList rows={topBalanceMaterials} emptyLabel="Nenhum saldo encontrado." />
        </article>
      </div>

      <div className={styles.chartGrid}>
        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2 className={styles.cardTitle}>Materiais sem giro</h2>
              <p className={styles.cardSubtitle}>Faixas pela ultima movimentacao conhecida.</p>
            </div>
          </div>
          <IdleChart rows={idleBuckets} onSelectBucket={openIdleMaterials} />
        </article>

        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2 className={styles.cardTitle}>Curva ABC do estoque</h2>
              <p className={styles.cardSubtitle}>
                {abcMode === "value" ? "Classificacao por saldo x preco do material." : "Classificacao por quantidade em estoque."}
              </p>
            </div>
            <div className={styles.segmented}>
              <button
                type="button"
                className={abcMode === "value" ? styles.segmentActive : styles.segment}
                onClick={() => setAbcMode("value")}
              >
                Valor
              </button>
              <button
                type="button"
                className={abcMode === "quantity" ? styles.segmentActive : styles.segment}
                onClick={() => setAbcMode("quantity")}
              >
                Quantidade
              </button>
            </div>
          </div>
          <AbcChart rows={abcMode === "value" ? abcRows : abcQuantityRows} mode={abcMode} onSelectRow={openAbcMaterials} />
        </article>
      </div>

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Evolucao de movimentacoes</h2>
            <p className={styles.cardSubtitle}>Quantidade mensal de operacoes realizadas por tipo.</p>
          </div>
          <div className={styles.movementHeaderActions}>
            <button
              type="button"
              className={styles.infoButton}
              aria-label="Como o valor estimado mensal e calculado"
              title={evolutionEstimatedValueHelp}
            >
              <ActionIcon name="info" className={styles.infoIcon} />
            </button>
            <div className={styles.movementTotal}>
              {summary?.movementCount ?? 0} operacoes
            </div>
          </div>
        </div>
        <EvolutionChart rows={movementEvolution} />
      </article>

      {isScatterExpanded ? (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-label="Dispersao de materiais ampliada">
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <div>
                <h2>Dispersao de materiais</h2>
                <p>
                  {operationLabels[scatterOperation]} | escala {scatterScale === "sqrt" ? "Raiz" : "Linear"}
                  {selectedScatterPoint ? ` | foco ${selectedScatterPoint.materialCode}` : ""}
                </p>
              </div>
              <div className={styles.chartActions}>
                <div className={styles.segmented}>
                  <button
                    type="button"
                    className={scatterOperation === "REQUISITION" ? styles.segmentActive : styles.segment}
                    onClick={() => handleScatterOperationChange("REQUISITION")}
                  >
                    Requisicao
                  </button>
                  <button
                    type="button"
                    className={scatterOperation === "RETURN" ? styles.segmentActive : styles.segment}
                    onClick={() => handleScatterOperationChange("RETURN")}
                  >
                    Devolucao
                  </button>
                </div>
                <div className={styles.segmented}>
                  <button
                    type="button"
                    className={scatterScale === "sqrt" ? styles.segmentActive : styles.segment}
                    onClick={() => setScatterScale("sqrt")}
                  >
                    Raiz
                  </button>
                  <button
                    type="button"
                    className={scatterScale === "linear" ? styles.segmentActive : styles.segment}
                    onClick={() => setScatterScale("linear")}
                  >
                    Linear
                  </button>
                </div>
                <button type="button" className={styles.closeButton} onClick={() => setIsScatterExpanded(false)} aria-label="Fechar dispersao ampliada">
                  x
                </button>
                <CsvExportButton
                  onClick={() => void exportScatterRows()}
                  disabled={!activeScatterRows.length}
                  isLoading={isExportingScatter}
                  className={styles.expandButton}
                  idleLabel="Exportar CSV"
                  showProgressModal={false}
                />
              </div>
            </div>
            <div className={styles.modalBody}>
              <ScatterUnitStrip rows={activeScatterUnitSummary} />
              <ScatterChart
                rows={scatter}
                operation={scatterOperation}
                scale={scatterScale}
                expanded
                selectedMaterialId={selectedScatterMaterialId}
                onSelectPoint={setSelectedScatterMaterialId}
              />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
