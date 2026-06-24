"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ActionIcon } from "@/components/ui/ActionIcon";
import { useAuth } from "@/hooks/useAuth";
import { useErrorLogger } from "@/hooks/useErrorLogger";
import styles from "./OperationalBillingDashboardPageView.module.css";
import { formatDate } from "@/lib/utils/formatters";

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
  segments?: ChartSegment[];
};

type ChartSegment = {
  key: string;
  label: string;
  value: number;
};

type ChartProjectDetailRow = {
  projectId: string;
  projectCode: string;
  serviceCenter: string;
  value: number;
  orderCount: number;
};

type AsbuiltBreakdownRow = {
  projectId: string;
  projectCode: string;
  serviceCenterId: string | null;
  serviceCenter: string;
  coverageStartDate: string | null;
  coverageEndDate: string | null;
  value: number;
  itemCount: number;
};

type OperationalCategoryMetric = {
  quantity: number;
  value: number;
  itemCount: number;
};

type OperationalMeasurementCategoryCard = {
  key: string;
  label: string;
  categoryName: string;
  measurement: OperationalCategoryMetric;
  measurementAsbuilt: OperationalCategoryMetric;
  asbuilt: OperationalCategoryMetric;
  billing: OperationalCategoryMetric;
};

type OperationalMeasurementCategoryDetailRow = {
  projectId: string;
  projectCode: string;
  serviceCenter: string;
  executionDate: string | null;
  rate: number;
  measurementQuantity: number;
  measurementValue: number;
  orderCount: number;
};

type OperationalAsbuiltCategoryDetailRow = {
  projectId: string;
  projectCode: string;
  serviceCenter: string;
  coverageStartDate: string | null;
  coverageEndDate: string | null;
  rate: number;
  asbuiltQuantity: number;
  asbuiltValue: number;
  itemCount: number;
};

type OperationalBillingCategoryDetailRow = {
  projectId: string;
  projectCode: string;
  serviceCenter: string;
  rate: number;
  billingQuantity: number;
  billingValue: number;
  orderCount: number;
  itemCount: number;
};

type OperationalAverageTickets = {
  measurementByProject: number;
  measurementByService: number;
  asbuiltByProject: number;
  asbuiltByService: number;
};

type ProjectValueRow = {
  projectId: string;
  projectCode: string;
  serviceCenterId: string | null;
  serviceCenter: string;
  workCompletionStatus: string;
  workCompletionStatusLabel: string;
  serviceTypeId: string | null;
  serviceTypeName: string;
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
    asbuiltCoverageDates?: Option[];
  };
  selectedProject?: ProjectOption | null;
  rows?: DashboardRow[];
  billingCategories?: BillingCategoryRow[];
  categoryColumns?: CategoryColumn[];
  categorySummaryRows?: CategorySummaryRow[];
  chartItems?: ChartItem[];
  operationalCategoryCards?: OperationalMeasurementCategoryCard[];
  operationalAverageTickets?: OperationalAverageTickets | null;
  projectValueRows?: ProjectValueRow[];
  asbuiltBreakdownRows?: AsbuiltBreakdownRow[];
  operationalCategoryDetailRows?: OperationalMeasurementCategoryDetailRow[];
  operationalMeasurementAsbuiltCategoryDetailRows?: OperationalMeasurementCategoryDetailRow[];
  operationalAsbuiltCategoryDetailRows?: OperationalAsbuiltCategoryDetailRow[];
  operationalBillingCategoryDetailRows?: OperationalBillingCategoryDetailRow[];
  chartProjectDetailRows?: ChartProjectDetailRow[];
  summary?: Summary | null;
};

type AsbuiltBreakdownModalState = {
  projectId: string;
  projectCode: string;
  serviceCenter: string;
};

type OperationalCategoryDetailModalState = {
  key: string;
  label: string;
  categoryName: string;
};

type OperationalCategoryDetailTab = "measurement" | "measurementAsbuilt" | "asbuilt" | "billing";

