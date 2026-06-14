"use client";

import { useMemo, useState, type Dispatch, type KeyboardEvent, type SetStateAction } from "react";

import { useDashboardTeams } from "./hooks";
import type {
  DashboardTeamRow,
  DashboardTeamsProject,
} from "./types";
import {
  dashboardFilenameToken,
  exportDashboardProjectsCsv,
  exportDashboardTeamContributionsCsv,
  formatDashboardCurrency,
  formatDashboardPercent,
  maxDashboardValue,
} from "./utils";
import styles from "./DashboardTeamsPageView.module.css";

type MetaMode = "cycle" | "standard" | "worked";
type SupervisorMetaBase = "productive" | "potential";
type ExpandedChart = "teamRanking" | "teamBullet" | "teamGap" | "supervisorProduction" | null;
type ProjectDetailModal = {
  title: string;
  subtitle: string;
  rows: DashboardTeamsProject[];
  filename: string;
} | null;
type TeamDetailModal = {
  row: DashboardTeamRow;
  periodLabel: string;
  metaMode: MetaMode;
} | null;

type MetaComparisonRow = Pick<
  DashboardTeamRow,
  "metaValue" | "standardMetaValue" | "workedMetaValue" | "metaDays" | "standardMetaDays" | "workedDays"
>;

const metaLabels: Record<MetaMode, string> = {
  cycle: "Meta ciclo",
  standard: "Meta ciclo padrao",
  worked: "Meta ciclo trabalhado",
};

const metaDayLabels: Record<MetaMode, string> = {
  cycle: "Dias uteis",
  standard: "Dias padrao",
  worked: "Dias reais",
};

const metaColors: Record<MetaMode | "value", string> = {
  value: "#4b77c7",
  cycle: "#f07f2f",
  standard: "#17a884",
  worked: "#7b61ff",
};

const chartStatusColors = {
  positive: "#17a884",
  negative: "#e25555",
};

const BULLET_AXIS_PADDING_FACTOR = 1.12;

function resolveMetaValue(row: MetaComparisonRow, mode: MetaMode) {
  if (mode === "standard") return row.standardMetaValue;
  if (mode === "worked") return row.workedMetaValue;
  return row.metaValue;
}

function resolveMetaDays(row: MetaComparisonRow, mode: MetaMode) {
  if (mode === "standard") return row.standardMetaDays ?? 0;
  if (mode === "worked") return row.workedDays;
  return row.metaDays ?? 0;
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 4H4v4M4 4l6 6M16 4h4v4M20 4l-6 6M8 20H4v-4M4 20l6-6M16 20h4v-4M20 20l-6-6" />
    </svg>
  );
}

