import styles from "../../ProgrammingNormalizedPageView.module.css";
import { formatDate } from "../../utils";
import type { ProgrammingStage } from "../../types";

// Corrigir data (achado 10): aceita data anterior ou posterior, mantem o
// registro e o status. Remarcar continua sendo pelo Adiar.
export function CorrectDateModal(props: {
  target: ProgrammingStage | null;
  newDate: string;
  reason: string;
  isSubmitting: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onNewDateChange: (value: string) => void;
  onReasonChange: (value: string) => void;
}) {
  const { target, newDate, reason, isSubmitting, onClose, onConfirm, onNewDateChange, onReasonChange } = props;
  if (!target) return null;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className={styles.modalHeader}>
          <div className={styles.modalTitleBlock}>
            <h4>Corrigir data</h4>
            <p className={styles.modalSubtitle}>
              Corrige a data cadastrada (mantem a etapa e o status). Para remarcar, use Adiar.
            </p>
          </div>
          <button type="button" className={styles.modalCloseButton} onClick={onClose} disabled={isSubmitting}>Fechar</button>
        </header>
        <div className={styles.modalBody}>
          <p className={styles.emptyHint}>
            Data atual: {target.executionDate ? formatDate(target.executionDate) : "Em espera"}
          </p>
          <label className={styles.field}>
            <span>Data correta <span className="requiredMark">*</span></span>
            <input type="date" value={newDate} onChange={(event) => onNewDateChange(event.target.value)} disabled={isSubmitting} />
          </label>
          <label className={styles.field}>
            <span>Motivo <span className="requiredMark">*</span></span>
            <textarea value={reason} onChange={(event) => onReasonChange(event.target.value)} disabled={isSubmitting} />
          </label>
          <button
            type="button"
            className={styles.buttonPrimary}
            onClick={onConfirm}
            disabled={isSubmitting || !newDate || !reason.trim()}
          >
            Confirmar correcao
          </button>
        </div>
      </article>
    </div>
  );
}
