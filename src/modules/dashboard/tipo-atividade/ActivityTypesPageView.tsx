"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { ActionIcon } from "@/components/ui/ActionIcon";
import { CsvExportButton } from "@/components/ui/CsvExportButton";
import { Pagination } from "@/components/ui/Pagination";
import { useAuth } from "@/hooks/useAuth";
import { useErrorLogger } from "@/hooks/useErrorLogger";
import { useExportCooldown } from "@/hooks/useExportCooldown";
import { usePagination } from "@/hooks/usePagination";
import { downloadCsvFile } from "@/lib/utils/csv";
import { formatAuditActor, formatDateTime } from "@/lib/utils/formatters";
import { DEFAULT_EXPORT_PAGE_SIZE, DEFAULT_HISTORY_PAGE_SIZE, DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import styles from "../pessoas/PeoplePageView.module.css";
import { buildActivityTypesCsv } from "./csv";

type ActivityTypeItem = {
  id: string;
  name: string;
  isActive: boolean;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

type ActivityTypeHistoryEntry = {
  id: string;
  changeType: "UPDATE" | "CANCEL" | "ACTIVATE";
  reason: string | null;
  createdAt: string;
  createdByName: string;
  changes: Record<string, { from: string | null; to: string | null }>;
};

type ActivityTypeFormState = {
  id: string | null;
  updatedAt: string | null;
  name: string;
};

type ActivityTypeFilterState = {
  name: string;
  status: "" | "ativo" | "inativo";
};

type ActivityTypesListResponse = {
  activityTypes?: ActivityTypeItem[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

type ActivityTypeHistoryResponse = {
  history?: ActivityTypeHistoryEntry[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

const PAGE_SIZE = DEFAULT_PAGE_SIZE;
const HISTORY_PAGE_SIZE = DEFAULT_HISTORY_PAGE_SIZE;
const EXPORT_PAGE_SIZE = DEFAULT_EXPORT_PAGE_SIZE;

const INITIAL_FORM: ActivityTypeFormState = {
  id: null,
  updatedAt: null,
  name: "",
};

const INITIAL_FILTERS: ActivityTypeFilterState = {
  name: "",
  status: "",
};

const HISTORY_FIELD_LABELS: Record<string, string> = {
  name: "Nome",
  isActive: "Status",
  cancellationReason: "Motivo do cancelamento",
  activationReason: "Motivo da ativacao",
};

function normalizeText(value: string) {
  return String(value ?? "").trim();
}

function buildQuery(filters: ActivityTypeFilterState, page: number, pageSize = PAGE_SIZE, mode?: "export") {
  const params = new URLSearchParams();
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

export function ActivityTypesPageView() {
  const { session } = useAuth();
  const logError = useErrorLogger("tipo-atividade");
  const exportCooldown = useExportCooldown();
  const [form, setForm] = useState<ActivityTypeFormState>(INITIAL_FORM);
  const [filterDraft, setFilterDraft] = useState<ActivityTypeFilterState>(INITIAL_FILTERS);
  const [activeFilters, setActiveFilters] = useState<ActivityTypeFilterState>(INITIAL_FILTERS);
  const [activityTypes, setActivityTypes] = useState<ActivityTypeItem[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isChangingStatus, setIsChangingStatus] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [detailActivityType, setDetailActivityType] = useState<ActivityTypeItem | null>(null);
  const [historyActivityType, setHistoryActivityType] = useState<ActivityTypeItem | null>(null);
  const [historyEntries, setHistoryEntries] = useState<ActivityTypeHistoryEntry[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [statusActivityType, setStatusActivityType] = useState<ActivityTypeItem | null>(null);
  const [statusReason, setStatusReason] = useState("");
  const { page, total, totalPages, setPage, setTotal } = usePagination({ pageSize: PAGE_SIZE });
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const historyTotalPages = Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE));
  const isEditing = Boolean(form.id);
  const statusAction = statusActivityType?.isActive ? "cancel" : "activate";
  const formTitle = useMemo(() => (isEditing ? "Editar Tipo de Atividade" : "Cadastro de Tipo de Atividade"), [isEditing]);
  const canSubmitStatusChange = Boolean(statusReason.trim()) && !isChangingStatus;

  const loadActivityTypes = useCallback(
    async (targetPage: number, filters: ActivityTypeFilterState, pageSize = PAGE_SIZE, mode?: "export") => {
      if (!session?.accessToken) {
        return [] as ActivityTypeItem[];
      }

      setIsLoadingList(true);
      try {
        const query = buildQuery(filters, targetPage, pageSize, mode);
        const response = await fetch(`/api/activity-types?${query}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as ActivityTypesListResponse;
        if (!response.ok) {
          setActivityTypes([]);
          setTotal(0);
          setFeedback({ type: "error", message: data.message ?? "Falha ao carregar tipos de atividade." });
          return [] as ActivityTypeItem[];
        }

        const nextActivityTypes = data.activityTypes ?? [];
        if (!mode) {
          setActivityTypes(nextActivityTypes);
          setTotal(data.pagination?.total ?? 0);
        }
        return nextActivityTypes;
      } catch (error) {
        await logError("Falha ao carregar tipos de atividade.", error, { page: targetPage, filters });
        setActivityTypes([]);
        setTotal(0);
        setFeedback({ type: "error", message: "Falha ao carregar tipos de atividade." });
        return [] as ActivityTypeItem[];
      } finally {
        setIsLoadingList(false);
      }
    },
    [logError, session?.accessToken, setTotal],
  );

  const loadActivityTypeHistory = useCallback(
    async (activityType: ActivityTypeItem, targetPage: number) => {
      if (!session?.accessToken) {
        setFeedback({ type: "error", message: "Sessao invalida para carregar historico." });
        return;
      }

      setIsLoadingHistory(true);
      try {
        const params = new URLSearchParams();
        params.set("historyActivityTypeId", activityType.id);
        params.set("historyPage", String(targetPage));
        params.set("historyPageSize", String(HISTORY_PAGE_SIZE));

        const response = await fetch(`/api/activity-types?${params.toString()}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as ActivityTypeHistoryResponse;
        if (!response.ok) {
          setFeedback({ type: "error", message: data.message ?? "Falha ao carregar historico do tipo de atividade." });
          setHistoryEntries([]);
          setHistoryTotal(0);
          return;
        }

        setHistoryEntries(data.history ?? []);
        setHistoryPage(data.pagination?.page ?? targetPage);
        setHistoryTotal(data.pagination?.total ?? 0);
      } catch (error) {
        await logError("Falha ao carregar historico do tipo de atividade.", error, { activityTypeId: activityType.id });
        setFeedback({ type: "error", message: "Falha ao carregar historico do tipo de atividade." });
        setHistoryEntries([]);
        setHistoryTotal(0);
      } finally {
        setIsLoadingHistory(false);
      }
    },
    [logError, session?.accessToken],
  );

  useEffect(() => {
    void loadActivityTypes(page, activeFilters);
  }, [activeFilters, loadActivityTypes, page]);

  function resetForm() {
    setForm(INITIAL_FORM);
  }

  function updateFilterField(field: keyof ActivityTypeFilterState, value: string) {
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

  function startEdit(activityType: ActivityTypeItem) {
    setForm({
      id: activityType.id,
      updatedAt: activityType.updatedAt,
      name: activityType.name,
    });
    setFeedback(null);
    scrollDashboardContentToTop();
  }

  function closeHistoryModal() {
    setHistoryActivityType(null);
    setHistoryEntries([]);
    setHistoryPage(1);
    setHistoryTotal(0);
    setIsLoadingHistory(false);
  }

  async function openHistoryModal(activityType: ActivityTypeItem) {
    setHistoryActivityType(activityType);
    setHistoryEntries([]);
    setHistoryPage(1);
    setHistoryTotal(0);
    await loadActivityTypeHistory(activityType, 1);
  }

  function openStatusModal(activityType: ActivityTypeItem) {
    setStatusActivityType(activityType);
    setStatusReason("");
  }

  function closeStatusModal() {
    setStatusActivityType(null);
    setStatusReason("");
    setIsChangingStatus(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session?.accessToken) {
      setFeedback({ type: "error", message: "Sessao invalida para salvar tipo de atividade." });
      return;
    }

    setIsSaving(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/activity-types", {
        method: form.id ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          id: form.id,
          name: normalizeText(form.name),
          ...(form.id ? { expectedUpdatedAt: form.updatedAt } : {}),
        }),
      });

      const data = (await response.json().catch(() => ({}))) as { success?: boolean; message?: string; code?: string };
      if (!response.ok || !data.success) {
        if (data.code === "CONCURRENT_MODIFICATION" || data.code === "RECORD_INACTIVE") {
          await loadActivityTypes(page, activeFilters);
        }
        setFeedback({ type: "error", message: data.message ?? "Falha ao salvar tipo de atividade." });
        return;
      }

      setFeedback({ type: "success", message: data.message ?? "Tipo de atividade salvo com sucesso." });
      resetForm();
      await loadActivityTypes(1, activeFilters);
      setPage(1);
    } catch (error) {
      await logError("Falha ao salvar tipo de atividade.", error, { id: form.id, name: form.name });
      setFeedback({ type: "error", message: "Falha ao salvar tipo de atividade." });
    } finally {
      setIsSaving(false);
    }
  }

  async function confirmStatusChange() {
    if (!session?.accessToken || !statusActivityType || !statusReason.trim()) {
      return;
    }

    setIsChangingStatus(true);

    try {
      const response = await fetch("/api/activity-types", {
        method: "PATCH",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          id: statusActivityType.id,
          reason: statusReason.trim(),
          action: statusAction,
          expectedUpdatedAt: statusActivityType.updatedAt,
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
          await loadActivityTypes(page, activeFilters);
        }
        // O bloqueio por vinculo nao muda a lista, mas a mensagem fica atras do
        // overlay se o modal continuar aberto: fecha para o usuario ler o motivo.
        if (data.code === "TEAM_TYPE_IN_USE") {
          closeStatusModal();
        }
        setFeedback({ type: "error", message: data.message ?? "Falha ao atualizar status do tipo de atividade." });
        return;
      }

      setFeedback({ type: "success", message: data.message ?? "Status do tipo de atividade atualizado com sucesso." });
      if (form.id === statusActivityType.id) {
        resetForm();
      }
      closeStatusModal();
      await loadActivityTypes(page, activeFilters);
    } catch (error) {
      await logError("Falha ao atualizar status do tipo de atividade.", error, { id: statusActivityType.id });
      setFeedback({ type: "error", message: "Falha ao atualizar status do tipo de atividade." });
    } finally {
      setIsChangingStatus(false);
    }
  }

  async function handleExportActivityTypes() {
    if (!session?.accessToken) {
      setFeedback({ type: "error", message: "Sessao invalida para exportar tipos de atividade." });
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
      const allActivityTypes: ActivityTypeItem[] = [];
      let exportPage = 1;
      let totalItems = 0;

      while (true) {
        const query = buildQuery(activeFilters, exportPage, EXPORT_PAGE_SIZE, "export");
        const response = await fetch(`/api/activity-types?${query}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as ActivityTypesListResponse;
        if (!response.ok) {
          setFeedback({ type: "error", message: data.message ?? "Falha ao exportar tipos de atividade." });
          return;
        }

        const pageItems = data.activityTypes ?? [];
        allActivityTypes.push(...pageItems);
        totalItems = data.pagination?.total ?? allActivityTypes.length;
        if (allActivityTypes.length >= totalItems || pageItems.length === 0) {
          break;
        }
        exportPage += 1;
      }

      downloadCsvFile(buildActivityTypesCsv(allActivityTypes), "tipos_atividade.csv");
      setFeedback({ type: "success", message: `${allActivityTypes.length} tipo(s) de atividade exportado(s).` });
    } catch (error) {
      await logError("Falha ao exportar tipos de atividade.", error, { filters: activeFilters });
      setFeedback({ type: "error", message: "Falha ao exportar tipos de atividade." });
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
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>
              Nome <span className="requiredMark">*</span>
            </span>
            <input
              type="text"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Ex.: Manutencao"
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
          <h3 className={styles.cardTitle}>Lista de Tipos de Atividade</h3>
          <CsvExportButton
            className={styles.ghostButton}
            onClick={() => void handleExportActivityTypes()}
            isLoading={isExporting}
            disabled={isExporting || isLoadingList || exportCooldown.isCoolingDown}
          />
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Status</th>
                <th>Registrado em</th>
                <th>Atualizado em</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {activityTypes.length > 0 ? (
                activityTypes.map((activityType) => (
                  <tr key={activityType.id} className={!activityType.isActive ? styles.inactiveRow : undefined}>
                    <td>
                      <div className={styles.sobCell}>
                        <span>{activityType.name}</span>
                        {!activityType.isActive ? <span className={styles.statusTag}>Inativo</span> : null}
                      </div>
                    </td>
                    <td>{activityType.isActive ? "Ativo" : "Inativo"}</td>
                    <td>{formatDateTime(activityType.createdAt)}</td>
                    <td>{formatDateTime(activityType.updatedAt)}</td>
                    <td className={styles.actionsCell}>
                      <div className={styles.tableActions}>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${styles.actionView}`}
                          onClick={() => setDetailActivityType(activityType)}
                          title="Detalhes"
                          aria-label="Detalhes do tipo de atividade"
                        >
                          <ActionIcon name="details" />
                        </button>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${styles.actionEdit}`}
                          onClick={() => startEdit(activityType)}
                          title="Editar"
                          aria-label="Editar tipo de atividade"
                          disabled={!activityType.isActive}
                        >
                          <ActionIcon name="edit" />
                        </button>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${styles.actionHistory}`}
                          onClick={() => void openHistoryModal(activityType)}
                          title="Historico"
                          aria-label="Historico do tipo de atividade"
                        >
                          <ActionIcon name="history" />
                        </button>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${activityType.isActive ? styles.actionCancel : styles.actionActivate}`}
                          onClick={() => openStatusModal(activityType)}
                          title={activityType.isActive ? "Cancelar" : "Ativar"}
                          aria-label={activityType.isActive ? "Cancelar tipo de atividade" : "Ativar tipo de atividade"}
                        >
                          <ActionIcon name={activityType.isActive ? "cancel" : "activate"} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className={styles.emptyRow}>
                    {isLoadingList
                      ? "Carregando tipos de atividade..."
                      : "Nenhum tipo de atividade encontrado para os filtros informados."}
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

      {detailActivityType ? (
        <div className={styles.modalOverlay} onClick={() => setDetailActivityType(null)}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Detalhes do Tipo de Atividade {detailActivityType.name}</h4>
                <p className={styles.modalSubtitle}>ID do tipo: {detailActivityType.id}</p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={() => setDetailActivityType(null)}>
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              <div className={styles.detailGrid}>
                <div><strong>Status:</strong> {detailActivityType.isActive ? "Ativo" : "Inativo"}</div>
                <div><strong>Nome:</strong> {detailActivityType.name}</div>
                <div><strong>Registrado por:</strong> {formatAuditActor(detailActivityType.createdByName)}</div>
                <div><strong>Criado em:</strong> {formatDateTime(detailActivityType.createdAt)}</div>
                <div><strong>Atualizado por:</strong> {formatAuditActor(detailActivityType.updatedByName)}</div>
                <div><strong>Atualizado em:</strong> {formatDateTime(detailActivityType.updatedAt)}</div>
              </div>
            </div>
          </article>
        </div>
      ) : null}

      {historyActivityType ? (
        <div className={styles.modalOverlay} onClick={closeHistoryModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Historico do Tipo de Atividade {historyActivityType.name}</h4>
                <p className={styles.modalSubtitle}>ID do tipo: {historyActivityType.id}</p>
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
                        void loadActivityTypeHistory(historyActivityType, target);
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
                        void loadActivityTypeHistory(historyActivityType, target);
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

      {statusActivityType ? (
        <div className={styles.modalOverlay} onClick={closeStatusModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>{statusAction === "cancel" ? "Cancelar Tipo de Atividade" : "Ativar Tipo de Atividade"}</h4>
                <p className={styles.modalSubtitle}>Tipo: {statusActivityType.name}</p>
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
