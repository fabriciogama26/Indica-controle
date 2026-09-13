"use client";

import { useCallback, useEffect, useState } from "react";

import { CsvExportButton } from "@/components/ui/CsvExportButton";
import { Pagination } from "@/components/ui/Pagination";
import { useAuth } from "@/hooks/useAuth";
import { usePagination } from "@/hooks/usePagination";
import { buildCsvContent, downloadCsvFile } from "@/lib/utils/csv";
import { formatDateTime } from "@/lib/utils/formatters";

import { buildAccessLogQuery, fetchAccessLog } from "./api";
import styles from "./AuditPageView.module.css";
import { EMPTY_ACCESS_FILTERS, type AccessLogFiltersState, type AccessLogItem, type FeedbackState } from "./types";

const PAGE_SIZE = 20;

const STATUS_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "SUCCESS", label: "Sucesso" },
  { value: "FAILED", label: "Falha" },
];

const EVENT_TYPE_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "LOGIN", label: "Login" },
  { value: "LOGOUT", label: "Logout" },
];

const REASON_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "USER_LOGOUT", label: "Logout manual" },
  { value: "IDLE_TIMEOUT", label: "Inatividade" },
  { value: "TOKEN_EXPIRED", label: "Token expirado" },
  { value: "USER_NOT_FOUND", label: "Usuario nao encontrado" },
  { value: "INACTIVE", label: "Usuario inativo" },
  { value: "AUTH_INVALID", label: "Credencial invalida" },
];

const SOURCE_OPTIONS = [
  { value: "", label: "Todas" },
  { value: "APP", label: "App" },
  { value: "SITE", label: "Site" },
];

function statusClassName(status: string) {
  return status === "SUCCESS" ? styles.statusSuccess : styles.statusFailed;
}

export function AccessTab() {
  const { session } = useAuth();
  const [filters, setFilters] = useState<AccessLogFiltersState>(EMPTY_ACCESS_FILTERS);
  const [activeFilters, setActiveFilters] = useState<AccessLogFiltersState>(EMPTY_ACCESS_FILTERS);
  const [items, setItems] = useState<AccessLogItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const pagination = usePagination({ pageSize: PAGE_SIZE });

  const loadItems = useCallback(
    async (targetPage: number, targetFilters: AccessLogFiltersState) => {
      if (!session?.accessToken) return;
      setIsLoading(true);
      try {
        const query = buildAccessLogQuery(targetFilters, targetPage, PAGE_SIZE);
        const { ok, data } = await fetchAccessLog(session.accessToken, query);
        if (!ok) {
          setItems([]);
          pagination.setTotal(0);
          setFeedback({ type: "error", message: data.message ?? "Falha ao carregar o log de acessos." });
          return;
        }
        setItems(data.items ?? []);
        pagination.setTotal(data.pagination?.total ?? 0);
      } catch {
        setItems([]);
        pagination.setTotal(0);
        setFeedback({ type: "error", message: "Falha ao carregar o log de acessos." });
      } finally {
        setIsLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session?.accessToken],
  );

  useEffect(() => {
    void loadItems(1, EMPTY_ACCESS_FILTERS);
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
    setFilters(EMPTY_ACCESS_FILTERS);
    setActiveFilters(EMPTY_ACCESS_FILTERS);
    pagination.setPage(1);
    void loadItems(1, EMPTY_ACCESS_FILTERS);
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
    const headers = ["Data", "Evento", "Status", "Motivo", "Origem", "Login", "Matricula"];
    const rows = items.map((item) => [
      formatDateTime(item.eventAt),
      item.eventType,
      item.status,
      item.reason ?? "",
      item.source,
      item.loginName ?? "",
      item.matricula ?? "",
    ]);
    downloadCsvFile(buildCsvContent(headers, rows), `log-acessos_${new Date().toISOString().slice(0, 10)}.csv`);
  }

  return (
    <>
      <article className={styles.card}>
        <h2 className={styles.cardTitle}>Filtrar acessos</h2>
        <div className={styles.filterGrid}>
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
            <span>Status</span>
            <select value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Evento</span>
            <select value={filters.eventType} onChange={(event) => setFilters((prev) => ({ ...prev, eventType: event.target.value }))}>
              {EVENT_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Motivo</span>
            <select value={filters.reason} onChange={(event) => setFilters((prev) => ({ ...prev, reason: event.target.value }))}>
              {REASON_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Origem</span>
            <select value={filters.source} onChange={(event) => setFilters((prev) => ({ ...prev, source: event.target.value }))}>
              {SOURCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
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
            <h2 className={styles.cardTitle}>Acessos registrados</h2>
            <p className={styles.tableHint}>Login, logout e motivo de saida (incluindo inatividade), por usuario.</p>
          </div>
          <CsvExportButton onClick={handleExport} disabled={isLoading || !items.length} showProgressModal={false} />
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Data</th>
                <th>Evento</th>
                <th>Status</th>
                <th>Motivo</th>
                <th>Origem</th>
                <th>Usuario</th>
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
                    Nenhum acesso encontrado com os filtros atuais.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id}>
                    <td>{formatDateTime(item.eventAt)}</td>
                    <td>{item.eventType}</td>
                    <td>
                      <span className={`${styles.statusTag} ${statusClassName(item.status)}`}>{item.status}</span>
                    </td>
                    <td>{item.reason ?? "-"}</td>
                    <td>{item.source}</td>
                    <td>
                      {item.loginName ?? "-"}
                      {item.matricula ? ` (${item.matricula})` : ""}
                    </td>
                  </tr>
                ))
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
