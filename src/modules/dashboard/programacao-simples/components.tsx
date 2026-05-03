import { HISTORY_FIELD_LABELS } from "./constants";
import styles from "./ProgrammingSimplePageView.module.css";
import type {
  AlertModalState,
  DeadlineViewMode,
  DeadlineVisualVariant,
  ProgrammingHistoryItem,
  ProgrammingReasonOptionItem,
  ProjectItem,
  ScheduleItem,
  StageValidationTeamSummary,
  TeamItem,
} from "./types";
import {
  formatAuditActor,
  formatDate,
  formatDateTime,
  formatHistoryAction,
  formatHistoryValue,
  getDisplayProgrammingStatus,
  isInactiveProgrammingStatus,
  normalizeSgdNumberForExport,
  resolveReasonOption,
  resolveScheduleTeamInfo,
} from "./utils";

type StageConflictModalState = {
  enteredEtapaNumber: number;
  highestStage: number;
  teams: StageValidationTeamSummary[];
};

type DeadlineModalItem = {
  id: string;
  sob: string;
  executionDeadline: string;
  statusLabel: string;
  daysDiff: number;
  rangeLabel: string;
};

type DeadlinePanelSummary = {
  dueToday: number;
  dueSoon: number;
  overdue: number;
  normal: number;
};

type DeadlinePanelItem = {
  id: string;
  sob: string;
  executionDeadline: string;
  statusLabel: string;
  visualVariant: DeadlineVisualVariant;
};

function getDeadlineCardClassName(visualVariant: DeadlineVisualVariant) {
  if (visualVariant === "OVERDUE_CRITICAL") {
    return styles.deadlineSobCardOverdueCritical;
  }

  if (visualVariant === "OVERDUE") {
    return styles.deadlineSobCardOverdue;
  }

  if (visualVariant === "TODAY") {
    return styles.deadlineSobCardToday;
  }

  if (visualVariant === "SOON") {
    return styles.deadlineSobCardSoon;
  }

  return styles.deadlineSobCardNormal;
}

