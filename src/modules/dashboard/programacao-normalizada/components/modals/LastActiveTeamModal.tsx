import styles from "../../ProgrammingNormalizedPageView.module.css";

// Cancelar/adiar a ULTIMA equipe ativa esvaziaria a etapa silenciosamente — a
// RPC recusa (reason LAST_ACTIVE_TEAM) ate o usuario decidir aqui.
export function LastActiveTeamModal(props: {
  isOpen: boolean;
  teamName: string;
  isSubmitting: boolean;
  onClose: () => void;
  onCancelWholeStage: () => void;
  onKeepWithoutTeam: () => void;
}) {
  const { isOpen, teamName, isSubmitting, onClose, onCancelWholeStage, onKeepWithoutTeam } = props;
  if (!isOpen) return null;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className={styles.modalHeader}>
          <h4>Ultima equipe ativa da etapa</h4>
          <button type="button" className={styles.modalCloseButton} onClick={onClose} disabled={isSubmitting}>Fechar</button>
        </header>
        <div className={styles.modalBody}>
          <p>{teamName} e a unica equipe ativa desta etapa. O que voce quer fazer?</p>
          <button type="button" className={styles.buttonDanger} onClick={onCancelWholeStage} disabled={isSubmitting}>
            Cancelar a etapa inteira
          </button>
          <button type="button" className={styles.buttonPrimary} onClick={onKeepWithoutTeam} disabled={isSubmitting}>
            Manter a etapa sem equipe
          </button>
          <button type="button" className={styles.buttonSecondary} onClick={onClose} disabled={isSubmitting}>
            Voltar
          </button>
        </div>
      </article>
    </div>
  );
}
