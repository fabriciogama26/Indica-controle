import {
  buildScatterQuantityBands,
  formatDecimal,
  getScatterQuantityBand,
  isScatterQuantityInBand,
  maxValue,
  operationLabels,
  scaleScatterValue,
  scatterOffset,
  truncateLabel,
} from "../helpers";
import styles from "../StockDashboardPageView.module.css";
import type { ScatterOperation, ScatterPoint, ScatterScale } from "../types";

export function ScatterChart({
  rows,
  operation,
  scale,
  unit,
  expanded = false,
  selectedMaterialId = null,
  onSelectPoint,
}: {
  rows: ScatterPoint[];
  operation: ScatterOperation;
  scale: ScatterScale;
  unit: string;
  expanded?: boolean;
  selectedMaterialId?: string | null;
  onSelectPoint?: (materialId: string | null) => void;
}) {
  const filtered = rows.filter((row) => row.operationKind === operation && (!unit || row.unit === unit));
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
          <svg
            viewBox={viewBox}
            role="img"
            aria-label={`Dispersao ${operationLabels[operation]}${unit ? ` | UMB ${unit}` : ""}`}
          >
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
          <div className={styles.emptyChart}>
            {unit
              ? `Nenhum ponto para ${operationLabels[operation]} na UMB ${unit}.`
              : "Nenhum ponto para a operacao selecionada."}
          </div>
        )}
      </div>

      <div className={styles.scatterTableWrapper}>
        <div className={styles.scatterTableHeader}>
          <span>
            {filtered.length} materiais{unit ? ` | ${unit}` : ""}
          </span>
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
