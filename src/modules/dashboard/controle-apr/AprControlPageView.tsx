"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { useErrorLogger } from "@/hooks/useErrorLogger";
import styles from "./AprControlPageView.module.css";
import { formatDate, formatDateTime } from "@/lib/utils/formatters";

type AprStatus = "ATIVO" | "CANCELADO" | "DIVERGENTE" | "CONFERIDO";
type StatusAction = "CONFERIR" | "DIVERGIR" | "CANCELAR";

type ProjectItem = {
  id: string;
  code: string;
  serviceName: string;
};

type TeamItem = {
  id: string;
  name: string;
  foremanId: string | null;
  foremanName: string;
};

type AprRecord = {
  id: string;
  aprId: string;
  projectId: string;
  teamId: string;
  programmingId: string | null;
  serviceDate: string;
  status: AprStatus;
  observation: string;
  projectCode: string;
  teamName: string;
  foremanName: string;
  programmingStatus: string;
  programmingMatchStatus: "PROGRAMADA" | "NAO_PROGRAMADA";
  validatedAt: string | null;
  canceledAt: string | null;
  cancellationReason: string;
  createdAt: string;
  updatedAt: string;
};

type ListResponse = {
  records?: AprRecord[];
  projects?: ProjectItem[];
  teams?: TeamItem[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

type Feedback = {
  type: "success" | "error";
  message: string;
} | null;

type FormState = {
  id: string | null;
  expectedUpdatedAt: string | null;
  projectId: string;
  projectSearch: string;
  aprId: string;
  serviceDate: string;
  teamId: string;
  observation: string;
};

type Filters = {
  startDate: string;
  endDate: string;
  projectId: string;
  projectSearch: string;
  teamId: string;
  aprId: string;
  status: "TODOS" | AprStatus;
  foremanName: string;
};

const PAGE_SIZE = 20;
const EXPORT_PAGE_SIZE = 500;

function toIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function yearRange(today: string) {
  const year = today.slice(0, 4);
  return { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
}

function createForm(today: string): FormState {
  return {
    id: null,
    expectedUpdatedAt: null,
    projectId: "",
    projectSearch: "",
    aprId: "",
    serviceDate: today,
    teamId: "",
    observation: "",
  };
}

function createFilters(today: string): Filters {
  const range = yearRange(today);
  return {
    ...range,
    projectId: "",
    projectSearch: "",
    teamId: "",
    aprId: "",
    status: "TODOS",
    foremanName: "",
  };
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function findProject(value: string, projects: ProjectItem[]) {
  const normalized = normalizeSearch(value);
  if (!normalized) return null;
  return projects.find((item) => normalizeSearch(item.code) === normalized) ?? null;
}

function statusLabel(status: AprStatus) {
  const labels: Record<AprStatus, string> = {
    ATIVO: "Ativo",
    CANCELADO: "Cancelado",
    DIVERGENTE: "Divergente",
    CONFERIDO: "Conferido",
  };
  return labels[status];
}

function statusClass(status: AprStatus) {
  if (status === "CONFERIDO") return styles.statusSuccess;
  if (status === "DIVERGENTE") return styles.statusWarning;
  if (status === "CANCELADO") return styles.statusDanger;
  return styles.statusActive;
}

function buildQuery(filters: Filters, page: number, pageSize = PAGE_SIZE, includeMeta = false) {
  const params = new URLSearchParams({
    startDate: filters.startDate,
    endDate: filters.endDate,
    page: String(page),
    pageSize: String(pageSize),
  });
  if (includeMeta) params.set("meta", "1");
  if (filters.projectId) params.set("projectId", filters.projectId);
  if (filters.teamId) params.set("teamId", filters.teamId);
  if (filters.aprId.trim()) params.set("aprId", filters.aprId.trim());
  if (filters.status !== "TODOS") params.set("status", filters.status);
  if (filters.foremanName) params.set("foremanName", filters.foremanName);
  return params.toString();
}

function downloadExcel(records: AprRecord[]) {
  return import("xlsx").then((xlsx) => {
    const rows = records.map((item) => ({
      "ID APR": item.aprId,
      Projeto: item.projectCode,
      "Data do servico": formatDate(item.serviceDate),
      Equipe: item.teamName,
      Encarregado: item.foremanName || "-",
      Programacao: item.programmingMatchStatus === "PROGRAMADA" ? "Programada" : "Nao programada",
      "Status da programacao": item.programmingStatus || "-",
      Situacao: statusLabel(item.status),
      Observacao: item.observation || "-",
      "Atualizado em": formatDateTime(item.updatedAt),
    }));
    const worksheet = xlsx.utils.json_to_sheet(rows);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, "Controle APR");
    xlsx.writeFile(workbook, `controle_apr_${toIsoDate(new Date())}.xlsx`);
  });
}

function scrollToTop() {
  const content = document.querySelector<HTMLElement>('[data-main-content-scroll="true"]');
  if (content) {
    content.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

export function AprControlPageView() {
  const { session } = useAuth();
  const logError = useErrorLogger("controle_apr");
  const today = useMemo(() => toIsoDate(new Date()), []);
  const [form, setForm] = useState<FormState>(() => createForm(today));
  const [filterDraft, setFilterDraft] = useState<Filters>(() => createFilters(today));
  const [filters, setFilters] = useState<Filters>(() => createFilters(today));
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [teams, setTeams] = useState<TeamItem[]>([]);
  const [records, setRecords] = useState<AprRecord[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [statusTarget, setStatusTarget] = useState<AprRecord | null>(null);
  const [statusAction, setStatusAction] = useState<StatusAction>("CONFERIR");
  const [statusReason, setStatusReason] = useState("");
  const [statusError, setStatusError] = useState("");
  const [isChangingStatus, setIsChangingStatus] = useState(false);

  const token = session?.accessToken;
  const isEditing = Boolean(form.id);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const selectedTeam = useMemo(() => teams.find((item) => item.id === form.teamId) ?? null, [form.teamId, teams]);
  const foremanOptions = useMemo(
    () => Array.from(new Set(teams.map((item) => item.foremanName).filter((item) => item && item !== "Sem encarregado"))).sort(),
    [teams],
  );

  const authenticatedFetch = useCallback(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!token) throw new Error("Sessao invalida.");
    return fetch(input, {
      ...init,
      cache: "no-store",
      headers: {
        ...init?.headers,
        Authorization: `Bearer ${token}`,
      },
    });
  }, [token]);

  const loadRecords = useCallback(async (targetPage: number, includeMeta = false) => {
    if (!token) return;
    setIsLoading(true);
    try {
      const response = await authenticatedFetch(`/api/controle-apr?${buildQuery(filters, targetPage, PAGE_SIZE, includeMeta)}`);
      const data = (await response.json().catch(() => ({}))) as ListResponse;
      if (!response.ok) throw new Error(data.message ?? "Falha ao carregar Controle de APR.");
      setRecords(data.records ?? []);
      setTotal(data.pagination?.total ?? 0);
      setPage(data.pagination?.page ?? targetPage);
      if (includeMeta) {
        setProjects(data.projects ?? []);
        setTeams(data.teams ?? []);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao carregar Controle de APR.";
      setFeedback({ type: "error", message });
      await logError(message, error, { action: "load" });
    } finally {
      setIsLoading(false);
    }
  }, [authenticatedFetch, filters, logError, token]);

  useEffect(() => {
    void loadRecords(page, projects.length === 0 || teams.length === 0);
  }, [loadRecords, page, projects.length, teams.length]);

  function clearForm() {
    setForm(createForm(today));
  }

  function handleProjectInput(value: string, target: "form" | "filter") {
    const project = findProject(value, projects);
    if (target === "form") {
      setForm((current) => ({ ...current, projectSearch: value, projectId: project?.id ?? "" }));
      return;
    }
    setFilterDraft((current) => ({ ...current, projectSearch: value, projectId: project?.id ?? "" }));
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    const project = findProject(form.projectSearch, projects);
    if (!project || project.id !== form.projectId) {
      setFeedback({ type: "error", message: "Selecione um Projeto cadastrado na lista de sugestoes." });
      return;
    }
    if (!form.aprId.trim() || !form.serviceDate || !form.teamId) {
      setFeedback({ type: "error", message: "Projeto, ID APR, Data do servico e Equipe sao obrigatorios." });
      return;
    }
    if (form.serviceDate > today) {
      setFeedback({ type: "error", message: "A Data do servico nao pode ser futura." });
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await authenticatedFetch("/api/controle-apr", {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: form.id,
          aprId: form.aprId,
          projectId: form.projectId,
          teamId: form.teamId,
          serviceDate: form.serviceDate,
          observation: form.observation,
          expectedUpdatedAt: form.expectedUpdatedAt,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) throw new Error(data.message ?? "Falha ao salvar a APR.");
      setFeedback({ type: "success", message: data.message ?? "APR salva com sucesso." });
      clearForm();
      setPage(1);
      await loadRecords(1);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao salvar a APR.";
      setFeedback({ type: "error", message });
      await logError(message, error, { action: isEditing ? "update" : "create", aprId: form.aprId });
    } finally {
      setIsSubmitting(false);
    }
  }

  function editRecord(record: AprRecord) {
    setForm({
      id: record.id,
      expectedUpdatedAt: record.updatedAt,
      projectId: record.projectId,
      projectSearch: record.projectCode,
      aprId: record.aprId,
      serviceDate: record.serviceDate,
      teamId: record.teamId,
      observation: record.observation,
    });
    setFeedback(null);
    scrollToTop();
  }

  function openStatusModal(record: AprRecord, action: StatusAction) {
    setStatusTarget(record);
    setStatusAction(action);
    setStatusReason(action === "CONFERIR" ? record.observation : "");
    setStatusError("");
  }

  function closeStatusModal() {
    if (isChangingStatus) return;
    setStatusTarget(null);
    setStatusReason("");
    setStatusError("");
  }

  async function submitStatusAction(action = statusAction) {
    if (!statusTarget) return;
    if ((action === "DIVERGIR" || action === "CANCELAR") && statusReason.trim().length < 10) {
      setStatusError("Informe uma observacao com no minimo 10 caracteres.");
      return;
    }

    setStatusError("");
    setIsChangingStatus(true);
    try {
      const response = await authenticatedFetch("/api/controle-apr", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: statusTarget.id,
          action,
          reason: statusReason,
          expectedUpdatedAt: statusTarget.updatedAt,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) throw new Error(data.message ?? "Falha ao alterar a situacao da APR.");
      setFeedback({ type: "success", message: data.message ?? "Situacao da APR atualizada." });
      setStatusTarget(null);
      setStatusReason("");
      setStatusError("");
      await loadRecords(page);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao alterar a situacao da APR.";
      setFeedback({ type: "error", message });
      await logError(message, error, { action, aprId: statusTarget.aprId });
    } finally {
      setIsChangingStatus(false);
    }
  }

  function applyFilters() {
    if (filterDraft.projectSearch.trim() && !filterDraft.projectId) {
      setFeedback({ type: "error", message: "Selecione um Projeto cadastrado para aplicar o filtro." });
      return;
    }
    if (filterDraft.startDate && filterDraft.endDate && filterDraft.startDate > filterDraft.endDate) {
      setFeedback({ type: "error", message: "A Data inicial nao pode ser maior que a Data final." });
      return;
    }
    setFeedback(null);
    setFilters(filterDraft);
    setPage(1);
  }

  function clearFilters() {
    const next = createFilters(today);
    setFilterDraft(next);
    setFilters(next);
    setPage(1);
  }

  async function exportExcel() {
    setIsExporting(true);
    setFeedback(null);
    try {
      const allRecords: AprRecord[] = [];
      let exportPage = 1;
      let exportTotal = 0;
      do {
        const response = await authenticatedFetch(
          `/api/controle-apr?${buildQuery(filters, exportPage, EXPORT_PAGE_SIZE)}`,
        );
        const data = (await response.json().catch(() => ({}))) as ListResponse;
        if (!response.ok) throw new Error(data.message ?? "Falha ao extrair Controle de APR.");
        allRecords.push(...(data.records ?? []));
        exportTotal = data.pagination?.total ?? allRecords.length;
        exportPage += 1;
      } while (allRecords.length < exportTotal);

      if (!allRecords.length) {
        setFeedback({ type: "error", message: "Nenhuma APR encontrada para extrair com os filtros atuais." });
        return;
      }
      await downloadExcel(allRecords);
      setFeedback({ type: "success", message: `${allRecords.length} APR(s) extraida(s) para Excel.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao extrair Controle de APR.";
      setFeedback({ type: "error", message });
      await logError(message, error, { action: "export" });
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <section className={styles.wrapper}>
      <article className={`${styles.card} ${isEditing ? styles.editingCard : ""}`}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>{isEditing ? "Editar APR" : "Cadastro de APR"}</h2>
            <p className={styles.cardSubtitle}>
              O vinculo com a Programacao e identificado por Projeto + Equipe + Data do servico.
            </p>
          </div>
          {isEditing ? (
            <button type="button" className={styles.ghostButton} onClick={clearForm}>
              Cancelar edicao
            </button>
          ) : null}
        </div>

        {feedback ? (
          <div className={feedback.type === "error" ? styles.feedbackError : styles.feedbackSuccess}>
            {feedback.message}
          </div>
        ) : null}

        <form className={styles.formGrid} onSubmit={submitForm}>
          <label className={styles.field}>
            <span>Projeto <span className="requiredMark">*</span></span>
            <input
              value={form.projectSearch}
              list="apr-project-list"
              placeholder="Busque pelo codigo do projeto"
              onChange={(event) => handleProjectInput(event.target.value, "form")}
            />
          </label>

          <label className={styles.field}>
            <span>ID APR <span className="requiredMark">*</span></span>
            <input
              value={form.aprId}
              maxLength={80}
              placeholder="Numero ou identificador da APR"
              onChange={(event) => setForm((current) => ({ ...current, aprId: event.target.value.toUpperCase() }))}
            />
          </label>

          <label className={styles.field}>
            <span>Data do servico <span className="requiredMark">*</span></span>
            <input
              type="date"
              max={today}
              value={form.serviceDate}
              onChange={(event) => setForm((current) => ({ ...current, serviceDate: event.target.value }))}
            />
          </label>

          <label className={styles.field}>
            <span>Equipe <span className="requiredMark">*</span></span>
            <select
              value={form.teamId}
              onChange={(event) => setForm((current) => ({ ...current, teamId: event.target.value }))}
            >
              <option value="">Selecione</option>
              {teams.map((item) => (
                <option key={item.id} value={item.id}>{item.name} - {item.foremanName}</option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Encarregado</span>
            <input value={selectedTeam?.foremanName ?? ""} readOnly placeholder="Definido pela equipe" />
          </label>

          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Observacao</span>
            <textarea
              rows={3}
              value={form.observation}
              placeholder="Justifique divergencia, cancelamento ou correcao da APR quando necessario."
              onChange={(event) => setForm((current) => ({ ...current, observation: event.target.value }))}
            />
          </label>

          <div className={styles.formActions}>
            <button type="submit" className={styles.primaryButton} disabled={isSubmitting}>
              {isSubmitting ? "Salvando..." : isEditing ? "Salvar alteracoes" : "Cadastrar APR"}
            </button>
          </div>
        </form>
      </article>

      <article className={styles.card}>
        <h2 className={styles.cardTitle}>Filtros</h2>
        <div className={styles.filterGrid}>
          <label className={styles.field}>
            <span>Data inicial</span>
            <input
              type="date"
              value={filterDraft.startDate}
              onChange={(event) => setFilterDraft((current) => ({ ...current, startDate: event.target.value }))}
            />
          </label>
          <label className={styles.field}>
            <span>Data final</span>
            <input
              type="date"
              value={filterDraft.endDate}
              onChange={(event) => setFilterDraft((current) => ({ ...current, endDate: event.target.value }))}
            />
          </label>
          <label className={styles.field}>
            <span>Projeto</span>
            <input
              value={filterDraft.projectSearch}
              list="apr-project-list"
              placeholder="Todos"
              onChange={(event) => handleProjectInput(event.target.value, "filter")}
            />
          </label>
          <label className={styles.field}>
            <span>Equipe</span>
            <select
              value={filterDraft.teamId}
              onChange={(event) => setFilterDraft((current) => ({ ...current, teamId: event.target.value }))}
            >
              <option value="">Todas</option>
              {teams.map((item) => (
                <option key={item.id} value={item.id}>{item.name} - {item.foremanName}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>ID APR</span>
            <input
              value={filterDraft.aprId}
              placeholder="Busca direta"
              onChange={(event) => setFilterDraft((current) => ({ ...current, aprId: event.target.value }))}
            />
          </label>
          <label className={styles.field}>
            <span>Status</span>
            <select
              value={filterDraft.status}
              onChange={(event) => setFilterDraft((current) => ({ ...current, status: event.target.value as Filters["status"] }))}
            >
              <option value="TODOS">Todos</option>
              <option value="ATIVO">Ativo</option>
              <option value="CANCELADO">Cancelado</option>
              <option value="DIVERGENTE">Divergente</option>
              <option value="CONFERIDO">Conferido</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Encarregado</span>
            <select
              value={filterDraft.foremanName}
              onChange={(event) => setFilterDraft((current) => ({ ...current, foremanName: event.target.value }))}
            >
              <option value="">Todos</option>
              {foremanOptions.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.primaryButton} onClick={applyFilters}>Aplicar filtros</button>
          <button type="button" className={styles.ghostButton} onClick={clearFilters}>Limpar filtros</button>
        </div>
      </article>

      <article className={styles.card}>
        <div className={styles.tableHeader}>
          <div>
            <h2 className={styles.cardTitle}>Controle de APR</h2>
            <p className={styles.cardSubtitle}>{total} registro(s) encontrado(s).</p>
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.secondaryButton} onClick={() => void exportExcel()} disabled={isExporting}>
              {isExporting ? "Extraindo..." : "Extrair para Excel"}
            </button>
            <button type="button" className={styles.ghostButton} onClick={() => void loadRecords(page)} disabled={isLoading}>
              Atualizar lista
            </button>
          </div>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>ID APR</th>
                <th>Projeto</th>
                <th>Data</th>
                <th>Equipe</th>
                <th>Encarregado</th>
                <th>Programacao</th>
                <th>Situacao</th>
                <th>Observacao</th>
                <th>Atualizado em</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {records.length ? records.map((record) => (
                <tr key={record.id} className={record.status === "CANCELADO" ? styles.inactiveRow : ""}>
                  <td><strong>{record.aprId}</strong></td>
                  <td>{record.projectCode}</td>
                  <td>{formatDate(record.serviceDate)}</td>
                  <td>{record.teamName}</td>
                  <td>{record.foremanName || "-"}</td>
                  <td>
                    <span className={record.programmingMatchStatus === "PROGRAMADA" ? styles.matchTag : styles.noMatchTag}>
                      {record.programmingMatchStatus === "PROGRAMADA" ? "Programada" : "Nao programada"}
                    </span>
                  </td>
                  <td><span className={`${styles.statusTag} ${statusClass(record.status)}`}>{statusLabel(record.status)}</span></td>
                  <td className={styles.observationCell}>{record.observation || "-"}</td>
                  <td>{formatDateTime(record.updatedAt)}</td>
                  <td className={styles.actionsCell}>
                    <div className={styles.tableActions}>
                      <button
                        type="button"
                        className={`${styles.actionButton} ${styles.actionEdit}`}
                        onClick={() => editRecord(record)}
                        disabled={record.status === "CANCELADO"}
                        title="Editar"
                        aria-label={`Editar APR ${record.aprId}`}
                      >
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M4.5 19.5h4l9-9a1.4 1.4 0 0 0 0-2l-2-2a1.4 1.4 0 0 0-2 0l-9 9v4Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M12.5 7.5l4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className={`${styles.actionButton} ${styles.actionCancel}`}
                        onClick={() => openStatusModal(record, "CANCELAR")}
                        disabled={record.status === "CANCELADO"}
                        title="Cancelar"
                        aria-label={`Cancelar APR ${record.aprId}`}
                      >
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" />
                          <path d="m9.5 9.5 5 5m0-5-5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className={`${styles.actionButton} ${styles.actionValidate}`}
                        onClick={() => openStatusModal(record, "CONFERIR")}
                        disabled={record.status === "CANCELADO"}
                        title="Validar"
                        aria-label={`Validar APR ${record.aprId}`}
                      >
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" />
                          <path d="m8.5 12 2.2 2.2 4.8-4.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={10} className={styles.emptyRow}>
                    {isLoading ? "Carregando APRs..." : "Nenhuma APR encontrada."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className={styles.pagination}>
          <span>Pagina {Math.min(page, totalPages)} de {totalPages} | Total: {total}</span>
          <div className={styles.actions}>
            <button type="button" className={styles.ghostButton} disabled={page <= 1 || isLoading} onClick={() => setPage((current) => Math.max(1, current - 1))}>Anterior</button>
            <button type="button" className={styles.ghostButton} disabled={page >= totalPages || isLoading} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Proxima</button>
          </div>
        </div>
      </article>

      {statusTarget ? (
        <div className={styles.modalOverlay} onClick={closeStatusModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div>
                <h3>{statusAction === "CANCELAR" ? "Cancelar APR" : "Validar APR"}</h3>
                <p>APR {statusTarget.aprId} | {statusTarget.projectCode} | {formatDate(statusTarget.serviceDate)}</p>
              </div>
              <button type="button" className={styles.ghostButton} onClick={closeStatusModal}>Fechar</button>
            </header>

            <label className={styles.field}>
              <span>
                Observacao {(statusAction === "CANCELAR" || statusAction === "DIVERGIR") ? <span className="requiredMark">*</span> : null}
              </span>
              <textarea
                rows={4}
                value={statusReason}
                placeholder="Informe o motivo da divergencia ou cancelamento."
                onChange={(event) => setStatusReason(event.target.value)}
              />
            </label>

            {statusError ? <div className={styles.feedbackError}>{statusError}</div> : null}

            {statusAction === "CANCELAR" ? (
              <div className={styles.actions}>
                <button type="button" className={styles.ghostButton} onClick={closeStatusModal} disabled={isChangingStatus}>Voltar</button>
                <button type="button" className={styles.dangerButton} onClick={() => void submitStatusAction("CANCELAR")} disabled={isChangingStatus}>
                  {isChangingStatus ? "Cancelando..." : "Confirmar cancelamento"}
                </button>
              </div>
            ) : (
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.warningButton}
                  onClick={() => {
                    setStatusAction("DIVERGIR");
                    void submitStatusAction("DIVERGIR");
                  }}
                  disabled={isChangingStatus}
                >
                  Marcar divergente
                </button>
                <button type="button" className={styles.primaryButton} onClick={() => void submitStatusAction("CONFERIR")} disabled={isChangingStatus}>
                  {isChangingStatus ? "Validando..." : "Marcar conferido"}
                </button>
              </div>
            )}
          </article>
        </div>
      ) : null}

      <datalist id="apr-project-list">
        {projects.map((item) => (
          <option key={item.id} value={item.code}>{item.serviceName}</option>
        ))}
      </datalist>
    </section>
  );
}
