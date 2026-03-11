"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import styles from "./ProjectsPageView.module.css";

type ProjectItem = {
  id: string;
  sob: string;
  serviceCenter: string;
  partner: string;
  serviceType: string;
  executionDeadline: string;
  priority: string;
  estimatedValue: number;
  voltageLevel: string | null;
  projectSize: string | null;
  contractorResponsible: string;
  utilityResponsible: string;
  utilityFieldManager: string;
  street: string;
  neighborhood: string;
  city: string;
  serviceDescription: string | null;
  observation: string | null;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
};

type FormState = {
  sob: string;
  serviceCenter: string;
  partner: string;
  serviceType: string;
  executionDeadline: string;
  priority: string;
  estimatedValue: string;
  voltageLevel: string;
  projectSize: string;
  contractorResponsible: string;
  utilityResponsible: string;
  utilityFieldManager: string;
  street: string;
  neighborhood: string;
  city: string;
  serviceDescription: string;
  observation: string;
};

type FilterState = {
  sob: string;
  executionDate: string;
  priority: string;
  city: string;
};

type SobBaseItem = {
  sob: string;
  serviceCenter: string;
  partner: string;
};

type MetaResponse = {
  priorities: string[];
  cities: string[];
  responsibles: string[];
  sobCatalog: SobBaseItem[];
};

const PAGE_SIZE = 20;
const PRIORITY_OPTIONS = ["GRUPO B - FLUXO", "DRP / DRC", "GRUPO A - FLUXO", "FUSESAVER"] as const;
const PRIORITY_A_PREFIX = new Set(["GRUPO B - FLUXO", "DRP / DRC", "GRUPO A - FLUXO"]);

const INITIAL_FORM: FormState = {
  sob: "",
  serviceCenter: "",
  partner: "",
  serviceType: "",
  executionDeadline: "",
  priority: "",
  estimatedValue: "",
  voltageLevel: "",
  projectSize: "",
  contractorResponsible: "",
  utilityResponsible: "",
  utilityFieldManager: "",
  street: "",
  neighborhood: "",
  city: "",
  serviceDescription: "",
  observation: "",
};

const INITIAL_FILTERS: FilterState = {
  sob: "",
  executionDate: "",
  priority: "",
  city: "",
};

function formatDate(value: string) {
  if (!value) {
    return "-";
  }

  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString("pt-BR");
}

function formatDateTime(value: string) {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("pt-BR");
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  }).format(value);
}

function buildQuery(filters: FilterState, page: number) {
  const params = new URLSearchParams();

  if (filters.sob.trim()) {
    params.set("sob", filters.sob.trim());
  }
  if (filters.executionDate) {
    params.set("executionDate", filters.executionDate);
  }
  if (filters.priority) {
    params.set("priority", filters.priority);
  }
  if (filters.city) {
    params.set("city", filters.city);
  }

  params.set("page", String(page));
  params.set("pageSize", String(PAGE_SIZE));
  return params.toString();
}

