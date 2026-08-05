import { formatCurrency, formatDecimal } from "../helpers";
import styles from "../StockDashboardPageView.module.css";
import type { Summary, UnitSummary } from "../types";

export function StockSummary({ summary, summaryByUnit }: { summary: Summary | null; summaryByUnit: UnitSummary[] }) {
  return (
    <>
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
    </>
  );
}
