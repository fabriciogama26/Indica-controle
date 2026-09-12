"use client";

import styles from "../../entrada/StockTransfersPageView.module.css";
import { HISTORY_FIELD_LABELS } from "../constants";
import type { TeamOperationHistoryEntry, TeamOperationListItem } from "../types";
import { formatDateTime, formatHistoryActionLabel, formatHistoryValue } from "../utils";

type OperationHistoryModalProps = {
  item: TeamOperationListItem | null;
  entries: TeamOperationHistoryEntry[];
  isLoading: boolean;
  onClose: () => void;
};

export function OperationHistoryModal({ item, entries, isLoading, onClose }: OperationHistoryModalProps) {
  if (!item) return null;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className={styles.modalHeader}>
          <div className={styles.modalTitleBlock}>
            <h4>Historico da Operacao</h4>
            <p className={styles.modalSubtitle}>Transferencia: {item.transferId}</p>
          </div>
          <button type="button" className={styles.modalCloseButton} onClick={onClose}>
            Fechar
          </button>
        </header>

        <div className={styles.modalBody}>
          {isLoading ? <p>Carregando historico...</p> : null}
          {!isLoading && entries.length === 0 ? <p>Nenhum historico registrado.</p> : null}
          {!isLoading && entries.length > 0 ? entries.map((entry) => (
            <article key={entry.id} className={styles.historyCard}>
              <header className={styles.historyCardHeader}>
                <strong>{formatHistoryActionLabel(entry.action)}</strong>
                <span>{formatDateTime(entry.changedAt)} | {entry.changedByName}</span>
              </header>
              <div className={styles.historyChanges}>
                {Object.entries(entry.changes ?? {}).length > 0
                  ? Object.entries(entry.changes ?? {}).map(([field, change]: [string, { from?: unknown; to?: unknown }]) => (
                      <div key={field} className={styles.historyChangeItem}>
                        <strong>{HISTORY_FIELD_LABELS[field] ?? field}</strong>
                        <span>De: {formatHistoryValue(change.from)}</span>
                        <span>Para: {formatHistoryValue(change.to)}</span>
                      </div>
                    ))
                  : <div className={styles.historyChangeItem}><span>Sem alteracoes detalhadas.</span></div>}
              </div>
            </article>
          )) : null}
        </div>
      </article>
    </div>
  );
}
