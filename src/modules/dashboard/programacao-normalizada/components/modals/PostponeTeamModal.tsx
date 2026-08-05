import styles from "../../ProgrammingNormalizedPageView.module.css";
import { isReasonSelectionValid } from "../../validators";
import type { ReasonOptionItem } from "../../types";

export function PostponeTeamModal(props: {
  isOpen: boolean;
  teamName: string;
  newDate: string;
  reasonCode: string;
  reasonNotes: string;
  reasonOptions: ReasonOptionItem[];
  isSubmitting: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onNewDateChange: (value: string) => void;
  onReasonCodeChange: (value: string) => void;
  onReasonNotesChange: (value: string) => void;
}) {
  const {
    isOpen, teamName, newDate, reasonCode, reasonNotes, reasonOptions, isSubmitting,
    onClose, onConfirm, onNewDateChange, onReasonCodeChange, onReasonNotesChange,
  } = props;
  if (!isOpen) return null;

  const selectedReason = reasonOptions.find((item) => item.code === reasonCode);
  const canConfirm = Boolean(newDate) && isReasonSelectionValid(reasonOptions, reasonCode, reasonNotes);

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className={styles.modalHeader}>
          <h4>Adiar equipe — {teamName}</h4>
          <button type="button" className={styles.modalCloseButton} onClick={onClose} disabled={isSubmitting}>Fechar</button>
        </header>
        <div className={styles.modalBody}>
          <label className={styles.field}>
            <span>Nova data</span>
            <input type="date" value={newDate} onChange={(event) => onNewDateChange(event.target.value)} disabled={isSubmitting} />
          </label>
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
          <p className={styles.emptyHint}>
            Se ja existir etapa ativa do projeto na nova data, a equipe entra nela; senao, uma etapa nova e criada com o mesmo cadastro desta.
          </p>
          <button type="button" className={styles.buttonPrimary} onClick={onConfirm} disabled={isSubmitting || !canConfirm}>
            Confirmar adiamento
          </button>
        </div>
      </article>
    </div>
  );
}
