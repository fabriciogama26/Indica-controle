import { evolutionKeys, formatCurrency, formatDecimal, maxValue } from "../helpers";
import styles from "../StockDashboardPageView.module.css";
import type { EvolutionRow } from "../types";

export function EvolutionChart({ rows }: { rows: EvolutionRow[] }) {
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
