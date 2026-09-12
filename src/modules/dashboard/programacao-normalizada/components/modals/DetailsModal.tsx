import styles from "../../ProgrammingNormalizedPageView.module.css";
import {
  formatDate,
  getStageDisplayClassification,
  getStageDisplayExecutionDate,
  getStageStatusLabel,
  getWorkCompletionLabel,
} from "../../utils";
import type { ProgrammingStage } from "../../types";

export function DetailsModal(props: { target: ProgrammingStage | null; onClose: () => void }) {
  const { target, onClose } = props;
  if (!target) return null;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className={styles.modalHeader}>
          <h4>Detalhes da etapa — {formatDate(getStageDisplayExecutionDate(target))}</h4>
          <button type="button" className={styles.modalCloseButton} onClick={onClose}>Fechar</button>
        </header>
        <div className={styles.detailGrid}>
          <span>
            <strong>Classificacao:</strong> {getStageDisplayClassification(target).label}
            {/* Etapa em espera perdeu a data: mostra a que tinha ao sair do plano (337). */}
            {!target.executionDate && getStageDisplayExecutionDate(target)
              ? ` (data original ${formatDate(getStageDisplayExecutionDate(target))})`
              : ""}
          </span>
          <span><strong>Status:</strong> {getStageStatusLabel(target.status)}</span>
          <span><strong>Estado Trabalho:</strong> {getWorkCompletionLabel(target.workCompletionStatus)}</span>
          <span><strong>Periodo:</strong> {target.period ?? "-"}</span>
          <span><strong>Horario:</strong> {target.startTime ?? "-"} - {target.endTime ?? "-"}</span>
          <span><strong>Desligamento:</strong> {target.outageStartTime ?? "-"} - {target.outageEndTime ?? "-"}</span>
          <span><strong>Alimentador:</strong> {target.feeder || "-"}</span>
          <span><strong>Ponto Eletrico:</strong> {target.campoEletrico || "-"}</span>
          <span><strong>Clientes afetados:</strong> {target.affectedCustomers ?? "-"}</span>
          <span><strong>Apoio:</strong> {target.support || "-"}</span>
          <span><strong>Poste:</strong> {target.posteQty}</span>
          <span><strong>Estrutura:</strong> {target.estruturaQty}</span>
          <span><strong>Trafo:</strong> {target.trafoQty}</span>
          <span><strong>Rede:</strong> {target.redeQty}</span>
          <span className={styles.fieldFullRow}><strong>Descricao:</strong> {target.serviceDescription || "-"}</span>
          <span className={styles.fieldFullRow}><strong>Anotacao:</strong> {target.note || "-"}</span>
          <span className={styles.fieldFullRow}>
            <strong>Equipes:</strong>{" "}
            {target.teams.filter((team) => team.status === "ATIVA").length
              ? target.teams
                  .filter((team) => team.status === "ATIVA")
                  .map((team) => `${team.teamName} (${team.programmedForemanName || "Sem encarregado"})`)
                  .join(" / ")
              : "-"}
          </span>
          {target.cancellationReason ? (
            <span className={styles.fieldFullRow}><strong>Motivo cancelamento:</strong> {target.cancellationReason}</span>
          ) : null}
        </div>
      </article>
    </div>
  );
}
