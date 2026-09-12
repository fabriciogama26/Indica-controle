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
import { buildMunicipalitiesCsv } from "./csv";

type MunicipalityItem = {
  id: string;
  name: string;
  isActive: boolean;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

type MunicipalityHistoryEntry = {
  id: string;
  changeType: "UPDATE" | "CANCEL" | "ACTIVATE";
  reason: string | null;
  createdAt: string;
  createdByName: string;
  changes: Record<string, { from: string | null; to: string | null }>;
};

type MunicipalityFormState = {
  id: string | null;
  updatedAt: string | null;
  name: string;
};

type MunicipalityFilterState = {
  name: string;
  status: "" | "ativo" | "inativo";
};

type MunicipalitiesListResponse = {
  municipalities?: MunicipalityItem[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

type MunicipalityHistoryResponse = {
  history?: MunicipalityHistoryEntry[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

const PAGE_SIZE = DEFAULT_PAGE_SIZE;
const HISTORY_PAGE_SIZE = DEFAULT_HISTORY_PAGE_SIZE;
const EXPORT_PAGE_SIZE = DEFAULT_EXPORT_PAGE_SIZE;

const INITIAL_FORM: MunicipalityFormState = {
  id: null,
  updatedAt: null,
  name: "",
};

const INITIAL_FILTERS: MunicipalityFilterState = {
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

function buildQuery(filters: MunicipalityFilterState, page: number, pageSize = PAGE_SIZE, mode?: "export") {
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

export function MunicipalitiesPageView() {
  const { session } = useAuth();
  const logError = useErrorLogger("municipio");
  const exportCooldown = useExportCooldown();
  const [form, setForm] = useState<MunicipalityFormState>(INITIAL_FORM);
  const [filterDraft, setFilterDraft] = useState<MunicipalityFilterState>(INITIAL_FILTERS);
  const [activeFilters, setActiveFilters] = useState<MunicipalityFilterState>(INITIAL_FILTERS);
  const [municipalities, setMunicipalities] = useState<MunicipalityItem[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isChangingStatus, setIsChangingStatus] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [detailMunicipality, setDetailMunicipality] = useState<MunicipalityItem | null>(null);
  const [historyMunicipality, setHistoryMunicipality] = useState<MunicipalityItem | null>(null);
  const [historyEntries, setHistoryEntries] = useState<MunicipalityHistoryEntry[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [statusMunicipality, setStatusMunicipality] = useState<MunicipalityItem | null>(null);
  const [statusReason, setStatusReason] = useState("");
  const { page, total, totalPages, setPage, setTotal } = usePagination({ pageSize: PAGE_SIZE });
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const historyTotalPages = Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE));
  const isEditing = Boolean(form.id);
  const statusAction = statusMunicipality?.isActive ? "cancel" : "activate";
  const formTitle = useMemo(() => (isEditing ? "Editar Municipio" : "Cadastro de Municipio"), [isEditing]);
  const canSubmitStatusChange = Boolean(statusReason.trim()) && !isChangingStatus;

  const loadMunicipalities = useCallback(
    async (targetPage: number, filters: MunicipalityFilterState, pageSize = PAGE_SIZE, mode?: "export") => {
      if (!session?.accessToken) {
        return [] as MunicipalityItem[];
      }

      setIsLoadingList(true);
      try {
        const query = buildQuery(filters, targetPage, pageSize, mode);
        const response = await fetch(`/api/municipalities?${query}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as MunicipalitiesListResponse;
        if (!response.ok) {
          setMunicipalities([]);
          setTotal(0);
          setFeedback({ type: "error", message: data.message ?? "Falha ao carregar municipios." });
          return [] as MunicipalityItem[];
        }

        const nextMunicipalities = data.municipalities ?? [];
        if (!mode) {
          setMunicipalities(nextMunicipalities);
          setTotal(data.pagination?.total ?? 0);
        }
        return nextMunicipalities;
      } catch (error) {
        await logError("Falha ao carregar municipios.", error, { page: targetPage, filters });
        setMunicipalities([]);
        setTotal(0);
        setFeedback({ type: "error", message: "Falha ao carregar municipios." });
        return [] as MunicipalityItem[];
      } finally {
        setIsLoadingList(false);
      }
    },
    [logError, session?.accessToken, setTotal],
  );

  const loadMunicipalityHistory = useCallback(
    async (municipality: MunicipalityItem, targetPage: number) => {
      if (!session?.accessToken) {
        setFeedback({ type: "error", message: "Sessao invalida para carregar historico." });
        return;
      }

      setIsLoadingHistory(true);
      try {
        const params = new URLSearchParams();
        params.set("historyMunicipalityId", municipality.id);
        params.set("historyPage", String(targetPage));
        params.set("historyPageSize", String(HISTORY_PAGE_SIZE));

        const response = await fetch(`/api/municipalities?${params.toString()}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as MunicipalityHistoryResponse;
        if (!response.ok) {
          setFeedback({ type: "error", message: data.message ?? "Falha ao carregar historico do Municipio." });
          setHistoryEntries([]);
          setHistoryTotal(0);
          return;
        }

        setHistoryEntries(data.history ?? []);
        setHistoryPage(data.pagination?.page ?? targetPage);
        setHistoryTotal(data.pagination?.total ?? 0);
      } catch (error) {
        await logError("Falha ao carregar historico do Municipio.", error, { municipalityId: municipality.id });
        setFeedback({ type: "error", message: "Falha ao carregar historico do Municipio." });
        setHistoryEntries([]);
        setHistoryTotal(0);
      } finally {
        setIsLoadingHistory(false);
      }
    },
    [logError, session?.accessToken],
  );

  useEffect(() => {
    void loadMunicipalities(page, activeFilters);
  }, [activeFilters, loadMunicipalities, page]);

  function resetForm() {
    setForm(INITIAL_FORM);
  }

  function updateFilterField(field: keyof MunicipalityFilterState, value: string) {
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

  function startEdit(municipality: MunicipalityItem) {
    setForm({
      id: municipality.id,
      updatedAt: municipality.updatedAt,
      name: municipality.name,
    });
    setFeedback(null);
    scrollDashboardContentToTop();
  }

  function closeHistoryModal() {
    setHistoryMunicipality(null);
    setHistoryEntries([]);
    setHistoryPage(1);
    setHistoryTotal(0);
    setIsLoadingHistory(false);
  }

  async function openHistoryModal(municipality: MunicipalityItem) {
    setHistoryMunicipality(municipality);
    setHistoryEntries([]);
    setHistoryPage(1);
    setHistoryTotal(0);
    await loadMunicipalityHistory(municipality, 1);
  }

  function openStatusModal(municipality: MunicipalityItem) {
    setStatusMunicipality(municipality);
    setStatusReason("");
  }

  function closeStatusModal() {
    setStatusMunicipality(null);
    setStatusReason("");
    setIsChangingStatus(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session?.accessToken) {
      setFeedback({ type: "error", message: "Sessao invalida para salvar Municipio." });
      return;
    }

    setIsSaving(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/municipalities", {
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
          await loadMunicipalities(page, activeFilters);
        }
        setFeedback({ type: "error", message: data.message ?? "Falha ao salvar Municipio." });
        return;
      }

      setFeedback({ type: "success", message: data.message ?? "Municipio salvo com sucesso." });
      resetForm();
      await loadMunicipalities(1, activeFilters);
      setPage(1);
    } catch (error) {
      await logError("Falha ao salvar Municipio.", error, { id: form.id, name: form.name });
      setFeedback({ type: "error", message: "Falha ao salvar Municipio." });
    } finally {
      setIsSaving(false);
    }
  }

  async function confirmStatusChange() {
    if (!session?.accessToken || !statusMunicipality || !statusReason.trim()) {
      return;
    }

    setIsChangingStatus(true);

    try {
      const response = await fetch("/api/municipalities", {
        method: "PATCH",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          id: statusMunicipality.id,
          reason: statusReason.trim(),
          action: statusAction,
          expectedUpdatedAt: statusMunicipality.updatedAt,
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
          await loadMunicipalities(page, activeFilters);
        }
        setFeedback({ type: "error", message: data.message ?? "Falha ao atualizar status do Municipio." });
        return;
      }

      setFeedback({ type: "success", message: data.message ?? "Status do Municipio atualizado com sucesso." });
      if (form.id === statusMunicipality.id) {
        resetForm();
      }
      closeStatusModal();
      await loadMunicipalities(page, activeFilters);
    } catch (error) {
      await logError("Falha ao atualizar status do Municipio.", error, { id: statusMunicipality.id });
      setFeedback({ type: "error", message: "Falha ao atualizar status do Municipio." });
    } finally {
      setIsChangingStatus(false);
    }
  }

  async function handleExportMunicipalities() {
    if (!session?.accessToken) {
      setFeedback({ type: "error", message: "Sessao invalida para exportar municipios." });
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
      const allMunicipalities: MunicipalityItem[] = [];
      let exportPage = 1;
      let totalItems = 0;

      while (true) {
        const query = buildQuery(activeFilters, exportPage, EXPORT_PAGE_SIZE, "export");
        const response = await fetch(`/api/municipalities?${query}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as MunicipalitiesListResponse;
        if (!response.ok) {
          setFeedback({ type: "error", message: data.message ?? "Falha ao exportar municipios." });
          return;
        }

        const pageItems = data.municipalities ?? [];
        allMunicipalities.push(...pageItems);
        totalItems = data.pagination?.total ?? allMunicipalities.length;
        if (allMunicipalities.length >= totalItems || pageItems.length === 0) {
          break;
        }
        exportPage += 1;
      }

      downloadCsvFile(buildMunicipalitiesCsv(allMunicipalities), "municipios.csv");
      setFeedback({ type: "success", message: `${allMunicipalities.length} municipio(s) exportado(s).` });
    } catch (error) {
      await logError("Falha ao exportar municipios.", error, { filters: activeFilters });
      setFeedback({ type: "error", message: "Falha ao exportar municipios." });
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
              placeholder="Ex.: Base Norte"
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
          <h3 className={styles.cardTitle}>Lista de municipios</h3>
          <CsvExportButton
            className={styles.ghostButton}
            onClick={() => void handleExportMunicipalities()}
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
              {municipalities.length > 0 ? (
                municipalities.map((municipality) => (
                  <tr key={municipality.id} className={!municipality.isActive ? styles.inactiveRow : undefined}>
                    <td>
                      <div className={styles.sobCell}>
                        <span>{municipality.name}</span>
                        {!municipality.isActive ? <span className={styles.statusTag}>Inativo</span> : null}
                      </div>
                    </td>
                    <td>{municipality.isActive ? "Ativo" : "Inativo"}</td>
                    <td>{formatDateTime(municipality.createdAt)}</td>
                    <td>{formatDateTime(municipality.updatedAt)}</td>
                    <td className={styles.actionsCell}>
                      <div className={styles.tableActions}>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${styles.actionView}`}
                          onClick={() => setDetailMunicipality(municipality)}
                          title="Detalhes"
                          aria-label="Detalhes do Municipio"
                        >
                          <ActionIcon name="details" />
                        </button>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${styles.actionEdit}`}
                          onClick={() => startEdit(municipality)}
                          title="Editar"
                          aria-label="Editar Municipio"
                          disabled={!municipality.isActive}
                        >
                          <ActionIcon name="edit" />
                        </button>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${styles.actionHistory}`}
                          onClick={() => void openHistoryModal(municipality)}
                          title="Historico"
                          aria-label="Historico do Municipio"
                        >
                          <ActionIcon name="history" />
                        </button>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${municipality.isActive ? styles.actionCancel : styles.actionActivate}`}
                          onClick={() => openStatusModal(municipality)}
                          title={municipality.isActive ? "Cancelar" : "Ativar"}
                          aria-label={municipality.isActive ? "Cancelar Municipio" : "Ativar Municipio"}
                        >
                          <ActionIcon name={municipality.isActive ? "cancel" : "activate"} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className={styles.emptyRow}>
                    {isLoadingList ? "Carregando municipios..." : "Nenhum Municipio encontrado para os filtros informados."}
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

      {detailMunicipality ? (
        <div className={styles.modalOverlay} onClick={() => setDetailMunicipality(null)}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Detalhes do Municipio {detailMunicipality.name}</h4>
                <p className={styles.modalSubtitle}>ID do municipio: {detailMunicipality.id}</p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={() => setDetailMunicipality(null)}>
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              <div className={styles.detailGrid}>
                <div><strong>Status:</strong> {detailMunicipality.isActive ? "Ativo" : "Inativo"}</div>
                <div><strong>Nome:</strong> {detailMunicipality.name}</div>
                <div><strong>Registrado por:</strong> {formatAuditActor(detailMunicipality.createdByName)}</div>
                <div><strong>Criado em:</strong> {formatDateTime(detailMunicipality.createdAt)}</div>
                <div><strong>Atualizado por:</strong> {formatAuditActor(detailMunicipality.updatedByName)}</div>
                <div><strong>Atualizado em:</strong> {formatDateTime(detailMunicipality.updatedAt)}</div>
              </div>
            </div>
          </article>
        </div>
      ) : null}

      {historyMunicipality ? (
        <div className={styles.modalOverlay} onClick={closeHistoryModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Historico do Municipio {historyMunicipality.name}</h4>
                <p className={styles.modalSubtitle}>ID do municipio: {historyMunicipality.id}</p>
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
                        void loadMunicipalityHistory(historyMunicipality, target);
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
                        void loadMunicipalityHistory(historyMunicipality, target);
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

      {statusMunicipality ? (
        <div className={styles.modalOverlay} onClick={closeStatusModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>{statusAction === "cancel" ? "Cancelar Municipio" : "Ativar Municipio"}</h4>
                <p className={styles.modalSubtitle}>Municipio: {statusMunicipality.name}</p>
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
