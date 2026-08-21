"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { useErrorLogger } from "@/hooks/useErrorLogger";
import { useIdempotencyKey } from "@/hooks/useIdempotencyKey";
import { formatDate, formatDateTime } from "@/lib/utils/formatters";
import styles from "./ReversalFulfillmentPageView.module.css";

type ReversalRequestItem = {
  id: string;
  originalTransferId: string;
  originalTransferItemId: string;
  requestStatus: string;
  materialCode: string;
  description: string;
  unit: string;
  quantity: number;
  serialNumber: string | null;
  lotCode: string | null;
  operationDate: string | null;
  reversalTransferId: string | null;
  reversalItemId: string | null;
};

type ReversalRequestRow = {
  id: string;
  source: "STOCK_TRANSFER" | "TEAM_OPERATION";
  sourceLabel: string;
  mode: "ITEM" | "BATCH" | "FULL";
  modeLabel: string;
  status: string;
  originalTransferId: string;
  originalTransferItemId: string | null;
  operationCode: string;
  projectCode: string;
  teamName: string | null;
  foremanName: string | null;
  fromStockCenterName: string;
  toStockCenterName: string;
  materialCode: string;
  materialDescription: string;
  itemCount: number;
  requestedAt: string;
  requestedByName: string;
  claimedByName: string | null;
  claimExpiresAt: string | null;
  reversalReasonCode: string;
  reversalReasonLabel: string;
  reversalReasonNotes: string | null;
  reversalDate: string;
  decisionNotes: string | null;
  executedAt: string | null;
  reversalTransferId: string | null;
  reversedItemCount: number;
  failureReason: string | null;
  updatedAt: string;
  items: ReversalRequestItem[];
};

type ListResponse = {
  rows?: ReversalRequestRow[];
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
  };
  message?: string;
};

type Feedback = {
  type: "success" | "error";
  message: string;
};

const PAGE_SIZE = 20;

function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return toIsoDate(date);
}

const INITIAL_FILTERS = {
  status: "ABERTOS",
  source: "",
  startDate: daysAgo(30),
  endDate: toIsoDate(new Date()),
};

function statusLabel(status: string) {
  if (status === "PENDENTE") return "Pendente";
  if (status === "EM_ANALISE") return "Em analise";
  if (status === "EXECUTADO") return "Executado";
  if (status === "RECUSADO") return "Recusado";
  if (status === "FALHA_EXECUCAO") return "Falha";
  if (status === "CANCELADO") return "Cancelado";
  return status || "-";
}

function operationLabel(code: string) {
  if (code === "ENTRY") return "Entrada";
  if (code === "EXIT") return "Saida";
  if (code === "TRANSFER") return "Transferencia";
  if (code === "REQUISITION") return "Requisicao";
  if (code === "RETURN") return "Devolucao";
  if (code === "FIELD_RETURN") return "Retorno de campo";
  return code || "-";
}

