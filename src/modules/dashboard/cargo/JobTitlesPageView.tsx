"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { ActionIcon } from "@/components/ui/ActionIcon";
import { CsvExportButton } from "@/components/ui/CsvExportButton";
import { Pagination } from "@/components/ui/Pagination";
import { useAuth } from "@/hooks/useAuth";
import { useErrorLogger } from "@/hooks/useErrorLogger";
import { useExportCooldown } from "@/hooks/useExportCooldown";
import { usePagination } from "@/hooks/usePagination";
import styles from "../pessoas/PeoplePageView.module.css";
import { downloadCsvFile, escapeCsvValue } from "@/lib/utils/csv";
import { formatAuditActor, formatDateTime } from "@/lib/utils/formatters";
import { DEFAULT_PAGE_SIZE, DEFAULT_EXPORT_PAGE_SIZE, DEFAULT_HISTORY_PAGE_SIZE } from "@/lib/constants/pagination";

type JobTitleItem = {
  id: string;
  code: string;
  name: string;
  types: Array<{ id: string; code: string; name: string; isActive: boolean }>;
  activeTypeNames: string[];
  activeLevelNames: string[];
  isActive: boolean;
  cancellationReason: string | null;
  canceledAt: string | null;
  canceledByName: string | null;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

type JobTitleHistoryEntry = {
  id: string;
  changeType: "UPDATE" | "CANCEL" | "ACTIVATE";
  reason: string | null;
  createdAt: string;
  createdByName: string;
  changes: Record<string, { from: string | null; to: string | null }>;
};

type JobTitleFormState = {
  id: string | null;
  updatedAt: string | null;
  code: string;
  name: string;
  typesText: string;
  levelsText: string;
};

type JobTitleFilterState = {
  code: string;
  name: string;
  status: "" | "ativo" | "inativo";
};

type JobTitlesListResponse = {
  jobTitles?: JobTitleItem[];
  activeLevels?: string[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

type JobTitleHistoryResponse = {
  history?: JobTitleHistoryEntry[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

const PAGE_SIZE = DEFAULT_PAGE_SIZE;
const HISTORY_PAGE_SIZE = DEFAULT_HISTORY_PAGE_SIZE;
const EXPORT_PAGE_SIZE = DEFAULT_EXPORT_PAGE_SIZE;

const INITIAL_FORM: JobTitleFormState = {
  id: null,
  updatedAt: null,
  code: "",
  name: "",
  typesText: "",
  levelsText: "",
};

const INITIAL_FILTERS: JobTitleFilterState = {
  code: "",
  name: "",
  status: "",
};

const HISTORY_FIELD_LABELS: Record<string, string> = {
  code: "Codigo",
  name: "Nome",
  types: "Tipos",
  levels: "Niveis",
  isActive: "Status",
  cancellationReason: "Motivo do cancelamento",
  canceledAt: "Data do cancelamento",
  activationReason: "Motivo da ativacao",
};

function normalizeText(value: string) {
  return String(value ?? "").trim();
}

function normalizeCode(value: string) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function splitLines(value: string) {
  return Array.from(
    new Map(
      String(value ?? "")
        .split(/\r?\n|;|,/g)
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => [item.toLocaleUpperCase("pt-BR"), item]),
    ).values(),
  );
}

function buildQuery(filters: JobTitleFilterState, page: number, pageSize = PAGE_SIZE) {
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
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  return params.toString();
}

function buildJobTitlesCsv(jobTitles: JobTitleItem[]) {
  const header = [
    "Codigo",
    "Nome",
    "Tipos ativos",
    "Niveis ativos",
    "Status",
    "Registrado por",
    "Registrado em",
    "Atualizado por",
    "Atualizado em",
  ];
  const rows = jobTitles.map((jobTitle) => [
    jobTitle.code,
    jobTitle.name,
    jobTitle.activeTypeNames.join(", "),
    jobTitle.activeLevelNames.join(", "),
    jobTitle.isActive ? "Ativo" : "Inativo",
    formatAuditActor(jobTitle.createdByName),
    formatDateTime(jobTitle.createdAt),
    formatAuditActor(jobTitle.updatedByName),
    formatDateTime(jobTitle.updatedAt),
  ]);

  const csvLines = [header, ...rows].map((line) => line.map((item) => escapeCsvValue(item)).join(";"));
  return `\uFEFF${csvLines.join("\n")}`;
}

function formatHistoryValue(field: string, value: string | null) {
  if (!value) {
    return "-";
  }
  if (field === "isActive") {
    return value === "true" ? "Ativo" : "Inativo";
  }
  if (field === "canceledAt") {
    return formatDateTime(value);
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

export function JobTitlesPageView() {
  const { session } = useAuth();
  const logError = useErrorLogger("cargo");
  const exportCooldown = useExportCooldown();
  const [form, setForm] = useState<JobTitleFormState>(INITIAL_FORM);
  const [filterDraft, setFilterDraft] = useState<JobTitleFilterState>(INITIAL_FILTERS);
  const [activeFilters, setActiveFilters] = useState<JobTitleFilterState>(INITIAL_FILTERS);
  const [jobTitles, setJobTitles] = useState<JobTitleItem[]>([]);
  const [activeLevels, setActiveLevels] = useState<string[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isChangingStatus, setIsChangingStatus] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [detailJobTitle, setDetailJobTitle] = useState<JobTitleItem | null>(null);
  const [historyJobTitle, setHistoryJobTitle] = useState<JobTitleItem | null>(null);
  const [historyEntries, setHistoryEntries] = useState<JobTitleHistoryEntry[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [statusJobTitle, setStatusJobTitle] = useState<JobTitleItem | null>(null);
  const [statusReason, setStatusReason] = useState("");
  const { page, total, totalPages, setPage, setTotal } = usePagination({ pageSize: PAGE_SIZE });
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const historyTotalPages = Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE));
  const isEditing = Boolean(form.id);
  const statusAction = statusJobTitle?.isActive ? "cancel" : "activate";
  const formTitle = useMemo(() => (isEditing ? "Editar Cargo" : "Cadastro de Cargos"), [isEditing]);
  const canSubmitStatusChange = Boolean(statusReason.trim()) && !isChangingStatus;

  const loadJobTitles = useCallback(
    async (targetPage: number, filters: JobTitleFilterState, pageSize = PAGE_SIZE) => {
      if (!session?.accessToken) {
        return [] as JobTitleItem[];
      }

      setIsLoadingList(true);
      try {
        const query = buildQuery(filters, targetPage, pageSize);
        const response = await fetch(`/api/job-titles?${query}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as JobTitlesListResponse;
        if (!response.ok) {
          setJobTitles([]);
          setTotal(0);
          setFeedback({ type: "error", message: data.message ?? "Falha ao carregar cargos." });
          return [] as JobTitleItem[];
        }

        const nextJobTitles = data.jobTitles ?? [];
        setJobTitles(nextJobTitles);
        setActiveLevels(data.activeLevels ?? []);
        setTotal(data.pagination?.total ?? 0);
        return nextJobTitles;
      } catch (error) {
        await logError("Falha ao carregar cargos.", error, { page: targetPage, filters });
        setJobTitles([]);
        setTotal(0);
        setFeedback({ type: "error", message: "Falha ao carregar cargos." });
        return [] as JobTitleItem[];
      } finally {
        setIsLoadingList(false);
      }
    },
    [logError, session?.accessToken, setTotal],
  );

  const loadJobTitleHistory = useCallback(
    async (jobTitle: JobTitleItem, targetPage: number) => {
      if (!session?.accessToken) {
        setFeedback({ type: "error", message: "Sessao invalida para carregar historico." });
        return;
      }

      setIsLoadingHistory(true);
      try {
        const params = new URLSearchParams();
        params.set("historyJobTitleId", jobTitle.id);
        params.set("historyPage", String(targetPage));
        params.set("historyPageSize", String(HISTORY_PAGE_SIZE));

        const response = await fetch(`/api/job-titles?${params.toString()}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as JobTitleHistoryResponse;
        if (!response.ok) {
          setFeedback({ type: "error", message: data.message ?? "Falha ao carregar historico do cargo." });
          setHistoryEntries([]);
          setHistoryTotal(0);
          return;
        }

        setHistoryEntries(data.history ?? []);
        setHistoryPage(data.pagination?.page ?? targetPage);
        setHistoryTotal(data.pagination?.total ?? 0);
      } catch (error) {
        await logError("Falha ao carregar historico do cargo.", error, { jobTitleId: jobTitle.id });
        setFeedback({ type: "error", message: "Falha ao carregar historico do cargo." });
        setHistoryEntries([]);
        setHistoryTotal(0);
      } finally {
        setIsLoadingHistory(false);
      }
    },
    [logError, session?.accessToken],
  );

  useEffect(() => {
    void loadJobTitles(page, activeFilters);
  }, [activeFilters, loadJobTitles, page]);

  function resetForm() {
    setForm((current) => ({
      ...INITIAL_FORM,
      levelsText: current.levelsText || activeLevels.join("\n"),
    }));
  }

  function updateFilterField(field: keyof JobTitleFilterState, value: string) {
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

  function startEdit(jobTitle: JobTitleItem) {
    setForm({
      id: jobTitle.id,
      updatedAt: jobTitle.updatedAt,
      code: jobTitle.code,
      name: jobTitle.name,
      typesText: jobTitle.activeTypeNames.join("\n"),
      levelsText: jobTitle.activeLevelNames.join("\n"),
    });
    setFeedback(null);
    scrollDashboardContentToTop();
  }

  function closeHistoryModal() {
    setHistoryJobTitle(null);
    setHistoryEntries([]);
    setHistoryPage(1);
    setHistoryTotal(0);
    setIsLoadingHistory(false);
  }

  async function openHistoryModal(jobTitle: JobTitleItem) {
    setHistoryJobTitle(jobTitle);
    setHistoryEntries([]);
    setHistoryPage(1);
    setHistoryTotal(0);
    await loadJobTitleHistory(jobTitle, 1);
  }

  function openStatusModal(jobTitle: JobTitleItem) {
    setStatusJobTitle(jobTitle);
    setStatusReason("");
  }

  function closeStatusModal() {
    setStatusJobTitle(null);
    setStatusReason("");
    setIsChangingStatus(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session?.accessToken) {
      setFeedback({ type: "error", message: "Sessao invalida para salvar cargo." });
      return;
    }

    const types = splitLines(form.typesText);
    const levels = splitLines(form.levelsText);
    if (types.length === 0) {
      setFeedback({ type: "error", message: "Informe ao menos um tipo para o cargo." });
      return;
    }

    setIsSaving(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/job-titles", {
        method: form.id ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          id: form.id,
          code: normalizeCode(form.code),
          name: normalizeText(form.name),
          types,
          levels,
          ...(form.id ? { expectedUpdatedAt: form.updatedAt } : {}),
        }),
      });

      const data = (await response.json().catch(() => ({}))) as { success?: boolean; message?: string; code?: string };
      if (!response.ok || !data.success) {
        if (data.code === "CONCURRENT_MODIFICATION" || data.code === "RECORD_INACTIVE") {
          resetForm();
          await loadJobTitles(page, activeFilters);
        }
        setFeedback({ type: "error", message: data.message ?? "Falha ao salvar cargo." });
        return;
      }

      setFeedback({ type: "success", message: data.message ?? "Cargo salvo com sucesso." });
      setForm({ ...INITIAL_FORM, levelsText: levels.join("\n") });
      await loadJobTitles(1, activeFilters);
      setPage(1);
    } catch (error) {
      await logError("Falha ao salvar cargo.", error, { id: form.id, code: form.code });
      setFeedback({ type: "error", message: "Falha ao salvar cargo." });
    } finally {
      setIsSaving(false);
    }
  }

  async function confirmStatusChange() {
    if (!session?.accessToken || !statusJobTitle || !statusReason.trim()) {
      return;
    }

    setIsChangingStatus(true);

    try {
      const response = await fetch("/api/job-titles", {
        method: "PATCH",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          id: statusJobTitle.id,
          reason: statusReason.trim(),
          action: statusAction,
          expectedUpdatedAt: statusJobTitle.updatedAt,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as { success?: boolean; message?: string; code?: string };
      if (!response.ok || !data.success) {
        if (
          data.code === "CONCURRENT_MODIFICATION"
          || data.code === "RECORD_INACTIVE"
          || data.code === "STATUS_ALREADY_CHANGED"
        ) {
          if (form.id === statusJobTitle.id) {
            resetForm();
          }
          closeStatusModal();
          await loadJobTitles(page, activeFilters);
        }

        setFeedback({ type: "error", message: data.message ?? "Falha ao atualizar status do cargo." });
        return;
      }

      setFeedback({ type: "success", message: data.message ?? "Status do cargo atualizado com sucesso." });
      if (form.id === statusJobTitle.id) {
        resetForm();
      }
      closeStatusModal();
      await loadJobTitles(page, activeFilters);
    } catch (error) {
      await logError("Falha ao atualizar status do cargo.", error, { id: statusJobTitle.id });
      setFeedback({ type: "error", message: "Falha ao atualizar status do cargo." });
    } finally {
      setIsChangingStatus(false);
    }
  }

  async function handleExportJobTitles() {
    if (!session?.accessToken) {
      setFeedback({ type: "error", message: "Sessao invalida para exportar cargos." });
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
      const allJobTitles: JobTitleItem[] = [];
      let exportPage = 1;
      let totalItems = 0;

      while (true) {
        const query = buildQuery(activeFilters, exportPage, EXPORT_PAGE_SIZE);
        const response = await fetch(`/api/job-titles?${query}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });
        const data = (await response.json().catch(() => ({}))) as JobTitlesListResponse;
        if (!response.ok) {
          setFeedback({ type: "error", message: data.message ?? "Falha ao exportar cargos." });
          return;
        }

        const pageItems = data.jobTitles ?? [];
        allJobTitles.push(...pageItems);
        totalItems = data.pagination?.total ?? allJobTitles.length;
        if (allJobTitles.length >= totalItems || pageItems.length === 0) {
          break;
        }
        exportPage += 1;
      }

      downloadCsvFile(buildJobTitlesCsv(allJobTitles), "cargos.csv");
      setFeedback({ type: "success", message: `${allJobTitles.length} cargo(s) exportado(s).` });
    } catch (error) {
      await logError("Falha ao exportar cargos.", error, { filters: activeFilters });
      setFeedback({ type: "error", message: "Falha ao exportar cargos." });
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
              placeholder="Ex.: ENCARREGADO"
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
              placeholder="Ex.: Encarregado"
              required
            />
          </label>

          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>
              Tipos do cargo <span className="requiredMark">*</span>
            </span>
            <textarea
              value={form.typesText}
              onChange={(event) => setForm((current) => ({ ...current, typesText: event.target.value }))}
              placeholder="Informe um tipo por linha"
              rows={4}
              required
            />
          </label>

          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Niveis ativos do tenant</span>
            <textarea
              value={form.levelsText}
              onChange={(event) => setForm((current) => ({ ...current, levelsText: event.target.value }))}
              placeholder={activeLevels.length > 0 ? "Informe um nivel por linha" : "Opcional"}
              rows={4}
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
          <h3 className={styles.cardTitle}>Lista de Cargos</h3>
          <CsvExportButton
            className={styles.ghostButton}
            onClick={() => void handleExportJobTitles()}
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
                <th>Tipos ativos</th>
                <th>Niveis ativos</th>
                <th>Registrado em</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {jobTitles.length > 0 ? (
                jobTitles.map((jobTitle) => (
                  <tr key={jobTitle.id} className={!jobTitle.isActive ? styles.inactiveRow : undefined}>
                    <td>
                      <div className={styles.sobCell}>
                        <span>{jobTitle.code}</span>
                        {!jobTitle.isActive ? <span className={styles.statusTag}>Inativo</span> : null}
                      </div>
                    </td>
                    <td>{jobTitle.name}</td>
                    <td>{jobTitle.activeTypeNames.length > 0 ? jobTitle.activeTypeNames.join(", ") : "-"}</td>
                    <td>{jobTitle.activeLevelNames.length > 0 ? jobTitle.activeLevelNames.join(", ") : "-"}</td>
                    <td>{formatDateTime(jobTitle.createdAt)}</td>
                    <td className={styles.actionsCell}>
                      <div className={styles.tableActions}>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${styles.actionView}`}
                          onClick={() => setDetailJobTitle(jobTitle)}
                          title="Detalhes"
                          aria-label="Detalhes do cargo"
                        >
                          <ActionIcon name="details" />
                        </button>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${styles.actionEdit}`}
                          onClick={() => startEdit(jobTitle)}
                          title="Editar"
                          aria-label="Editar cargo"
                          disabled={!jobTitle.isActive}
                        >
                          <ActionIcon name="edit" />
                        </button>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${styles.actionHistory}`}
                          onClick={() => void openHistoryModal(jobTitle)}
                          title="Historico"
                          aria-label="Historico do cargo"
                        >
                          <ActionIcon name="history" />
                        </button>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${jobTitle.isActive ? styles.actionCancel : styles.actionActivate}`}
                          onClick={() => openStatusModal(jobTitle)}
                          title={jobTitle.isActive ? "Cancelar" : "Ativar"}
                          aria-label={jobTitle.isActive ? "Cancelar cargo" : "Ativar cargo"}
                        >
                          <ActionIcon name={jobTitle.isActive ? "cancel" : "activate"} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className={styles.emptyRow}>
                    {isLoadingList ? "Carregando cargos..." : "Nenhum cargo encontrado para os filtros informados."}
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

      {detailJobTitle ? (
        <div className={styles.modalOverlay} onClick={() => setDetailJobTitle(null)}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Detalhes do Cargo {detailJobTitle.code}</h4>
                <p className={styles.modalSubtitle}>ID do cargo: {detailJobTitle.id}</p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={() => setDetailJobTitle(null)}>
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              <div className={styles.detailGrid}>
                <div><strong>Status:</strong> {detailJobTitle.isActive ? "Ativo" : "Inativo"}</div>
                <div><strong>Codigo:</strong> {detailJobTitle.code}</div>
                <div><strong>Nome:</strong> {detailJobTitle.name}</div>
                <div><strong>Tipos ativos:</strong> {detailJobTitle.activeTypeNames.join(", ") || "-"}</div>
                <div><strong>Niveis ativos:</strong> {detailJobTitle.activeLevelNames.join(", ") || "-"}</div>
                <div><strong>Registrado por:</strong> {formatAuditActor(detailJobTitle.createdByName)}</div>
                <div><strong>Criado em:</strong> {formatDateTime(detailJobTitle.createdAt)}</div>
                <div><strong>Atualizado por:</strong> {formatAuditActor(detailJobTitle.updatedByName)}</div>
                <div><strong>Atualizado em:</strong> {formatDateTime(detailJobTitle.updatedAt)}</div>
                {!detailJobTitle.isActive ? (
                  <>
                    <div><strong>Cancelado em:</strong> {formatDateTime(detailJobTitle.canceledAt)}</div>
                    <div><strong>Cancelado por:</strong> {detailJobTitle.canceledByName ?? "-"}</div>
                    <div className={styles.detailWide}>
                      <strong>Motivo do cancelamento:</strong> {detailJobTitle.cancellationReason ?? "-"}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </article>
        </div>
      ) : null}

      {historyJobTitle ? (
        <div className={styles.modalOverlay} onClick={closeHistoryModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Historico do Cargo {historyJobTitle.code}</h4>
                <p className={styles.modalSubtitle}>ID do cargo: {historyJobTitle.id}</p>
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
                        void loadJobTitleHistory(historyJobTitle, target);
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
                        void loadJobTitleHistory(historyJobTitle, target);
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

      {statusJobTitle ? (
        <div className={styles.modalOverlay} onClick={closeStatusModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>{statusAction === "cancel" ? "Cancelar Cargo" : "Ativar Cargo"}</h4>
                <p className={styles.modalSubtitle}>Cargo: {statusJobTitle.code}</p>
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
