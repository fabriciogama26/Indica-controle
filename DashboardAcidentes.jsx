import { useMemo } from 'react'
import { PageHeader } from '../components/PageHeader.jsx'
import { AlertIcon, BarsIcon, PieIcon, TrendIcon, InfoIcon, ExpandIcon } from '../components/icons.jsx'
import { DashboardCards } from '../components/DashboardCards.jsx'
import { ChartTendencia } from '../components/charts/ChartTendencia.jsx'
import { ChartTipos } from '../components/charts/ChartTipos.jsx'
import { ChartPartesLesionadas } from '../components/charts/ChartPartesLesionadas.jsx'
import { ChartLesoes } from '../components/charts/ChartLesoes.jsx'
import { ChartCargos } from '../components/charts/ChartCargos.jsx'
import { ChartAgentes } from '../components/charts/ChartAgentes.jsx'
import { FiltrosDashboard } from '../components/FiltrosDashboard.jsx'
import { DashboardAcidentesProvider, useDashboardAcidentesContext } from '../context/DashboardAcidentesContext.jsx'
import { CHART_INFO_MESSAGES } from '../utils/dashboardAcidentesUtils.js'
import { HelpButton } from '../components/Help/HelpButton.jsx'
import { ChartExpandModal } from '../components/Dashboard/ChartExpandModal.jsx'

import '../styles/DashboardPage.css'

export function DashboardAcidentes() {
  return (
    <DashboardAcidentesProvider>
      <DashboardAcidentesContent />
    </DashboardAcidentesProvider>
  )
}

