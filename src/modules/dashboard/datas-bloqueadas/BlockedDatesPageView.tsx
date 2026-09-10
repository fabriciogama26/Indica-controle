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
import { formatBlockedDateShort } from "./blockedDates";
import { buildBlockedDatesCsv } from "./csv";
import {
  BLOCKED_DATE_KIND_LABELS,
  BLOCKED_DATE_SCOPE_LABELS,
  type BlockedDateItem,
  type BlockedDateKind,
  type BlockedDateMunicipalityOption,
  type BlockedDateScope,
} from "./types";

type BlockedDateHistoryEntry = {
  id: string;
  changeType: "UPDATE" | "CANCEL" | "ACTIVATE";
  reason: string | null;
  createdAt: string;
  createdByName: string;
  changes: Record<string, { from: string | null; to: string | null }>;
};

type BlockedDateFormState = {
  id: string | null;
  updatedAt: string | null;
  blockedDate: string;
  description: string;
  scope: BlockedDateScope;
  municipalityId: string;
  kind: BlockedDateKind;
};

type BlockedDateFilterState = {
  description: string;
  scope: "" | BlockedDateScope;
  dateFrom: string;
  dateTo: string;
  status: "" | "ativo" | "inativo";
};

type BlockedDatesListResponse = {
  blockedDates?: BlockedDateItem[];
  municipalities?: BlockedDateMunicipalityOption[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

type BlockedDateHistoryResponse = {
  history?: BlockedDateHistoryEntry[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

const PAGE_SIZE = DEFAULT_PAGE_SIZE;
const HISTORY_PAGE_SIZE = DEFAULT_HISTORY_PAGE_SIZE;
const EXPORT_PAGE_SIZE = DEFAULT_EXPORT_PAGE_SIZE;

const INITIAL_FORM: BlockedDateFormState = {
  id: null,
  updatedAt: null,
  blockedDate: "",
  description: "",
  scope: "NACIONAL",
  municipalityId: "",
  kind: "FERIADO",
};

const INITIAL_FILTERS: BlockedDateFilterState = {
  description: "",
  scope: "",
  dateFrom: "",
  dateTo: "",
  status: "",
};

const HISTORY_FIELD_LABELS: Record<string, string> = {
  blockedDate: "Data",
  description: "Descricao",
  scope: "Abrangencia",
  municipality: "Municipio",
  kind: "Tipo",
  isActive: "Status",
  cancellationReason: "Motivo do cancelamento",
  activationReason: "Motivo da ativacao",
};

function normalizeText(value: string) {
  return String(value ?? "").trim();
}

function buildQuery(filters: BlockedDateFilterState, page: number, pageSize = PAGE_SIZE, mode?: "export") {
  const params = new URLSearchParams();
  if (filters.description.trim()) {
    params.set("description", filters.description.trim());
  }
  if (filters.scope) {
    params.set("scope", filters.scope);
  }
  if (filters.dateFrom) {
    params.set("dateFrom", filters.dateFrom);
  }
  if (filters.dateTo) {
    params.set("dateTo", filters.dateTo);
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
  if (field === "scope") {
    return BLOCKED_DATE_SCOPE_LABELS[value as BlockedDateScope] ?? value;
  }
  if (field === "kind") {
    return BLOCKED_DATE_KIND_LABELS[value as BlockedDateKind] ?? value;
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

export function BlockedDatesPageView() {
  const { session } = useAuth();
  const logError = useErrorLogger("datas-bloqueadas");
  const exportCooldown = useExportCooldown();
  const [form, setForm] = useState<BlockedDateFormState>(INITIAL_FORM);
  const [filterDraft, setFilterDraft] = useState<BlockedDateFilterState>(INITIAL_FILTERS);
  const [activeFilters, setActiveFilters] = useState<BlockedDateFilterState>(INITIAL_FILTERS);
  const [blockedDates, setBlockedDates] = useState<BlockedDateItem[]>([]);
  const [municipalities, setMunicipalities] = useState<BlockedDateMunicipalityOption[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isChangingStatus, setIsChangingStatus] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [detailItem, setDetailItem] = useState<BlockedDateItem | null>(null);
  const [historyItem, setHistoryItem] = useState<BlockedDateItem | null>(null);
  const [historyEntries, setHistoryEntries] = useState<BlockedDateHistoryEntry[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [statusTarget, setStatusTarget] = useState<BlockedDateItem | null>(null);
  const [statusReason, setStatusReason] = useState("");
  const { page, total, totalPages, setPage, setTotal } = usePagination({ pageSize: PAGE_SIZE });
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const historyTotalPages = Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE));
  const isEditing = Boolean(form.id);
  const statusAction = statusTarget?.isActive ? "cancel" : "activate";
  const formTitle = useMemo(
    () => (isEditing ? "Editar Data Bloqueada" : "Cadastro de Data Bloqueada"),
    [isEditing],
  );
  const canSubmitStatusChange = Boolean(statusReason.trim()) && !isChangingStatus;
  const isMunicipalScope = form.scope === "MUNICIPAL";

  const loadBlockedDates = useCallback(
    async (targetPage: number, filters: BlockedDateFilterState, pageSize = PAGE_SIZE, mode?: "export") => {
      if (!session?.accessToken) {
        return [] as BlockedDateItem[];
      }

      setIsLoadingList(true);
      try {
        const query = buildQuery(filters, targetPage, pageSize, mode);
        const response = await fetch(`/api/blocked-dates?${query}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as BlockedDatesListResponse;
        if (!response.ok) {
          setBlockedDates([]);
          setTotal(0);
          setFeedback({ type: "error", message: data.message ?? "Falha ao carregar datas bloqueadas." });
          return [] as BlockedDateItem[];
        }

        const nextItems = data.blockedDates ?? [];
        if (!mode) {
          setBlockedDates(nextItems);
          setMunicipalities(data.municipalities ?? []);
          setTotal(data.pagination?.total ?? 0);
        }
        return nextItems;
      } catch (error) {
        await logError("Falha ao carregar datas bloqueadas.", error, { page: targetPage, filters });
        setBlockedDates([]);
        setTotal(0);
        setFeedback({ type: "error", message: "Falha ao carregar datas bloqueadas." });
        return [] as BlockedDateItem[];
      } finally {
        setIsLoadingList(false);
      }
    },
    [logError, session?.accessToken, setTotal],
  );

  const loadBlockedDateHistory = useCallback(
    async (item: BlockedDateItem, targetPage: number) => {
      if (!session?.accessToken) {
        setFeedback({ type: "error", message: "Sessao invalida para carregar historico." });
        return;
      }

      setIsLoadingHistory(true);
      try {
        const params = new URLSearchParams();
        params.set("historyBlockedDateId", item.id);
        params.set("historyPage", String(targetPage));
        params.set("historyPageSize", String(HISTORY_PAGE_SIZE));

        const response = await fetch(`/api/blocked-dates?${params.toString()}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as BlockedDateHistoryResponse;
        if (!response.ok) {
          setFeedback({ type: "error", message: data.message ?? "Falha ao carregar historico da data bloqueada." });
          setHistoryEntries([]);
          setHistoryTotal(0);
          return;
        }

        setHistoryEntries(data.history ?? []);
        setHistoryPage(data.pagination?.page ?? targetPage);
        setHistoryTotal(data.pagination?.total ?? 0);
      } catch (error) {
        await logError("Falha ao carregar historico da data bloqueada.", error, { blockedDateId: item.id });
        setFeedback({ type: "error", message: "Falha ao carregar historico da data bloqueada." });
        setHistoryEntries([]);
        setHistoryTotal(0);
      } finally {
        setIsLoadingHistory(false);
      }
    },
    [logError, session?.accessToken],
  );

  useEffect(() => {
    void loadBlockedDates(page, activeFilters);
  }, [activeFilters, loadBlockedDates, page]);

  function resetForm() {
    setForm(INITIAL_FORM);
  }

  function updateFilterField(field: keyof BlockedDateFilterState, value: string) {
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

  // Trocar para NACIONAL limpa o municipio no MESMO passo em que o select some
  // da tela. Sem isso o estado guardaria um municipio que a UI nao mostra mais.
  function changeScope(value: string) {
    const nextScope: BlockedDateScope = value === "MUNICIPAL" ? "MUNICIPAL" : "NACIONAL";
    setForm((current) => ({
      ...current,
      scope: nextScope,
      municipalityId: nextScope === "MUNICIPAL" ? current.municipalityId : "",
    }));
  }

  function startEdit(item: BlockedDateItem) {
    setForm({
      id: item.id,
      updatedAt: item.updatedAt,
      blockedDate: item.blockedDate,
      description: item.description,
      scope: item.scope,
      municipalityId: item.municipalityId ?? "",
      kind: item.kind,
    });
    setFeedback(null);
    scrollDashboardContentToTop();
  }

  function closeHistoryModal() {
    setHistoryItem(null);
    setHistoryEntries([]);
    setHistoryPage(1);
    setHistoryTotal(0);
    setIsLoadingHistory(false);
  }

  async function openHistoryModal(item: BlockedDateItem) {
    setHistoryItem(item);
    setHistoryEntries([]);
    setHistoryPage(1);
    setHistoryTotal(0);
    await loadBlockedDateHistory(item, 1);
  }

  function openStatusModal(item: BlockedDateItem) {
    setStatusTarget(item);
    setStatusReason("");
  }

  function closeStatusModal() {
    setStatusTarget(null);
    setStatusReason("");
    setIsChangingStatus(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session?.accessToken) {
      setFeedback({ type: "error", message: "Sessao invalida para salvar data bloqueada." });
      return;
    }

    if (form.scope === "MUNICIPAL" && !form.municipalityId) {
      setFeedback({ type: "error", message: "Informe o municipio da data bloqueada com abrangencia Municipal." });
      return;
    }

    setIsSaving(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/blocked-dates", {
        method: form.id ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          id: form.id,
          blockedDate: form.blockedDate,
          description: normalizeText(form.description),
          scope: form.scope,
          municipalityId: form.scope === "MUNICIPAL" ? form.municipalityId : null,
          kind: form.kind,
          ...(form.id ? { expectedUpdatedAt: form.updatedAt } : {}),
        }),
      });

      const data = (await response.json().catch(() => ({}))) as { success?: boolean; message?: string; code?: string };
      if (!response.ok || !data.success) {
        if (data.code === "CONCURRENT_MODIFICATION" || data.code === "RECORD_INACTIVE") {
          await loadBlockedDates(page, activeFilters);
        }
        setFeedback({ type: "error", message: data.message ?? "Falha ao salvar data bloqueada." });
        return;
      }

      setFeedback({ type: "success", message: data.message ?? "Data bloqueada salva com sucesso." });
      resetForm();
      await loadBlockedDates(1, activeFilters);
      setPage(1);
    } catch (error) {
      await logError("Falha ao salvar data bloqueada.", error, { id: form.id, blockedDate: form.blockedDate });
      setFeedback({ type: "error", message: "Falha ao salvar data bloqueada." });
    } finally {
      setIsSaving(false);
    }
  }

  async function confirmStatusChange() {
    if (!session?.accessToken || !statusTarget || !statusReason.trim()) {
      return;
    }

    setIsChangingStatus(true);

    try {
      const response = await fetch("/api/blocked-dates", {
        method: "PATCH",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          id: statusTarget.id,
          reason: statusReason.trim(),
          action: statusAction,
          expectedUpdatedAt: statusTarget.updatedAt,
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
          await loadBlockedDates(page, activeFilters);
        }
        setFeedback({ type: "error", message: data.message ?? "Falha ao atualizar status da data bloqueada." });
        return;
      }

      setFeedback({ type: "success", message: data.message ?? "Status da data bloqueada atualizado com sucesso." });
      if (form.id === statusTarget.id) {
        resetForm();
      }
      closeStatusModal();
      await loadBlockedDates(page, activeFilters);
    } catch (error) {
      await logError("Falha ao atualizar status da data bloqueada.", error, { id: statusTarget.id });
      setFeedback({ type: "error", message: "Falha ao atualizar status da data bloqueada." });
    } finally {
      setIsChangingStatus(false);
    }
  }

  async function handleExportBlockedDates() {
    if (!session?.accessToken) {
      setFeedback({ type: "error", message: "Sessao invalida para exportar datas bloqueadas." });
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
      const allItems: BlockedDateItem[] = [];
      let exportPage = 1;
      let totalItems = 0;

      while (true) {
        const query = buildQuery(activeFilters, exportPage, EXPORT_PAGE_SIZE, "export");
        const response = await fetch(`/api/blocked-dates?${query}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as BlockedDatesListResponse;
        if (!response.ok) {
          setFeedback({ type: "error", message: data.message ?? "Falha ao exportar datas bloqueadas." });
          return;
        }

        const pageItems = data.blockedDates ?? [];
        allItems.push(...pageItems);
        totalItems = data.pagination?.total ?? allItems.length;
        if (allItems.length >= totalItems || pageItems.length === 0) {
          break;
        }
        exportPage += 1;
      }

      downloadCsvFile(buildBlockedDatesCsv(allItems), "datas_bloqueadas.csv");
      setFeedback({ type: "success", message: `${allItems.length} data(s) bloqueada(s) exportada(s).` });
    } catch (error) {
      await logError("Falha ao exportar datas bloqueadas.", error, { filters: activeFilters });
      setFeedback({ type: "error", message: "Falha ao exportar datas bloqueadas." });
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
              Data <span className="requiredMark">*</span>
            </span>
            <input
              type="date"
              value={form.blockedDate}
              onChange={(event) => setForm((current) => ({ ...current, blockedDate: event.target.value }))}
              required
            />
          </label>

          <label className={styles.field}>
            <span>
              Descricao <span className="requiredMark">*</span>
            </span>
            <input
              type="text"
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="Ex.: Natal"
              required
            />
          </label>

          <label className={styles.field}>
            <span>
              Abrangencia <span className="requiredMark">*</span>
            </span>
            <select value={form.scope} onChange={(event) => changeScope(event.target.value)}>
              <option value="NACIONAL">Nacional</option>
              <option value="MUNICIPAL">Municipal</option>
            </select>
          </label>

          {isMunicipalScope ? (
            <label className={styles.field}>
              <span>
                Municipio <span className="requiredMark">*</span>
              </span>
              <select
                value={form.municipalityId}
                onChange={(event) => setForm((current) => ({ ...current, municipalityId: event.target.value }))}
                required
              >
                <option value="">Selecione o municipio</option>
                {municipalities.map((municipality) => (
                  <option key={municipality.id} value={municipality.id}>
                    {municipality.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className={styles.field}>
            <span>Tipo</span>
            <select
              value={form.kind}
              onChange={(event) =>
                setForm((current) => ({ ...current, kind: event.target.value as BlockedDateKind }))
              }
            >
              <option value="FERIADO">Feriado</option>
              <option value="PONTO_FACULTATIVO">Ponto facultativo</option>
              <option value="OUTRO">Outro</option>
            </select>
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
            <span>Descricao</span>
            <input
              type="text"
              value={filterDraft.description}
              onChange={(event) => updateFilterField("description", event.target.value)}
              placeholder="Filtrar por descricao"
            />
          </label>

          <label className={styles.field}>
            <span>Abrangencia</span>
            <select value={filterDraft.scope} onChange={(event) => updateFilterField("scope", event.target.value)}>
              <option value="">Todas</option>
              <option value="NACIONAL">Nacional</option>
              <option value="MUNICIPAL">Municipal</option>
            </select>
          </label>

          <label className={styles.field}>
            <span>Data inicial</span>
            <input
              type="date"
              value={filterDraft.dateFrom}
              onChange={(event) => updateFilterField("dateFrom", event.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span>Data final</span>
            <input
              type="date"
              value={filterDraft.dateTo}
              onChange={(event) => updateFilterField("dateTo", event.target.value)}
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
          <h3 className={styles.cardTitle}>Lista de Datas Bloqueadas</h3>
          <CsvExportButton
            className={styles.ghostButton}
            onClick={() => void handleExportBlockedDates()}
            isLoading={isExporting}
            disabled={isExporting || isLoadingList || exportCooldown.isCoolingDown}
          />
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Data</th>
                <th>Descricao</th>
                <th>Abrangencia</th>
                <th>Municipio</th>
                <th>Tipo</th>
                <th>Status</th>
                <th>Atualizado em</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {blockedDates.length > 0 ? (
                blockedDates.map((item) => (
                  <tr key={item.id} className={!item.isActive ? styles.inactiveRow : undefined}>
                    <td>{formatBlockedDateShort(item.blockedDate)}</td>
                    <td>
                      <div className={styles.sobCell}>
                        <span>{item.description}</span>
                        {!item.isActive ? <span className={styles.statusTag}>Inativo</span> : null}
                      </div>
                    </td>
                    <td>{BLOCKED_DATE_SCOPE_LABELS[item.scope] ?? item.scope}</td>
                    <td>{item.municipalityName || "-"}</td>
                    <td>{BLOCKED_DATE_KIND_LABELS[item.kind] ?? item.kind}</td>
                    <td>{item.isActive ? "Ativo" : "Inativo"}</td>
                    <td>{formatDateTime(item.updatedAt)}</td>
                    <td className={styles.actionsCell}>
                      <div className={styles.tableActions}>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${styles.actionView}`}
                          onClick={() => setDetailItem(item)}
                          title="Detalhes"
                          aria-label="Detalhes da data bloqueada"
                        >
                          <ActionIcon name="details" />
                        </button>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${styles.actionEdit}`}
                          onClick={() => startEdit(item)}
                          title="Editar"
                          aria-label="Editar data bloqueada"
                          disabled={!item.isActive}
                        >
                          <ActionIcon name="edit" />
                        </button>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${styles.actionHistory}`}
                          onClick={() => void openHistoryModal(item)}
                          title="Historico"
                          aria-label="Historico da data bloqueada"
                        >
                          <ActionIcon name="history" />
                        </button>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${item.isActive ? styles.actionCancel : styles.actionActivate}`}
                          onClick={() => openStatusModal(item)}
                          title={item.isActive ? "Cancelar" : "Ativar"}
                          aria-label={item.isActive ? "Cancelar data bloqueada" : "Ativar data bloqueada"}
                        >
                          <ActionIcon name={item.isActive ? "cancel" : "activate"} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className={styles.emptyRow}>
                    {isLoadingList
                      ? "Carregando datas bloqueadas..."
                      : "Nenhuma data bloqueada encontrada para os filtros informados."}
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

      {detailItem ? (
        <div className={styles.modalOverlay} onClick={() => setDetailItem(null)}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Detalhes da Data Bloqueada {formatBlockedDateShort(detailItem.blockedDate)}</h4>
                <p className={styles.modalSubtitle}>ID da data: {detailItem.id}</p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={() => setDetailItem(null)}>
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              <div className={styles.detailGrid}>
                <div><strong>Status:</strong> {detailItem.isActive ? "Ativo" : "Inativo"}</div>
                <div><strong>Data:</strong> {formatBlockedDateShort(detailItem.blockedDate)}</div>
                <div><strong>Descricao:</strong> {detailItem.description}</div>
                <div><strong>Abrangencia:</strong> {BLOCKED_DATE_SCOPE_LABELS[detailItem.scope] ?? detailItem.scope}</div>
                <div><strong>Municipio:</strong> {detailItem.municipalityName || "-"}</div>
                <div><strong>Tipo:</strong> {BLOCKED_DATE_KIND_LABELS[detailItem.kind] ?? detailItem.kind}</div>
                <div><strong>Registrado por:</strong> {formatAuditActor(detailItem.createdByName)}</div>
                <div><strong>Criado em:</strong> {formatDateTime(detailItem.createdAt)}</div>
                <div><strong>Atualizado por:</strong> {formatAuditActor(detailItem.updatedByName)}</div>
                <div><strong>Atualizado em:</strong> {formatDateTime(detailItem.updatedAt)}</div>
              </div>
            </div>
          </article>
        </div>
      ) : null}

      {historyItem ? (
        <div className={styles.modalOverlay} onClick={closeHistoryModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Historico da Data Bloqueada {formatBlockedDateShort(historyItem.blockedDate)}</h4>
                <p className={styles.modalSubtitle}>ID da data: {historyItem.id}</p>
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
                        void loadBlockedDateHistory(historyItem, target);
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
                        void loadBlockedDateHistory(historyItem, target);
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

      {statusTarget ? (
        <div className={styles.modalOverlay} onClick={closeStatusModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>{statusAction === "cancel" ? "Cancelar Data Bloqueada" : "Ativar Data Bloqueada"}</h4>
                <p className={styles.modalSubtitle}>
                  Data: {formatBlockedDateShort(statusTarget.blockedDate)} - {statusTarget.description}
                </p>
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
