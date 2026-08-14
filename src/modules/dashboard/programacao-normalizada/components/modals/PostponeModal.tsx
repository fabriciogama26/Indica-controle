import styles from "../../ProgrammingNormalizedPageView.module.css";
import { isReasonSelectionValid } from "../../validators";
import type { ReasonOptionItem } from "../../types";

// Adiar tem duas rotas (spec 3.1/10): "Nova data" remarca a etapa (REPROGRAMADA)
// e "Deixar em espera" tira a data (ADIADA). O motivo e obrigatorio nas duas; a
// data so na rota de remarcar.
//
// `isResumeFromHold` = a etapa alvo JA esta em espera (ADIADA). Ai so existe uma
// rota — dar data e voltar ao plano —, entao a escolha some (a rota "em espera"
// seria recusada com ALREADY_ON_HOLD) e os rotulos falam de retomada: "adiar"
// uma etapa ja adiada nao descreve a operacao.
export function PostponeModal(props: {
  isOpen: boolean;
  mode: "DATE" | "HOLD";
  isResumeFromHold?: boolean;
  newDate: string;
  reasonCode: string;
  reasonNotes: string;
  reasonOptions: ReasonOptionItem[];
  isSubmitting: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onModeChange: (value: "DATE" | "HOLD") => void;
  onNewDateChange: (value: string) => void;
  onReasonCodeChange: (value: string) => void;
  onReasonNotesChange: (value: string) => void;
}) {
  const { isOpen, mode, isResumeFromHold = false, newDate, reasonCode, reasonNotes, reasonOptions, isSubmitting, onClose, onConfirm, onModeChange, onNewDateChange, onReasonCodeChange, onReasonNotesChange } = props;
  if (!isOpen) return null;

  const selectedReason = reasonOptions.find((item) => item.code === reasonCode);
  const reasonValid = isReasonSelectionValid(reasonOptions, reasonCode, reasonNotes);
  const canConfirm = mode === "HOLD" ? reasonValid : Boolean(newDate) && reasonValid;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className={styles.modalHeader}>
          <h4>{isResumeFromHold ? "Retomar etapa" : "Adiar etapa"}</h4>
          <button type="button" className={styles.modalCloseButton} onClick={onClose} disabled={isSubmitting}>Fechar</button>
        </header>
        <div className={styles.modalBody}>
          {isResumeFromHold ? (
            <p className={styles.emptyHint}>
              A etapa esta em espera. Informe a data em que ela volta ao plano: o status passa a Reprogramada e ela
              volta a contar na numeracao. As equipes ja alocadas seguem nela.
            </p>
          ) : (
            <div className={styles.field}>
              <span>Como adiar</span>
              <div className={styles.radioRow}>
                <label>
                  <input type="radio" name="postpone-mode" checked={mode === "DATE"} onChange={() => onModeChange("DATE")} disabled={isSubmitting} />
                  <span>Nova data (remarcar)</span>
                </label>
                <label>
                  <input type="radio" name="postpone-mode" checked={mode === "HOLD"} onChange={() => onModeChange("HOLD")} disabled={isSubmitting} />
                  <span>Deixar em espera (sem data)</span>
                </label>
              </div>
            </div>
          )}
          {mode === "DATE" ? (
            <label className={styles.field}>
              <span>{isResumeFromHold ? "Data de retomada" : "Nova data"}</span>
              <input type="date" value={newDate} onChange={(event) => onNewDateChange(event.target.value)} disabled={isSubmitting} />
            </label>
          ) : null}
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
            className={styles.buttonPrimary}
            onClick={onConfirm}
            disabled={isSubmitting || !canConfirm}
          >
            {mode === "HOLD" ? "Deixar em espera" : isResumeFromHold ? "Confirmar retomada" : "Confirmar remarcacao"}
          </button>
        </div>
      </article>
    </div>
  );
}
