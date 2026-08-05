import styles from "../StockDashboardPageView.module.css";
import type { DashboardFilterValues, Option, StockCenterOption } from "../types";

export function DashboardFilters({
  values,
  stockCenters,
  teams,
  projects,
  isLoading,
  onChange,
  onSubmit,
}: {
  values: DashboardFilterValues;
  stockCenters: StockCenterOption[];
  teams: Option[];
  projects: Option[];
  isLoading: boolean;
  onChange: <K extends keyof DashboardFilterValues>(field: K, value: DashboardFilterValues[K]) => void;
  onSubmit: () => void;
}) {
  return (
    <article className={styles.card}>
      <div className={styles.cardHeader}>
        <div>
          <h2 className={styles.cardTitle}>Filtros</h2>
          <p className={styles.cardSubtitle}>Recorte por periodo, centro, equipe, projeto, material e tipo.</p>
        </div>
        <button type="button" className={styles.primaryButton} onClick={onSubmit} disabled={isLoading}>
          {isLoading ? "Filtrando..." : "Filtrar"}
        </button>
      </div>

      <div className={styles.filterGrid}>
        <label className={styles.field}>
          <span>Data inicial</span>
          <input type="date" value={values.startDate} onChange={(event) => onChange("startDate", event.target.value)} disabled={isLoading} />
        </label>
        <label className={styles.field}>
          <span>Data final</span>
          <input type="date" value={values.endDate} onChange={(event) => onChange("endDate", event.target.value)} disabled={isLoading} />
        </label>
        <label className={styles.field}>
          <span>Centro de estoque</span>
          <select value={values.stockCenterId} onChange={(event) => onChange("stockCenterId", event.target.value)} disabled={isLoading}>
            <option value="">Todos</option>
            {stockCenters.map((center) => (
              <option key={center.id} value={center.id}>{center.name}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Equipe</span>
          <select value={values.teamId} onChange={(event) => onChange("teamId", event.target.value)} disabled={isLoading}>
            <option value="">Todas</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>{team.label}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Projeto</span>
          <select value={values.projectId} onChange={(event) => onChange("projectId", event.target.value)} disabled={isLoading}>
            <option value="">Todos</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.label}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Material</span>
          <input value={values.materialCode} onChange={(event) => onChange("materialCode", event.target.value)} placeholder="Codigo" disabled={isLoading} />
        </label>
        <label className={styles.field}>
          <span>Tipo</span>
          <select value={values.materialType} onChange={(event) => onChange("materialType", event.target.value)} disabled={isLoading}>
            <option value="">Todos</option>
            <option value="NOVO">NOVO</option>
            <option value="SUCATA">SUCATA</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>Limite critico</span>
          <input value={values.criticalQty} onChange={(event) => onChange("criticalQty", event.target.value)} inputMode="decimal" disabled={isLoading} />
        </label>
      </div>
    </article>
  );
}
