import styles from "../../ProgrammingNormalizedPageView.module.css";
import { isReasonSelectionValid } from "../../validators";
import type { ReasonOptionItem } from "../../types";

export function CancelModal(props: {
  isOpen: boolean;
  reasonCode: string;
  reasonNotes: string;
  reasonOptions: ReasonOptionItem[];
  isSubmitting: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onReasonCodeChange: (value: string) => void;
  onReasonNotesChange: (value: string) => void;
}) {
  const { isOpen, reasonCode, reasonNotes, reasonOptions, isSubmitting, onClose, onConfirm, onReasonCodeChange, onReasonNotesChange } = props;
  if (!isOpen) return null;

  const selectedReason = reasonOptions.find((item) => item.code === reasonCode);

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className={styles.modalHeader}>
          <h4>Cancelar etapa</h4>
          <button type="button" className={styles.modalCloseButton} onClick={onClose} disabled={isSubmitting}>Fechar</button>
        </header>
        <div className={styles.modalBody}>
          <label className={styles.field}>
            <span>Motivo</span>
            <select value={reasonCode} onChange={(event) => onReasonCodeChange(event.target.value)} disabled={isSubmitting}>
              <option value="">Selecionar motivo...</option>
              {reasonOptions.map((item) => (
                <option key={item.code} value={item.code}>{item.label}</option>
              ))}
            </select>
          </label>
          {selectedReason?.requiresNotes ? (
            <label className={styles.field}>
              <span>Observacao</span>
              <textarea value={reasonNotes} onChange={(event) => onReasonNotesChange(event.target.value)} disabled={isSubmitting} />
            </label>
          ) : null}
          <button
            type="button"
            className={styles.buttonDanger}
            onClick={onConfirm}
            disabled={isSubmitting || !isReasonSelectionValid(reasonOptions, reasonCode, reasonNotes)}
          >
            Confirmar cancelamento
          </button>
        </div>
      </article>
    </div>
  );
}
