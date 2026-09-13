"use client";

import { useCallback, useEffect, useState } from "react";

import { CsvExportButton } from "@/components/ui/CsvExportButton";
import { Pagination } from "@/components/ui/Pagination";
import { useAuth } from "@/hooks/useAuth";
import { usePagination } from "@/hooks/usePagination";
import { buildCsvContent, downloadCsvFile } from "@/lib/utils/csv";
import { formatDateTime } from "@/lib/utils/formatters";

import { buildChangeHistoryQuery, fetchAuditableScreens, fetchChangeHistory } from "./api";
import styles from "./AuditPageView.module.css";
import { EMPTY_CHANGE_FILTERS, type ChangeHistoryFiltersState, type ChangeHistoryItem, type FeedbackState, type ScreenOption } from "./types";

const PAGE_SIZE = 20;

const CHANGE_TYPE_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "UPDATE", label: "Atualizacao" },
  { value: "CANCEL", label: "Cancelamento" },
  { value: "ACTIVATE", label: "Reativacao" },
];

function describeChanges(changes: ChangeHistoryItem["changes"]) {
  const entries = Object.entries(changes ?? {});
  if (!entries.length) {
    return null;
  }
  return entries;
}

export function ChangesTab() {
  const { session } = useAuth();
  const [filters, setFilters] = useState<ChangeHistoryFiltersState>(EMPTY_CHANGE_FILTERS);
  const [activeFilters, setActiveFilters] = useState<ChangeHistoryFiltersState>(EMPTY_CHANGE_FILTERS);
  const [items, setItems] = useState<ChangeHistoryItem[]>([]);
  const [screens, setScreens] = useState<ScreenOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const pagination = usePagination({ pageSize: PAGE_SIZE });

  useEffect(() => {
    if (!session?.accessToken) return;
    fetchAuditableScreens(session.accessToken).then(({ ok, data }) => {
      if (ok) {
        setScreens(data.screens ?? []);
      }
    });
  }, [session?.accessToken]);

  const loadItems = useCallback(
    async (targetPage: number, targetFilters: ChangeHistoryFiltersState) => {
      if (!session?.accessToken) return;
      setIsLoading(true);
      try {
        const query = buildChangeHistoryQuery(targetFilters, targetPage, PAGE_SIZE);
        const { ok, data } = await fetchChangeHistory(session.accessToken, query);
        if (!ok) {
          setItems([]);
          pagination.setTotal(0);
          setFeedback({ type: "error", message: data.message ?? "Falha ao carregar o historico de alteracoes." });
          return;
        }
        setItems(data.items ?? []);
        pagination.setTotal(data.pagination?.total ?? 0);
      } catch {
        setItems([]);
        pagination.setTotal(0);
        setFeedback({ type: "error", message: "Falha ao carregar o historico de alteracoes." });
      } finally {
        setIsLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session?.accessToken],
  );

  useEffect(() => {
    void loadItems(1, EMPTY_CHANGE_FILTERS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.accessToken]);

  function handleSearch() {
    setFeedback(null);
    setActiveFilters(filters);
    pagination.setPage(1);
    void loadItems(1, filters);
  }

  function handleClear() {
    setFeedback(null);
    setFilters(EMPTY_CHANGE_FILTERS);
    setActiveFilters(EMPTY_CHANGE_FILTERS);
    pagination.setPage(1);
    void loadItems(1, EMPTY_CHANGE_FILTERS);
  }

  function handlePageChange(nextPage: number) {
    pagination.setPage(nextPage);
    void loadItems(nextPage, activeFilters);
  }

  function handleExport() {
    if (!items.length) {
      setFeedback({ type: "error", message: "Nao ha registros carregados para exportar." });
      return;
    }
    const headers = ["Data", "Tela", "Usuario", "Matricula", "Tipo", "Registro", "Alteracoes"];
    const rows = items.map((item) => [
      formatDateTime(item.createdAt),
      item.moduleKey,
      item.userName,
      item.userMatricula ?? "",
      item.changeType,
      item.entityCode ?? item.entityId,
      Object.entries(item.changes)
        .map(([field, change]) => `${field}: ${change.from ?? "-"} -> ${change.to ?? "-"}`)
        .join(" | "),
    ]);
    downloadCsvFile(buildCsvContent(headers, rows), `historico-alteracoes_${new Date().toISOString().slice(0, 10)}.csv`);
  }

  return (
    <>
      <article className={styles.card}>
        <h2 className={styles.cardTitle}>Filtrar alteracoes</h2>
        <div className={styles.filterGrid}>
          <label className={styles.field}>
            <span>Tela</span>
            <select value={filters.moduleKey} onChange={(event) => setFilters((prev) => ({ ...prev, moduleKey: event.target.value }))}>
              <option value="">Todas</option>
              {screens.map((screen) => (
                <option key={screen.pageKey} value={screen.pageKey}>
                  {screen.name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Usuario (nome ou matricula)</span>
            <input
              type="text"
              value={filters.userQuery}
              onChange={(event) => setFilters((prev) => ({ ...prev, userQuery: event.target.value }))}
              placeholder="Nome, login ou matricula"
            />
          </label>
          <label className={styles.field}>
            <span>Tipo de alteracao</span>
            <select value={filters.changeType} onChange={(event) => setFilters((prev) => ({ ...prev, changeType: event.target.value }))}>
              {CHANGE_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Codigo do registro</span>
            <input
              type="text"
              value={filters.entityCode}
              onChange={(event) => setFilters((prev) => ({ ...prev, entityCode: event.target.value }))}
              placeholder="Ex.: numero do projeto"
            />
          </label>
          <label className={styles.field}>
            <span>De</span>
            <input type="date" value={filters.dateFrom} onChange={(event) => setFilters((prev) => ({ ...prev, dateFrom: event.target.value }))} />
          </label>
          <label className={styles.field}>
            <span>Ate</span>
            <input type="date" value={filters.dateTo} onChange={(event) => setFilters((prev) => ({ ...prev, dateTo: event.target.value }))} />
          </label>
          <div className={styles.actions}>
            <button type="button" className={styles.primaryButton} onClick={handleSearch} disabled={isLoading}>
              Buscar
            </button>
            <button type="button" className={styles.ghostButton} onClick={handleClear} disabled={isLoading}>
              Limpar
            </button>
          </div>
        </div>
      </article>

      {feedback ? (
        <div className={feedback.type === "success" ? `${styles.feedback} ${styles.feedbackSuccess}` : `${styles.feedback} ${styles.feedbackError}`}>
          {feedback.message}
        </div>
      ) : null}

      <article className={styles.card}>
        <div className={styles.tableHeader}>
          <div>
            <h2 className={styles.cardTitle}>Alteracoes registradas</h2>
            <p className={styles.tableHint}>Quem alterou o que, em qual tela, com data e diferenca de campos.</p>
          </div>
          <CsvExportButton onClick={handleExport} disabled={isLoading || !items.length} showProgressModal={false} />
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Data</th>
                <th>Tela</th>
                <th>Usuario</th>
                <th>Tipo</th>
                <th>Registro</th>
                <th>O que mudou</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} className={styles.emptyRow}>
                    Carregando...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className={styles.emptyRow}>
                    Nenhuma alteracao encontrada com os filtros atuais.
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const changeEntries = describeChanges(item.changes);
                  return (
                    <tr key={item.id}>
                      <td>{formatDateTime(item.createdAt)}</td>
                      <td>{item.moduleKey}</td>
                      <td>
                        {item.userName}
                        {item.userMatricula ? ` (${item.userMatricula})` : ""}
                      </td>
                      <td>{item.changeType}</td>
                      <td>{item.entityCode ?? item.entityId}</td>
                      <td>
                        {changeEntries ? (
                          <ul className={styles.changeList}>
                            {changeEntries.map(([field, change]) => (
                              <li key={field}>
                                <strong>{field}:</strong> {change.from ?? "-"} {"→"} {change.to ?? "-"}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          item.reason ?? "-"
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          total={pagination.total}
          onPrev={() => handlePageChange(Math.max(1, pagination.page - 1))}
          onNext={() => handlePageChange(Math.min(pagination.totalPages, pagination.page + 1))}
          disabled={isLoading}
        />
      </article>
    </>
  );
}
