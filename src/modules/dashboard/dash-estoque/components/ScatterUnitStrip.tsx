import { formatDecimal } from "../helpers";
import styles from "../StockDashboardPageView.module.css";
import type { ScatterUnitSummary } from "../types";

export function ScatterUnitStrip({
  rows,
  selectedUnit,
  onSelectUnit,
}: {
  rows: ScatterUnitSummary[];
  selectedUnit: string;
  onSelectUnit: (unit: string) => void;
}) {
  if (!rows.length) return null;

  const pillClassName = (unit: string) =>
    `${styles.unitPillButton} ${selectedUnit === unit ? styles.unitPillActive : ""}`.trim();

  return (
    <div className={`${styles.unitStrip} ${styles.scatterUnitStrip}`} role="group" aria-label="Filtro por UMB">
      <button
        type="button"
        className={pillClassName("")}
        aria-pressed={selectedUnit === ""}
        title="Mostrar todas as unidades de medida"
        onClick={() => onSelectUnit("")}
      >
        <span>Todas as UMB</span>
        <strong>{rows.length}</strong>
      </button>
      {rows.map((item) => (
        <button
          key={`${item.operationKind}-${item.unit}`}
          type="button"
          className={pillClassName(item.unit)}
          aria-pressed={selectedUnit === item.unit}
          title={`Filtrar a dispersao pela UMB ${item.unit}`}
          onClick={() => onSelectUnit(item.unit)}
        >
          <span>{item.unit}</span>
          <strong>{formatDecimal(item.quantity)}</strong>
        </button>
      ))}
    </div>
  );
}