function normalizePriority(value: string) {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeSob(value: string) {
  return String(value ?? "").trim().toUpperCase();
}

function getSobRuleError(priority: string, sob: string) {
  const normalizedPriority = normalizePriority(priority);
  const normalizedSob = normalizeSob(sob);

  if (PRIORITY_A_PREFIX.has(normalizedPriority) && !/^A[0-9]{9}$/.test(normalizedSob)) {
    return "Para esta prioridade, Projeto (SOB) deve iniciar com A e conter 9 numeros (ex.: A123456789).";
  }

  if (normalizedPriority === "FUSESAVER" && !/^(ZX|FS)[0-9]{8}$/.test(normalizedSob)) {
    return "Para FUSESAVER, Projeto (SOB) deve iniciar com ZX ou FS e conter 8 numeros (ex.: ZX12345678).";
  }

  return null;
}

export function ProjectsPageView() {
  const { session } = useAuth();
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [filterDraft, setFilterDraft] = useState<FilterState>(INITIAL_FILTERS);
  const [activeFilters, setActiveFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [meta, setMeta] = useState<MetaResponse>({
    priorities: [],
    cities: [],
    responsibles: [],
    sobCatalog: [],
  });
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingMeta, setIsLoadingMeta] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const priorityOptions = useMemo(
    () =>
      Array.from(
        new Set(
          [...PRIORITY_OPTIONS, ...(meta.priorities ?? []).map((item) => normalizePriority(item)).filter(Boolean)],
        ),
      ),
    [meta.priorities],
  );

  const sobBaseMap = useMemo(() => {
    return new Map(meta.sobCatalog.map((item) => [item.sob.toLowerCase(), item]));
  }, [meta.sobCatalog]);

  const loadMeta = useCallback(async () => {
    if (!session?.accessToken) {
      return;
    }

    setIsLoadingMeta(true);

    try {
      const response = await fetch("/api/projects/meta", {
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
      });

      const data = (await response.json().catch(() => ({}))) as MetaResponse & { message?: string };

      if (!response.ok) {
        setFeedback({
          type: "error",
          message: data.message ?? "Falha ao carregar dados de apoio da tela.",
        });
        return;
      }

      setMeta({
        priorities: data.priorities ?? [],
        cities: data.cities ?? [],
        responsibles: data.responsibles ?? [],
        sobCatalog: data.sobCatalog ?? [],
      });
    } catch {
      setFeedback({
        type: "error",
        message: "Falha ao carregar dados de apoio da tela.",
      });
    } finally {
      setIsLoadingMeta(false);
    }
  }, [session?.accessToken]);

  const loadProjects = useCallback(
    async (targetPage: number, filters: FilterState) => {
      if (!session?.accessToken) {
        return;
      }

      setIsLoadingList(true);

      try {
        const query = buildQuery(filters, targetPage);
        const response = await fetch(`/api/projects?${query}`, {
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as {
          projects?: ProjectItem[];
          pagination?: { page: number; pageSize: number; total: number };
          message?: string;
        };

        if (!response.ok) {
          setProjects([]);
          setTotal(0);
          setFeedback({
            type: "error",
            message: data.message ?? "Falha ao carregar projetos.",
          });
          return;
        }

        setProjects(data.projects ?? []);
        setTotal(data.pagination?.total ?? 0);
      } catch {
        setProjects([]);
        setTotal(0);
        setFeedback({
          type: "error",
          message: "Falha ao carregar projetos.",
        });
      } finally {
        setIsLoadingList(false);
      }
    },
    [session?.accessToken],
  );

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    void loadProjects(page, activeFilters);
  }, [activeFilters, loadProjects, page]);

  function handleSobAutoFill(sobValue: string) {
    const base = sobBaseMap.get(sobValue.trim().toLowerCase());
    if (!base) {
      return;
    }

    setForm((current) => ({
      ...current,
      serviceCenter: base.serviceCenter,
      partner: base.partner,
    }));
  }

  function updateFormField<Key extends keyof FormState>(field: Key, value: FormState[Key]) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function updateFilterField<Key extends keyof FilterState>(field: Key, value: FilterState[Key]) {
    setFilterDraft((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session?.accessToken) {
      setFeedback({
        type: "error",
        message: "Sessao invalida para registrar projeto.",
      });
      return;
    }

    const sobRuleError = getSobRuleError(form.priority, form.sob);
    if (sobRuleError) {
      setFeedback({
        type: "error",
        message: sobRuleError,
      });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          ...form,
          sob: normalizeSob(form.sob),
          priority: normalizePriority(form.priority),
        }),
      });

      const data = (await response.json().catch(() => ({}))) as { message?: string };

      if (!response.ok) {
        setFeedback({
          type: "error",
          message: data.message ?? "Falha ao registrar projeto.",
        });
        return;
      }

      setFeedback({
        type: "success",
        message: "Projeto registrado com sucesso.",
      });
      setForm(INITIAL_FORM);

      await Promise.all([loadMeta(), loadProjects(1, activeFilters)]);
      setPage(1);
    } catch {
      setFeedback({
        type: "error",
        message: "Falha ao registrar projeto.",
      });
    } finally {
      setIsSubmitting(false);
    }
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

  function handleListAction(action: "view" | "edit" | "history" | "cancel", sob: string) {
    const actionLabelMap: Record<typeof action, string> = {
      view: "Ver detalhes",
      edit: "Editar",
      history: "Historico",
      cancel: "Cancelar",
    };

    setFeedback({
      type: "success",
      message: `${actionLabelMap[action]} do projeto ${sob} ainda em desenvolvimento.`,
    });
  }

  return (
    <section className={styles.wrapper}>
      <article className={styles.card}>
        <h3 className={styles.cardTitle}>Cadastro de Projeto</h3>

        <form className={styles.formGrid} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>
              Prioridade <span className="requiredMark">*</span>
            </span>
            <select value={form.priority} onChange={(event) => updateFormField("priority", event.target.value)} required>
              <option value="">Selecione</option>
              {priorityOptions.map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>
              Projeto (SOB) <span className="requiredMark">*</span>
            </span>
            <input
              type="text"
              value={form.sob}
              onChange={(event) => updateFormField("sob", normalizeSob(event.target.value))}
              onBlur={(event) => handleSobAutoFill(event.target.value)}
              placeholder="Digite o SOB"
              list="sob-list"
              required
            />
          </label>

          <label className={styles.field}>
            <span>
              Centro de Servico <span className="requiredMark">*</span>
            </span>
            <input
              type="text"
              value={form.serviceCenter}
              onChange={(event) => updateFormField("serviceCenter", event.target.value)}
              placeholder="Preenchimento auto pela base"
              required
            />
          </label>

          <label className={styles.field}>
            <span>
              Parceira <span className="requiredMark">*</span>
            </span>
            <input
              type="text"
              value={form.partner}
              onChange={(event) => updateFormField("partner", event.target.value)}
              placeholder="Preenchimento auto pela base"
              required
            />
          </label>

          <label className={styles.field}>
            <span>
              Tipo de Servico <span className="requiredMark">*</span>
            </span>
            <input
              type="text"
              value={form.serviceType}
              onChange={(event) => updateFormField("serviceType", event.target.value)}
              placeholder="Digite o tipo de servico"
              required
            />
          </label>

          <label className={styles.field}>
            <span>
              Data limite <span className="requiredMark">*</span>
            </span>
            <input
              type="date"
              value={form.executionDeadline}
              onChange={(event) => updateFormField("executionDeadline", event.target.value)}
              required
            />
          </label>

          <label className={styles.field}>
            <span>
              Valor estimado <span className="requiredMark">*</span>
            </span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.estimatedValue}
              onChange={(event) => updateFormField("estimatedValue", event.target.value)}
              placeholder="0,00"
              required
            />
          </label>

          <label className={styles.field}>
            <span>Nivel de Tensao</span>
            <input
              type="text"
              value={form.voltageLevel}
              onChange={(event) => updateFormField("voltageLevel", event.target.value)}
              placeholder="Digite o nivel de tensao"
            />
          </label>

          <label className={styles.field}>
            <span>Porte</span>
            <input
              type="text"
              value={form.projectSize}
              onChange={(event) => updateFormField("projectSize", event.target.value)}
              placeholder="Digite o porte"
            />
          </label>

          <label className={styles.field}>
            <span>
              Responsavel Contratada <span className="requiredMark">*</span>
            </span>
            <input
              type="text"
              value={form.contractorResponsible}
              onChange={(event) => updateFormField("contractorResponsible", event.target.value)}
              placeholder="Digite o responsavel"
              list="responsibles-list"
              required
            />
          </label>

          <label className={styles.field}>
            <span>
              Responsavel Distribuidora <span className="requiredMark">*</span>
            </span>
            <input
              type="text"
              value={form.utilityResponsible}
              onChange={(event) => updateFormField("utilityResponsible", event.target.value)}
              placeholder="Digite o responsavel"
              list="responsibles-list"
              required
            />
          </label>

          <label className={styles.field}>
            <span>
              Gestor de campo Distribuidora <span className="requiredMark">*</span>
            </span>
            <input
              type="text"
              value={form.utilityFieldManager}
              onChange={(event) => updateFormField("utilityFieldManager", event.target.value)}
              placeholder="Digite o gestor de campo"
              list="responsibles-list"
              required
            />
          </label>

          <label className={styles.field}>
            <span>
              Logradouro <span className="requiredMark">*</span>
            </span>
            <input
              type="text"
              value={form.street}
              onChange={(event) => updateFormField("street", event.target.value)}
              placeholder="Digite o logradouro"
              required
            />
          </label>

          <label className={styles.field}>
            <span>
              Bairro <span className="requiredMark">*</span>
            </span>
            <input
              type="text"
              value={form.neighborhood}
              onChange={(event) => updateFormField("neighborhood", event.target.value)}
              placeholder="Digite o bairro"
              required
            />
          </label>

          <label className={styles.field}>
            <span>
              Municipio <span className="requiredMark">*</span>
            </span>
            <input
              type="text"
              value={form.city}
              onChange={(event) => updateFormField("city", event.target.value)}
              placeholder="Digite o municipio"
              list="city-list"
              required
            />
          </label>

          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Descricao do servico</span>
            <textarea
              value={form.serviceDescription}
              onChange={(event) => updateFormField("serviceDescription", event.target.value)}
              placeholder="Digite a descricao do servico"
              rows={3}
            />
          </label>

          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Observacao</span>
            <textarea
              value={form.observation}
              onChange={(event) => updateFormField("observation", event.target.value)}
              placeholder="Digite observacoes complementares"
              rows={3}
            />
          </label>

          <div className={styles.actions}>
            <button type="submit" className={styles.primaryButton} disabled={isSubmitting}>
              {isSubmitting ? "Registrando..." : "Registrar projeto"}
            </button>
          </div>
        </form>
      </article>

      <article className={styles.card}>
        <h3 className={styles.cardTitle}>Filtros</h3>

        <div className={styles.filterGrid}>
          <label className={styles.field}>
            <span>Projeto (SOB)</span>
            <input
              type="text"
              value={filterDraft.sob}
              onChange={(event) => updateFilterField("sob", event.target.value)}
              placeholder="Filtrar por SOB"
            />
          </label>

          <label className={styles.field}>
            <span>Data Execucao</span>
            <input
              type="date"
              value={filterDraft.executionDate}
              onChange={(event) => updateFilterField("executionDate", event.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span>Prioridade</span>
            <select
              value={filterDraft.priority}
              onChange={(event) => updateFilterField("priority", event.target.value)}
            >
              <option value="">Todas</option>
              {priorityOptions.map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Municipio</span>
            <select value={filterDraft.city} onChange={(event) => updateFilterField("city", event.target.value)}>
              <option value="">Todos</option>
              {meta.cities.map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
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
          <h3 className={styles.cardTitle}>Lista de Projetos</h3>
          <div className={styles.tableHint}>
            Listagem paginada no servidor ({PAGE_SIZE} por pagina) para evitar limite de retorno.
          </div>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Projeto (SOB)</th>
                <th>Centro de Servico</th>
                <th>Tipo de Servico</th>
                <th>Data limite</th>
                <th>Municipio</th>
                <th>Valor estimado</th>
                <th>Registrado por</th>
                <th>Atualizado em</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {projects.length > 0
                ? projects.map((project) => (
                    <tr key={project.id}>
                      <td>{project.sob}</td>
                      <td>{project.serviceCenter}</td>
                      <td>{project.serviceType}</td>
                      <td>{formatDate(project.executionDeadline)}</td>
                      <td>{project.city}</td>
                      <td>{formatCurrency(project.estimatedValue)}</td>
                      <td>{project.createdByName}</td>
                      <td>{formatDateTime(project.updatedAt)}</td>
                      <td className={styles.actionsCell}>
                        <div className={styles.tableActions}>
                          <button
                            type="button"
                            className={`${styles.actionButton} ${styles.actionView}`}
                            onClick={() => handleListAction("view", project.sob)}
                            aria-label={`Ver detalhes do projeto ${project.sob}`}
                            title="Ver detalhes"
                          >
                            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <path
                                d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"
                                stroke="currentColor"
                                strokeWidth="1.7"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
                            </svg>
                          </button>

                          <button
                            type="button"
                            className={`${styles.actionButton} ${styles.actionEdit}`}
                            onClick={() => handleListAction("edit", project.sob)}
                            aria-label={`Editar projeto ${project.sob}`}
                            title="Editar"
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
                            onClick={() => handleListAction("history", project.sob)}
                            aria-label={`Historico do projeto ${project.sob}`}
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
                            className={`${styles.actionButton} ${styles.actionCancel}`}
                            onClick={() => handleListAction("cancel", project.sob)}
                            aria-label={`Cancelar projeto ${project.sob}`}
                            title="Cancelar"
                          >
                            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" />
                              <path
                                d="m9.5 9.5 5 5m0-5-5 5"
                                stroke="currentColor"
                                strokeWidth="1.7"
                                strokeLinecap="round"
                              />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                : (
                  <tr>
                    <td colSpan={9} className={styles.emptyRow}>
                      {isLoadingList ? "Carregando projetos..." : "Nenhum projeto encontrado para os filtros informados."}
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

      {feedback ? (
        <div className={feedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError}>{feedback.message}</div>
      ) : null}

      {isLoadingMeta ? <div className={styles.loadingHint}>Atualizando opcoes de cadastro e filtros...</div> : null}

      <datalist id="city-list">
        {meta.cities.map((city) => (
          <option key={city} value={city} />
        ))}
      </datalist>

      <datalist id="sob-list">
        {meta.sobCatalog.map((item) => (
          <option key={item.sob} value={item.sob} />
        ))}
      </datalist>

      <datalist id="responsibles-list">
        {meta.responsibles.map((responsible) => (
          <option key={responsible} value={responsible} />
        ))}
      </datalist>
    </section>
  );
}
