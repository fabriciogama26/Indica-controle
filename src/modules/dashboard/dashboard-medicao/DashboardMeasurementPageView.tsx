"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import styles from "./DashboardMeasurementPageView.module.css";

type Option = {
  id: string;
  label: string;
};

type CycleOption = {
  cycleStart: string;
  cycleEnd: string;
  label: string;
};

type CycleWeekOption = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  workdays: number;
};

type Summary = {
  orderCount: number;
  realizedValue: number;
  metaValue: number;
  percentage: number;
  workdays: number;
  defaultWorkdays: number;
  workedDays: number;
  executedWorkdays: number;
  averageDailyValue: number;
  forecastValue: number;
  forecastPercentage: number;
  forecastDifference: number;
  completedValue: number;
  partialValue: number;
  noStatusValue: number;
};

type CompletionChartItem = {
  label: string;
  value: number;
  orders: number;
  percentage: number;
};

type CycleComparison = {
  label: string;
  value: number;
  meta: number;
  standardMeta: number;
  workedMeta: number;
  workdays: number;
  defaultWorkdays: number;
  workedDays: number;
  executedWorkdays: number;
  averageDailyValue: number;
  forecastValue: number;
  forecastPercentage: number;
  forecastDifference: number;
  percentage: number;
};

type ForemanRow = {
  foremanName: string;
  totalValue: number;
  metaValue: number;
  standardMetaValue: number;
  workedMetaValue: number;
  teamCount: number;
  metaDays?: number;
  standardMetaDays?: number;
  workedDays: number;
  percentage: number;
};

type SupervisorProductionRow = {
  supervisorId: string | null;
  supervisorName: string;
  totalValue: number;
  orderCount: number;
  productiveTeamCount: number;
  potentialTeamCount: number;
  productiveMetaValue: number;
  potentialMetaValue: number;
  productivePercentage: number;
  potentialPercentage: number;
  percentageOfTotal: number;
};

type DashboardResponse = {
  message?: string;
  cycles?: CycleOption[];
  periods?: Option[];
  selectedPeriod?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  selectedCycleStart?: string | null;
  filters?: {
    projects: Option[];
    teams: Option[];
    foremen: Option[];
    supervisors?: Option[];
  };
  summary?: Summary | null;
  completionChart?: CompletionChartItem[];
  cycleCompletionChart?: CompletionChartItem[];
  periodCompletionChart?: CompletionChartItem[];
  cycleComparison?: CycleComparison | null;
  cycleWeeks?: CycleWeekOption[];
  foremen?: ForemanRow[];
  foremenByWeek?: Record<string, ForemanRow[]>;
  supervisorsProduction?: SupervisorProductionRow[];
  supervisorsProductionByWeek?: Record<string, SupervisorProductionRow[]>;
};

type ExpandedChart = "completionCycle" | "completionPeriod" | "cycle" | "foremanRanking" | "foremanBullet" | "foremanGap" | "supervisorProduction" | null;
type ForemanMetaMode = "cycle" | "standard" | "worked";
type SupervisorMetaBase = "productive" | "potential";

const foremanMetaLabels: Record<ForemanMetaMode, string> = {
  cycle: "Meta ciclo",
  standard: "Meta ciclo padrao",
  worked: "Meta ciclo trabalhado",
};

const metaDayLabels: Record<ForemanMetaMode, string> = {
  cycle: "Dias uteis",
  standard: "Dias padrao",
  worked: "Dias reais",
};

const foremanMetaColors: Record<ForemanMetaMode | "value", string> = {
  value: "#4b77c7",
  cycle: "#f07f2f",
  standard: "#17a884",
  worked: "#7b61ff",
};

const chartStatusColors = {
  reference: "#0f172a",
  positive: "#17a884",
  negative: "#e25555",
};
const BULLET_AXIS_PADDING_FACTOR = 1.12;

function formatCurrency(value: number, compact = false) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatPercent(value: number) {
  return `${(Number.isFinite(value) ? value : 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })}%`;
}

function maxValue(values: number[]) {
  return Math.max(1, ...values.map((value) => Number(value) || 0));
}

function getCurrentYearPeriod() {
  const year = new Date().getFullYear();
  return {
    start: `${year}-01-01`,
    end: `${year}-12-31`,
  };
}

function resolveForemanMetaValue(row: ForemanRow, mode: ForemanMetaMode) {
  if (mode === "standard") return row.standardMetaValue;
  if (mode === "worked") return row.workedMetaValue;
  return row.metaValue;
}

function resolveCycleMetaValue(cycle: CycleComparison, mode: ForemanMetaMode) {
  if (mode === "standard") return cycle.standardMeta;
  if (mode === "worked") return cycle.workedMeta;
  return cycle.meta;
}

function resolveCycleDays(cycle: CycleComparison, mode: ForemanMetaMode) {
  if (mode === "standard") return cycle.defaultWorkdays;
  if (mode === "worked") return cycle.workedDays;
  return cycle.workdays;
}

function resolveCycleForecastValue(cycle: CycleComparison, mode: ForemanMetaMode) {
  return cycle.averageDailyValue * resolveCycleDays(cycle, mode);
}

function resolveCycleForecastDifference(cycle: CycleComparison, mode: ForemanMetaMode) {
  return resolveCycleForecastValue(cycle, mode) - resolveCycleMetaValue(cycle, mode);
}

function resolveForemanDays(row: ForemanRow, summary: Summary | null, mode: ForemanMetaMode) {
  if (mode === "standard") return row.standardMetaDays ?? summary?.defaultWorkdays ?? 0;
  if (mode === "worked") return row.workedDays;
  return row.metaDays ?? summary?.workdays ?? 0;
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 4H4v4M4 4l6 6M16 4h4v4M20 4l-6 6M8 20H4v-4M4 20l6-6M16 20h4v-4M20 20l-6-6" />
    </svg>
  );
}

