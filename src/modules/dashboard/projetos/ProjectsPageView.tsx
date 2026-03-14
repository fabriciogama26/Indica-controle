
"use client";

import { FormEvent, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";

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
  hasLocacao: boolean;
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

type ForecastFilterState = {
  code: string;
  description: string;
  type: string;
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

type ProjectListResponse = {
  projects?: ProjectItem[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

type ProjectForecastItem = {
  id: string;
  materialId: string;
  code: string;
  description: string;
  umb: string | null;
  type: string | null;
  qtyPlanned: number;
  observation: string | null;
  source: string;
  importedAt: string;
  updatedAt: string;
};

type ProjectForecastResponse = {
  project?: { id: string; sob: string };
  items?: ProjectForecastItem[];
  message?: string;
};

type ProjectForecastCatalogItem = {
  id: string;
  code: string;
  description: string;
  umb: string | null;
  type: string | null;
};

type ProjectForecastDraft = {
  quantity: string;
  observation: string;
};

type ProjectForecastImportResponse = {
  success?: boolean;
  message?: string;
  errors?: string[];
  reason?: string;
  codes?: string[];
  summary?: {
    projectId: string;
    projectSob: string;
    rowsRead: number;
    materialsRegistered: number;
    sourceFile: string;
  };
};

type ProjectActivityForecastItem = {
  id: string;
  activityId: string;
  code: string;
  description: string;
  type: string | null;
  unit: string;
  unitValue: number;
  qtyPlanned: number;
  observation: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
};

type ProjectActivityForecastResponse = {
  project?: { id: string; sob: string };
  items?: ProjectActivityForecastItem[];
  message?: string;
};

type ProjectActivityForecastCatalogItem = {
  id: string;
  code: string;
  description: string;
  unit: string;
  unitValue: number;
  type: string | null;
};

type ProjectActivityForecastDraft = {
  quantity: string;
  observation: string;
};

const PAGE_SIZE = 20;
const HISTORY_PAGE_SIZE = 5;
const EXPORT_PAGE_SIZE = 100;
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

const INITIAL_FORECAST_FILTERS: ForecastFilterState = {
  code: "",
  description: "",
  type: "",
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

function buildQuery(filters: FilterState, page: number, pageSize = PAGE_SIZE) {
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
  params.set("pageSize", String(pageSize));
  return params.toString();
}

function escapeCsvValue(value: string | number | null | undefined) {
  const raw = String(value ?? "").replace(/\r?\n|\r/g, " ").trim();
  if (raw.includes(";") || raw.includes('"')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function buildProjectsCsv(projectItems: ProjectItem[]) {
  const header = [
    "Projeto (SOB)",
    "Centro de Servico",
    "Tipo de Servico",
    "Data limite",
    "Municipio",
    "Valor estimado",
    "Registrado por",
    "Registrado em",
    "Status",
  ];

  const rows = projectItems.map((project) => [
    project.sob,
    project.serviceCenter,
    project.serviceType,
    formatDate(project.executionDeadline),
    project.city,
    project.estimatedValue.toFixed(2),
    project.createdByName,
    formatDateTime(project.createdAt),
    project.isActive ? "Ativo" : "Inativo",
  ]);

  const csvLines = [header, ...rows].map((line) => line.map((item) => escapeCsvValue(item)).join(";"));
  return `\uFEFF${csvLines.join("\n")}`;
}

function buildForecastCsv(forecastItems: ProjectForecastItem[]) {
  const header = ["Codigo", "Descricao", "UMB", "Tipo", "Quantidade prevista", "Atualizado em"];
  const rows = forecastItems.map((item) => [
    item.code,
    item.description,
    item.umb ?? "",
    item.type ?? "",
    item.qtyPlanned,
    formatDateTime(item.updatedAt),
  ]);

  const csvLines = [header, ...rows].map((line) => line.map((item) => escapeCsvValue(item)).join(";"));
  return `\uFEFF${csvLines.join("\n")}`;
}

function buildActivityForecastCsv(forecastItems: ProjectActivityForecastItem[]) {
  const header = ["Codigo", "Descricao", "Tipo", "Unidade", "Valor unitario", "Quantidade prevista", "Atualizado em"];
  const rows = forecastItems.map((item) => [
    item.code,
    item.description,
    item.type ?? "",
    item.unit,
    item.unitValue.toFixed(2),
    item.qtyPlanned,
    formatDateTime(item.updatedAt),
  ]);

  const csvLines = [header, ...rows].map((line) => line.map((entry) => escapeCsvValue(entry)).join(";"));
  return `\uFEFF${csvLines.join("\n")}`;
}

function downloadCsvFile(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadBlobFile(content: Blob, filename: string) {
  const url = URL.createObjectURL(content);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function supabaseFunctionsBaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
}

function supabaseAnonKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
}

function normalizePriority(value: string) {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeSob(value: string) {
  return String(value ?? "").trim().toUpperCase();
}

function forecastOptionLabel(item: ProjectForecastCatalogItem) {
  return `${item.code} - ${item.description}`;
}

function activityForecastOptionLabel(item: ProjectActivityForecastCatalogItem) {
  return `${item.code} - ${item.description}`;
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
  const [activeTab, setActiveTab] = useState<"project" | "forecast" | "activityForecast">("project");
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [filterDraft, setFilterDraft] = useState<FilterState>(INITIAL_FILTERS);
  const [activeFilters, setActiveFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [forecastFilterDraft, setForecastFilterDraft] = useState<ForecastFilterState>(INITIAL_FORECAST_FILTERS);
  const [activeForecastFilters, setActiveForecastFilters] = useState<ForecastFilterState>(INITIAL_FORECAST_FILTERS);
  const [activityForecastFilterDraft, setActivityForecastFilterDraft] = useState<ForecastFilterState>(INITIAL_FORECAST_FILTERS);
  const [activeActivityForecastFilters, setActiveActivityForecastFilters] = useState<ForecastFilterState>(INITIAL_FORECAST_FILTERS);
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
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingForecast, setIsExportingForecast] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [detailProject, setDetailProject] = useState<ProjectItem | null>(null);
  const [historyProject, setHistoryProject] = useState<ProjectItem | null>(null);
  const [historyEntries, setHistoryEntries] = useState<ProjectHistoryEntry[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [forecastProject, setForecastProject] = useState<{ id: string; sob: string } | null>(null);
  const [forecastProjectSearch, setForecastProjectSearch] = useState("");
  const [forecastItems, setForecastItems] = useState<ProjectForecastItem[]>([]);
  const [forecastSearch, setForecastSearch] = useState("");
  const [forecastQty, setForecastQty] = useState("");
  const [forecastCatalogItems, setForecastCatalogItems] = useState<ProjectForecastCatalogItem[]>([]);
  const [forecastDrafts, setForecastDrafts] = useState<Record<string, ProjectForecastDraft>>({});
  const [isLoadingForecast, setIsLoadingForecast] = useState(false);
  const [isSavingProjectForecast, setIsSavingProjectForecast] = useState(false);
  const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false);
  const [isForecastImportModalOpen, setIsForecastImportModalOpen] = useState(false);
  const [forecastImportFile, setForecastImportFile] = useState<File | null>(null);
  const [isImportingForecast, setIsImportingForecast] = useState(false);
  const [activityForecastProject, setActivityForecastProject] = useState<{ id: string; sob: string } | null>(null);
  const [activityForecastProjectSearch, setActivityForecastProjectSearch] = useState("");
  const [activityForecastItems, setActivityForecastItems] = useState<ProjectActivityForecastItem[]>([]);
  const [isLoadingActivityForecast, setIsLoadingActivityForecast] = useState(false);
  const [isDownloadingActivityForecastTemplate, setIsDownloadingActivityForecastTemplate] = useState(false);
  const [isActivityForecastImportModalOpen, setIsActivityForecastImportModalOpen] = useState(false);
  const [activityForecastImportFile, setActivityForecastImportFile] = useState<File | null>(null);
  const [isImportingActivityForecast, setIsImportingActivityForecast] = useState(false);
  const [isExportingActivityForecast, setIsExportingActivityForecast] = useState(false);
  const [activityForecastSearch, setActivityForecastSearch] = useState("");
  const [activityForecastQty, setActivityForecastQty] = useState("");
  const [activityForecastCatalogItems, setActivityForecastCatalogItems] = useState<ProjectActivityForecastCatalogItem[]>([]);
  const [activityForecastDrafts, setActivityForecastDrafts] = useState<Record<string, ProjectActivityForecastDraft>>({});
  const [isSavingProjectActivityForecast, setIsSavingProjectActivityForecast] = useState(false);
  const [cancelProject, setCancelProject] = useState<ProjectItem | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const deferredForecastSearch = useDeferredValue(forecastSearch);
  const deferredActivityForecastSearch = useDeferredValue(activityForecastSearch);

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

  const filteredForecastItems = useMemo(() => {
    return (forecastItems ?? []).filter((item) => {
      if (activeForecastFilters.code.trim()) {
        const codeFilter = activeForecastFilters.code.trim().toLowerCase();
        if (!item.code.toLowerCase().includes(codeFilter)) {
          return false;
        }
      }

      if (activeForecastFilters.description.trim()) {
        const descriptionFilter = activeForecastFilters.description.trim().toLowerCase();
        if (!item.description.toLowerCase().includes(descriptionFilter)) {
          return false;
        }
      }

      if (activeForecastFilters.type.trim()) {
        const typeFilter = activeForecastFilters.type.trim().toLowerCase();
        if (!(item.type ?? "").toLowerCase().includes(typeFilter)) {
          return false;
        }
      }

      return true;
    });
  }, [activeForecastFilters, forecastItems]);

  const filteredActivityForecastItems = useMemo(() => {
    return (activityForecastItems ?? []).filter((item) => {
      if (activeActivityForecastFilters.code.trim()) {
        const codeFilter = activeActivityForecastFilters.code.trim().toLowerCase();
        if (!item.code.toLowerCase().includes(codeFilter)) {
          return false;
        }
      }

      if (activeActivityForecastFilters.description.trim()) {
        const descriptionFilter = activeActivityForecastFilters.description.trim().toLowerCase();
        if (!item.description.toLowerCase().includes(descriptionFilter)) {
          return false;
        }
      }

      if (activeActivityForecastFilters.type.trim()) {
        const typeFilter = activeActivityForecastFilters.type.trim().toLowerCase();
        if (!(item.type ?? "").toLowerCase().includes(typeFilter)) {
          return false;
        }
      }

      return true;
    });
  }, [activeActivityForecastFilters, activityForecastItems]);

  const selectedProjectActivityForecastOption = useMemo(
    () => activityForecastCatalogItems.find((item) => activityForecastOptionLabel(item) === activityForecastSearch) ?? null,
    [activityForecastCatalogItems, activityForecastSearch],
  );

  const selectedProjectForecastOption = useMemo(
    () => forecastCatalogItems.find((item) => forecastOptionLabel(item) === forecastSearch) ?? null,
    [forecastCatalogItems, forecastSearch],
  );

  const loadMeta = useCallback(async () => {
    if (!session?.accessToken) {
      return;
    }

    setIsLoadingMeta(true);

    try {
      const response = await fetch("/api/projects/meta", {
        cache: "no-store",
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
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as ProjectListResponse;

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

  useEffect(() => {
    if (!session?.accessToken || !forecastProject || deferredForecastSearch.trim().length < 2) {
      setForecastCatalogItems([]);
      return;
    }

    fetch(`/api/projects/forecast/catalog?q=${encodeURIComponent(deferredForecastSearch.trim())}`, {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
      },
    })
      .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) {
          throw new Error(data?.message ?? "Falha ao pesquisar materiais previstos.");
        }
        setForecastCatalogItems(data?.items ?? []);
      })
      .catch(() => {
        setForecastCatalogItems([]);
      });
  }, [deferredForecastSearch, forecastProject, session?.accessToken]);

  useEffect(() => {
    if (!session?.accessToken || !activityForecastProject || deferredActivityForecastSearch.trim().length < 2) {
      setActivityForecastCatalogItems([]);
      return;
    }

    fetch(`/api/projects/activity-forecast/catalog?q=${encodeURIComponent(deferredActivityForecastSearch.trim())}`, {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
      },
    })
      .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) {
          throw new Error(data?.message ?? "Falha ao pesquisar atividades previstas.");
        }
        setActivityForecastCatalogItems(data?.items ?? []);
      })
      .catch(() => {
        setActivityForecastCatalogItems([]);
      });
  }, [activityForecastProject, deferredActivityForecastSearch, session?.accessToken]);

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

  function updateForecastFilterField<Key extends keyof ForecastFilterState>(
    field: Key,
    value: ForecastFilterState[Key],
  ) {
    setForecastFilterDraft((current) => ({
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

  function applyForecastFilters() {
    setActiveForecastFilters(forecastFilterDraft);
    setFeedback(null);
  }

  function clearForecastFilters() {
    setForecastFilterDraft(INITIAL_FORECAST_FILTERS);
    setActiveForecastFilters(INITIAL_FORECAST_FILTERS);
    setFeedback(null);
  }

  function applyActivityForecastFilters() {
    setActiveActivityForecastFilters(activityForecastFilterDraft);
    setFeedback(null);
  }

  function clearActivityForecastFilters() {
    setActivityForecastFilterDraft(INITIAL_FORECAST_FILTERS);
    setActiveActivityForecastFilters(INITIAL_FORECAST_FILTERS);
    setFeedback(null);
  }

  function handleEditProject(project: ProjectItem) {
    setEditingProjectId(project.id);
    setForm(toFormState(project));
    setFeedback(null);
    scrollDashboardContentToTop();
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
        cache: "no-store",
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

  async function loadForecast(projectId: string) {
    if (!session?.accessToken) {
      setFeedback({
        type: "error",
        message: "Sessao invalida para consultar materiais previstos.",
      });
      return;
    }

    setIsLoadingForecast(true);
    try {
      const params = new URLSearchParams();
      params.set("projectId", projectId);

      const response = await fetch(`/api/projects/forecast?${params.toString()}`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
      });

      const data = (await response.json().catch(() => ({}))) as ProjectForecastResponse;
      if (!response.ok) {
        setForecastItems([]);
        setForecastDrafts({});
        setFeedback({
          type: "error",
          message: data.message ?? "Falha ao carregar materiais previstos.",
        });
        return;
      }

      if (data.project?.id && data.project?.sob) {
        setForecastProject({
          id: data.project.id,
          sob: data.project.sob,
        });
      }
      setForecastItems(data.items ?? []);
      setForecastDrafts(
        Object.fromEntries(
          (data.items ?? []).map((item) => [item.id, { quantity: String(item.qtyPlanned), observation: item.observation ?? "" }]),
        ),
      );
    } catch {
      setForecastItems([]);
      setForecastDrafts({});
      setFeedback({
        type: "error",
        message: "Falha ao carregar materiais previstos.",
      });
    } finally {
      setIsLoadingForecast(false);
    }
  }

  async function openForecastTab(project: ProjectItem) {
    setActiveTab("forecast");
    setForecastProject({ id: project.id, sob: project.sob });
    setForecastProjectSearch(project.sob);
    setForecastItems([]);
    setForecastCatalogItems([]);
    setForecastDrafts({});
    setForecastSearch("");
    setForecastQty("");
    setForecastFilterDraft(INITIAL_FORECAST_FILTERS);
    setActiveForecastFilters(INITIAL_FORECAST_FILTERS);
    setFeedback(null);
    scrollDashboardContentToTop();
    await loadForecast(project.id);
  }

  async function handleForecastProjectSelection(projectId: string) {
    if (!projectId) {
      setForecastProject(null);
      setForecastProjectSearch("");
      setForecastItems([]);
      setForecastCatalogItems([]);
      setForecastDrafts({});
      setForecastSearch("");
      setForecastQty("");
      setForecastFilterDraft(INITIAL_FORECAST_FILTERS);
      setActiveForecastFilters(INITIAL_FORECAST_FILTERS);
      return;
    }

    const selectedProject = projects.find((item) => item.id === projectId);
    setForecastProject(selectedProject ? { id: selectedProject.id, sob: selectedProject.sob } : { id: projectId, sob: "" });
    setForecastProjectSearch(selectedProject?.sob ?? "");
    setForecastItems([]);
    setForecastCatalogItems([]);
    setForecastDrafts({});
    setForecastSearch("");
    setForecastQty("");
    setForecastFilterDraft(INITIAL_FORECAST_FILTERS);
    setActiveForecastFilters(INITIAL_FORECAST_FILTERS);
    await loadForecast(projectId);
  }

  function handleForecastProjectSearchChange(value: string) {
    const normalizedSob = normalizeSob(value);
    setForecastProjectSearch(normalizedSob);

    if (!normalizedSob) {
      void handleForecastProjectSelection("");
      return;
    }

    const matchedProject = projects.find((project) => normalizeSob(project.sob) === normalizedSob);
    if (matchedProject) {
      void handleForecastProjectSelection(matchedProject.id);
      return;
    }

    if (forecastProject && normalizeSob(forecastProject.sob) !== normalizedSob) {
      setForecastProject(null);
      setForecastItems([]);
      setForecastDrafts({});
    }
  }

  async function addProjectForecast() {
    if (!session?.accessToken || !forecastProject || !selectedProjectForecastOption || !forecastQty.trim()) {
      setFeedback({
        type: "error",
        message: "Selecione um material valido e informe a quantidade para adicionar ao projeto.",
      });
      return;
    }

    setIsSavingProjectForecast(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/projects/forecast", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          projectId: forecastProject.id,
          materialId: selectedProjectForecastOption.id,
          quantity: forecastQty,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as ProjectForecastResponse;
      if (!response.ok) {
        setFeedback({
          type: "error",
          message: data.message ?? "Falha ao adicionar material previsto ao projeto.",
        });
        return;
      }

      setForecastItems(data.items ?? []);
      setForecastDrafts(
        Object.fromEntries(
          (data.items ?? []).map((item) => [item.id, { quantity: String(item.qtyPlanned), observation: item.observation ?? "" }]),
        ),
      );
      setForecastSearch("");
      setForecastQty("");
      setForecastCatalogItems([]);
      setFeedback({
        type: "success",
        message: data.message ?? "Material previsto adicionado ao projeto com sucesso.",
      });
    } catch {
      setFeedback({
        type: "error",
        message: "Falha ao adicionar material previsto ao projeto.",
      });
    } finally {
      setIsSavingProjectForecast(false);
    }
  }

  async function saveProjectForecastRow(itemId: string) {
    if (!session?.accessToken || !forecastProject) {
      return;
    }

    const draft = forecastDrafts[itemId];
    if (!draft?.quantity.trim()) {
      setFeedback({
        type: "error",
        message: "Informe a quantidade prevista antes de salvar o material.",
      });
      return;
    }

    setIsSavingProjectForecast(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/projects/forecast", {
        method: "PUT",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          projectId: forecastProject.id,
          id: itemId,
          quantity: draft.quantity,
          observation: draft.observation,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as ProjectForecastResponse;
      if (!response.ok) {
        setFeedback({
          type: "error",
          message: data.message ?? "Falha ao salvar material previsto do projeto.",
        });
        return;
      }

      setForecastItems(data.items ?? []);
      setForecastDrafts(
        Object.fromEntries(
          (data.items ?? []).map((item) => [item.id, { quantity: String(item.qtyPlanned), observation: item.observation ?? "" }]),
        ),
      );
      setFeedback({
        type: "success",
        message: data.message ?? "Material previsto do projeto atualizado com sucesso.",
      });
    } catch {
      setFeedback({
        type: "error",
        message: "Falha ao salvar material previsto do projeto.",
      });
    } finally {
      setIsSavingProjectForecast(false);
    }
  }

  async function loadActivityForecast(projectId: string) {
    if (!session?.accessToken) {
      setFeedback({
        type: "error",
        message: "Sessao invalida para consultar atividades previstas.",
      });
      return;
    }

    setIsLoadingActivityForecast(true);
    try {
      const params = new URLSearchParams();
      params.set("projectId", projectId);

      const response = await fetch(`/api/projects/activity-forecast?${params.toString()}`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
      });

      const data = (await response.json().catch(() => ({}))) as ProjectActivityForecastResponse;
      if (!response.ok) {
        setActivityForecastItems([]);
        setActivityForecastDrafts({});
        setFeedback({
          type: "error",
          message: data.message ?? "Falha ao carregar atividades previstas.",
        });
        return;
      }

      if (data.project?.id && data.project?.sob) {
        setActivityForecastProject({
          id: data.project.id,
          sob: data.project.sob,
        });
      }
      setActivityForecastItems(data.items ?? []);
      setActivityForecastDrafts(
        Object.fromEntries(
          (data.items ?? []).map((item) => [item.id, { quantity: String(item.qtyPlanned), observation: item.observation ?? "" }]),
        ),
      );
    } catch {
      setActivityForecastItems([]);
      setActivityForecastDrafts({});
      setFeedback({
        type: "error",
        message: "Falha ao carregar atividades previstas.",
      });
    } finally {
      setIsLoadingActivityForecast(false);
    }
  }

  async function openActivityForecastTab(project: ProjectItem) {
    setActiveTab("activityForecast");
    setActivityForecastProject({ id: project.id, sob: project.sob });
    setActivityForecastProjectSearch(project.sob);
    setActivityForecastItems([]);
    setActivityForecastCatalogItems([]);
    setActivityForecastDrafts({});
    setActivityForecastSearch("");
    setActivityForecastQty("");
    setActivityForecastFilterDraft(INITIAL_FORECAST_FILTERS);
    setActiveActivityForecastFilters(INITIAL_FORECAST_FILTERS);
    setFeedback(null);
    scrollDashboardContentToTop();
    await loadActivityForecast(project.id);
  }

  async function handleActivityForecastProjectSelection(projectId: string) {
    if (!projectId) {
      setActivityForecastProject(null);
      setActivityForecastProjectSearch("");
      setActivityForecastItems([]);
      setActivityForecastCatalogItems([]);
      setActivityForecastDrafts({});
      setActivityForecastSearch("");
      setActivityForecastQty("");
      setActivityForecastFilterDraft(INITIAL_FORECAST_FILTERS);
      setActiveActivityForecastFilters(INITIAL_FORECAST_FILTERS);
      return;
    }

    const selectedProject = projects.find((item) => item.id === projectId);
    setActivityForecastProject(selectedProject ? { id: selectedProject.id, sob: selectedProject.sob } : { id: projectId, sob: "" });
    setActivityForecastProjectSearch(selectedProject?.sob ?? "");
    setActivityForecastItems([]);
    setActivityForecastCatalogItems([]);
    setActivityForecastDrafts({});
    setActivityForecastSearch("");
    setActivityForecastQty("");
    setActivityForecastFilterDraft(INITIAL_FORECAST_FILTERS);
    setActiveActivityForecastFilters(INITIAL_FORECAST_FILTERS);
    await loadActivityForecast(projectId);
  }

  function handleActivityForecastProjectSearchChange(value: string) {
    const normalizedSob = normalizeSob(value);
    setActivityForecastProjectSearch(normalizedSob);

    if (!normalizedSob) {
      void handleActivityForecastProjectSelection("");
      return;
    }

    const matchedProject = projects.find((project) => normalizeSob(project.sob) === normalizedSob);
    if (matchedProject) {
      void handleActivityForecastProjectSelection(matchedProject.id);
      return;
    }

    if (activityForecastProject && normalizeSob(activityForecastProject.sob) !== normalizedSob) {
      setActivityForecastProject(null);
      setActivityForecastItems([]);
      setActivityForecastDrafts({});
    }
  }

  function updateActivityForecastFilterField<Key extends keyof ForecastFilterState>(
    field: Key,
    value: ForecastFilterState[Key],
  ) {
    setActivityForecastFilterDraft((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function addProjectActivityForecast() {
    if (!session?.accessToken || !activityForecastProject || !selectedProjectActivityForecastOption || !activityForecastQty.trim()) {
      setFeedback({
        type: "error",
        message: "Selecione uma atividade valida e informe a quantidade para adicionar ao projeto.",
      });
      return;
    }

    setIsSavingProjectActivityForecast(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/projects/activity-forecast", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          projectId: activityForecastProject.id,
          activityId: selectedProjectActivityForecastOption.id,
          quantity: activityForecastQty,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as ProjectActivityForecastResponse;
      if (!response.ok) {
        setFeedback({
          type: "error",
          message: data.message ?? "Falha ao adicionar atividade prevista ao projeto.",
        });
        return;
      }

      setActivityForecastItems(data.items ?? []);
      setActivityForecastDrafts(
        Object.fromEntries(
          (data.items ?? []).map((item) => [item.id, { quantity: String(item.qtyPlanned), observation: item.observation ?? "" }]),
        ),
      );
      setActivityForecastSearch("");
      setActivityForecastQty("");
      setActivityForecastCatalogItems([]);
      setFeedback({
        type: "success",
        message: data.message ?? "Atividade prevista adicionada ao projeto com sucesso.",
      });
    } catch {
      setFeedback({
        type: "error",
        message: "Falha ao adicionar atividade prevista ao projeto.",
      });
    } finally {
      setIsSavingProjectActivityForecast(false);
    }
  }

  async function saveProjectActivityForecastRow(itemId: string) {
    if (!session?.accessToken || !activityForecastProject) {
      return;
    }

    const draft = activityForecastDrafts[itemId];
    if (!draft?.quantity.trim()) {
      setFeedback({
        type: "error",
        message: "Informe a quantidade prevista antes de salvar a atividade.",
      });
      return;
    }

    setIsSavingProjectActivityForecast(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/projects/activity-forecast", {
        method: "PUT",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          projectId: activityForecastProject.id,
          id: itemId,
          quantity: draft.quantity,
          observation: draft.observation,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as ProjectActivityForecastResponse;
      if (!response.ok) {
        setFeedback({
          type: "error",
          message: data.message ?? "Falha ao salvar atividade prevista do projeto.",
        });
        return;
      }

      setActivityForecastItems(data.items ?? []);
      setActivityForecastDrafts(
        Object.fromEntries(
          (data.items ?? []).map((item) => [item.id, { quantity: String(item.qtyPlanned), observation: item.observation ?? "" }]),
        ),
      );
      setFeedback({
        type: "success",
        message: data.message ?? "Atividade prevista do projeto atualizada com sucesso.",
      });
    } catch {
      setFeedback({
        type: "error",
        message: "Falha ao salvar atividade prevista do projeto.",
      });
    } finally {
      setIsSavingProjectActivityForecast(false);
    }
  }

  async function handleDownloadForecastTemplate() {
    if (!session?.accessToken) {
      setFeedback({
        type: "error",
        message: "Sessao invalida para baixar o modelo de materiais previstos.",
      });
      return;
    }

    const functionsBaseUrl = supabaseFunctionsBaseUrl();
    const anonKey = supabaseAnonKey();
    if (!functionsBaseUrl || !anonKey) {
      setFeedback({
        type: "error",
        message: "Ambiente sem configuracao de Supabase para baixar o modelo.",
      });
      return;
    }

    setIsDownloadingTemplate(true);
    try {
      const response = await fetch(`${functionsBaseUrl}/functions/v1/get_project_forecast_template`, {
        cache: "no-store",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${session.accessToken}`,
        },
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { message?: string };
        setFeedback({
          type: "error",
          message: data.message ?? "Falha ao baixar modelo de materiais previstos.",
        });
        return;
      }

      const file = await response.blob();
      downloadBlobFile(file, "modelo_materiais_previstos.xlsx");
      setFeedback({
        type: "success",
        message: "Modelo XLSX baixado com sucesso.",
      });
    } catch {
      setFeedback({
        type: "error",
        message: "Falha ao baixar modelo de materiais previstos.",
      });
    } finally {
      setIsDownloadingTemplate(false);
    }
  }

  async function handleDownloadActivityForecastTemplate() {
    if (!session?.accessToken) {
      setFeedback({
        type: "error",
        message: "Sessao invalida para baixar o modelo de atividades previstas.",
      });
      return;
    }

    const functionsBaseUrl = supabaseFunctionsBaseUrl();
    const anonKey = supabaseAnonKey();
    if (!functionsBaseUrl || !anonKey) {
      setFeedback({
        type: "error",
        message: "Ambiente sem configuracao de Supabase para baixar o modelo.",
      });
      return;
    }

    setIsDownloadingActivityForecastTemplate(true);
    try {
      const response = await fetch(`${functionsBaseUrl}/functions/v1/get_project_activity_forecast_template`, {
        cache: "no-store",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${session.accessToken}`,
        },
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { message?: string };
        setFeedback({
          type: "error",
          message: data.message ?? "Falha ao baixar modelo de atividades previstas.",
        });
        return;
      }

      const file = await response.blob();
      downloadBlobFile(file, "modelo_atividades_previstas.xlsx");
      setFeedback({
        type: "success",
        message: "Modelo XLSX de atividades baixado com sucesso.",
      });
    } catch {
      setFeedback({
        type: "error",
        message: "Falha ao baixar modelo de atividades previstas.",
      });
    } finally {
      setIsDownloadingActivityForecastTemplate(false);
    }
  }

  function openForecastImportModal() {
    if (!forecastProject) {
      setFeedback({
        type: "error",
        message: "Selecione um projeto para importar materiais previstos.",
      });
      return;
    }

    setForecastImportFile(null);
    setIsForecastImportModalOpen(true);
  }

  function closeForecastImportModal() {
    setIsForecastImportModalOpen(false);
    setForecastImportFile(null);
    setIsImportingForecast(false);
  }

  function openActivityForecastImportModal() {
    if (!activityForecastProject) {
      setFeedback({
        type: "error",
        message: "Selecione um projeto para importar atividades previstas.",
      });
      return;
    }

    setActivityForecastImportFile(null);
    setIsActivityForecastImportModalOpen(true);
  }

  function closeActivityForecastImportModal() {
    setIsActivityForecastImportModalOpen(false);
    setActivityForecastImportFile(null);
    setIsImportingActivityForecast(false);
  }

  async function submitForecastImport() {
    if (!session?.accessToken || !forecastProject || !forecastImportFile) {
      return;
    }

    const functionsBaseUrl = supabaseFunctionsBaseUrl();
    const anonKey = supabaseAnonKey();
    if (!functionsBaseUrl || !anonKey) {
      setFeedback({
        type: "error",
        message: "Ambiente sem configuracao de Supabase para importar materiais previstos.",
      });
      return;
    }

    setIsImportingForecast(true);
    try {
      const payload = new FormData();
      payload.set("projectId", forecastProject.id);
      payload.set("file", forecastImportFile);

      const response = await fetch(`${functionsBaseUrl}/functions/v1/import_project_forecast`, {
        method: "POST",
        cache: "no-store",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: payload,
      });

      const data = (await response.json().catch(() => ({}))) as ProjectForecastImportResponse;
      if (!response.ok) {
        const errorList = (data.errors ?? []).slice(0, 5);
        const blockedCodes = (data.codes ?? []).slice(0, 5);
        const details = [...errorList, ...blockedCodes.map((code) => `Codigo bloqueado: ${code}`)];
        const errorDetails = details.length > 0 ? ` (${details.join(" | ")})` : "";
        setFeedback({
          type: "error",
          message: `${data.message ?? "Falha ao importar materiais previstos."}${errorDetails}`,
        });
        return;
      }

      setFeedback({
        type: "success",
        message:
          data.message ??
          `Materiais previstos do projeto ${forecastProject.sob} importados com sucesso.`,
      });
      closeForecastImportModal();
      await loadForecast(forecastProject.id);
    } catch {
      setFeedback({
        type: "error",
        message: "Falha ao importar materiais previstos.",
      });
    } finally {
      setIsImportingForecast(false);
    }
  }

  async function submitActivityForecastImport() {
    if (!session?.accessToken || !activityForecastProject || !activityForecastImportFile) {
      return;
    }

    const functionsBaseUrl = supabaseFunctionsBaseUrl();
    const anonKey = supabaseAnonKey();
    if (!functionsBaseUrl || !anonKey) {
      setFeedback({
        type: "error",
        message: "Ambiente sem configuracao de Supabase para importar atividades previstas.",
      });
      return;
    }

    setIsImportingActivityForecast(true);
    try {
      const payload = new FormData();
      payload.set("projectId", activityForecastProject.id);
      payload.set("file", activityForecastImportFile);

      const response = await fetch(`${functionsBaseUrl}/functions/v1/import_project_activity_forecast`, {
        method: "POST",
        cache: "no-store",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: payload,
      });

      const data = (await response.json().catch(() => ({}))) as ProjectForecastImportResponse;
      if (!response.ok) {
        const errorList = (data.errors ?? []).slice(0, 5);
        const blockedCodes = (data.codes ?? []).slice(0, 5);
        const details = [...errorList, ...blockedCodes.map((code) => `Codigo bloqueado: ${code}`)];
        const errorDetails = details.length > 0 ? ` (${details.join(" | ")})` : "";
        setFeedback({
          type: "error",
          message: `${data.message ?? "Falha ao importar atividades previstas."}${errorDetails}`,
        });
        return;
      }

      setFeedback({
        type: "success",
        message:
          data.message ??
          `Atividades previstas do projeto ${activityForecastProject.sob} importadas com sucesso.`,
      });
      closeActivityForecastImportModal();
      await loadActivityForecast(activityForecastProject.id);
    } catch {
      setFeedback({
        type: "error",
        message: "Falha ao importar atividades previstas.",
      });
    } finally {
      setIsImportingActivityForecast(false);
    }
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
        cache: "no-store",
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
        cache: "no-store",
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

  async function handleExportProjects() {
    if (!session?.accessToken) {
      setFeedback({
        type: "error",
        message: "Sessao invalida para exportar projetos.",
      });
      return;
    }

    setIsExporting(true);

    try {
      const allProjects: ProjectItem[] = [];
      let exportPage = 1;
      let totalItems = 0;

      while (true) {
        const query = buildQuery(activeFilters, exportPage, EXPORT_PAGE_SIZE);
        const response = await fetch(`/api/projects?${query}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as ProjectListResponse;

        if (!response.ok) {
          setFeedback({
            type: "error",
            message: data.message ?? "Falha ao exportar projetos.",
          });
          return;
        }

        const pageItems = data.projects ?? [];
        totalItems = data.pagination?.total ?? totalItems;
        allProjects.push(...pageItems);

        if (pageItems.length === 0 || allProjects.length >= totalItems) {
          break;
        }

        exportPage += 1;
      }

      if (allProjects.length === 0) {
        setFeedback({
          type: "error",
          message: "Nenhum projeto encontrado para exportar com os filtros atuais.",
        });
        return;
      }

      const csv = buildProjectsCsv(allProjects);
      const exportDate = new Date().toISOString().slice(0, 10);
      downloadCsvFile(csv, `projetos_${exportDate}.csv`);

      setFeedback({
        type: "success",
        message: `${allProjects.length} projeto(s) exportado(s) com sucesso.`,
      });
    } catch {
      setFeedback({
        type: "error",
        message: "Falha ao exportar projetos.",
      });
    } finally {
      setIsExporting(false);
    }
  }

  async function handleExportForecastItems() {
    if (!forecastProject) {
      setFeedback({
        type: "error",
        message: "Selecione um projeto para exportar materiais previstos.",
      });
      return;
    }

    if (filteredForecastItems.length === 0) {
      setFeedback({
        type: "error",
        message: "Nenhum material previsto encontrado para exportar com os filtros atuais.",
      });
      return;
    }

    setIsExportingForecast(true);

    try {
      const csv = buildForecastCsv(filteredForecastItems);
      const exportDate = new Date().toISOString().slice(0, 10);
      const sob = normalizeSob(forecastProject.sob).replace(/[^A-Z0-9_-]/g, "");
      downloadCsvFile(csv, `materiais_previstos_${sob || "projeto"}_${exportDate}.csv`);

      setFeedback({
        type: "success",
        message: `${filteredForecastItems.length} material(is) previsto(s) exportado(s) com sucesso.`,
      });
    } catch {
      setFeedback({
        type: "error",
        message: "Falha ao exportar materiais previstos.",
      });
    } finally {
      setIsExportingForecast(false);
    }
  }

  async function handleExportActivityForecastItems() {
    if (!activityForecastProject) {
      setFeedback({
        type: "error",
        message: "Selecione um projeto para exportar atividades previstas.",
      });
      return;
    }

    if (filteredActivityForecastItems.length === 0) {
      setFeedback({
        type: "error",
        message: "Nenhuma atividade prevista encontrada para exportar com os filtros atuais.",
      });
      return;
    }

    setIsExportingActivityForecast(true);

    try {
      const csv = buildActivityForecastCsv(filteredActivityForecastItems);
      const exportDate = new Date().toISOString().slice(0, 10);
      const sob = normalizeSob(activityForecastProject.sob).replace(/[^A-Z0-9_-]/g, "");
      downloadCsvFile(csv, `atividades_previstas_${sob || "projeto"}_${exportDate}.csv`);

      setFeedback({
        type: "success",
        message: `${filteredActivityForecastItems.length} atividade(s) prevista(s) exportada(s) com sucesso.`,
      });
    } catch {
      setFeedback({
        type: "error",
        message: "Falha ao exportar atividades previstas.",
      });
    } finally {
      setIsExportingActivityForecast(false);
    }
  }

  return (
    <section className={styles.wrapper}>
      {feedback ? (
        <div className={feedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError}>{feedback.message}</div>
      ) : null}

      {isLoadingMeta ? <div className={styles.loadingHint}>Atualizando opcoes de cadastro e filtros...</div> : null}

      <article className={`${styles.card} ${isEditing ? styles.editingCard : ""}`}>
        <div className={styles.tabHeader}>
          <button
            type="button"
            className={`${styles.tabButton} ${activeTab === "project" ? styles.tabButtonActive : ""}`}
            onClick={() => setActiveTab("project")}
          >
            Cadastro de Projeto
          </button>
          <button
            type="button"
            className={`${styles.tabButton} ${activeTab === "forecast" ? styles.tabButtonActive : ""}`}
            onClick={() => setActiveTab("forecast")}
          >
            Materiais previstos
          </button>
          <button
            type="button"
            className={`${styles.tabButton} ${activeTab === "activityForecast" ? styles.tabButtonActive : ""}`}
            onClick={() => setActiveTab("activityForecast")}
          >
            Atividades previstas
          </button>
        </div>

        {activeTab === "project" ? (
          <>
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
                <select
                  value={form.serviceType}
                  onChange={(event) => updateFormField("serviceType", event.target.value)}
                  required
                >
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
                  {isSubmitting
                    ? isEditing
                      ? "Salvando..."
                      : "Registrando..."
                    : isEditing
                      ? "Salvar alteracoes"
                      : "Registrar projeto"}
                </button>
                {isEditing ? (
                  <button type="button" className={styles.ghostButton} onClick={resetFormState} disabled={isSubmitting}>
                    Cancelar edicao
                  </button>
                ) : null}
              </div>
            </form>
          </>
        ) : activeTab === "forecast" ? (
          <div className={styles.forecastPanel}>
            <h3 className={styles.cardTitle}>Materiais previstos</h3>

            <label className={styles.field}>
              <span>Projeto (SOB)</span>
              <input
                type="text"
                list="forecast-sob-list"
                value={forecastProjectSearch}
                onChange={(event) => handleForecastProjectSearchChange(event.target.value)}
                placeholder="Digite o SOB do projeto"
              />
            </label>

            {forecastProject?.sob ? (
              <p className={styles.forecastHint}>
                Projeto selecionado: <strong>{forecastProject.sob}</strong>
              </p>
            ) : (
              <p className={styles.forecastHint}>
                Selecione um projeto para trabalhar a lista e os filtros de materiais previstos.
              </p>
            )}

            <div className={styles.formGrid}>
              <label className={`${styles.field} ${styles.fieldWide}`}>
                <span>Material</span>
                <input
                  type="text"
                  list="project-forecast-list"
                  value={forecastSearch}
                  onChange={(event) => setForecastSearch(event.target.value)}
                  placeholder="Digite codigo ou descricao"
                  disabled={!forecastProject}
                />
              </label>

              <label className={styles.field}>
                <span>Quantidade prevista</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={forecastQty}
                  onChange={(event) => setForecastQty(event.target.value)}
                  placeholder="0,00"
                  disabled={!forecastProject}
                />
              </label>

              <label className={styles.field}>
                <span>UMB</span>
                <input value={selectedProjectForecastOption?.umb ?? ""} placeholder="Selecione o material" disabled />
              </label>

              <div className={`${styles.actions} ${styles.formActions}`}>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => void addProjectForecast()}
                  disabled={!forecastProject || isSavingProjectForecast}
                >
                  {isSavingProjectForecast ? "Salvando..." : "Adicionar material"}
                </button>
              </div>
            </div>

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => void handleDownloadForecastTemplate()}
                disabled={isDownloadingTemplate}
              >
                {isDownloadingTemplate ? "Baixando modelo..." : "Baixar modelo (.xlsx)"}
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={openForecastImportModal}
                disabled={!forecastProject || isLoadingForecast || isImportingForecast}
              >
                Importar planilha XLSX
              </button>
              <button
                type="button"
                className={styles.ghostButton}
                onClick={() => (forecastProject ? void loadForecast(forecastProject.id) : undefined)}
                disabled={!forecastProject || isLoadingForecast}
              >
                {isLoadingForecast ? "Atualizando..." : "Atualizar lista"}
              </button>
            </div>

            <div className={styles.forecastRules}>
              <strong>Regras da importacao:</strong>
              <span>Use o modelo oficial com colunas: `codigo`, `quantidade`.</span>
              <span>Somente arquivo XLSX e permitido.</span>
              <span>Codigos sao validados no cadastro de materiais do tenant.</span>
              <span>A inclusao manual usa o mesmo cadastro base e tambem exige quantidade maior que zero.</span>
            </div>
          </div>
        ) : (
          <div className={styles.forecastPanel}>
            <h3 className={styles.cardTitle}>Atividades previstas</h3>

            <label className={styles.field}>
              <span>Projeto (SOB)</span>
              <input
                type="text"
                list="forecast-sob-list"
                value={activityForecastProjectSearch}
                onChange={(event) => handleActivityForecastProjectSearchChange(event.target.value)}
                placeholder="Digite o SOB do projeto"
              />
            </label>

            {activityForecastProject?.sob ? (
              <p className={styles.forecastHint}>
                Projeto selecionado: <strong>{activityForecastProject.sob}</strong>
              </p>
            ) : (
              <p className={styles.forecastHint}>
                Selecione um projeto para trabalhar a lista e os filtros de atividades previstas.
              </p>
            )}

            <div className={styles.formGrid}>
              <label className={`${styles.field} ${styles.fieldWide}`}>
                <span>Atividade</span>
                <input
                  type="text"
                  list="project-activity-forecast-list"
                  value={activityForecastSearch}
                  onChange={(event) => setActivityForecastSearch(event.target.value)}
                  placeholder="Digite codigo ou descricao"
                  disabled={!activityForecastProject}
                />
              </label>

              <label className={styles.field}>
                <span>Quantidade prevista</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={activityForecastQty}
                  onChange={(event) => setActivityForecastQty(event.target.value)}
                  placeholder="0,00"
                  disabled={!activityForecastProject}
                />
              </label>

              <label className={styles.field}>
                <span>Unidade</span>
                <input value={selectedProjectActivityForecastOption?.unit ?? ""} placeholder="Selecione a atividade" disabled />
              </label>
            </div>

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => void addProjectActivityForecast()}
                disabled={!activityForecastProject || isSavingProjectActivityForecast}
              >
                {isSavingProjectActivityForecast ? "Salvando..." : "Adicionar atividade"}
              </button>
            </div>

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => void handleDownloadActivityForecastTemplate()}
                disabled={isDownloadingActivityForecastTemplate}
              >
                {isDownloadingActivityForecastTemplate ? "Baixando modelo..." : "Baixar modelo (.xlsx)"}
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={openActivityForecastImportModal}
                disabled={!activityForecastProject || isLoadingActivityForecast || isImportingActivityForecast}
              >
                Importar planilha XLSX
              </button>
              <button
                type="button"
                className={styles.ghostButton}
                onClick={() => (activityForecastProject ? void loadActivityForecast(activityForecastProject.id) : undefined)}
                disabled={!activityForecastProject || isLoadingActivityForecast}
              >
                {isLoadingActivityForecast ? "Atualizando..." : "Atualizar lista"}
              </button>
            </div>

            <div className={styles.forecastRules}>
              <strong>Regras das atividades previstas:</strong>
              <span>Selecione uma atividade ativa do cadastro base do tenant.</span>
              <span>O modelo XLSX tambem usa apenas as colunas: `codigo`, `quantidade`.</span>
              <span>A quantidade prevista deve ser maior que zero.</span>
              <span>A lista da Locacao passa a consumir essa base quando o projeto for aberto.</span>
            </div>
          </div>
        )}
      </article>

      {activeTab === "project" ? (
      <>
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
          <div className={styles.tableHeaderActions}>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => void handleExportProjects()}
              disabled={isExporting || isLoadingList}
            >
              {isExporting ? "Exportando..." : "Exportar Excel (CSV)"}
            </button>
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
                <th>Registrado em</th>
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
                      <td>{formatDateTime(project.createdAt)}</td>
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
                            className={`${styles.actionButton} ${styles.actionForecast}`}
                            onClick={() => void openForecastTab(project)}
                            aria-label={`Materiais previstos do projeto ${project.sob}`}
                            title="Materiais previstos"
                          >
                            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <path
                                d="M4.5 7.5h15m-15 4.5h15m-15 4.5h10"
                                stroke="currentColor"
                                strokeWidth="1.7"
                                strokeLinecap="round"
                              />
                              <path
                                d="M18.5 17.5h1.5v1.5"
                                stroke="currentColor"
                                strokeWidth="1.7"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </button>

                          <button
                            type="button"
                            className={`${styles.actionButton} ${styles.actionActivityForecast}`}
                            onClick={() => void openActivityForecastTab(project)}
                            aria-label={`Atividades previstas do projeto ${project.sob}`}
                            title="Atividades previstas"
                          >
                            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <path
                                d="M5 6.5h14M5 12h8m-8 5.5h14"
                                stroke="currentColor"
                                strokeWidth="1.7"
                                strokeLinecap="round"
                              />
                              <circle cx="17.5" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.7" />
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
      </>
      ) : activeTab === "forecast" ? (
      <>
        <article className={styles.card}>
          <h3 className={styles.cardTitle}>Filtros de Materiais Previstos</h3>

          <div className={styles.filterGrid}>
            <label className={styles.field}>
              <span>Codigo</span>
              <input
                type="text"
                value={forecastFilterDraft.code}
                onChange={(event) => updateForecastFilterField("code", event.target.value)}
                placeholder="Filtrar por codigo"
              />
            </label>

            <label className={styles.field}>
              <span>Descricao</span>
              <input
                type="text"
                value={forecastFilterDraft.description}
                onChange={(event) => updateForecastFilterField("description", event.target.value)}
                placeholder="Filtrar por descricao"
              />
            </label>

            <label className={styles.field}>
              <span>Tipo</span>
              <input
                type="text"
                value={forecastFilterDraft.type}
                onChange={(event) => updateForecastFilterField("type", event.target.value)}
                placeholder="Filtrar por tipo"
              />
            </label>
          </div>

          <div className={styles.actions}>
            <button type="button" className={styles.secondaryButton} onClick={applyForecastFilters}>
              Aplicar
            </button>
            <button type="button" className={styles.ghostButton} onClick={clearForecastFilters}>
              Limpar
            </button>
          </div>
        </article>

        <article className={styles.card}>
          <div className={styles.tableHeader}>
            <h3 className={styles.cardTitle}>Lista de Materiais Previstos</h3>
            <div className={styles.tableHeaderActions}>
              <div className={styles.tableHint}>
                {forecastProject?.sob
                  ? `Projeto selecionado: ${forecastProject.sob}`
                  : "Selecione um projeto para visualizar a lista de materiais previstos."}
              </div>
              <button
                type="button"
                className={styles.ghostButton}
                onClick={() => void handleExportForecastItems()}
                disabled={!forecastProject || isLoadingForecast || isExportingForecast}
              >
                {isExportingForecast ? "Exportando..." : "Exportar Excel (CSV)"}
              </button>
            </div>
          </div>

          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Codigo</th>
                  <th>Descricao</th>
                  <th>UMB</th>
                  <th>Tipo</th>
                  <th>Quantidade prevista</th>
                  <th>Observacao</th>
                  <th>Atualizado em</th>
                  <th>Acoes</th>
                </tr>
              </thead>
              <tbody>
                {filteredForecastItems.length > 0 ? (
                  filteredForecastItems.map((item) => {
                    const draft = forecastDrafts[item.id] ?? {
                      quantity: String(item.qtyPlanned),
                      observation: item.observation ?? "",
                    };

                    return (
                      <tr key={item.id}>
                        <td>{item.code}</td>
                        <td>{item.description}</td>
                        <td>{item.umb ?? "-"}</td>
                        <td>{item.type ?? "-"}</td>
                        <td>
                          <input
                            className={styles.tableInput}
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={draft.quantity}
                            onChange={(event) =>
                              setForecastDrafts((current) => ({
                                ...current,
                                [item.id]: {
                                  ...draft,
                                  quantity: event.target.value,
                                },
                              }))
                            }
                          />
                        </td>
                        <td>
                          <input
                            className={styles.tableInput}
                            type="text"
                            value={draft.observation}
                            onChange={(event) =>
                              setForecastDrafts((current) => ({
                                ...current,
                                [item.id]: {
                                  ...draft,
                                  observation: event.target.value,
                                },
                              }))
                            }
                            placeholder="Observacao opcional"
                          />
                        </td>
                        <td>{formatDateTime(item.updatedAt)}</td>
                        <td className={styles.actionsCell}>
                          <button
                            type="button"
                            className={styles.secondaryButton}
                            onClick={() => void saveProjectForecastRow(item.id)}
                            disabled={isSavingProjectForecast}
                          >
                            {isSavingProjectForecast ? "Salvando..." : "Salvar"}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={8} className={styles.emptyRow}>
                      {isLoadingForecast
                        ? "Carregando materiais previstos..."
                        : "Nenhum material previsto encontrado para os filtros informados."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
      </>
      ) : (
      <>
        <article className={styles.card}>
          <h3 className={styles.cardTitle}>Filtros de Atividades Previstas</h3>

          <div className={styles.filterGrid}>
            <label className={styles.field}>
              <span>Codigo</span>
              <input
                type="text"
                value={activityForecastFilterDraft.code}
                onChange={(event) => updateActivityForecastFilterField("code", event.target.value)}
                placeholder="Filtrar por codigo"
              />
            </label>

            <label className={styles.field}>
              <span>Descricao</span>
              <input
                type="text"
                value={activityForecastFilterDraft.description}
                onChange={(event) => updateActivityForecastFilterField("description", event.target.value)}
                placeholder="Filtrar por descricao"
              />
            </label>

            <label className={styles.field}>
              <span>Tipo</span>
              <input
                type="text"
                value={activityForecastFilterDraft.type}
                onChange={(event) => updateActivityForecastFilterField("type", event.target.value)}
                placeholder="Filtrar por tipo"
              />
            </label>
          </div>

          <div className={styles.actions}>
            <button type="button" className={styles.secondaryButton} onClick={applyActivityForecastFilters}>
              Aplicar
            </button>
            <button type="button" className={styles.ghostButton} onClick={clearActivityForecastFilters}>
              Limpar
            </button>
          </div>
        </article>

        <article className={styles.card}>
          <div className={styles.tableHeader}>
            <h3 className={styles.cardTitle}>Lista de Atividades Previstas</h3>
            <div className={styles.tableHeaderActions}>
              <div className={styles.tableHint}>
                {activityForecastProject?.sob
                  ? `Projeto selecionado: ${activityForecastProject.sob}`
                  : "Selecione um projeto para visualizar a lista de atividades previstas."}
              </div>
              <button
                type="button"
                className={styles.ghostButton}
                onClick={() => void handleExportActivityForecastItems()}
                disabled={!activityForecastProject || isLoadingActivityForecast || isExportingActivityForecast}
              >
                {isExportingActivityForecast ? "Exportando..." : "Exportar Excel (CSV)"}
              </button>
            </div>
          </div>

          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Codigo</th>
                  <th>Descricao</th>
                  <th>Tipo</th>
                  <th>Unidade</th>
                  <th>Valor unitario</th>
                  <th>Quantidade prevista</th>
                  <th>Observacao</th>
                  <th>Atualizado em</th>
                  <th>Acoes</th>
                </tr>
              </thead>
              <tbody>
                {filteredActivityForecastItems.length > 0 ? (
                  filteredActivityForecastItems.map((item) => {
                    const draft = activityForecastDrafts[item.id] ?? {
                      quantity: String(item.qtyPlanned),
                      observation: item.observation ?? "",
                    };

                    return (
                      <tr key={item.id}>
                        <td>{item.code}</td>
                        <td>{item.description}</td>
                        <td>{item.type ?? "-"}</td>
                        <td>{item.unit}</td>
                        <td>{formatCurrency(item.unitValue)}</td>
                        <td>
                          <input
                            className={styles.tableInput}
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={draft.quantity}
                            onChange={(event) =>
                              setActivityForecastDrafts((current) => ({
                                ...current,
                                [item.id]: { ...draft, quantity: event.target.value },
                              }))
                            }
                          />
                        </td>
                        <td>
                          <input
                            className={styles.tableInput}
                            value={draft.observation}
                            onChange={(event) =>
                              setActivityForecastDrafts((current) => ({
                                ...current,
                                [item.id]: { ...draft, observation: event.target.value },
                              }))
                            }
                            placeholder="Opcional"
                          />
                        </td>
                        <td>{formatDateTime(item.updatedAt)}</td>
                        <td className={styles.actionsCell}>
                          <div className={styles.tableActions}>
                            <button
                              type="button"
                              className={styles.ghostButton}
                              onClick={() => void saveProjectActivityForecastRow(item.id)}
                              disabled={isSavingProjectActivityForecast}
                            >
                              {isSavingProjectActivityForecast ? "Salvando..." : "Salvar"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={9} className={styles.emptyRow}>
                      {isLoadingActivityForecast
                        ? "Carregando atividades previstas..."
                        : "Nenhuma atividade prevista encontrada para os filtros informados."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
      </>
      )}

      {isForecastImportModalOpen ? (
        <div className={styles.modalOverlay} onClick={closeForecastImportModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Importar planilha XLSX</h4>
                <p className={styles.modalSubtitle}>
                  Projeto: {forecastProject?.sob ?? "-"}
                </p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={closeForecastImportModal}>
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              <section className={styles.importStep}>
                <div className={styles.importStepHeader}>
                  <span className={styles.importStepNumber}>1</span>
                  <div>
                    <strong>Baixe o modelo</strong>
                    <p>Use o arquivo modelo para validar as colunas obrigatorias.</p>
                  </div>
                </div>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => void handleDownloadForecastTemplate()}
                  disabled={isDownloadingTemplate}
                >
                  {isDownloadingTemplate ? "Baixando..." : "Baixar modelo (.xlsx)"}
                </button>
              </section>

              <section className={styles.importStep}>
                <div className={styles.importStepHeader}>
                  <span className={styles.importStepNumber}>2</span>
                  <div>
                    <strong>Preencha a planilha</strong>
                    <p>Campos obrigatorios: codigo e quantidade.</p>
                  </div>
                </div>
              </section>

              <section className={styles.importStep}>
                <div className={styles.importStepHeader}>
                  <span className={styles.importStepNumber}>3</span>
                  <div>
                    <strong>Envie o arquivo</strong>
                    <p>Somente arquivos XLSX.</p>
                  </div>
                </div>
                <label className={styles.importDropzone}>
                  <input
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={(event) => setForecastImportFile(event.target.files?.[0] ?? null)}
                  />
                  <span>{forecastImportFile ? forecastImportFile.name : "Clique para selecionar o arquivo XLSX"}</span>
                </label>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() => void submitForecastImport()}
                    disabled={!forecastImportFile || isImportingForecast}
                  >
                    {isImportingForecast ? "Importando..." : "Importar planilha"}
                  </button>
                </div>
              </section>
            </div>
          </article>
        </div>
      ) : null}

      {isActivityForecastImportModalOpen ? (
        <div className={styles.modalOverlay} onClick={closeActivityForecastImportModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Importar atividades previstas</h4>
                <p className={styles.modalSubtitle}>
                  Projeto: {activityForecastProject?.sob ?? "-"}
                </p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={closeActivityForecastImportModal}>
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              <section className={styles.importStep}>
                <div className={styles.importStepHeader}>
                  <span className={styles.importStepNumber}>1</span>
                  <div>
                    <strong>Baixe o modelo</strong>
                    <p>Use o arquivo modelo para validar as colunas obrigatorias.</p>
                  </div>
                </div>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => void handleDownloadActivityForecastTemplate()}
                  disabled={isDownloadingActivityForecastTemplate}
                >
                  {isDownloadingActivityForecastTemplate ? "Baixando..." : "Baixar modelo (.xlsx)"}
                </button>
              </section>

              <section className={styles.importStep}>
                <div className={styles.importStepHeader}>
                  <span className={styles.importStepNumber}>2</span>
                  <div>
                    <strong>Preencha a planilha</strong>
                    <p>Campos obrigatorios: codigo e quantidade.</p>
                  </div>
                </div>
              </section>

              <section className={styles.importStep}>
                <div className={styles.importStepHeader}>
                  <span className={styles.importStepNumber}>3</span>
                  <div>
                    <strong>Envie o arquivo</strong>
                    <p>Somente arquivos XLSX.</p>
                  </div>
                </div>
                <label className={styles.importDropzone}>
                  <input
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={(event) => setActivityForecastImportFile(event.target.files?.[0] ?? null)}
                  />
                  <span>{activityForecastImportFile ? activityForecastImportFile.name : "Clique para selecionar o arquivo XLSX"}</span>
                </label>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() => void submitActivityForecastImport()}
                    disabled={!activityForecastImportFile || isImportingActivityForecast}
                  >
                    {isImportingActivityForecast ? "Importando..." : "Importar planilha"}
                  </button>
                </div>
              </section>
            </div>
          </article>
        </div>
      ) : null}

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

      <datalist id="forecast-sob-list">
        {projects.map((project) => (
          <option key={project.id} value={project.sob} />
        ))}
      </datalist>

      <datalist id="project-forecast-list">
        {forecastCatalogItems.map((item) => (
          <option key={item.id} value={forecastOptionLabel(item)} />
        ))}
      </datalist>

      <datalist id="project-activity-forecast-list">
        {activityForecastCatalogItems.map((item) => (
          <option key={item.id} value={activityForecastOptionLabel(item)} />
        ))}
      </datalist>
    </section>
  );
}
