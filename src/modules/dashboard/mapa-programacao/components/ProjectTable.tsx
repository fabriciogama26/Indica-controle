"use client";

import { formatDate, formatDaysSince, formatNameList } from "../formatters";
import type { MapProject } from "../types";
import styles from "../MapProgrammingPageView.module.css";

const TABLE_PAGE_SIZE = 8;

export function ProjectTable({
  projects,
  page,
  onPageChange,
  emptyMessage,
  onProjectClick,
}: {
  projects: MapProject[];
  page: number;
  onPageChange: (page: number) => void;
  emptyMessage: string;
  onProjectClick: (project: MapProject) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(projects.length / TABLE_PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 1), pageCount);
  const pageProjects = projects.slice((safePage - 1) * TABLE_PAGE_SIZE, safePage * TABLE_PAGE_SIZE);

  if (!projects.length) {
    return <div className={styles.emptyState}>{emptyMessage}</div>;
  }

  return (
    <div className={styles.tableBlock}>
      <div className={styles.tableWrapper}>
        <table className={styles.compactTable}>
          <thead>
            <tr>
              <th>SOB</th>
              <th>Ultima data</th>
              <th>Status</th>
              <th>Estado Trabalho</th>
              <th>Equipe</th>
              <th>Encarregado</th>
              <th>Etapas</th>
              <th>Equipes</th>
              <th>Dias</th>
            </tr>
          </thead>
          <tbody>
            {pageProjects.map((project) => (
              <tr
                key={project.id}
                onClick={() => onProjectClick(project)}
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onProjectClick(project);
                  }
                }}
              >
                <td><strong>{project.sob}</strong></td>
                <td>{formatDate(project.latestDate)}</td>
                <td>{project.latestProgrammingStatus}</td>
                <td>{project.latestWorkCompletionLabel}</td>
                <td>{formatNameList(project.latestTeamNames)}</td>
                <td>{formatNameList(project.latestForemanNames)}</td>
                <td>{project.stageCount}</td>
                <td>{project.teamCount}</td>
                <td>{formatDaysSince(project.daysSinceLatest)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.paginationBar}>
        <span>{projects.length} obras | pagina {safePage} de {pageCount}</span>
        <div className={styles.quickActions}>
          <button type="button" className={styles.ghostButton} onClick={() => onPageChange(safePage - 1)} disabled={safePage <= 1}>
            Anterior
          </button>
          <button type="button" className={styles.ghostButton} onClick={() => onPageChange(safePage + 1)} disabled={safePage >= pageCount}>
            Proxima
          </button>
        </div>
      </div>
    </div>
  );
}