type ChartProjectDetailModalState = {
  key: string;
  label: string;
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatWholeNumber(value: number) {
  const safeValue = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.trunc(safeValue));
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

function formatAsbuiltRange(startDate: string | null, endDate: string | null) {
  if (!endDate) return "Sem data de corte";
  if (!startDate) return `Inicio do projeto ate ${formatDate(endDate)}`;
  return `${formatDate(startDate)} ate ${formatDate(endDate)}`;
}

const chartHelpByKey: Record<string, string> = {
  totalMeasurement: "Soma de todas as medicoes com producao nos projetos filtrados.",
  measurementAsbuilt: "Soma da Medicao somente dos projetos que tambem possuem Medicao As Built.",
  asbuilt: "Soma dos valores registrados na Medicao As Built dos projetos filtrados.",
  billing: "Soma dos valores registrados no Faturamento dos projetos filtrados.",
};


function segmentColor(index: number, total: number): string {
  const hue = Math.round((index / total) * 360);
  return `hsl(${hue}, 65%, 45%)`;
}

const PROJECT_VALUE_PAGE_SIZE = 20;

export function OperationalBillingDashboardPageView() {
  const { session } = useAuth();
  const logError = useErrorLogger("dash-operacional-faturamento");
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [serviceCenters, setServiceCenters] = useState<Option[]>([]);
  const [asbuiltCoverageDates, setAsbuiltCoverageDates] = useState<Option[]>([]);
  const [rows, setRows] = useState<DashboardRow[]>([]);
  const [categoryColumns, setCategoryColumns] = useState<CategoryColumn[]>([]);
  const [categorySummaryRows, setCategorySummaryRows] = useState<CategorySummaryRow[]>([]);
  const [chartItems, setChartItems] = useState<ChartItem[]>([]);
  const [operationalCategoryCards, setOperationalCategoryCards] = useState<OperationalMeasurementCategoryCard[]>([]);
  const [operationalAverageTickets, setOperationalAverageTickets] = useState<OperationalAverageTickets | null>(null);
  const [projectValueRows, setProjectValueRows] = useState<ProjectValueRow[]>([]);
  const [asbuiltBreakdownRows, setAsbuiltBreakdownRows] = useState<AsbuiltBreakdownRow[]>([]);
  const [asbuiltBreakdownModal, setAsbuiltBreakdownModal] = useState<AsbuiltBreakdownModalState | null>(null);
  const [operationalCategoryDetailRows, setOperationalCategoryDetailRows] = useState<OperationalMeasurementCategoryDetailRow[]>([]);
  const [operationalMeasurementAsbuiltCategoryDetailRows, setOperationalMeasurementAsbuiltCategoryDetailRows] = useState<OperationalMeasurementCategoryDetailRow[]>([]);
  const [operationalAsbuiltCategoryDetailRows, setOperationalAsbuiltCategoryDetailRows] = useState<OperationalAsbuiltCategoryDetailRow[]>([]);
  const [operationalBillingCategoryDetailRows, setOperationalBillingCategoryDetailRows] = useState<OperationalBillingCategoryDetailRow[]>([]);
  const [operationalCategoryDetailModal, setOperationalCategoryDetailModal] = useState<OperationalCategoryDetailModalState | null>(null);
  const [operationalCategoryDetailTab, setOperationalCategoryDetailTab] = useState<OperationalCategoryDetailTab>("measurement");
  const [operationalRateFilter, setOperationalRateFilter] = useState("");
  const [chartProjectDetailRows, setChartProjectDetailRows] = useState<ChartProjectDetailRow[]>([]);
  const [chartProjectDetailModal, setChartProjectDetailModal] = useState<ChartProjectDetailModalState | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [projectId, setProjectId] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [serviceCenterId, setServiceCenterId] = useState("");
  const [chartProjectId, setChartProjectId] = useState("");
  const [chartProjectSearch, setChartProjectSearch] = useState("");
  const [chartServiceCenterId, setChartServiceCenterId] = useState("");
  const [asbuiltCoverageEndDate, setAsbuiltCoverageEndDate] = useState("");
  const [projectValueProjectSearch, setProjectValueProjectSearch] = useState("");
  const [projectValueServiceCenterId, setProjectValueServiceCenterId] = useState("");
  const [projectValueWorkCompletionStatus, setProjectValueWorkCompletionStatus] = useState("");
  const [projectValueServiceTypeId, setProjectValueServiceTypeId] = useState("");
  const [projectValuePage, setProjectValuePage] = useState(1);
  const [activityCode, setActivityCode] = useState("");
  const [activityStatus, setActivityStatus] = useState("TODAS");
  const [onlyDivergences, setOnlyDivergences] = useState(false);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [hideZeroMeasurementValues, setHideZeroMeasurementValues] = useState(false);
  const [hideZeroAsbuiltValues, setHideZeroAsbuiltValues] = useState(false);
  const [onlyZeroMeasurementValues, setOnlyZeroMeasurementValues] = useState(false);
  const [onlyZeroAsbuiltValues, setOnlyZeroAsbuiltValues] = useState(false);
  const [onlyAsbuiltBelowMeasurement, setOnlyAsbuiltBelowMeasurement] = useState(false);
  const [onlyBillingBelowAsbuilt, setOnlyBillingBelowAsbuilt] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isChartLoading, setIsChartLoading] = useState(false);
  const [isProjectValuesLoading, setIsProjectValuesLoading] = useState(false);
  const [isAsbuiltBreakdownLoading, setIsAsbuiltBreakdownLoading] = useState(false);
  const [isOperationalCategoryDetailLoading, setIsOperationalCategoryDetailLoading] = useState(false);
  const [isChartProjectDetailLoading, setIsChartProjectDetailLoading] = useState(false);
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

  const projectValueServiceTypeOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const row of projectValueRows) {
      if (row.serviceTypeId) {
        options.set(row.serviceTypeId, row.serviceTypeName || "Nao identificado");
      }
    }
    return Array.from(options.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((left, right) => left.label.localeCompare(right.label, "pt-BR"));
  }, [projectValueRows]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projectId, projects],
  );

  const selectedChartProject = useMemo(
    () => projects.find((project) => project.id === chartProjectId) ?? null,
    [chartProjectId, projects],
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
        .filter((row) => !projectValueServiceTypeId || row.serviceTypeId === projectValueServiceTypeId)
        .filter((row) => !projectSearchValue || row.projectCode.toLowerCase().includes(projectSearchValue))
        .filter((row) => !hideZeroMeasurementValues || row.measurementValue !== 0)
        .filter((row) => !hideZeroAsbuiltValues || row.asbuiltValue !== 0)
        .filter((row) => !onlyZeroMeasurementValues || row.measurementValue === 0)
        .filter((row) => !onlyZeroAsbuiltValues || row.asbuiltValue === 0)
        .filter((row) => !onlyAsbuiltBelowMeasurement || (row.asbuiltValue > 0 && row.measurementValue > 0 && row.asbuiltValue < row.measurementValue))
        .filter((row) => !onlyBillingBelowAsbuilt || (row.billingValue > 0 && row.asbuiltValue > 0 && row.billingValue < row.asbuiltValue));
    },
    [hideZeroAsbuiltValues, hideZeroMeasurementValues, onlyAsbuiltBelowMeasurement, onlyBillingBelowAsbuilt, onlyZeroAsbuiltValues, onlyZeroMeasurementValues, projectValueProjectSearch, projectValueRows, projectValueServiceCenterId, projectValueServiceTypeId, projectValueWorkCompletionStatus],
  );

  const projectValueTotals = useMemo(
    () => filteredProjectValueRows.reduce(
      (accumulator, row) => ({
        measurementValue: accumulator.measurementValue + row.measurementValue,
        asbuiltValue: accumulator.asbuiltValue + row.asbuiltValue,
        billingValue: accumulator.billingValue + row.billingValue,
        asbuiltMeasurementDiff: accumulator.asbuiltMeasurementDiff + row.asbuiltMeasurementDiff,
        billingAsbuiltDiff: accumulator.billingAsbuiltDiff + row.billingAsbuiltDiff,
      }),
      {
        measurementValue: 0,
        asbuiltValue: 0,
        billingValue: 0,
        asbuiltMeasurementDiff: 0,
        billingAsbuiltDiff: 0,
      },
    ),
    [filteredProjectValueRows],
  );

  const projectValueTotalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredProjectValueRows.length / PROJECT_VALUE_PAGE_SIZE)),
    [filteredProjectValueRows.length],
  );

  const paginatedProjectValueRows = useMemo(
    () => filteredProjectValueRows.slice((projectValuePage - 1) * PROJECT_VALUE_PAGE_SIZE, projectValuePage * PROJECT_VALUE_PAGE_SIZE),
    [filteredProjectValueRows, projectValuePage],
  );

  const asbuiltBreakdownTotalValue = useMemo(
    () => asbuiltBreakdownRows.reduce((sum, row) => sum + row.value, 0),
    [asbuiltBreakdownRows],
  );

  const operationalCategoryDetailTotalQuantity = useMemo(
    () => operationalCategoryDetailRows.reduce((sum, row) => sum + row.measurementQuantity, 0),
    [operationalCategoryDetailRows],
  );

  const operationalCategoryDetailTotalValue = useMemo(
    () => operationalCategoryDetailRows.reduce((sum, row) => sum + row.measurementValue, 0),
    [operationalCategoryDetailRows],
  );

  const operationalMeasurementAsbuiltCategoryDetailTotalQuantity = useMemo(
    () => operationalMeasurementAsbuiltCategoryDetailRows.reduce((sum, row) => sum + row.measurementQuantity, 0),
    [operationalMeasurementAsbuiltCategoryDetailRows],
  );

  const operationalMeasurementAsbuiltCategoryDetailTotalValue = useMemo(
    () => operationalMeasurementAsbuiltCategoryDetailRows.reduce((sum, row) => sum + row.measurementValue, 0),
    [operationalMeasurementAsbuiltCategoryDetailRows],
  );

  const operationalAsbuiltCategoryDetailTotalQuantity = useMemo(
    () => operationalAsbuiltCategoryDetailRows.reduce((sum, row) => sum + row.asbuiltQuantity, 0),
    [operationalAsbuiltCategoryDetailRows],
  );

  const operationalAsbuiltCategoryDetailTotalValue = useMemo(
    () => operationalAsbuiltCategoryDetailRows.reduce((sum, row) => sum + row.asbuiltValue, 0),
    [operationalAsbuiltCategoryDetailRows],
  );

  const operationalBillingCategoryDetailTotalQuantity = useMemo(
    () => operationalBillingCategoryDetailRows.reduce((sum, row) => sum + row.billingQuantity, 0),
    [operationalBillingCategoryDetailRows],
  );

  const operationalBillingCategoryDetailTotalValue = useMemo(
    () => operationalBillingCategoryDetailRows.reduce((sum, row) => sum + row.billingValue, 0),
    [operationalBillingCategoryDetailRows],
  );

  const chartProjectDetailTotalValue = useMemo(
    () => chartProjectDetailRows.reduce((sum, row) => sum + row.value, 0),
    [chartProjectDetailRows],
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
      setAsbuiltCoverageDates(payload.filters?.asbuiltCoverageDates ?? []);
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
    if (asbuiltCoverageEndDate) params.set("asbuiltCoverageEndDate", asbuiltCoverageEndDate);

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
      setAsbuiltCoverageDates(payload.filters?.asbuiltCoverageDates ?? []);
      setProjectValueRows(payload.projectValueRows ?? []);
      setOperationalCategoryCards(payload.operationalCategoryCards ?? []);
      setOperationalAverageTickets(payload.operationalAverageTickets ?? null);
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao carregar valores por projeto." });
      await logError("Falha ao carregar valores por projeto", error);
    } finally {
      setIsProjectValuesLoading(false);
    }
  }, [asbuiltCoverageEndDate, logError, session?.accessToken]);

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
      setAsbuiltCoverageDates(payload.filters?.asbuiltCoverageDates ?? []);
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
    if (asbuiltCoverageEndDate) params.set("asbuiltCoverageEndDate", asbuiltCoverageEndDate);

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
      setAsbuiltCoverageDates(payload.filters?.asbuiltCoverageDates ?? []);
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
  }, [asbuiltCoverageEndDate, chartProjectId, chartProjectSearch, chartServiceCenterId, logError, session?.accessToken]);

  const openAsbuiltBreakdown = useCallback(async (project: AsbuiltBreakdownModalState) => {
    if (!session?.accessToken) return;

    setAsbuiltBreakdownModal(project);
    setAsbuiltBreakdownRows([]);
    setIsAsbuiltBreakdownLoading(true);

    try {
      const params = new URLSearchParams({
        includeAsbuiltBreakdown: "true",
        asbuiltBreakdownProjectId: project.projectId,
      });
      if (asbuiltCoverageEndDate) params.set("asbuiltCoverageEndDate", asbuiltCoverageEndDate);

      const response = await fetch(`/api/dash-operacional-faturamento?${params.toString()}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      const payload = (await response.json().catch(() => ({}))) as DashboardResponse;

      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao carregar detalhamento do Asbuilt.");
      }

      setAsbuiltBreakdownRows(payload.asbuiltBreakdownRows ?? []);
    } catch (error) {
      setAsbuiltBreakdownModal(null);
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao carregar detalhamento do Asbuilt." });
      await logError("Falha ao carregar detalhamento por faixa do Asbuilt", error, project);
    } finally {
      setIsAsbuiltBreakdownLoading(false);
    }
  }, [asbuiltCoverageEndDate, logError, session?.accessToken]);

  function closeAsbuiltBreakdownModal() {
    setAsbuiltBreakdownModal(null);
    setAsbuiltBreakdownRows([]);
    setIsAsbuiltBreakdownLoading(false);
  }

  const openOperationalCategoryDetail = useCallback(async (
    card: OperationalCategoryDetailModalState,
    coverageEndDate = asbuiltCoverageEndDate,
    resetTab = true,
    rateFilter = operationalRateFilter,
  ) => {
    if (!session?.accessToken) return;

    setOperationalCategoryDetailModal(card);
    setOperationalCategoryDetailRows([]);
    setOperationalMeasurementAsbuiltCategoryDetailRows([]);
    setOperationalAsbuiltCategoryDetailRows([]);
    setOperationalBillingCategoryDetailRows([]);
    if (resetTab) setOperationalCategoryDetailTab("measurement");
    setIsOperationalCategoryDetailLoading(true);

    try {
      const params = new URLSearchParams({
        includeOperationalCategoryDetail: "true",
        operationalCategoryKey: card.key,
      });
      if (coverageEndDate) params.set("asbuiltCoverageEndDate", coverageEndDate);
      if (rateFilter.trim()) params.set("operationalRate", rateFilter.trim());

      const response = await fetch(`/api/dash-operacional-faturamento?${params.toString()}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      const payload = (await response.json().catch(() => ({}))) as DashboardResponse;

      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao carregar detalhes da categoria operacional.");
      }

      setOperationalCategoryDetailRows(payload.operationalCategoryDetailRows ?? []);
      setOperationalMeasurementAsbuiltCategoryDetailRows(payload.operationalMeasurementAsbuiltCategoryDetailRows ?? []);
      setOperationalAsbuiltCategoryDetailRows(payload.operationalAsbuiltCategoryDetailRows ?? []);
      setOperationalBillingCategoryDetailRows(payload.operationalBillingCategoryDetailRows ?? []);
    } catch (error) {
      setOperationalCategoryDetailModal(null);
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao carregar detalhes da categoria operacional." });
      await logError("Falha ao carregar detalhes da categoria operacional", error, card);
    } finally {
      setIsOperationalCategoryDetailLoading(false);
    }
  }, [asbuiltCoverageEndDate, logError, operationalRateFilter, session?.accessToken]);

  function handleOperationalCategoryCoverageChange(value: string) {
    setAsbuiltCoverageEndDate(value);
    if (operationalCategoryDetailModal) {
      void openOperationalCategoryDetail(operationalCategoryDetailModal, value, false, operationalRateFilter);
    }
  }

  function applyOperationalCategoryModalFilters() {
    if (operationalCategoryDetailModal) {
      void openOperationalCategoryDetail(operationalCategoryDetailModal, asbuiltCoverageEndDate, false, operationalRateFilter);
    }
  }

  function closeOperationalCategoryDetailModal() {
    setOperationalCategoryDetailModal(null);
    setOperationalCategoryDetailRows([]);
    setOperationalMeasurementAsbuiltCategoryDetailRows([]);
    setOperationalAsbuiltCategoryDetailRows([]);
    setOperationalBillingCategoryDetailRows([]);
    setOperationalCategoryDetailTab("measurement");
    setOperationalRateFilter("");
    setIsOperationalCategoryDetailLoading(false);
  }

  const openChartProjectDetail = useCallback(async (item: ChartItem) => {
    if (!session?.accessToken) return;

    setChartProjectDetailModal({ key: item.key, label: chartDisplayLabel(item) });
    setChartProjectDetailRows([]);
    setIsChartProjectDetailLoading(true);

    try {
      const params = new URLSearchParams({
        includeChartProjectDetail: "true",
        chartIndicatorKey: item.key,
      });
      if (chartServiceCenterId) params.set("chartServiceCenterId", chartServiceCenterId);
      if (chartProjectId) params.set("chartProjectId", chartProjectId);
      if (asbuiltCoverageEndDate) params.set("asbuiltCoverageEndDate", asbuiltCoverageEndDate);

      const response = await fetch(`/api/dash-operacional-faturamento?${params.toString()}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      const payload = (await response.json().catch(() => ({}))) as DashboardResponse;

      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao carregar projetos do indicador.");
      }

      setChartProjectDetailRows(payload.chartProjectDetailRows ?? []);
    } catch (error) {
      setChartProjectDetailModal(null);
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao carregar projetos do indicador." });
      await logError("Falha ao carregar projetos do indicador do grafico", error, item);
    } finally {
      setIsChartProjectDetailLoading(false);
    }
  }, [asbuiltCoverageEndDate, chartProjectId, chartServiceCenterId, logError, session?.accessToken]);

  function closeChartProjectDetailModal() {
    setChartProjectDetailModal(null);
    setChartProjectDetailRows([]);
    setIsChartProjectDetailLoading(false);
  }

  useEffect(() => {
    void loadMetadata();
  }, [loadMetadata]);

  useEffect(() => {
    void loadProjectValues();
  }, [loadProjectValues]);

  useEffect(() => {
    setProjectValuePage(1);
  }, [
    hideZeroAsbuiltValues,
    hideZeroMeasurementValues,
    onlyAsbuiltBelowMeasurement,
    onlyBillingBelowAsbuilt,
    onlyZeroAsbuiltValues,
    onlyZeroMeasurementValues,
    projectValueProjectSearch,
    projectValueServiceCenterId,
    projectValueServiceTypeId,
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
        "tipo_servico",
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
        row.serviceTypeName || "Nao informado",
        formatCurrency(row.measurementValue),
        formatCurrency(row.asbuiltValue),
        formatCurrency(row.billingValue),
        formatSignedCurrency(row.asbuiltMeasurementDiff),
        formatSignedCurrency(row.billingAsbuiltDiff),
      ]),
      [
        "TOTAL",
        "",
        "",
        "",
        formatCurrency(projectValueTotals.measurementValue),
        formatCurrency(projectValueTotals.asbuiltValue),
        formatCurrency(projectValueTotals.billingValue),
        formatSignedCurrency(projectValueTotals.asbuiltMeasurementDiff),
        formatSignedCurrency(projectValueTotals.billingAsbuiltDiff),
      ],
    ]);
  }

  const currentOperationalMeasurementRows = operationalCategoryDetailTab === "measurementAsbuilt"
    ? operationalMeasurementAsbuiltCategoryDetailRows
    : operationalCategoryDetailRows;
  const currentOperationalMeasurementTotalQuantity = operationalCategoryDetailTab === "measurementAsbuilt"
    ? operationalMeasurementAsbuiltCategoryDetailTotalQuantity
    : operationalCategoryDetailTotalQuantity;
  const currentOperationalMeasurementTotalValue = operationalCategoryDetailTab === "measurementAsbuilt"
    ? operationalMeasurementAsbuiltCategoryDetailTotalValue
    : operationalCategoryDetailTotalValue;
  const isOperationalMeasurementTab = operationalCategoryDetailTab === "measurement" || operationalCategoryDetailTab === "measurementAsbuilt";

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

          <label className={styles.field}>
            <span>Servicos considerados ate</span>
            <select
              value={asbuiltCoverageEndDate}
              onChange={(event) => setAsbuiltCoverageEndDate(event.target.value)}
              disabled={isChartLoading || isProjectValuesLoading}
            >
              <option value="">Todos</option>
              {asbuiltCoverageDates.map((coverageDate) => (
                <option key={coverageDate.id} value={coverageDate.id}>
                  {formatDate(coverageDate.id)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className={styles.barChart}>
          {chartItems.length ? (
            chartItems.map((item) => {
              const height = Math.max(4, (item.value / chartMaxValue) * 100);
              const segments = (item.segments ?? []).filter((segment) => segment.value > 0);
              const segmentTotal = segments.reduce((sum, segment) => sum + segment.value, 0);
              const hasSegmentedBar = !asbuiltCoverageEndDate && segments.length > 1 && segmentTotal > 0;
              const helpText = chartHelpByKey[item.key] ?? "Indicador do grafico operacional.";
              const displayLabel = chartDisplayLabel(item);
              const chartProjectForBreakdown = item.key === "asbuilt" ? selectedChartProject : null;
              const isAsbuiltClickable = Boolean(chartProjectForBreakdown);
              const barContent = (
                <>
                  <div className={styles.barValue}>{formatCurrency(item.value)}</div>
                  <div className={styles.barTrack}>
                    {hasSegmentedBar ? (
                      <div className={styles.barFillSegmented} style={{ height: `${height}%` }}>
                        {segments.map((segment, segmentIndex) => (
                          <div
                            key={segment.key}
                            className={styles.barSegmentPrimary}
                            style={{
                              height: `${Math.max(4, (segment.value / segmentTotal) * 100)}%`,
                              background: segmentColor(segmentIndex, segments.length),
                            }}
                            title={`${segment.label}: ${formatCurrency(segment.value)}`}
                            aria-label={`${segment.label}: ${formatCurrency(segment.value)}`}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className={item.value > 0 ? styles.barFill : styles.barFillEmpty} style={{ height: `${height}%` }} />
                    )}
                  </div>
                  <div className={styles.barLabel}>
                    <strong>{displayLabel}</strong>
                    <span className={styles.infoIcon} title={helpText} aria-label={helpText}>
                      i
                    </span>
                  </div>
                </>
              );
              return (
                <div key={item.key} className={styles.barGroup}>
                  {isAsbuiltClickable ? (
                    <button
                      type="button"
                      className={styles.barButton}
                      onClick={() => void openAsbuiltBreakdown({
                        projectId: chartProjectForBreakdown!.id,
                        projectCode: chartProjectForBreakdown!.label,
                        serviceCenter: chartProjectForBreakdown!.serviceCenter,
                      })}
                      title={`Detalhar faixas do Asbuilt de ${chartProjectForBreakdown!.label}`}
                      aria-label={`Detalhar faixas do Asbuilt de ${chartProjectForBreakdown!.label}`}
                    >
                      {barContent}
                    </button>
                  ) : barContent}
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
                    <td>
                      <button
                        type="button"
                        className={styles.tableRowButton}
                        onClick={() => void openChartProjectDetail(item)}
                        title={`Ver projetos de ${chartDisplayLabel(item)}`}
                      >
                        {chartDisplayLabel(item)}
                      </button>
                    </td>
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
          <div className={styles.actions}>
            <label className={styles.field}>
              <span>Servicos considerados ate</span>
              <select
                value={asbuiltCoverageEndDate}
                onChange={(event) => setAsbuiltCoverageEndDate(event.target.value)}
                disabled={isProjectValuesLoading || isChartLoading}
              >
                <option value="">Todos</option>
                {asbuiltCoverageDates.map((coverageDate) => (
                  <option key={coverageDate.id} value={coverageDate.id}>
                    {formatDate(coverageDate.id)}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className={styles.secondaryButton} onClick={() => void loadProjectValues()} disabled={isProjectValuesLoading}>
              {isProjectValuesLoading ? "Atualizando..." : "Atualizar indicadores"}
            </button>
          </div>
        </div>

        {operationalCategoryCards.length ? (
          <>
            <div className={styles.operationalTicketGrid}>
              <div className={styles.operationalTicketCard}>
                <span>Medicao</span>
                <strong>Ticket medio / Projetos</strong>
                <b>{formatCurrency(operationalAverageTickets?.measurementByProject ?? 0)}</b>
              </div>
              <div className={styles.operationalTicketCard}>
                <span>Medicao</span>
                <strong>Ticket medio / Servicos</strong>
                <b>{formatCurrency(operationalAverageTickets?.measurementByService ?? 0)}</b>
              </div>
              <div className={styles.operationalTicketCard}>
                <span>Asbuilt</span>
                <strong>Ticket medio / Projetos</strong>
                <b>{formatCurrency(operationalAverageTickets?.asbuiltByProject ?? 0)}</b>
              </div>
              <div className={styles.operationalTicketCard}>
                <span>Asbuilt</span>
                <strong>Ticket medio / Servicos</strong>
                <b>{formatCurrency(operationalAverageTickets?.asbuiltByService ?? 0)}</b>
              </div>
            </div>

            <div className={styles.operationalIndicatorGrid}>
              {operationalCategoryCards.map((card) => (
                <div key={card.key} className={styles.operationalIndicator}>
                  <div className={styles.operationalIndicatorHeader}>
                    <span className={styles.operationalIndicatorTitle}>{card.label}</span>
                    <button
                      type="button"
                      className={styles.iconButton}
                      onClick={() => void openOperationalCategoryDetail({
                        key: card.key,
                        label: card.label,
                        categoryName: card.categoryName,
                      })}
                      title={`Ver projetos e datas de execucao de ${card.label}`}
                      aria-label={`Ver projetos e datas de execucao de ${card.label}`}
                    >
                      <ActionIcon name="details" />
                    </button>
                  </div>
                  <div className={styles.operationalIndicatorValues}>
                    <div className={styles.operationalIndicatorMetric}>
                      <span>Medicao</span>
                      <strong>{formatWholeNumber(card.measurement?.quantity ?? 0)}</strong>
                      <small>{formatCurrency(card.measurement?.value ?? 0)}</small>
                    </div>
                    <div className={styles.operationalIndicatorMetric}>
                      <span>M. As built</span>
                      <strong>{formatWholeNumber(card.measurementAsbuilt?.quantity ?? 0)}</strong>
                      <small>{formatCurrency(card.measurementAsbuilt?.value ?? 0)}</small>
                    </div>
                    <div className={styles.operationalIndicatorMetric}>
                      <span>ASBUILT</span>
                      <strong>{formatWholeNumber(card.asbuilt?.quantity ?? 0)}</strong>
                      <small>{formatCurrency(card.asbuilt?.value ?? 0)}</small>
                    </div>
                    <div className={styles.operationalIndicatorMetric}>
                      <span>Faturado</span>
                      <strong>{formatWholeNumber(card.billing?.quantity ?? 0)}</strong>
                      <small>{formatCurrency(card.billing?.value ?? 0)}</small>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
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

          <label className={styles.field}>
            <span>Tipo de servico</span>
            <select
              value={projectValueServiceTypeId}
              onChange={(event) => setProjectValueServiceTypeId(event.target.value)}
              disabled={isProjectValuesLoading}
            >
              <option value="">Todos</option>
              {projectValueServiceTypeOptions.map((serviceType) => (
                <option key={serviceType.id} value={serviceType.id}>
                  {serviceType.label}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.checkboxField}>
            <input
              type="checkbox"
              checked={hideZeroMeasurementValues}
              onChange={(event) => {
                setHideZeroMeasurementValues(event.target.checked);
                if (event.target.checked) setOnlyZeroMeasurementValues(false);
              }}
              disabled={isProjectValuesLoading}
            />
            <span>Ocultar Medicao zerada</span>
          </label>

          <label className={styles.checkboxField}>
            <input
              type="checkbox"
              checked={hideZeroAsbuiltValues}
              onChange={(event) => {
                setHideZeroAsbuiltValues(event.target.checked);
                if (event.target.checked) setOnlyZeroAsbuiltValues(false);
              }}
              disabled={isProjectValuesLoading}
            />
            <span>Ocultar Asbuilt zerado</span>
          </label>

          <label className={styles.checkboxField}>
            <input
              type="checkbox"
              checked={onlyZeroMeasurementValues}
              onChange={(event) => {
                setOnlyZeroMeasurementValues(event.target.checked);
                if (event.target.checked) setHideZeroMeasurementValues(false);
              }}
              disabled={isProjectValuesLoading}
            />
            <span>Somente Medicao zerada</span>
          </label>

          <label className={styles.checkboxField}>
            <input
              type="checkbox"
              checked={onlyZeroAsbuiltValues}
              onChange={(event) => {
                setOnlyZeroAsbuiltValues(event.target.checked);
                if (event.target.checked) setHideZeroAsbuiltValues(false);
              }}
              disabled={isProjectValuesLoading}
            />
            <span>Somente Asbuilt zerado</span>
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
                  <th>Tipo de servico</th>
                  <th>Medicao</th>
                  <th>Asbuilt</th>
                  <th>Faturamento</th>
                  <th>Dif. Asbuilt x Medicao</th>
                  <th>Dif. Faturamento x Asbuilt</th>
                  <th>Detalhar</th>
                </tr>
              </thead>
              <tbody>
                {paginatedProjectValueRows.length ? (
                  paginatedProjectValueRows.map((row) => (
                  <tr key={row.projectId}>
                    <td><strong>{row.projectCode}</strong></td>
                    <td>{row.serviceCenter}</td>
                    <td>{row.workCompletionStatusLabel}</td>
                    <td>{row.serviceTypeName || "Nao informado"}</td>
                    <td>{formatCurrency(row.measurementValue)}</td>
                    <td>{formatCurrency(row.asbuiltValue)}</td>
                    <td>{formatCurrency(row.billingValue)}</td>
                    <td className={row.asbuiltMeasurementDiff < 0 ? styles.negativeValue : styles.neutralValue}>
                      {formatSignedCurrency(row.asbuiltMeasurementDiff)}
                    </td>
                    <td className={row.billingAsbuiltDiff < 0 ? styles.negativeValue : styles.neutralValue}>
                      {formatSignedCurrency(row.billingAsbuiltDiff)}
                    </td>
                    <td>
                      <button
                        type="button"
                        className={styles.iconButton}
                        onClick={() => void openAsbuiltBreakdown({
                          projectId: row.projectId,
                          projectCode: row.projectCode,
                          serviceCenter: row.serviceCenter,
                        })}
                        title={`Detalhar faixas do Asbuilt do projeto ${row.projectCode}`}
                        aria-label={`Detalhar faixas do Asbuilt do projeto ${row.projectCode}`}
                      >
                        <ActionIcon name="details" />
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={10} className={styles.emptyRow}>
                    {isProjectValuesLoading ? "Carregando projetos..." : "Nenhum projeto encontrado para os filtros selecionados."}
                  </td>
                </tr>
              )}
            </tbody>
            {filteredProjectValueRows.length ? (
              <tfoot>
                <tr>
                  <td colSpan={4}><strong>Total filtrado</strong></td>
                  <td>{formatCurrency(projectValueTotals.measurementValue)}</td>
                  <td>{formatCurrency(projectValueTotals.asbuiltValue)}</td>
                  <td>{formatCurrency(projectValueTotals.billingValue)}</td>
                  <td className={projectValueTotals.asbuiltMeasurementDiff < 0 ? styles.negativeValue : styles.neutralValue}>
                    {formatSignedCurrency(projectValueTotals.asbuiltMeasurementDiff)}
                  </td>
                  <td className={projectValueTotals.billingAsbuiltDiff < 0 ? styles.negativeValue : styles.neutralValue}>
                    {formatSignedCurrency(projectValueTotals.billingAsbuiltDiff)}
                  </td>
                  <td>-</td>
                </tr>
              </tfoot>
            ) : null}
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

      {asbuiltBreakdownModal ? (
        <div className={styles.modalOverlay} onClick={closeAsbuiltBreakdownModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <h3>Faixas do Asbuilt</h3>
                <p className={styles.modalSubtitle}>
                  {asbuiltBreakdownModal.projectCode} | {asbuiltBreakdownModal.serviceCenter}
                </p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={closeAsbuiltBreakdownModal}>
                Fechar
              </button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.modalSummaryGrid}>
                <div className={styles.modalSummaryCard}>
                  <span>Cortes fechados</span>
                  <strong>{formatNumber(asbuiltBreakdownRows.length)}</strong>
                </div>
                <div className={styles.modalSummaryCard}>
                  <span>Valor total Asbuilt</span>
                  <strong>{formatCurrency(asbuiltBreakdownTotalValue)}</strong>
                </div>
              </div>

              <div className={styles.tableWrapper}>
                <table className={styles.modalTable}>
                  <thead>
                    <tr>
                      <th>Faixa</th>
                      <th>Inicio da faixa</th>
                      <th>Servicos considerados ate</th>
                      <th>Itens</th>
                      <th>Valor Asbuilt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {asbuiltBreakdownRows.length ? (
                      asbuiltBreakdownRows.map((row, index) => (
                        <tr key={`${row.projectId}-${row.coverageEndDate ?? index}`}>
                          <td><strong>{formatAsbuiltRange(row.coverageStartDate, row.coverageEndDate)}</strong></td>
                          <td>{row.coverageStartDate ? formatDate(row.coverageStartDate) : "Inicio do projeto"}</td>
                          <td>{formatDate(row.coverageEndDate)}</td>
                          <td>{formatNumber(row.itemCount)}</td>
                          <td>{formatCurrency(row.value)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className={styles.emptyRow}>
                          {isAsbuiltBreakdownLoading ? "Carregando detalhamento..." : "Nenhum corte fechado de Asbuilt encontrado para este projeto."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {asbuiltBreakdownRows.length ? (
                    <tfoot>
                      <tr>
                        <td colSpan={3}><strong>Total</strong></td>
                        <td>{formatNumber(asbuiltBreakdownRows.reduce((sum, row) => sum + row.itemCount, 0))}</td>
                        <td>{formatCurrency(asbuiltBreakdownTotalValue)}</td>
                      </tr>
                    </tfoot>
                  ) : null}
                </table>
              </div>
            </div>
          </article>
        </div>
      ) : null}

      {chartProjectDetailModal ? (
        <div className={styles.modalOverlay} onClick={closeChartProjectDetailModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <h3>Projetos do indicador</h3>
                <p className={styles.modalSubtitle}>{chartProjectDetailModal.label}</p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={closeChartProjectDetailModal}>
                Fechar
              </button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.modalSummaryGrid}>
                <div className={styles.modalSummaryCard}>
                  <span>Projetos</span>
                  <strong>{formatNumber(chartProjectDetailRows.length)}</strong>
                </div>
                <div className={styles.modalSummaryCard}>
                  <span>Valor total</span>
                  <strong>{formatCurrency(chartProjectDetailTotalValue)}</strong>
                </div>
              </div>

              <div className={styles.tableWrapper}>
                <table className={styles.modalTable}>
                  <thead>
                    <tr>
                      <th>Projeto</th>
                      <th>Centro de servico</th>
                      <th>Valor</th>
                      <th>Ordens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chartProjectDetailRows.length ? (
                      chartProjectDetailRows.map((row) => (
                        <tr key={row.projectId}>
                          <td><strong>{row.projectCode}</strong></td>
                          <td>{row.serviceCenter}</td>
                          <td>{formatCurrency(row.value)}</td>
                          <td>{formatNumber(row.orderCount)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className={styles.emptyRow}>
                          {isChartProjectDetailLoading ? "Carregando projetos..." : "Nenhum projeto encontrado para este indicador."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {chartProjectDetailRows.length ? (
                    <tfoot>
                      <tr>
                        <td colSpan={2}><strong>Total</strong></td>
                        <td>{formatCurrency(chartProjectDetailTotalValue)}</td>
                        <td>{formatNumber(chartProjectDetailRows.reduce((sum, row) => sum + row.orderCount, 0))}</td>
                      </tr>
                    </tfoot>
                  ) : null}
                </table>
              </div>
            </div>
          </article>
        </div>
      ) : null}

      {operationalCategoryDetailModal ? (
        <div className={styles.modalOverlay} onClick={closeOperationalCategoryDetailModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <h3>Detalhamento operacional por origem</h3>
                <p className={styles.modalSubtitle}>
                  {operationalCategoryDetailModal.label} | {operationalCategoryDetailModal.categoryName}
                </p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={closeOperationalCategoryDetailModal}>
                Fechar
              </button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.modalFilterGrid}>
                <label className={styles.field}>
                  <span>Servicos considerados ate</span>
                  <select
                    value={asbuiltCoverageEndDate}
                    onChange={(event) => handleOperationalCategoryCoverageChange(event.target.value)}
                    disabled={isOperationalCategoryDetailLoading}
                  >
                    <option value="">Todos</option>
                    {asbuiltCoverageDates.map((coverageDate) => (
                      <option key={coverageDate.id} value={coverageDate.id}>
                        {formatDate(coverageDate.id)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span>Taxa</span>
                  <input
                    value={operationalRateFilter}
                    onChange={(event) => setOperationalRateFilter(event.target.value)}
                    placeholder="Todas"
                    disabled={isOperationalCategoryDetailLoading}
                  />
                </label>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={applyOperationalCategoryModalFilters}
                  disabled={isOperationalCategoryDetailLoading}
                >
                  Aplicar filtros
                </button>
              </div>

              <div className={styles.modalTabs} role="tablist" aria-label="Origem do detalhamento operacional">
                <button
                  type="button"
                  className={operationalCategoryDetailTab === "measurement" ? styles.modalTabActive : styles.modalTab}
                  onClick={() => setOperationalCategoryDetailTab("measurement")}
                >
                  Medicao
                </button>
                <button
                  type="button"
                  className={operationalCategoryDetailTab === "measurementAsbuilt" ? styles.modalTabActive : styles.modalTab}
                  onClick={() => setOperationalCategoryDetailTab("measurementAsbuilt")}
                >
                  M. As built
                </button>
                <button
                  type="button"
                  className={operationalCategoryDetailTab === "asbuilt" ? styles.modalTabActive : styles.modalTab}
                  onClick={() => setOperationalCategoryDetailTab("asbuilt")}
                >
                  As Built
                </button>
                <button
                  type="button"
                  className={operationalCategoryDetailTab === "billing" ? styles.modalTabActive : styles.modalTab}
                  onClick={() => setOperationalCategoryDetailTab("billing")}
                >
                  Faturado
                </button>
              </div>

              <div className={styles.modalSummaryGrid}>
                <div className={styles.modalSummaryCard}>
                  <span>{isOperationalMeasurementTab ? "Projetos / Datas" : operationalCategoryDetailTab === "asbuilt" ? "Projetos / Faixas" : "Projetos"}</span>
                  <strong>{formatNumber(isOperationalMeasurementTab ? currentOperationalMeasurementRows.length : operationalCategoryDetailTab === "asbuilt" ? operationalAsbuiltCategoryDetailRows.length : operationalBillingCategoryDetailRows.length)}</strong>
                </div>
                <div className={styles.modalSummaryCard}>
                  <span>{isOperationalMeasurementTab ? "Quantidade medida" : operationalCategoryDetailTab === "asbuilt" ? "Quantidade asbuilt" : "Quantidade faturada"}</span>
                  <strong>{formatNumber(isOperationalMeasurementTab ? currentOperationalMeasurementTotalQuantity : operationalCategoryDetailTab === "asbuilt" ? operationalAsbuiltCategoryDetailTotalQuantity : operationalBillingCategoryDetailTotalQuantity)}</strong>
                </div>
                <div className={styles.modalSummaryCard}>
                  <span>Valor total</span>
                  <strong>{formatCurrency(isOperationalMeasurementTab ? currentOperationalMeasurementTotalValue : operationalCategoryDetailTab === "asbuilt" ? operationalAsbuiltCategoryDetailTotalValue : operationalBillingCategoryDetailTotalValue)}</strong>
                </div>
              </div>

              <div className={styles.tableWrapper}>
                {isOperationalMeasurementTab ? (
                  <table className={styles.modalTable}>
                    <thead>
                      <tr>
                        <th>Projeto</th>
                        <th>Centro de servico</th>
                        <th>Data execucao</th>
                        <th>Taxa</th>
                        <th>Qtd. medida</th>
                        <th>Valor</th>
                        <th>Ordens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentOperationalMeasurementRows.length ? (
                        currentOperationalMeasurementRows.map((row) => (
                          <tr key={`${row.projectId}-${row.executionDate ?? "sem-data"}-${row.rate}`}>
                            <td><strong>{row.projectCode}</strong></td>
                            <td>{row.serviceCenter}</td>
                            <td>{formatDate(row.executionDate)}</td>
                            <td>{formatNumber(row.rate)}</td>
                            <td>{formatNumber(row.measurementQuantity)}</td>
                            <td>{formatCurrency(row.measurementValue)}</td>
                            <td>{formatNumber(row.orderCount)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={7} className={styles.emptyRow}>
                            {isOperationalCategoryDetailLoading ? "Carregando detalhes..." : "Nenhum projeto com Medicao encontrado para esta categoria."}
                          </td>
                        </tr>
                      )}
                    </tbody>
                    {currentOperationalMeasurementRows.length ? (
                      <tfoot>
                        <tr>
                          <td colSpan={4}><strong>Total</strong></td>
                          <td>{formatNumber(currentOperationalMeasurementTotalQuantity)}</td>
                          <td>{formatCurrency(currentOperationalMeasurementTotalValue)}</td>
                          <td>{formatNumber(currentOperationalMeasurementRows.reduce((sum, row) => sum + row.orderCount, 0))}</td>
                        </tr>
                      </tfoot>
                    ) : null}
                  </table>
                ) : operationalCategoryDetailTab === "asbuilt" ? (
                  <table className={styles.modalTable}>
                    <thead>
                      <tr>
                        <th>Projeto</th>
                        <th>Centro de servico</th>
                        <th>Faixa As Built</th>
                        <th>Servicos considerados ate</th>
                        <th>Taxa</th>
                        <th>Qtd. As Built</th>
                        <th>Valor</th>
                        <th>Itens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {operationalAsbuiltCategoryDetailRows.length ? (
                        operationalAsbuiltCategoryDetailRows.map((row, index) => (
                          <tr key={`${row.projectId}-${row.coverageEndDate ?? index}-${row.rate}`}>
                            <td><strong>{row.projectCode}</strong></td>
                            <td>{row.serviceCenter}</td>
                            <td>{formatAsbuiltRange(row.coverageStartDate, row.coverageEndDate)}</td>
                            <td>{formatDate(row.coverageEndDate)}</td>
                            <td>{formatNumber(row.rate)}</td>
                            <td>{formatNumber(row.asbuiltQuantity)}</td>
                            <td>{formatCurrency(row.asbuiltValue)}</td>
                            <td>{formatNumber(row.itemCount)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={8} className={styles.emptyRow}>
                            {isOperationalCategoryDetailLoading ? "Carregando detalhes..." : "Nenhum projeto com As Built encontrado para esta categoria."}
                          </td>
                        </tr>
                      )}
                    </tbody>
                    {operationalAsbuiltCategoryDetailRows.length ? (
                      <tfoot>
                        <tr>
                          <td colSpan={5}><strong>Total</strong></td>
                          <td>{formatNumber(operationalAsbuiltCategoryDetailTotalQuantity)}</td>
                          <td>{formatCurrency(operationalAsbuiltCategoryDetailTotalValue)}</td>
                          <td>{formatNumber(operationalAsbuiltCategoryDetailRows.reduce((sum, row) => sum + row.itemCount, 0))}</td>
                        </tr>
                      </tfoot>
                    ) : null}
                  </table>
                ) : (
                  <table className={styles.modalTable}>
                    <thead>
                      <tr>
                        <th>Projeto</th>
                        <th>Centro de servico</th>
                        <th>Taxa</th>
                        <th>Qtd. faturada</th>
                        <th>Valor</th>
                        <th>Ordens</th>
                        <th>Itens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {operationalBillingCategoryDetailRows.length ? (
                        operationalBillingCategoryDetailRows.map((row) => (
                          <tr key={`${row.projectId}-${row.rate}`}>
                            <td><strong>{row.projectCode}</strong></td>
                            <td>{row.serviceCenter}</td>
                            <td>{formatNumber(row.rate)}</td>
                            <td>{formatNumber(row.billingQuantity)}</td>
                            <td>{formatCurrency(row.billingValue)}</td>
                            <td>{formatNumber(row.orderCount)}</td>
                            <td>{formatNumber(row.itemCount)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={7} className={styles.emptyRow}>
                            {isOperationalCategoryDetailLoading ? "Carregando detalhes..." : "Nenhum projeto com Faturamento encontrado para esta categoria."}
                          </td>
                        </tr>
                      )}
                    </tbody>
                    {operationalBillingCategoryDetailRows.length ? (
                      <tfoot>
                        <tr>
                          <td colSpan={3}><strong>Total</strong></td>
                          <td>{formatNumber(operationalBillingCategoryDetailTotalQuantity)}</td>
                          <td>{formatCurrency(operationalBillingCategoryDetailTotalValue)}</td>
                          <td>{formatNumber(operationalBillingCategoryDetailRows.reduce((sum, row) => sum + row.orderCount, 0))}</td>
                          <td>{formatNumber(operationalBillingCategoryDetailRows.reduce((sum, row) => sum + row.itemCount, 0))}</td>
                        </tr>
                      </tfoot>
                    ) : null}
                  </table>
                )}
              </div>
            </div>
          </article>
        </div>
      ) : null}
    </section>
  );
}
