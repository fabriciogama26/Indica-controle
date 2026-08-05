import styles from "../../ProgrammingNormalizedPageView.module.css";
import type { TeamItem } from "../../types";

export function AddTeamModal(props: {
  isOpen: boolean;
  availableTeams: TeamItem[];
  selectedTeamId: string;
  isSubmitting: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onSelectedTeamIdChange: (value: string) => void;
}) {
  const { isOpen, availableTeams, selectedTeamId, isSubmitting, onClose, onConfirm, onSelectedTeamIdChange } = props;
  if (!isOpen) return null;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className={styles.modalHeader}>
          <h4>Adicionar equipe</h4>
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
          <button type="button" className={styles.buttonPrimary} onClick={onConfirm} disabled={isSubmitting || !selectedTeamId}>
            Adicionar
          </button>
        </div>
      </article>
    </div>
  );
}