export function ReversalFulfillmentPageView() {
  const { session } = useAuth();
  const logError = useErrorLogger("estorno_atendimento");
  const actionIdempotency = useIdempotencyKey();
  const authHeaders = useMemo<Record<string, string>>(() => {
    const headers: Record<string, string> = {};
    if (session?.accessToken) {
      headers.Authorization = `Bearer ${session.accessToken}`;
    }
    return headers;
  }, [session?.accessToken]);

  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [rows, setRows] = useState<ReversalRequestRow[]>([]);
  const [selected, setSelected] = useState<ReversalRequestRow | null>(null);
  const [decisionNotes, setDecisionNotes] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  const loadList = useCallback(
    async (nextPage = page) => {
      if (!session?.accessToken) return;

      setIsLoading(true);
      setFeedback(null);
      try {
        const params = new URLSearchParams({
          page: String(nextPage),
          pageSize: String(PAGE_SIZE),
          status: filters.status,
          startDate: filters.startDate,
          endDate: filters.endDate,
        });
        if (filters.source) params.set("source", filters.source);

        const response = await fetch(`/api/stock-reversal-requests?${params.toString()}`, {
          cache: "no-store",
          headers: authHeaders,
        });
        const data = (await response.json().catch(() => ({}))) as ListResponse;
        if (!response.ok) throw new Error(data.message ?? "Falha ao carregar fila de estornos.");

        setRows(data.rows ?? []);
        setTotal(data.pagination?.total ?? 0);
        setPage(nextPage);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha ao carregar fila de estornos.";
        setFeedback({ type: "error", message });
        await logError("Falha ao carregar fila de estornos.", error, filters);
      } finally {
        setIsLoading(false);
      }
    },
    [authHeaders, filters, logError, page, session?.accessToken],
  );

  const loadDetail = useCallback(
    async (requestId: string) => {
      if (!session?.accessToken) return null;

      const response = await fetch(`/api/stock-reversal-requests?requestId=${encodeURIComponent(requestId)}`, {
        cache: "no-store",
        headers: authHeaders,
      });
      const data = (await response.json().catch(() => ({}))) as ReversalRequestRow & { message?: string };
      if (!response.ok) throw new Error(data.message ?? "Falha ao carregar pedido de estorno.");
      return data;
    },
    [authHeaders, session?.accessToken],
  );

  useEffect(() => {
    void loadList(1);
  }, [loadList]);

  async function runAction(action: "CLAIM" | "APPROVE" | "REJECT", requestId: string) {
    if (!session?.accessToken) {
      setFeedback({ type: "error", message: "Sessao invalida para atender estornos." });
      return;
    }

    if (action === "REJECT" && !decisionNotes.trim()) {
      setFeedback({ type: "error", message: "Informe o motivo da recusa." });
      return;
    }

    setIsActing(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/stock-reversal-requests", {
        method: "POST",
        cache: "no-store",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
          "Idempotency-Key": actionIdempotency.getKey(),
        },
        body: JSON.stringify({
          action,
          requestId,
          decisionNotes: decisionNotes.trim() || null,
        }),
      });
      actionIdempotency.reset();
      const data = (await response.json().catch(() => ({}))) as { message?: string; reason?: string };
      if (!response.ok) {
        throw new Error(data.message ?? "Falha ao processar pedido de estorno.");
      }

      setFeedback({ type: "success", message: data.message ?? "Pedido de estorno atualizado." });
      setDecisionNotes("");
      if (action === "CLAIM") {
        const detail = await loadDetail(requestId);
        setSelected(detail);
      } else {
        setSelected(null);
      }
      await loadList(page);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao processar pedido de estorno.";
      setFeedback({ type: "error", message });
      await logError("Falha ao processar pedido de estorno.", error, { action, requestId });
    } finally {
      setIsActing(false);
    }
  }

  async function openRequest(row: ReversalRequestRow) {
    try {
      setFeedback(null);
      const detail = await loadDetail(row.id);
      setSelected(detail);
      setDecisionNotes("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao abrir pedido de estorno.";
      setFeedback({ type: "error", message });
      await logError("Falha ao abrir pedido de estorno.", error, { requestId: row.id });
    }
  }

  function applyFilters() {
    setSelected(null);
    void loadList(1);
  }

  function clearFilters() {
    setFilters(INITIAL_FILTERS);
    setSelected(null);
    setTimeout(() => void loadList(1), 0);
  }

  return (
    <main className={styles.page}>
      {feedback ? (
        <div className={feedback.type === "success" ? styles.successFeedback : styles.errorFeedback} role={feedback.type === "error" ? "alert" : "status"}>
          {feedback.message}
        </div>
      ) : null}

      <section className={styles.filters}>
        <label>
          <span>Status</span>
          <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
            <option value="ABERTOS">Abertos</option>
            <option value="PENDENTE">Pendente</option>
            <option value="EM_ANALISE">Em analise</option>
            <option value="FALHA_EXECUCAO">Falha</option>
            <option value="EXECUTADO">Executado</option>
            <option value="RECUSADO">Recusado</option>
            <option value="TODOS">Todos</option>
          </select>
        </label>
        <label>
          <span>Origem</span>
          <select value={filters.source} onChange={(event) => setFilters((current) => ({ ...current, source: event.target.value }))}>
            <option value="">Todas</option>
            <option value="STOCK_TRANSFER">Movimentacao de Estoque</option>
            <option value="TEAM_OPERATION">Operacoes de Equipe</option>
          </select>
        </label>
        <label>
          <span>Solicitado de</span>
          <input type="date" value={filters.startDate} onChange={(event) => setFilters((current) => ({ ...current, startDate: event.target.value }))} />
        </label>
        <label>
          <span>Solicitado ate</span>
          <input type="date" value={filters.endDate} onChange={(event) => setFilters((current) => ({ ...current, endDate: event.target.value }))} />
        </label>
        <div className={styles.filterActions}>
          <button type="button" onClick={applyFilters} disabled={isLoading}>Filtrar</button>
          <button type="button" onClick={clearFilters} disabled={isLoading}>Limpar</button>
        </div>
      </section>

      <section className={styles.layout}>
        <div className={styles.listPanel}>
          <div className={styles.panelHeader}>
            <h2>Fila de estornos</h2>
            <span>{total} pedido(s)</span>
          </div>
          <div className={styles.tableWrapper}>
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Origem</th>
                  <th>Operacao</th>
                  <th>Projeto</th>
                  <th>Equipe</th>
                  <th>Material</th>
                  <th>Itens</th>
                  <th>Solicitado em</th>
                  <th>Acoes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className={selected?.id === row.id ? styles.selectedRow : undefined}>
                    <td><span className={`${styles.status} ${styles[`status${row.status}`] ?? ""}`}>{statusLabel(row.status)}</span></td>
                    <td>{row.sourceLabel}</td>
                    <td>{operationLabel(row.operationCode)}</td>
                    <td>{row.projectCode}</td>
                    <td>{row.teamName ?? "-"}</td>
                    <td>{row.materialCode}</td>
                    <td>{row.itemCount}</td>
                    <td>{formatDateTime(row.requestedAt)}</td>
                    <td>
                      <button type="button" onClick={() => void openRequest(row)} disabled={isActing}>
                        Abrir
                      </button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className={styles.emptyState}>
                      {isLoading ? "Carregando pedidos..." : "Nenhum pedido encontrado para os filtros selecionados."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className={styles.pagination}>
            <button type="button" disabled={page <= 1 || isLoading} onClick={() => void loadList(page - 1)}>Anterior</button>
            <span>Pagina {page} de {totalPages}</span>
            <button type="button" disabled={page >= totalPages || isLoading} onClick={() => void loadList(page + 1)}>Proxima</button>
          </div>
        </div>

        <aside className={styles.detailPanel}>
          {selected ? (
            <>
              <div className={styles.panelHeader}>
                <h2>Analise</h2>
                <span>{statusLabel(selected.status)}</span>
              </div>
              <div className={styles.detailGrid}>
                <div><strong>Origem:</strong> {selected.sourceLabel}</div>
                <div><strong>Tipo:</strong> {selected.modeLabel}</div>
                <div><strong>Operacao:</strong> {operationLabel(selected.operationCode)}</div>
                <div><strong>Solicitante:</strong> {selected.requestedByName}</div>
                <div><strong>Solicitado em:</strong> {formatDateTime(selected.requestedAt)}</div>
                <div><strong>Data do estorno:</strong> {formatDate(selected.reversalDate)}</div>
                <div><strong>Projeto:</strong> {selected.projectCode}</div>
                <div><strong>Equipe:</strong> {selected.teamName ?? "-"}</div>
                <div><strong>De:</strong> {selected.fromStockCenterName}</div>
                <div><strong>Para:</strong> {selected.toStockCenterName}</div>
                <div><strong>Motivo:</strong> {selected.reversalReasonLabel}</div>
                <div><strong>Observacao:</strong> {selected.reversalReasonNotes ?? "-"}</div>
                <div><strong>Atendente:</strong> {selected.claimedByName ?? "-"}</div>
                <div><strong>Claim ate:</strong> {formatDateTime(selected.claimExpiresAt)}</div>
              </div>

              <div className={styles.itemsBlock}>
                <h3>Itens solicitados</h3>
                <div className={styles.itemsTableWrapper}>
                  <table>
                    <thead>
                      <tr>
                        <th>Material</th>
                        <th>Descricao</th>
                        <th>Qtd</th>
                        <th>Serial</th>
                        <th>LP</th>
                        <th>Data</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.items.map((item) => (
                        <tr key={item.id}>
                          <td>{item.materialCode}</td>
                          <td>{item.description}</td>
                          <td>{item.quantity.toLocaleString("pt-BR")} {item.unit}</td>
                          <td>{item.serialNumber ?? "-"}</td>
                          <td>{item.lotCode ?? "-"}</td>
                          <td>{formatDate(item.operationDate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <label className={styles.notesField}>
                <span>Observacao da decisao</span>
                <textarea value={decisionNotes} onChange={(event) => setDecisionNotes(event.target.value)} rows={4} />
              </label>

              <div className={styles.actionBar}>
                <button type="button" onClick={() => void runAction("CLAIM", selected.id)} disabled={isActing || selected.status === "EXECUTADO" || selected.status === "RECUSADO"}>
                  Assumir
                </button>
                <button type="button" className={styles.primaryAction} onClick={() => void runAction("APPROVE", selected.id)} disabled={isActing || selected.status === "EXECUTADO" || selected.status === "RECUSADO"}>
                  Aprovar e executar
                </button>
                <button type="button" className={styles.dangerAction} onClick={() => void runAction("REJECT", selected.id)} disabled={isActing || selected.status === "EXECUTADO" || selected.status === "RECUSADO"}>
                  Recusar
                </button>
              </div>
            </>
          ) : (
            <div className={styles.emptyDetail}>Selecione um pedido para analisar.</div>
          )}
        </aside>
      </section>
    </main>
  );
}
