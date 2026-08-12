// Modal "Todos os prazos das obras" do Mapa de Programacao.
//
// Movido verbatim de programacao-simples/components.tsx no C2 do corte da
// Programacao Normalizada. Mesmo JSX, mesmas classes — so a origem do CSS
// module mudou (ver o cabecalho de ProgrammingDeadline.module.css).

import { CsvExportButton } from "@/components/ui/CsvExportButton";

import { type DeadlineModalItem, formatDeadlineDate } from "../deadline";
import styles from "./ProgrammingDeadline.module.css";

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
            <CsvExportButton
              onClick={onExport}
              disabled={isExporting || !items.length}
              isLoading={isExporting}
              className={styles.secondaryButton}
            />
          </div>

          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>SOB</th>
                  <th>Centro de servico</th>
                  <th>Prioridade</th>
                  <th>Tipo de obra</th>
                  <th>Data limite</th>
                  <th>Data Programacao</th>
                  <th>Motivo</th>
                  <th>Estado Trabalho</th>
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
                      <td>{item.serviceCenter}</td>
                      <td>{item.priority}</td>
                      <td>{item.workType}</td>
                      <td>{formatDeadlineDate(item.executionDeadline)}</td>
                      <td>{item.latestProgrammingDate ? formatDeadlineDate(item.latestProgrammingDate) : "-"}</td>
                      <td>{item.reason || "-"}</td>
                      <td>{item.workCompletionStatus || "-"}</td>
                      <td>{item.statusLabel}</td>
                      <td>{item.daysDiff}</td>
                      <td>{item.rangeLabel}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className={styles.emptyRow} colSpan={11}>
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
