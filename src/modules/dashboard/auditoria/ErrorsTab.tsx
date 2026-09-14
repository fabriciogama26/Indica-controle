"use client";

import { useCallback, useEffect, useState } from "react";

import { CsvExportButton } from "@/components/ui/CsvExportButton";
import { Pagination } from "@/components/ui/Pagination";
import { useAuth } from "@/hooks/useAuth";
import { useExportCooldown } from "@/hooks/useExportCooldown";
import { usePagination } from "@/hooks/usePagination";
import { buildCsvContent, downloadCsvFile } from "@/lib/utils/csv";
import { formatDateTime } from "@/lib/utils/formatters";

import { buildErrorLogExportQuery, buildErrorLogQuery, fetchErrorLog, fetchErrorLogExport } from "./api";
import styles from "./AuditPageView.module.css";
import { EMPTY_ERROR_FILTERS, type ErrorLogFiltersState, type ErrorLogItem, type FeedbackState } from "./types";

const PAGE_SIZE = 20;

const SEVERITY_OPTIONS = [
  { value: "", label: "Todas" },
  { value: "ERROR", label: "Erro" },
  { value: "WARNING", label: "Alerta" },
  { value: "INFO", label: "Informativo" },
];

const SOURCE_OPTIONS = [
  { value: "", label: "Todas" },
  { value: "WEB", label: "Web (front)" },
  { value: "APP", label: "App" },
];

export function ErrorsTab() {
  const { session } = useAuth();
  const [filters, setFilters] = useState<ErrorLogFiltersState>(EMPTY_ERROR_FILTERS);
  const [activeFilters, setActiveFilters] = useState<ErrorLogFiltersState>(EMPTY_ERROR_FILTERS);
  const [items, setItems] = useState<ErrorLogItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const pagination = usePagination({ pageSize: PAGE_SIZE });
  const exportCooldown = useExportCooldown();

  const loadItems = useCallback(
    async (targetPage: number, targetFilters: ErrorLogFiltersState) => {
      if (!session?.accessToken) return;
      setIsLoading(true);
      try {
        const query = buildErrorLogQuery(targetFilters, targetPage, PAGE_SIZE);
        const { ok, data } = await fetchErrorLog(session.accessToken, query);
        if (!ok) {
          setItems([]);
          pagination.setTotal(0);
          setFeedback({ type: "error", message: data.message ?? "Falha ao carregar o log de erros." });
          return;
        }
        setItems(data.items ?? []);
        pagination.setTotal(data.pagination?.total ?? 0);
      } catch {
        setItems([]);
        pagination.setTotal(0);
        setFeedback({ type: "error", message: "Falha ao carregar o log de erros." });
      } finally {
        setIsLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session?.accessToken],
  );

  useEffect(() => {
    void loadItems(1, EMPTY_ERROR_FILTERS);
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
    setFilters(EMPTY_ERROR_FILTERS);
    setActiveFilters(EMPTY_ERROR_FILTERS);
    pagination.setPage(1);
    void loadItems(1, EMPTY_ERROR_FILTERS);
  }

  function handlePageChange(nextPage: number) {
    pagination.setPage(nextPage);
    void loadItems(nextPage, activeFilters);
  }

  async function handleExport() {
    if (!session?.accessToken) {
      setFeedback({ type: "error", message: "Sessao invalida para exportar." });
      return;
    }
    if (!exportCooldown.tryStart()) {
      setFeedback({ type: "error", message: `Aguarde ${exportCooldown.getRemainingSeconds()}s antes de exportar novamente.` });
      return;
    }

    setIsExporting(true);
    try {
      const query = buildErrorLogExportQuery(activeFilters);
      const { ok, data } = await fetchErrorLogExport(session.accessToken, query);
      if (!ok) {
        setFeedback({ type: "error", message: data.message ?? "Falha ao exportar o log de erros." });
        return;
      }

      const allItems = data.items ?? [];
      if (allItems.length === 0) {
        setFeedback({ type: "error", message: "Nenhum registro encontrado para exportar com os filtros atuais." });
        return;
      }

      const headers = ["Data", "Origem", "Severidade", "Tela", "Mensagem", "Usuario", "Matricula"];
      const rows = allItems.map((item) => [
        formatDateTime(item.createdAt),
        item.source,
        item.severity,
        item.screen ?? "",
        item.message,
        item.loginName ?? "",
        item.matricula ?? "",
      ]);
      downloadCsvFile(buildCsvContent(headers, rows), `log-erros_${new Date().toISOString().slice(0, 10)}.csv`);

      setFeedback({
        type: data.truncated ? "error" : "success",
        message: data.truncated
          ? `Exportacao parcial: ${allItems.length} registro(s) exportado(s). Refine os filtros para exportar o restante.`
          : `${allItems.length} registro(s) exportado(s) com sucesso.`,
      });
    } catch {
      setFeedback({ type: "error", message: "Falha ao exportar o log de erros." });
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <>
      <article className={styles.card}>
        <h2 className={styles.cardTitle}>Filtrar erros</h2>
        <p className={styles.pendingNote}>
          Hoje o campo Origem so distingue Web de App (de onde partiu a requisicao) — nao ha, ainda, separacao entre erro de
          API e erro de tela dentro do Web. Todo registro aqui veio de um catch tratado manualmente nas telas; excecoes nao
          tratadas (rota de API ou tela) nao aparecem.
        </p>
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
            <span>Severidade</span>
            <select value={filters.severity} onChange={(event) => setFilters((prev) => ({ ...prev, severity: event.target.value }))}>
              {SEVERITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Tela</span>
            <input
              type="text"
              value={filters.screen}
              onChange={(event) => setFilters((prev) => ({ ...prev, screen: event.target.value }))}
              placeholder="Busca parcial pelo nome da tela"
            />
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
            <h2 className={styles.cardTitle}>Erros registrados</h2>
            <p className={styles.tableHint}>Clique na mensagem para ver o stacktrace, quando disponivel.</p>
          </div>
          <CsvExportButton
            onClick={() => void handleExport()}
            disabled={isLoading || isExporting || exportCooldown.isCoolingDown}
            isLoading={isExporting}
            className={styles.ghostButton}
          />
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Data</th>
                <th>Origem</th>
                <th>Severidade</th>
                <th>Tela</th>
                <th>Mensagem</th>
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
                    Nenhum erro encontrado com os filtros atuais.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id}>
                    <td>{formatDateTime(item.createdAt)}</td>
                    <td>{item.source}</td>
                    <td>{item.severity}</td>
                    <td>{item.screen ?? "-"}</td>
                    <td>
                      <button
                        type="button"
                        className={styles.ghostButton}
                        onClick={() => setExpandedId((current) => (current === item.id ? null : item.id))}
                      >
                        {item.message}
                      </button>
                      {expandedId === item.id && item.stacktrace ? <pre className={styles.stacktrace}>{item.stacktrace}</pre> : null}
                    </td>
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
