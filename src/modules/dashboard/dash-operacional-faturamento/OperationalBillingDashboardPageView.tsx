"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { useErrorLogger } from "@/hooks/useErrorLogger";
import styles from "./OperationalBillingDashboardPageView.module.css";

type Option = {
  id: string;
  label: string;
};

type ProjectOption = Option & {
  serviceCenterId: string | null;
  serviceCenter: string;
};

type OriginTotals = {
  quantity: number;
  value: number;
  itemCount: number;
};

type DashboardRow = {
  code: string;
  description: string;
  unit: string;
  activityStatus: "ATIVA" | "INATIVA" | "NAO_IDENTIFICADA";
  measurement: OriginTotals;
  asbuilt: OriginTotals;
  billing: OriginTotals;
  quantityDiffAsbuiltMeasurement: number;
  quantityDiffBillingMeasurement: number;
  valueDiffAsbuiltMeasurement: number;
  valueDiffBillingMeasurement: number;
  isMissingInAnyBase: boolean;
  isDivergent: boolean;
  situation: string;
};

type BillingCategoryRow = {
  categoryId: string;
  categoryName: string;
  quantity: number;
  value: number;
  itemCount: number;
  codes: string[];
};

type CategoryTotals = OriginTotals & {
  codes: string[];
};

type CategoryColumn = {
  categoryId: string;
  categoryName: string;
};

type CategorySummaryRow = {
  origin: "measurement" | "asbuilt" | "billing";
  label: string;
  totalQuantity: number;
  totalValue: number;
  categories: Record<string, CategoryTotals>;
};

type ChartItem = {
  key: string;
  label: string;
  value: number;
  projectCount: number;
  measurementCount: number;
};

type OperationalMeasurementCategoryCard = {
  key: string;
  label: string;
  categoryName: string;
  measurementQuantity: number;
  asbuiltQuantity: number;
  billingQuantity: number;
};

type ProjectValueRow = {
  projectId: string;
  projectCode: string;
  serviceCenterId: string | null;
  serviceCenter: string;
  workCompletionStatus: string;
  workCompletionStatusLabel: string;
  measurementValue: number;
  asbuiltValue: number;
  billingValue: number;
  asbuiltMeasurementDiff: number;
  billingAsbuiltDiff: number;
};

type Summary = {
  totalRows: number;
  divergentRows: number;
  missingRows: number;
  conferredRows: number;
  measurementValue: number;
  asbuiltValue: number;
  billingValue: number;
};

type DashboardResponse = {
  message?: string;
  filters?: {
    projects: ProjectOption[];
    serviceCenters: Option[];
  };
  selectedProject?: ProjectOption | null;
  rows?: DashboardRow[];
  billingCategories?: BillingCategoryRow[];
  categoryColumns?: CategoryColumn[];
  categorySummaryRows?: CategorySummaryRow[];
  chartItems?: ChartItem[];
  operationalCategoryCards?: OperationalMeasurementCategoryCard[];
  projectValueRows?: ProjectValueRow[];
  summary?: Summary | null;
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number.isFinite(value) ? value : 0);
}

