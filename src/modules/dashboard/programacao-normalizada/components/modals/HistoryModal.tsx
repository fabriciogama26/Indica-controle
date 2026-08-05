import styles from "../../ProgrammingNormalizedPageView.module.css";
import {
  formatDate,
  formatDateTime,
  formatHistoryChangeValue,
  getHistoryActionLabel,
  getHistoryFieldLabel,
} from "../../utils";
import type { HistoryItem, HistoryModalTarget } from "../../types";

export function HistoryModal(props: {
  target: HistoryModalTarget | null;
  items: HistoryItem[];
  pagedItems: HistoryItem[];
  isLoading: boolean;
  page: number;
  totalPages: number;
  onClose: () => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
}) {
  const { target, items, pagedItems, isLoading, page, totalPages, onClose, onPreviousPage, onNextPage } = props;
  if (!target) return null;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className={styles.modalHeader}>
          <div className={styles.modalTitleBlock}>
            <h4>Historico da etapa</h4>
            <p className={styles.modalSubtitle}>Etapa de {target.executionDate ? formatDate(target.executionDate) : "Em espera"} | ID: {target.id}</p>
          </div>
          <button type="button" className={styles.modalCloseButton} onClick={onClose}>Fechar</button>
        </header>
        <div className={styles.modalBody}>
          {isLoading ? <p className={styles.emptyHint}>Carregando historico...</p> : null}
          {!isLoading && !items.length ? <p className={styles.emptyHint}>Nenhum evento registrado.</p> : null}
          {!isLoading && items.length ? (
            <div className={styles.historyList}>
              {pagedItems.map((item) => {
                const changedFields = Object.entries(item.changes ?? {}).filter(([, change]) => {
                  if (!change || typeof change !== "object") return false;
                  const typedChange = change as { from?: unknown; to?: unknown };
                  return (typedChange.from ?? "") !== (typedChange.to ?? "");
                });

                return (
                  <article key={item.id} className={styles.historyCard}>
                    <header className={styles.historyCardHeader}>
                      <strong>{getHistoryActionLabel(item.actionType)}</strong>
                      <span>{formatDateTime(item.changedAt)} | {item.changedByName}</span>
                    </header>

                    <div className={styles.historyChanges}>
                      {changedFields.length ? (
                        changedFields.map(([field, change]) => {
                          const typedChange = change as { from?: unknown; to?: unknown };
                          return (
                            <div key={field} className={styles.historyChangeItem}>
                              <strong>{getHistoryFieldLabel(field)}</strong>
                              <span>De: {formatHistoryChangeValue(typedChange.from)}</span>
                              <span>Para: {formatHistoryChangeValue(typedChange.to)}</span>
                            </div>
                          );
                        })
                      ) : (
                        <p className={styles.emptyHint}>Nenhum campo alterado nesse evento.</p>
                      )}
                    </div>

                    <p><strong>Motivo:</strong> {item.reason || "-"}</p>
                  </article>
                );
              })}
            </div>
          ) : null}
          {!isLoading && items.length ? (
            <div className={styles.historyPagination}>
              <span>Pagina {Math.min(page, totalPages)} de {totalPages} | Total: {items.length}</span>
              <div className={styles.actions}>
                <button type="button" className={styles.buttonSecondary} onClick={onPreviousPage} disabled={page <= 1}>
                  Anterior
                </button>
                <button type="button" className={styles.buttonSecondary} onClick={onNextPage} disabled={page >= totalPages}>
                  Proxima
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </article>
    </div>
  );
}
