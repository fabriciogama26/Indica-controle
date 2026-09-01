"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { ActionIcon } from "@/components/ui/ActionIcon";
import { CsvExportButton } from "@/components/ui/CsvExportButton";
import { Pagination } from "@/components/ui/Pagination";
import { useAuth } from "@/hooks/useAuth";
import { useErrorLogger } from "@/hooks/useErrorLogger";
import { useExportCooldown } from "@/hooks/useExportCooldown";
import { usePagination } from "@/hooks/usePagination";
import { DEFAULT_EXPORT_PAGE_SIZE, DEFAULT_HISTORY_PAGE_SIZE, DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { downloadCsvFile } from "@/lib/utils/csv";
import { formatAuditActor, formatDateTime } from "@/lib/utils/formatters";
import styles from "../pessoas/PeoplePageView.module.css";
import { buildNoProductionReasonsCsv } from "./csv";

type NoProductionReasonItem = {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

type NoProductionReasonHistoryEntry = {
  id: string;
  changeType: "UPDATE" | "CANCEL" | "ACTIVATE";
  reason: string | null;
  createdAt: string;
  createdByName: string;
  changes: Record<string, { from: string | null; to: string | null }>;
};

type NoProductionReasonFormState = {
  id: string | null;
  updatedAt: string | null;
  code: string;
  name: string;
  sortOrder: string;
};

type NoProductionReasonFilterState = {
  code: string;
  name: string;
  status: "" | "ativo" | "inativo";
};

type NoProductionReasonsListResponse = {
  noProductionReasons?: NoProductionReasonItem[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

type NoProductionReasonHistoryResponse = {
  history?: NoProductionReasonHistoryEntry[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

const PAGE_SIZE = DEFAULT_PAGE_SIZE;
const HISTORY_PAGE_SIZE = DEFAULT_HISTORY_PAGE_SIZE;
const EXPORT_PAGE_SIZE = DEFAULT_EXPORT_PAGE_SIZE;

const INITIAL_FORM: NoProductionReasonFormState = {
  id: null,
  updatedAt: null,
  code: "",
  name: "",
  sortOrder: "0",
};

const INITIAL_FILTERS: NoProductionReasonFilterState = {
  code: "",
  name: "",
  status: "",
};

const HISTORY_FIELD_LABELS: Record<string, string> = {
  code: "Codigo",
  name: "Nome",
  sortOrder: "Ordem",
  isActive: "Status",
  cancellationReason: "Motivo do cancelamento",
  activationReason: "Motivo da ativacao",
};

function normalizeText(value: string) {
  return String(value ?? "").trim();
}

function normalizeCode(value: string) {
  return normalizeText(value).toUpperCase().replace(/\s+/g, "_");
}

function buildQuery(
  filters: NoProductionReasonFilterState,
  page: number,
  pageSize = PAGE_SIZE,
  mode?: "export",
) {
  const params = new URLSearchParams();
  if (filters.code.trim()) {
    params.set("code", filters.code.trim());
  }
  if (filters.name.trim()) {
    params.set("name", filters.name.trim());
  }
  if (filters.status.trim()) {
    params.set("status", filters.status.trim());
  }
  if (mode) {
    params.set("mode", mode);
  }
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  return params.toString();
}

function formatHistoryValue(field: string, value: string | null) {
  if (!value) {
    return "-";
  }
  if (field === "isActive") {
    return value === "true" ? "Ativo" : "Inativo";
  }
  return value;
}

function scrollDashboardContentToTop() {
  if (typeof window === "undefined") {
    return;
  }

  const content = document.querySelector<HTMLElement>('[data-main-content-scroll="true"]');
  if (content) {
    content.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

export function NoProductionReasonsPageView() {
  const { session } = useAuth();
  const logError = useErrorLogger("motivo-sem-producao");
  const exportCooldown = useExportCooldown();
  const [form, setForm] = useState<NoProductionReasonFormState>(INITIAL_FORM);
  const [filterDraft, setFilterDraft] = useState<NoProductionReasonFilterState>(INITIAL_FILTERS);
  const [activeFilters, setActiveFilters] = useState<NoProductionReasonFilterState>(INITIAL_FILTERS);
  const [noProductionReasons, setNoProductionReasons] = useState<NoProductionReasonItem[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isChangingStatus, setIsChangingStatus] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [detailReason, setDetailReason] = useState<NoProductionReasonItem | null>(null);
  const [historyReason, setHistoryReason] = useState<NoProductionReasonItem | null>(null);
  const [historyEntries, setHistoryEntries] = useState<NoProductionReasonHistoryEntry[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [statusReasonTarget, setStatusReasonTarget] = useState<NoProductionReasonItem | null>(null);
  const [statusReason, setStatusReason] = useState("");
  const { page, total, totalPages, setPage, setTotal } = usePagination({ pageSize: PAGE_SIZE });
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const historyTotalPages = Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE));
  const isEditing = Boolean(form.id);
  const statusAction = statusReasonTarget?.isActive ? "cancel" : "activate";
  const formTitle = useMemo(
    () => (isEditing ? "Editar Motivo sem producao" : "Cadastro de Motivo sem producao"),
    [isEditing],
  );
  const canSubmitStatusChange = Boolean(statusReason.trim()) && !isChangingStatus;

  const loadNoProductionReasons = useCallback(
    async (
      targetPage: number,
      filters: NoProductionReasonFilterState,
      pageSize = PAGE_SIZE,
      mode?: "export",
    ) => {
      if (!session?.accessToken) {
        return [] as NoProductionReasonItem[];
      }

      setIsLoadingList(true);
      try {
        const query = buildQuery(filters, targetPage, pageSize, mode);
        const response = await fetch(`/api/no-production-reasons?${query}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as NoProductionReasonsListResponse;
        if (!response.ok) {
          setNoProductionReasons([]);
          setTotal(0);
          setFeedback({ type: "error", message: data.message ?? "Falha ao carregar motivos sem producao." });
          return [] as NoProductionReasonItem[];
        }

        const nextReasons = data.noProductionReasons ?? [];
        if (!mode) {
          setNoProductionReasons(nextReasons);
          setTotal(data.pagination?.total ?? 0);
        }
        return nextReasons;
      } catch (error) {
        await logError("Falha ao carregar motivos sem producao.", error, { page: targetPage, filters });
        setNoProductionReasons([]);
        setTotal(0);
        setFeedback({ type: "error", message: "Falha ao carregar motivos sem producao." });
        return [] as NoProductionReasonItem[];
      } finally {
        setIsLoadingList(false);
      }
    },
    [logError, session?.accessToken, setTotal],
  );

  const loadNoProductionReasonHistory = useCallback(
    async (reason: NoProductionReasonItem, targetPage: number) => {
      if (!session?.accessToken) {
        setFeedback({ type: "error", message: "Sessao invalida para carregar historico." });
        return;
      }

      setIsLoadingHistory(true);
      try {
        const params = new URLSearchParams();
        params.set("historyNoProductionReasonId", reason.id);
        params.set("historyPage", String(targetPage));
        params.set("historyPageSize", String(HISTORY_PAGE_SIZE));

        const response = await fetch(`/api/no-production-reasons?${params.toString()}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as NoProductionReasonHistoryResponse;
        if (!response.ok) {
          setFeedback({
            type: "error",
            message: data.message ?? "Falha ao carregar historico do motivo sem producao.",
          });
          setHistoryEntries([]);
          setHistoryTotal(0);
          return;
        }

        setHistoryEntries(data.history ?? []);
        setHistoryPage(data.pagination?.page ?? targetPage);
        setHistoryTotal(data.pagination?.total ?? 0);
      } catch (error) {
        await logError("Falha ao carregar historico do motivo sem producao.", error, { reasonId: reason.id });
        setFeedback({ type: "error", message: "Falha ao carregar historico do motivo sem producao." });
        setHistoryEntries([]);
        setHistoryTotal(0);
      } finally {
        setIsLoadingHistory(false);
      }
    },
    [logError, session?.accessToken],
  );

  useEffect(() => {
    void loadNoProductionReasons(page, activeFilters);
  }, [activeFilters, loadNoProductionReasons, page]);

  function resetForm() {
    setForm(INITIAL_FORM);
  }

  function updateFilterField(field: keyof NoProductionReasonFilterState, value: string) {
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

  function startEdit(reason: NoProductionReasonItem) {
    setForm({
      id: reason.id,
      updatedAt: reason.updatedAt,
      code: reason.code,
      name: reason.name,
      sortOrder: String(reason.sortOrder),
    });
    setFeedback(null);
    scrollDashboardContentToTop();
  }

  function closeHistoryModal() {
    setHistoryReason(null);
    setHistoryEntries([]);
    setHistoryPage(1);
    setHistoryTotal(0);
    setIsLoadingHistory(false);
  }

  async function openHistoryModal(reason: NoProductionReasonItem) {
    setHistoryReason(reason);
    setHistoryEntries([]);
    setHistoryPage(1);
    setHistoryTotal(0);
    await loadNoProductionReasonHistory(reason, 1);
  }

  function openStatusModal(reason: NoProductionReasonItem) {
    setStatusReasonTarget(reason);
    setStatusReason("");
  }

  function closeStatusModal() {
    setStatusReasonTarget(null);
    setStatusReason("");
    setIsChangingStatus(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session?.accessToken) {
      setFeedback({ type: "error", message: "Sessao invalida para salvar motivo sem producao." });
      return;
    }

    setIsSaving(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/no-production-reasons", {
        method: form.id ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          id: form.id,
          code: normalizeCode(form.code),
          name: normalizeText(form.name),
          sortOrder: form.id ? Number(form.sortOrder) : null,
          ...(form.id ? { expectedUpdatedAt: form.updatedAt } : {}),
        }),
      });

      const data = (await response.json().catch(() => ({}))) as { success?: boolean; message?: string; code?: string };
      if (!response.ok || !data.success) {
        if (data.code === "CONCURRENT_MODIFICATION" || data.code === "RECORD_INACTIVE") {
          await loadNoProductionReasons(page, activeFilters);
        }
        setFeedback({ type: "error", message: data.message ?? "Falha ao salvar motivo sem producao." });
        return;
      }

      setFeedback({ type: "success", message: data.message ?? "Motivo sem producao salvo com sucesso." });
      resetForm();
      await loadNoProductionReasons(1, activeFilters);
      setPage(1);
    } catch (error) {
      await logError("Falha ao salvar motivo sem producao.", error, { id: form.id, code: form.code });
      setFeedback({ type: "error", message: "Falha ao salvar motivo sem producao." });
    } finally {
      setIsSaving(false);
    }
  }

  async function confirmStatusChange() {
    if (!session?.accessToken || !statusReasonTarget || !statusReason.trim()) {
      return;
    }

    setIsChangingStatus(true);

    try {
      const response = await fetch("/api/no-production-reasons", {
        method: "PATCH",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          id: statusReasonTarget.id,
          reason: statusReason.trim(),
          action: statusAction,
          expectedUpdatedAt: statusReasonTarget.updatedAt,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as { success?: boolean; message?: string; code?: string };
      if (!response.ok || !data.success) {
        if (
          data.code === "CONCURRENT_MODIFICATION"
          || data.code === "RECORD_INACTIVE"
          || data.code === "STATUS_ALREADY_CHANGED"
        ) {
          closeStatusModal();
          await loadNoProductionReasons(page, activeFilters);
        }
        if (data.code === "NO_PRODUCTION_REASON_IN_USE") {
          closeStatusModal();
        }
        setFeedback({ type: "error", message: data.message ?? "Falha ao atualizar status do motivo sem producao." });
        return;
      }

      setFeedback({ type: "success", message: data.message ?? "Status do motivo sem producao atualizado com sucesso." });
      if (form.id === statusReasonTarget.id) {
        resetForm();
      }
      closeStatusModal();
      await loadNoProductionReasons(page, activeFilters);
    } catch (error) {
      await logError("Falha ao atualizar status do motivo sem producao.", error, { id: statusReasonTarget.id });
      setFeedback({ type: "error", message: "Falha ao atualizar status do motivo sem producao." });
    } finally {
      setIsChangingStatus(false);
    }
  }

  async function handleExportNoProductionReasons() {
    if (!session?.accessToken) {
      setFeedback({ type: "error", message: "Sessao invalida para exportar motivos sem producao." });
      return;
    }

    if (!exportCooldown.tryStart()) {
      setFeedback({
        type: "error",
        message: `Aguarde ${exportCooldown.getRemainingSeconds()}s antes de exportar novamente.`,
      });
      return;
    }

    setIsExporting(true);
    try {
      const allReasons: NoProductionReasonItem[] = [];
      let exportPage = 1;
      let totalItems = 0;

      while (true) {
        const query = buildQuery(activeFilters, exportPage, EXPORT_PAGE_SIZE, "export");
        const response = await fetch(`/api/no-production-reasons?${query}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as NoProductionReasonsListResponse;
        if (!response.ok) {
          setFeedback({ type: "error", message: data.message ?? "Falha ao exportar motivos sem producao." });
          return;
        }

        const pageItems = data.noProductionReasons ?? [];
        allReasons.push(...pageItems);
        totalItems = data.pagination?.total ?? allReasons.length;
        if (allReasons.length >= totalItems || pageItems.length === 0) {
          break;
        }
        exportPage += 1;
      }

      downloadCsvFile(buildNoProductionReasonsCsv(allReasons), "motivos_sem_producao.csv");
      setFeedback({ type: "success", message: `${allReasons.length} motivo(s) sem producao exportado(s).` });
    } catch (error) {
      await logError("Falha ao exportar motivos sem producao.", error, { filters: activeFilters });
      setFeedback({ type: "error", message: "Falha ao exportar motivos sem producao." });
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <section className={styles.wrapper}>
      {feedback ? (
        <div className={feedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError}>
          {feedback.message}
        </div>
      ) : null}

      <article className={`${styles.card} ${isEditing ? styles.editingCard : ""}`}>
        <h3 className={styles.cardTitle}>{formTitle}</h3>

        <form className={styles.formGrid} onSubmit={(event) => void handleSubmit(event)}>
          <label className={styles.field}>
            <span>
              Codigo <span className="requiredMark">*</span>
            </span>
            <input
              type="text"
              value={form.code}
              onChange={(event) => setForm((current) => ({ ...current, code: normalizeCode(event.target.value) }))}
              placeholder="Ex.: CHUVA"
              required
            />
          </label>

          <label className={styles.field}>
            <span>
              Nome <span className="requiredMark">*</span>
            </span>
            <input
              type="text"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Ex.: Chuva"
              required
            />
          </label>

          <div className={`${styles.actions} ${styles.formActions}`}>
            {isEditing ? (
              <button type="button" className={styles.ghostButton} onClick={resetForm} disabled={isSaving}>
                Cancelar
              </button>
            ) : null}
            <button type="submit" className={styles.primaryButton} disabled={isSaving}>
              {isSaving ? "Salvando..." : isEditing ? "Atualizar" : "Cadastrar"}
            </button>
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
              value={filterDraft.code}
              onChange={(event) => updateFilterField("code", event.target.value)}
              placeholder="Filtrar por codigo"
            />
          </label>

          <label className={styles.field}>
            <span>Nome</span>
            <input
              type="text"
              value={filterDraft.name}
              onChange={(event) => updateFilterField("name", event.target.value)}
              placeholder="Filtrar por nome"
            />
          </label>

          <label className={styles.field}>
            <span>Status</span>
            <select value={filterDraft.status} onChange={(event) => updateFilterField("status", event.target.value)}>
              <option value="">Todos</option>
              <option value="ativo">Ativo</option>
              <option value="inativo">Inativo</option>
            </select>
          </label>
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.secondaryButton} onClick={applyFilters} disabled={isLoadingList}>
            Aplicar
          </button>
          <button type="button" className={styles.ghostButton} onClick={clearFilters} disabled={isLoadingList}>
            Limpar
          </button>
        </div>
      </article>

      <article className={styles.card}>
        <div className={styles.tableHeader}>
          <h3 className={styles.cardTitle}>Lista de Motivos sem producao</h3>
          <CsvExportButton
            className={styles.ghostButton}
            onClick={() => void handleExportNoProductionReasons()}
            isLoading={isExporting}
            disabled={isExporting || isLoadingList || exportCooldown.isCoolingDown}
          />
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Codigo</th>
                <th>Nome</th>
                <th>Ordem</th>
                <th>Status</th>
                <th>Atualizado em</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {noProductionReasons.length > 0 ? (
                noProductionReasons.map((reason) => (
                  <tr key={reason.id} className={!reason.isActive ? styles.inactiveRow : undefined}>
                    <td>{reason.code}</td>
                    <td>
                      <div className={styles.sobCell}>
                        <span>{reason.name}</span>
                        {!reason.isActive ? <span className={styles.statusTag}>Inativo</span> : null}
                      </div>
                    </td>
                    <td>{reason.sortOrder}</td>
                    <td>{reason.isActive ? "Ativo" : "Inativo"}</td>
                    <td>{formatDateTime(reason.updatedAt)}</td>
                    <td className={styles.actionsCell}>
                      <div className={styles.tableActions}>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${styles.actionView}`}
                          onClick={() => setDetailReason(reason)}
                          title="Detalhes"
                          aria-label="Detalhes do motivo sem producao"
                        >
                          <ActionIcon name="details" />
                        </button>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${styles.actionEdit}`}
                          onClick={() => startEdit(reason)}
                          title="Editar"
                          aria-label="Editar motivo sem producao"
                          disabled={!reason.isActive}
                        >
                          <ActionIcon name="edit" />
                        </button>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${styles.actionHistory}`}
                          onClick={() => void openHistoryModal(reason)}
                          title="Historico"
                          aria-label="Historico do motivo sem producao"
                        >
                          <ActionIcon name="history" />
                        </button>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${reason.isActive ? styles.actionCancel : styles.actionActivate}`}
                          onClick={() => openStatusModal(reason)}
                          title={reason.isActive ? "Cancelar" : "Ativar"}
                          aria-label={reason.isActive ? "Cancelar motivo sem producao" : "Ativar motivo sem producao"}
                        >
                          <ActionIcon name={reason.isActive ? "cancel" : "activate"} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className={styles.emptyRow}>
                    {isLoadingList
                      ? "Carregando motivos sem producao..."
                      : "Nenhum motivo sem producao encontrado para os filtros informados."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          onPrev={() => setPage((current) => Math.max(1, current - 1))}
          onNext={() => setPage((current) => Math.min(totalPages, current + 1))}
          disabled={isLoadingList}
          className={styles.pagination}
          actionsClassName={styles.paginationActions}
          buttonClassName={styles.ghostButton}
        />
      </article>

      {detailReason ? (
        <div className={styles.modalOverlay} onClick={() => setDetailReason(null)}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Detalhes do Motivo sem producao {detailReason.name}</h4>
                <p className={styles.modalSubtitle}>ID do motivo: {detailReason.id}</p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={() => setDetailReason(null)}>
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              <div className={styles.detailGrid}>
                <div><strong>Status:</strong> {detailReason.isActive ? "Ativo" : "Inativo"}</div>
                <div><strong>Codigo:</strong> {detailReason.code}</div>
                <div><strong>Nome:</strong> {detailReason.name}</div>
                <div><strong>Ordem:</strong> {detailReason.sortOrder}</div>
                <div><strong>Registrado por:</strong> {formatAuditActor(detailReason.createdByName)}</div>
                <div><strong>Criado em:</strong> {formatDateTime(detailReason.createdAt)}</div>
                <div><strong>Atualizado por:</strong> {formatAuditActor(detailReason.updatedByName)}</div>
                <div><strong>Atualizado em:</strong> {formatDateTime(detailReason.updatedAt)}</div>
              </div>
            </div>
          </article>
        </div>
      ) : null}

      {historyReason ? (
        <div className={styles.modalOverlay} onClick={closeHistoryModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Historico do Motivo sem producao {historyReason.name}</h4>
                <p className={styles.modalSubtitle}>ID do motivo: {historyReason.id}</p>
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

                      {entry.reason ? <p className={styles.historyReason}>Motivo: {entry.reason}</p> : null}

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
                        void loadNoProductionReasonHistory(historyReason, target);
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
                        void loadNoProductionReasonHistory(historyReason, target);
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

      {statusReasonTarget ? (
        <div className={styles.modalOverlay} onClick={closeStatusModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>
                  {statusAction === "cancel" ? "Cancelar Motivo sem producao" : "Ativar Motivo sem producao"}
                </h4>
                <p className={styles.modalSubtitle}>Motivo: {statusReasonTarget.name}</p>
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
                  placeholder={statusAction === "cancel" ? "Informe o motivo do cancelamento" : "Informe o motivo da ativacao"}
                  rows={4}
                />
              </label>

              <div className={styles.actions}>
                <button
                  type="button"
                  className={statusAction === "cancel" ? styles.dangerButton : styles.primaryButton}
                  onClick={() => void confirmStatusChange()}
                  disabled={!canSubmitStatusChange}
                >
                  {isChangingStatus
                    ? statusAction === "cancel"
                      ? "Cancelando..."
                      : "Ativando..."
                    : statusAction === "cancel"
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