function formatSignedCurrency(value: number) {
  const safeValue = Number.isFinite(value) ? value : 0;
  if (safeValue > 0) return `+${formatCurrency(safeValue)}`;
  if (safeValue < 0) return `-${formatCurrency(Math.abs(safeValue))}`;
  return formatCurrency(0);
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "Sem base";
  return new Intl.NumberFormat("pt-BR", {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function csvValue(value: unknown) {
  const text = String(value ?? "");
  if (/[;\n"]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const content = rows.map((row) => row.map(csvValue).join(";")).join("\n");
  const blob = new Blob([`\uFEFF${content}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function filenameToken(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "sem_projeto";
}

function chartDisplayLabel(item: ChartItem) {
  return item.key === "measurementAsbuilt" ? "Medido com AS Built" : item.label;
}

const chartHelpByKey: Record<string, string> = {
  totalMeasurement: "Soma de todas as medicoes com producao nos projetos filtrados.",
  measurementAsbuilt: "Soma da Medicao somente dos projetos que tambem possuem Medicao As Built.",
  asbuilt: "Soma dos valores registrados na Medicao As Built dos projetos filtrados.",
  billing: "Soma dos valores registrados no Faturamento dos projetos filtrados.",
};

const PROJECT_VALUE_PAGE_SIZE = 20;

export function OperationalBillingDashboardPageView() {
  const { session } = useAuth();
  const logError = useErrorLogger("dash-operacional-faturamento");
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [serviceCenters, setServiceCenters] = useState<Option[]>([]);
  const [rows, setRows] = useState<DashboardRow[]>([]);
  const [categoryColumns, setCategoryColumns] = useState<CategoryColumn[]>([]);
  const [categorySummaryRows, setCategorySummaryRows] = useState<CategorySummaryRow[]>([]);
  const [chartItems, setChartItems] = useState<ChartItem[]>([]);
  const [operationalCategoryCards, setOperationalCategoryCards] = useState<OperationalMeasurementCategoryCard[]>([]);
  const [projectValueRows, setProjectValueRows] = useState<ProjectValueRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [projectId, setProjectId] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [serviceCenterId, setServiceCenterId] = useState("");
  const [chartProjectId, setChartProjectId] = useState("");
  const [chartProjectSearch, setChartProjectSearch] = useState("");
  const [chartServiceCenterId, setChartServiceCenterId] = useState("");
  const [projectValueProjectSearch, setProjectValueProjectSearch] = useState("");
  const [projectValueServiceCenterId, setProjectValueServiceCenterId] = useState("");
  const [projectValueWorkCompletionStatus, setProjectValueWorkCompletionStatus] = useState("");
  const [projectValuePage, setProjectValuePage] = useState(1);
  const [activityCode, setActivityCode] = useState("");
  const [activityStatus, setActivityStatus] = useState("TODAS");
  const [onlyDivergences, setOnlyDivergences] = useState(false);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [onlyAsbuiltBelowMeasurement, setOnlyAsbuiltBelowMeasurement] = useState(false);
  const [onlyBillingBelowAsbuilt, setOnlyBillingBelowAsbuilt] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isChartLoading, setIsChartLoading] = useState(false);
  const [isProjectValuesLoading, setIsProjectValuesLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const visibleProjects = useMemo(
    () => projects.filter((project) => !serviceCenterId || project.serviceCenterId === serviceCenterId),
    [projects, serviceCenterId],
  );

  const projectInputOptions = useMemo(
    () => (serviceCenterId ? visibleProjects : projects),
    [projects, serviceCenterId, visibleProjects],
  );

  const chartVisibleProjects = useMemo(
    () => projects.filter((project) => !chartServiceCenterId || project.serviceCenterId === chartServiceCenterId),
    [chartServiceCenterId, projects],
  );

  const projectValueProjectOptions = useMemo(
    () => projects.filter((project) => !projectValueServiceCenterId || project.serviceCenterId === projectValueServiceCenterId),
    [projectValueServiceCenterId, projects],
  );

  const projectValueWorkCompletionOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const row of projectValueRows) {
      options.set(row.workCompletionStatus || "NAO_INFORMADO", row.workCompletionStatusLabel || "Nao informado");
    }
    return Array.from(options.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((left, right) => left.label.localeCompare(right.label, "pt-BR"));
  }, [projectValueRows]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projectId, projects],
  );

  const chartMaxValue = useMemo(
    () => Math.max(1, ...chartItems.map((item) => Number(item.value) || 0)),
    [chartItems],
  );

  const chartInsightItems = useMemo(() => {
    const valueByKey = new Map(chartItems.map((item) => [item.key, Number(item.value) || 0]));
    const totalMeasurement = valueByKey.get("totalMeasurement") ?? 0;
    const measurementAsbuilt = valueByKey.get("measurementAsbuilt") ?? 0;
    const asbuilt = valueByKey.get("asbuilt") ?? 0;
    const billing = valueByKey.get("billing") ?? 0;

    return [
      {
        key: "outside-asbuilt",
        label: "Fora da base AS Built",
        value: totalMeasurement - measurementAsbuilt,
        percent: totalMeasurement > 0 ? measurementAsbuilt / totalMeasurement : null,
        detail: "Percentual mostra quanto do Total medido esta em projetos com AS Built.",
      },
      {
        key: "asbuilt-measurement",
        label: "Dif. AS Built x Medido",
        value: asbuilt - measurementAsbuilt,
        percent: measurementAsbuilt > 0 ? asbuilt / measurementAsbuilt : null,
        detail: "Compara As Built contra o Medido com AS Built.",
      },
      {
        key: "billing-asbuilt",
        label: "Dif. Faturado x AS Built",
        value: billing - asbuilt,
        percent: asbuilt > 0 ? billing / asbuilt : null,
        detail: "Compara Faturado contra As Built.",
      },
    ];
  }, [chartItems]);

  const filteredProjectValueRows = useMemo(
    () => {
      const projectSearchValue = projectValueProjectSearch.trim().toLowerCase();

      return projectValueRows
        .filter((row) => !projectValueServiceCenterId || row.serviceCenterId === projectValueServiceCenterId)
        .filter((row) => !projectValueWorkCompletionStatus || row.workCompletionStatus === projectValueWorkCompletionStatus)
        .filter((row) => !projectSearchValue || row.projectCode.toLowerCase().includes(projectSearchValue))
        .filter((row) => !onlyAsbuiltBelowMeasurement || (row.asbuiltValue > 0 && row.measurementValue > 0 && row.asbuiltValue < row.measurementValue))
        .filter((row) => !onlyBillingBelowAsbuilt || (row.billingValue > 0 && row.asbuiltValue > 0 && row.billingValue < row.asbuiltValue));
    },
    [onlyAsbuiltBelowMeasurement, onlyBillingBelowAsbuilt, projectValueProjectSearch, projectValueRows, projectValueServiceCenterId, projectValueWorkCompletionStatus],
  );

  const projectValueTotalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredProjectValueRows.length / PROJECT_VALUE_PAGE_SIZE)),
    [filteredProjectValueRows.length],
  );

  const paginatedProjectValueRows = useMemo(
    () => filteredProjectValueRows.slice((projectValuePage - 1) * PROJECT_VALUE_PAGE_SIZE, projectValuePage * PROJECT_VALUE_PAGE_SIZE),
    [filteredProjectValueRows, projectValuePage],
  );

  const loadMetadata = useCallback(async () => {
    if (!session?.accessToken) return;

    setIsLoading(true);
    try {
      const response = await fetch("/api/dash-operacional-faturamento", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      const payload = (await response.json().catch(() => ({}))) as DashboardResponse;

      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao carregar filtros do Dash operacional e faturamento.");
      }

      setProjects(payload.filters?.projects ?? []);
      setServiceCenters(payload.filters?.serviceCenters ?? []);
      setRows([]);
      setCategoryColumns([]);
      setCategorySummaryRows([]);
      setChartItems([]);
      setSummary(null);
      setFeedback(null);
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao carregar filtros do Dash operacional e faturamento." });
      await logError("Falha ao carregar filtros do Dash operacional e faturamento", error);
    } finally {
      setIsLoading(false);
    }
  }, [logError, session?.accessToken]);

  const loadProjectValues = useCallback(async () => {
    if (!session?.accessToken) return;

    const params = new URLSearchParams();
    params.set("includeProjectValues", "true");
    params.set("includeOperationalCategoryCards", "true");

    setIsProjectValuesLoading(true);
    try {
      const response = await fetch(`/api/dash-operacional-faturamento?${params.toString()}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      const payload = (await response.json().catch(() => ({}))) as DashboardResponse;

      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao carregar valores por projeto.");
      }

      setProjects(payload.filters?.projects ?? []);
      setServiceCenters(payload.filters?.serviceCenters ?? []);
      setProjectValueRows(payload.projectValueRows ?? []);
      setOperationalCategoryCards(payload.operationalCategoryCards ?? []);
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao carregar valores por projeto." });
      await logError("Falha ao carregar valores por projeto", error);
    } finally {
      setIsProjectValuesLoading(false);
    }
  }, [logError, session?.accessToken]);

  const loadDashboard = useCallback(async () => {
    if (!session?.accessToken) return;

    if (projectSearch.trim() && !projectId) {
      setFeedback({ type: "error", message: "Selecione um Projeto valido da lista para consultar." });
      return;
    }

    if (!projectId || !serviceCenterId) {
      setFeedback({ type: "error", message: "Selecione Centro de servico e Projeto para consultar." });
      return;
    }

    const params = new URLSearchParams();
    if (projectId) params.set("projectId", projectId);
    if (serviceCenterId) params.set("serviceCenterId", serviceCenterId);
    if (activityCode.trim()) params.set("activityCode", activityCode.trim());
    if (activityStatus !== "TODAS") params.set("activityStatus", activityStatus);
    if (onlyDivergences) params.set("onlyDivergences", "true");
    if (onlyMissing) params.set("onlyMissing", "true");

    setIsLoading(true);
    try {
      const response = await fetch(`/api/dash-operacional-faturamento?${params.toString()}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      const payload = (await response.json().catch(() => ({}))) as DashboardResponse;

      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao carregar Dash operacional e faturamento.");
      }

      setProjects(payload.filters?.projects ?? []);
      setServiceCenters(payload.filters?.serviceCenters ?? []);
      setRows(payload.rows ?? []);
      setCategoryColumns(payload.categoryColumns ?? []);
      setCategorySummaryRows(payload.categorySummaryRows ?? []);
      setSummary(payload.summary ?? null);
      setFeedback({ type: "success", message: "Comparativo atualizado." });
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao carregar Dash operacional e faturamento." });
      await logError("Falha ao carregar Dash operacional e faturamento", error, {
        projectId,
        serviceCenterId,
        activityCode,
        activityStatus,
        onlyDivergences,
        onlyMissing,
      });
    } finally {
      setIsLoading(false);
    }
  }, [activityCode, activityStatus, logError, onlyDivergences, onlyMissing, projectId, projectSearch, serviceCenterId, session?.accessToken]);

  const loadChart = useCallback(async () => {
    if (!session?.accessToken) return;

    if (chartProjectSearch.trim() && !chartProjectId) {
      setFeedback({ type: "error", message: "Selecione um Projeto valido da lista para filtrar o grafico." });
      return;
    }

    const params = new URLSearchParams();
    params.set("includeChart", "true");
    if (chartServiceCenterId) params.set("chartServiceCenterId", chartServiceCenterId);
    if (chartProjectId) params.set("chartProjectId", chartProjectId);

    setIsChartLoading(true);
    try {
      const response = await fetch(`/api/dash-operacional-faturamento?${params.toString()}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      const payload = (await response.json().catch(() => ({}))) as DashboardResponse;

      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao carregar grafico operacional.");
      }

      setProjects(payload.filters?.projects ?? []);
      setServiceCenters(payload.filters?.serviceCenters ?? []);
      setChartItems(payload.chartItems ?? []);
      setFeedback({ type: "success", message: "Grafico atualizado." });
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao carregar grafico operacional." });
      await logError("Falha ao carregar grafico operacional", error, {
        chartProjectId,
        chartServiceCenterId,
      });
    } finally {
      setIsChartLoading(false);
    }
  }, [chartProjectId, chartProjectSearch, chartServiceCenterId, logError, session?.accessToken]);

  useEffect(() => {
    void loadMetadata();
  }, [loadMetadata]);

  useEffect(() => {
    void loadProjectValues();
  }, [loadProjectValues]);

  useEffect(() => {
    setProjectValuePage(1);
  }, [
    onlyAsbuiltBelowMeasurement,
    onlyBillingBelowAsbuilt,
    projectValueProjectSearch,
    projectValueServiceCenterId,
    projectValueWorkCompletionStatus,
  ]);

  useEffect(() => {
    setProjectValuePage((currentPage) => Math.min(currentPage, projectValueTotalPages));
  }, [projectValueTotalPages]);

  function handleServiceCenterChange(value: string) {
    setServiceCenterId(value);
    const currentProject = projects.find((project) => project.id === projectId);
    if (currentProject && value && currentProject.serviceCenterId !== value) {
      setProjectId("");
      setProjectSearch("");
      setRows([]);
      setCategoryColumns([]);
      setCategorySummaryRows([]);
      setSummary(null);
    }
  }

  function handleProjectSearchChange(value: string) {
    const searchValue = value;
    const matchedProject = projects.find((project) => project.label.toLowerCase() === searchValue.trim().toLowerCase()) ?? null;

    setProjectSearch(searchValue);
    setProjectId(matchedProject?.id ?? "");
    if (matchedProject?.serviceCenterId) {
      setServiceCenterId(matchedProject.serviceCenterId);
    }
  }

  function handleChartServiceCenterChange(value: string) {
    setChartServiceCenterId(value);
    const currentProject = projects.find((project) => project.id === chartProjectId);
    if (currentProject && value && currentProject.serviceCenterId !== value) {
      setChartProjectId("");
      setChartProjectSearch("");
    }
  }

  function handleChartProjectSearchChange(value: string) {
    const matchedProject = projects.find((project) => project.label.toLowerCase() === value.trim().toLowerCase()) ?? null;
    setChartProjectSearch(value);
    setChartProjectId(matchedProject?.id ?? "");
    if (matchedProject?.serviceCenterId) {
      setChartServiceCenterId(matchedProject.serviceCenterId);
    }
  }

  function exportRows() {
    if (!rows.length) {
      setFeedback({ type: "error", message: "Nenhum registro para exportar." });
      return;
    }

    const projectCode = selectedProject?.label ?? "";
    const serviceCenterName = selectedProject?.serviceCenter ?? "";

    downloadCsv(`dash_operacional_faturamento_${filenameToken(projectCode)}.csv`, [
      [
        "projeto",
        "centro_servico",
        "codigo",
        "descricao",
        "unidade",
        "status_atividade",
        "medicao_quantidade",
        "medicao_valor",
        "asbuilt_quantidade",
        "asbuilt_valor",
        "faturamento_quantidade",
        "faturamento_valor",
        "dif_qtd_asbuilt_medicao",
        "dif_qtd_faturamento_medicao",
        "dif_valor_asbuilt_medicao",
        "dif_valor_faturamento_medicao",
        "situacao",
      ],
      ...rows.map((row) => [
        projectCode,
        serviceCenterName,
        row.code,
        row.description,
        row.unit,
        row.activityStatus,
        row.measurement.quantity,
        formatCurrency(row.measurement.value),
        row.asbuilt.quantity,
        formatCurrency(row.asbuilt.value),
        row.billing.quantity,
        formatCurrency(row.billing.value),
        row.quantityDiffAsbuiltMeasurement,
        row.quantityDiffBillingMeasurement,
        formatCurrency(row.valueDiffAsbuiltMeasurement),
        formatCurrency(row.valueDiffBillingMeasurement),
        row.situation,
      ]),
    ]);
  }

  function exportCategorySummary() {
    if (!categoryColumns.length || !categorySummaryRows.length) {
      setFeedback({ type: "error", message: "Nenhuma categoria para exportar." });
      return;
    }

    const projectCode = selectedProject?.label ?? "";
    const serviceCenterName = selectedProject?.serviceCenter ?? "";

    downloadCsv(`dash_operacional_faturamento_categorias_${filenameToken(projectCode)}.csv`, [
      [
        "projeto",
        "centro_servico",
        "origem",
        ...categoryColumns.map((category) => `${category.categoryName}_quantidade`),
        ...categoryColumns.map((category) => `${category.categoryName}_valor`),
        "total_valor",
      ],
      ...categorySummaryRows.map((row) => [
        projectCode,
        serviceCenterName,
        row.label,
        ...categoryColumns.map((category) => row.categories[category.categoryId]?.quantity ?? 0),
        ...categoryColumns.map((category) => formatCurrency(row.categories[category.categoryId]?.value ?? 0)),
        formatCurrency(row.totalValue),
      ]),
    ]);
  }

  function exportProjectValues() {
    if (!filteredProjectValueRows.length) {
      setFeedback({ type: "error", message: "Nenhum projeto para exportar." });
      return;
    }

    downloadCsv("dash_operacional_faturamento_projetos_por_valor.csv", [
      [
        "projeto",
        "centro_servico",
        "estado_trabalho",
        "medicao_valor",
        "asbuilt_valor",
        "faturamento_valor",
        "dif_valor_asbuilt_medicao",
        "dif_valor_faturamento_asbuilt",
      ],
      ...filteredProjectValueRows.map((row) => [
        row.projectCode,
        row.serviceCenter,
        row.workCompletionStatusLabel,
        formatCurrency(row.measurementValue),
        formatCurrency(row.asbuiltValue),
        formatCurrency(row.billingValue),
        formatSignedCurrency(row.asbuiltMeasurementDiff),
        formatSignedCurrency(row.billingAsbuiltDiff),
      ]),
    ]);
  }

  return (
    <section className={styles.wrapper}>
      {feedback ? (
        <div className={feedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError}>
          {feedback.message}
        </div>
      ) : null}

      <article className={`${styles.card} ${styles.chartCard}`}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Grafico operacional</h2>
            <p className={styles.cardSubtitle}>Comparativo independente entre total medido, medido em projetos com As Built, As Built e faturado.</p>
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.primaryButton} onClick={() => void loadChart()} disabled={isChartLoading}>
              {isChartLoading ? "Filtrando..." : "Filtrar grafico"}
            </button>
          </div>
        </div>

        <div className={styles.chartFilterGrid}>
          <label className={styles.field}>
            <span>Centro de servico</span>
            <select value={chartServiceCenterId} onChange={(event) => handleChartServiceCenterChange(event.target.value)} disabled={isChartLoading}>
              <option value="">Todos</option>
              {serviceCenters.map((serviceCenter) => (
                <option key={serviceCenter.id} value={serviceCenter.id}>
                  {serviceCenter.label}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Projeto</span>
            <input
              list="operational-billing-chart-projects"
              value={chartProjectSearch}
              onChange={(event) => handleChartProjectSearchChange(event.target.value)}
              placeholder="Todos ou digite o SOB"
              disabled={isChartLoading}
            />
            <datalist id="operational-billing-chart-projects">
              {chartVisibleProjects.map((project) => (
                <option key={project.id} value={project.label}>
                  {project.serviceCenter}
                </option>
              ))}
            </datalist>
          </label>
        </div>

        <div className={styles.barChart}>
          {chartItems.length ? (
            chartItems.map((item) => {
              const height = Math.max(4, (item.value / chartMaxValue) * 100);
              const helpText = chartHelpByKey[item.key] ?? "Indicador do grafico operacional.";
              const displayLabel = chartDisplayLabel(item);
              return (
                <div key={item.key} className={styles.barGroup}>
                  <div className={styles.barValue}>{formatCurrency(item.value)}</div>
                  <div className={styles.barTrack}>
                    <div className={item.value > 0 ? styles.barFill : styles.barFillEmpty} style={{ height: `${height}%` }} />
                  </div>
                  <div className={styles.barLabel}>
                    <strong>{displayLabel}</strong>
                    <span className={styles.infoIcon} title={helpText} aria-label={helpText}>
                      i
                    </span>
                  </div>
                </div>
              );
            })
          ) : (
            <div className={styles.emptyChart}>
              {isChartLoading ? "Carregando grafico..." : "Use o filtro proprio do grafico e clique em Filtrar grafico."}
            </div>
          )}
        </div>

        {chartItems.length ? (
          <div className={styles.chartInsightGrid}>
            {chartInsightItems.map((item) => (
              <div key={item.key} className={styles.chartInsightCard}>
                <span>{item.label}</span>
                <strong className={item.value < 0 ? styles.negativeValue : item.value > 0 ? styles.positiveValue : styles.neutralValue}>
                  {formatSignedCurrency(item.value)}
                </strong>
                <small>{formatPercent(item.percent)}</small>
                <p>{item.detail}</p>
              </div>
            ))}
          </div>
        ) : null}

        {chartItems.length ? (
          <div className={styles.chartTableWrapper}>
            <table className={styles.chartTable}>
              <thead>
                <tr>
                  <th>Indicador</th>
                  <th>Valor</th>
                  <th>Projetos</th>
                  <th>Medicoes</th>
                </tr>
              </thead>
              <tbody>
                {chartItems.map((item) => (
                  <tr key={`chart-table-${item.key}`}>
                    <td><strong>{chartDisplayLabel(item)}</strong></td>
                    <td>{formatCurrency(item.value)}</td>
                    <td>{formatNumber(item.projectCount)}</td>
                    <td>{formatNumber(item.measurementCount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </article>

      <article className={`${styles.card} ${styles.operationalIndicatorsCard}`}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Indicadores operacionais medidos</h2>
            <p className={styles.cardSubtitle}>
              Quantidades de Medicao, ASBUILT e Faturamento consolidadas em todos os projetos ativos validos do tenant.
            </p>
          </div>
        </div>

        {operationalCategoryCards.length ? (
          <div className={styles.operationalIndicatorGrid}>
            {operationalCategoryCards.map((card) => (
              <div key={card.key} className={styles.operationalIndicator}>
                <span className={styles.operationalIndicatorTitle}>{card.label}</span>
                <div className={styles.operationalIndicatorValues}>
                  <div className={styles.operationalIndicatorMetric}>
                    <span>Medidos</span>
                    <strong>{formatNumber(card.measurementQuantity)}</strong>
                  </div>
                  <div className={styles.operationalIndicatorMetric}>
                    <span>ASBUILT</span>
                    <strong>{formatNumber(card.asbuiltQuantity)}</strong>
                  </div>
                  <div className={styles.operationalIndicatorMetric}>
                    <span>Faturado</span>
                    <strong>{formatNumber(card.billingQuantity)}</strong>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className={styles.operationalIndicatorEmpty}>
            {isProjectValuesLoading ? "Carregando indicadores..." : "Nenhum indicador operacional encontrado."}
          </p>
        )}
      </article>

      <article className={`${styles.card} ${styles.filtersCard}`}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Filtros</h2>
            <p className={styles.cardSubtitle}>Comparativo por projeto entre Medicao, Medicao Asbuilt e Faturamento.</p>
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.primaryButton} onClick={() => void loadDashboard()} disabled={isLoading}>
              {isLoading ? "Filtrando..." : "Filtrar"}
            </button>
          </div>
        </div>

        <div className={styles.filterGrid}>
          <label className={styles.field}>
            <span>Centro de servico *</span>
            <select value={serviceCenterId} onChange={(event) => handleServiceCenterChange(event.target.value)} disabled={isLoading}>
              <option value="">Selecione</option>
              {serviceCenters.map((serviceCenter) => (
                <option key={serviceCenter.id} value={serviceCenter.id}>
                  {serviceCenter.label}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Projeto *</span>
            <input
              list="operational-billing-projects"
              value={projectSearch}
              onChange={(event) => handleProjectSearchChange(event.target.value)}
              placeholder="Digite o SOB do projeto"
              disabled={isLoading}
            />
            <datalist id="operational-billing-projects">
              {projectInputOptions.map((project) => (
                <option key={project.id} value={project.label}>
                  {project.serviceCenter}
                </option>
              ))}
            </datalist>
          </label>

          <label className={styles.field}>
            <span>Codigo de atividade</span>
            <input
              type="text"
              value={activityCode}
              onChange={(event) => setActivityCode(event.target.value)}
              placeholder="Ex.: A001"
              disabled={isLoading}
            />
          </label>

          <label className={styles.field}>
            <span>Atividade ativa/inativa</span>
            <select value={activityStatus} onChange={(event) => setActivityStatus(event.target.value)} disabled={isLoading}>
              <option value="TODAS">Todas</option>
              <option value="ATIVA">Ativas</option>
              <option value="INATIVA">Inativas</option>
            </select>
          </label>

          <label className={styles.checkboxField}>
            <input
              type="checkbox"
              checked={onlyDivergences}
              onChange={(event) => setOnlyDivergences(event.target.checked)}
              disabled={isLoading}
            />
            <span>Mostrar somente divergencias</span>
          </label>

          <label className={styles.checkboxField}>
            <input
              type="checkbox"
              checked={onlyMissing}
              onChange={(event) => setOnlyMissing(event.target.checked)}
              disabled={isLoading}
            />
            <span>Mostrar somente codigos ausentes em alguma base</span>
          </label>
        </div>
      </article>

      <div className={`${styles.summaryGrid} ${styles.summaryBlock}`}>
        <div className={styles.metric}>
          <span>Codigos</span>
          <strong>{summary?.totalRows ?? 0}</strong>
        </div>
        <div className={styles.metric}>
          <span>Divergentes</span>
          <strong>{summary?.divergentRows ?? 0}</strong>
        </div>
        <div className={styles.metric}>
          <span>Ausentes</span>
          <strong>{summary?.missingRows ?? 0}</strong>
        </div>
        <div className={styles.metric}>
          <span>Conferidos</span>
          <strong>{summary?.conferredRows ?? 0}</strong>
        </div>
      </div>

      <article className={`${styles.card} ${styles.codesCard}`}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Codigos por origem</h2>
            <p className={styles.cardSubtitle}>
              {selectedProject ? `${selectedProject.label} | ${selectedProject.serviceCenter}` : "Selecione Centro de servico e Projeto."}
            </p>
          </div>
          <div className={styles.tableActions}>
            <button type="button" className={styles.secondaryButton} onClick={exportRows} disabled={isLoading}>
              Exportar CSV
            </button>
          </div>
        </div>

        <div className={styles.valueCardGrid}>
          <div className={styles.valueCard}>
            <span>Medicao</span>
            <strong>{formatCurrency(summary?.measurementValue ?? 0)}</strong>
          </div>
          <div className={styles.valueCard}>
            <span>Asbuilt</span>
            <strong>{formatCurrency(summary?.asbuiltValue ?? 0)}</strong>
          </div>
          <div className={styles.valueCard}>
            <span>Faturamento</span>
            <strong>{formatCurrency(summary?.billingValue ?? 0)}</strong>
          </div>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Codigo</th>
                <th>Descricao</th>
                <th>Status atividade</th>
                <th>Medicao qtd.</th>
                <th>Medicao valor</th>
                <th>Asbuilt qtd.</th>
                <th>Asbuilt valor</th>
                <th>Faturamento qtd.</th>
                <th>Faturamento valor</th>
                <th>Dif. qtd. Asbuilt x Medicao</th>
                <th>Dif. qtd. Fat. x Medicao</th>
                <th>Dif. valor Asbuilt x Medicao</th>
                <th>Dif. valor Fat. x Medicao</th>
                <th>Situacao</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((row) => (
                  <tr key={row.code}>
                    <td><strong>{row.code}</strong></td>
                    <td>{row.description || "Nao informado"}</td>
                    <td>
                      <span className={row.activityStatus === "INATIVA" ? styles.statusInactive : styles.statusActive}>
                        {row.activityStatus === "NAO_IDENTIFICADA" ? "Nao identificada" : row.activityStatus === "ATIVA" ? "Ativa" : "Inativa"}
                      </span>
                    </td>
                    <td>{formatNumber(row.measurement.quantity)}</td>
                    <td>{formatCurrency(row.measurement.value)}</td>
                    <td>{formatNumber(row.asbuilt.quantity)}</td>
                    <td>{formatCurrency(row.asbuilt.value)}</td>
                    <td>{formatNumber(row.billing.quantity)}</td>
                    <td>{formatCurrency(row.billing.value)}</td>
                    <td>{formatNumber(row.quantityDiffAsbuiltMeasurement)}</td>
                    <td>{formatNumber(row.quantityDiffBillingMeasurement)}</td>
                    <td>{formatCurrency(row.valueDiffAsbuiltMeasurement)}</td>
                    <td>{formatCurrency(row.valueDiffBillingMeasurement)}</td>
                    <td>
                      <span className={row.isMissingInAnyBase ? styles.statusMissing : row.isDivergent ? styles.statusDivergent : styles.statusOk}>
                        {row.situation}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={14} className={styles.emptyRow}>
                    {isLoading ? "Carregando comparativo..." : "Nenhum codigo encontrado para os filtros selecionados."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>

      <article className={`${styles.card} ${styles.categoryCard}`}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Resumo por categoria</h2>
            <p className={styles.cardSubtitle}>
              Quantidade e valor por categoria dos codigos do projeto selecionado.
            </p>
          </div>
          <div className={styles.tableActions}>
            <button type="button" className={styles.secondaryButton} onClick={exportCategorySummary} disabled={isLoading}>
              Exportar CSV
            </button>
          </div>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.categoryTable}>
            <thead>
              <tr>
                <th>Origem</th>
                {categoryColumns.map((category) => (
                  <th key={category.categoryId}>{category.categoryName}</th>
                ))}
                <th>Total valor</th>
              </tr>
            </thead>
            <tbody>
              {categoryColumns.length ? (
                categorySummaryRows.map((row) => (
                  <tr key={row.origin}>
                    <td><strong>{row.label}</strong></td>
                    {categoryColumns.map((category) => {
                      const totals = row.categories[category.categoryId];
                      return (
                        <td key={`${row.origin}-${category.categoryId}`}>
                          {totals && totals.itemCount > 0 ? (
                            <div className={styles.categoryCell}>
                              <strong>{formatNumber(totals.quantity)}</strong>
                              <span>{formatCurrency(totals.value)}</span>
                            </div>
                          ) : "-"}
                        </td>
                      );
                    })}
                    <td>{formatCurrency(row.totalValue)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className={styles.emptyRow}>
                    {isLoading ? "Carregando categorias..." : "Nenhuma categoria encontrada para os filtros selecionados."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>

      <article className={`${styles.card} ${styles.projectValuesCard}`}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Projetos por valor</h2>
            <p className={styles.cardSubtitle}>Valores consolidados por projeto em Medicao, Asbuilt e Faturamento.</p>
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.secondaryButton} onClick={exportProjectValues} disabled={isProjectValuesLoading}>
              Exportar CSV
            </button>
            <button type="button" className={styles.secondaryButton} onClick={() => void loadProjectValues()} disabled={isProjectValuesLoading}>
              {isProjectValuesLoading ? "Atualizando..." : "Atualizar"}
            </button>
          </div>
        </div>

        <div className={styles.projectValueFilterGrid}>
          <label className={styles.field}>
            <span>Centro de servico</span>
            <select
              value={projectValueServiceCenterId}
              onChange={(event) => {
                setProjectValueServiceCenterId(event.target.value);
                setProjectValueProjectSearch("");
              }}
              disabled={isProjectValuesLoading}
            >
              <option value="">Todos</option>
              {serviceCenters.map((serviceCenter) => (
                <option key={serviceCenter.id} value={serviceCenter.id}>
                  {serviceCenter.label}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Projeto</span>
            <input
              list="operational-billing-project-value-projects"
              value={projectValueProjectSearch}
              onChange={(event) => setProjectValueProjectSearch(event.target.value)}
              placeholder="Todos ou digite o SOB"
              disabled={isProjectValuesLoading}
            />
            <datalist id="operational-billing-project-value-projects">
              {projectValueProjectOptions.map((project) => (
                <option key={project.id} value={project.label}>
                  {project.serviceCenter}
                </option>
              ))}
            </datalist>
          </label>

          <label className={styles.field}>
            <span>Estado de trabalho</span>
            <select
              value={projectValueWorkCompletionStatus}
              onChange={(event) => setProjectValueWorkCompletionStatus(event.target.value)}
              disabled={isProjectValuesLoading}
            >
              <option value="">Todos</option>
              {projectValueWorkCompletionOptions.map((status) => (
                <option key={status.id} value={status.id}>
                  {status.label}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.checkboxField}>
            <input
              type="checkbox"
              checked={onlyAsbuiltBelowMeasurement}
              onChange={(event) => setOnlyAsbuiltBelowMeasurement(event.target.checked)}
              disabled={isProjectValuesLoading}
            />
            <span>Asbuilt menor que Medicao</span>
          </label>

          <label className={styles.checkboxField}>
            <input
              type="checkbox"
              checked={onlyBillingBelowAsbuilt}
              onChange={(event) => setOnlyBillingBelowAsbuilt(event.target.checked)}
              disabled={isProjectValuesLoading}
            />
            <span>Faturamento menor que Asbuilt</span>
          </label>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.projectValueTable}>
            <thead>
              <tr>
                <th>Projeto</th>
                <th>Centro de servico</th>
                <th>Estado de trabalho</th>
                <th>Medicao</th>
                <th>Asbuilt</th>
                <th>Faturamento</th>
                <th>Dif. Asbuilt x Medicao</th>
                <th>Dif. Faturamento x Asbuilt</th>
              </tr>
            </thead>
            <tbody>
              {paginatedProjectValueRows.length ? (
                paginatedProjectValueRows.map((row) => (
                  <tr key={row.projectId}>
                    <td><strong>{row.projectCode}</strong></td>
                    <td>{row.serviceCenter}</td>
                    <td>{row.workCompletionStatusLabel}</td>
                    <td>{formatCurrency(row.measurementValue)}</td>
                    <td>{formatCurrency(row.asbuiltValue)}</td>
                    <td>{formatCurrency(row.billingValue)}</td>
                    <td className={row.asbuiltMeasurementDiff < 0 ? styles.negativeValue : styles.neutralValue}>
                      {formatSignedCurrency(row.asbuiltMeasurementDiff)}
                    </td>
                    <td className={row.billingAsbuiltDiff < 0 ? styles.negativeValue : styles.neutralValue}>
                      {formatSignedCurrency(row.billingAsbuiltDiff)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className={styles.emptyRow}>
                    {isProjectValuesLoading ? "Carregando projetos..." : "Nenhum projeto encontrado para os filtros selecionados."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className={styles.paginationBar}>
          <span>
            {filteredProjectValueRows.length
              ? `${(projectValuePage - 1) * PROJECT_VALUE_PAGE_SIZE + 1}-${Math.min(projectValuePage * PROJECT_VALUE_PAGE_SIZE, filteredProjectValueRows.length)} de ${filteredProjectValueRows.length}`
              : "0 de 0"}
          </span>
          <div className={styles.paginationActions}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => setProjectValuePage((currentPage) => Math.max(1, currentPage - 1))}
              disabled={isProjectValuesLoading || projectValuePage <= 1}
            >
              Anterior
            </button>
            <strong>{projectValuePage} / {projectValueTotalPages}</strong>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => setProjectValuePage((currentPage) => Math.min(projectValueTotalPages, currentPage + 1))}
              disabled={isProjectValuesLoading || projectValuePage >= projectValueTotalPages}
            >
              Proxima
            </button>
          </div>
        </div>
      </article>
    </section>
  );
}
