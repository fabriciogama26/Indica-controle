"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ActionIcon } from "@/components/ui/ActionIcon";
import { CsvExportButton } from "@/components/ui/CsvExportButton";
import { useAuth } from "@/hooks/useAuth";
import { useErrorLogger } from "@/hooks/useErrorLogger";
import styles from "./ReversalsPageView.module.css";
import { formatDateTime } from "@/lib/utils/formatters";

type ReversalRow = {
  id: string;
  source: "ESTOQUE" | "EQUIPE";
  sourceLabel: string;
  reversalType: "ITEM" | "INTEGRAL";
  reversalTypeLabel: string;
  operationCode: string;
  operationLabel: string;
  originalTransferId: string;
  originalTransferItemId: string | null;
  reversalTransferId: string;
  reversalTransferItemId: string | null;
  projectCode: string;
  teamName: string | null;
  foremanName: string | null;
  fromStockCenterName: string;
  toStockCenterName: string;
  materialCode: string;
  description: string;
  unit: string;
  materialType: string;
  quantity: number;
  serialNumber: string | null;
  lotCode: string | null;
  entryType: string;
  originalOperationDate: string;
  reversalOperationDate: string | null;
  reversedAt: string;
  reversalReasonCode: string;
  reversalReasonLabel: string;
  reversalReasonNotes: string | null;
  reversalReason: string;
  reversedByUserId: string | null;
  reversedByName: string;
};

type Summary = {
  total: number;
  stockMovementCount: number;
  teamOperationCount: number;
  itemCount: number;
  fullCount: number;
};

type FilterOption = {
  id?: string;
  code?: string;
  name?: string;
  label?: string;
};

type ReversalsResponse = {
  message?: string;
  rows?: ReversalRow[];
  summary?: Summary;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
  };
  filters?: {
    users?: FilterOption[];
    reasons?: FilterOption[];
  };
  isTruncated?: boolean;
};

type FilterState = {
  originalStartDate: string;
  originalEndDate: string;
  reversalStartDate: string;
  reversalEndDate: string;
  source: "" | "ESTOQUE" | "EQUIPE";
  reversalType: "" | "ITEM" | "INTEGRAL";
  operation: string;
  projectCode: string;
  teamName: string;
  materialCode: string;
  serialNumber: string;
  lotCode: string;
  reasonCode: string;
  userId: string;
};

const INITIAL_FILTERS: FilterState = {
  originalStartDate: "",
  originalEndDate: "",
  reversalStartDate: "",
  reversalEndDate: "",
  source: "",
  reversalType: "",
  operation: "",
  projectCode: "",
  teamName: "",
  materialCode: "",
  serialNumber: "",
  lotCode: "",
  reasonCode: "",
  userId: "",
};

const PAGE_SIZE = 20;

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const [datePart] = value.split("T");
  const parts = datePart.split("-");
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return value;
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(Number.isFinite(value) ? value : 0);
}

function toIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function csvEscape(value: unknown) {
  const normalized = String(value ?? "").replace(/"/g, '""');
  return `"${normalized}"`;
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function buildSearchParams(filters: FilterState, page: number, pageSize: number) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  Object.entries(filters).forEach(([key, value]) => {
    if (String(value ?? "").trim()) params.set(key, String(value));
  });
  return params;
}

function statusClass(row: ReversalRow) {
  if (row.source === "EQUIPE") return styles.sourceTeam;
  return styles.sourceStock;
}

export function ReversalsPageView() {
  const { session } = useAuth();
  const logError = useErrorLogger("estornos");
  const hasLoadedInitialData = useRef(false);
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [activeFilters, setActiveFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [rows, setRows] = useState<ReversalRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [users, setUsers] = useState<FilterOption[]>([]);
  const [reasons, setReasons] = useState<FilterOption[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [detailRow, setDetailRow] = useState<ReversalRow | null>(null);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const canGoPrevious = page > 1 && !isLoading;
  const canGoNext = page < pageCount && !isLoading;

  const loadReversals = useCallback(
    async (nextFilters: FilterState, nextPage: number) => {
      if (!session?.accessToken) return;

      setIsLoading(true);
      try {
        const params = buildSearchParams(nextFilters, nextPage, PAGE_SIZE);
        const response = await fetch(`/api/estornos?${params.toString()}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });
        const payload = (await response.json().catch(() => ({}))) as ReversalsResponse;

        if (!response.ok) {
          throw new Error(payload.message ?? "Falha ao carregar Estornos.");
        }

        setRows(payload.rows ?? []);
        setSummary(payload.summary ?? null);
        setUsers(payload.filters?.users ?? []);
        setReasons(payload.filters?.reasons ?? []);
        setTotal(payload.pagination?.total ?? 0);
        setPage(payload.pagination?.page ?? nextPage);
        setIsTruncated(Boolean(payload.isTruncated));
        setFeedback(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha ao carregar Estornos.";
        setFeedback({ type: "error", message });
        await logError("Falha ao carregar Estornos", error, nextFilters);
      } finally {
        setIsLoading(false);
      }
    },
    [logError, session?.accessToken],
  );

  useEffect(() => {
    if (!session?.accessToken) {
      hasLoadedInitialData.current = false;
      return;
    }

    if (hasLoadedInitialData.current) return;
    hasLoadedInitialData.current = true;
    void loadReversals(INITIAL_FILTERS, 1);
  }, [loadReversals, session?.accessToken]);

  function updateFilter<K extends keyof FilterState>(key: K, value: FilterState[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function handleFilter() {
    setActiveFilters(filters);
    void loadReversals(filters, 1);
  }

  function handleClearFilters() {
    setFilters(INITIAL_FILTERS);
    setActiveFilters(INITIAL_FILTERS);
    void loadReversals(INITIAL_FILTERS, 1);
  }

  function handlePageChange(nextPage: number) {
    void loadReversals(activeFilters, nextPage);
  }

  const exportRows = useCallback(async () => {
    if (!session?.accessToken || isExporting) return;

    setIsExporting(true);
    try {
      const params = buildSearchParams(activeFilters, 1, 50000);
      const response = await fetch(`/api/estornos?${params.toString()}`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
      });
      const payload = (await response.json().catch(() => ({}))) as ReversalsResponse;
      if (!response.ok) throw new Error(payload.message ?? "Falha ao exportar Estornos.");

      const exportData = payload.rows ?? [];
      if (!exportData.length) {
        setFeedback({ type: "error", message: "Nao ha estornos para exportar." });
        return;
      }

      const header = [
        "Origem",
        "Tipo do estorno",
        "Operacao original",
        "Projeto",
        "Equipe",
        "Centro DE original",
        "Centro PARA original",
        "Material",
        "Descricao",
        "Quantidade",
        "Serial",
        "LP",
        "Data operacao original",
        "Data movimentacao estorno",
        "Registrado em",
        "Motivo",
        "Observacao motivo",
        "Usuario",
        "Transferencia original",
        "Transferencia estorno",
      ];
      const lines = exportData.map((row) => [
        row.sourceLabel,
        row.reversalTypeLabel,
        row.operationLabel,
        row.projectCode,
        row.teamName ?? "",
        row.fromStockCenterName,
        row.toStockCenterName,
        row.materialCode,
        row.description,
        formatQuantity(row.quantity),
        row.serialNumber ?? "",
        row.lotCode ?? "",
        formatDate(row.originalOperationDate),
        formatDate(row.reversalOperationDate),
        formatDateTime(row.reversedAt),
        row.reversalReasonLabel,
        row.reversalReasonNotes ?? "",
        row.reversedByName,
        row.originalTransferId,
        row.reversalTransferId,
      ]);
      const csv = `\uFEFF${[header, ...lines].map((line) => line.map(csvEscape).join(";")).join("\n")}`;
      downloadCsv(csv, `estornos_${toIsoDate(new Date())}.csv`);
      setFeedback({ type: "success", message: "Estornos exportados com sucesso." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao exportar Estornos.";
      setFeedback({ type: "error", message });
      await logError("Falha ao exportar Estornos", error, activeFilters);
    } finally {
      setIsExporting(false);
    }
  }, [activeFilters, isExporting, logError, session?.accessToken]);

  const metrics = useMemo(
    () => [
      { label: "Total de estornos", value: summary?.total ?? 0 },
      { label: "Movimentacao de Estoque", value: summary?.stockMovementCount ?? 0 },
      { label: "Operacoes de Equipe", value: summary?.teamOperationCount ?? 0 },
      { label: "Por item", value: summary?.itemCount ?? 0 },
      { label: "Integral legado", value: summary?.fullCount ?? 0 },
    ],
    [summary],
  );

  return (
    <section className={styles.wrapper}>
      {feedback ? (
        <div className={feedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError}>
          {feedback.message}
        </div>
      ) : null}

      {isTruncated ? (
        <div className={styles.feedbackError}>
          O volume de estornos no periodo excede o limite de consulta. Refine o filtro por data de estorno para garantir que todos os registros sejam exibidos.
        </div>
      ) : null}

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Filtros</h2>
            <p className={styles.cardSubtitle}>Consulta de estornos registrados nas telas operacionais do almoxarifado.</p>
          </div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.secondaryButton} onClick={handleClearFilters} disabled={isLoading}>
              Limpar
            </button>
            <button type="button" className={styles.primaryButton} onClick={handleFilter} disabled={isLoading}>
              {isLoading ? "Filtrando..." : "Filtrar"}
            </button>
          </div>
        </div>

        <div className={styles.filterGrid}>
          <label className={styles.field}>
            <span>Operacao original de</span>
            <input type="date" value={filters.originalStartDate} onChange={(event) => updateFilter("originalStartDate", event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Operacao original ate</span>
            <input type="date" value={filters.originalEndDate} onChange={(event) => updateFilter("originalEndDate", event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Estorno registrado de</span>
            <input type="date" value={filters.reversalStartDate} onChange={(event) => updateFilter("reversalStartDate", event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Estorno registrado ate</span>
            <input type="date" value={filters.reversalEndDate} onChange={(event) => updateFilter("reversalEndDate", event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Origem</span>
            <select value={filters.source} onChange={(event) => updateFilter("source", event.target.value as FilterState["source"])}>
              <option value="">Todas</option>
              <option value="ESTOQUE">Movimentacao de Estoque</option>
              <option value="EQUIPE">Operacoes de Equipe</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Tipo do estorno</span>
            <select value={filters.reversalType} onChange={(event) => updateFilter("reversalType", event.target.value as FilterState["reversalType"])}>
              <option value="">Todos</option>
              <option value="ITEM">Por item</option>
              <option value="INTEGRAL">Integral legado</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Operacao</span>
            <select value={filters.operation} onChange={(event) => updateFilter("operation", event.target.value)}>
              <option value="">Todas</option>
              <option value="ENTRY">Entrada</option>
              <option value="EXIT">Saida</option>
              <option value="TRANSFER">Transferencia</option>
              <option value="REQUISITION">Requisicao</option>
              <option value="RETURN">Devolucao</option>
              <option value="FIELD_RETURN">Retorno de campo</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Projeto</span>
            <input value={filters.projectCode} onChange={(event) => updateFilter("projectCode", event.target.value)} placeholder="SOB" />
          </label>
          <label className={styles.field}>
            <span>Equipe</span>
            <input value={filters.teamName} onChange={(event) => updateFilter("teamName", event.target.value)} placeholder="Nome da equipe" />
          </label>
          <label className={styles.field}>
            <span>Material</span>
            <input value={filters.materialCode} onChange={(event) => updateFilter("materialCode", event.target.value)} placeholder="Codigo" />
          </label>
          <label className={styles.field}>
            <span>Serial</span>
            <input value={filters.serialNumber} onChange={(event) => updateFilter("serialNumber", event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>LP</span>
            <input value={filters.lotCode} onChange={(event) => updateFilter("lotCode", event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Motivo</span>
            <select value={filters.reasonCode} onChange={(event) => updateFilter("reasonCode", event.target.value)}>
              <option value="">Todos</option>
              {reasons.map((reason) => (
                <option key={reason.code} value={reason.code}>
                  {reason.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Usuario</span>
            <select value={filters.userId} onChange={(event) => updateFilter("userId", event.target.value)}>
              <option value="">Todos</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </article>

      <div className={styles.summaryGrid}>
        {metrics.map((metric) => (
          <div key={metric.label} className={styles.metric}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </div>
        ))}
      </div>

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Lista de estornos</h2>
            <p className={styles.cardSubtitle}>Cada linha representa um item original vinculado a uma movimentacao de estorno.</p>
          </div>
          <CsvExportButton onClick={exportRows} disabled={isLoading || isExporting || total === 0} isLoading={isExporting} className={styles.secondaryButton} />
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Origem</th>
                <th>Tipo</th>
                <th>Operacao</th>
                <th>Projeto</th>
                <th>Equipe</th>
                <th>Material</th>
                <th>Descricao</th>
                <th>Quantidade</th>
                <th>Serial</th>
                <th>LP</th>
                <th>Data original</th>
                <th>Registrado em</th>
                <th>Motivo</th>
                <th>Usuario</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td><span className={statusClass(row)}>{row.sourceLabel}</span></td>
                  <td>{row.reversalTypeLabel}</td>
                  <td>{row.operationLabel}</td>
                  <td>{row.projectCode}</td>
                  <td>{row.teamName ?? "-"}</td>
                  <td><strong>{row.materialCode}</strong></td>
                  <td>{row.description}</td>
                  <td className={styles.numericCell}>{formatQuantity(row.quantity)}</td>
                  <td>{row.serialNumber ?? "-"}</td>
                  <td>{row.lotCode ?? "-"}</td>
                  <td>{formatDate(row.originalOperationDate)}</td>
                  <td>{formatDateTime(row.reversedAt)}</td>
                  <td>{row.reversalReasonLabel}</td>
                  <td>{row.reversedByName}</td>
                  <td>
                    <button type="button" className={styles.iconButton} onClick={() => setDetailRow(row)} title="Detalhes">
                      <ActionIcon name="details" />
                    </button>
                  </td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={15} className={styles.emptyRow}>
                    {isLoading ? "Carregando estornos..." : "Nenhum estorno encontrado para os filtros selecionados."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className={styles.pagination}>
          <span>
            Pagina {page} de {pageCount} | {total} registro(s)
          </span>
          <div className={styles.paginationActions}>
            <button type="button" onClick={() => handlePageChange(page - 1)} disabled={!canGoPrevious}>
              Anterior
            </button>
            <button type="button" onClick={() => handlePageChange(page + 1)} disabled={!canGoNext}>
              Proxima
            </button>
          </div>
        </div>
      </article>

      {detailRow ? (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <div>
                <h2>Detalhes do estorno</h2>
                <p>{detailRow.sourceLabel} | {detailRow.reversalTypeLabel}</p>
              </div>
              <button type="button" className={styles.closeButton} onClick={() => setDetailRow(null)}>
                Fechar
              </button>
            </div>

            <div className={styles.detailGrid}>
              <div><strong>Operacao original:</strong> {detailRow.operationLabel}</div>
              <div><strong>Projeto:</strong> {detailRow.projectCode}</div>
              <div><strong>Equipe:</strong> {detailRow.teamName ?? "-"}</div>
              <div><strong>Encarregado:</strong> {detailRow.foremanName ?? "-"}</div>
              <div><strong>Centro DE original:</strong> {detailRow.fromStockCenterName}</div>
              <div><strong>Centro PARA original:</strong> {detailRow.toStockCenterName}</div>
              <div><strong>Material:</strong> {detailRow.materialCode}</div>
              <div><strong>Descricao:</strong> {detailRow.description}</div>
              <div><strong>Quantidade:</strong> {formatQuantity(detailRow.quantity)}</div>
              <div><strong>Tipo:</strong> {detailRow.entryType}</div>
              <div><strong>Serial:</strong> {detailRow.serialNumber ?? "-"}</div>
              <div><strong>LP:</strong> {detailRow.lotCode ?? "-"}</div>
              <div><strong>Data original:</strong> {formatDate(detailRow.originalOperationDate)}</div>
              <div><strong>Data movimentacao estorno:</strong> {formatDate(detailRow.reversalOperationDate)}</div>
              <div><strong>Registrado em:</strong> {formatDateTime(detailRow.reversedAt)}</div>
              <div><strong>Usuario:</strong> {detailRow.reversedByName}</div>
              <div><strong>Motivo:</strong> {detailRow.reversalReasonLabel}</div>
              <div><strong>Observacao:</strong> {detailRow.reversalReasonNotes ?? "-"}</div>
              <div><strong>Transferencia original:</strong> {detailRow.originalTransferId}</div>
              <div><strong>Item original:</strong> {detailRow.originalTransferItemId ?? "-"}</div>
              <div><strong>Transferencia de estorno:</strong> {detailRow.reversalTransferId}</div>
              <div><strong>Item de estorno:</strong> {detailRow.reversalTransferItemId ?? "-"}</div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
