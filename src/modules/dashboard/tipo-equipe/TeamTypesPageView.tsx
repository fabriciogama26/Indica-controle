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
import { buildTeamTypesCsv } from "./csv";

type TeamTypeItem = {
  id: string;
  name: string;
  teamCategoryId: string | null;
  teamCategoryName: string;
  isActive: boolean;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

type TeamTypeHistoryEntry = {
  id: string;
  changeType: "UPDATE" | "CANCEL" | "ACTIVATE";
  reason: string | null;
  createdAt: string;
  createdByName: string;
  changes: Record<string, { from: string | null; to: string | null }>;
};

type TeamTypeFormState = {
  id: string | null;
  updatedAt: string | null;
  name: string;
  teamCategoryId: string;
};

// Catalogo TECNICA/COMERCIAL. Chama-se `Tipo operacional` na UI, seguindo a
// nomenclatura fixada na tela Equipes -- `Tipo de equipe` e esta tela.
type TeamCategoryOption = {
  id: string;
  code: string;
  name: string;
};

type TeamTypeFilterState = {
  name: string;
  status: "" | "ativo" | "inativo";
};

type TeamTypesListResponse = {
  teamTypes?: TeamTypeItem[];
  teamCategories?: TeamCategoryOption[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

type TeamTypeHistoryResponse = {
  history?: TeamTypeHistoryEntry[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

const PAGE_SIZE = DEFAULT_PAGE_SIZE;
const HISTORY_PAGE_SIZE = DEFAULT_HISTORY_PAGE_SIZE;
const EXPORT_PAGE_SIZE = DEFAULT_EXPORT_PAGE_SIZE;

const INITIAL_FORM: TeamTypeFormState = {
  id: null,
  updatedAt: null,
  name: "",
  teamCategoryId: "",
};

const INITIAL_FILTERS: TeamTypeFilterState = {
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

function buildQuery(filters: TeamTypeFilterState, page: number, pageSize = PAGE_SIZE, mode?: "export") {
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

export function TeamTypesPageView() {
  const { session } = useAuth();
  const logError = useErrorLogger("tipo-equipe");
  const exportCooldown = useExportCooldown();
  const [form, setForm] = useState<TeamTypeFormState>(INITIAL_FORM);
  const [teamCategories, setTeamCategories] = useState<TeamCategoryOption[]>([]);
  const [filterDraft, setFilterDraft] = useState<TeamTypeFilterState>(INITIAL_FILTERS);
  const [activeFilters, setActiveFilters] = useState<TeamTypeFilterState>(INITIAL_FILTERS);
  const [teamTypes, setTeamTypes] = useState<TeamTypeItem[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isChangingStatus, setIsChangingStatus] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [detailTeamType, setDetailTeamType] = useState<TeamTypeItem | null>(null);
  const [historyTeamType, setHistoryTeamType] = useState<TeamTypeItem | null>(null);
  const [historyEntries, setHistoryEntries] = useState<TeamTypeHistoryEntry[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [statusTeamType, setStatusTeamType] = useState<TeamTypeItem | null>(null);
  const [statusReason, setStatusReason] = useState("");
  const { page, total, totalPages, setPage, setTotal } = usePagination({ pageSize: PAGE_SIZE });
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const historyTotalPages = Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE));
  const isEditing = Boolean(form.id);
  const statusAction = statusTeamType?.isActive ? "cancel" : "activate";
  const formTitle = useMemo(() => (isEditing ? "Editar Tipo de Equipe" : "Cadastro de Tipo de Equipe"), [isEditing]);
  const canSubmitStatusChange = Boolean(statusReason.trim()) && !isChangingStatus;

  const loadTeamTypes = useCallback(
    async (targetPage: number, filters: TeamTypeFilterState, pageSize = PAGE_SIZE, mode?: "export") => {
      if (!session?.accessToken) {
        return [] as TeamTypeItem[];
      }

      setIsLoadingList(true);
      try {
        const query = buildQuery(filters, targetPage, pageSize, mode);
        const response = await fetch(`/api/team-types?${query}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as TeamTypesListResponse;
        if (!response.ok) {
          setTeamTypes([]);
          setTotal(0);
          setFeedback({ type: "error", message: data.message ?? "Falha ao carregar tipos de equipe." });
          return [] as TeamTypeItem[];
        }

        const nextTeamTypes = data.teamTypes ?? [];
        if (!mode) {
          setTeamCategories(data.teamCategories ?? []);
          setTeamTypes(nextTeamTypes);
          setTotal(data.pagination?.total ?? 0);
        }
        return nextTeamTypes;
      } catch (error) {
        await logError("Falha ao carregar tipos de equipe.", error, { page: targetPage, filters });
        setTeamTypes([]);
        setTotal(0);
        setFeedback({ type: "error", message: "Falha ao carregar tipos de equipe." });
        return [] as TeamTypeItem[];
      } finally {
        setIsLoadingList(false);
      }
    },
    [logError, session?.accessToken, setTotal],
  );

  const loadTeamTypeHistory = useCallback(
    async (teamType: TeamTypeItem, targetPage: number) => {
      if (!session?.accessToken) {
        setFeedback({ type: "error", message: "Sessao invalida para carregar historico." });
        return;
      }

      setIsLoadingHistory(true);
      try {
        const params = new URLSearchParams();
        params.set("historyTeamTypeId", teamType.id);
        params.set("historyPage", String(targetPage));
        params.set("historyPageSize", String(HISTORY_PAGE_SIZE));

        const response = await fetch(`/api/team-types?${params.toString()}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as TeamTypeHistoryResponse;
        if (!response.ok) {
          setFeedback({ type: "error", message: data.message ?? "Falha ao carregar historico do tipo de equipe." });
          setHistoryEntries([]);
          setHistoryTotal(0);
          return;
        }

        setHistoryEntries(data.history ?? []);
        setHistoryPage(data.pagination?.page ?? targetPage);
        setHistoryTotal(data.pagination?.total ?? 0);
      } catch (error) {
        await logError("Falha ao carregar historico do tipo de equipe.", error, { teamTypeId: teamType.id });
        setFeedback({ type: "error", message: "Falha ao carregar historico do tipo de equipe." });
        setHistoryEntries([]);
        setHistoryTotal(0);
      } finally {
        setIsLoadingHistory(false);
      }
    },
    [logError, session?.accessToken],
  );

  useEffect(() => {
    void loadTeamTypes(page, activeFilters);
  }, [activeFilters, loadTeamTypes, page]);

  function resetForm() {
    setForm(INITIAL_FORM);
  }

  function updateFilterField(field: keyof TeamTypeFilterState, value: string) {
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

  function startEdit(teamType: TeamTypeItem) {
    setForm({
      id: teamType.id,
      updatedAt: teamType.updatedAt,
      name: teamType.name,
      teamCategoryId: teamType.teamCategoryId ?? "",
    });
    setFeedback(null);
    scrollDashboardContentToTop();
  }

  function closeHistoryModal() {
    setHistoryTeamType(null);
    setHistoryEntries([]);
    setHistoryPage(1);
    setHistoryTotal(0);
    setIsLoadingHistory(false);
  }

  async function openHistoryModal(teamType: TeamTypeItem) {
    setHistoryTeamType(teamType);
    setHistoryEntries([]);
    setHistoryPage(1);
    setHistoryTotal(0);
    await loadTeamTypeHistory(teamType, 1);
  }

  function openStatusModal(teamType: TeamTypeItem) {
    setStatusTeamType(teamType);
    setStatusReason("");
  }

  function closeStatusModal() {
    setStatusTeamType(null);
    setStatusReason("");
    setIsChangingStatus(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session?.accessToken) {
      setFeedback({ type: "error", message: "Sessao invalida para salvar tipo de equipe." });
      return;
    }

    setIsSaving(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/team-types", {
        method: form.id ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          id: form.id,
          name: normalizeText(form.name),
          teamCategoryId: normalizeText(form.teamCategoryId),
          ...(form.id ? { expectedUpdatedAt: form.updatedAt } : {}),
        }),
      });

      const data = (await response.json().catch(() => ({}))) as { success?: boolean; message?: string; code?: string };
      if (!response.ok || !data.success) {
        if (data.code === "CONCURRENT_MODIFICATION" || data.code === "RECORD_INACTIVE") {
          await loadTeamTypes(page, activeFilters);
        }
        setFeedback({ type: "error", message: data.message ?? "Falha ao salvar tipo de equipe." });
        return;
      }

      setFeedback({ type: "success", message: data.message ?? "Tipo de equipe salvo com sucesso." });
      resetForm();
      await loadTeamTypes(1, activeFilters);
      setPage(1);
    } catch (error) {
      await logError("Falha ao salvar tipo de equipe.", error, { id: form.id, name: form.name });
      setFeedback({ type: "error", message: "Falha ao salvar tipo de equipe." });
    } finally {
      setIsSaving(false);
    }
  }

  async function confirmStatusChange() {
    if (!session?.accessToken || !statusTeamType || !statusReason.trim()) {
      return;
    }

    setIsChangingStatus(true);

    try {
      const response = await fetch("/api/team-types", {
        method: "PATCH",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          id: statusTeamType.id,
          reason: statusReason.trim(),
          action: statusAction,
          expectedUpdatedAt: statusTeamType.updatedAt,
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
          await loadTeamTypes(page, activeFilters);
        }
        // O bloqueio por vinculo nao muda a lista, mas a mensagem fica atras do
        // overlay se o modal continuar aberto: fecha para o usuario ler o motivo.
        if (data.code === "TEAM_TYPE_IN_USE") {
          closeStatusModal();
        }
        setFeedback({ type: "error", message: data.message ?? "Falha ao atualizar status do tipo de equipe." });
        return;
      }

      setFeedback({ type: "success", message: data.message ?? "Status do tipo de equipe atualizado com sucesso." });
      if (form.id === statusTeamType.id) {
        resetForm();
      }
      closeStatusModal();
      await loadTeamTypes(page, activeFilters);
    } catch (error) {
      await logError("Falha ao atualizar status do tipo de equipe.", error, { id: statusTeamType.id });
      setFeedback({ type: "error", message: "Falha ao atualizar status do tipo de equipe." });
    } finally {
      setIsChangingStatus(false);
    }
  }

  async function handleExportTeamTypes() {
    if (!session?.accessToken) {
      setFeedback({ type: "error", message: "Sessao invalida para exportar tipos de equipe." });
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
      const allTeamTypes: TeamTypeItem[] = [];
      let exportPage = 1;
      let totalItems = 0;

      while (true) {
        const query = buildQuery(activeFilters, exportPage, EXPORT_PAGE_SIZE, "export");
        const response = await fetch(`/api/team-types?${query}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as TeamTypesListResponse;
        if (!response.ok) {
          setFeedback({ type: "error", message: data.message ?? "Falha ao exportar tipos de equipe." });
          return;
        }

        const pageItems = data.teamTypes ?? [];
        allTeamTypes.push(...pageItems);
        totalItems = data.pagination?.total ?? allTeamTypes.length;
        if (allTeamTypes.length >= totalItems || pageItems.length === 0) {
          break;
        }
        exportPage += 1;
      }

      downloadCsvFile(buildTeamTypesCsv(allTeamTypes), "tipos_equipe.csv");
      setFeedback({ type: "success", message: `${allTeamTypes.length} tipo(s) de equipe exportado(s).` });
    } catch (error) {
      await logError("Falha ao exportar tipos de equipe.", error, { filters: activeFilters });
      setFeedback({ type: "error", message: "Falha ao exportar tipos de equipe." });
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

          <label className={styles.field}>
            <span>
              Tipo operacional <span className="requiredMark">*</span>
            </span>
            <select
              value={form.teamCategoryId}
              onChange={(event) => setForm((current) => ({ ...current, teamCategoryId: event.target.value }))}
              required
            >
              <option value="" disabled>
                Selecione
              </option>
              {teamCategories.map((teamCategory) => (
                <option key={teamCategory.id} value={teamCategory.id}>
                  {teamCategory.name}
                </option>
              ))}
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
          <h3 className={styles.cardTitle}>Lista de Tipos de Equipe</h3>
          <CsvExportButton
            className={styles.ghostButton}
            onClick={() => void handleExportTeamTypes()}
            isLoading={isExporting}
            disabled={isExporting || isLoadingList || exportCooldown.isCoolingDown}
          />
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Tipo operacional</th>
                <th>Status</th>
                <th>Registrado em</th>
                <th>Atualizado em</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {teamTypes.length > 0 ? (
                teamTypes.map((teamType) => (
                  <tr key={teamType.id} className={!teamType.isActive ? styles.inactiveRow : undefined}>
                    <td>
                      <div className={styles.sobCell}>
                        <span>{teamType.name}</span>
                        {!teamType.isActive ? <span className={styles.statusTag}>Inativo</span> : null}
                      </div>
                    </td>
                    <td>{teamType.teamCategoryName}</td>
                    <td>{teamType.isActive ? "Ativo" : "Inativo"}</td>
                    <td>{formatDateTime(teamType.createdAt)}</td>
                    <td>{formatDateTime(teamType.updatedAt)}</td>
                    <td className={styles.actionsCell}>
                      <div className={styles.tableActions}>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${styles.actionView}`}
                          onClick={() => setDetailTeamType(teamType)}
                          title="Detalhes"
                          aria-label="Detalhes do tipo de equipe"
                        >
                          <ActionIcon name="details" />
                        </button>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${styles.actionEdit}`}
                          onClick={() => startEdit(teamType)}
                          title="Editar"
                          aria-label="Editar tipo de equipe"
                          disabled={!teamType.isActive}
                        >
                          <ActionIcon name="edit" />
                        </button>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${styles.actionHistory}`}
                          onClick={() => void openHistoryModal(teamType)}
                          title="Historico"
                          aria-label="Historico do tipo de equipe"
                        >
                          <ActionIcon name="history" />
                        </button>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${teamType.isActive ? styles.actionCancel : styles.actionActivate}`}
                          onClick={() => openStatusModal(teamType)}
                          title={teamType.isActive ? "Cancelar" : "Ativar"}
                          aria-label={teamType.isActive ? "Cancelar tipo de equipe" : "Ativar tipo de equipe"}
                        >
                          <ActionIcon name={teamType.isActive ? "cancel" : "activate"} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className={styles.emptyRow}>
                    {isLoadingList
                      ? "Carregando tipos de equipe..."
                      : "Nenhum tipo de equipe encontrado para os filtros informados."}
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

      {detailTeamType ? (
        <div className={styles.modalOverlay} onClick={() => setDetailTeamType(null)}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Detalhes do Tipo de Equipe {detailTeamType.name}</h4>
                <p className={styles.modalSubtitle}>ID do tipo: {detailTeamType.id}</p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={() => setDetailTeamType(null)}>
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              <div className={styles.detailGrid}>
                <div><strong>Status:</strong> {detailTeamType.isActive ? "Ativo" : "Inativo"}</div>
                <div><strong>Nome:</strong> {detailTeamType.name}</div>
                <div><strong>Registrado por:</strong> {formatAuditActor(detailTeamType.createdByName)}</div>
                <div><strong>Criado em:</strong> {formatDateTime(detailTeamType.createdAt)}</div>
                <div><strong>Atualizado por:</strong> {formatAuditActor(detailTeamType.updatedByName)}</div>
                <div><strong>Atualizado em:</strong> {formatDateTime(detailTeamType.updatedAt)}</div>
              </div>
            </div>
          </article>
        </div>
      ) : null}

      {historyTeamType ? (
        <div className={styles.modalOverlay} onClick={closeHistoryModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Historico do Tipo de Equipe {historyTeamType.name}</h4>
                <p className={styles.modalSubtitle}>ID do tipo: {historyTeamType.id}</p>
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
                        void loadTeamTypeHistory(historyTeamType, target);
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
                        void loadTeamTypeHistory(historyTeamType, target);
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

      {statusTeamType ? (
        <div className={styles.modalOverlay} onClick={closeStatusModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>{statusAction === "cancel" ? "Cancelar Tipo de Equipe" : "Ativar Tipo de Equipe"}</h4>
                <p className={styles.modalSubtitle}>Tipo: {statusTeamType.name}</p>
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
