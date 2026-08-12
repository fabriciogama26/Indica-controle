// Painel "Prazos das Obras" do Mapa de Programacao.
//
// Movido verbatim de programacao-simples/components.tsx no C2 do corte da
// Programacao Normalizada. Mesmo JSX, mesmas classes — a unica mudanca e a
// origem do CSS module, agora proprio do cluster (ver o cabecalho de
// ProgrammingDeadline.module.css para o motivo).

import {
  type DeadlinePanelItem,
  type DeadlinePanelSummary,
  type DeadlineViewMode,
  type DeadlineVisualVariant,
  formatDeadlineDate,
} from "../deadline";
import styles from "./ProgrammingDeadline.module.css";

const DEADLINE_VIEW_OPTIONS: Array<{ value: DeadlineViewMode; label: string }> = [
  { value: "15", label: "15 dias" },
  { value: "30", label: "30 dias" },
  { value: "60", label: "60 dias" },
  { value: "90", label: "90 dias" },
];

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
          {DEADLINE_VIEW_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`${styles.deadlineViewToggleButton} ${
                viewMode === option.value ? styles.deadlineViewToggleButtonActive : ""
              }`}
              onClick={() => onViewModeChange(option.value)}
            >
              {option.label}
            </button>
          ))}
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
                      <span>Data limite: {formatDeadlineDate(item.executionDeadline)}</span>
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
