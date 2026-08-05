import { CsvExportButton } from "@/components/ui/CsvExportButton";

import { operationLabels } from "../helpers";
import styles from "../StockDashboardPageView.module.css";
import type { ScatterOperation, ScatterPoint, ScatterScale, ScatterUnitSummary } from "../types";
import { ScatterChart } from "./ScatterChart";
import { ScatterUnitStrip } from "./ScatterUnitStrip";
import { ScatterViewControls } from "./ScatterViewControls";

export function ScatterExpandedModal({
  rows,
  unitSummary,
  operation,
  scale,
  unit,
  selectedPoint,
  selectedMaterialId,
  canExport,
  isExporting,
  onOperationChange,
  onScaleChange,
  onSelectUnit,
  onSelectPoint,
  onExport,
  onClose,
}: {
  rows: ScatterPoint[];
  unitSummary: ScatterUnitSummary[];
  operation: ScatterOperation;
  scale: ScatterScale;
  unit: string;
  selectedPoint: ScatterPoint | null;
  selectedMaterialId: string | null;
  canExport: boolean;
  isExporting: boolean;
  onOperationChange: (operation: ScatterOperation) => void;
  onScaleChange: (scale: ScatterScale) => void;
  onSelectUnit: (unit: string) => void;
  onSelectPoint: (materialId: string | null) => void;
  onExport: () => void;
  onClose: () => void;
}) {
  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-label="Dispersao de materiais ampliada">
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <div>
            <h2>Dispersao de materiais</h2>
            <p>
              {operationLabels[operation]} | escala {scale === "sqrt" ? "Raiz" : "Linear"}
              {unit ? ` | UMB ${unit}` : " | todas as UMB"}
              {selectedPoint ? ` | foco ${selectedPoint.materialCode}` : ""}
            </p>
          </div>
          <div className={styles.chartActions}>
            <ScatterViewControls
              operation={operation}
              scale={scale}
              onOperationChange={onOperationChange}
              onScaleChange={onScaleChange}
            />
            <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Fechar dispersao ampliada">
              x
            </button>
            <CsvExportButton
              onClick={onExport}
              disabled={!canExport}
              isLoading={isExporting}
              className={styles.expandButton}
              idleLabel="Exportar CSV"
              showProgressModal={false}
            />
          </div>
        </div>
        <div className={styles.modalBody}>
          <ScatterUnitStrip rows={unitSummary} selectedUnit={unit} onSelectUnit={onSelectUnit} />
          <ScatterChart
            rows={rows}
            operation={operation}
            scale={scale}
            unit={unit}
            expanded
            selectedMaterialId={selectedMaterialId}
            onSelectPoint={onSelectPoint}
          />
        </div>
      </div>
    </div>
  );
}
