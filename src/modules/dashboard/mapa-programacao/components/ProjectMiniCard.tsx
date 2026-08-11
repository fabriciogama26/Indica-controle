"use client";

import Link from "next/link";

import { formatDate, formatDaysSince, formatNameList } from "../formatters";
import type { MapProject, PriorityLevel } from "../types";
import styles from "../MapProgrammingPageView.module.css";

function getPriorityLabel(value: PriorityLevel) {
  if (value === "INCONSISTENCY") return "Inconsistencia";
  if (value === "PRIORITY") return "Prioridade";
  if (value === "ATTENTION") return "Atencao";
  return "Normal";
}

function getPriorityClassName(value: PriorityLevel) {
  if (value === "INCONSISTENCY") return styles.priorityInconsistency;
  if (value === "PRIORITY") return styles.priorityHigh;
  if (value === "ATTENTION") return styles.priorityAttention;
  return styles.priorityNormal;
}

export function ProjectMiniCard({ project, expanded = false }: { project: MapProject; expanded?: boolean }) {
  return (
    <article className={styles.projectCard}>
      <div className={styles.projectCardHeader}>
        <div>
          <strong>{project.sob}</strong>
          <span>{project.projectName}</span>
        </div>
        <span className={`${styles.priorityPill} ${getPriorityClassName(project.priorityLevel)}`}>
          {getPriorityLabel(project.priorityLevel)}
        </span>
      </div>
      <div className={styles.projectMetaGrid}>
        <span>Tipo de servico <strong>{project.serviceType}</strong></span>
        <span>Ultima data <strong>{formatDate(project.latestDate)}</strong></span>
        <span>Equipe <strong>{formatNameList(project.latestTeamNames)}</strong></span>
        <span>Encarregado <strong>{formatNameList(project.latestForemanNames)}</strong></span>
        <span>Estado Trabalho <strong>{project.latestWorkCompletionLabel}</strong></span>
        <span>Etapas <strong>{project.stageCount}</strong></span>
        <span>Equipes <strong>{project.teamCount}</strong></span>
        <span>Ultima etapa <strong>{project.latestStageLabel}</strong></span>
        {project.isWithdrawn ? (
          <span>Carteira <strong>Retirada</strong></span>
        ) : null}
        <span>Dias desde ultima <strong>{formatDaysSince(project.daysSinceLatest)}</strong></span>
      </div>
      {expanded && project.reason ? (
        <p className={styles.reasonText}>{project.reason}</p>
      ) : null}
      <div className={styles.projectActions}>
        <Link className={styles.tableLink} href="/programacao-normalizada">Programar</Link>
        <Link className={styles.tableLink} href="/programacao-normalizada">Historico</Link>
        <Link className={styles.tableLink} href="/projetos">Detalhes</Link>
      </div>
    </article>
  );
}
