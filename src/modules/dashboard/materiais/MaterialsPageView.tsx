"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import styles from "./MaterialsPageView.module.css";

type MaterialItem = {
  id: string;
  codigo: string;
  descricao: string;
  umb: string | null;
  tipo: string;
  unitPrice: number;
  isActive: boolean;
  cancellationReason: string | null;
  canceledAt: string | null;
  canceledByName: string | null;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

type MaterialHistoryEntry = {
  id: string;
  changeType: "UPDATE" | "CANCEL" | "ACTIVATE";
  createdAt: string;
  createdByName: string;
  changes: Record<string, { from: string | null; to: string | null }>;
};

type FormState = {
  codigo: string;
  descricao: string;
  tipo: string;
  umb: string;
  unitPrice: string;
};

type FilterState = {
  codigo: string;
  descricao: string;
  tipo: string;
  status: "" | "ativo" | "inativo";
};

type MaterialsResponse = {
  materials?: MaterialItem[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

type MaterialHistoryResponse = {
  history?: MaterialHistoryEntry[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

const PAGE_SIZE = 20;
const HISTORY_PAGE_SIZE = 5;
const INITIAL_FORM: FormState = {
  codigo: "",
  descricao: "",
  tipo: "",
  umb: "",
  unitPrice: "0",
};

const INITIAL_FILTERS: FilterState = {
  codigo: "",
  descricao: "",
  tipo: "",
  status: "",
};

const HISTORY_FIELD_LABELS: Record<string, string> = {
  codigo: "Codigo",
  descricao: "Descricao",
  tipo: "Tipo",
  umb: "UMB",
  unitPrice: "Preco",
  isActive: "Status",
  cancellationReason: "Motivo do cancelamento",
  canceledAt: "Data do cancelamento",
  activationReason: "Motivo da ativacao",
};

function normalizeText(value: string) {
  return String(value ?? "").trim();
}

function normalizeCode(value: string) {
  return normalizeText(value).toUpperCase();
}

function normalizeType(value: string) {
  return normalizeText(value).toUpperCase();
}

function buildQuery(filters: FilterState, page: number, pageSize = PAGE_SIZE) {
  const params = new URLSearchParams();
  if (filters.codigo.trim()) params.set("codigo", filters.codigo.trim());
  if (filters.descricao.trim()) params.set("descricao", filters.descricao.trim());
  if (filters.tipo.trim()) params.set("tipo", filters.tipo.trim());
  if (filters.status) params.set("status", filters.status);
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  return params.toString();
}

function formatDateTime(value: string) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("pt-BR");
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  }).format(value);
}

function formatHistoryValue(field: string, value: string | null) {
  if (!value) return "-";

  if (field === "unitPrice") {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? formatCurrency(numericValue) : value;
  }

  if (field === "isActive") {
    return value === "true" ? "Ativo" : "Inativo";
  }

  if (field === "canceledAt") {
    return formatDateTime(value);
  }

  return value;
}

function toFormState(material: MaterialItem): FormState {
  return {
    codigo: material.codigo,
    descricao: material.descricao,
    tipo: material.tipo,
    umb: material.umb ?? "",
    unitPrice: String(material.unitPrice ?? 0),
  };
}

export function MaterialsPageView() {
  const { session } = useAuth();
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [filterDraft, setFilterDraft] = useState<FilterState>(INITIAL_FILTERS);
  const [activeFilters, setActiveFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isChangingStatus, setIsChangingStatus] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [editingMaterialId, setEditingMaterialId] = useState<string | null>(null);
  const [historyMaterial, setHistoryMaterial] = useState<MaterialItem | null>(null);
  const [historyEntries, setHistoryEntries] = useState<MaterialHistoryEntry[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [statusMaterial, setStatusMaterial] = useState<MaterialItem | null>(null);
  const [statusReason, setStatusReason] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const historyTotalPages = Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE));
  const isEditing = Boolean(editingMaterialId);
  const statusAction = statusMaterial?.isActive ? "cancel" : "activate";
  const canSubmitStatusChange = Boolean(statusReason.trim()) && !isChangingStatus;

  const loadMaterials = useCallback(
    async (targetPage: number, filters: FilterState) => {
      if (!session?.accessToken) return;

      setIsLoadingList(true);
      try {
        const query = buildQuery(filters, targetPage);
        const response = await fetch(`/api/materials?${query}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as MaterialsResponse;
        if (!response.ok) {
          setMaterials([]);
          setTotal(0);
          setFeedback({ type: "error", message: data.message ?? "Falha ao carregar materiais." });
          return;
        }

        setMaterials(data.materials ?? []);
        setTotal(data.pagination?.total ?? 0);
      } catch {
        setMaterials([]);
        setTotal(0);
        setFeedback({ type: "error", message: "Falha ao carregar materiais." });
      } finally {
        setIsLoadingList(false);
      }
    },
    [session?.accessToken],
  );

  useEffect(() => {
    void loadMaterials(page, activeFilters);
  }, [activeFilters, loadMaterials, page]);

  function resetFormState() {
    setForm(INITIAL_FORM);
    setEditingMaterialId(null);
  }

  function updateFormField<Key extends keyof FormState>(field: Key, value: FormState[Key]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateFilterField<Key extends keyof FilterState>(field: Key, value: FilterState[Key]) {
    setFilterDraft((current) => ({ ...current, [field]: value }));
  }

  function applyFilters() {
    setPage(1);
    setActiveFilters(filterDraft);
    setFeedback(null);
  }

  function clearFilters() {
    setFilterDraft(INITIAL_FILTERS);
    setActiveFilters(INITIAL_FILTERS);
    setPage(1);
    setFeedback(null);
  }

  function handleEditMaterial(material: MaterialItem) {
    setEditingMaterialId(material.id);
    setForm(toFormState(material));
    setFeedback(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeHistoryModal() {
    setHistoryMaterial(null);
    setHistoryEntries([]);
    setHistoryPage(1);
    setHistoryTotal(0);
    setIsLoadingHistory(false);
  }

  function openStatusModal(material: MaterialItem) {
    setStatusMaterial(material);
    setStatusReason("");
  }

  function closeStatusModal() {
    setStatusMaterial(null);
    setStatusReason("");
    setIsChangingStatus(false);
  }

  async function loadMaterialHistory(material: MaterialItem, targetPage: number) {
    if (!session?.accessToken) {
      setFeedback({ type: "error", message: "Sessao invalida para carregar historico." });
      return;
    }

    setIsLoadingHistory(true);
    try {
      const params = new URLSearchParams();
      params.set("historyMaterialId", material.id);
      params.set("historyPage", String(targetPage));
      params.set("historyPageSize", String(HISTORY_PAGE_SIZE));

      const response = await fetch(`/api/materials?${params.toString()}`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
      });

      const data = (await response.json().catch(() => ({}))) as MaterialHistoryResponse;
      if (!response.ok) {
        setFeedback({ type: "error", message: data.message ?? "Falha ao carregar historico do material." });
        setHistoryEntries([]);
        setHistoryTotal(0);
        return;
      }

      setHistoryEntries(data.history ?? []);
      setHistoryPage(data.pagination?.page ?? targetPage);
      setHistoryTotal(data.pagination?.total ?? 0);
    } catch {
      setFeedback({ type: "error", message: "Falha ao carregar historico do material." });
      setHistoryEntries([]);
      setHistoryTotal(0);
    } finally {
      setIsLoadingHistory(false);
    }
  }

  async function openHistoryModal(material: MaterialItem) {
    setHistoryMaterial(material);
    setHistoryEntries([]);
    setHistoryPage(1);
    setHistoryTotal(0);
    await loadMaterialHistory(material, 1);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session?.accessToken) {
      setFeedback({
        type: "error",
        message: isEditing ? "Sessao invalida para editar material." : "Sessao invalida para registrar material.",
      });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);

    try {
      const payload = {
        ...(isEditing ? { id: editingMaterialId } : {}),
        codigo: normalizeCode(form.codigo),
        descricao: normalizeText(form.descricao),
        tipo: normalizeType(form.tipo),
        umb: normalizeText(form.umb) || null,
        unitPrice: form.unitPrice,
      };

      const response = await fetch("/api/materials", {
        method: isEditing ? "PUT" : "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json().catch(() => ({}))) as { message?: string };

      if (!response.ok) {
        setFeedback({
          type: "error",
          message:
            data.message ??
            (isEditing
              ? `Falha ao editar material ${normalizeCode(form.codigo)}.`
              : `Falha ao registrar material ${normalizeCode(form.codigo)}.`),
        });
        return;
      }

      setFeedback({
        type: "success",
        message:
          data.message ??
          (isEditing
            ? `Material ${normalizeCode(form.codigo)} atualizado com sucesso.`
            : `Material ${normalizeCode(form.codigo)} registrado com sucesso.`),
      });

      resetFormState();
      await loadMaterials(1, activeFilters);
      setPage(1);
    } catch {
      setFeedback({
        type: "error",
        message: isEditing
          ? `Falha ao editar material ${normalizeCode(form.codigo)}.`
          : `Falha ao registrar material ${normalizeCode(form.codigo)}.`,
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function confirmStatusChange() {
    if (!session?.accessToken || !statusMaterial || !statusReason.trim()) {
      return;
    }

    setIsChangingStatus(true);
    const actionLabel = statusAction === "cancel" ? "cancelar" : "ativar";

    try {
      const response = await fetch("/api/materials", {
        method: "PATCH",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          id: statusMaterial.id,
          reason: statusReason.trim(),
          action: statusAction,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        setFeedback({
          type: "error",
          message: data.message ?? `Falha ao ${actionLabel} material ${statusMaterial.codigo}.`,
        });
        return;
      }

      setFeedback({
        type: "success",
        message:
          data.message ??
          (statusAction === "cancel"
            ? `Material ${statusMaterial.codigo} cancelado com sucesso.`
            : `Material ${statusMaterial.codigo} ativado com sucesso.`),
      });

      if (editingMaterialId === statusMaterial.id) {
        resetFormState();
      }

      closeStatusModal();
      await loadMaterials(page, activeFilters);
    } catch {
      setFeedback({
        type: "error",
        message: `Falha ao ${actionLabel} material ${statusMaterial.codigo}.`,
      });
    } finally {
      setIsChangingStatus(false);
    }
  }

  return (
    <section className={styles.wrapper}>
      {feedback ? (
        <div className={feedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError}>{feedback.message}</div>
      ) : null}

      <article className={`${styles.card} ${isEditing ? styles.editingCard : ""}`}>
        <h3 className={styles.cardTitle}>{isEditing ? "Editar Material" : "Cadastro de Material"}</h3>

        <form className={styles.formGrid} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>
              Codigo <span className="requiredMark">*</span>
            </span>
            <input
              type="text"
              value={form.codigo}
              onChange={(event) => updateFormField("codigo", normalizeCode(event.target.value))}
              placeholder="Digite o codigo"
              required
            />
          </label>

          <label className={styles.field}>
            <span>
              Descricao <span className="requiredMark">*</span>
            </span>
            <input
              type="text"
              value={form.descricao}
              onChange={(event) => updateFormField("descricao", event.target.value)}
              placeholder="Digite a descricao"
              required
            />
          </label>

          <label className={styles.field}>
            <span>
              Tipo <span className="requiredMark">*</span>
            </span>
            <input
              type="text"
              value={form.tipo}
              onChange={(event) => updateFormField("tipo", normalizeType(event.target.value))}
              placeholder="Digite o tipo"
              required
            />
          </label>

          <label className={styles.field}>
            <span>
              Preco <span className="requiredMark">*</span>
            </span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.unitPrice}
              onChange={(event) => updateFormField("unitPrice", event.target.value)}
              placeholder="0,00"
              required
            />
          </label>

          <label className={styles.field}>
            <span>UMB</span>
            <input
              type="text"
              value={form.umb}
              onChange={(event) => updateFormField("umb", event.target.value)}
              placeholder="Ex.: UN"
            />
          </label>

          <div className={`${styles.actions} ${styles.formActions}`}>
            <button type="submit" className={styles.primaryButton} disabled={isSubmitting}>
              {isSubmitting ? (isEditing ? "Salvando..." : "Registrando...") : isEditing ? "Salvar alteracoes" : "Registrar material"}
            </button>
            {isEditing ? (
              <button type="button" className={styles.ghostButton} onClick={resetFormState} disabled={isSubmitting}>
                Cancelar edicao
              </button>
            ) : null}
          </div>
        </form>
      </article>

      <article className={styles.card}>
        <h3 className={styles.cardTitle}>Filtros</h3>

        <div className={styles.filterGrid}>
          <label className={styles.field}>
            <span>Codigo</span>
            <input
              type="text"
              value={filterDraft.codigo}
              onChange={(event) => updateFilterField("codigo", event.target.value)}
              placeholder="Filtrar por codigo"
            />
          </label>

          <label className={styles.field}>
            <span>Descricao</span>
            <input
              type="text"
              value={filterDraft.descricao}
              onChange={(event) => updateFilterField("descricao", event.target.value)}
              placeholder="Filtrar por descricao"
            />
          </label>

          <label className={styles.field}>
            <span>Tipo</span>
            <input
              type="text"
              value={filterDraft.tipo}
              onChange={(event) => updateFilterField("tipo", normalizeType(event.target.value))}
              placeholder="Filtrar por tipo"
            />
          </label>

          <label className={styles.field}>
            <span>Status</span>
            <select value={filterDraft.status} onChange={(event) => updateFilterField("status", event.target.value as FilterState["status"])}>
              <option value="">Todos</option>
              <option value="ativo">Ativo</option>
              <option value="inativo">Inativo</option>
            </select>
          </label>
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.secondaryButton} onClick={applyFilters}>
            Aplicar
          </button>
          <button type="button" className={styles.ghostButton} onClick={clearFilters}>
            Limpar
          </button>
        </div>
      </article>

      <article className={styles.card}>
        <div className={styles.tableHeader}>
          <h3 className={styles.cardTitle}>Lista de Materiais</h3>
          <div className={styles.tableHint}>Listagem paginada no servidor ({PAGE_SIZE} por pagina).</div>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Codigo</th>
                <th>Descricao</th>
                <th>Tipo</th>
                <th>UMB</th>
                <th>Preco</th>
                <th>Registrado por</th>
                <th>Registrado em</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {materials.length > 0
                ? materials.map((material) => (
                    <tr key={material.id} className={!material.isActive ? styles.inactiveRow : undefined}>
                      <td>
                        <div className={styles.sobCell}>
                          <span>{material.codigo}</span>
                          {!material.isActive ? <span className={styles.statusTag}>Inativo</span> : null}
                        </div>
                      </td>
                      <td>{material.descricao}</td>
                      <td>{material.tipo}</td>
                      <td>{material.umb ?? "-"}</td>
                      <td>{formatCurrency(material.unitPrice)}</td>
                      <td>{material.createdByName}</td>
                      <td>{formatDateTime(material.createdAt)}</td>
                      <td className={styles.actionsCell}>
                        <div className={styles.tableActions}>
                          <button
                            type="button"
                            className={`${styles.actionButton} ${styles.actionEdit}`}
                            onClick={() => handleEditMaterial(material)}
                            aria-label={`Editar material ${material.codigo}`}
                            title="Editar"
                            disabled={!material.isActive}
                          >
                            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <path
                                d="M4.5 19.5h4l9-9a1.4 1.4 0 0 0 0-2l-2-2a1.4 1.4 0 0 0-2 0l-9 9v4Z"
                                stroke="currentColor"
                                strokeWidth="1.7"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                              <path d="M12.5 7.5l4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                            </svg>
                          </button>

                          <button
                            type="button"
                            className={`${styles.actionButton} ${styles.actionHistory}`}
                            onClick={() => void openHistoryModal(material)}
                            aria-label={`Historico do material ${material.codigo}`}
                            title="Historico"
                          >
                            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <path
                                d="M3.75 12a8.25 8.25 0 1 0 2.25-5.69M3.75 4.75v4h4"
                                stroke="currentColor"
                                strokeWidth="1.7"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                              <path d="M12 8.5v3.75l2.5 1.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                            </svg>
                          </button>

                          <button
                            type="button"
                            className={`${styles.actionButton} ${material.isActive ? styles.actionCancel : styles.actionActivate}`}
                            onClick={() => openStatusModal(material)}
                            aria-label={`${material.isActive ? "Cancelar" : "Ativar"} material ${material.codigo}`}
                            title={material.isActive ? "Cancelar" : "Ativar"}
                          >
                            {material.isActive ? (
                              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" />
                                <path d="m9.5 9.5 5 5m0-5-5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                              </svg>
                            ) : (
                              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" />
                                <path
                                  d="m8.5 12 2.2 2.2 4.8-4.8"
                                  stroke="currentColor"
                                  strokeWidth="1.7"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                : (
                  <tr>
                    <td colSpan={8} className={styles.emptyRow}>
                      {isLoadingList ? "Carregando materiais..." : "Nenhum material encontrado para os filtros informados."}
                    </td>
                  </tr>
                )}
            </tbody>
          </table>
        </div>

        <div className={styles.pagination}>
          <span>
            Pagina {Math.min(page, totalPages)} de {totalPages} | Total: {total}
          </span>

          <div className={styles.paginationActions}>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1 || isLoadingList}
            >
              Anterior
            </button>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={page >= totalPages || isLoadingList}
            >
              Proxima
            </button>
          </div>
        </div>
      </article>

      {historyMaterial ? (
        <div className={styles.modalOverlay} onClick={closeHistoryModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Historico do Material {historyMaterial.codigo}</h4>
                <p className={styles.modalSubtitle}>ID do material: {historyMaterial.id}</p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={closeHistoryModal}>
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              {isLoadingHistory ? <p>Carregando historico...</p> : null}

              {!isLoadingHistory && historyEntries.length === 0 ? <p>Nenhuma alteracao registrada.</p> : null}

              {!isLoadingHistory && historyEntries.length > 0
                ? historyEntries.map((entry) => (
                    <article key={entry.id} className={styles.historyCard}>
                      <header className={styles.historyCardHeader}>
                        <strong>
                          {entry.changeType === "CANCEL"
                            ? "Cancelamento"
                            : entry.changeType === "ACTIVATE"
                              ? "Ativacao"
                              : "Atualizacao"}
                        </strong>
                        <span>
                          {formatDateTime(entry.createdAt)} | {entry.createdByName}
                        </span>
                      </header>

                      <div className={styles.historyChanges}>
                        {Object.entries(entry.changes).map(([field, change]) => (
                          <div key={field} className={styles.historyChangeItem}>
                            <strong>{HISTORY_FIELD_LABELS[field] ?? field}</strong>
                            <span>De: {formatHistoryValue(field, change.from)}</span>
                            <span>Para: {formatHistoryValue(field, change.to)}</span>
                          </div>
                        ))}
                      </div>
                    </article>
                  ))
                : null}

              {historyTotal > 0 ? (
                <div className={styles.pagination}>
                  <span>
                    Pagina {Math.min(historyPage, historyTotalPages)} de {historyTotalPages} | Total: {historyTotal}
                  </span>

                  <div className={styles.paginationActions}>
                    <button
                      type="button"
                      className={styles.ghostButton}
                      onClick={() => {
                        const target = Math.max(1, historyPage - 1);
                        void loadMaterialHistory(historyMaterial, target);
                      }}
                      disabled={historyPage <= 1 || isLoadingHistory}
                    >
                      Anterior
                    </button>
                    <button
                      type="button"
                      className={styles.ghostButton}
                      onClick={() => {
                        const target = Math.min(historyTotalPages, historyPage + 1);
                        void loadMaterialHistory(historyMaterial, target);
                      }}
                      disabled={historyPage >= historyTotalPages || isLoadingHistory}
                    >
                      Proxima
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </article>
        </div>
      ) : null}

      {statusMaterial ? (
        <div className={styles.modalOverlay} onClick={closeStatusModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>{statusMaterial.isActive ? "Cancelar Material" : "Ativar Material"}</h4>
                <p className={styles.modalSubtitle}>Material: {statusMaterial.codigo}</p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={closeStatusModal}>
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              <label className={styles.field}>
                <span>
                  Motivo <span className="requiredMark">*</span>
                </span>
                <textarea
                  value={statusReason}
                  onChange={(event) => setStatusReason(event.target.value)}
                  placeholder={statusMaterial.isActive ? "Informe o motivo do cancelamento" : "Informe o motivo da ativacao"}
                  rows={4}
                />
              </label>

              <div className={styles.actions}>
                <button
                  type="button"
                  className={statusMaterial.isActive ? styles.dangerButton : styles.primaryButton}
                  onClick={() => void confirmStatusChange()}
                  disabled={!canSubmitStatusChange}
                >
                  {isChangingStatus
                    ? statusMaterial.isActive
                      ? "Cancelando..."
                      : "Ativando..."
                    : statusMaterial.isActive
                      ? "Confirmar cancelamento"
                      : "Confirmar ativacao"}
                </button>
                <button type="button" className={styles.ghostButton} onClick={closeStatusModal} disabled={isChangingStatus}>
                  Fechar
                </button>
              </div>
            </div>
          </article>
        </div>
      ) : null}
    </section>
  );
}
