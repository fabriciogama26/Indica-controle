"use client";

import { serialTrackingLabel } from "@/lib/materialSerialTracking";
import type { PendingSerialBalanceItem } from "../types";
import styles from "../TrafoPositionPageView.module.css";

type PendingSerialBalancePanelProps = {
  items: PendingSerialBalanceItem[];
  isLoading: boolean;
};

export function PendingSerialBalancePanel({ items, isLoading }: PendingSerialBalancePanelProps) {
  const total = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <details className={styles.pendingPanel} open={items.length > 0}>
      <summary className={styles.pendingSummary}>
        Pendentes de identificacao de serial
        <span className={styles.pendingBadge}>{total}</span>
      </summary>

      <p className={styles.pendingHint}>
        Unidades que entraram no estoque sem Serial informado e ainda nao foram identificadas.
        O saldo e por material, centro e tipo de entrada, sem identidade de unidade, entao este
        bloco responde apenas aos filtros de centro, codigo, descricao e rastreio.
      </p>

      {isLoading ? (
        <p className={styles.pendingEmpty}>Carregando saldo pendente...</p>
      ) : items.length === 0 ? (
        <p className={styles.pendingEmpty}>Nenhuma unidade pendente de identificacao para os filtros atuais.</p>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Centro fisico</th>
                <th>Material (codigo)</th>
                <th>Descricao</th>
                <th>Rastreio</th>
                <th>Tipo</th>
                <th>Quantidade</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={`${item.materialId}-${item.stockCenterId}-${item.entryType}`}>
                  <td>{item.stockCenterName}</td>
                  <td>{item.materialCode}</td>
                  <td>{item.description}</td>
                  <td>{serialTrackingLabel(item.serialTrackingType)}</td>
                  <td>{item.entryType}</td>
                  <td>{item.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