function DashboardAcidentesContent() {
  const {
    filters,
    filterOptions,
    dashboardData,
    error,
    handleFilterChange,
    handleSubmit,
    handleReset,
    expandedChartId,
    setExpandedChartId,
    helperText,
  } = useDashboardAcidentesContext()

  const CHART_ITEMS_LIMIT = 8
  const limitedCharts = useMemo(() => {
    const sliceTop = (list) => (Array.isArray(list) ? list.slice(0, CHART_ITEMS_LIMIT) : [])
    return {
      tipos: sliceTop(dashboardData.tipos),
      partesLesionadas: sliceTop(dashboardData.partesLesionadas),
      lesoes: sliceTop(dashboardData.lesoes),
      cargos: sliceTop(dashboardData.cargos),
      agentes: sliceTop(dashboardData.agentes),
    }
  }, [dashboardData])

  const chartModalConfig = useMemo(
    () => ({
      tendencia: {
        title: 'Tendencia mensal',
        render: () => (
          <ChartTendencia
            data={dashboardData.tendencia}
            xKey="periodo"
            acidentesKey="total_acidentes"
            tfKey="taxa_frequencia"
            tgKey="taxa_gravidade"
            height={520}
          />
        ),
      },
      tipos: {
        title: 'Distribuicao por tipo',
        render: () => <ChartTipos data={dashboardData.tipos} nameKey="tipo" valueKey="total" height={480} />,
      },
      partes: {
        title: 'Parte lesionada',
        render: () => (
          <ChartPartesLesionadas
            data={dashboardData.partesLesionadas}
            nameKey="parte_lesionada"
            valueKey="total"
            height={520}
            autoHeight
          />
        ),
      },
      lesoes: {
        title: 'Lesoes registradas',
        render: () => (
          <ChartLesoes data={dashboardData.lesoes} nameKey="lesao" valueKey="total" height={520} />
        ),
      },
      cargos: {
        title: 'Acidentes por cargo',
        render: () => <ChartCargos data={dashboardData.cargos} nameKey="cargo" valueKey="total" height={480} />,
      },
      agentes: {
        title: 'Agente causador',
        render: () => <ChartAgentes data={dashboardData.agentes} nameKey="agente" valueKey="total" height={440} />,
      },
    }),
    [dashboardData]
  )

  const activeChart = expandedChartId ? chartModalConfig[expandedChartId] : null
  const openChartModal = (chartId) => setExpandedChartId(chartId)
  const closeChartModal = () => setExpandedChartId(null)

  return (
    <div className="stack dashboard-page">
      <PageHeader
        title="Dashboard de Acidentes"
        icon={<AlertIcon size={28} />}
        subtitle="Monitoramento de indicadores de SST com dados consolidados."
        actions={<HelpButton topic="dashboardAcidentes" />}
      />

      <FiltrosDashboard
        filters={filters}
        options={filterOptions}
        onChange={handleFilterChange}
        onSubmit={handleSubmit}
        onReset={handleReset}
      />

      {error ? <p className="feedback feedback--error">{error}</p> : null}

      <DashboardCards indicadores={dashboardData.resumo ?? {}} helperText={helperText ?? undefined} />

      <div className="dashboard-grid dashboard-grid--two">
        <section className="card dashboard-card--chart dashboard-card--chart-lg">
          <header className="card__header dashboard-card__header">
            <div className="dashboard-card__title-group">
              <ChartInfoButton infoKey="tendencia" label="Informacoes sobre tendencia mensal" />
              <h2 className="dashboard-card__title">
                <TrendIcon size={20} /> <span>Tendencia mensal</span>
              </h2>
            </div>
            <div className="dashboard-card__actions">
              <button
                type="button"
                className="dashboard-card__expand"
                onClick={() => openChartModal('tendencia')}
                aria-label="Expandir grafico tendencia mensal"
              >
                <ExpandIcon size={16} />
              </button>
            </div>
          </header>
          <ChartContainer>
            <ChartTendencia
              data={dashboardData.tendencia}
              xKey="periodo"
              acidentesKey="total_acidentes"
              tfKey="taxa_frequencia"
              tgKey="taxa_gravidade"
            />
          </ChartContainer>
        </section>

        <section className="card dashboard-card--chart dashboard-card--chart-lg">
          <header className="card__header dashboard-card__header">
            <div className="dashboard-card__title-group">
              <ChartInfoButton infoKey="agentes" label="Informacoes sobre agentes causadores" />
              <h2 className="dashboard-card__title">
                <PieIcon size={20} /> <span>Agente causador</span>
              </h2>
            </div>
            <div className="dashboard-card__actions">
              <button
                type="button"
                className="dashboard-card__expand"
                onClick={() => openChartModal('agentes')}
                aria-label="Expandir grafico agente causador"
              >
                <ExpandIcon size={16} />
              </button>
            </div>
          </header>
          <ChartContainer>
            <ChartAgentes data={limitedCharts.agentes} nameKey="agente" valueKey="total" />
          </ChartContainer>
        </section>
      </div>

      <div className="dashboard-grid dashboard-grid--two">
        <section className="card dashboard-card--chart dashboard-card--chart-lg">
          <header className="card__header dashboard-card__header">
            <div className="dashboard-card__title-group">
              <ChartInfoButton infoKey="partes" label="Informacoes sobre parte lesionada" />
              <h2 className="dashboard-card__title">
                <BarsIcon size={20} /> <span>Parte lesionada</span>
              </h2>
            </div>
            <div className="dashboard-card__actions">
              <button
                type="button"
                className="dashboard-card__expand"
                onClick={() => openChartModal('partes')}
                aria-label="Expandir grafico parte lesionada"
              >
                <ExpandIcon size={16} />
              </button>
            </div>
          </header>
          <ChartContainer>
            <ChartPartesLesionadas
              data={limitedCharts.partesLesionadas}
              nameKey="parte_lesionada"
              valueKey="total"
            />
          </ChartContainer>
        </section>

        <section className="card dashboard-card--chart dashboard-card--chart-lg">
          <header className="card__header dashboard-card__header">
            <div className="dashboard-card__title-group">
              <ChartInfoButton infoKey="lesoes" label="Informacoes sobre lesoes" />
              <h2 className="dashboard-card__title">
                <BarsIcon size={20} /> <span>Lesoes</span>
              </h2>
            </div>
            <div className="dashboard-card__actions">
              <button
                type="button"
                className="dashboard-card__expand"
                onClick={() => openChartModal('lesoes')}
                aria-label="Expandir grafico de lesoes"
              >
                <ExpandIcon size={16} />
              </button>
            </div>
          </header>
          <ChartContainer>
            <ChartLesoes data={limitedCharts.lesoes} nameKey="lesao" valueKey="total" />
          </ChartContainer>
        </section>
      </div>

      <div className="dashboard-grid dashboard-grid--two">
        <section className="card dashboard-card--chart dashboard-card--chart-lg">
          <header className="card__header dashboard-card__header">
            <div className="dashboard-card__title-group">
              <ChartInfoButton infoKey="cargos" label="Informacoes sobre acidentes por cargo" />
              <h2 className="dashboard-card__title">
                <BarsIcon size={20} /> <span>Acidentes por cargo</span>
              </h2>
            </div>
            <div className="dashboard-card__actions">
              <button
                type="button"
                className="dashboard-card__expand"
                onClick={() => openChartModal('cargos')}
                aria-label="Expandir grafico acidentes por cargo"
              >
                <ExpandIcon size={16} />
              </button>
            </div>
          </header>
          <ChartContainer>
            <ChartCargos data={limitedCharts.cargos} nameKey="cargo" valueKey="total" />
          </ChartContainer>
        </section>

        <section className="card dashboard-card--chart dashboard-card--chart-lg">
          <header className="card__header dashboard-card__header">
            <div className="dashboard-card__title-group">
              <ChartInfoButton infoKey="tipos" label="Informacoes sobre distribuicao por tipo" />
              <h2 className="dashboard-card__title">
                <PieIcon size={20} /> <span>Distribuicao por tipo</span>
              </h2>
            </div>
            <div className="dashboard-card__actions">
              <button
                type="button"
                className="dashboard-card__expand"
                onClick={() => openChartModal('tipos')}
                aria-label="Expandir grafico distribuicao por tipo"
              >
                <ExpandIcon size={16} />
              </button>
            </div>
          </header>
          <ChartContainer>
            <ChartTipos data={limitedCharts.tipos} nameKey="tipo" valueKey="total" />
          </ChartContainer>
        </section>
      </div>

      <ChartExpandModal open={Boolean(activeChart)} title={activeChart?.title} onClose={closeChartModal}>
        {activeChart?.render()}
      </ChartExpandModal>
    </div>
  )
}

function ChartInfoButton({ infoKey, label }) {
  const message = CHART_INFO_MESSAGES[infoKey]
  if (!message) {
    return null
  }
  return (
    <button type="button" className="summary-tooltip dashboard-card__info" aria-label={label}>
      <InfoIcon size={14} />
      <span>{message}</span>
    </button>
  )
}

function ChartContainer({ children }) {
  return <div className="dashboard-chart-container dashboard-chart-container--simple">{children}</div>
}

