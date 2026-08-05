"use client";

import { ActionIcon } from "@/components/ui/ActionIcon";
import { CsvExportButton } from "@/components/ui/CsvExportButton";
import { ExportProgressModal } from "@/components/ui/ExportProgressModal";

import { AbcChart } from "./components/AbcChart";
import { BarList } from "./components/BarList";
import { DashboardFilters } from "./components/DashboardFilters";
import { EvolutionChart } from "./components/EvolutionChart";
import { IdleChart } from "./components/IdleChart";
import { MaterialDetailsModal } from "./components/MaterialDetailsModal";
import { ScatterChart } from "./components/ScatterChart";
import { ScatterExpandedModal } from "./components/ScatterExpandedModal";
import { ScatterUnitStrip } from "./components/ScatterUnitStrip";
import { ScatterViewControls } from "./components/ScatterViewControls";
import { StockSummary } from "./components/StockSummary";
import { evolutionEstimatedValueHelp } from "./helpers";
import { useStockDashboard } from "./hooks";
import styles from "./StockDashboardPageView.module.css";

export function StockDashboardPageView() {
  const dashboard = useStockDashboard();

  return (
    <section className={styles.wrapper}>
      <ExportProgressModal
        open={dashboard.isExportingScatter}
        title="Gerando..."
        message="Gerando arquivo CSV."
      />
      <MaterialDetailsModal
        modal={dashboard.materialModal}
        isExporting={dashboard.isExportingMaterialModal}
        onClose={() => dashboard.setMaterialModal(null)}
        onExport={() => void dashboard.exportMaterialModalRows()}
      />
      {dashboard.feedback ? (
        <div className={dashboard.feedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError}>
          {dashboard.feedback.message}
        </div>
      ) : null}

      <DashboardFilters
        values={dashboard.filterValues}
        stockCenters={dashboard.stockCenters}
        teams={dashboard.teams}
        projects={dashboard.projects}
        isLoading={dashboard.isLoading}
        onChange={dashboard.handleFilterChange}
        onSubmit={() => void dashboard.loadDashboard()}
      />

      <StockSummary summary={dashboard.summary} summaryByUnit={dashboard.summaryByUnit} />

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Dispersao de materiais</h2>
            <p className={styles.cardSubtitle}>
              Quantidade movimentada por numero de operacoes. Selecione a UMB para comparar materiais na mesma unidade.
              {dashboard.scatterUnit ? ` | UMB ${dashboard.scatterUnit}` : ""}
            </p>
          </div>
          <div className={styles.chartActions}>
            <ScatterViewControls
              operation={dashboard.scatterOperation}
              scale={dashboard.scatterScale}
              onOperationChange={dashboard.handleScatterOperationChange}
              onScaleChange={dashboard.setScatterScale}
            />
            <button type="button" className={styles.expandButton} onClick={() => dashboard.setIsScatterExpanded(true)}>
              Expandir
            </button>
            <CsvExportButton
              onClick={() => void dashboard.exportScatterRows()}
              disabled={!dashboard.activeScatterRows.length}
              isLoading={dashboard.isExportingScatter}
              className={styles.expandButton}
              idleLabel="Exportar CSV"
              showProgressModal={false}
            />
          </div>
        </div>
        <ScatterUnitStrip
          rows={dashboard.activeScatterUnitSummary}
          selectedUnit={dashboard.scatterUnit}
          onSelectUnit={dashboard.handleScatterUnitChange}
        />
        <ScatterChart
          rows={dashboard.scatter}
          operation={dashboard.scatterOperation}
          scale={dashboard.scatterScale}
          unit={dashboard.scatterUnit}
          selectedMaterialId={dashboard.selectedScatterMaterialId}
          onSelectPoint={dashboard.setSelectedScatterMaterialId}
        />
      </article>

      <div className={styles.chartGrid}>
        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2 className={styles.cardTitle}>Materiais criticos e zerados</h2>
              <p className={styles.cardSubtitle}>Menores saldos no recorte atual.</p>
            </div>
          </div>
          <BarList rows={dashboard.criticalMaterials} variant="critical" emptyLabel="Nenhum material critico encontrado." />
        </article>

        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2 className={styles.cardTitle}>Top materiais por saldo</h2>
              <p className={styles.cardSubtitle}>Maiores saldos consolidados por material.</p>
            </div>
          </div>
          <BarList rows={dashboard.topBalanceMaterials} emptyLabel="Nenhum saldo encontrado." />
        </article>
      </div>

      <div className={styles.chartGrid}>
        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2 className={styles.cardTitle}>Materiais sem giro</h2>
              <p className={styles.cardSubtitle}>Faixas pela ultima movimentacao conhecida.</p>
            </div>
          </div>
          <IdleChart rows={dashboard.idleBuckets} onSelectBucket={dashboard.openIdleMaterials} />
        </article>

        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2 className={styles.cardTitle}>Curva ABC do estoque</h2>
              <p className={styles.cardSubtitle}>
                {dashboard.abcMode === "value" ? "Classificacao por saldo x preco do material." : "Classificacao por quantidade em estoque."}
              </p>
            </div>
            <div className={styles.segmented}>
              <button
                type="button"
                className={dashboard.abcMode === "value" ? styles.segmentActive : styles.segment}
                onClick={() => dashboard.setAbcMode("value")}
              >
                Valor
              </button>
              <button
                type="button"
                className={dashboard.abcMode === "quantity" ? styles.segmentActive : styles.segment}
                onClick={() => dashboard.setAbcMode("quantity")}
              >
                Quantidade
              </button>
            </div>
          </div>
          <AbcChart
            rows={dashboard.abcMode === "value" ? dashboard.abcRows : dashboard.abcQuantityRows}
            mode={dashboard.abcMode}
            onSelectRow={dashboard.openAbcMaterials}
          />
        </article>
      </div>

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Evolucao de movimentacoes</h2>
            <p className={styles.cardSubtitle}>Quantidade mensal de operacoes realizadas por tipo.</p>
          </div>
          <div className={styles.movementHeaderActions}>
            <button
              type="button"
              className={styles.infoButton}
              aria-label="Como o valor estimado mensal e calculado"
              title={evolutionEstimatedValueHelp}
            >
              <ActionIcon name="info" className={styles.infoIcon} />
            </button>
            <div className={styles.movementTotal}>
              {dashboard.summary?.movementCount ?? 0} operacoes
            </div>
          </div>
        </div>
        <EvolutionChart rows={dashboard.movementEvolution} />
      </article>

      {dashboard.isScatterExpanded ? (
        <ScatterExpandedModal
          rows={dashboard.scatter}
          unitSummary={dashboard.activeScatterUnitSummary}
          operation={dashboard.scatterOperation}
          scale={dashboard.scatterScale}
          unit={dashboard.scatterUnit}
          selectedPoint={dashboard.selectedScatterPoint}
          selectedMaterialId={dashboard.selectedScatterMaterialId}
          canExport={dashboard.activeScatterRows.length > 0}
          isExporting={dashboard.isExportingScatter}
          onOperationChange={dashboard.handleScatterOperationChange}
          onScaleChange={dashboard.setScatterScale}
          onSelectUnit={dashboard.handleScatterUnitChange}
          onSelectPoint={dashboard.setSelectedScatterMaterialId}
          onExport={() => void dashboard.exportScatterRows()}
          onClose={() => dashboard.setIsScatterExpanded(false)}
        />
      ) : null}
    </section>
  );
}
