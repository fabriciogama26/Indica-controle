import styles from "../StockDashboardPageView.module.css";
import type { ScatterOperation, ScatterScale } from "../types";

/**
 * Par de controles segmentados (operacao + escala) da Dispersao de materiais.
 * Renderizado identico no cabecalho do card e no do modal ampliado.
 */
export function ScatterViewControls({
  operation,
  scale,
  onOperationChange,
  onScaleChange,
}: {
  operation: ScatterOperation;
  scale: ScatterScale;
  onOperationChange: (operation: ScatterOperation) => void;
  onScaleChange: (scale: ScatterScale) => void;
}) {
  return (
    <>
      <div className={styles.segmented}>
        <button
          type="button"
          className={operation === "REQUISITION" ? styles.segmentActive : styles.segment}
          onClick={() => onOperationChange("REQUISITION")}
        >
          Requisicao
        </button>
        <button
          type="button"
          className={operation === "RETURN" ? styles.segmentActive : styles.segment}
          onClick={() => onOperationChange("RETURN")}
        >
          Devolucao
        </button>
      </div>
      <div className={styles.segmented}>
        <button
          type="button"
          className={scale === "sqrt" ? styles.segmentActive : styles.segment}
          onClick={() => onScaleChange("sqrt")}
        >
          Raiz
        </button>
        <button
          type="button"
          className={scale === "linear" ? styles.segmentActive : styles.segment}
          onClick={() => onScaleChange("linear")}
        >
          Linear
        </button>
      </div>
    </>
  );
}
