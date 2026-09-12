"use client";

import { useCallback, useEffect, useState } from "react";

import { formatDateTime } from "@/lib/utils/formatters";

import { fetchPiHistory } from "../api";
import styles from "../PermissionInterventionPageView.module.css";
import type { PiComparisonRow, PiHistoryEntry } from "../types";

/**
 * Painel de comparacao Programacao x PI e modal de historico.
 *
 * A comparacao chega calculada do servidor, contra o snapshot tirado quando a
 * PI nasceu da etapa. Divergir e AVISO: a tela mostra e deixa seguir. PI criada
 * sem Programacao nao tem origem a comparar e o painel nao aparece.
 */

export function PiComparisonPanel({ rows }: { rows: PiComparisonRow[] }) {
  if (rows.length === 0) return null;

  const divergentCount = rows.filter((row) => row.divergent).length;

  return (
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>Programacao x PI</h3>
        <span className={divergentCount > 0 ? styles.badgeWarn : styles.badgeOk}>
          {divergentCount > 0 ? `${divergentCount} divergencia(s)` : "Sem divergencia"}
        </span>
      </div>

      <p className={styles.intro}>
        Comparacao com a etapa no momento em que a PI foi criada. Divergir nao impede salvar nem emitir.
      </p>

      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Campo</th>
              <th>Programacao</th>
              <th>PI</th>
              <th>Situacao</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.field}>
                <td>{row.label}</td>
                <td>{row.programmingValue || "-"}</td>
                <td>{row.piValue || "-"}</td>
                <td>
                  <span className={row.divergent ? styles.badgeWarn : styles.badgeOk}>
                    {row.divergent ? "Divergente" : "Igual"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Traduz uma chave de coluna do banco no rotulo da tela. */
const FIELD_LABELS: Record<string, string> = {
  manager_name: "Nome do Gestor",
  company_name: "Empresa",
  contract_number: "N. Contrato",
  activity_description: "Descricao das atividades",
  feeder: "Alimentador",
  address: "Endereco",
  start_time: "Hora de inicio",
  end_time: "Hora de termino",
  supervisor_person_id: "Supervisor",
  foreman_person_id: "Encarregado",
  status: "Status",
  pi_code: "Codigo da PI",
  programming_id: "Etapa vinculada",
  link_status: "Situacao do vinculo",
  stepCount: "Etapas do plano",
  piCode: "Codigo da PI",
  activeVersion: "Versao ativa",
};

const ACTION_LABELS: Record<string, string> = {
  CREATE: "PI criada",
  UPDATE: "Edicao",
  UPDATE_EXECUTION_PLAN: "Plano de Execucao alterado",
  MARK_READY: "Marcada como pronta",
  REOPEN: "Devolvida para rascunho",
  ISSUE: "Emitida",
  CANCEL: "Cancelada",
  LINK_AUTO: "Vinculo automatico",
  LINK_MANUAL: "Vinculo manual",
  RELINK: "Vinculo trocado",
};

function describeValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "vazio";
  return String(value);
}

export function PiHistoryModal({
  accessToken,
  piId,
  onClose,
}: {
  accessToken: string;
  piId: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<PiHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setItems(await fetchPiHistory(accessToken, piId));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Falha ao carregar o historico.");
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, piId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-label="Historico da PI">
      <div className={styles.modal}>
        <header className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>Historico da PI</h3>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Fechar">
            x
          </button>
        </header>

        <div className={styles.modalBody}>
          {isLoading ? <p className={styles.mutedText}>Carregando...</p> : null}
          {error ? <p className={styles.feedbackError}>{error}</p> : null}
          {!isLoading && !error && items.length === 0 ? <p className={styles.mutedText}>Sem registros.</p> : null}

          {items.map((entry) => (
            <article key={entry.id} className={styles.historyEntry}>
              <header className={styles.historyHeader}>
                <strong>{ACTION_LABELS[entry.actionType] ?? entry.actionType}</strong>
                <span className={styles.mutedText}>
                  {formatDateTime(entry.createdAt)} por {entry.createdByName}
                </span>
              </header>
              {entry.reason ? <p className={styles.mutedText}>Motivo: {entry.reason}</p> : null}
              {Object.keys(entry.changes ?? {}).length > 0 ? (
                <ul className={styles.tagList}>
                  {Object.entries(entry.changes).map(([field, change]) => (
                    <li key={field}>
                      <strong>{FIELD_LABELS[field] ?? field}</strong>: {describeValue(change.from)} para{" "}
                      {describeValue(change.to)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </div>

        <footer className={styles.modalFooter}>
          <button type="button" className={styles.secondaryButton} onClick={onClose}>
            Fechar
          </button>
        </footer>
      </div>
    </div>
  );
}
