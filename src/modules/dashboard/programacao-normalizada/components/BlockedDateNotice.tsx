import {
  findBlockedDatesFor,
  formatBlockedDateLabel,
  type ActiveBlockedDate,
} from "@/modules/dashboard/datas-bloqueadas";

import styles from "../ProgrammingNormalizedPageView.module.css";

/**
 * Aviso de data bloqueada nos campos de data da Programacao.
 *
 * AVISO, NAO TRAVA: a decisao de negocio (ver a migration 424) e sinalizar sem
 * impedir. Nenhuma RPC recusa a data, entao este componente nao desabilita
 * botao nem invalida formulario — ele so informa. Aparece no cadastro de etapa,
 * em Adiar etapa, em Adiar equipe e em Corrigir data.
 *
 * `cityName` e o municipio do PROJETO: datas NACIONAL sempre avisam, MUNICIPAL
 * so quando o municipio casa. Sem municipio conhecido as municipais ficam fora,
 * para nao avisar sobre feriado de outra cidade.
 */
export function BlockedDateNotice(props: {
  blockedDates: ActiveBlockedDate[];
  isoDate: string;
  cityName: string | null;
}) {
  const matches = findBlockedDatesFor(props.blockedDates, props.isoDate, props.cityName);
  if (!matches.length) {
    return null;
  }

  return (
    <div className={`${styles.feedback} ${styles.feedbackError}`} role="status">
      <strong>Data bloqueada:</strong> {matches.map(formatBlockedDateLabel).join(" | ")}. Confirme antes de programar
      nesta data.
    </div>
  );
}
