
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
  isActive: boolean;
  cancellationReason: string | null;
  canceledAt: string | null;
  canceledByName: string | null;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

type ProjectHistoryEntry = {
  id: string;
  changeType: "UPDATE" | "CANCEL" | "ACTIVATE";
  createdAt: string;
  createdByName: string;
  changes: Record<string, { from: string | null; to: string | null }>;
};

type FormState = {
  sob: string;
  serviceCenter: string;
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
};

type MetaResponse = {
  priorities: string[];
  serviceCenters: string[];
  serviceTypes: string[];
  voltageLevels: string[];
  projectSizes: string[];
  cities: string[];
  contractorResponsibles: string[];
  utilityResponsibles: string[];
  utilityFieldManagers: string[];
  sobCatalog: SobBaseItem[];
};

type ProjectHistoryResponse = {
  history?: ProjectHistoryEntry[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

const PAGE_SIZE = 20;
const HISTORY_PAGE_SIZE = 5;
const PRIORITY_OPTIONS = ["GRUPO B - FLUXO", "DRP / DRC", "GRUPO A - FLUXO", "FUSESAVER"] as const;
const PRIORITY_A_PREFIX = new Set(["GRUPO B - FLUXO", "DRP / DRC", "GRUPO A - FLUXO"]);
const HISTORY_FIELD_LABELS: Record<string, string> = {
  priority: "Prioridade",
  sob: "Projeto (SOB)",
  serviceCenter: "Centro de Servico",
  serviceType: "Tipo de Servico",
  executionDeadline: "Data limite",
  estimatedValue: "Valor estimado",
  voltageLevel: "Nivel de Tensao",
  projectSize: "Porte",
  contractorResponsible: "Responsavel Contratada",
  utilityResponsible: "Responsavel Distribuidora",
  utilityFieldManager: "Gestor de campo Distribuidora",
  city: "Municipio",
  street: "Logradouro",
  neighborhood: "Bairro",
  serviceDescription: "Descricao do servico",
  observation: "Observacao",
  partner: "Parceira",
  isActive: "Status",
  cancellationReason: "Motivo do cancelamento",
  canceledAt: "Data do cancelamento",
  activationReason: "Motivo da ativacao",
};

const INITIAL_FORM: FormState = {
  sob: "",
  serviceCenter: "",
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

function toFormState(project: ProjectItem): FormState {
  return {
    sob: project.sob,
    serviceCenter: project.serviceCenter,
    serviceType: project.serviceType,
    executionDeadline: project.executionDeadline,
    priority: project.priority,
    estimatedValue: String(project.estimatedValue ?? ""),
    voltageLevel: project.voltageLevel ?? "",
    projectSize: project.projectSize ?? "",
    contractorResponsible: project.contractorResponsible,
    utilityResponsible: project.utilityResponsible,
    utilityFieldManager: project.utilityFieldManager,
    street: project.street,
    neighborhood: project.neighborhood,
    city: project.city,
    serviceDescription: project.serviceDescription ?? "",
    observation: project.observation ?? "",
  };
}

function formatHistoryValue(field: string, value: string | null) {
  if (!value) {
    return "-";
  }

  if (field === "estimatedValue") {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? formatCurrency(numericValue) : value;
  }

  if (field === "isActive") {
    return value === "true" ? "Ativo" : "Inativo";
  }

  if (field === "executionDeadline") {
    return formatDate(value);
  }

  if (field === "canceledAt") {
    return formatDateTime(value);
  }

  return value;
}
export function ProjectsPageView() {
  const { session } = useAuth();
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [filterDraft, setFilterDraft] = useState<FilterState>(INITIAL_FILTERS);
  const [activeFilters, setActiveFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [meta, setMeta] = useState<MetaResponse>({
    priorities: [],
    serviceCenters: [],
    serviceTypes: [],
    voltageLevels: [],
    projectSizes: [],
    cities: [],
    contractorResponsibles: [],
    utilityResponsibles: [],
    utilityFieldManagers: [],
    sobCatalog: [],
  });
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingMeta, setIsLoadingMeta] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [detailProject, setDetailProject] = useState<ProjectItem | null>(null);
  const [historyProject, setHistoryProject] = useState<ProjectItem | null>(null);
  const [historyEntries, setHistoryEntries] = useState<ProjectHistoryEntry[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [cancelProject, setCancelProject] = useState<ProjectItem | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const historyTotalPages = Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE));
  const isSobEnabled = Boolean(form.priority.trim());
  const isEditing = Boolean(editingProjectId);
  const statusAction = cancelProject?.isActive ? "cancel" : "activate";
  const canSubmitCancellation = Boolean(cancelReason.trim()) && !isCancelling;

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
        serviceCenters: data.serviceCenters ?? [],
        serviceTypes: data.serviceTypes ?? [],
        voltageLevels: data.voltageLevels ?? [],
        projectSizes: data.projectSizes ?? [],
        cities: data.cities ?? [],
        contractorResponsibles: data.contractorResponsibles ?? [],
        utilityResponsibles: data.utilityResponsibles ?? [],
        utilityFieldManagers: data.utilityFieldManagers ?? [],
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

  function resetFormState() {
    setForm(INITIAL_FORM);
    setEditingProjectId(null);
  }

  function handleSobAutoFill(sobValue: string) {
    const base = sobBaseMap.get(sobValue.trim().toLowerCase());
    if (!base) {
      return;
    }

    setForm((current) => ({
      ...current,
      serviceCenter: base.serviceCenter,
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

  function handleEditProject(project: ProjectItem) {
    setEditingProjectId(project.id);
    setForm(toFormState(project));
    setFeedback(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleViewProject(project: ProjectItem) {
    setDetailProject(project);
  }

  function closeHistoryModal() {
    setHistoryProject(null);
    setHistoryEntries([]);
    setHistoryPage(1);
    setHistoryTotal(0);
    setIsLoadingHistory(false);
  }

  function openCancelModal(project: ProjectItem) {
    setCancelProject(project);
    setCancelReason("");
  }

  function closeCancelModal() {
    setCancelProject(null);
    setCancelReason("");
    setIsCancelling(false);
  }
  async function loadProjectHistory(project: ProjectItem, targetPage: number) {
    if (!session?.accessToken) {
      setFeedback({
        type: "error",
        message: "Sessao invalida para carregar historico.",
      });
      return;
    }

    setIsLoadingHistory(true);

    try {
      const params = new URLSearchParams();
      params.set("historyProjectId", project.id);
      params.set("historyPage", String(targetPage));
      params.set("historyPageSize", String(HISTORY_PAGE_SIZE));

      const response = await fetch(`/api/projects?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
      });

      const data = (await response.json().catch(() => ({}))) as ProjectHistoryResponse;

      if (!response.ok) {
        setFeedback({
          type: "error",
          message: data.message ?? "Falha ao carregar historico do projeto.",
        });
        setHistoryEntries([]);
        setHistoryTotal(0);
        return;
      }

      setHistoryEntries(data.history ?? []);
      setHistoryPage(data.pagination?.page ?? targetPage);
      setHistoryTotal(data.pagination?.total ?? 0);
    } catch {
      setFeedback({
        type: "error",
        message: "Falha ao carregar historico do projeto.",
      });
      setHistoryEntries([]);
      setHistoryTotal(0);
    } finally {
      setIsLoadingHistory(false);
    }
  }

  async function openHistoryModal(project: ProjectItem) {
    setHistoryProject(project);
    setHistoryEntries([]);
    setHistoryPage(1);
    setHistoryTotal(0);
    await loadProjectHistory(project, 1);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session?.accessToken) {
      setFeedback({
        type: "error",
        message: isEditing ? "Sessao invalida para editar projeto." : "Sessao invalida para registrar projeto.",
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
        method: isEditing ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          ...(isEditing ? { id: editingProjectId } : {}),
          ...form,
          sob: normalizeSob(form.sob),
          priority: normalizePriority(form.priority),
        }),
      });

      const data = (await response.json().catch(() => ({}))) as { message?: string };

      if (!response.ok) {
        setFeedback({
          type: "error",
          message:
            data.message ??
            (isEditing
              ? `Falha ao editar projeto ${normalizeSob(form.sob)}.`
              : `Falha ao registrar projeto ${normalizeSob(form.sob)}.`),
        });
        return;
      }

      setFeedback({
        type: "success",
        message:
          data.message ??
          (isEditing
            ? `Projeto ${normalizeSob(form.sob)} atualizado com sucesso.`
            : `Projeto ${normalizeSob(form.sob)} registrado com sucesso.`),
      });

      resetFormState();
      await Promise.all([loadMeta(), loadProjects(1, activeFilters)]);
      setPage(1);
    } catch {
      setFeedback({
        type: "error",
        message: isEditing ? `Falha ao editar projeto ${normalizeSob(form.sob)}.` : `Falha ao registrar projeto ${normalizeSob(form.sob)}.`,
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function confirmCancellation() {
    if (!session?.accessToken || !cancelProject || !cancelReason.trim()) {
      return;
    }

    setIsCancelling(true);
    const action = cancelProject.isActive ? "cancel" : "activate";
    const actionLabel = action === "cancel" ? "cancelar" : "ativar";

    try {
      const response = await fetch("/api/projects", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          id: cancelProject.id,
          reason: cancelReason.trim(),
          action,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as { message?: string };

      if (!response.ok) {
        setFeedback({
          type: "error",
          message: data.message ?? `Falha ao ${actionLabel} projeto ${cancelProject.sob}.`,
        });
        return;
      }

      setFeedback({
        type: "success",
        message:
          data.message ??
          (action === "cancel"
            ? `Projeto ${cancelProject.sob} cancelado com sucesso.`
            : `Projeto ${cancelProject.sob} ativado com sucesso.`),
      });

      if (editingProjectId === cancelProject.id) {
        resetFormState();
      }

      closeCancelModal();
      await loadProjects(page, activeFilters);
    } catch {
      setFeedback({
        type: "error",
        message: `Falha ao ${actionLabel} projeto ${cancelProject.sob}.`,
      });
    } finally {
      setIsCancelling(false);
    }
  }

  return (
    <section className={styles.wrapper}>
      {feedback ? (
        <div className={feedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError}>{feedback.message}</div>
      ) : null}

      {isLoadingMeta ? <div className={styles.loadingHint}>Atualizando opcoes de cadastro e filtros...</div> : null}

      <article className={styles.card}>
        <h3 className={styles.cardTitle}>{isEditing ? "Editar Projeto" : "Cadastro de Projeto"}</h3>

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
              placeholder={isSobEnabled ? "Digite o SOB" : "Selecione a Prioridade primeiro"}
              list="sob-list"
              disabled={!isSobEnabled}
              aria-disabled={!isSobEnabled}
              required
            />
          </label>

          <label className={styles.field}>
            <span>
              Centro de Servico <span className="requiredMark">*</span>
            </span>
            <select
              value={form.serviceCenter}
              onChange={(event) => updateFormField("serviceCenter", event.target.value)}
              required
            >
              <option value="">Selecione</option>
              {meta.serviceCenters.map((serviceCenter) => (
                <option key={serviceCenter} value={serviceCenter}>
                  {serviceCenter}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>
              Tipo de Servico <span className="requiredMark">*</span>
            </span>
            <select value={form.serviceType} onChange={(event) => updateFormField("serviceType", event.target.value)} required>
              <option value="">Selecione</option>
              {meta.serviceTypes.map((serviceType) => (
                <option key={serviceType} value={serviceType}>
                  {serviceType}
                </option>
              ))}
            </select>
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
            <select value={form.voltageLevel} onChange={(event) => updateFormField("voltageLevel", event.target.value)}>
              <option value="">Selecione</option>
              {meta.voltageLevels.map((voltageLevel) => (
                <option key={voltageLevel} value={voltageLevel}>
                  {voltageLevel}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Porte</span>
            <select value={form.projectSize} onChange={(event) => updateFormField("projectSize", event.target.value)}>
              <option value="">Selecione</option>
              {meta.projectSizes.map((projectSize) => (
                <option key={projectSize} value={projectSize}>
                  {projectSize}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>
              Responsavel Contratada <span className="requiredMark">*</span>
            </span>
            <select
              value={form.contractorResponsible}
              onChange={(event) => updateFormField("contractorResponsible", event.target.value)}
              required
            >
              <option value="">Selecione</option>
              {meta.contractorResponsibles.map((responsible) => (
                <option key={responsible} value={responsible}>
                  {responsible}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>
              Responsavel Distribuidora <span className="requiredMark">*</span>
            </span>
            <select
              value={form.utilityResponsible}
              onChange={(event) => updateFormField("utilityResponsible", event.target.value)}
              required
            >
              <option value="">Selecione</option>
              {meta.utilityResponsibles.map((responsible) => (
                <option key={responsible} value={responsible}>
                  {responsible}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>
              Gestor de campo Distribuidora <span className="requiredMark">*</span>
            </span>
            <select
              value={form.utilityFieldManager}
              onChange={(event) => updateFormField("utilityFieldManager", event.target.value)}
              required
            >
              <option value="">Selecione</option>
              {meta.utilityFieldManagers.map((responsible) => (
                <option key={responsible} value={responsible}>
                  {responsible}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>
              Municipio <span className="requiredMark">*</span>
            </span>
            <select value={form.city} onChange={(event) => updateFormField("city", event.target.value)} required>
              <option value="">Selecione</option>
              {meta.cities.map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
            </select>
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

          <div className={`${styles.actions} ${styles.formActions}`}>
            <button type="submit" className={styles.primaryButton} disabled={isSubmitting}>
              {isSubmitting ? (isEditing ? "Salvando..." : "Registrando...") : isEditing ? "Salvar alteracoes" : "Registrar projeto"}
            </button>
            {isEditing ? (
              <button type="button" className={styles.ghostButton} onClick={resetFormState} disabled={isSubmitting}>
                Cancelar edicao
              </button>
            ) : null}
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
                    <tr key={project.id} className={!project.isActive ? styles.inactiveRow : undefined}>
                      <td>
                        <div className={styles.sobCell}>
                          <span>{project.sob}</span>
                          {!project.isActive ? <span className={styles.statusTag}>Inativo</span> : null}
                        </div>
                      </td>
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
                            onClick={() => handleViewProject(project)}
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
                            onClick={() => handleEditProject(project)}
                            aria-label={`Editar projeto ${project.sob}`}
                            title="Editar"
                            disabled={!project.isActive}
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
                            onClick={() => void openHistoryModal(project)}
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
                            className={`${styles.actionButton} ${
                              project.isActive ? styles.actionCancel : styles.actionActivate
                            }`}
                            onClick={() => openCancelModal(project)}
                            aria-label={`${project.isActive ? "Cancelar" : "Ativar"} projeto ${project.sob}`}
                            title={project.isActive ? "Cancelar" : "Ativar"}
                          >
                            {project.isActive ? (
                              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" />
                                <path
                                  d="m9.5 9.5 5 5m0-5-5 5"
                                  stroke="currentColor"
                                  strokeWidth="1.7"
                                  strokeLinecap="round"
                                />
                              </svg>
                            ) : (
                              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" />
                                <path
                                  d="m8.5 12 2.2 2.2 4.8-4.8"
                                  stroke="currentColor"
                                  strokeWidth="1.7"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            )}
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

      {detailProject ? (
        <div className={styles.modalOverlay} onClick={() => setDetailProject(null)}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Detalhes do Projeto {detailProject.sob}</h4>
                <p className={styles.modalSubtitle}>ID do projeto: {detailProject.id}</p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={() => setDetailProject(null)}>
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              <div className={styles.detailGrid}>
                <div><strong>Status:</strong> {detailProject.isActive ? "Ativo" : "Inativo"}</div>
                <div><strong>Prioridade:</strong> {detailProject.priority}</div>
                <div><strong>Centro de Servico:</strong> {detailProject.serviceCenter}</div>
                <div><strong>Parceira:</strong> {detailProject.partner}</div>
                <div><strong>Tipo de Servico:</strong> {detailProject.serviceType}</div>
                <div><strong>Data limite:</strong> {formatDate(detailProject.executionDeadline)}</div>
                <div><strong>Valor estimado:</strong> {formatCurrency(detailProject.estimatedValue)}</div>
                <div><strong>Nivel de Tensao:</strong> {detailProject.voltageLevel ?? "-"}</div>
                <div><strong>Porte:</strong> {detailProject.projectSize ?? "-"}</div>
                <div><strong>Responsavel Contratada:</strong> {detailProject.contractorResponsible}</div>
                <div><strong>Responsavel Distribuidora:</strong> {detailProject.utilityResponsible}</div>
                <div><strong>Gestor de campo Distribuidora:</strong> {detailProject.utilityFieldManager}</div>
                <div><strong>Municipio:</strong> {detailProject.city}</div>
                <div><strong>Logradouro:</strong> {detailProject.street}</div>
                <div><strong>Bairro:</strong> {detailProject.neighborhood}</div>
                <div><strong>Descricao do servico:</strong> {detailProject.serviceDescription ?? "-"}</div>
                <div><strong>Observacao:</strong> {detailProject.observation ?? "-"}</div>
                <div><strong>Registrado por:</strong> {detailProject.createdByName}</div>
                <div><strong>Criado em:</strong> {formatDateTime(detailProject.createdAt)}</div>
                <div><strong>Atualizado por:</strong> {detailProject.updatedByName}</div>
                <div><strong>Atualizado em:</strong> {formatDateTime(detailProject.updatedAt)}</div>
                {!detailProject.isActive ? (
                  <>
                    <div><strong>Cancelado em:</strong> {formatDateTime(detailProject.canceledAt ?? "")}</div>
                    <div><strong>Cancelado por:</strong> {detailProject.canceledByName ?? "-"}</div>
                    <div className={styles.detailWide}><strong>Motivo do cancelamento:</strong> {detailProject.cancellationReason ?? "-"}</div>
                  </>
                ) : null}
              </div>
            </div>
          </article>
        </div>
      ) : null}

      {historyProject ? (
        <div className={styles.modalOverlay} onClick={closeHistoryModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Historico do Projeto {historyProject.sob}</h4>
                <p className={styles.modalSubtitle}>ID do projeto: {historyProject.id}</p>
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
                              : "Edicao"}
                        </strong>
                        <span>{formatDateTime(entry.createdAt)} | {entry.createdByName}</span>
                      </header>

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

              {!isLoadingHistory && historyEntries.length > 0 ? (
                <div className={styles.pagination}>
                  <span>
                    Pagina {Math.min(historyPage, historyTotalPages)} de {historyTotalPages} | Total: {historyTotal}
                  </span>

                  <div className={styles.paginationActions}>
                    <button
                      type="button"
                      className={styles.ghostButton}
                      onClick={() => historyProject && void loadProjectHistory(historyProject, Math.max(1, historyPage - 1))}
                      disabled={historyPage <= 1 || isLoadingHistory}
                    >
                      Anterior
                    </button>
                    <button
                      type="button"
                      className={styles.ghostButton}
                      onClick={() =>
                        historyProject && void loadProjectHistory(historyProject, Math.min(historyTotalPages, historyPage + 1))
                      }
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

      {cancelProject ? (
        <div className={styles.modalOverlay} onClick={closeCancelModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <h4>{cancelProject.isActive ? "Cancelar" : "Ativar"} Projeto {cancelProject.sob}</h4>
              <button type="button" className={styles.modalCloseButton} onClick={closeCancelModal}>
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              <p>
                {cancelProject.isActive
                  ? "Informe o motivo do cancelamento. O botao validar so fica ativo quando o motivo for preenchido."
                  : "Informe o motivo da ativacao. O botao validar so fica ativo quando o motivo for preenchido."}
              </p>

              <label className={styles.field}>
                <span>
                  {cancelProject.isActive ? "Motivo do cancelamento" : "Motivo da ativacao"}{" "}
                  <span className="requiredMark">*</span>
                </span>
                <textarea
                  value={cancelReason}
                  onChange={(event) => setCancelReason(event.target.value)}
                  rows={4}
                  placeholder="Digite o motivo"
                />
              </label>

              <div className={styles.actions}>
                <button
                  type="button"
                  className={statusAction === "cancel" ? styles.dangerButton : styles.primaryButton}
                  onClick={() => void confirmCancellation()}
                  disabled={!canSubmitCancellation}
                >
                  {isCancelling ? (statusAction === "cancel" ? "Cancelando..." : "Ativando...") : `Validar ${statusAction === "cancel" ? "cancelamento" : "ativacao"}`}
                </button>
                <button type="button" className={styles.ghostButton} onClick={closeCancelModal} disabled={isCancelling}>
                  Voltar
                </button>
              </div>
            </div>
          </article>
        </div>
      ) : null}

      <datalist id="sob-list">
        {meta.sobCatalog.map((item) => (
          <option key={item.sob} value={item.sob} />
        ))}
      </datalist>
    </section>
  );
}
