"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import styles from "./SolicitationPageView.module.css";
import type { RequisitionDetail, RequisitionFormItem, RequisitionListResponse, RequisitionListRow, RequisitionMeta } from "./types";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendente",
  EM_ATENDIMENTO: "Em atendimento",
  ENCERRADO: "Encerrado",
  CANCELADO: "Cancelado",
};

const RESULT_LABEL: Record<string, string> = {
  TOTAL: "Atendida total",
  PARCIAL: "Atendida parcial",
  RECUSADO: "Recusada",
};

const ITEM_STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendente",
  ACCEPTED: "Aceito",
  REDUCED: "Reduzido",
  REJECTED: "Recusado",
};

const EMPTY_META: RequisitionMeta = { stockCenters: [], teams: [], projects: [], materials: [], adjustmentReasons: [] };

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function SolicitationPageView() {
  const { session } = useAuth();
  const token = session?.accessToken;

  const [meta, setMeta] = useState<RequisitionMeta>(EMPTY_META);
  const [stockCenterId, setStockCenterId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [projectQuery, setProjectQuery] = useState("");
  const [requestDate, setRequestDate] = useState(today());
  const [notes, setNotes] = useState("");

  const [materialCode, setMaterialCode] = useState("");
  const [quantity, setQuantity] = useState("");
  const [items, setItems] = useState<RequisitionFormItem[]>([]);
  const [centerMaterials, setCenterMaterials] = useState<RequisitionMeta["materials"]>([]);

  const [list, setList] = useState<RequisitionListRow[]>([]);
  const [feedback, setFeedback] = useState<{ type: "ok" | "error"; message: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [detailModal, setDetailModal] = useState<RequisitionDetail | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);

  const authHeaders = useMemo(
    () => (token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : undefined),
    [token],
  );

  const loadMeta = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch("/api/stock-requisitions/meta", { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) return;
      const data = (await response.json()) as RequisitionMeta;
      setMeta({ ...EMPTY_META, ...data });
    } catch {
      /* silencioso: meta e carregada em paralelo com a lista */
    }
  }, [token]);

  const loadList = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const response = await fetch("/api/stock-requisitions?scope=mine&page=solicitacao&pageSize=20", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        setList([]);
        return;
      }
      const data = (await response.json()) as RequisitionListResponse;
      setList(data.items ?? []);
    } catch {
      setList([]);
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void Promise.all([loadMeta(), loadList()]);
  }, [loadMeta, loadList]);

  // Opcao B: o picker de material lista apenas os codigos que o centro selecionado carrega.
  useEffect(() => {
    if (!token || !stockCenterId) {
      setCenterMaterials([]);
      return;
    }
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/stock-requisitions/materials?stockCenterId=${stockCenterId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          if (active) setCenterMaterials([]);
          return;
        }
        const data = (await response.json()) as { materials?: RequisitionMeta["materials"] };
        if (active) setCenterMaterials(data.materials ?? []);
      } catch {
        if (active) setCenterMaterials([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [stockCenterId, token]);

  const projectByCode = useMemo(() => {
    const map = new Map(
      meta.projects
        .filter((project) => Boolean(project.projectCode))
        .map((project) => [project.projectCode.toUpperCase(), project]),
    );
    return map;
  }, [meta.projects]);

  const materialByCode = useMemo(() => {
    const map = new Map(
      centerMaterials
        .filter((material) => Boolean(material.materialCode))
        .map((material) => [material.materialCode.toUpperCase(), material]),
    );
    return map;
  }, [centerMaterials]);

  const addItem = useCallback(() => {
    setFeedback(null);
    const material = materialByCode.get(materialCode.trim().toUpperCase());
    if (!material) {
      setFeedback({ type: "error", message: "Selecione um material valido da lista." });
      return;
    }
    const parsedQuantity = Number(quantity.replace(",", "."));
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      setFeedback({ type: "error", message: "Informe uma quantidade maior que zero." });
      return;
    }
    if (items.some((item) => item.materialId === material.id)) {
      setFeedback({ type: "error", message: "Material ja adicionado nesta solicitacao." });
      return;
    }
    setItems((current) => [
      ...current,
      { materialId: material.id, materialCode: material.materialCode, description: material.description, quantity: String(parsedQuantity) },
    ]);
    setMaterialCode("");
    setQuantity("");
  }, [items, materialByCode, materialCode, quantity]);

  const removeItem = useCallback((materialId: string) => {
    setItems((current) => current.filter((item) => item.materialId !== materialId));
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setFeedback(null);
      if (!authHeaders) return;

      const project = projectByCode.get(projectQuery.trim().toUpperCase());
      if (!stockCenterId || !teamId || !project || !requestDate) {
        setFeedback({ type: "error", message: "Preencha centro, equipe, projeto e data." });
        return;
      }
      if (items.length === 0) {
        setFeedback({ type: "error", message: "Adicione ao menos um material." });
        return;
      }

      setIsSaving(true);
      try {
        const response = await fetch("/api/stock-requisitions", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            stockCenterId,
            teamId,
            projectId: project.id,
            requestDate,
            notes: notes.trim() || null,
            items: items.map((item) => ({ materialId: item.materialId, quantity: Number(item.quantity) })),
          }),
        });
        const data = (await response.json().catch(() => ({}))) as { message?: string };
        if (!response.ok) {
          setFeedback({ type: "error", message: data.message ?? "Falha ao registrar a solicitacao." });
          return;
        }
        setFeedback({ type: "ok", message: "Solicitacao registrada com sucesso." });
        setItems([]);
        setNotes("");
        await loadList();
      } catch {
        setFeedback({ type: "error", message: "Falha ao registrar a solicitacao." });
      } finally {
        setIsSaving(false);
      }
    },
    [authHeaders, items, loadList, notes, projectByCode, projectQuery, requestDate, stockCenterId, teamId],
  );

  const handleCancel = useCallback(
    async (requestId: string) => {
      if (!authHeaders) return;
      setFeedback(null);
      try {
        const response = await fetch("/api/stock-requisitions/cancel", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ requestId, page: "solicitacao" }),
        });
        const data = (await response.json().catch(() => ({}))) as { message?: string };
        if (!response.ok) {
          setFeedback({ type: "error", message: data.message ?? "Falha ao cancelar o pedido." });
          return;
        }
        await loadList();
      } catch {
        setFeedback({ type: "error", message: "Falha ao cancelar o pedido." });
      }
    },
    [authHeaders, loadList],
  );

  const fetchDetail = useCallback(
    async (requestId: string) => {
      if (!token) return null;
      const response = await fetch(`/api/stock-requisitions?id=${requestId}&page=solicitacao`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return null;
      return (await response.json()) as RequisitionDetail;
    },
    [token],
  );

  const handleOpenDetail = useCallback(
    async (requestId: string) => {
      setIsDetailLoading(true);
      try {
        const detail = await fetchDetail(requestId);
        if (detail) setDetailModal(detail);
      } finally {
        setIsDetailLoading(false);
      }
    },
    [fetchDetail],
  );

  const handleDuplicate = useCallback(
    async (requestId: string) => {
      setFeedback(null);
      const detail = await fetchDetail(requestId);
      if (!detail) {
        setFeedback({ type: "error", message: "Falha ao carregar o pedido para duplicar." });
        return;
      }
      setStockCenterId(detail.request.stockCenterId);
      setTeamId(detail.request.teamId);
      setProjectQuery(detail.request.projectCode);
      setRequestDate(today());
      setItems(
        detail.items.map((item) => ({
          materialId: item.materialId,
          materialCode: item.materialCode,
          description: item.description,
          quantity: String(item.quantityRequested),
        })),
      );
      setMaterialCode("");
      setDetailModal(null);
      setFeedback({ type: "ok", message: "Itens copiados. Revise e registre a nova solicitacao." });
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [fetchDetail],
  );

  return (
    <div className={styles.page}>
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Nova solicitacao</h2>
        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.grid}>
            <label className={styles.field}>
              <span>Centro de estoque</span>
              <select
                value={stockCenterId}
                onChange={(event) => {
                  setStockCenterId(event.target.value);
                  setMaterialCode("");
                }}
              >
                <option value="">Selecione</option>
                {meta.stockCenters.map((center) => (
                  <option key={center.id} value={center.id}>{center.name}</option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>Equipe</span>
              <select value={teamId} onChange={(event) => setTeamId(event.target.value)}>
                <option value="">Selecione</option>
                {meta.teams.map((team) => (
                  <option key={team.id} value={team.id} disabled={!team.hasStockCenter}>
                    {team.name}{team.foremanName ? ` - ${team.foremanName}` : ""}{team.hasStockCenter ? "" : " (sem centro proprio)"}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>Projeto</span>
              <input list="requisition-projects" value={projectQuery} onChange={(event) => setProjectQuery(event.target.value)} placeholder="Codigo do projeto" />
              <datalist id="requisition-projects">
                {meta.projects.map((project) => (
                  <option key={project.id} value={project.projectCode} />
                ))}
              </datalist>
            </label>
            <label className={styles.field}>
              <span>Data</span>
              <input type="date" value={requestDate} max={today()} onChange={(event) => setRequestDate(event.target.value)} />
            </label>
          </div>

          <div className={styles.subCard}>
            <h3 className={styles.subTitle}>Materiais da solicitacao</h3>
            <div className={styles.itemInputs}>
              <label className={styles.field}>
                <span>Material (codigo)</span>
                <input
                  list="requisition-materials"
                  value={materialCode}
                  onChange={(event) => setMaterialCode(event.target.value)}
                  placeholder={stockCenterId ? "Codigo" : "Selecione o centro primeiro"}
                  disabled={!stockCenterId}
                />
                <datalist id="requisition-materials">
                  {centerMaterials.map((material) => (
                    <option key={material.id} value={material.materialCode}>{material.description}</option>
                  ))}
                </datalist>
              </label>
              <label className={styles.field}>
                <span>Quantidade</span>
                <input value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="0" inputMode="decimal" />
              </label>
              <button type="button" className={styles.secondaryButton} onClick={addItem}>Adicionar material</button>
            </div>

            {items.length > 0 ? (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Codigo</th>
                    <th>Descricao</th>
                    <th>Quantidade</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.materialId}>
                      <td>{item.materialCode}</td>
                      <td>{item.description}</td>
                      <td>{item.quantity}</td>
                      <td>
                        <button type="button" className={styles.linkButton} onClick={() => removeItem(item.materialId)}>Remover</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className={styles.empty}>Nenhum material adicionado.</p>
            )}
          </div>

          <label className={styles.field}>
            <span>Observacao (opcional)</span>
            <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Observacao do pedido" />
          </label>

          {feedback ? <p className={feedback.type === "ok" ? styles.feedbackOk : styles.feedbackError}>{feedback.message}</p> : null}

          <div className={styles.actions}>
            <button type="submit" className={styles.primaryButton} disabled={isSaving} aria-busy={isSaving}>
              {isSaving ? "Salvando..." : "Registrar solicitacao"}
            </button>
          </div>
        </form>
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Meus pedidos</h2>
        {isLoading ? (
          <p className={styles.empty}>Carregando...</p>
        ) : list.length === 0 ? (
          <p className={styles.empty}>Nenhum pedido registrado.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Data</th>
                <th>Centro</th>
                <th>Equipe</th>
                <th>Projeto</th>
                <th>Itens</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((row) => (
                <tr key={row.id}>
                  <td>{row.requestDate}</td>
                  <td>{row.stockCenterName}</td>
                  <td>{row.teamName}</td>
                  <td>{row.projectCode}</td>
                  <td>{row.itemCount}</td>
                  <td>
                    <span className={styles.statusChip}>
                      {STATUS_LABEL[row.status] ?? row.status}
                      {row.resultado ? ` - ${RESULT_LABEL[row.resultado] ?? row.resultado}` : ""}
                    </span>
                  </td>
                  <td className={styles.rowActions}>
                    <button type="button" className={styles.linkAction} onClick={() => handleOpenDetail(row.id)} disabled={isDetailLoading}>
                      Detalhes
                    </button>
                    {row.status === "PENDING" ? (
                      <button type="button" className={styles.linkButton} onClick={() => handleCancel(row.id)}>Cancelar</button>
                    ) : null}
                    {row.status === "ENCERRADO" || row.status === "CANCELADO" ? (
                      <button type="button" className={styles.linkAction} onClick={() => handleDuplicate(row.id)}>Duplicar</button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {detailModal ? (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true" onClick={() => setDetailModal(null)}>
          <div className={styles.modal} onClick={(event) => event.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <h3 className={styles.cardTitle}>
                  Pedido - {detailModal.request.projectCode} / {detailModal.request.teamName}
                </h3>
                <p className={styles.empty}>
                  Centro: {detailModal.request.stockCenterName} · Data: {detailModal.request.requestDate} ·{" "}
                  {STATUS_LABEL[detailModal.request.status] ?? detailModal.request.status}
                  {detailModal.request.resultado ? ` - ${RESULT_LABEL[detailModal.request.resultado] ?? detailModal.request.resultado}` : ""}
                </p>
              </div>
              <button type="button" className={styles.linkButton} onClick={() => setDetailModal(null)}>Fechar</button>
            </div>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Descricao</th>
                  <th>Solicitado</th>
                  <th>Atendido</th>
                  <th>Situacao</th>
                </tr>
              </thead>
              <tbody>
                {detailModal.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.materialCode}</td>
                    <td>{item.description}</td>
                    <td>{item.quantityRequested}</td>
                    <td>{item.quantityFulfilled ?? "-"}</td>
                    <td>
                      {ITEM_STATUS_LABEL[item.itemStatus] ?? item.itemStatus}
                      {item.unfulfilledReasonCode ? ` (${item.unfulfilledReasonCode})` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {detailModal.request.status === "ENCERRADO" || detailModal.request.status === "CANCELADO" ? (
              <div className={styles.actions}>
                <button type="button" className={styles.secondaryButton} onClick={() => handleDuplicate(detailModal.request.id)}>
                  Duplicar em nova solicitacao
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
