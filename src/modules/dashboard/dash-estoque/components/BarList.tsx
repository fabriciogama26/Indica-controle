import { formatDecimal, maxValue, truncateLabel } from "../helpers";
import styles from "../StockDashboardPageView.module.css";

export function BarList<T extends { materialId: string; materialCode: string; description: string; unit: string; balanceQuantity: number }>(props: {
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
