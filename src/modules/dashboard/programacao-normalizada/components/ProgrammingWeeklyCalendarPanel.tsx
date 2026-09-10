// Calendario Semanal da Programacao (modelo normalizado).
//
// Portado de programacao-simples/components.tsx no C4 do corte. O JSX, as classes
// e o comportamento visual sao os mesmos; o que muda e a FONTE do dado.
//
// DIFERENCA ESTRUTURAL QUE O PORTE PRECISOU RESOLVER
// ---------------------------------------------------------------------------
// O legado e uma linha por (projeto, equipe, data), entao cada celula do
// calendario ja vinha pronta. O normalizado e uma ETAPA por (projeto, data) com
// N equipes em `teams`. Quem monta o mapa `${teamId}__${data}` e o chamador, com
// fan-out por equipe ATIVA — mesmo padrao do endpoint de fontes da Medicao (C0).
// Uma etapa com 2 equipes aparece em 2 celulas, que e exatamente o que a tela
// antiga mostrava.
//
// O card usa `projectCode` que ja vem no `StageListItem`, entao aqui nao existe
// mais o `projectMap` que o legado precisava.

import {
  findBlockedDatesFor,
  formatBlockedDateLabel,
  type ActiveBlockedDate,
} from "@/modules/dashboard/datas-bloqueadas";

import {
  getStageDisplayClassification,
  isAreaLivreSgd,
} from "../utils";
import type { SgdTypeItem, StageListItem, TeamItem } from "../types";
import styles from "./ProgrammingWeeklyCalendar.module.css";

function formatDate(value: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return "-";
  }
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function formatWeekdayShort(value: string) {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }
  return ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"][parsed.getDay()];
}

function formatWeekRangeLabel(weekStartDate: string) {
  const start = new Date(`${weekStartDate}T00:00:00`);
  if (Number.isNaN(start.getTime())) {
    return "-";
  }
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  return `${formatDate(iso(start))} a ${formatDate(iso(end))}`;
}

// DATA BLOQUEADA NO CALENDARIO
// ---------------------------------------------------------------------------
// A grade e equipe x dia e nao carrega municipio: uma celula VAZIA nao tem
// projeto, logo nao da para saber se um feriado municipal a atinge. Por isso a
// marcacao tem dois niveis.
//
// NACIONAL pinta a coluna inteira, celula vazia inclusive — vale para qualquer
// projeto do tenant. MUNICIPAL marca o cabecalho do dia (com o nome do
// municipio) e so pinta as celulas cujo projeto e daquele municipio, que sao as
// unicas em que a informacao existe.
function splitBlockedDates(blockedDates: ActiveBlockedDate[], date: string) {
  const ofDay = blockedDates.filter((item) => item.blockedDate === date);
  return {
    all: ofDay,
    national: ofDay.filter((item) => item.scope === "NACIONAL"),
  };
}

// Mesma prioridade de cor do calendario legado: concluido vence status, e o
// restante segue a agenda da etapa.
function getStageCardClassName(stage: StageListItem) {
  if (stage.workCompletionStatus === "CONCLUIDO") {
    return styles.weekCardCompleted;
  }

  if (stage.status === "REPROGRAMADA") {
    return styles.weekCardRescheduled;
  }

  if (stage.status === "ADIADA") {
    return styles.weekCardPostponed;
  }

  if (stage.status === "CANCELADA") {
    return styles.weekCardCancelled;
  }

  if (stage.status === "ANTECIPADA") {
    return styles.weekCardAnticipated;
  }

  return styles.weekCardPlanned;
}

