"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { ActionIcon } from "@/components/ui/ActionIcon";
import { CsvExportButton } from "@/components/ui/CsvExportButton";
import { Pagination } from "@/components/ui/Pagination";
import { DEFAULT_EXPORT_PAGE_SIZE, DEFAULT_HISTORY_PAGE_SIZE, DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { downloadCsvFile } from "@/lib/utils/csv";
import { formatAuditActor, formatDateTime } from "@/lib/utils/formatters";
import { useAuth } from "@/hooks/useAuth";
import { useErrorLogger } from "@/hooks/useErrorLogger";
import { useExportCooldown } from "@/hooks/useExportCooldown";
import { usePagination } from "@/hooks/usePagination";
import baseStyles from "../pessoas/PeoplePageView.module.css";
import tabStyles from "./ResponsavelDistribuidoraPageView.module.css";
import { buildUtilityContactsCsv } from "./csv";

type UtilityContactKind = "responsible" | "fieldManager";

type UtilityContactItem = {
  id: string;
  kind: UtilityContactKind;
  name: string;
  telefoneCorporativo: string | null;
  email: string | null;
  isActive: boolean;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

type UtilityContactHistoryEntry = {
  id: string;
  changeType: "UPDATE" | "CANCEL" | "ACTIVATE";
  reason: string | null;
  createdAt: string;
  createdByName: string;
  changes: Record<string, { from: string | null; to: string | null }>;
};

type UtilityContactFormState = {
  id: string | null;
  updatedAt: string | null;
  name: string;
  telefoneCorporativo: string;
  email: string;
};

type UtilityContactFilterState = {
  name: string;
  status: "" | "ativo" | "inativo";
};

type UtilityContactsListResponse = {
  contacts?: UtilityContactItem[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

type UtilityContactHistoryResponse = {
  history?: UtilityContactHistoryEntry[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

type TabConfig = {
  kind: UtilityContactKind;
  title: string;
  formTitle: string;
  editTitle: string;
  listTitle: string;
  singularLabel: string;
  pluralLabel: string;
  csvFileName: string;
  placeholder: string;
};

const PAGE_SIZE = DEFAULT_PAGE_SIZE;
const HISTORY_PAGE_SIZE = DEFAULT_HISTORY_PAGE_SIZE;
const EXPORT_PAGE_SIZE = DEFAULT_EXPORT_PAGE_SIZE;

const TABS: Record<UtilityContactKind, TabConfig> = {
  responsible: {
    kind: "responsible",
    title: "Responsaveis Distribuidora",
    formTitle: "Cadastro de Responsavel Distribuidora",
    editTitle: "Editar Responsavel Distribuidora",
    listTitle: "Lista de Responsaveis Distribuidora",
    singularLabel: "responsavel da distribuidora",
    pluralLabel: "responsaveis da distribuidora",
    csvFileName: "responsaveis_distribuidora.csv",
    placeholder: "Ex.: Joao da Silva",
  },
  fieldManager: {
    kind: "fieldManager",
    title: "Gestores de campo",
    formTitle: "Cadastro de Gestor de campo Distribuidora",
    editTitle: "Editar Gestor de campo Distribuidora",
    listTitle: "Lista de Gestores de campo Distribuidora",
    singularLabel: "gestor de campo da distribuidora",
    pluralLabel: "gestores de campo da distribuidora",
    csvFileName: "gestores_campo_distribuidora.csv",
    placeholder: "Ex.: Maria da Silva",
  },
};

const INITIAL_FORM: UtilityContactFormState = {
  id: null,
  updatedAt: null,
  name: "",
  telefoneCorporativo: "",
  email: "",
};

const INITIAL_FILTERS: UtilityContactFilterState = {
  name: "",
  status: "",
};

const HISTORY_FIELD_LABELS: Record<string, string> = {
  name: "Nome",
  telefoneCorporativo: "Telefone corporativo",
  email: "E-mail",
  isActive: "Status",
  cancellationReason: "Motivo do cancelamento",
  activationReason: "Motivo da ativacao",
};

function normalizeText(value: string) {
  return String(value ?? "").trim();
}

function normalizePhone(value: string) {
  return String(value ?? "").replace(/\D/g, "");
}

function formatOptionalText(value: string | null | undefined) {
  const normalized = normalizeText(value ?? "");
  return normalized || "-";
}

function buildQuery(kind: UtilityContactKind, filters: UtilityContactFilterState, page: number, pageSize = PAGE_SIZE, mode?: "export") {
  const params = new URLSearchParams();
  params.set("kind", kind);
  if (filters.name.trim()) params.set("name", filters.name.trim());
  if (filters.status.trim()) params.set("status", filters.status.trim());
  if (mode) params.set("mode", mode);
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  return params.toString();
}

function formatHistoryValue(field: string, value: string | null) {
  if (!value) return "-";
  if (field === "isActive") return value === "true" ? "Ativo" : "Inativo";
  return value;
}

function scrollDashboardContentToTop() {
  if (typeof window === "undefined") return;

  const content = document.querySelector<HTMLElement>('[data-main-content-scroll="true"]');
  if (content) {
    content.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

export function ResponsavelDistribuidoraPageView() {
  const { session } = useAuth();
  const logError = useErrorLogger("responsavel-distribuidora");
  const exportCooldown = useExportCooldown();
  const [activeTab, setActiveTab] = useState<UtilityContactKind>("responsible");
  const [form, setForm] = useState<UtilityContactFormState>(INITIAL_FORM);
  const [filterDraft, setFilterDraft] = useState<UtilityContactFilterState>(INITIAL_FILTERS);
  const [activeFilters, setActiveFilters] = useState<UtilityContactFilterState>(INITIAL_FILTERS);
  const [contacts, setContacts] = useState<UtilityContactItem[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isChangingStatus, setIsChangingStatus] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [detailContact, setDetailContact] = useState<UtilityContactItem | null>(null);
  const [historyContact, setHistoryContact] = useState<UtilityContactItem | null>(null);
  const [historyEntries, setHistoryEntries] = useState<UtilityContactHistoryEntry[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [statusContact, setStatusContact] = useState<UtilityContactItem | null>(null);
  const [statusReason, setStatusReason] = useState("");
  const { page, total, totalPages, setPage, setTotal } = usePagination({ pageSize: PAGE_SIZE });
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const tabConfig = TABS[activeTab];
  const historyTotalPages = Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE));
  const isEditing = Boolean(form.id);
  const statusAction = statusContact?.isActive ? "cancel" : "activate";
  const formTitle = useMemo(() => (isEditing ? tabConfig.editTitle : tabConfig.formTitle), [isEditing, tabConfig]);
  const canSubmitStatusChange = Boolean(statusReason.trim()) && !isChangingStatus;

  const loadContacts = useCallback(
    async (kind: UtilityContactKind, targetPage: number, filters: UtilityContactFilterState, pageSize = PAGE_SIZE, mode?: "export") => {
      if (!session?.accessToken) return [] as UtilityContactItem[];

      setIsLoadingList(true);
      try {
        const query = buildQuery(kind, filters, targetPage, pageSize, mode);
        const response = await fetch(`/api/utility-distributor-contacts?${query}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as UtilityContactsListResponse;
        if (!response.ok) {
          setContacts([]);
          setTotal(0);
          setFeedback({ type: "error", message: data.message ?? "Falha ao carregar cadastros da distribuidora." });
          return [] as UtilityContactItem[];
        }

        const nextContacts = data.contacts ?? [];
        if (!mode) {
          setContacts(nextContacts);
          setTotal(data.pagination?.total ?? 0);
        }
        return nextContacts;
      } catch (error) {
        await logError("Falha ao carregar cadastros da distribuidora.", error, { kind, page: targetPage, filters });
        setContacts([]);
        setTotal(0);
        setFeedback({ type: "error", message: "Falha ao carregar cadastros da distribuidora." });
        return [] as UtilityContactItem[];
      } finally {
        setIsLoadingList(false);
      }
    },
    [logError, session?.accessToken, setTotal],
  );

  const loadContactHistory = useCallback(
    async (contact: UtilityContactItem, targetPage: number) => {
      if (!session?.accessToken) {
        setFeedback({ type: "error", message: "Sessao invalida para carregar historico." });
        return;
      }

      setIsLoadingHistory(true);
      try {
        const params = new URLSearchParams();
        params.set("kind", contact.kind);
        params.set("historyContactId", contact.id);
        params.set("historyPage", String(targetPage));
        params.set("historyPageSize", String(HISTORY_PAGE_SIZE));

        const response = await fetch(`/api/utility-distributor-contacts?${params.toString()}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as UtilityContactHistoryResponse;
        if (!response.ok) {
          setFeedback({ type: "error", message: data.message ?? "Falha ao carregar historico." });
          setHistoryEntries([]);
          setHistoryTotal(0);
          return;
        }

        setHistoryEntries(data.history ?? []);
        setHistoryPage(data.pagination?.page ?? targetPage);
        setHistoryTotal(data.pagination?.total ?? 0);
      } catch (error) {
        await logError("Falha ao carregar historico.", error, { kind: contact.kind, contactId: contact.id });
        setFeedback({ type: "error", message: "Falha ao carregar historico." });
        setHistoryEntries([]);
        setHistoryTotal(0);
      } finally {
        setIsLoadingHistory(false);
      }
    },
    [logError, session?.accessToken],
  );

  useEffect(() => {
    void loadContacts(activeTab, page, activeFilters);
  }, [activeFilters, activeTab, loadContacts, page]);

  function resetForm() {
    setForm(INITIAL_FORM);
  }

  function switchTab(kind: UtilityContactKind) {
    if (kind === activeTab) return;
    setActiveTab(kind);
    resetForm();
    setFilterDraft(INITIAL_FILTERS);
    setActiveFilters(INITIAL_FILTERS);
    setContacts([]);
    setTotal(0);
    setPage(1);
    setFeedback(null);
  }

  function updateFilterField(field: keyof UtilityContactFilterState, value: string) {
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

  function startEdit(contact: UtilityContactItem) {
    setForm({
      id: contact.id,
      updatedAt: contact.updatedAt,
      name: contact.name,
      telefoneCorporativo: contact.telefoneCorporativo ?? "",
      email: contact.email ?? "",
    });
    setFeedback(null);
    scrollDashboardContentToTop();
  }

  function closeHistoryModal() {
    setHistoryContact(null);
    setHistoryEntries([]);
    setHistoryPage(1);
    setHistoryTotal(0);
    setIsLoadingHistory(false);
  }

  async function openHistoryModal(contact: UtilityContactItem) {
    setHistoryContact(contact);
    setHistoryEntries([]);
    setHistoryPage(1);
    setHistoryTotal(0);
    await loadContactHistory(contact, 1);
  }

  function openStatusModal(contact: UtilityContactItem) {
    setStatusContact(contact);
    setStatusReason("");
  }

  function closeStatusModal() {
    setStatusContact(null);
    setStatusReason("");
    setIsChangingStatus(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session?.accessToken) {
      setFeedback({ type: "error", message: `Sessao invalida para salvar ${tabConfig.singularLabel}.` });
      return;
    }

    setIsSaving(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/utility-distributor-contacts", {
        method: form.id ? "PUT" : "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          kind: activeTab,
          id: form.id,
          name: normalizeText(form.name),
          telefoneCorporativo: normalizePhone(form.telefoneCorporativo) || null,
          email: normalizeText(form.email) || null,
          ...(form.id ? { expectedUpdatedAt: form.updatedAt } : {}),
        }),
      });

      const data = (await response.json().catch(() => ({}))) as { success?: boolean; message?: string; code?: string };
      if (!response.ok || !data.success) {
        if (data.code === "CONCURRENT_MODIFICATION" || data.code === "RECORD_INACTIVE") {
          await loadContacts(activeTab, page, activeFilters);
        }
        setFeedback({ type: "error", message: data.message ?? `Falha ao salvar ${tabConfig.singularLabel}.` });
        return;
      }

      setFeedback({ type: "success", message: data.message ?? `${tabConfig.singularLabel} salvo com sucesso.` });
      resetForm();
      await loadContacts(activeTab, 1, activeFilters);
      setPage(1);
    } catch (error) {
      await logError("Falha ao salvar cadastro da distribuidora.", error, { kind: activeTab, id: form.id, name: form.name });
      setFeedback({ type: "error", message: `Falha ao salvar ${tabConfig.singularLabel}.` });
    } finally {
      setIsSaving(false);
    }
  }

  async function confirmStatusChange() {
    if (!session?.accessToken || !statusContact || !statusReason.trim()) return;

    setIsChangingStatus(true);

    try {
      const response = await fetch("/api/utility-distributor-contacts", {
        method: "PATCH",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          kind: statusContact.kind,
          id: statusContact.id,
          reason: statusReason.trim(),
          action: statusAction,
          expectedUpdatedAt: statusContact.updatedAt,
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
          await loadContacts(activeTab, page, activeFilters);
        }
        setFeedback({ type: "error", message: data.message ?? "Falha ao atualizar status." });
        return;
      }

      setFeedback({ type: "success", message: data.message ?? "Status atualizado com sucesso." });
      if (form.id === statusContact.id) resetForm();
      closeStatusModal();
      await loadContacts(activeTab, page, activeFilters);
    } catch (error) {
      await logError("Falha ao atualizar status.", error, { kind: statusContact.kind, id: statusContact.id });
      setFeedback({ type: "error", message: "Falha ao atualizar status." });
    } finally {
      setIsChangingStatus(false);
    }
  }

  async function handleExportContacts() {
    if (!session?.accessToken) {
      setFeedback({ type: "error", message: "Sessao invalida para exportar cadastros da distribuidora." });
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
      const allContacts: UtilityContactItem[] = [];
      let exportPage = 1;
      let totalItems = 0;

      while (true) {
        const query = buildQuery(activeTab, activeFilters, exportPage, EXPORT_PAGE_SIZE, "export");
        const response = await fetch(`/api/utility-distributor-contacts?${query}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as UtilityContactsListResponse;
        if (!response.ok) {
          setFeedback({ type: "error", message: data.message ?? "Falha ao exportar cadastros da distribuidora." });
          return;
        }

        const pageItems = data.contacts ?? [];
        allContacts.push(...pageItems);
        totalItems = data.pagination?.total ?? allContacts.length;
        if (allContacts.length >= totalItems || pageItems.length === 0) break;
        exportPage += 1;
      }

      downloadCsvFile(buildUtilityContactsCsv(allContacts), tabConfig.csvFileName);
      setFeedback({ type: "success", message: `${allContacts.length} registro(s) exportado(s).` });
    } catch (error) {
      await logError("Falha ao exportar cadastros da distribuidora.", error, { kind: activeTab, filters: activeFilters });
      setFeedback({ type: "error", message: "Falha ao exportar cadastros da distribuidora." });
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <section className={baseStyles.wrapper}>
      <div className={tabStyles.tabHeader} role="tablist" aria-label="Cadastros da distribuidora">
        {Object.values(TABS).map((tab) => (
          <button
            key={tab.kind}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.kind}
            className={activeTab === tab.kind ? tabStyles.tabButtonActive : tabStyles.tabButton}
            onClick={() => switchTab(tab.kind)}
          >
            {tab.title}
          </button>
        ))}
      </div>

      {feedback ? (
        <div className={feedback.type === "success" ? baseStyles.feedbackSuccess : baseStyles.feedbackError}>
          {feedback.message}
        </div>
      ) : null}

      <article className={`${baseStyles.card} ${isEditing ? baseStyles.editingCard : ""}`}>
        <h3 className={baseStyles.cardTitle}>{formTitle}</h3>

        <form className={baseStyles.formGrid} onSubmit={(event) => void handleSubmit(event)}>
          <label className={`${baseStyles.field} ${baseStyles.fieldWide}`}>
            <span>
              Nome <span className="requiredMark">*</span>
            </span>
            <input
              type="text"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder={tabConfig.placeholder}
              required
            />
          </label>

          <label className={baseStyles.field}>
            <span>Telefone Corporativo</span>
            <input
              type="text"
              inputMode="numeric"
              value={form.telefoneCorporativo}
              onChange={(event) => setForm((current) => ({ ...current, telefoneCorporativo: event.target.value }))}
              placeholder="Somente numeros"
            />
          </label>

          <label className={baseStyles.field}>
            <span>E-mail</span>
            <input
              type="email"
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              placeholder="contato@distribuidora.com.br"
            />
          </label>

          <div className={`${baseStyles.actions} ${baseStyles.formActions}`}>
            {isEditing ? (
              <button type="button" className={baseStyles.ghostButton} onClick={resetForm} disabled={isSaving}>
                Cancelar
              </button>
            ) : null}
            <button type="submit" className={baseStyles.primaryButton} disabled={isSaving}>
              {isSaving ? "Salvando..." : isEditing ? "Atualizar" : "Cadastrar"}
            </button>
          </div>
        </form>
      </article>

      <article className={baseStyles.card}>
        <h3 className={baseStyles.cardTitle}>Filtros</h3>

        <div className={baseStyles.filterGrid}>
          <label className={baseStyles.field}>
            <span>Nome</span>
            <input
              type="text"
              value={filterDraft.name}
              onChange={(event) => updateFilterField("name", event.target.value)}
              placeholder="Filtrar por nome"
            />
          </label>

          <label className={baseStyles.field}>
            <span>Status</span>
            <select value={filterDraft.status} onChange={(event) => updateFilterField("status", event.target.value)}>
              <option value="">Todos</option>
              <option value="ativo">Ativo</option>
              <option value="inativo">Inativo</option>
            </select>
          </label>
        </div>

        <div className={baseStyles.actions}>
          <button type="button" className={baseStyles.secondaryButton} onClick={applyFilters} disabled={isLoadingList}>
            Aplicar
          </button>
          <button type="button" className={baseStyles.ghostButton} onClick={clearFilters} disabled={isLoadingList}>
            Limpar
          </button>
        </div>
      </article>

      <article className={baseStyles.card}>
        <div className={baseStyles.tableHeader}>
          <h3 className={baseStyles.cardTitle}>{tabConfig.listTitle}</h3>
          <CsvExportButton
            className={baseStyles.ghostButton}
            onClick={() => void handleExportContacts()}
            isLoading={isExporting}
            disabled={isExporting || isLoadingList || exportCooldown.isCoolingDown}
          />
        </div>

        <div className={baseStyles.tableWrapper}>
          <table className={baseStyles.table}>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Telefone Corporativo</th>
                <th>E-mail</th>
                <th>Status</th>
                <th>Registrado em</th>
                <th>Atualizado em</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {contacts.length > 0 ? (
                contacts.map((contact) => (
                  <tr key={contact.id} className={!contact.isActive ? baseStyles.inactiveRow : undefined}>
                    <td>
                      <div className={baseStyles.sobCell}>
                        <span>{contact.name}</span>
                        {!contact.isActive ? <span className={baseStyles.statusTag}>Inativo</span> : null}
                      </div>
                    </td>
                    <td>{formatOptionalText(contact.telefoneCorporativo)}</td>
                    <td>{formatOptionalText(contact.email)}</td>
                    <td>{contact.isActive ? "Ativo" : "Inativo"}</td>
                    <td>{formatDateTime(contact.createdAt)}</td>
                    <td>{formatDateTime(contact.updatedAt)}</td>
                    <td className={baseStyles.actionsCell}>
                      <div className={baseStyles.tableActions}>
                        <button
                          type="button"
                          className={`${baseStyles.actionButton} ${baseStyles.actionView}`}
                          onClick={() => setDetailContact(contact)}
                          title="Detalhes"
                          aria-label={`Detalhes do ${tabConfig.singularLabel}`}
                        >
                          <ActionIcon name="details" />
                        </button>
                        <button
                          type="button"
                          className={`${baseStyles.actionButton} ${baseStyles.actionEdit}`}
                          onClick={() => startEdit(contact)}
                          title="Editar"
                          aria-label={`Editar ${tabConfig.singularLabel}`}
                          disabled={!contact.isActive}
                        >
                          <ActionIcon name="edit" />
                        </button>
                        <button
                          type="button"
                          className={`${baseStyles.actionButton} ${baseStyles.actionHistory}`}
                          onClick={() => void openHistoryModal(contact)}
                          title="Historico"
                          aria-label={`Historico do ${tabConfig.singularLabel}`}
                        >
                          <ActionIcon name="history" />
                        </button>
                        <button
                          type="button"
                          className={`${baseStyles.actionButton} ${contact.isActive ? baseStyles.actionCancel : baseStyles.actionActivate}`}
                          onClick={() => openStatusModal(contact)}
                          title={contact.isActive ? "Cancelar" : "Ativar"}
                          aria-label={contact.isActive ? `Cancelar ${tabConfig.singularLabel}` : `Ativar ${tabConfig.singularLabel}`}
                        >
                          <ActionIcon name={contact.isActive ? "cancel" : "activate"} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className={baseStyles.emptyRow}>
                    {isLoadingList ? `Carregando ${tabConfig.pluralLabel}...` : `Nenhum ${tabConfig.singularLabel} encontrado para os filtros informados.`}
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
          className={baseStyles.pagination}
          actionsClassName={baseStyles.paginationActions}
          buttonClassName={baseStyles.ghostButton}
        />
      </article>

      {detailContact ? (
        <div className={baseStyles.modalOverlay} onClick={() => setDetailContact(null)}>
          <article className={baseStyles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={baseStyles.modalHeader}>
              <div className={baseStyles.modalTitleBlock}>
                <h4>Detalhes de {detailContact.name}</h4>
                <p className={baseStyles.modalSubtitle}>ID do registro: {detailContact.id}</p>
              </div>
              <button type="button" className={baseStyles.modalCloseButton} onClick={() => setDetailContact(null)}>
                Fechar
              </button>
            </header>

            <div className={baseStyles.modalBody}>
              <div className={baseStyles.detailGrid}>
                <div><strong>Tipo:</strong> {TABS[detailContact.kind].title}</div>
                <div><strong>Status:</strong> {detailContact.isActive ? "Ativo" : "Inativo"}</div>
                <div><strong>Nome:</strong> {detailContact.name}</div>
                <div><strong>Telefone Corporativo:</strong> {formatOptionalText(detailContact.telefoneCorporativo)}</div>
                <div><strong>E-mail:</strong> {formatOptionalText(detailContact.email)}</div>
                <div><strong>Registrado por:</strong> {formatAuditActor(detailContact.createdByName)}</div>
                <div><strong>Criado em:</strong> {formatDateTime(detailContact.createdAt)}</div>
                <div><strong>Atualizado por:</strong> {formatAuditActor(detailContact.updatedByName)}</div>
                <div><strong>Atualizado em:</strong> {formatDateTime(detailContact.updatedAt)}</div>
              </div>
            </div>
          </article>
        </div>
      ) : null}

      {historyContact ? (
        <div className={baseStyles.modalOverlay} onClick={closeHistoryModal}>
          <article className={baseStyles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={baseStyles.modalHeader}>
              <div className={baseStyles.modalTitleBlock}>
                <h4>Historico de {historyContact.name}</h4>
                <p className={baseStyles.modalSubtitle}>ID do registro: {historyContact.id}</p>
              </div>
              <button type="button" className={baseStyles.modalCloseButton} onClick={closeHistoryModal}>
                Fechar
              </button>
            </header>

            <div className={baseStyles.modalBody}>
              {isLoadingHistory ? <p>Carregando historico...</p> : null}
              {!isLoadingHistory && historyEntries.length === 0 ? <p>Nenhuma alteracao registrada.</p> : null}

              {!isLoadingHistory && historyEntries.length > 0
                ? historyEntries.map((entry) => (
                    <article key={entry.id} className={baseStyles.historyCard}>
                      <header className={baseStyles.historyCardHeader}>
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

                      {entry.reason ? <p className={baseStyles.historyReason}>Motivo: {entry.reason}</p> : null}

                      <div className={baseStyles.historyChanges}>
                        {Object.entries(entry.changes).map(([field, change]) => (
                          <div key={field} className={baseStyles.historyChangeItem}>
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
                <div className={baseStyles.pagination}>
                  <span>
                    Pagina {Math.min(historyPage, historyTotalPages)} de {historyTotalPages} | Total: {historyTotal}
                  </span>

                  <div className={baseStyles.paginationActions}>
                    <button
                      type="button"
                      className={baseStyles.ghostButton}
                      onClick={() => {
                        const target = Math.max(1, historyPage - 1);
                        void loadContactHistory(historyContact, target);
                      }}
                      disabled={historyPage <= 1 || isLoadingHistory}
                    >
                      Anterior
                    </button>
                    <button
                      type="button"
                      className={baseStyles.ghostButton}
                      onClick={() => {
                        const target = Math.min(historyTotalPages, historyPage + 1);
                        void loadContactHistory(historyContact, target);
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

      {statusContact ? (
        <div className={baseStyles.modalOverlay} onClick={closeStatusModal}>
          <article className={baseStyles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={baseStyles.modalHeader}>
              <div className={baseStyles.modalTitleBlock}>
                <h4>{statusAction === "cancel" ? "Cancelar registro" : "Ativar registro"}</h4>
                <p className={baseStyles.modalSubtitle}>Nome: {statusContact.name}</p>
              </div>
              <button type="button" className={baseStyles.modalCloseButton} onClick={closeStatusModal}>
                Fechar
              </button>
            </header>

            <div className={baseStyles.modalBody}>
              <label className={baseStyles.field}>
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

              <div className={baseStyles.actions}>
                <button
                  type="button"
                  className={statusAction === "cancel" ? baseStyles.dangerButton : baseStyles.primaryButton}
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
                <button type="button" className={baseStyles.ghostButton} onClick={closeStatusModal} disabled={isChangingStatus}>
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
