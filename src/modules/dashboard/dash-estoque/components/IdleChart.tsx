import { formatDecimal, maxValue } from "../helpers";
import styles from "../StockDashboardPageView.module.css";
import type { IdleBucket } from "../types";

export function IdleChart({ rows, onSelectBucket }: { rows: IdleBucket[]; onSelectBucket: (row: IdleBucket) => void }) {
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