export function ProgrammingWeeklyCalendarPanel(props: {
  weekStartDate: string;
  weekDates: string[];
  calendarTeams: TeamItem[];
  weeklyStageMap: Map<string, StageListItem[]>;
  blockedDates: ActiveBlockedDate[];
  sgdTypes: SgdTypeItem[];
  isLoading: boolean;
  onPreviousWeek: () => void;
  onCurrentWeek: () => void;
  onNextWeek: () => void;
  onRefresh: () => void;
  onOpenDetails: (stage: StageListItem) => void;
  onOpenHistory: (stage: StageListItem) => void;
}) {
  const {
    weekStartDate,
    weekDates,
    calendarTeams,
    weeklyStageMap,
    blockedDates,
    sgdTypes,
    isLoading,
    onPreviousWeek,
    onCurrentWeek,
    onNextWeek,
    onRefresh,
    onOpenDetails,
    onOpenHistory,
  } = props;

  const sgdTypeById = new Map(sgdTypes.map((item) => [item.id, item]));
  const blockedByDate = new Map(weekDates.map((date) => [date, splitBlockedDates(blockedDates, date)]));

  return (
    <article className={`${styles.card} ${styles.calendarTopCard}`}>
      <div className={styles.calendarHeader}>
        <h3 className={styles.cardTitle}>Calendario Semanal de Programacao</h3>
        <div className={styles.calendarActions}>
          <button type="button" className={styles.ghostButton} onClick={onPreviousWeek}>
            Semana anterior
          </button>
          <button type="button" className={styles.secondaryButton} onClick={onCurrentWeek}>
            Semana atual
          </button>
          <button type="button" className={styles.ghostButton} onClick={onNextWeek}>
            Proxima semana
          </button>
          <button type="button" className={styles.ghostButton} onClick={onRefresh} disabled={isLoading}>
            {isLoading ? "Atualizando..." : "Atualizar"}
          </button>
        </div>
      </div>

      <p className={styles.helperText}>
        Semana exibida: <strong>{formatWeekRangeLabel(weekStartDate)}</strong> (segunda a domingo).
      </p>

      <div className={styles.weekLegend}>
        <span className={`${styles.weekLegendItem} ${styles.weekLegendPlanned}`}>Programado</span>
        <span className={`${styles.weekLegendItem} ${styles.weekLegendRescheduled}`}>Reprogramado</span>
        <span className={`${styles.weekLegendItem} ${styles.weekLegendCompleted}`}>Concluido</span>
        <span className={`${styles.weekLegendItem} ${styles.weekLegendAnticipated}`}>Antecipado</span>
        <span className={`${styles.weekLegendItem} ${styles.weekLegendPostponed}`}>Adiado</span>
        <span className={`${styles.weekLegendItem} ${styles.weekLegendCancelled}`}>Cancelado</span>
        <span className={`${styles.weekLegendItem} ${styles.weekLegendBlocked}`}>Data bloqueada</span>
      </div>

      <div className={styles.weekCalendarWrapper}>
        <div className={styles.weekCalendarHeader}>
          <div className={styles.weekCalendarTeamHeader}>Equipe</div>
          {weekDates.map((date) => {
            const blocked = blockedByDate.get(date);
            const hasBlock = Boolean(blocked?.all.length);

            return (
              <div
                key={date}
                className={`${styles.weekCalendarDayHeader} ${hasBlock ? styles.weekCalendarDayHeaderBlocked : ""}`}
              >
                <strong>{formatWeekdayShort(date)}</strong>
                <small>{formatDate(date)}</small>
                {hasBlock ? (
                  <small className={styles.weekBlockedTag} title={blocked?.all.map(formatBlockedDateLabel).join(" | ")}>
                    {blocked?.all.map((item) => item.description).join(" | ")}
                  </small>
                ) : null}
              </div>
            );
          })}
        </div>

        {calendarTeams.length ? (
          calendarTeams.map((team) => (
            <div key={team.id} className={styles.weekCalendarRow}>
              <div className={styles.weekCalendarTeamCell}>
                <strong>{team.name}</strong>
                <small>{team.foremanName || "Sem encarregado"}</small>
                <small>{team.serviceCenterName || "-"}</small>
              </div>

              {weekDates.map((date) => {
                const dayStages = weeklyStageMap.get(`${team.id}__${date}`) ?? [];
                const blocked = blockedByDate.get(date);
                // Celula vazia so pode afirmar bloqueio NACIONAL: sem etapa nao
                // existe projeto e, portanto, nao existe municipio para casar.
                const cellBlocks = dayStages.length
                  ? dayStages.flatMap((stage) => findBlockedDatesFor(blockedDates, date, stage.city))
                  : blocked?.national ?? [];
                const isCellBlocked = cellBlocks.length > 0;
                const cellBlockLabel = Array.from(new Set(cellBlocks.map((item) => item.description))).join(" | ");

                return (
                  <div
                    key={`${team.id}-${date}`}
                    className={`${styles.weekCalendarDayCell} ${isCellBlocked ? styles.weekCalendarDayCellBlocked : ""}`}
                  >
                    {isCellBlocked ? (
                      <div
                        className={styles.weekBlockedCard}
                        title={Array.from(new Set(cellBlocks.map(formatBlockedDateLabel))).join(" | ")}
                      >
                        {cellBlockLabel}
                      </div>
                    ) : null}
                    {dayStages.length ? (
                      dayStages.map((stage) => {
                        const sgdType = stage.sgdTypeId ? sgdTypeById.get(stage.sgdTypeId) ?? null : null;
                        // `deliveredAt` e o marco de aprovacao no modelo
                        // normalizado — equivale ao `approvedAt` do legado.
                        const hasSgd = stage.documents.some(
                          (doc) => doc.documentType === "SGD" && Boolean(doc.deliveredAt?.trim()),
                        );
                        const hasPi = stage.documents.some(
                          (doc) => doc.documentType === "PI" && Boolean(doc.deliveredAt?.trim()),
                        );
                        const isAreaLivre = isAreaLivreSgd(sgdType?.exportColumn, sgdType?.description);
                        const classification = getStageDisplayClassification(stage);

                        return (
                          <article key={stage.id} className={`${styles.weekCard} ${getStageCardClassName(stage)}`}>
                            <div className={styles.weekCardTop}>
                              <strong>{stage.projectCode || stage.projectId}</strong>
                            </div>

                            <div className={styles.weekIndicators}>
                              {isAreaLivre ? (
                                <span className={styles.weekIndicatorOn}>AREA LIVRE</span>
                              ) : (
                                <>
                                  <span className={hasSgd ? styles.weekIndicatorOn : styles.weekIndicatorOff}>SGD</span>
                                  <span className={hasPi ? styles.weekIndicatorOn : styles.weekIndicatorOff}>PI</span>
                                </>
                              )}
                            </div>

                            <div className={styles.weekCardActions}>
                              <button
                                type="button"
                                className={styles.weekActionButton}
                                onClick={() => onOpenDetails(stage)}
                                title="Ver detalhe"
                                aria-label={`Ver detalhe da etapa ${stage.projectCode} ${classification.label}`}
                              >
                                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                  <path
                                    d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"
                                    stroke="currentColor"
                                    strokeWidth="1.8"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                  <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                className={styles.weekActionButton}
                                onClick={() => onOpenHistory(stage)}
                                title="Historico"
                                aria-label={`Historico da etapa ${stage.projectCode} ${classification.label}`}
                              >
                                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                  <path
                                    d="M3.75 12a8.25 8.25 0 1 0 2.25-5.69M3.75 4.75v4h4"
                                    stroke="currentColor"
                                    strokeWidth="1.8"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                  <path d="M12 8.5v3.75l2.5 1.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                                </svg>
                              </button>
                            </div>
                          </article>
                        );
                      })
                    ) : isCellBlocked ? null : (
                      <div className={styles.weekEmptyCell}>Sem programacao</div>
                    )}
                  </div>
                );
              })}
            </div>
          ))
        ) : (
          <div className={styles.weekCalendarEmpty}>Nenhuma equipe disponivel para os filtros atuais.</div>
        )}
      </div>
    </article>
  );
}
