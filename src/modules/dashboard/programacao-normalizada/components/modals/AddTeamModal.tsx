import styles from "../../ProgrammingNormalizedPageView.module.css";
import type { AddTeamCheckState, TeamItem } from "../../types";

// A janela (data + hora inicio/fim) e da ETAPA, nao da equipe: `programming_team`
// guarda so identidade + status. Por isso os horarios aparecem aqui como leitura —
// e o intervalo que sera checado contra a agenda da equipe.
function formatWindow(executionDate: string | null, startTime: string | null, endTime: string | null) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(executionDate ?? "");
  const date = dateMatch ? `${dateMatch[3]}/${dateMatch[2]}/${dateMatch[1]}` : "sem data";
  if (!startTime || !endTime) return `${date} — sem horario definido`;
  return `${date} — ${startTime.slice(0, 5)} as ${endTime.slice(0, 5)}`;
}

function checkFeedbackClass(status: AddTeamCheckState["status"]) {
  if (status === "allowed") return `${styles.feedback} ${styles.feedbackSuccess}`;
  if (status === "blocked") return `${styles.feedback} ${styles.feedbackError}`;
  return styles.feedback;
}

export function AddTeamModal(props: {
  isOpen: boolean;
  availableTeams: TeamItem[];
  selectedTeamId: string;
  isSubmitting: boolean;
  executionDate: string | null;
  startTime: string | null;
  endTime: string | null;
  check: AddTeamCheckState;
  onClose: () => void;
  onConfirm: () => void;
  onSelectedTeamIdChange: (value: string) => void;
}) {
  const {
    isOpen,
    availableTeams,
    selectedTeamId,
    isSubmitting,
    executionDate,
    startTime,
    endTime,
    check,
    onClose,
    onConfirm,
    onSelectedTeamIdChange,
  } = props;
  if (!isOpen) return null;

  // So `blocked` trava o botao. Em `unknown` (checagem indisponivel) a tentativa
  // segue liberada de proposito: quem recusa de fato e a RPC, e ela devolve a
  // mesma mensagem detalhada. Em `loading` espera a resposta para nao adicionar
  // sem aviso nenhum.
  const isBlocked = check.status === "blocked";
  const isChecking = check.status === "loading";

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className={styles.modalHeader}>
          <div className={styles.modalTitleBlock}>
            <h4>Adicionar equipe</h4>
            <p className={styles.modalSubtitle}>{formatWindow(executionDate, startTime, endTime)}</p>
          </div>
          <button type="button" className={styles.modalCloseButton} onClick={onClose} disabled={isSubmitting}>Fechar</button>
        </header>
        <div className={styles.modalBody}>
          <label className={styles.field}>
            <span>Equipe</span>
            <select value={selectedTeamId} onChange={(event) => onSelectedTeamIdChange(event.target.value)} disabled={isSubmitting}>
              <option value="">Selecionar equipe...</option>
              {availableTeams.map((team) => (
                <option key={team.id} value={team.id}>{team.name} — {team.foremanName || "Sem encarregado"}</option>
              ))}
            </select>
          </label>

          {check.status !== "idle" && (
            <p className={checkFeedbackClass(check.status)} role="status" aria-live="polite">
              {isChecking ? "Verificando disponibilidade da equipe..." : check.message}
            </p>
          )}

          <button
            type="button"
            className={styles.buttonPrimary}
            onClick={onConfirm}
            disabled={isSubmitting || isChecking || isBlocked || !selectedTeamId}
          >
            Concluir
          </button>
        </div>
      </article>
    </div>
  );
}
