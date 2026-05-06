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
  workedDays: number;
  percentage: number;
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
  };
  summary?: Summary | null;
  completionChart?: CompletionChartItem[];
  cycleCompletionChart?: CompletionChartItem[];
  periodCompletionChart?: CompletionChartItem[];
  cycleComparison?: CycleComparison | null;
  foremen?: ForemanRow[];
};

type ExpandedChart = "completionCycle" | "completionPeriod" | "cycle" | "foremanRanking" | "foremanBullet" | "foremanGap" | null;
type ForemanMetaMode = "cycle" | "standard" | "worked";

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
  if (mode === "standard") return summary?.defaultWorkdays ?? 0;
  if (mode === "worked") return row.workedDays;
  return summary?.workdays ?? 0;
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
  const [startDate, setStartDate] = useState(() => getCurrentYearPeriod().start);
  const [endDate, setEndDate] = useState(() => getCurrentYearPeriod().end);
  const [periodStartDraft, setPeriodStartDraft] = useState(() => getCurrentYearPeriod().start);
  const [periodEndDraft, setPeriodEndDraft] = useState(() => getCurrentYearPeriod().end);
  const [selectedCycleStart, setSelectedCycleStart] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [teamId, setTeamId] = useState("");
  const [foreman, setForeman] = useState("");
  const [completionStatus, setCompletionStatus] = useState("TODOS");
  const [cycleDraft, setCycleDraft] = useState("");
  const [projectSearchDraft, setProjectSearchDraft] = useState("");
  const [teamIdDraft, setTeamIdDraft] = useState("");
  const [foremanDraft, setForemanDraft] = useState("");
  const [completionStatusDraft, setCompletionStatusDraft] = useState("TODOS");
  const [foremanMetaModes, setForemanMetaModes] = useState<ForemanMetaMode[]>(["cycle"]);
  const [cycleMetaMode, setCycleMetaMode] = useState<ForemanMetaMode>("cycle");
  const [expandedChart, setExpandedChart] = useState<ExpandedChart>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [cycleCompletionChart, setCycleCompletionChart] = useState<CompletionChartItem[]>([]);
  const [periodCompletionChart, setPeriodCompletionChart] = useState<CompletionChartItem[]>([]);
  const [cycleComparison, setCycleComparison] = useState<CycleComparison | null>(null);
  const [foremen, setForemen] = useState<ForemanRow[]>([]);
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
      setSummary(data.summary ?? null);
      setCycleCompletionChart(data.cycleCompletionChart ?? []);
      setPeriodCompletionChart(data.periodCompletionChart ?? data.completionChart ?? []);
      setCycleComparison(data.cycleComparison ?? null);
      setForemen(data.foremen ?? []);
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
  }, [completionStatus, endDate, foreman, projectSearch, selectedCycleStart, session?.accessToken, startDate, teamId]);

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
  const primaryForemanMetaMode = foremanMetaModes[0] ?? "cycle";
  const foremanRankingRows = useMemo(
    () => [...foremen]
      .map((item) => {
        const metaValue = resolveForemanMetaValue(item, primaryForemanMetaMode);
        return {
          ...item,
          metaValue,
          percentage: metaValue > 0 ? (item.totalValue / metaValue) * 100 : 0,
        };
      })
      .sort((left, right) => right.percentage - left.percentage),
    [foremen, primaryForemanMetaMode],
  );
  const foremanRankingMax = useMemo(() => maxValue([100, ...foremanRankingRows.map((item) => item.percentage)]), [foremanRankingRows]);
  const foremanBulletMax = useMemo(
    () => maxValue(foremen.flatMap((item) => [item.totalValue, ...foremanMetaModes.map((mode) => resolveForemanMetaValue(item, mode))])),
    [foremanMetaModes, foremen],
  );
  const foremanGapRows = useMemo(
    () => foremen.map((item) => {
      const metaValue = resolveForemanMetaValue(item, primaryForemanMetaMode);
      return {
        ...item,
        gap: item.totalValue - metaValue,
        metaValue,
      };
    }),
    [foremen, primaryForemanMetaMode],
  );
  const foremanGapMax = useMemo(() => maxValue(foremanGapRows.map((item) => Math.abs(item.gap))), [foremanGapRows]);

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

  const selectedCycleLabel = cycleComparison?.label ?? "Ciclo selecionado";

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
        <div className={styles.panelCycleTitle}>{selectedCycleLabel}</div>
      </>
    );
  }

  function renderForemanRanking(isExpanded = false) {
    return (
      <article className={styles.chartPanel}>
        {renderPanelHeader("Ranking % de atingimento", foremanMetaLabels[primaryForemanMetaMode], "foremanRanking", isExpanded)}
        <div className={styles.referenceHint}>Linha de referencia: 100%</div>
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
        <div className={styles.bulletList}>
          {foremen.map((item) => (
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

  function renderForemanLegend() {
    return (
      <div className={styles.chartLegend}>
        <span className={styles.legendItem}>
          <span className={styles.legendDot} style={{ background: foremanMetaColors.value }} />
          Total equipes
        </span>
        {foremanMetaModes.map((mode) => (
          <span key={mode} className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: foremanMetaColors[mode] }} />
            {foremanMetaLabels[mode]}
          </span>
        ))}
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
              {foremen.length ? (
                foremen.map((item) => {
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

        {renderForemanLegend()}
        {renderForemanVisualizations()}
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
                <>
                  {renderForemanLegend()}
                  {renderForemanBulletChart(true)}
                </>
              ) : null}
              {expandedChart === "foremanGap" ? renderForemanGapChart(true) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
