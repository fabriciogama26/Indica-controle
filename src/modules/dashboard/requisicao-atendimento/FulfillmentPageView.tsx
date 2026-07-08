"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { CsvExportButton } from "@/components/ui/CsvExportButton";
import { useAuth } from "@/hooks/useAuth";
import { buildCsvContent, downloadCsvFile } from "@/lib/utils/csv";
import styles from "./FulfillmentPageView.module.css";
import type {
  AdjustmentReason,
  DecisionType,
  FulfillmentDetail,
  FulfillmentDetailItem,
  FulfillmentListRow,
  ItemDecision,
  SerialOption,
} from "./types";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendente",
  EM_ATENDIMENTO: "Em atendimento",
  ENCERRADO: "Encerrado",
  CANCELADO: "Cancelado",
};

const EMPTY_DECISION: ItemDecision = { decision: null, quantity: "", reasonCode: "", serialNumber: "", lotCode: "", notes: "" };

function isSerialized(item: FulfillmentDetailItem) {
  return item.serialTrackingType !== "NONE";
}

function isTrafo(item: FulfillmentDetailItem) {
  return item.serialTrackingType === "TRAFO";
}

export function FulfillmentPageView() {
  const { session } = useAuth();
  const token = session?.accessToken;

  const [list, setList] = useState<FulfillmentListRow[]>([]);
  const [reasons, setReasons] = useState<AdjustmentReason[]>([]);
  const [statusFilter, setStatusFilter] = useState("OPEN");
  const [detail, setDetail] = useState<FulfillmentDetail | null>(null);
  const [decisions, setDecisions] = useState<Record<string, ItemDecision>>({});
  const [serialOptions, setSerialOptions] = useState<Record<string, SerialOption[]>>({});
  const [feedback, setFeedback] = useState<{ type: "ok" | "error"; message: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  const authHeaders = useMemo(
    () => (token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : undefined),
    [token],
  );

  const loadReasons = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch("/api/stock-requisitions/meta", { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) return;
      const data = (await response.json()) as { adjustmentReasons?: AdjustmentReason[] };
      setReasons(data.adjustmentReasons ?? []);
    } catch {
      /* silencioso */
    }
  }, [token]);

  const loadList = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const query = statusFilter === "OPEN" ? "" : `&status=${statusFilter}`;
      const response = await fetch(`/api/stock-requisitions?page=atendimento&pageSize=50${query}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        setList([]);
        return;
      }
      const data = (await response.json()) as { items: FulfillmentListRow[] };
      const rows = data.items ?? [];
      setList(statusFilter === "OPEN" ? rows.filter((row) => row.status === "PENDING" || row.status === "EM_ATENDIMENTO") : rows);
    } catch {
      setList([]);
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, token]);

  useEffect(() => {
    void loadReasons();
  }, [loadReasons]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const loadDetail = useCallback(
    async (requestId: string) => {
      if (!token) return;
      const response = await fetch(`/api/stock-requisitions?id=${requestId}&page=atendimento`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        setFeedback({ type: "error", message: "Falha ao carregar o pedido." });
        return;
      }
      const data = (await response.json()) as FulfillmentDetail;
      setDetail(data);
      const seed: Record<string, ItemDecision> = {};
      for (const item of data.items) {
        seed[item.id] = { ...EMPTY_DECISION };
      }
      setDecisions(seed);
      setSerialOptions({});
    },
    [token],
  );

  const handleAtender = useCallback(
    async (requestId: string) => {
      if (!authHeaders) return;
      setFeedback(null);
      setIsBusy(true);
      try {
        const response = await fetch("/api/stock-requisitions/claim", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ requestId }),
        });
        const data = (await response.json().catch(() => ({}))) as { message?: string };
        if (!response.ok) {
          setFeedback({ type: "error", message: data.message ?? "Falha ao assumir o pedido." });
          await loadList();
          return;
        }
        await loadDetail(requestId);
        await loadList();
      } finally {
        setIsBusy(false);
      }
    },
    [authHeaders, loadDetail, loadList],
  );

  const handleRelease = useCallback(async () => {
    if (!authHeaders || !detail) return;
    setIsBusy(true);
    try {
      await fetch(`/api/stock-requisitions/claim?requestId=${detail.request.id}`, { method: "DELETE", headers: authHeaders });
      setDetail(null);
      await loadList();
    } finally {
      setIsBusy(false);
    }
  }, [authHeaders, detail, loadList]);

  const handleCancel = useCallback(async () => {
    if (!authHeaders || !detail) return;
    setIsBusy(true);
    try {
      const response = await fetch("/api/stock-requisitions/cancel", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ requestId: detail.request.id, page: "atendimento" }),
      });
      const data = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        setFeedback({ type: "error", message: data.message ?? "Falha ao cancelar." });
        return;
      }
      setDetail(null);
      await loadList();
    } finally {
      setIsBusy(false);
    }
  }, [authHeaders, detail, loadList]);

  const setDecision = useCallback((itemId: string, patch: Partial<ItemDecision>) => {
    setDecisions((current) => ({ ...current, [itemId]: { ...(current[itemId] ?? EMPTY_DECISION), ...patch } }));
  }, []);

  const loadSerialOptions = useCallback(
    async (item: FulfillmentDetailItem) => {
      if (!token || !detail) return;
      const params = new URLSearchParams({ stockCenterId: detail.request.stockCenterId, materialId: item.materialId });
      const response = await fetch(`/api/stock-requisitions/serial-options?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return;
      const data = (await response.json()) as { items: SerialOption[] };
      setSerialOptions((current) => ({ ...current, [item.id]: data.items ?? [] }));
    },
    [detail, token],
  );

  const handleExportItems = useCallback(() => {
    if (!detail) return;
    const headers = ["Material", "Descricao", "Solicitado", "Saldo atual", "Serial", "LP"];
    const rows = detail.items.map((item) => [
      item.materialCode,
      item.description,
      item.quantityRequested,
      item.currentBalance,
      item.serialNumber ?? "",
      item.lotCode ?? "",
    ]);
    downloadCsvFile(
      buildCsvContent(headers, rows),
      `requisicao_${detail.request.projectCode}_${detail.request.requestDate}.csv`,
    );
  }, [detail]);

  const handleAcceptAll = useCallback(() => {
    if (!detail) return;
    setDecisions((current) => {
      const next = { ...current };
      for (const item of detail.items) {
        if (!isSerialized(item) && item.currentBalance >= item.quantityRequested) {
          next[item.id] = { ...EMPTY_DECISION, decision: "ACCEPT" };
        }
      }
      return next;
    });
  }, [detail]);

  const allDecided = useMemo(() => {
    if (!detail) return false;
    return detail.items.every((item) => {
      const decision = decisions[item.id];
      if (!decision?.decision) return false;
      if (decision.decision === "REDUCE") {
        const quantity = Number(decision.quantity.replace(",", "."));
        if (!Number.isFinite(quantity) || quantity <= 0 || quantity >= item.quantityRequested) return false;
        if (!decision.reasonCode) return false;
      }
      if (decision.decision === "REJECT" && !decision.reasonCode) return false;
      if (decision.decision === "ACCEPT" && isSerialized(item)) {
        if (!decision.serialNumber) return false;
        if (isTrafo(item) && !decision.lotCode) return false;
      }
      const reason = reasons.find((entry) => entry.code === decision.reasonCode);
      if (reason?.requiresNotes && !decision.notes.trim()) return false;
      return true;
    });
  }, [decisions, detail, reasons]);

  const handleConfirm = useCallback(async () => {
    if (!authHeaders || !detail || !allDecided) return;
    setFeedback(null);
    setIsBusy(true);
    try {
      const payloadDecisions = detail.items.map((item) => {
        const decision = decisions[item.id];
        return {
          itemId: item.id,
          decision: decision.decision as DecisionType,
          quantity: decision.decision === "REDUCE" ? Number(decision.quantity.replace(",", ".")) : undefined,
          reasonCode: decision.decision === "ACCEPT" ? null : decision.reasonCode || null,
          serialNumber: decision.decision === "ACCEPT" && isSerialized(item) ? decision.serialNumber : null,
          lotCode: decision.decision === "ACCEPT" && isTrafo(item) ? decision.lotCode : null,
          notes: decision.notes.trim() || null,
        };
      });
      const response = await fetch("/api/stock-requisitions/fulfill", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ requestId: detail.request.id, decisions: payloadDecisions }),
      });
      const data = (await response.json().catch(() => ({}))) as { message?: string; resultado?: string };
      if (!response.ok) {
        setFeedback({ type: "error", message: data.message ?? "Falha ao atender a requisicao." });
        return;
      }
      setFeedback({ type: "ok", message: `Atendimento concluido (${data.resultado ?? ""}).` });
      setDetail(null);
      await loadList();
    } finally {
      setIsBusy(false);
    }
  }, [allDecided, authHeaders, decisions, detail, loadList]);

  return (
    <div className={styles.page}>
      <section className={styles.card}>
        <div className={styles.listHeader}>
          <h2 className={styles.cardTitle}>Fila de requisicoes</h2>
          <label className={styles.inlineField}>
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="OPEN">Em aberto</option>
              <option value="PENDING">Pendente</option>
              <option value="EM_ATENDIMENTO">Em atendimento</option>
              <option value="ENCERRADO">Encerrado</option>
              <option value="CANCELADO">Cancelado</option>
            </select>
          </label>
        </div>

        {feedback ? <p className={feedback.type === "ok" ? styles.feedbackOk : styles.feedbackError}>{feedback.message}</p> : null}

        {isLoading ? (
          <p className={styles.empty}>Carregando...</p>
        ) : list.length === 0 ? (
          <p className={styles.empty}>Nenhum pedido na fila.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Data</th>
                <th>Projeto</th>
                <th>Equipe</th>
                <th>Centro</th>
                <th>Solicitante</th>
                <th>Atendente</th>
                <th>Itens</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((row) => (
                <tr key={row.id} className={detail?.request.id === row.id ? styles.activeRow : undefined}>
                  <td>{row.requestDate}</td>
                  <td>{row.projectCode}</td>
                  <td>{row.teamName}</td>
                  <td>{row.stockCenterName}</td>
                  <td>{row.requestedByName ?? "-"}</td>
                  <td>{row.claimedByName ?? "-"}</td>
                  <td>{row.itemCount}</td>
                  <td>
                    <span className={styles.statusChip}>{STATUS_LABEL[row.status] ?? row.status}</span>
                    {row.claimedByName && row.status === "EM_ATENDIMENTO" ? <span className={styles.claimHint}> · {row.claimedByName}</span> : null}
                  </td>
                  <td>
                    <button type="button" className={styles.secondaryButton} disabled={isBusy} onClick={() => handleAtender(row.id)}>
                      Atender
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {detail ? (
        <section className={styles.card}>
          <div className={styles.listHeader}>
            <div>
              <h2 className={styles.cardTitle}>
                Pedido - {detail.request.projectCode} / {detail.request.teamName}
              </h2>
              <p className={styles.subtle}>
                Centro: {detail.request.stockCenterName} · Data: {detail.request.requestDate} · Solicitante: {detail.request.requestedByName ?? "-"}
              </p>
            </div>
            <div className={styles.detailActions}>
              <CsvExportButton
                onClick={handleExportItems}
                className={styles.secondaryButton}
                showProgressModal={false}
                idleLabel="Exportar Excel (CSV)"
              />
              <button type="button" className={styles.primaryButton} onClick={handleAcceptAll} disabled={isBusy}>
                Aceitar tudo
              </button>
            </div>
          </div>

          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Descricao</th>
                  <th>Solicitado</th>
                  <th>Saldo atual</th>
                  <th>Decisao</th>
                  <th>Detalhe</th>
                </tr>
              </thead>
              <tbody>
                {detail.items.map((item) => {
                  const decision = decisions[item.id] ?? EMPTY_DECISION;
                  const serialized = isSerialized(item);
                  const options = serialOptions[item.id] ?? [];
                  return (
                    <tr key={item.id}>
                      <td>
                        {item.materialCode}
                        {serialized ? <span className={styles.tag}>{item.serialTrackingType}</span> : null}
                      </td>
                      <td>{item.description}</td>
                      <td>{item.quantityRequested}</td>
                      <td className={item.currentBalance < item.quantityRequested ? styles.lowBalance : undefined}>{item.currentBalance}</td>
                      <td>
                        <div className={styles.decisionGroup}>
                          <label>
                            <input
                              type="radio"
                              name={`decision-${item.id}`}
                              checked={decision.decision === "ACCEPT"}
                              onChange={() => {
                                setDecision(item.id, { decision: "ACCEPT", quantity: "", reasonCode: "" });
                                if (serialized && options.length === 0) void loadSerialOptions(item);
                              }}
                            />
                            Aceitar
                          </label>
                          <label>
                            <input
                              type="radio"
                              name={`decision-${item.id}`}
                              checked={decision.decision === "REDUCE"}
                              disabled={serialized}
                              onChange={() => setDecision(item.id, { decision: "REDUCE" })}
                            />
                            Reduzir
                          </label>
                          <label>
                            <input
                              type="radio"
                              name={`decision-${item.id}`}
                              checked={decision.decision === "REJECT"}
                              onChange={() => setDecision(item.id, { decision: "REJECT", quantity: "" })}
                            />
                            Recusar
                          </label>
                        </div>
                      </td>
                      <td>
                        {decision.decision === "REDUCE" ? (
                          <input
                            className={styles.smallInput}
                            value={decision.quantity}
                            placeholder={`< ${item.quantityRequested}`}
                            inputMode="decimal"
                            onChange={(event) => setDecision(item.id, { quantity: event.target.value })}
                          />
                        ) : null}

                        {decision.decision === "ACCEPT" && serialized ? (
                          <div className={styles.serialBlock}>
                            <select
                              value={decision.serialNumber}
                              onChange={(event) => {
                                const option = options.find((entry) => entry.serialNumber === event.target.value);
                                setDecision(item.id, { serialNumber: event.target.value, lotCode: option?.lotCode ?? "" });
                              }}
                            >
                              <option value="">Selecione a unidade</option>
                              {options.map((option) => (
                                <option key={option.id} value={option.serialNumber}>
                                  {option.serialNumber}{isTrafo(item) ? ` / ${option.lotCode}` : ""}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : null}

                        {decision.decision === "REDUCE" || decision.decision === "REJECT" ? (
                          <select
                            className={styles.reasonSelect}
                            value={decision.reasonCode}
                            onChange={(event) => setDecision(item.id, { reasonCode: event.target.value })}
                          >
                            <option value="">Motivo</option>
                            {reasons.map((reason) => (
                              <option key={reason.code} value={reason.code}>{reason.label}</option>
                            ))}
                          </select>
                        ) : null}

                        {(() => {
                          const reason = reasons.find((entry) => entry.code === decision.reasonCode);
                          return reason?.requiresNotes ? (
                            <input
                              className={styles.smallInput}
                              placeholder="Observacao"
                              value={decision.notes}
                              onChange={(event) => setDecision(item.id, { notes: event.target.value })}
                            />
                          ) : null;
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className={styles.detailActions}>
            <button type="button" className={styles.primaryButton} onClick={handleConfirm} disabled={!allDecided || isBusy} aria-busy={isBusy}>
              Confirmar atendimento
            </button>
            <button type="button" className={styles.secondaryButton} onClick={handleRelease} disabled={isBusy}>
              Liberar
            </button>
            <button type="button" className={styles.dangerButton} onClick={handleCancel} disabled={isBusy}>
              Cancelar pedido
            </button>
          </div>
          {!allDecided ? <p className={styles.subtle}>Defina uma decisao valida para todos os itens antes de confirmar.</p> : null}
        </section>
      ) : null}
    </div>
  );
}
