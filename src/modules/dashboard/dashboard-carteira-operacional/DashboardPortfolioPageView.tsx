"use client";

import { useMemo, useState } from "react";

import { useDashboardPortfolio } from "./hooks";
import type { DashboardPortfolioProject } from "./types";
import {
  csvEscapePortfolio,
  downloadPortfolioCsv,
  formatPortfolioCurrency,
  formatPortfolioNumber,
  formatPortfolioPercent,
  maxPortfolioValue,
  portfolioOriginLabel,
  portfolioScopeLabel,
  portfolioStatusLabel,
  toPortfolioIsoDate,
} from "./utils";
import { PORTFOLIO_PROJECT_PAGE_SIZE } from "./constants";
import styles from "./DashboardPortfolioPageView.module.css";

const diagnosticLabels = {
  SAUDAVEL: "Carteira saudavel",
  ATENCAO: "Atencao",
  RISCO: "Risco",
} as const;

function clampPercent(value: number) {
  return `${Math.max(0, Math.min(100, value)).toFixed(4)}%`;
}

function MetricCard(props: {
  label: string;
  value: string;
  hint?: string;
  tone?: "blue" | "green" | "orange" | "red";
}) {
  return (
    <div className={`${styles.metric} ${props.tone ? styles[props.tone] : ""}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      {props.hint ? <small>{props.hint}</small> : null}
    </div>
  );
}

function BarRow(props: {
  label: string;
  valueLabel: string;
  width: number;
  tone?: "blueBar" | "greenBar" | "orangeBar" | "redBar";
}) {
  return (
    <div className={styles.barRow}>
      <strong title={props.label}>{props.label}</strong>
      <div className={styles.barTrack}>
        <span className={`${styles.barFill} ${props.tone ? styles[props.tone] : styles.blueBar}`} style={{ width: clampPercent(props.width) }} />
      </div>
      <span>{props.valueLabel}</span>
    </div>
  );
}

function renderDaysWithoutProduction(project: DashboardPortfolioProject) {
  if (project.daysWithoutProduction === null) return "Sem producao";
  return `${project.daysWithoutProduction} dias`;
}

export function DashboardPortfolioPageView() {
  const dashboard = useDashboardPortfolio();
  const [projectPage, setProjectPage] = useState(1);
  const selectedCycleLabel = dashboard.filters.cycleStart === "ALL"
    ? "Todos os ciclos"
    : dashboard.cycles.find((cycle) => cycle.cycleStart === dashboard.filters.cycleStart)?.label ?? "Ciclo selecionado";
  const quantitySummary = dashboard.quantitySummary;
  const financialSummary = dashboard.financialSummary;
  const maxAgeCount = useMemo(() => maxPortfolioValue(dashboard.ageBuckets.map((item) => item.count)), [dashboard.ageBuckets]);
  const maxFlowValue = useMemo(() => maxPortfolioValue(dashboard.flow.map((item) => item.value)), [dashboard.flow]);
  const totalProjectPages = Math.max(1, Math.ceil(dashboard.projectRows.length / PORTFOLIO_PROJECT_PAGE_SIZE));
  const currentProjectPage = Math.min(projectPage, totalProjectPages);
  const visibleProjects = useMemo(
    () => dashboard.projectRows.slice(
      (currentProjectPage - 1) * PORTFOLIO_PROJECT_PAGE_SIZE,
      currentProjectPage * PORTFOLIO_PROJECT_PAGE_SIZE,
    ),
    [currentProjectPage, dashboard.projectRows],
  );

  function applyFilters() {
    setProjectPage(1);
    dashboard.applyFilters();
  }

  function exportProjectRows() {
    if (!dashboard.projectRows.length) return;

    const header = [
      "Projeto",
      "Regional",
      "Status",
      "Carteira",
      "Origem",
      "Primeira atuacao",
      "Ultima atuacao",
      "Dias parado",
      "Ciclos",
      "Ciclos sem producao",
      "Semana ultima prod.",
      "Valor previsto",
      "Valor acumulado",
      "Valor ciclo",
      "Restante",
      "% explorado",
    ];
    const lines = dashboard.projectRows.map((project) => [
      project.projectCode,
      project.serviceCenter,
      portfolioStatusLabel(project.status),
      portfolioScopeLabel(project.portfolioStatus),
      portfolioOriginLabel(project.origin),
      project.firstActivityLabel,
      project.lastActivityLabel,
      renderDaysWithoutProduction(project),
      formatPortfolioNumber(project.workedCycleCount),
      formatPortfolioNumber(project.cyclesWithoutProduction),
      project.lastProductionWeek ? `${project.lastProductionWeek} semana` : "-",
      formatPortfolioCurrency(project.totalForecastValue),
      formatPortfolioCurrency(project.accumulatedValue),
      formatPortfolioCurrency(project.valueInCycle),
      formatPortfolioCurrency(project.remainingPotential),
      formatPortfolioPercent(project.exploredPercentage),
    ]);
    const csv = `\uFEFF${[header, ...lines].map((line) => line.map(csvEscapePortfolio).join(";")).join("\n")}`;
    downloadPortfolioCsv(csv, `dashboard_carteira_operacional_${toPortfolioIsoDate(new Date())}.csv`);
  }

  return (
    <section className={styles.wrapper}>
      {dashboard.errorMessage ? <p className={styles.errorMessage}>{dashboard.errorMessage}</p> : null}

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Filtros da Carteira Operacional</h2>
            <p className={styles.cardSubtitle}>Base: projetos com atividades previstas cadastradas em Projetos.</p>
          </div>
          <button type="button" className={styles.primaryButton} disabled={dashboard.isLoading} onClick={applyFilters}>
            {dashboard.isLoading ? "Carregando..." : "Filtrar"}
          </button>
        </div>
        <div className={styles.filterGrid}>
          <label className={styles.field}>
            <span>Ciclo</span>
            <select value={dashboard.draftFilters.cycleStart} onChange={(event) => dashboard.setDraftFilters((current) => ({ ...current, cycleStart: event.target.value }))}>
              <option value="">Ciclo mais recente</option>
              <option value="ALL">Todos os ciclos</option>
              {dashboard.cycles.map((cycle) => (
                <option key={cycle.cycleStart} value={cycle.cycleStart}>{cycle.label}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Carteira</span>
            <select value={dashboard.draftFilters.portfolioScope} onChange={(event) => dashboard.setDraftFilters((current) => ({ ...current, portfolioScope: event.target.value as typeof current.portfolioScope }))}>
              <option value="ACTIVE">Sem retirados</option>
              <option value="WITHDRAWN">Somente retirados</option>
              <option value="ALL">Com retirados</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Projeto (SOB)</span>
            <input
              list="dashboard-carteira-projects"
              value={dashboard.draftFilters.project}
              onChange={(event) => dashboard.setDraftFilters((current) => ({ ...current, project: event.target.value }))}
              placeholder="Todos"
            />
          </label>
          <label className={styles.field}>
            <span>Regional / Centro</span>
            <select value={dashboard.draftFilters.serviceCenterId} onChange={(event) => dashboard.setDraftFilters((current) => ({ ...current, serviceCenterId: event.target.value }))}>
              <option value="">Todos</option>
              {dashboard.serviceCenters.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
        </div>
      </article>

      <datalist id="dashboard-carteira-projects">
        {dashboard.projects.map((project) => <option key={project.id} value={project.label} />)}
      </datalist>

      <article className={`${styles.card} ${styles.diagnosticCard}`}>
        <div className={styles.diagnosticHeader}>
          <span className={dashboard.diagnostic?.status === "RISCO" ? styles.statusRisk : dashboard.diagnostic?.status === "ATENCAO" ? styles.statusWarning : styles.statusHealthy}>
            {dashboard.diagnostic ? diagnosticLabels[dashboard.diagnostic.status] : "Sem diagnostico"}
          </span>
          <strong>{selectedCycleLabel}</strong>
        </div>
        <p>{dashboard.diagnostic?.message ?? "Carregue a carteira para gerar o diagnostico do ciclo."}</p>
        {dashboard.diagnostic?.signals.length ? (
          <div className={styles.signalList}>
            {dashboard.diagnostic.signals.map((signal) => <span key={signal}>{signal}</span>)}
          </div>
        ) : null}
      </article>

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Saude da carteira</h2>
            <p className={styles.cardSubtitle}>Leitura por quantidade de projetos.</p>
          </div>
        </div>
        <div className={styles.metricGrid}>
          <MetricCard label="Carteira operacional" value={formatPortfolioNumber(quantitySummary?.operationalProjects ?? 0)} />
          <MetricCard label="Projetos trabalhados" value={formatPortfolioNumber(quantitySummary?.workedProjects ?? 0)} />
          <MetricCard label="Projetos novos" value={formatPortfolioNumber(quantitySummary?.newProjects ?? 0)} tone="green" />
          <MetricCard label="Projetos herdados" value={formatPortfolioNumber(quantitySummary?.inheritedProjects ?? 0)} tone="orange" />
          <MetricCard label="Projetos concluidos" value={formatPortfolioNumber(quantitySummary?.concludedProjects ?? 0)} tone="green" />
          <MetricCard label="Projetos pendentes" value={formatPortfolioNumber(quantitySummary?.pendingProjects ?? 0)} tone="red" />
          <MetricCard label="Projetos retirados" value={formatPortfolioNumber(quantitySummary?.withdrawnProjects ?? 0)} tone="orange" />
          <MetricCard label="Idade media" value={`${formatPortfolioNumber(quantitySummary?.averageAge ?? 0, 1)} ciclos`} />
          <MetricCard label="Indice de renovacao" value={formatPortfolioPercent(quantitySummary?.renewalRate ?? 0)} tone={(quantitySummary?.renewalRate ?? 0) < 10 ? "red" : (quantitySummary?.renewalRate ?? 0) < 20 ? "orange" : "green"} />
        </div>
      </article>

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Financeiro da carteira</h2>
            <p className={styles.cardSubtitle}>Valores da carteira planejada contra producao medida.</p>
          </div>
        </div>
        <div className={styles.metricGrid}>
          <MetricCard label="Carteira prevista" value={formatPortfolioCurrency(financialSummary?.totalPortfolioValue ?? 0, true)} />
          <MetricCard label="Valor produzido no ciclo" value={formatPortfolioCurrency(financialSummary?.producedInCycle ?? 0, true)} tone="blue" />
          <MetricCard label="Valor acumulado" value={formatPortfolioCurrency(financialSummary?.accumulatedValue ?? 0, true)} />
          <MetricCard label="Potencial restante" value={formatPortfolioCurrency(financialSummary?.remainingPotential ?? 0, true)} tone="green" />
          <MetricCard label="Indice de exploracao" value={formatPortfolioPercent(financialSummary?.explorationRate ?? 0)} tone={(financialSummary?.explorationRate ?? 0) > 85 ? "red" : (financialSummary?.explorationRate ?? 0) > 75 ? "orange" : "green"} />
          <MetricCard label="Media projetos novos" value={formatPortfolioCurrency(financialSummary?.averageNewProjectValue ?? 0, true)} />
          <MetricCard label="Media projetos herdados" value={formatPortfolioCurrency(financialSummary?.averageInheritedProjectValue ?? 0, true)} />
          <MetricCard label="Ticket medio concluidos" value={formatPortfolioCurrency(financialSummary?.completedAverageTicket ?? 0, true)} />
        </div>
      </article>

      <div className={styles.twoColumnGrid}>
        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2 className={styles.cardTitle}>Fluxo da carteira</h2>
              <p className={styles.cardSubtitle}>Quantidade e valor por etapa operacional.</p>
            </div>
          </div>
          <div className={styles.flowList}>
            {dashboard.flow.map((item, index) => (
              <div key={item.stage} className={styles.flowRow}>
                <div>
                  <strong>{item.stage}</strong>
                  <span>{item.projects} projetos</span>
                </div>
                <div className={styles.flowTrack}>
                  <span style={{ width: clampPercent((item.value / maxFlowValue) * 100) }} />
                </div>
                <strong>{formatPortfolioCurrency(item.value, true)}</strong>
                {index < dashboard.flow.length - 1 ? <span className={styles.flowArrow}>v</span> : null}
              </div>
            ))}
          </div>
        </article>

        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2 className={styles.cardTitle}>Renovacao da carteira</h2>
              <p className={styles.cardSubtitle}>Projetos novos contra herdados no ciclo.</p>
            </div>
          </div>
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr><th>Origem</th><th>Projetos</th><th>Valor ciclo</th><th>Ticket medio</th><th>Participacao</th></tr>
              </thead>
              <tbody>
                {dashboard.renewalChart.map((item) => (
                  <tr key={item.origin}>
                    <td>{item.origin}</td>
                    <td>{item.projects}</td>
                    <td>{formatPortfolioCurrency(item.valueInCycle)}</td>
                    <td>{formatPortfolioCurrency(item.averageTicket)}</td>
                    <td>{formatPortfolioPercent(item.participation)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </div>

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Envelhecimento da carteira</h2>
            <p className={styles.cardSubtitle}>Distribuicao por quantidade de ciclos com producao.</p>
          </div>
        </div>
        <div className={styles.barList}>
          {dashboard.ageBuckets.map((item) => (
            <BarRow
              key={item.label}
              label={item.label}
              valueLabel={`${item.count} projetos`}
              width={(item.count / maxAgeCount) * 100}
              tone={item.label === "4+ ciclos" ? "redBar" : item.label === "3 ciclos" ? "orangeBar" : "blueBar"}
            />
          ))}
        </div>
      </article>

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Tabela analitica da carteira</h2>
            <p className={styles.cardSubtitle}>Projetos com atividades previstas, valores medidos e potencial restante.</p>
          </div>
          <div className={styles.tableActions}>
            <span className={styles.tableCounter}>
              {dashboard.projectRows.length} projetos
            </span>
            <button type="button" className={styles.secondaryButton} disabled={!dashboard.projectRows.length} onClick={exportProjectRows}>
              Extrair CSV
            </button>
          </div>
        </div>
        <div className={styles.tableWrapper}>
          <table className={`${styles.table} ${styles.projectTable}`}>
            <thead>
              <tr>
                <th>Projeto</th>
                <th>Regional</th>
                <th>Status</th>
                <th>Carteira</th>
                <th>Origem</th>
                <th>Primeira atuacao</th>
                <th>Ultima atuacao</th>
                <th>Dias parado</th>
                <th>Ciclos</th>
                <th>Ciclos sem producao</th>
                <th>Semana ultima prod.</th>
                <th>Valor previsto</th>
                <th>Valor acumulado</th>
                <th>Valor ciclo</th>
                <th>Restante</th>
                <th>% explorado</th>
              </tr>
            </thead>
            <tbody>
              {visibleProjects.length ? visibleProjects.map((project) => (
                <tr key={project.projectId}>
                  <td>{project.projectCode}</td>
                  <td>{project.serviceCenter}</td>
                  <td><span className={project.status === "CONCLUIDO" ? styles.badgeSuccess : styles.badgeWarning}>{portfolioStatusLabel(project.status)}</span></td>
                  <td><span className={project.isWithdrawn ? styles.badgeWithdrawn : styles.badgeNeutral}>{portfolioScopeLabel(project.portfolioStatus)}</span></td>
                  <td>{portfolioOriginLabel(project.origin)}</td>
                  <td>{project.firstActivityLabel}</td>
                  <td>{project.lastActivityLabel}</td>
                  <td>{renderDaysWithoutProduction(project)}</td>
                  <td>{project.workedCycleCount}</td>
                  <td>{project.cyclesWithoutProduction}</td>
                  <td>{project.lastProductionWeek ? `${project.lastProductionWeek} semana` : "-"}</td>
                  <td>{formatPortfolioCurrency(project.totalForecastValue)}</td>
                  <td>{formatPortfolioCurrency(project.accumulatedValue)}</td>
                  <td>{formatPortfolioCurrency(project.valueInCycle)}</td>
                  <td>{formatPortfolioCurrency(project.remainingPotential)}</td>
                  <td>{formatPortfolioPercent(project.exploredPercentage)}</td>
                </tr>
              )) : (
                <tr><td colSpan={16} className={styles.emptyRow}>Nenhum projeto encontrado na carteira operacional.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className={styles.pagination}>
          <button type="button" className={styles.secondaryButton} disabled={currentProjectPage <= 1} onClick={() => setProjectPage((page) => Math.max(1, page - 1))}>Anterior</button>
          <span>Pagina {currentProjectPage} de {totalProjectPages}</span>
          <button type="button" className={styles.secondaryButton} disabled={currentProjectPage >= totalProjectPages} onClick={() => setProjectPage((page) => Math.min(totalProjectPages, page + 1))}>Proxima</button>
        </div>
      </article>
    </section>
  );
}
