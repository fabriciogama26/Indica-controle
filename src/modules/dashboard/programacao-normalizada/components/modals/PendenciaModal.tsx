import styles from "../../ProgrammingNormalizedPageView.module.css";
import { formatDate, getWorkCompletionLabel } from "../../utils";
import type { ProgrammingStage } from "../../types";

// Marcar/desmarcar pendencia exige motivo (achado 3) e, ao LIGAR, permite
// apontar a etapa de origem da sobra (grava resolve_pendencia_de_id).
export function PendenciaModal(props: {
  target: ProgrammingStage | null;
  nextValue: boolean;
  reason: string;
  description: string;
  originId: string;
  originOptions: ProgrammingStage[];
  isSubmitting: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onReasonChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onOriginChange: (value: string) => void;
}) {
  const { target, nextValue, reason, description, originId, originOptions, isSubmitting, onClose, onConfirm, onReasonChange, onDescriptionChange, onOriginChange } = props;
  if (!target) return null;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className={styles.modalHeader}>
          <h4>{nextValue ? "Marcar pendencia" : "Desmarcar pendencia"}</h4>
          <button type="button" className={styles.modalCloseButton} onClick={onClose} disabled={isSubmitting}>Fechar</button>
        </header>
        <div className={styles.modalBody}>
          <label className={styles.field}>
            <span>Motivo <span className="requiredMark">*</span></span>
            <textarea value={reason} onChange={(event) => onReasonChange(event.target.value)} disabled={isSubmitting} />
          </label>
          {nextValue ? (
            <label className={styles.field}>
              <span>Descricao do servico restante <span className="requiredMark">*</span></span>
              <textarea value={description} onChange={(event) => onDescriptionChange(event.target.value)} disabled={isSubmitting} />
            </label>
          ) : null}
          {nextValue ? (
            <label className={styles.field}>
              <span>Etapa de origem (opcional — precisa ter o Estado do trabalho lancado)</span>
              <select value={originId} onChange={(event) => onOriginChange(event.target.value)} disabled={isSubmitting}>
                <option value="">Sem vinculo</option>
                {originOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.executionDate ? formatDate(item.executionDate) : "Em espera"} — {getWorkCompletionLabel(item.workCompletionStatus)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            type="button"
            className={styles.buttonPrimary}
            onClick={onConfirm}
            disabled={isSubmitting || !reason.trim() || (nextValue && !description.trim())}
          >
            {nextValue ? "Marcar pendencia" : "Desmarcar pendencia"}
          </button>
        </div>
      </article>
    </div>
  );
}
