"use client";

import {
  BLOCKED_DATE_KIND_LABELS,
  BLOCKED_DATE_SCOPE_LABELS,
  formatBlockedDateShort,
  type ActiveBlockedDate,
} from "@/modules/dashboard/datas-bloqueadas";

import styles from "../MapProgrammingPageView.module.css";

const MONTH_NAMES = [
  "janeiro",
  "fevereiro",
  "marco",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

function formatMonthLabel(isoDate: string) {
  const [year, month] = isoDate.split("-").map(Number);
  const name = MONTH_NAMES[(month ?? 1) - 1] ?? "";
  return name ? `${name} de ${year}` : isoDate;
}

/**
 * Aviso das datas bloqueadas do mes vigente.
 *
 * Diferente da Programacao, aqui NAO da para filtrar pelo municipio do projeto:
 * o Mapa e uma visao de carteira, com obras de varios municipios na mesma tela.
 * Entao as datas MUNICIPAIS aparecem todas, com o municipio no rotulo, e quem
 * le decide se afeta a obra que esta olhando.
 */
export function BlockedDatesMonthPanel(props: {
  blockedDates: ActiveBlockedDate[];
  monthStartDate: string;
  isLoading: boolean;
}) {
  const { blockedDates, monthStartDate, isLoading } = props;
  const monthLabel = formatMonthLabel(monthStartDate);

  return (
    <article className={styles.card}>
      <div className={styles.cardHeader}>
        <div>
          <h3>Datas bloqueadas em {monthLabel}</h3>
          <span>
            Datas em que a operacao nao deve programar. O aviso nao impede a gravacao na Programacao.
          </span>
        </div>
      </div>

      {isLoading ? <div className={styles.emptyState}>Carregando datas bloqueadas...</div> : null}

      {!isLoading && blockedDates.length === 0 ? (
        <div className={styles.emptyState}>Nenhuma data bloqueada cadastrada para {monthLabel}.</div>
      ) : null}

      {!isLoading && blockedDates.length > 0 ? (
        <ul className={styles.blockedDatesList}>
          {blockedDates.map((item) => (
            <li key={item.id} className={styles.blockedDateItem}>
              <strong>{formatBlockedDateShort(item.blockedDate)}</strong>
              <span>{item.description}</span>
              <small>
                {BLOCKED_DATE_KIND_LABELS[item.kind] ?? item.kind}
                {" | "}
                {item.scope === "MUNICIPAL" && item.municipalityName
                  ? `${BLOCKED_DATE_SCOPE_LABELS.MUNICIPAL} - ${item.municipalityName}`
                  : BLOCKED_DATE_SCOPE_LABELS[item.scope] ?? item.scope}
              </small>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
