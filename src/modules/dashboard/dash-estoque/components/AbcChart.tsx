import { formatCurrency, formatDecimal, formatPercent } from "../helpers";
import styles from "../StockDashboardPageView.module.css";
import type { AbcMode, AbcRow } from "../types";

export function AbcChart({ rows, mode, onSelectRow }: { rows: AbcRow[]; mode: AbcMode; onSelectRow: (row: AbcRow) => void }) {
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