export function DashboardMeasurementPageView() {
  const { session } = useAuth();
  const [cycles, setCycles] = useState<CycleOption[]>([]);
  const [projects, setProjects] = useState<Option[]>([]);
  const [teams, setTeams] = useState<Option[]>([]);
  const [foremenOptions, setForemenOptions] = useState<Option[]>([]);
  const [supervisorOptions, setSupervisorOptions] = useState<Option[]>([]);
  const [startDate, setStartDate] = useState(() => getCurrentYearPeriod().start);
  const [endDate, setEndDate] = useState(() => getCurrentYearPeriod().end);
  const [periodStartDraft, setPeriodStartDraft] = useState(() => getCurrentYearPeriod().start);
  const [periodEndDraft, setPeriodEndDraft] = useState(() => getCurrentYearPeriod().end);
  const [selectedCycleStart, setSelectedCycleStart] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [teamId, setTeamId] = useState("");
  const [foreman, setForeman] = useState("");
  const [supervisorId, setSupervisorId] = useState("");
  const [completionStatus, setCompletionStatus] = useState("TODOS");
  const [cycleDraft, setCycleDraft] = useState("");
  const [projectSearchDraft, setProjectSearchDraft] = useState("");
  const [teamIdDraft, setTeamIdDraft] = useState("");
  const [foremanDraft, setForemanDraft] = useState("");
  const [supervisorIdDraft, setSupervisorIdDraft] = useState("");
  const [completionStatusDraft, setCompletionStatusDraft] = useState("TODOS");
  const [foremanMetaModes, setForemanMetaModes] = useState<ForemanMetaMode[]>(["cycle"]);
  const [cycleMetaMode, setCycleMetaMode] = useState<ForemanMetaMode>("cycle");
  const [supervisorMetaBase, setSupervisorMetaBase] = useState<SupervisorMetaBase>("productive");
  const [expandedChart, setExpandedChart] = useState<ExpandedChart>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [cycleCompletionChart, setCycleCompletionChart] = useState<CompletionChartItem[]>([]);
  const [periodCompletionChart, setPeriodCompletionChart] = useState<CompletionChartItem[]>([]);
  const [cycleComparison, setCycleComparison] = useState<CycleComparison | null>(null);
  const [cycleWeeks, setCycleWeeks] = useState<CycleWeekOption[]>([]);
  const [foremen, setForemen] = useState<ForemanRow[]>([]);
  const [foremenByWeek, setForemenByWeek] = useState<Record<string, ForemanRow[]>>({});
  const [foremanWeekFilter, setForemanWeekFilter] = useState("");
  const [supervisorsProduction, setSupervisorsProduction] = useState<SupervisorProductionRow[]>([]);
  const [supervisorsProductionByWeek, setSupervisorsProductionByWeek] = useState<Record<string, SupervisorProductionRow[]>>({});
  const [supervisorWeekFilter, setSupervisorWeekFilter] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const loadDashboard = useCallback(async () => {
    if (!session?.accessToken) return;

    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (selectedCycleStart) params.set("cycleStart", selectedCycleStart);
    if (projectSearch.trim()) params.set("project", projectSearch.trim());
    if (teamId) params.set("teamId", teamId);
    if (foreman) params.set("foreman", foreman);
    if (supervisorId) params.set("supervisorId", supervisorId);
    if (completionStatus !== "TODOS") params.set("completionStatus", completionStatus);

    setIsLoading(true);
    try {
      const response = await fetch(`/api/dashboard-medicao?${params.toString()}`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
      });
      const data = (await response.json().catch(() => ({}))) as DashboardResponse;

      if (!response.ok) {
        setFeedback({ type: "error", message: data.message ?? "Falha ao carregar Dashboard Medicao." });
        return;
      }

      setCycles(data.cycles ?? []);
      setProjects(data.filters?.projects ?? []);
      setTeams(data.filters?.teams ?? []);
      setForemenOptions(data.filters?.foremen ?? []);
      setSupervisorOptions(data.filters?.supervisors ?? []);
      setSummary(data.summary ?? null);
      setCycleCompletionChart(data.cycleCompletionChart ?? []);
      setPeriodCompletionChart(data.periodCompletionChart ?? data.completionChart ?? []);
      setCycleComparison(data.cycleComparison ?? null);
      setCycleWeeks(data.cycleWeeks ?? []);
      setForemen(data.foremen ?? []);
      setForemenByWeek(data.foremenByWeek ?? {});
      setSupervisorsProduction(data.supervisorsProduction ?? []);
      setSupervisorsProductionByWeek(data.supervisorsProductionByWeek ?? {});
      const nextWeekIds = new Set((data.cycleWeeks ?? []).map((week) => week.id));
      setForemanWeekFilter((current) => (current && !nextWeekIds.has(current) ? "" : current));
      setSupervisorWeekFilter((current) => (current && !nextWeekIds.has(current) ? "" : current));
      setStartDate((current) => current || data.startDate || "");
      setEndDate((current) => current || data.endDate || "");
      setPeriodStartDraft((current) => current || data.startDate || "");
      setPeriodEndDraft((current) => current || data.endDate || "");
      setSelectedCycleStart((current) => current || data.selectedCycleStart || "");
      setFeedback(null);
    } catch {
      setFeedback({ type: "error", message: "Falha ao carregar Dashboard Medicao." });
    } finally {
      setIsLoading(false);
    }
  }, [completionStatus, endDate, foreman, projectSearch, selectedCycleStart, session?.accessToken, startDate, supervisorId, teamId]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    setCycleDraft(selectedCycleStart);
  }, [selectedCycleStart]);

  const cycleMax = useMemo(
    () => maxValue([
      cycleComparison?.value ?? 0,
      cycleComparison && cycleMetaMode !== "worked" ? resolveCycleForecastValue(cycleComparison, cycleMetaMode) : 0,
      cycleComparison ? resolveCycleMetaValue(cycleComparison, cycleMetaMode) : 0,
    ]),
    [cycleComparison, cycleMetaMode],
  );
  const selectedCycleLabel = cycleComparison?.label ?? "Ciclo selecionado";
  const selectedForemen = useMemo(
    () => foremanWeekFilter ? foremenByWeek[foremanWeekFilter] ?? [] : foremen,
    [foremanWeekFilter, foremen, foremenByWeek],
  );
  const selectedSupervisorsProduction = useMemo(
    () => supervisorWeekFilter ? supervisorsProductionByWeek[supervisorWeekFilter] ?? [] : supervisorsProduction,
    [supervisorWeekFilter, supervisorsProduction, supervisorsProductionByWeek],
  );
  const selectedForemanPeriodLabel = useMemo(
    () => cycleWeeks.find((week) => week.id === foremanWeekFilter)?.label ?? selectedCycleLabel,
    [cycleWeeks, foremanWeekFilter, selectedCycleLabel],
  );
  const selectedSupervisorPeriodLabel = useMemo(
    () => cycleWeeks.find((week) => week.id === supervisorWeekFilter)?.label ?? selectedCycleLabel,
    [cycleWeeks, selectedCycleLabel, supervisorWeekFilter],
  );
  const primaryForemanMetaMode = foremanMetaModes[0] ?? "cycle";
  const foremanRankingRows = useMemo(
    () => [...selectedForemen]
      .map((item) => {
        const metaValue = resolveForemanMetaValue(item, primaryForemanMetaMode);
        return {
          ...item,
          metaValue,
          percentage: metaValue > 0 ? (item.totalValue / metaValue) * 100 : 0,
        };
      })
      .sort((left, right) => right.percentage - left.percentage),
    [primaryForemanMetaMode, selectedForemen],
  );
  const foremanRankingMax = useMemo(() => maxValue([100, ...foremanRankingRows.map((item) => item.percentage)]), [foremanRankingRows]);
  const foremanBulletMax = useMemo(
    () => maxValue(selectedForemen.flatMap((item) => [item.totalValue, ...foremanMetaModes.map((mode) => resolveForemanMetaValue(item, mode))])) * BULLET_AXIS_PADDING_FACTOR,
    [foremanMetaModes, selectedForemen],
  );
  const foremanGapRows = useMemo(
    () => selectedForemen.map((item) => {
      const metaValue = resolveForemanMetaValue(item, primaryForemanMetaMode);
      return {
        ...item,
        gap: item.totalValue - metaValue,
        metaValue,
      };
    }),
    [primaryForemanMetaMode, selectedForemen],
  );
  const foremanGapMax = useMemo(() => maxValue(foremanGapRows.map((item) => Math.abs(item.gap))), [foremanGapRows]);
  const supervisorChartRows = useMemo(
    () => selectedSupervisorsProduction.map((item) => {
      const metaValue = supervisorMetaBase === "potential" ? item.potentialMetaValue : item.productiveMetaValue;
      const percentage = supervisorMetaBase === "potential" ? item.potentialPercentage : item.productivePercentage;
      const teamCount = supervisorMetaBase === "potential" ? item.potentialTeamCount : item.productiveTeamCount;
      return {
        ...item,
        metaValue,
        percentage,
        teamCount,
        gap: item.totalValue - metaValue,
      };
    }),
    [selectedSupervisorsProduction, supervisorMetaBase],
  );
  const supervisorRankingRows = useMemo(
    () => [...supervisorChartRows].sort((left, right) => right.percentage - left.percentage),
    [supervisorChartRows],
  );
  const supervisorProductionMax = useMemo(
    () => maxValue([100, ...supervisorRankingRows.map((item) => item.percentage)]),
    [supervisorRankingRows],
  );
  const supervisorBulletMax = useMemo(
    () => maxValue(supervisorChartRows.flatMap((item) => [item.totalValue, item.metaValue])) * BULLET_AXIS_PADDING_FACTOR,
    [supervisorChartRows],
  );
  const supervisorGapMax = useMemo(() => maxValue(supervisorChartRows.map((item) => Math.abs(item.gap))), [supervisorChartRows]);

  function openChart(chart: Exclude<ExpandedChart, null>) {
    setExpandedChart(chart);
  }

  function applyDashboardFilters() {
    const nextProjectSearch = projectSearchDraft.trim();
    const filtersAreApplied =
      selectedCycleStart === cycleDraft &&
      projectSearch === nextProjectSearch &&
      teamId === teamIdDraft &&
      foreman === foremanDraft &&
      supervisorId === supervisorIdDraft &&
      completionStatus === completionStatusDraft;

    if (filtersAreApplied) {
      void loadDashboard();
      return;
    }

    setSelectedCycleStart(cycleDraft);
    setProjectSearch(nextProjectSearch);
    setProjectSearchDraft(nextProjectSearch);
    setTeamId(teamIdDraft);
    setForeman(foremanDraft);
    setSupervisorId(supervisorIdDraft);
    setCompletionStatus(completionStatusDraft);
  }

  function applyPeriodFilter() {
    if (periodStartDraft === startDate && periodEndDraft === endDate) {
      void loadDashboard();
      return;
    }
    setStartDate(periodStartDraft);
    setEndDate(periodEndDraft);
  }

  function renderExpandButton(chart: Exclude<ExpandedChart, null>, title: string) {
    return (
      <button type="button" className={styles.expandButton} onClick={() => openChart(chart)} aria-label={`Ampliar ${title}`} title={`Ampliar ${title}`}>
        <ExpandIcon />
      </button>
    );
  }

  function toggleForemanMetaMode(mode: ForemanMetaMode) {
    setForemanMetaModes((current) => {
      if (current.includes(mode)) {
        return current.length === 1 ? current : current.filter((item) => item !== mode);
      }
      return [...current, mode];
    });
  }

  function renderLegendItem(label: string, color: string) {
    return (
      <span className={styles.legendItem}>
        <span className={styles.legendDot} style={{ background: color }} />
        {label}
      </span>
    );
  }

  function renderReferenceLegendItem(label: string) {
    return (
      <span className={styles.legendItem}>
        <span className={styles.legendLine} />
        {label}
      </span>
    );
  }

  function renderAchievementLegend() {
    return (
      <div className={styles.panelLegend}>
        {renderReferenceLegendItem("Referencia 100%")}
        {renderLegendItem("Atingiu a meta", chartStatusColors.positive)}
        {renderLegendItem("Abaixo da meta", chartStatusColors.negative)}
      </div>
    );
  }

  function renderGapLegend() {
    return (
      <div className={styles.panelLegend}>
        {renderReferenceLegendItem("Meta")}
        {renderLegendItem("Excedente", chartStatusColors.positive)}
        {renderLegendItem("Falta produzir", chartStatusColors.negative)}
      </div>
    );
  }

  function renderForemanBulletLegend() {
    return (
      <div className={styles.panelLegend}>
        {renderLegendItem("Valor realizado", foremanMetaColors.value)}
        {foremanMetaModes.map((mode) => (
          <span key={mode} className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: foremanMetaColors[mode] }} />
            {foremanMetaLabels[mode]}
          </span>
        ))}
      </div>
    );
  }

  function renderSupervisorBulletLegend() {
    return (
      <div className={styles.panelLegend}>
        {renderLegendItem("Producao realizada", foremanMetaColors.value)}
        {renderLegendItem("Meta supervisor", foremanMetaColors.cycle)}
      </div>
    );
  }

  function renderCompletionTable(items: CompletionChartItem[]) {
    return (
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Status</th>
              <th>Valor</th>
              <th>Ordens</th>
              <th>%Valor</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.label}>
                <td>{item.label}</td>
                <td>{formatCurrency(item.value)}</td>
                <td>{item.orders}</td>
                <td>{formatPercent(item.percentage)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function renderCompletionChart(items: CompletionChartItem[], isExpanded = false) {
    const completionMax = maxValue(items.map((item) => item.value));
    return (
      <div className={`${styles.dualChart} ${isExpanded ? styles.chartExpanded : ""}`}>
        {items.map((item, index) => (
          <div key={item.label} className={styles.verticalBarGroup}>
            <div className={styles.valueLabel}>{formatCurrency(item.value)}</div>
            <div className={isExpanded ? styles.verticalBarTrackExpanded : styles.verticalBarTrack}>
              <div
                className={index === 0 ? styles.barBlue : styles.barOrange}
                style={{ height: `${Math.max(4, (item.value / completionMax) * 100)}%` }}
              />
            </div>
            <strong>{item.label}</strong>
          </div>
        ))}
      </div>
    );
  }

  function renderCycleChart(isExpanded = false) {
    if (!cycleComparison) return null;
    const metaValue = resolveCycleMetaValue(cycleComparison, cycleMetaMode);
    const forecastValue = resolveCycleForecastValue(cycleComparison, cycleMetaMode);
    const showForecast = cycleMetaMode !== "worked";
    return (
      <div className={`${styles.dualChart} ${isExpanded ? styles.chartExpanded : ""}`}>
        <div className={styles.verticalBarGroup}>
          <div className={styles.valueLabel}>{formatCurrency(cycleComparison.value)}</div>
          <div className={isExpanded ? styles.verticalBarTrackExpanded : styles.verticalBarTrack}>
            <div className={styles.barBlue} style={{ height: `${Math.max(4, (cycleComparison.value / cycleMax) * 100)}%` }} />
          </div>
          <strong>Valor</strong>
        </div>
        {showForecast ? (
          <div className={styles.verticalBarGroup}>
            <div className={styles.valueLabel}>{formatCurrency(forecastValue)}</div>
            <div className={isExpanded ? styles.verticalBarTrackExpanded : styles.verticalBarTrack}>
              <div className={styles.barGreen} style={{ height: `${Math.max(4, (forecastValue / cycleMax) * 100)}%` }} />
            </div>
            <strong>Projecao de fechamento</strong>
          </div>
        ) : null}
        <div className={styles.verticalBarGroup}>
          <div className={styles.valueLabel}>{formatCurrency(metaValue)}</div>
          <div className={isExpanded ? styles.verticalBarTrackExpanded : styles.verticalBarTrack}>
            <div className={styles.barOrange} style={{ height: `${Math.max(4, (metaValue / cycleMax) * 100)}%` }} />
          </div>
          <strong>{foremanMetaLabels[cycleMetaMode]}</strong>
        </div>
      </div>
    );
  }

  function renderPanelHeader(title: string, subtitle: string, chart: Exclude<ExpandedChart, null>, isExpanded = false) {
    return (
      <>
        <div className={styles.panelHeader}>
          <div>
            <h3>{title}</h3>
            <span>{subtitle}</span>
          </div>
          {!isExpanded ? renderExpandButton(chart, title) : null}
        </div>
      </>
    );
  }

  function renderForemanRanking(isExpanded = false) {
    return (
      <article className={styles.chartPanel}>
        {renderPanelHeader("Ranking % de atingimento", foremanMetaLabels[primaryForemanMetaMode], "foremanRanking", isExpanded)}
        {renderAchievementLegend()}
        <div className={styles.panelCycleTitle}>{selectedForemanPeriodLabel}</div>
        <div className={styles.rankingList}>
          {foremanRankingRows.map((item) => {
            const barWidth = Math.min(100, (item.percentage / foremanRankingMax) * 100);
            const referenceLeft = Math.min(100, (100 / foremanRankingMax) * 100);
            return (
              <div key={item.foremanName} className={styles.rankingRow}>
                <strong title={item.foremanName}>{item.foremanName}</strong>
                <div className={styles.rankingTrack}>
                  <span className={styles.referenceLine} style={{ left: `${referenceLeft}%` }} />
                  <span
                    className={item.percentage >= 100 ? styles.rankingBarPositive : styles.rankingBarNegative}
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
                <span>{formatPercent(item.percentage)}</span>
              </div>
            );
          })}
        </div>
      </article>
    );
  }

  function renderForemanBulletChart(isExpanded = false) {
    return (
      <article className={styles.chartPanel}>
        {renderPanelHeader("Bullet chart de metas", "Valor x metas marcadas", "foremanBullet", isExpanded)}
        {renderForemanBulletLegend()}
        <div className={styles.panelCycleTitle}>{selectedForemanPeriodLabel}</div>
        <div className={styles.bulletList}>
          {selectedForemen.map((item) => (
            <div key={item.foremanName} className={styles.bulletRow}>
              <strong title={item.foremanName}>{item.foremanName}</strong>
              <div className={styles.bulletTrack}>
                <span
                  className={styles.bulletValue}
                  style={{ width: `${Math.min(100, (item.totalValue / foremanBulletMax) * 100)}%` }}
                  title={`Valor: ${formatCurrency(item.totalValue)}`}
                />
                {foremanMetaModes.map((mode) => (
                  <span
                    key={mode}
                    className={styles.bulletMarker}
                    style={{
                      background: foremanMetaColors[mode],
                      left: `${Math.min(100, (resolveForemanMetaValue(item, mode) / foremanBulletMax) * 100)}%`,
                    }}
                    title={`${foremanMetaLabels[mode]}: ${formatCurrency(resolveForemanMetaValue(item, mode))}`}
                  />
                ))}
              </div>
              <span>{formatCurrency(item.totalValue, true)}</span>
            </div>
          ))}
        </div>
      </article>
    );
  }

  function renderForemanGapChart(isExpanded = false) {
    return (
      <article className={styles.chartPanel}>
        {renderPanelHeader("Gap financeiro", foremanMetaLabels[primaryForemanMetaMode], "foremanGap", isExpanded)}
        {renderGapLegend()}
        <div className={styles.panelCycleTitle}>{selectedForemanPeriodLabel}</div>
        <div className={styles.gapList}>
          {foremanGapRows.map((item) => {
            const gapWidth = Math.min(50, (Math.abs(item.gap) / foremanGapMax) * 50);
            return (
              <div key={item.foremanName} className={styles.gapRow}>
                <strong title={item.foremanName}>{item.foremanName}</strong>
                <div className={styles.gapTrack}>
                  <span className={styles.gapCenterLine} />
                  {item.gap >= 0 ? (
                    <span className={styles.gapPositive} style={{ left: "50%", width: `${gapWidth}%` }} />
                  ) : (
                    <span className={styles.gapNegative} style={{ left: `${50 - gapWidth}%`, width: `${gapWidth}%` }} />
                  )}
                </div>
                <span className={item.gap >= 0 ? styles.gapValuePositive : styles.gapValueNegative}>
                  {formatCurrency(item.gap)}
                </span>
              </div>
            );
          })}
        </div>
      </article>
    );
  }

  function renderForemanVisualizations(isExpanded = false) {
    return (
      <div className={isExpanded ? styles.foremanVisualGridExpanded : styles.foremanVisualGrid}>
        <div className={styles.foremanVisualTop}>
          {renderForemanRanking(isExpanded)}
          {renderForemanBulletChart(isExpanded)}
        </div>
        {renderForemanGapChart(isExpanded)}
      </div>
    );
  }

  function renderSupervisorPanelHeader(title: string, subtitle: string) {
    return (
      <>
        <div className={styles.panelHeader}>
          <div>
            <h3>{title}</h3>
            <span>{subtitle}</span>
          </div>
        </div>
      </>
    );
  }

  function renderSupervisorRanking() {
    const referenceLeft = Math.min(100, (100 / supervisorProductionMax) * 100);
    return (
      <article className={styles.chartPanel}>
        {renderSupervisorPanelHeader("% atingimento", supervisorMetaBase === "potential" ? "Todas vinculadas" : "Equipes com producao")}
        {renderAchievementLegend()}
        <div className={styles.panelCycleTitle}>{selectedSupervisorPeriodLabel}</div>
        <div className={styles.rankingList}>
          {supervisorRankingRows.map((item) => (
            <div key={item.supervisorId ?? item.supervisorName} className={styles.rankingRow}>
              <strong title={item.supervisorName}>{item.supervisorName}</strong>
              <div className={styles.rankingTrack}>
                <span className={styles.referenceLine} style={{ left: `${referenceLeft}%` }} />
                <span
                  className={item.percentage >= 100 ? styles.rankingBarPositive : styles.rankingBarNegative}
                  style={{ width: `${Math.min(100, (item.percentage / supervisorProductionMax) * 100)}%` }}
                />
              </div>
              <span>{formatPercent(item.percentage)}</span>
            </div>
          ))}
        </div>
      </article>
    );
  }

  function renderSupervisorBulletChart() {
    return (
      <article className={styles.chartPanel}>
        {renderSupervisorPanelHeader("Bullet de meta", "Producao realizada x meta supervisor")}
        {renderSupervisorBulletLegend()}
        <div className={styles.panelCycleTitle}>{selectedSupervisorPeriodLabel}</div>
        <div className={styles.bulletList}>
          {supervisorChartRows.map((item) => (
            <div key={item.supervisorId ?? item.supervisorName} className={styles.bulletRow}>
              <strong title={item.supervisorName}>{item.supervisorName}</strong>
              <div className={styles.bulletTrack}>
                <span
                  className={styles.bulletValue}
                  style={{ width: `${Math.min(100, (item.totalValue / supervisorBulletMax) * 100)}%` }}
                  title={`Producao realizada: ${formatCurrency(item.totalValue)}`}
                />
                <span
                  className={styles.bulletMarker}
                  style={{
                    background: foremanMetaColors.cycle,
                    left: `${Math.min(100, (item.metaValue / supervisorBulletMax) * 100)}%`,
                  }}
                  title={`Meta supervisor: ${formatCurrency(item.metaValue)}`}
                />
              </div>
              <span>{formatCurrency(item.totalValue, true)}</span>
            </div>
          ))}
        </div>
      </article>
    );
  }

  function renderSupervisorGapChart() {
    return (
      <article className={styles.chartPanel}>
        {renderSupervisorPanelHeader("Gap financeiro", "Producao realizada - meta supervisor")}
        {renderGapLegend()}
        <div className={styles.panelCycleTitle}>{selectedSupervisorPeriodLabel}</div>
        <div className={styles.gapList}>
          {supervisorChartRows.map((item) => {
            const gapWidth = Math.min(50, (Math.abs(item.gap) / supervisorGapMax) * 50);
            return (
              <div key={item.supervisorId ?? item.supervisorName} className={styles.gapRow}>
                <strong title={item.supervisorName}>{item.supervisorName}</strong>
                <div className={styles.gapTrack}>
                  <span className={styles.gapCenterLine} />
                  {item.gap >= 0 ? (
                    <span className={styles.gapPositive} style={{ left: "50%", width: `${gapWidth}%` }} />
                  ) : (
                    <span className={styles.gapNegative} style={{ left: `${50 - gapWidth}%`, width: `${gapWidth}%` }} />
                  )}
                </div>
                <span className={item.gap >= 0 ? styles.gapValuePositive : styles.gapValueNegative}>
                  {formatCurrency(item.gap)}
                </span>
              </div>
            );
          })}
        </div>
      </article>
    );
  }

  function renderSupervisorProductionChart(isExpanded = false) {
    return (
      <div className={isExpanded ? styles.supervisorVisualGridExpanded : styles.supervisorVisualGrid}>
        <div className={styles.referenceHint}>Base: {supervisorMetaBase === "potential" ? "Todas as equipes vinculadas" : "Equipes com producao"}</div>
        <div className={styles.supervisorVisualTop}>
          {renderSupervisorRanking()}
          {renderSupervisorBulletChart()}
        </div>
        {renderSupervisorGapChart()}
      </div>
    );
  }

  const expandedTitle = expandedChart === "completionCycle"
    ? "Concluidos X parciais no ciclo"
    : expandedChart === "completionPeriod"
      ? "Concluidos X parciais por periodo"
    : expandedChart === "cycle"
      ? "Ciclo da medicao"
    : expandedChart === "foremanRanking"
      ? "Ranking % de atingimento"
    : expandedChart === "foremanBullet"
      ? "Bullet chart de metas"
    : expandedChart === "foremanGap"
      ? "Gap financeiro"
    : expandedChart === "supervisorProduction"
      ? "Supervisor no ciclo"
      : "Encarregados no ciclo";

  return (
    <section className={styles.wrapper}>
      {feedback ? (
        <div className={feedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError}>{feedback.message}</div>
      ) : null}

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Filtros</h2>
            <p className={styles.cardSubtitle}>Consolidacao por ciclo operacional da Medicao.</p>
          </div>
          <button type="button" className={styles.primaryButton} onClick={applyDashboardFilters} disabled={isLoading}>
            {isLoading ? "Filtrando..." : "Filtrar"}
          </button>
        </div>

        <div className={styles.filterGrid}>
          <label className={styles.field}>
            <span>Ciclo</span>
            <select value={cycleDraft} onChange={(event) => setCycleDraft(event.target.value)} disabled={isLoading}>
              {cycles.length ? (
                cycles.map((cycle) => (
                  <option key={cycle.cycleStart} value={cycle.cycleStart}>
                    {cycle.label}
                  </option>
                ))
              ) : (
                <option value="">Nenhum ciclo com medicao</option>
              )}
            </select>
          </label>

          <label className={styles.field}>
            <span>Projeto (SOB)</span>
            <input
              type="text"
              value={projectSearchDraft}
              onChange={(event) => setProjectSearchDraft(event.target.value)}
              placeholder="Filtrar por SOB"
              list="dashboard-medicao-projects"
              disabled={isLoading}
            />
          </label>
          <datalist id="dashboard-medicao-projects">
            {projects.map((project) => (
              <option key={project.id} value={project.label} />
            ))}
          </datalist>

          <label className={styles.field}>
            <span>Equipe</span>
            <select value={teamIdDraft} onChange={(event) => setTeamIdDraft(event.target.value)} disabled={isLoading}>
              <option value="">Todas</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.label}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Encarregado</span>
            <select value={foremanDraft} onChange={(event) => setForemanDraft(event.target.value)} disabled={isLoading}>
              <option value="">Todos</option>
              {foremenOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Supervisor</span>
            <select value={supervisorIdDraft} onChange={(event) => setSupervisorIdDraft(event.target.value)} disabled={isLoading}>
              <option value="">Todos</option>
              {supervisorOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Status execucao</span>
            <select value={completionStatusDraft} onChange={(event) => setCompletionStatusDraft(event.target.value)} disabled={isLoading}>
              <option value="TODOS">Todos</option>
              <option value="CONCLUIDO">Concluidos</option>
              <option value="PARCIAL">Parciais</option>
            </select>
          </label>
        </div>
      </article>

      <div className={styles.completionGrid}>
        <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Concluidos X parciais no ciclo</h2>
            <p className={styles.cardSubtitle}>Valores realizados agrupados pelo status economico no ciclo selecionado.</p>
          </div>
          {renderExpandButton("completionCycle", "Concluidos X parciais no ciclo")}
        </div>
        {renderCompletionTable(cycleCompletionChart)}
        {renderCompletionChart(cycleCompletionChart)}
      </article>

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Concluidos X parciais por periodo</h2>
            <p className={styles.cardSubtitle}>Valores realizados agrupados pelo status economico conforme o De/Para.</p>
          </div>
          <div className={styles.chartActions}>
            <div className={styles.periodFields}>
              <label className={styles.inlineDate}>
                <span>De</span>
                <input type="date" value={periodStartDraft} onChange={(event) => setPeriodStartDraft(event.target.value)} disabled={isLoading} />
              </label>
              <label className={styles.inlineDate}>
                <span>Para</span>
                <input type="date" value={periodEndDraft} onChange={(event) => setPeriodEndDraft(event.target.value)} disabled={isLoading} />
              </label>
            </div>
            <button type="button" className={styles.secondaryButton} onClick={applyPeriodFilter} disabled={isLoading}>
              Filtrar periodo
            </button>
            {renderExpandButton("completionPeriod", "Concluidos X parciais por periodo")}
          </div>
        </div>
        {renderCompletionTable(periodCompletionChart)}
        {renderCompletionChart(periodCompletionChart)}
      </article>
      </div>

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Ciclo da medicao</h2>
            <p className={styles.cardSubtitle}>Valor realizado contra a meta cadastrada para o ciclo.</p>
          </div>
          <div className={styles.chartActions}>
            <label className={styles.inlineSelect}>
              <span>Meta</span>
              <select value={cycleMetaMode} onChange={(event) => setCycleMetaMode(event.target.value as ForemanMetaMode)}>
                <option value="cycle">Meta ciclo</option>
                <option value="standard">Meta ciclo padrao</option>
                <option value="worked">Meta ciclo trabalhado</option>
              </select>
            </label>
            {renderExpandButton("cycle", "Ciclo da medicao")}
          </div>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Ciclo</th>
                <th>Valor</th>
                {cycleMetaMode !== "worked" ? <th>Projecao de fechamento</th> : null}
                <th>{foremanMetaLabels[cycleMetaMode]}</th>
                <th>{metaDayLabels[cycleMetaMode]}</th>
                {cycleMetaMode !== "worked" ? <th>Dias trabalhados</th> : null}
                {cycleMetaMode !== "worked" ? <th>Ritmo atual</th> : null}
                {cycleMetaMode !== "worked" ? <th>Dif. prevista</th> : null}
                <th>%Porcentagem</th>
                {cycleMetaMode !== "worked" ? <th>%Previsto</th> : null}
              </tr>
            </thead>
            <tbody>
              {cycleComparison ? (
                <tr>
                  <td>{cycleComparison.label}</td>
                  <td>{formatCurrency(cycleComparison.value)}</td>
                  {cycleMetaMode !== "worked" ? <td>{formatCurrency(resolveCycleForecastValue(cycleComparison, cycleMetaMode))}</td> : null}
                  <td>{formatCurrency(resolveCycleMetaValue(cycleComparison, cycleMetaMode))}</td>
                  <td>{resolveCycleDays(cycleComparison, cycleMetaMode)}</td>
                  {cycleMetaMode !== "worked" ? <td>{cycleComparison.executedWorkdays}</td> : null}
                  {cycleMetaMode !== "worked" ? <td>{formatCurrency(cycleComparison.averageDailyValue)}/dia</td> : null}
                  {cycleMetaMode !== "worked" ? <td>{formatCurrency(resolveCycleForecastDifference(cycleComparison, cycleMetaMode))}</td> : null}
                  <td>{formatPercent(resolveCycleMetaValue(cycleComparison, cycleMetaMode) > 0 ? (cycleComparison.value / resolveCycleMetaValue(cycleComparison, cycleMetaMode)) * 100 : 0)}</td>
                  {cycleMetaMode !== "worked" ? <td>{formatPercent(resolveCycleMetaValue(cycleComparison, cycleMetaMode) > 0 ? (resolveCycleForecastValue(cycleComparison, cycleMetaMode) / resolveCycleMetaValue(cycleComparison, cycleMetaMode)) * 100 : 0)}</td> : null}
                </tr>
              ) : (
                <tr>
                  <td colSpan={cycleMetaMode === "worked" ? 5 : 10} className={styles.emptyRow}>Nenhum ciclo encontrado.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {renderCycleChart()}
      </article>

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Encarregados no ciclo</h2>
            <p className={styles.cardSubtitle}>Valor realizado e meta por encarregado no ciclo selecionado.</p>
          </div>
          <div className={styles.chartActions}>
            <label className={styles.inlineSelect}>
              <span>Semana</span>
              <select value={foremanWeekFilter} onChange={(event) => setForemanWeekFilter(event.target.value)}>
                <option value="">Ciclo completo</option>
                {cycleWeeks.map((week) => (
                  <option key={week.id} value={week.id}>
                    {week.label}
                  </option>
                ))}
              </select>
            </label>
            <div className={styles.checkboxGroup} aria-label="Metas do grafico de encarregados">
              <span>Meta</span>
              <div className={styles.checkboxRow}>
                {(Object.keys(foremanMetaLabels) as ForemanMetaMode[]).map((mode) => (
                  <label key={mode} className={styles.checkboxOption}>
                    <input
                      type="checkbox"
                      checked={foremanMetaModes.includes(mode)}
                      onChange={() => toggleForemanMetaMode(mode)}
                    />
                    {foremanMetaLabels[mode]}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Nomes</th>
                <th>Total equipes</th>
                {foremanMetaModes.map((mode) => (
                  <th key={`${mode}-meta`}>{foremanMetaLabels[mode]}</th>
                ))}
                {foremanMetaModes.map((mode) => (
                  <th key={`${mode}-days`}>{metaDayLabels[mode]}</th>
                ))}
                {foremanMetaModes.map((mode) => (
                  <th key={`${mode}-percent`}>%{foremanMetaLabels[mode]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {selectedForemen.length ? (
                selectedForemen.map((item) => {
                  return (
                    <tr key={item.foremanName}>
                      <td>{item.foremanName}</td>
                      <td>{formatCurrency(item.totalValue)}</td>
                      {foremanMetaModes.map((mode) => (
                        <td key={`${item.foremanName}-${mode}-meta`}>{formatCurrency(resolveForemanMetaValue(item, mode))}</td>
                      ))}
                      {foremanMetaModes.map((mode) => (
                        <td key={`${item.foremanName}-${mode}-days`}>{resolveForemanDays(item, summary, mode)}</td>
                      ))}
                      {foremanMetaModes.map((mode) => {
                        const metaValue = resolveForemanMetaValue(item, mode);
                        return (
                          <td key={`${item.foremanName}-${mode}-percent`}>
                            {formatPercent(metaValue > 0 ? (item.totalValue / metaValue) * 100 : 0)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={2 + (foremanMetaModes.length * 3)} className={styles.emptyRow}>Nenhum encarregado encontrado no ciclo.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {renderForemanVisualizations()}
      </article>

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Supervisor no ciclo</h2>
            <p className={styles.cardSubtitle}>Somatoria da producao das equipes vinculadas ao supervisor no ciclo selecionado.</p>
          </div>
          <div className={styles.chartActions}>
            <label className={styles.inlineSelect}>
              <span>Semana</span>
              <select value={supervisorWeekFilter} onChange={(event) => setSupervisorWeekFilter(event.target.value)}>
                <option value="">Ciclo completo</option>
                {cycleWeeks.map((week) => (
                  <option key={week.id} value={week.id}>
                    {week.label}
                  </option>
                ))}
              </select>
            </label>
            <div className={styles.checkboxGroup} aria-label="Base da meta do supervisor">
              <span>Base da meta</span>
              <div className={styles.checkboxRow}>
                <label className={styles.checkboxOption}>
                  <input
                    type="radio"
                    name="supervisorMetaBase"
                    value="productive"
                    checked={supervisorMetaBase === "productive"}
                    onChange={() => setSupervisorMetaBase("productive")}
                  />
                  Equipes com producao
                </label>
                <label className={styles.checkboxOption}>
                  <input
                    type="radio"
                    name="supervisorMetaBase"
                    value="potential"
                    checked={supervisorMetaBase === "potential"}
                    onChange={() => setSupervisorMetaBase("potential")}
                  />
                  Todas vinculadas
                </label>
              </div>
            </div>
            {renderExpandButton("supervisorProduction", "Supervisor no ciclo")}
          </div>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Supervisor</th>
                <th>Valor produzido</th>
                <th>Equipes com producao</th>
                <th>Equipes vinculadas</th>
                <th>Ordens</th>
                <th>Meta equipes com producao</th>
                <th>% producao</th>
                <th>Meta total vinculada</th>
                <th>% total</th>
              </tr>
            </thead>
            <tbody>
              {selectedSupervisorsProduction.length ? (
                selectedSupervisorsProduction.map((item) => (
                  <tr key={item.supervisorId ?? item.supervisorName}>
                    <td>{item.supervisorName}</td>
                    <td>{formatCurrency(item.totalValue)}</td>
                    <td>{item.productiveTeamCount}</td>
                    <td>{item.potentialTeamCount}</td>
                    <td>{item.orderCount}</td>
                    <td>{formatCurrency(item.productiveMetaValue)}</td>
                    <td>{formatPercent(item.productivePercentage)}</td>
                    <td>{formatCurrency(item.potentialMetaValue)}</td>
                    <td>{formatPercent(item.potentialPercentage)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} className={styles.emptyRow}>Nenhum supervisor encontrado no recorte selecionado.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {renderSupervisorProductionChart()}
      </article>

      {expandedChart ? (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-label={expandedTitle}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2>{expandedTitle}</h2>
              <button type="button" className={styles.closeButton} onClick={() => setExpandedChart(null)} aria-label="Fechar grafico ampliado">
                x
              </button>
            </div>
            <div className={styles.modalBody}>
              {expandedChart === "completionCycle" ? (
                <>
                  {renderCompletionTable(cycleCompletionChart)}
                  {renderCompletionChart(cycleCompletionChart, true)}
                </>
              ) : null}
              {expandedChart === "completionPeriod" ? (
                <>
                  {renderCompletionTable(periodCompletionChart)}
                  {renderCompletionChart(periodCompletionChart, true)}
                </>
              ) : null}
              {expandedChart === "cycle" ? renderCycleChart(true) : null}
              {expandedChart === "foremanRanking" ? renderForemanRanking(true) : null}
              {expandedChart === "foremanBullet" ? (
                renderForemanBulletChart(true)
              ) : null}
              {expandedChart === "foremanGap" ? renderForemanGapChart(true) : null}
              {expandedChart === "supervisorProduction" ? (
                <>
                  <div className={styles.tableWrapper}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Supervisor</th>
                          <th>Valor produzido</th>
                          <th>Equipes com producao</th>
                          <th>Equipes vinculadas</th>
                          <th>Ordens</th>
                          <th>Meta equipes com producao</th>
                          <th>% producao</th>
                          <th>Meta total vinculada</th>
                          <th>% total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedSupervisorsProduction.map((item) => (
                          <tr key={item.supervisorId ?? item.supervisorName}>
                            <td>{item.supervisorName}</td>
                            <td>{formatCurrency(item.totalValue)}</td>
                            <td>{item.productiveTeamCount}</td>
                            <td>{item.potentialTeamCount}</td>
                            <td>{item.orderCount}</td>
                            <td>{formatCurrency(item.productiveMetaValue)}</td>
                            <td>{formatPercent(item.productivePercentage)}</td>
                            <td>{formatCurrency(item.potentialMetaValue)}</td>
                            <td>{formatPercent(item.potentialPercentage)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {renderSupervisorProductionChart(true)}
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