export function ProgrammingDeadlinePanel(props: {
  summary: DeadlinePanelSummary;
  windowHeading: string;
  viewMode: DeadlineViewMode;
  windowDays: number;
  pages: DeadlinePanelItem[][];
  carouselPage: number;
  totalPages: number;
  onViewModeChange: (value: DeadlineViewMode) => void;
  onOpenModal: () => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
}) {
  const {
    summary,
    windowHeading,
    viewMode,
    windowDays,
    pages,
    carouselPage,
    totalPages,
    onViewModeChange,
    onOpenModal,
    onPreviousPage,
    onNextPage,
  } = props;

  return (
    <article className={styles.card}>
      <h3 className={styles.cardTitle}>Prazos das Obras</h3>
      <div className={styles.deadlineSummaryGrid}>
        <article className={`${styles.deadlineSummaryCard} ${styles.deadlineSummaryToday}`}>
          <strong>Vence hoje</strong>
          <span>{summary.dueToday}</span>
        </article>
        <article className={`${styles.deadlineSummaryCard} ${styles.deadlineSummarySoon}`}>
          <strong>Vence em breve</strong>
          <span>{summary.dueSoon}</span>
        </article>
        <article className={`${styles.deadlineSummaryCard} ${styles.deadlineSummaryOverdue}`}>
          <strong>Vencida</strong>
          <span>{summary.overdue}</span>
        </article>
        <article className={`${styles.deadlineSummaryCard} ${styles.deadlineSummaryNormal}`}>
          <strong>No prazo</strong>
          <span>{summary.normal}</span>
        </article>
      </div>

      <div className={`${styles.sectionHeader} ${styles.deadlineSectionHeader}`}>
        <div>
          <h4>{windowHeading}</h4>
          <p>Cards por obra com data limite, status do prazo e alerta visual.</p>
        </div>
        <div className={styles.deadlineViewToggle} role="group" aria-label="Janela de prazo dos cards SOB">
          <button
            type="button"
            className={`${styles.deadlineViewToggleButton} ${
              viewMode === "15" ? styles.deadlineViewToggleButtonActive : ""
            }`}
            onClick={() => onViewModeChange("15")}
          >
            15 dias
          </button>
          <button
            type="button"
            className={`${styles.deadlineViewToggleButton} ${
              viewMode === "30" ? styles.deadlineViewToggleButtonActive : ""
            }`}
            onClick={() => onViewModeChange("30")}
          >
            30 dias
          </button>
          <button type="button" className={styles.secondaryButton} onClick={onOpenModal}>
            Ver todos
          </button>
        </div>
      </div>

      {pages.length ? (
        <div className={styles.deadlineCarouselWrapper}>
          <button
            type="button"
            className={styles.deadlineCarouselButton}
            onClick={onPreviousPage}
            disabled={carouselPage === 0}
            aria-label="Pagina anterior dos cards SOB"
          >
            {"<"}
          </button>
          <div className={styles.deadlineCarouselViewport}>
            <div
              className={styles.deadlineCarouselTrack}
              style={{ transform: `translateX(-${carouselPage * 100}%)` }}
            >
              {pages.map((pageItems, pageIndex) => (
                <div key={`deadline-page-${pageIndex}`} className={styles.deadlineCarouselPage}>
                  {pageItems.map((item) => (
                    <article
                      key={item.id}
                      className={`${styles.deadlineSobCard} ${getDeadlineCardClassName(item.visualVariant)}`}
                    >
                      <strong>SOB {item.sob}</strong>
                      <span>Data limite: {formatDate(item.executionDeadline)}</span>
                      <span>Status: {item.statusLabel}</span>
                    </article>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <button
            type="button"
            className={styles.deadlineCarouselButton}
            onClick={onNextPage}
            disabled={carouselPage >= totalPages - 1}
            aria-label="Proxima pagina dos cards SOB"
          >
            {">"}
          </button>
        </div>
      ) : (
        <p className={styles.emptyHint}>Nenhuma obra com data limite ate {windowDays} dias a frente.</p>
      )}

      {pages.length ? (
        <p className={styles.deadlineCarouselPageInfo}>
          Pagina {carouselPage + 1} de {totalPages}
        </p>
      ) : null}
    </article>
  );
}

export function ProgrammingDeadlineModal(props: {
  isOpen: boolean;
  items: DeadlineModalItem[];
  windowDays: number;
  isExporting: boolean;
  onClose: () => void;
  onExport: () => void;
}) {
  const { isOpen, items, windowDays, isExporting, onClose, onExport } = props;
  if (!isOpen) {
    return null;
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className={styles.modalHeader}>
          <div className={styles.modalTitleBlock}>
            <h4>Todos os prazos das obras ({windowDays} dias)</h4>
            <p className={styles.modalSubtitle}>
              Total: {items.length} | Janela: ate {windowDays} dias | Concluidas nao entram.
            </p>
          </div>
          <button type="button" className={styles.modalCloseButton} onClick={onClose}>
            Fechar
          </button>
        </header>

        <div className={styles.modalBody}>
          <div className={styles.deadlineModalActions}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={onExport}
              disabled={isExporting || !items.length}
            >
              {isExporting ? "Exportando..." : "Exportar Excel (CSV)"}
            </button>
          </div>

          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>SOB</th>
                  <th>Data limite</th>
                  <th>Status do prazo</th>
                  <th>Dias para vencimento</th>
                  <th>Faixa</th>
                </tr>
              </thead>
              <tbody>
                {items.length ? (
                  items.map((item) => (
                    <tr key={`deadline-modal-${item.id}`}>
                      <td>{item.sob}</td>
                      <td>{formatDate(item.executionDeadline)}</td>
                      <td>{item.statusLabel}</td>
                      <td>{item.daysDiff}</td>
                      <td>{item.rangeLabel}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className={styles.emptyRow} colSpan={5}>
                      Nenhuma obra encontrada para a janela selecionada.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </article>
    </div>
  );
}

export function ProgrammingDetailsModal(props: {
  target: ScheduleItem | null;
  projectMap: Map<string, ProjectItem>;
  teamMap: Map<string, TeamItem>;
  onClose: () => void;
}) {
  const { target, projectMap, teamMap, onClose } = props;
  if (!target) {
    return null;
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className={styles.modalHeader}>
          <div className={styles.modalTitleBlock}>
            <h4>Detalhes da Programacao</h4>
            <p className={styles.modalSubtitle}>ID da programacao: {target.id}</p>
          </div>
          <button type="button" className={styles.modalCloseButton} onClick={onClose}>
            Fechar
          </button>
        </header>
        <div className={styles.modalBody}>
          <div className={styles.detailsGrid}>
            <p><strong>Status:</strong> {getDisplayProgrammingStatus(target)}</p>
            <p><strong>Criado por:</strong> {formatAuditActor(target.createdByName)}</p>
            <p><strong>Criado em:</strong> {formatDateTime(target.createdAt)}</p>
            <p><strong>Atualizado por:</strong> {formatAuditActor(target.updatedByName)}</p>
            <p><strong>Atualizado em:</strong> {formatDateTime(target.updatedAt)}</p>
            <p><strong>Projeto:</strong> {projectMap.get(target.projectId)?.code ?? target.projectId}</p>
            <p><strong>Equipe:</strong> {resolveScheduleTeamInfo(target, teamMap).name}</p>
            <p><strong>Data execucao:</strong> {formatDate(target.date)}</p>
            <p><strong>Horario:</strong> {target.startTime} - {target.endTime}</p>
            <p><strong>Inicio de desligamento:</strong> {target.outageStartTime || "-"}</p>
            <p><strong>Termino de desligamento:</strong> {target.outageEndTime || "-"}</p>
            <p><strong>POSTE:</strong> {target.posteQty}</p>
            <p><strong>ESTRUTURA:</strong> {target.estruturaQty}</p>
            <p><strong>TRAFO:</strong> {target.trafoQty}</p>
            <p><strong>REDE:</strong> {target.redeQty}</p>
            <p><strong>ETAPA:</strong> {target.etapaNumber ?? "-"}</p>
            <p><strong>ETAPA ÚNICA:</strong> {target.etapaUnica ? "Sim" : "Nao"}</p>
            <p><strong>ETAPA FINAL:</strong> {target.etapaFinal ? "Sim" : "Nao"}</p>
            <p><strong>Estado Trabalho:</strong> {target.workCompletionStatus || "-"}</p>
            <p><strong>Nº Clientes Afetados:</strong> {target.affectedCustomers}</p>
            <p><strong>Tipo de SGD:</strong> {target.sgdTypeDescription || "-"}</p>
            <p><strong>Numero SGD:</strong> {normalizeSgdNumberForExport(target.documents?.sgd?.number) || "-"}</p>
            <p><strong>Nº EQ (tipo):</strong> {target.electricalEqCode || "-"}</p>
            <p><strong>Apoio:</strong> {target.support || "-"}</p>
            <p><strong>Alimentador:</strong> {target.feeder || "-"}</p>
            <p><strong>Nº EQ (numero):</strong> {target.electricalField || "-"}</p>
            <p className={styles.detailWide}><strong>Descricao do servico:</strong> {target.serviceDescription || "-"}</p>
            <p className={styles.detailWide}><strong>Anotacao:</strong> {target.note || "-"}</p>
            {isInactiveProgrammingStatus(getDisplayProgrammingStatus(target)) ? (
              <>
                <p><strong>Data do cancelamento/adiamento:</strong> {formatDateTime(target.statusChangedAt ?? "")}</p>
                <p className={styles.detailWide}>
                  <strong>Motivo do cancelamento/adiamento:</strong> {target.statusReason || "-"}
                </p>
              </>
            ) : null}
          </div>
        </div>
      </article>
    </div>
  );
}

export function ProgrammingHistoryModal(props: {
  target: ScheduleItem | null;
  items: ProgrammingHistoryItem[];
  pagedItems: ProgrammingHistoryItem[];
  isLoading: boolean;
  page: number;
  totalPages: number;
  onClose: () => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
}) {
  const { target, items, pagedItems, isLoading, page, totalPages, onClose, onPreviousPage, onNextPage } = props;
  if (!target) {
    return null;
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className={styles.modalHeader}>
          <div className={styles.modalTitleBlock}>
            <h4>Historico da Programacao</h4>
            <p className={styles.modalSubtitle}>ID da programacao: {target.id}</p>
          </div>
          <button type="button" className={styles.modalCloseButton} onClick={onClose}>
            Fechar
          </button>
        </header>

        <div className={styles.modalBody}>
          {isLoading ? <p className={styles.emptyHint}>Carregando historico...</p> : null}
          {!isLoading && items.length === 0 ? (
            <p className={styles.emptyHint}>Nenhuma alteracao registrada.</p>
          ) : null}
          {!isLoading && items.length > 0 ? (
            <div className={styles.historyList}>
              {pagedItems.map((item) => {
                const changedFields = Object.entries(item.changes ?? {}).filter(([, change]) => {
                  return (change.from ?? "") !== (change.to ?? "");
                });

                return (
                  <article key={item.id} className={styles.historyCard}>
                    <header className={styles.historyCardHeader}>
                      <strong>{formatHistoryAction(item.action)}</strong>
                      <span>{formatDateTime(item.changedAt)} | {formatAuditActor(item.changedByName)}</span>
                    </header>

                    <div className={styles.historyChanges}>
                      {changedFields.length ? (
                        changedFields.map(([field, change]) => (
                          <div key={field} className={styles.historyChangeItem}>
                            <strong>{HISTORY_FIELD_LABELS[field] ?? field}</strong>
                            <span>De: {formatHistoryValue(field, change.from)}</span>
                            <span>Para: {formatHistoryValue(field, change.to)}</span>
                          </div>
                        ))
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
          {!isLoading && items.length > 0 ? (
            <div className={styles.historyPagination}>
              <span>
                Pagina {Math.min(page, totalPages)} de {totalPages} | Total: {items.length}
              </span>
              <div className={styles.paginationActions}>
                <button
                  type="button"
                  className={styles.ghostButton}
                  onClick={onPreviousPage}
                  disabled={page <= 1}
                >
                  Anterior
                </button>
                <button
                  type="button"
                  className={styles.ghostButton}
                  onClick={onNextPage}
                  disabled={page >= totalPages}
                >
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

export function ProgrammingPostponeModal(props: {
  target: ScheduleItem | null;
  reasonOptions: ProgrammingReasonOptionItem[];
  reasonCode: string;
  reasonNotes: string;
  date: string;
  minDate: string;
  isSubmitting: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onDateChange: (value: string) => void;
  onReasonCodeChange: (value: string) => void;
  onReasonNotesChange: (value: string) => void;
}) {
  const {
    target,
    reasonOptions,
    reasonCode,
    reasonNotes,
    date,
    minDate,
    isSubmitting,
    onClose,
    onConfirm,
    onDateChange,
    onReasonCodeChange,
    onReasonNotesChange,
  } = props;
  if (!target) {
    return null;
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className={styles.modalHeader}>
          <h4>Adiar Programacao</h4>
          <button type="button" className={styles.modalCloseButton} onClick={onClose} disabled={isSubmitting}>
            Fechar
          </button>
        </header>

        <div className={styles.modalBody}>
          <p>
            Informe o motivo e a nova data da programacao. A programacao atual sera marcada como ADIADA e um novo
            registro sera criado para a nova data com status REPROGRAMADA. A nova data deve ser posterior a data
            atual da programacao.
          </p>

          <label className={styles.field}>
            <span>
              Nova data da programacao <span className="requiredMark">*</span>
            </span>
            <input
              type="date"
              value={date}
              onChange={(event) => onDateChange(event.target.value)}
              min={minDate}
              disabled={isSubmitting}
            />
          </label>

          <label className={styles.field}>
            <span>
              Motivo do adiamento <span className="requiredMark">*</span>
            </span>
            <select
              value={reasonCode}
              onChange={(event) => onReasonCodeChange(event.target.value)}
              disabled={isSubmitting}
            >
              <option value="">Selecione</option>
              {reasonOptions.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </select>
            {resolveReasonOption(reasonOptions, reasonCode)?.requiresNotes ? (
              <textarea
                value={reasonNotes}
                onChange={(event) => onReasonNotesChange(event.target.value)}
                rows={3}
                placeholder="Descreva a observacao complementar do motivo."
                disabled={isSubmitting}
              />
            ) : null}
          </label>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={onConfirm}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Adiando..." : "Validar adiamento"}
            </button>
            <button type="button" className={styles.ghostButton} onClick={onClose} disabled={isSubmitting}>
              Voltar
            </button>
          </div>
        </div>
      </article>
    </div>
  );
}

export function ProgrammingCancelModal(props: {
  target: ScheduleItem | null;
  reasonOptions: ProgrammingReasonOptionItem[];
  reasonCode: string;
  reasonNotes: string;
  canSubmit: boolean;
  isSubmitting: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onReasonCodeChange: (value: string) => void;
  onReasonNotesChange: (value: string) => void;
}) {
  const {
    target,
    reasonOptions,
    reasonCode,
    reasonNotes,
    canSubmit,
    isSubmitting,
    onClose,
    onConfirm,
    onReasonCodeChange,
    onReasonNotesChange,
  } = props;
  if (!target) {
    return null;
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className={styles.modalHeader}>
          <h4>Cancelar Programacao</h4>
          <button type="button" className={styles.modalCloseButton} onClick={onClose} disabled={isSubmitting}>
            Fechar
          </button>
        </header>

        <div className={styles.modalBody}>
          <p>
            Selecione o motivo do cancelamento. Quando o motivo exigir observacao, preencha o campo complementar.
          </p>

          <label className={styles.field}>
            <span>
              Motivo do cancelamento <span className="requiredMark">*</span>
            </span>
            <select
              value={reasonCode}
              onChange={(event) => onReasonCodeChange(event.target.value)}
            >
              <option value="">Selecione</option>
              {reasonOptions.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </select>
            {resolveReasonOption(reasonOptions, reasonCode)?.requiresNotes ? (
              <textarea
                value={reasonNotes}
                onChange={(event) => onReasonNotesChange(event.target.value)}
                rows={3}
                placeholder="Descreva a observacao complementar do motivo."
              />
            ) : null}
          </label>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.dangerButton}
              onClick={onConfirm}
              disabled={!canSubmit}
            >
              {isSubmitting ? "Cancelando..." : "Validar cancelamento"}
            </button>
            <button type="button" className={styles.ghostButton} onClick={onClose} disabled={isSubmitting}>
              Voltar
            </button>
          </div>
        </div>
      </article>
    </div>
  );
}

export function ProgrammingAlertModal(props: {
  modal: AlertModalState | null;
  onClose: () => void;
}) {
  const { modal, onClose } = props;
  if (!modal) {
    return null;
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className={styles.modalHeader}>
          <div className={styles.modalTitleBlock}>
            <h4>{modal.title}</h4>
            <p className={styles.modalSubtitle}>Revise os dados antes de tentar novamente.</p>
          </div>
          <button type="button" className={styles.modalCloseButton} onClick={onClose}>
            Fechar
          </button>
        </header>

        <div className={styles.modalBody}>
          <div className={styles.warningCard}>
            <p>{modal.message}</p>
          </div>

          {modal.details?.length ? (
            <div className={styles.historyCard}>
              <div className={styles.historyCardHeader}>
                <strong>Possiveis pontos para revisar</strong>
              </div>
              <ul className={styles.alertList}>
                {modal.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </article>
    </div>
  );
}

export function ProgrammingStageConflictModal(props: {
  modal: StageConflictModalState | null;
  onClose: () => void;
}) {
  const { modal, onClose } = props;
  if (!modal) {
    return null;
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className={styles.modalHeader}>
          <div className={styles.modalTitleBlock}>
            <h4>Conflito de ETAPA</h4>
            <p className={styles.modalSubtitle}>
              A ETAPA {modal.enteredEtapaNumber} conflita com o historico ja existente para este projeto.
            </p>
          </div>
          <button type="button" className={styles.modalCloseButton} onClick={onClose}>
            Fechar
          </button>
        </header>

        <div className={styles.modalBody}>
          <div className={styles.warningCard}>
            <p>
              <strong>Maior etapa encontrada:</strong> {modal.highestStage}
            </p>
            <p>
              Corrija o campo <strong>ETAPA</strong> no formulario antes de tentar salvar novamente.
            </p>
          </div>

          <div className={styles.historyList}>
            {modal.teams.map((team) => (
              <article key={team.teamId} className={styles.historyCard}>
                <div className={styles.historyCardHeader}>
                  <strong>{team.teamName}</strong>
                  <span>Maior etapa: {team.highestStage}</span>
                </div>
                <div className={styles.historyChanges}>
                  <div className={styles.historyChangeItem}>
                    <strong>Etapas ja encontradas</strong>
                    <span>{team.existingStages.join(", ")}</span>
                  </div>
                  <div className={styles.historyChangeItem}>
                    <strong>Datas encontradas</strong>
                    <span>{team.existingDates.length ? team.existingDates.map(formatDate).join(", ") : "-"}</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </article>
    </div>
  );
}
