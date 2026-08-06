"use client";

import { useMemo, useState } from "react";

import { useDashboardPortfolio } from "./hooks";
import type { DashboardPortfolioActivityForecastItem, DashboardPortfolioProject } from "./types";
import {
  csvEscapePortfolio,
  downloadPortfolioCsv,
  formatPortfolioCurrency,
  formatPortfolioNumber,
  formatPortfolioPercent,
  maxPortfolioValue,
  portfolioOriginLabel,
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

const diagnosticCriteriaText = "Parametros: saudavel quando renovacao >= 20%, exploracao <= 75% e idade media <= 3 ciclos. Atencao quando renovacao fica entre 10% e 19,9%, exploracao entre 75,1% e 85% ou idade media entre 3,1 e 4 ciclos. Risco quando renovacao < 10%, exploracao > 85% ou idade media > 4 ciclos.";
const flowCriteriaText = "Parametros: Projetos novos sao os trabalhados pela primeira vez no periodo filtrado. Em andamento sao os projetos pendentes. Concluidos no ciclo conta apenas projetos com estado de trabalho concluido E producao medida dentro do periodo, com o valor produzido no periodo; concluido em ciclo anterior fica fora desta etapa.";
const renewalCriteriaText = "Parametros: renovacao = projetos novos com producao no periodo / projetos trabalhados com producao no periodo. Novo tem primeira atuacao dentro do periodo; herdado ja tinha atuacao anterior. Ticket medio = valor do ciclo / quantidade de projetos da origem.";
const agingCriteriaText = "Parametros: idade da carteira = quantidade de ciclos com producao por projeto. Sem producao indica projeto com atividade prevista, mas sem medicao produtiva ate o periodo. Ciclos sem producao compara a ultima atuacao com o ciclo selecionado.";
const goalCoverageCriteriaText = "Parametros: cobertura = potencial restante executavel / meta restante do ciclo. Executavel exclui projetos retirados e concluidos, que nao tem mais escopo operacional pendente. A producao que abate a meta inclui todos, inclusive retirados e concluidos que produziram no ciclo. Verde acima de 120%, amarelo entre 80% e 120%, vermelho abaixo de 80%. Autonomia = potencial restante / meta diaria cadastrada.";

const asbuiltCriteriaText = "Parametros: fator = valor As Built / valor medido nos MESMOS projetos, apurado sobre todo o historico do tenant, sem recorte de ciclo (As Built vem depois da medicao operacional; recortar por ciclo pegaria o numerador incompleto e subestimaria o fator). As Built nao e producao paralela: todo projeto com As Built tambem tem medicao operacional, entao o fator e taxa de realizacao, nao valor a somar. A elegibilidade de As Built vem do Estado do Trabalho concluido, nunca de regional ou tipo de servico, por isso o fator e unico e uniforme e projeto medido sem As Built nao e isento, apenas ainda nao chegou ao marco de conclusao. A projecao aplica ao saldo pendente uma taxa apurada em trabalho ja encerrado.";

const goalCoverageLabels = {
  SAUDAVEL: "Carteira sustenta a meta",
  ATENCAO: "Cobertura em atencao",
  RISCO: "Carteira insuficiente",
  SEM_META: "Sem meta cadastrada",
} as const;

function clampPercent(value: number) {
  return `${Math.max(0, Math.min(100, value)).toFixed(4)}%`;
}

function MetricCard(props: {
  label: string;
  value: string;
  hint?: string;
  tone?: "blue" | "green" | "orange" | "red" | "neutral";
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

function InfoButton(props: { label: string; text: string }) {
  return (
    <button type="button" className={styles.infoButton} aria-label={props.label} title={props.text}>
      i
    </button>
  );
}

function renderDaysWithoutProduction(project: DashboardPortfolioProject) {
  if (project.daysWithoutProduction === null) return "Sem producao";
  return `${project.daysWithoutProduction} dias`;
}

function goalCoverageTone(status: keyof typeof goalCoverageLabels): "green" | "orange" | "red" | undefined {
  if (status === "SAUDAVEL") return "green";
  if (status === "ATENCAO") return "orange";
  if (status === "RISCO") return "red";
  return undefined;
}

function goalCoverageBarClass(status: keyof typeof goalCoverageLabels) {
  if (status === "SAUDAVEL") return styles.greenBar;
  if (status === "ATENCAO") return styles.orangeBar;
  if (status === "RISCO") return styles.redBar;
  return styles.blueBar;
}

export function DashboardPortfolioPageView() {
  const dashboard = useDashboardPortfolio();
  const [projectPage, setProjectPage] = useState(1);
  const [activityProject, setActivityProject] = useState<DashboardPortfolioProject | null>(null);
  const [activityRows, setActivityRows] = useState<DashboardPortfolioActivityForecastItem[]>([]);
  const [isActivityLoading, setIsActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState("");
  const selectedCycleLabel = dashboard.filters.cycleStart === "ALL"
    ? "Todos os ciclos"
    : dashboard.cycles.find((cycle) => cycle.cycleStart === dashboard.filters.cycleStart)?.label ?? "Ciclo selecionado";
  const quantitySummary = dashboard.quantitySummary;
  const financialSummary = dashboard.financialSummary;
  const goalCoverage = dashboard.goalCoverage;
  const hasCoverageDivergence = goalCoverage?.status === "SAUDAVEL" && dashboard.diagnostic?.status === "RISCO";
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
  const activityTotalValue = useMemo(
    () => activityRows.reduce((total, item) => total + item.totalValue, 0),
    [activityRows],
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

  async function openActivityForecast(project: DashboardPortfolioProject) {
    setActivityProject(project);
    setActivityRows([]);
    setActivityError("");
    setIsActivityLoading(true);

    try {
      const rows = await dashboard.loadProjectActivities(project.projectId);
      setActivityRows(rows);
    } catch (error) {
      setActivityError(error instanceof Error ? error.message : "Falha ao carregar atividades previstas do projeto.");
    } finally {
      setIsActivityLoading(false);
    }
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
          <div className={styles.statusGroup}>
            <span className={dashboard.diagnostic?.status === "RISCO" ? styles.statusRisk : dashboard.diagnostic?.status === "ATENCAO" ? styles.statusWarning : styles.statusHealthy}>
              {dashboard.diagnostic ? diagnosticLabels[dashboard.diagnostic.status] : "Sem diagnostico"}
            </span>
            <InfoButton label="Parametros do diagnostico" text={diagnosticCriteriaText} />
          </div>
          <strong>{selectedCycleLabel}</strong>
        </div>
        <p>{dashboard.diagnostic?.message ?? "Carregue a carteira para gerar o diagnostico do ciclo."}</p>
        {dashboard.diagnostic?.scopeNotice ? (
          <p className={styles.scopeNotice}>{dashboard.diagnostic.scopeNotice}</p>
        ) : null}
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
          <MetricCard label="Projetos concluidos" value={formatPortfolioNumber(quantitySummary?.concludedProjects ?? 0)} tone="green" hint="Inclui concluidos em ciclos anteriores." />
          <MetricCard label="Projetos pendentes" value={formatPortfolioNumber(quantitySummary?.pendingProjects ?? 0)} tone="red" />
          <MetricCard label="Projetos retirados" value={formatPortfolioNumber(quantitySummary?.withdrawnProjects ?? 0)} tone="neutral" hint="Fora da operacao: nao somam potencial." />
          <MetricCard label="Retirados trabalhados" value={formatPortfolioNumber(quantitySummary?.withdrawnWorkedProjects ?? 0)} tone="neutral" hint="Produziram antes da retirada." />
          <MetricCard label="Retirados improdutivos" value={formatPortfolioNumber(quantitySummary?.withdrawnIdleProjects ?? 0)} tone="neutral" hint="Sairam sem nenhuma producao." />
          <MetricCard label="Idade media" value={`${formatPortfolioNumber(quantitySummary?.averageAge ?? 0, 1)} ciclos`} />
          <MetricCard label="Indice de renovacao" value={formatPortfolioPercent(quantitySummary?.renewalRate ?? 0)} hint="Meta >= 20%" tone={(quantitySummary?.renewalRate ?? 0) < 10 ? "red" : (quantitySummary?.renewalRate ?? 0) < 20 ? "orange" : "green"} />
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
          <MetricCard label="Potencial restante" value={formatPortfolioCurrency(financialSummary?.remainingPotential ?? 0, true)} tone="green" hint="Executavel: ativos e pendentes." />
          <MetricCard label="Restante de concluidos" value={formatPortfolioCurrency(financialSummary?.concludedRemainingPotential ?? 0, true)} tone="neutral" hint="Escopo encerrado: fora da cobertura da meta." />
          <MetricCard label="Restante de retirados" value={formatPortfolioCurrency(financialSummary?.withdrawnRemainingPotential ?? 0, true)} tone="neutral" hint="Nao executavel: fora da cobertura da meta." />
          <MetricCard label="Produzido por retirados" value={formatPortfolioCurrency(financialSummary?.withdrawnAccumulatedValue ?? 0, true)} tone="neutral" hint="Producao real: abate a meta do ciclo." />
          <MetricCard label="Indice de exploracao" value={formatPortfolioPercent(financialSummary?.explorationRate ?? 0)} tone={(financialSummary?.explorationRate ?? 0) > 85 ? "red" : (financialSummary?.explorationRate ?? 0) > 75 ? "orange" : "green"} />
          <MetricCard label="Exploracao dos retirados" value={formatPortfolioPercent(financialSummary?.withdrawnExplorationRate ?? 0)} tone="neutral" hint="Saldo queimado antes da retirada." />
          <MetricCard label="Media projetos novos" value={formatPortfolioCurrency(financialSummary?.averageNewProjectValue ?? 0, true)} />
          <MetricCard label="Media projetos herdados" value={formatPortfolioCurrency(financialSummary?.averageInheritedProjectValue ?? 0, true)} />
          <MetricCard label="Ticket medio concluidos no ciclo" value={formatPortfolioCurrency(financialSummary?.completedAverageTicket ?? 0, true)} hint="Somente concluidos com producao no ciclo." />
        </div>
      </article>

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <div className={styles.titleWithInfo}>
              <h2 className={styles.cardTitle}>Cobertura da meta</h2>
              <InfoButton label="Parametros da cobertura da meta" text={goalCoverageCriteriaText} />
            </div>
            <p className={styles.cardSubtitle}>Leitura se a carteira atual sustenta a meta restante do ciclo.</p>
            <p className={styles.coverageBasis}>Base: carteira inteira, independente do filtro Carteira. Potencial conta so o executavel (exclui retirados e concluidos); producao conta todos que produziram no ciclo, inclusive retirados e concluidos.</p>
          </div>
          <span className={goalCoverage?.status === "RISCO" ? styles.statusRisk : goalCoverage?.status === "ATENCAO" ? styles.statusWarning : goalCoverage?.status === "SEM_META" ? styles.statusNeutral : styles.statusHealthy}>
            {goalCoverage ? goalCoverageLabels[goalCoverage.status] : "Sem calculo"}
          </span>
        </div>
        <div className={styles.metricGrid}>
          <MetricCard label="Meta restante do ciclo" value={formatPortfolioCurrency(goalCoverage?.remainingCycleGoal ?? 0, true)} />
          <MetricCard label="Potencial restante" value={formatPortfolioCurrency(goalCoverage?.remainingPotential ?? 0, true)} tone="green" />
          <MetricCard label="Cobertura da meta" value={formatPortfolioPercent(goalCoverage?.coveragePercentage ?? 0)} tone={goalCoverage ? goalCoverageTone(goalCoverage.status) : undefined} />
          <MetricCard label="Autonomia da carteira" value={`${formatPortfolioNumber(goalCoverage?.autonomyBusinessDays ?? 0, 1)} dias uteis`} />
          <MetricCard label="Esgotamento previsto" value={goalCoverage?.depletionDateLabel ?? "-"} tone={goalCoverage ? goalCoverageTone(goalCoverage.status) : undefined} />
          <MetricCard label="Meta diaria" value={formatPortfolioCurrency(goalCoverage?.dailyGoal ?? 0, true)} />
        </div>
        {hasCoverageDivergence ? (
          <p className={styles.coverageWarning}>
            Meta coberta no curto prazo, porem sem sustentabilidade: o diagnostico da carteira esta em risco por falta de projetos novos.
          </p>
        ) : null}
        <div className={styles.coveragePanel}>
          <div className={styles.coverageText}>
            <strong>Cobertura da meta</strong>
            <span>{goalCoverage?.message ?? "Carregue a carteira para calcular a cobertura da meta."}</span>
          </div>
          <div className={styles.coverageTrack}>
            <span className={goalCoverage ? goalCoverageBarClass(goalCoverage.status) : styles.blueBar} style={{ width: clampPercent(((goalCoverage?.coveragePercentage ?? 0) / 120) * 100) }} />
          </div>
          <div className={styles.coverageScale}>
            <span>0%</span>
            <span>80%</span>
            <span>120%</span>
          </div>
        </div>
        {goalCoverage && goalCoverage.asbuiltFactor > 0 ? (
          <div className={styles.sensitivityPanel}>
            <div className={styles.sensitivityHeader}>
              <span>{`Sensibilidade de realizacao As Built (historico ${formatPortfolioPercent(goalCoverage.asbuiltFactorPercentage)})`}</span>
              <InfoButton label="Parametros da sensibilidade As Built" text={asbuiltCriteriaText} />
            </div>
            <div className={styles.sensitivityValues}>
              <div><span>Cobertura projetada: </span><strong>{formatPortfolioPercent(goalCoverage.asbuiltCoveragePercentage)}</strong></div>
              <div><span>Autonomia projetada: </span><strong>{`${formatPortfolioNumber(goalCoverage.asbuiltAutonomyBusinessDays, 1)} dias uteis`}</strong></div>
              <div><span>Potencial projetado: </span><strong>{formatPortfolioCurrency(goalCoverage.asbuiltRemainingPotential, true)}</strong></div>
            </div>
            <div className={styles.sensitivityTrack}>
              <span style={{ width: clampPercent((goalCoverage.asbuiltCoveragePercentage / 120) * 100) }} />
            </div>
            <p className={styles.sensitivityNote}>
              {`Projecao, nao medicao: assume que o pendente sera reconhecido na mesma proporcao historica. Fator apurado em ${formatPortfolioNumber(goalCoverage.asbuiltSampleProjects)} de ${formatPortfolioNumber(goalCoverage.asbuiltMeasuredProjects)} projetos com medicao. O numero principal acima permanece em moeda de medicao operacional, que e a mesma da meta.`}
            </p>
          </div>
        ) : null}
      </article>

      <div className={styles.twoColumnGrid}>
        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <div className={styles.titleWithInfo}>
                <h2 className={styles.cardTitle}>Fluxo da carteira</h2>
                <InfoButton label="Parametros do fluxo da carteira" text={flowCriteriaText} />
              </div>
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
              <div className={styles.titleWithInfo}>
                <h2 className={styles.cardTitle}>Renovacao da carteira</h2>
                <InfoButton label="Parametros da renovacao da carteira" text={renewalCriteriaText} />
              </div>
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
            <div className={styles.titleWithInfo}>
              <h2 className={styles.cardTitle}>Envelhecimento da carteira</h2>
              <InfoButton label="Parametros do envelhecimento da carteira" text={agingCriteriaText} />
            </div>
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
                <th>Acao</th>
              </tr>
            </thead>
            <tbody>
              {visibleProjects.length ? visibleProjects.map((project) => (
                <tr key={project.projectId}>
                  <td>{project.projectCode}</td>
                  <td>{project.serviceCenter}</td>
                  <td><span className={project.status === "CONCLUIDO" ? styles.badgeSuccess : styles.badgeWarning}>{portfolioStatusLabel(project.status)}</span></td>
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
                  <td>
                    <button type="button" className={styles.tableActionButton} onClick={() => void openActivityForecast(project)}>
                      Ver
                    </button>
                  </td>
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
      {activityProject ? (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={() => setActivityProject(null)}>
          <div className={styles.modalCard} role="dialog" aria-modal="true" aria-labelledby="portfolio-activity-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <h2 id="portfolio-activity-title" className={styles.cardTitle}>Atividades previstas</h2>
                <p className={styles.cardSubtitle}>{activityProject.projectCode} - {formatPortfolioCurrency(activityTotalValue)}</p>
              </div>
              <button type="button" className={styles.secondaryButton} onClick={() => setActivityProject(null)}>
                Fechar
              </button>
            </div>
            {activityError ? <p className={styles.errorMessage}>{activityError}</p> : null}
            {isActivityLoading ? (
              <p className={styles.emptyState}>Carregando atividades previstas...</p>
            ) : (
              <div className={styles.tableWrapper}>
                <table className={`${styles.table} ${styles.activityTable}`}>
                  <thead>
                    <tr>
                      <th>Codigo</th>
                      <th>Descricao</th>
                      <th>Tipo</th>
                      <th>Unidade</th>
                      <th>Pontos</th>
                      <th>Quantidade</th>
                      <th>Valor unit.</th>
                      <th>Valor previsto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activityRows.length ? activityRows.map((item) => (
                      <tr key={item.id}>
                        <td>{item.code || "-"}</td>
                        <td title={item.description}>{item.description || "-"}</td>
                        <td>{item.type ?? "-"}</td>
                        <td>{item.unit || "-"}</td>
                        <td>{formatPortfolioNumber(item.voicePoint, 2)}</td>
                        <td>{formatPortfolioNumber(item.qtyPlanned, 2)}</td>
                        <td>{formatPortfolioCurrency(item.unitValue)}</td>
                        <td>{formatPortfolioCurrency(item.totalValue)}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={8} className={styles.emptyRow}>Nenhuma atividade prevista cadastrada para este projeto.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
