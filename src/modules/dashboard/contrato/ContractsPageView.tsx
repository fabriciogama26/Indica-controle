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
import { buildContractsCsv } from "./csv";

type ContractItem = {
  id: string;
  name: string;
  numeroContrato: string | null;
  empresa: string | null;
  nomeGestor: string | null;
  email: string | null;
  telefoneCorporativo: string | null;
  isActive: boolean;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

type ContractHistoryEntry = {
  id: string;
  changeType: "UPDATE" | "CANCEL" | "ACTIVATE";
  reason: string | null;
  createdAt: string;
  createdByName: string;
  changes: Record<string, { from: string | null; to: string | null }>;
};

type ContractFormState = {
  id: string | null;
  updatedAt: string | null;
  name: string;
  numeroContrato: string;
  empresa: string;
  nomeGestor: string;
  email: string;
  telefoneCorporativo: string;
};

type ContractFilterState = {
  name: string;
  empresa: string;
  nomeGestor: string;
  status: "" | "ativo" | "inativo";
};

type ContractsListResponse = {
  contracts?: ContractItem[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

type ContractHistoryResponse = {
  history?: ContractHistoryEntry[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

const PAGE_SIZE = DEFAULT_PAGE_SIZE;
const HISTORY_PAGE_SIZE = DEFAULT_HISTORY_PAGE_SIZE;
const EXPORT_PAGE_SIZE = DEFAULT_EXPORT_PAGE_SIZE;

const INITIAL_FORM: ContractFormState = {
  id: null,
  updatedAt: null,
  name: "",
  numeroContrato: "",
  empresa: "",
  nomeGestor: "",
  email: "",
  telefoneCorporativo: "",
};

const INITIAL_FILTERS: ContractFilterState = {
  name: "",
  empresa: "",
  nomeGestor: "",
  status: "",
};

const HISTORY_FIELD_LABELS: Record<string, string> = {
  name: "Nome",
  numeroContrato: "N. de contrato",
  empresa: "Empresa",
  nomeGestor: "Gestor",
  email: "E-mail",
  telefoneCorporativo: "Telefone corporativo",
  isActive: "Status",
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

function buildQuery(filters: ContractFilterState, page: number, pageSize = PAGE_SIZE, mode?: "export") {
  const params = new URLSearchParams();
  if (filters.name.trim()) {
    params.set("name", filters.name.trim());
  }
  if (filters.empresa.trim()) {
    params.set("empresa", filters.empresa.trim());
  }
  if (filters.nomeGestor.trim()) {
    params.set("nomeGestor", filters.nomeGestor.trim());
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

export function ContractsPageView() {
  const { session } = useAuth();
  const logError = useErrorLogger("contrato");
  const exportCooldown = useExportCooldown();
  const [form, setForm] = useState<ContractFormState>(INITIAL_FORM);
  const [filterDraft, setFilterDraft] = useState<ContractFilterState>(INITIAL_FILTERS);
  const [activeFilters, setActiveFilters] = useState<ContractFilterState>(INITIAL_FILTERS);
  const [contracts, setContracts] = useState<ContractItem[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [detailContract, setDetailContract] = useState<ContractItem | null>(null);
  const [historyContract, setHistoryContract] = useState<ContractItem | null>(null);
  const [historyEntries, setHistoryEntries] = useState<ContractHistoryEntry[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const { page, total, totalPages, setPage, setTotal } = usePagination({ pageSize: PAGE_SIZE });
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const historyTotalPages = Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE));
  const isEditing = Boolean(form.id);
  const formTitle = useMemo(() => (isEditing ? "Editar Contrato" : "Cadastro de Contrato"), [isEditing]);

  const loadContracts = useCallback(
    async (targetPage: number, filters: ContractFilterState, pageSize = PAGE_SIZE, mode?: "export") => {
      if (!session?.accessToken) {
        return [] as ContractItem[];
      }

      setIsLoadingList(true);
      try {
        const query = buildQuery(filters, targetPage, pageSize, mode);
        const response = await fetch(`/api/contracts?${query}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as ContractsListResponse;
        if (!response.ok) {
          setContracts([]);
          setTotal(0);
          setFeedback({ type: "error", message: data.message ?? "Falha ao carregar contratos." });
          return [] as ContractItem[];
        }

        const nextContracts = data.contracts ?? [];
        if (!mode) {
          setContracts(nextContracts);
          setTotal(data.pagination?.total ?? 0);
        }
        return nextContracts;
      } catch (error) {
        await logError("Falha ao carregar contratos.", error, { page: targetPage, filters });
        setContracts([]);
        setTotal(0);
        setFeedback({ type: "error", message: "Falha ao carregar contratos." });
        return [] as ContractItem[];
      } finally {
        setIsLoadingList(false);
      }
    },
    [logError, session?.accessToken, setTotal],
  );

  const loadContractHistory = useCallback(
    async (contract: ContractItem, targetPage: number) => {
      if (!session?.accessToken) {
        setFeedback({ type: "error", message: "Sessao invalida para carregar historico." });
        return;
      }

      setIsLoadingHistory(true);
      try {
        const params = new URLSearchParams();
        params.set("historyContractId", contract.id);
        params.set("historyPage", String(targetPage));
        params.set("historyPageSize", String(HISTORY_PAGE_SIZE));

        const response = await fetch(`/api/contracts?${params.toString()}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as ContractHistoryResponse;
        if (!response.ok) {
          setFeedback({ type: "error", message: data.message ?? "Falha ao carregar historico do contrato." });
          setHistoryEntries([]);
          setHistoryTotal(0);
          return;
        }

        setHistoryEntries(data.history ?? []);
        setHistoryPage(data.pagination?.page ?? targetPage);
        setHistoryTotal(data.pagination?.total ?? 0);
      } catch (error) {
        await logError("Falha ao carregar historico do contrato.", error, { contractId: contract.id });
        setFeedback({ type: "error", message: "Falha ao carregar historico do contrato." });
        setHistoryEntries([]);
        setHistoryTotal(0);
      } finally {
        setIsLoadingHistory(false);
      }
    },
    [logError, session?.accessToken],
  );

  useEffect(() => {
    void loadContracts(page, activeFilters);
  }, [activeFilters, loadContracts, page]);

  function resetForm() {
    setForm(INITIAL_FORM);
  }

  function updateFormField(field: keyof ContractFormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateFilterField(field: keyof ContractFilterState, value: string) {
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

  function startEdit(contract: ContractItem) {
    setForm({
      id: contract.id,
      updatedAt: contract.updatedAt,
      name: contract.name,
      numeroContrato: contract.numeroContrato ?? "",
      empresa: contract.empresa ?? "",
      nomeGestor: contract.nomeGestor ?? "",
      email: contract.email ?? "",
      telefoneCorporativo: contract.telefoneCorporativo ?? "",
    });
    setFeedback(null);
    scrollDashboardContentToTop();
  }

  function closeHistoryModal() {
    setHistoryContract(null);
    setHistoryEntries([]);
    setHistoryPage(1);
    setHistoryTotal(0);
    setIsLoadingHistory(false);
  }

  async function openHistoryModal(contract: ContractItem) {
    setHistoryContract(contract);
    setHistoryEntries([]);
    setHistoryPage(1);
    setHistoryTotal(0);
    await loadContractHistory(contract, 1);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session?.accessToken) {
      setFeedback({ type: "error", message: "Sessao invalida para salvar contrato." });
      return;
    }

    setIsSaving(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/contracts", {
        method: form.id ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          id: form.id,
          name: normalizeText(form.name),
          numeroContrato: normalizeText(form.numeroContrato) || null,
          empresa: normalizeText(form.empresa) || null,
          nomeGestor: normalizeText(form.nomeGestor) || null,
          email: normalizeText(form.email) || null,
          telefoneCorporativo: normalizePhone(form.telefoneCorporativo) || null,
          ...(form.id ? { expectedUpdatedAt: form.updatedAt } : {}),
        }),
      });

      const data = (await response.json().catch(() => ({}))) as { success?: boolean; message?: string; code?: string };
      if (!response.ok || !data.success) {
        if (data.code === "CONCURRENT_MODIFICATION" || data.code === "RECORD_INACTIVE") {
          await loadContracts(page, activeFilters);
        }
        setFeedback({ type: "error", message: data.message ?? "Falha ao salvar contrato." });
        return;
      }

      setFeedback({ type: "success", message: data.message ?? "Contrato salvo com sucesso." });
      resetForm();
      await loadContracts(1, activeFilters);
      setPage(1);
    } catch (error) {
      await logError("Falha ao salvar contrato.", error, { id: form.id, name: form.name });
      setFeedback({ type: "error", message: "Falha ao salvar contrato." });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleExportContracts() {
    if (!session?.accessToken) {
      setFeedback({ type: "error", message: "Sessao invalida para exportar contratos." });
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
      const allContracts: ContractItem[] = [];
      let exportPage = 1;
      let totalItems = 0;

      while (true) {
        const query = buildQuery(activeFilters, exportPage, EXPORT_PAGE_SIZE, "export");
        const response = await fetch(`/api/contracts?${query}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as ContractsListResponse;
        if (!response.ok) {
          setFeedback({ type: "error", message: data.message ?? "Falha ao exportar contratos." });
          return;
        }

        const pageItems = data.contracts ?? [];
        allContracts.push(...pageItems);
        totalItems = data.pagination?.total ?? allContracts.length;
        if (allContracts.length >= totalItems || pageItems.length === 0) {
          break;
        }
        exportPage += 1;
      }

      downloadCsvFile(buildContractsCsv(allContracts), "contratos.csv");
      setFeedback({ type: "success", message: `${allContracts.length} contrato(s) exportado(s).` });
    } catch (error) {
      await logError("Falha ao exportar contratos.", error, { filters: activeFilters });
      setFeedback({ type: "error", message: "Falha ao exportar contratos." });
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
              Nome <span className="requiredMark">*</span>
            </span>
            <input
              type="text"
              value={form.name}
              onChange={(event) => updateFormField("name", event.target.value)}
              placeholder="Ex.: Contrato principal"
              required
            />
          </label>

          <label className={styles.field}>
            <span>N. de Contrato</span>
            <input
              type="text"
              value={form.numeroContrato}
              onChange={(event) => updateFormField("numeroContrato", event.target.value)}
              placeholder="Ex.: 2024/001"
            />
          </label>

          <label className={styles.field}>
            <span>Empresa</span>
            <input
              type="text"
              value={form.empresa}
              onChange={(event) => updateFormField("empresa", event.target.value)}
              placeholder="Ex.: INDICA SERVICOS"
            />
          </label>

          <label className={styles.field}>
            <span>Gestor</span>
            <input
              type="text"
              value={form.nomeGestor}
              onChange={(event) => updateFormField("nomeGestor", event.target.value)}
              placeholder="Nome do gestor"
            />
          </label>

          <label className={styles.field}>
            <span>E-mail</span>
            <input
              type="email"
              value={form.email}
              onChange={(event) => updateFormField("email", event.target.value)}
              placeholder="gestor@empresa.com.br"
            />
          </label>

          <label className={styles.field}>
            <span>Telefone corporativo</span>
            <input
              type="text"
              inputMode="numeric"
              value={form.telefoneCorporativo}
              onChange={(event) => updateFormField("telefoneCorporativo", event.target.value)}
              placeholder="Somente numeros"
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
            <span>Empresa</span>
            <input
              type="text"
              value={filterDraft.empresa}
              onChange={(event) => updateFilterField("empresa", event.target.value)}
              placeholder="Filtrar por empresa"
            />
          </label>

          <label className={styles.field}>
            <span>Gestor</span>
            <input
              type="text"
              value={filterDraft.nomeGestor}
              onChange={(event) => updateFilterField("nomeGestor", event.target.value)}
              placeholder="Filtrar por gestor"
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
          <h3 className={styles.cardTitle}>Lista de Contratos</h3>
          <CsvExportButton
            className={styles.ghostButton}
            onClick={() => void handleExportContracts()}
            isLoading={isExporting}
            disabled={isExporting || isLoadingList || exportCooldown.isCoolingDown}
          />
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Nome</th>
                <th>N. de Contrato</th>
                <th>Empresa</th>
                <th>Gestor</th>
                <th>E-mail</th>
                <th>Telefone</th>
                <th>Status</th>
                <th>Atualizado em</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {contracts.length > 0 ? (
                contracts.map((contract) => (
                  <tr key={contract.id} className={!contract.isActive ? styles.inactiveRow : undefined}>
                    <td>
                      <div className={styles.sobCell}>
                        <span>{contract.name}</span>
                        {!contract.isActive ? <span className={styles.statusTag}>Inativo</span> : null}
                      </div>
                    </td>
                    <td>{formatOptionalText(contract.numeroContrato)}</td>
                    <td>{formatOptionalText(contract.empresa)}</td>
                    <td>{formatOptionalText(contract.nomeGestor)}</td>
                    <td>{formatOptionalText(contract.email)}</td>
                    <td>{formatOptionalText(contract.telefoneCorporativo)}</td>
                    <td>{contract.isActive ? "Ativo" : "Inativo"}</td>
                    <td>{formatDateTime(contract.updatedAt)}</td>
                    <td className={styles.actionsCell}>
                      <div className={styles.tableActions}>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${styles.actionView}`}
                          onClick={() => setDetailContract(contract)}
                          title="Detalhes"
                          aria-label="Detalhes do contrato"
                        >
                          <ActionIcon name="details" />
                        </button>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${styles.actionEdit}`}
                          onClick={() => startEdit(contract)}
                          title="Editar"
                          aria-label="Editar contrato"
                          disabled={!contract.isActive}
                        >
                          <ActionIcon name="edit" />
                        </button>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${styles.actionHistory}`}
                          onClick={() => void openHistoryModal(contract)}
                          title="Historico"
                          aria-label="Historico do contrato"
                        >
                          <ActionIcon name="history" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} className={styles.emptyRow}>
                    {isLoadingList ? "Carregando contratos..." : "Nenhum contrato encontrado para os filtros informados."}
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

      {detailContract ? (
        <div className={styles.modalOverlay} onClick={() => setDetailContract(null)}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Detalhes do Contrato {detailContract.name}</h4>
                <p className={styles.modalSubtitle}>ID do contrato: {detailContract.id}</p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={() => setDetailContract(null)}>
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              <div className={styles.detailGrid}>
                <div><strong>Status:</strong> {detailContract.isActive ? "Ativo" : "Inativo"}</div>
                <div><strong>Nome:</strong> {detailContract.name}</div>
                <div><strong>N. de Contrato:</strong> {formatOptionalText(detailContract.numeroContrato)}</div>
                <div><strong>Empresa:</strong> {formatOptionalText(detailContract.empresa)}</div>
                <div><strong>Gestor:</strong> {formatOptionalText(detailContract.nomeGestor)}</div>
                <div><strong>E-mail:</strong> {formatOptionalText(detailContract.email)}</div>
                <div><strong>Telefone corporativo:</strong> {formatOptionalText(detailContract.telefoneCorporativo)}</div>
                <div><strong>Registrado por:</strong> {formatAuditActor(detailContract.createdByName)}</div>
                <div><strong>Criado em:</strong> {formatDateTime(detailContract.createdAt)}</div>
                <div><strong>Atualizado por:</strong> {formatAuditActor(detailContract.updatedByName)}</div>
                <div><strong>Atualizado em:</strong> {formatDateTime(detailContract.updatedAt)}</div>
              </div>
            </div>
          </article>
        </div>
      ) : null}

      {historyContract ? (
        <div className={styles.modalOverlay} onClick={closeHistoryModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Historico do Contrato {historyContract.name}</h4>
                <p className={styles.modalSubtitle}>ID do contrato: {historyContract.id}</p>
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
                        <strong>{entry.changeType === "UPDATE" ? "Atualizacao" : entry.changeType}</strong>
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
                        void loadContractHistory(historyContract, target);
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
                        void loadContractHistory(historyContract, target);
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
    </section>
  );
}