export function DashboardTeamsPageView() {
  const dashboard = useDashboardTeams();
  const [teamWeekFilter, setTeamWeekFilter] = useState("");
  const [foremanWeekFilter, setForemanWeekFilter] = useState("");
  const [supervisorWeekFilter, setSupervisorWeekFilter] = useState("");
  const [teamMetaModes, setTeamMetaModes] = useState<MetaMode[]>(["cycle"]);
  const [supervisorMetaBase, setSupervisorMetaBase] = useState<SupervisorMetaBase>("productive");
  const [expandedChart, setExpandedChart] = useState<ExpandedChart>(null);
  const [projectDetailModal, setProjectDetailModal] = useState<ProjectDetailModal>(null);
  const [teamDetailModal, setTeamDetailModal] = useState<TeamDetailModal>(null);
  const [localMessage, setLocalMessage] = useState("");
  const [lastExportAt, setLastExportAt] = useState(0);

  const selectedTeams = useMemo(
    () => teamWeekFilter ? dashboard.teamRowsByWeek[teamWeekFilter] ?? [] : dashboard.teamRows,
    [dashboard.teamRows, dashboard.teamRowsByWeek, teamWeekFilter],
  );
  const selectedTeamForemen = useMemo(
    () => foremanWeekFilter ? dashboard.teamForemanRowsByWeek[foremanWeekFilter] ?? [] : dashboard.teamForemanRows,
    [dashboard.teamForemanRows, dashboard.teamForemanRowsByWeek, foremanWeekFilter],
  );
  const selectedSupervisors = useMemo(
    () => supervisorWeekFilter ? dashboard.supervisorRowsByWeek[supervisorWeekFilter] ?? [] : dashboard.supervisorRows,
    [dashboard.supervisorRows, dashboard.supervisorRowsByWeek, supervisorWeekFilter],
  );
  const selectedCycleLabel = dashboard.cycles.find(
    (cycle) => cycle.cycleStart === dashboard.filters.cycleStart,
  )?.label ?? "Ciclo selecionado";
  const teamPeriodLabel = dashboard.cycleWeeks.find((week) => week.id === teamWeekFilter)?.label ?? selectedCycleLabel;
  const foremanPeriodLabel = dashboard.cycleWeeks.find((week) => week.id === foremanWeekFilter)?.label ?? selectedCycleLabel;
  const supervisorPeriodLabel = dashboard.cycleWeeks.find((week) => week.id === supervisorWeekFilter)?.label ?? selectedCycleLabel;
  const primaryTeamMetaMode = teamMetaModes[0] ?? "cycle";
  const teamRankingRows = useMemo(
    () => [...selectedTeams].map((item) => {
      const metaValue = resolveMetaValue(item, primaryTeamMetaMode);
      return { ...item, metaValue, percentage: metaValue > 0 ? (item.totalValue / metaValue) * 100 : 0 };
    }).sort((left, right) => right.percentage - left.percentage),
    [primaryTeamMetaMode, selectedTeams],
  );
  const teamRankingMax = useMemo(
    () => maxDashboardValue([100, ...teamRankingRows.map((item) => item.percentage)]),
    [teamRankingRows],
  );
  const teamBulletMax = useMemo(
    () => maxDashboardValue(selectedTeams.flatMap(
      (item) => [item.totalValue, ...teamMetaModes.map((mode) => resolveMetaValue(item, mode))],
    )) * BULLET_AXIS_PADDING_FACTOR,
    [selectedTeams, teamMetaModes],
  );
  const teamGapRows = useMemo(
    () => selectedTeams.map((item) => {
      const metaValue = resolveMetaValue(item, primaryTeamMetaMode);
      return { ...item, gap: item.totalValue - metaValue, metaValue };
    }),
    [primaryTeamMetaMode, selectedTeams],
  );
  const teamGapMax = useMemo(
    () => maxDashboardValue(teamGapRows.map((item) => Math.abs(item.gap))),
    [teamGapRows],
  );
  const supervisorChartRows = useMemo(
    () => selectedSupervisors.map((item) => {
      const metaValue = supervisorMetaBase === "potential" ? item.potentialMetaValue : item.productiveMetaValue;
      const percentage = supervisorMetaBase === "potential" ? item.potentialPercentage : item.productivePercentage;
      return { ...item, metaValue, percentage, gap: item.totalValue - metaValue };
    }),
    [selectedSupervisors, supervisorMetaBase],
  );
  const supervisorRankingRows = useMemo(
    () => [...supervisorChartRows].sort((left, right) => right.percentage - left.percentage),
    [supervisorChartRows],
  );
  const supervisorRankingMax = useMemo(
    () => maxDashboardValue([100, ...supervisorRankingRows.map((item) => item.percentage)]),
    [supervisorRankingRows],
  );
  const supervisorBulletMax = useMemo(
    () => maxDashboardValue(supervisorChartRows.flatMap((item) => [item.totalValue, item.metaValue])) * BULLET_AXIS_PADDING_FACTOR,
    [supervisorChartRows],
  );
  const supervisorGapMax = useMemo(
    () => maxDashboardValue(supervisorChartRows.map((item) => Math.abs(item.gap))),
    [supervisorChartRows],
  );

  function applyFilters() {
    setTeamWeekFilter("");
    setForemanWeekFilter("");
    setSupervisorWeekFilter("");
    setLocalMessage("");
    dashboard.applyFilters();
  }

  function toggleMetaMode(mode: MetaMode, setter: Dispatch<SetStateAction<MetaMode[]>>) {
    setter((current) => current.includes(mode)
      ? (current.length === 1 ? current : current.filter((item) => item !== mode))
      : [...current, mode]);
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLElement>, callback: () => void) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      callback();
    }
  }

  function openProjectDetails(
    kind: "equipe" | "encarregado" | "supervisor",
    name: string,
    period: string,
    rows: DashboardTeamsProject[],
  ) {
    setProjectDetailModal({
      title: `Projetos ${kind === "equipe" ? "da equipe" : "de"} ${name}`,
      subtitle: period,
      rows,
      filename: `dashboard_equipes_${kind}_${dashboardFilenameToken(name)}_${new Date().toISOString().slice(0, 10)}.csv`,
    });
  }

  function openTeamDetails(row: DashboardTeamRow) {
    setTeamDetailModal({
      row,
      periodLabel: teamPeriodLabel,
      metaMode: primaryTeamMetaMode,
    });
  }

  function exportProjectDetails() {
    if (!projectDetailModal?.rows.length) {
      setLocalMessage("Nenhum projeto encontrado para exportar.");
      return;
    }
    if (Date.now() - lastExportAt < 10_000) {
      setLocalMessage("Aguarde 10 segundos entre as exportacoes.");
      return;
    }
    exportDashboardProjectsCsv(projectDetailModal.filename, projectDetailModal.rows);
    setLastExportAt(Date.now());
    setLocalMessage("");
  }

  function exportTeamDetails() {
    if (!teamDetailModal) return;
    if (Date.now() - lastExportAt < 10_000) {
      setLocalMessage("Aguarde 10 segundos entre as exportacoes.");
      return;
    }
    const metaValue = resolveMetaValue(teamDetailModal.row, teamDetailModal.metaMode);
    exportDashboardTeamContributionsCsv(
      `dashboard_equipes_mk_${dashboardFilenameToken(teamDetailModal.row.teamName)}_${new Date().toISOString().slice(0, 10)}.csv`,
      {
        teamName: teamDetailModal.row.teamName,
        metaLabel: metaLabels[teamDetailModal.metaMode],
        metaValue,
        totalValue: teamDetailModal.row.totalValue,
        projectCount: teamDetailModal.row.projectCount,
        rows: teamDetailModal.row.foremanContributions,
      },
    );
    setLastExportAt(Date.now());
    setLocalMessage("");
  }

  function renderExpandButton(chart: Exclude<ExpandedChart, null>, title: string) {
    return (
      <button type="button" className={styles.expandButton} onClick={() => setExpandedChart(chart)} aria-label={`Ampliar ${title}`} title={`Ampliar ${title}`}>
        <ExpandIcon />
      </button>
    );
  }

  function renderLegendItem(label: string, color: string) {
    return <span className={styles.legendItem}><span className={styles.legendDot} style={{ background: color }} />{label}</span>;
  }

  function renderAchievementLegend() {
    return (
      <div className={styles.panelLegend}>
        <span className={styles.legendItem}><span className={styles.legendLine} />Referencia 100%</span>
        {renderLegendItem("Atingiu a meta", chartStatusColors.positive)}
        {renderLegendItem("Abaixo da meta", chartStatusColors.negative)}
      </div>
    );
  }

  function renderGapLegend() {
    return (
      <div className={styles.panelLegend}>
        <span className={styles.legendItem}><span className={styles.legendLine} />Meta</span>
        {renderLegendItem("Excedente", chartStatusColors.positive)}
        {renderLegendItem("Falta produzir", chartStatusColors.negative)}
      </div>
    );
  }

  function renderPanelHeader(title: string, subtitle: string, chart?: Exclude<ExpandedChart, null>, expanded = false) {
    return (
      <div className={styles.panelHeader}>
        <div><h3>{title}</h3><span>{subtitle}</span></div>
        {chart && !expanded ? renderExpandButton(chart, title) : null}
      </div>
    );
  }

  function renderTeamRanking(expanded = false) {
    return (
      <article className={styles.chartPanel}>
        {renderPanelHeader("Ranking % de atingimento por MK", metaLabels[primaryTeamMetaMode], "teamRanking", expanded)}
        {renderAchievementLegend()}
        <div className={styles.panelCycleTitle}>{teamPeriodLabel}</div>
        <div className={styles.rankingList}>
          {teamRankingRows.map((item) => (
            <div key={item.teamId} className={`${styles.rankingRow} ${styles.clickableChartRow}`} role="button" tabIndex={0} onClick={() => openTeamDetails(item)} onKeyDown={(event) => handleRowKeyDown(event, () => openTeamDetails(item))}>
              <strong title={item.teamName}>{item.teamName}</strong>
              <div className={styles.rankingTrack}>
                <span className={styles.referenceLine} style={{ left: `${Math.min(100, (100 / teamRankingMax) * 100)}%` }} />
                <span
                  className={item.percentage >= 100 ? styles.rankingBarPositive : styles.rankingBarNegative}
                  style={{ width: `${Math.min(100, (item.percentage / teamRankingMax) * 100)}%` }}
                />
              </div>
              <span>{formatDashboardPercent(item.percentage)}</span>
            </div>
          ))}
        </div>
      </article>
    );
  }

  function renderTeamBullet(expanded = false) {
    return (
      <article className={styles.chartPanel}>
        {renderPanelHeader("Bullet de meta por MK", "Valor do MK x metas marcadas", "teamBullet", expanded)}
        <div className={styles.panelLegend}>
          {renderLegendItem("Valor realizado", metaColors.value)}
          {teamMetaModes.map((mode) => <span key={mode}>{renderLegendItem(metaLabels[mode], metaColors[mode])}</span>)}
        </div>
        <div className={styles.panelCycleTitle}>{teamPeriodLabel}</div>
        <div className={styles.bulletList}>
          {selectedTeams.map((item) => (
            <div key={item.teamId} className={`${styles.bulletRow} ${styles.clickableChartRow}`} role="button" tabIndex={0} onClick={() => openTeamDetails(item)} onKeyDown={(event) => handleRowKeyDown(event, () => openTeamDetails(item))}>
              <strong title={item.teamName}>{item.teamName}</strong>
              <div className={styles.bulletTrack}>
                <span className={styles.bulletValue} style={{ width: `${Math.min(100, (item.totalValue / teamBulletMax) * 100)}%` }} />
                {teamMetaModes.map((mode) => (
                  <span
                    key={mode}
                    className={styles.bulletMarker}
                    style={{ background: metaColors[mode], left: `${Math.min(100, (resolveMetaValue(item, mode) / teamBulletMax) * 100)}%` }}
                  />
                ))}
              </div>
              <span>{formatDashboardCurrency(item.totalValue, true)}</span>
            </div>
          ))}
        </div>
      </article>
    );
  }

  function renderTeamGap(expanded = false) {
    return (
      <article className={styles.chartPanel}>
        {renderPanelHeader("Gap financeiro por MK", metaLabels[primaryTeamMetaMode], "teamGap", expanded)}
        {renderGapLegend()}
        <div className={styles.panelCycleTitle}>{teamPeriodLabel}</div>
        <div className={styles.gapList}>
          {teamGapRows.map((item) => {
            const width = Math.min(50, (Math.abs(item.gap) / teamGapMax) * 50);
            return (
              <div key={item.teamId} className={`${styles.gapRow} ${styles.clickableChartRow}`} role="button" tabIndex={0} onClick={() => openTeamDetails(item)} onKeyDown={(event) => handleRowKeyDown(event, () => openTeamDetails(item))}>
                <strong title={item.teamName}>{item.teamName}</strong>
                <div className={styles.gapTrack}>
                  <span className={styles.gapCenterLine} />
                  <span
                    className={item.gap >= 0 ? styles.gapPositive : styles.gapNegative}
                    style={item.gap >= 0 ? { left: "50%", width: `${width}%` } : { left: `${50 - width}%`, width: `${width}%` }}
                  />
                </div>
                <span className={item.gap >= 0 ? styles.gapValuePositive : styles.gapValueNegative}>{formatDashboardCurrency(item.gap)}</span>
              </div>
            );
          })}
        </div>
      </article>
    );
  }

  function renderTeamVisualizations(expanded = false) {
    return (
      <div className={expanded ? styles.visualGridExpanded : styles.visualGrid}>
        <div className={styles.visualTop}>{renderTeamRanking(expanded)}{renderTeamBullet(expanded)}</div>
        {renderTeamGap(expanded)}
      </div>
    );
  }

  function renderSupervisorVisualizations(expanded = false) {
    return (
      <div className={expanded ? styles.visualGridExpanded : styles.visualGrid}>
        <div className={styles.referenceHint}>Base: {supervisorMetaBase === "potential" ? "Todas as equipes vinculadas" : "Equipes com producao"}</div>
        <div className={styles.visualTop}>
          <article className={styles.chartPanel}>
            {renderPanelHeader("% atingimento", supervisorMetaBase === "potential" ? "Todas vinculadas" : "Equipes com producao")}
            {renderAchievementLegend()}
            <div className={styles.panelCycleTitle}>{supervisorPeriodLabel}</div>
            <div className={styles.rankingList}>
              {supervisorRankingRows.map((item) => (
                <div key={item.supervisorId ?? item.supervisorName} className={styles.rankingRow}>
                  <strong>{item.supervisorName}</strong>
                  <div className={styles.rankingTrack}>
                    <span className={styles.referenceLine} style={{ left: `${Math.min(100, (100 / supervisorRankingMax) * 100)}%` }} />
                    <span className={item.percentage >= 100 ? styles.rankingBarPositive : styles.rankingBarNegative} style={{ width: `${Math.min(100, (item.percentage / supervisorRankingMax) * 100)}%` }} />
                  </div>
                  <span>{formatDashboardPercent(item.percentage)}</span>
                </div>
              ))}
            </div>
          </article>
          <article className={styles.chartPanel}>
            {renderPanelHeader("Bullet de meta", "Producao realizada x meta supervisor")}
            <div className={styles.panelLegend}>{renderLegendItem("Producao realizada", metaColors.value)}{renderLegendItem("Meta supervisor", metaColors.cycle)}</div>
            <div className={styles.panelCycleTitle}>{supervisorPeriodLabel}</div>
            <div className={styles.bulletList}>
              {supervisorChartRows.map((item) => (
                <div key={item.supervisorId ?? item.supervisorName} className={styles.bulletRow}>
                  <strong>{item.supervisorName}</strong>
                  <div className={styles.bulletTrack}>
                    <span className={styles.bulletValue} style={{ width: `${Math.min(100, (item.totalValue / supervisorBulletMax) * 100)}%` }} />
                    <span className={styles.bulletMarker} style={{ background: metaColors.cycle, left: `${Math.min(100, (item.metaValue / supervisorBulletMax) * 100)}%` }} />
                  </div>
                  <span>{formatDashboardCurrency(item.totalValue, true)}</span>
                </div>
              ))}
            </div>
          </article>
        </div>
        <article className={styles.chartPanel}>
          {renderPanelHeader("Gap financeiro", "Producao realizada - meta supervisor")}
          {renderGapLegend()}
          <div className={styles.panelCycleTitle}>{supervisorPeriodLabel}</div>
          <div className={styles.gapList}>
            {supervisorChartRows.map((item) => {
              const width = Math.min(50, (Math.abs(item.gap) / supervisorGapMax) * 50);
              return (
                <div key={item.supervisorId ?? item.supervisorName} className={styles.gapRow}>
                  <strong>{item.supervisorName}</strong>
                  <div className={styles.gapTrack}>
                    <span className={styles.gapCenterLine} />
                    <span className={item.gap >= 0 ? styles.gapPositive : styles.gapNegative} style={item.gap >= 0 ? { left: "50%", width: `${width}%` } : { left: `${50 - width}%`, width: `${width}%` }} />
                  </div>
                  <span className={item.gap >= 0 ? styles.gapValuePositive : styles.gapValueNegative}>{formatDashboardCurrency(item.gap)}</span>
                </div>
              );
            })}
          </div>
        </article>
      </div>
    );
  }

  const message = localMessage || dashboard.errorMessage;

  return (
    <section className={styles.wrapper}>
      {message ? <p className={styles.errorMessage}>{message}</p> : null}

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div><h2 className={styles.cardTitle}>Filtros do Dashboard Equipes</h2><p className={styles.cardSubtitle}>Desempenho por MK/equipe, encarregado e supervisor.</p></div>
          <button type="button" className={styles.primaryButton} disabled={dashboard.isLoading} onClick={applyFilters}>{dashboard.isLoading ? "Carregando..." : "Filtrar"}</button>
        </div>
        <div className={styles.filterGrid}>
          <label className={styles.field}><span>Ciclo</span><select value={dashboard.draftFilters.cycleStart} onChange={(event) => dashboard.setDraftFilters((current) => ({ ...current, cycleStart: event.target.value }))}><option value="">Ciclo mais recente</option>{dashboard.cycles.map((cycle) => <option key={cycle.cycleStart} value={cycle.cycleStart}>{cycle.label}</option>)}</select></label>
          <label className={styles.field}><span>Projeto (SOB)</span><input list="dashboard-equipes-projects" value={dashboard.draftFilters.project} onChange={(event) => dashboard.setDraftFilters((current) => ({ ...current, project: event.target.value }))} placeholder="Todos" /><datalist id="dashboard-equipes-projects">{dashboard.projects.map((item) => <option key={item.id} value={item.label} />)}</datalist></label>
          <label className={styles.field}><span>MK / Equipe</span><select value={dashboard.draftFilters.teamId} onChange={(event) => dashboard.setDraftFilters((current) => ({ ...current, teamId: event.target.value }))}><option value="">Todas</option>{dashboard.teams.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label className={styles.field}><span>Encarregado</span><select value={dashboard.draftFilters.foreman} onChange={(event) => dashboard.setDraftFilters((current) => ({ ...current, foreman: event.target.value }))}><option value="">Todos</option>{dashboard.foremen.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label className={styles.field}><span>Supervisor</span><select value={dashboard.draftFilters.supervisorId} onChange={(event) => dashboard.setDraftFilters((current) => ({ ...current, supervisorId: event.target.value }))}><option value="">Todos</option>{dashboard.supervisors.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        </div>
      </article>

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div><h2 className={styles.cardTitle}>Equipes no ciclo</h2><p className={styles.cardSubtitle}>Visao oficial de valor realizado e meta por equipe no ciclo selecionado.</p></div>
          <div className={styles.chartActions}>
            <label className={styles.inlineSelect}><span>Semana</span><select value={teamWeekFilter} onChange={(event) => setTeamWeekFilter(event.target.value)}><option value="">Ciclo completo</option>{dashboard.cycleWeeks.map((week) => <option key={week.id} value={week.id}>{week.label}</option>)}</select></label>
            <div className={styles.checkboxGroup}><span>Meta</span><div className={styles.checkboxRow}>{(Object.keys(metaLabels) as MetaMode[]).map((mode) => <label key={mode} className={styles.checkboxOption}><input type="checkbox" checked={teamMetaModes.includes(mode)} onChange={() => toggleMetaMode(mode, setTeamMetaModes)} />{metaLabels[mode]}</label>)}</div></div>
          </div>
        </div>
        <div className={styles.tableWrapper}><table className={styles.table}>
          <thead><tr><th>Equipe</th><th>Tipo(s)</th><th>Encarregado(s)</th><th>Valor realizado</th><th>Projetos</th>{teamMetaModes.map((mode) => <th key={`${mode}-team-meta`}>{metaLabels[mode]}</th>)}{teamMetaModes.map((mode) => <th key={`${mode}-team-days`}>{metaDayLabels[mode]}</th>)}{teamMetaModes.map((mode) => <th key={`${mode}-team-percent`}>%{metaLabels[mode]}</th>)}</tr></thead>
          <tbody>{selectedTeams.length ? selectedTeams.map((item) => <tr key={item.teamId} className={styles.clickableRow} role="button" tabIndex={0} onClick={() => openTeamDetails(item)} onKeyDown={(event) => handleRowKeyDown(event, () => openTeamDetails(item))}><td>{item.teamName}</td><td>{item.teamTypeNames.join(" / ") || "Nao identificado"}</td><td>{item.foremanNames.join(" / ") || "Nao identificado"}</td><td>{formatDashboardCurrency(item.totalValue)}</td><td>{item.projectCount}</td>{teamMetaModes.map((mode) => <td key={`${item.teamId}-${mode}-meta`}>{formatDashboardCurrency(resolveMetaValue(item, mode))}</td>)}{teamMetaModes.map((mode) => <td key={`${item.teamId}-${mode}-days`}>{resolveMetaDays(item, mode)}</td>)}{teamMetaModes.map((mode) => { const meta = resolveMetaValue(item, mode); return <td key={`${item.teamId}-${mode}-percent`}>{formatDashboardPercent(meta > 0 ? (item.totalValue / meta) * 100 : 0)}</td>; })}</tr>) : <tr><td colSpan={5 + teamMetaModes.length * 3} className={styles.emptyRow}>Nenhuma equipe encontrada no ciclo.</td></tr>}</tbody>
        </table></div>
        {renderTeamVisualizations()}
      </article>

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div><h2 className={styles.cardTitle}>Encarregados no ciclo</h2><p className={styles.cardSubtitle}>Contribuicao separada por MK + encarregado, sem rateio da meta oficial da equipe.</p></div>
          <div className={styles.chartActions}>
            <label className={styles.inlineSelect}><span>Semana</span><select value={foremanWeekFilter} onChange={(event) => setForemanWeekFilter(event.target.value)}><option value="">Ciclo completo</option>{dashboard.cycleWeeks.map((week) => <option key={week.id} value={week.id}>{week.label}</option>)}</select></label>
          </div>
        </div>
        <div className={styles.tableWrapper}><table className={styles.table}>
          <thead><tr><th>MK / Equipe</th><th>Encarregado</th><th>Valor produzido</th><th>Participacao no MK</th><th>Dias com producao</th><th>Ordens</th><th>Projetos</th></tr></thead>
          <tbody>{selectedTeamForemen.length ? selectedTeamForemen.map((item) => <tr key={`${item.teamId}-${item.foremanName}`} className={styles.clickableRow} role="button" tabIndex={0} onClick={() => openProjectDetails("encarregado", `${item.foremanName} - ${item.teamName}`, foremanPeriodLabel, item.projects)} onKeyDown={(event) => handleRowKeyDown(event, () => openProjectDetails("encarregado", `${item.foremanName} - ${item.teamName}`, foremanPeriodLabel, item.projects))}><td>{item.teamName}</td><td>{item.foremanName}</td><td>{formatDashboardCurrency(item.totalValue)}</td><td>{formatDashboardPercent(item.participationPercentage)}</td><td>{item.workedDays}</td><td>{item.orderCount}</td><td>{item.projectCount}</td></tr>) : <tr><td colSpan={7} className={styles.emptyRow}>Nenhum encarregado encontrado no ciclo.</td></tr>}</tbody>
        </table></div>
      </article>

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div><h2 className={styles.cardTitle}>Supervisor no ciclo</h2><p className={styles.cardSubtitle}>Somatoria da producao das equipes vinculadas ao supervisor.</p></div>
          <div className={styles.chartActions}>
            <label className={styles.inlineSelect}><span>Semana</span><select value={supervisorWeekFilter} onChange={(event) => setSupervisorWeekFilter(event.target.value)}><option value="">Ciclo completo</option>{dashboard.cycleWeeks.map((week) => <option key={week.id} value={week.id}>{week.label}</option>)}</select></label>
            <div className={styles.checkboxGroup}><span>Base da meta</span><div className={styles.checkboxRow}><label className={styles.checkboxOption}><input type="radio" name="supervisorMetaBase" checked={supervisorMetaBase === "productive"} onChange={() => setSupervisorMetaBase("productive")} />Equipes com producao</label><label className={styles.checkboxOption}><input type="radio" name="supervisorMetaBase" checked={supervisorMetaBase === "potential"} onChange={() => setSupervisorMetaBase("potential")} />Todas vinculadas</label></div></div>
            {renderExpandButton("supervisorProduction", "Supervisor no ciclo")}
          </div>
        </div>
        <div className={styles.tableWrapper}><table className={styles.table}>
          <thead><tr><th>Supervisor</th><th>Valor produzido</th><th>Projetos</th><th>Equipes com producao</th><th>Equipes vinculadas</th><th>Ordens</th><th>Meta equipes com producao</th><th>% producao</th><th>Meta total vinculada</th><th>% total</th></tr></thead>
          <tbody>{selectedSupervisors.length ? selectedSupervisors.map((item) => <tr key={item.supervisorId ?? item.supervisorName} className={styles.clickableRow} role="button" tabIndex={0} onClick={() => openProjectDetails("supervisor", item.supervisorName, supervisorPeriodLabel, item.projects)} onKeyDown={(event) => handleRowKeyDown(event, () => openProjectDetails("supervisor", item.supervisorName, supervisorPeriodLabel, item.projects))}><td>{item.supervisorName}</td><td>{formatDashboardCurrency(item.totalValue)}</td><td>{item.projectCount}</td><td>{item.productiveTeamCount}</td><td>{item.potentialTeamCount}</td><td>{item.orderCount}</td><td>{formatDashboardCurrency(item.productiveMetaValue)}</td><td>{formatDashboardPercent(item.productivePercentage)}</td><td>{formatDashboardCurrency(item.potentialMetaValue)}</td><td>{formatDashboardPercent(item.potentialPercentage)}</td></tr>) : <tr><td colSpan={10} className={styles.emptyRow}>Nenhum supervisor encontrado no recorte selecionado.</td></tr>}</tbody>
        </table></div>
        {renderSupervisorVisualizations()}
      </article>

      {expandedChart ? <div className={styles.modalBackdrop} role="dialog" aria-modal="true"><div className={styles.modal}><div className={styles.modalHeader}><h2>{expandedChart === "supervisorProduction" ? "Supervisor no ciclo" : expandedChart === "teamRanking" ? "Ranking % de atingimento por MK" : expandedChart === "teamBullet" ? "Bullet de meta por MK" : "Gap financeiro por MK"}</h2><button type="button" className={styles.closeButton} onClick={() => setExpandedChart(null)}>x</button></div><div className={styles.modalBody}>{expandedChart === "teamRanking" ? renderTeamRanking(true) : null}{expandedChart === "teamBullet" ? renderTeamBullet(true) : null}{expandedChart === "teamGap" ? renderTeamGap(true) : null}{expandedChart === "supervisorProduction" ? renderSupervisorVisualizations(true) : null}</div></div></div> : null}

      {teamDetailModal ? (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-label={`Detalhes do MK ${teamDetailModal.row.teamName}`}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <div>
                <h2>Detalhes do MK {teamDetailModal.row.teamName}</h2>
                <p className={styles.modalSubtitle}>{teamDetailModal.periodLabel}</p>
              </div>
              <div className={styles.modalActions}>
                <button type="button" className={styles.secondaryButton} onClick={exportTeamDetails}>Exportar contribuicoes (CSV)</button>
                <button type="button" className={styles.closeButton} onClick={() => setTeamDetailModal(null)}>x</button>
              </div>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.detailMetrics}>
                <div className={styles.detailMetric}><span>Valor do MK</span><strong>{formatDashboardCurrency(teamDetailModal.row.totalValue)}</strong></div>
                <div className={styles.detailMetric}><span>{metaLabels[teamDetailModal.metaMode]}</span><strong>{formatDashboardCurrency(resolveMetaValue(teamDetailModal.row, teamDetailModal.metaMode))}</strong></div>
                <div className={styles.detailMetric}><span>Atingimento</span><strong>{formatDashboardPercent(resolveMetaValue(teamDetailModal.row, teamDetailModal.metaMode) > 0 ? (teamDetailModal.row.totalValue / resolveMetaValue(teamDetailModal.row, teamDetailModal.metaMode)) * 100 : 0)}</strong></div>
                <div className={styles.detailMetric}><span>Encarregados identificados</span><strong>{teamDetailModal.row.foremanContributions.length}</strong></div>
              </div>
              <p className={styles.dataNotice}>A contribuicao considera o encarregado salvo em cada ordem. A estrutura atual nao divide uma mesma ordem entre varios encarregados.</p>
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Encarregado</th>
                      <th>Valor produzido</th>
                      <th>Participacao no MK</th>
                      <th>Contribuicao sobre a meta do MK</th>
                      <th>Dias</th>
                      <th>Ordens</th>
                      <th>Projetos</th>
                      <th>Lista de projetos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teamDetailModal.row.foremanContributions.length ? teamDetailModal.row.foremanContributions.map((item) => {
                      const metaValue = resolveMetaValue(teamDetailModal.row, teamDetailModal.metaMode);
                      return (
                        <tr key={`${item.teamId}-${item.foremanName}`}>
                          <td>{item.foremanName}</td>
                          <td>{formatDashboardCurrency(item.totalValue)}</td>
                          <td>{formatDashboardPercent(item.participationPercentage)}</td>
                          <td>{formatDashboardPercent(metaValue > 0 ? (item.totalValue / metaValue) * 100 : 0)}</td>
                          <td>{item.workedDays}</td>
                          <td>{item.orderCount}</td>
                          <td>{item.projectCount}</td>
                          <td className={styles.projectListCell}>{item.projects.map((project) => project.projectCode).join(", ") || "Nenhum"}</td>
                        </tr>
                      );
                    }) : <tr><td colSpan={8} className={styles.emptyRow}>Nenhuma contribuicao de encarregado identificada.</td></tr>}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total MK</td>
                      <td>{formatDashboardCurrency(teamDetailModal.row.totalValue)}</td>
                      <td>{formatDashboardPercent(teamDetailModal.row.totalValue > 0 ? 100 : 0)}</td>
                      <td>{formatDashboardPercent(resolveMetaValue(teamDetailModal.row, teamDetailModal.metaMode) > 0 ? (teamDetailModal.row.totalValue / resolveMetaValue(teamDetailModal.row, teamDetailModal.metaMode)) * 100 : 0)}</td>
                      <td>{teamDetailModal.row.workedDays}</td>
                      <td>{teamDetailModal.row.foremanContributions.reduce((sum, item) => sum + item.orderCount, 0)}</td>
                      <td>{teamDetailModal.row.projectCount}</td>
                      <td>-</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {projectDetailModal ? <div className={styles.modalBackdrop} role="dialog" aria-modal="true"><div className={styles.modal}><div className={styles.modalHeader}><div><h2>{projectDetailModal.title}</h2><p className={styles.modalSubtitle}>{projectDetailModal.subtitle}</p></div><div className={styles.modalActions}><button type="button" className={styles.secondaryButton} onClick={exportProjectDetails}>Exportar Excel (CSV)</button><button type="button" className={styles.closeButton} onClick={() => setProjectDetailModal(null)}>x</button></div></div><div className={styles.modalBody}><div className={styles.tableWrapper}><table className={styles.table}><thead><tr><th>Projeto</th><th>Centro</th><th>Valor cobrado</th><th>Ordens</th></tr></thead><tbody>{projectDetailModal.rows.length ? projectDetailModal.rows.map((item) => <tr key={item.projectId}><td>{item.projectCode}</td><td>{item.serviceCenter}</td><td>{formatDashboardCurrency(item.totalValue)}</td><td>{item.orderCount}</td></tr>) : <tr><td colSpan={4} className={styles.emptyRow}>Nenhum projeto encontrado.</td></tr>}</tbody><tfoot><tr><td>Total</td><td>{projectDetailModal.rows.length} projetos</td><td>{formatDashboardCurrency(projectDetailModal.rows.reduce((sum, item) => sum + item.totalValue, 0))}</td><td>{projectDetailModal.rows.reduce((sum, item) => sum + item.orderCount, 0)}</td></tr></tfoot></table></div></div></div></div> : null}
    </section>
  );
}
