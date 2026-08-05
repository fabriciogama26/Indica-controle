import { CsvExportButton } from "@/components/ui/CsvExportButton";

import { formatCurrency, formatDate, formatDecimal, formatPercent } from "../helpers";
import styles from "../StockDashboardPageView.module.css";
import type { MaterialModalState } from "../types";

export function MaterialDetailsModal({
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
