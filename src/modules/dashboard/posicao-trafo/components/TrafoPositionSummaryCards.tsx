"use client";

import type { TrafoPositionSummary } from "../types";
import styles from "../TrafoPositionPageView.module.css";

type TrafoPositionSummaryCardsProps = {
  summary: TrafoPositionSummary;
  total: number;
};

export function TrafoPositionSummaryCards({ summary, total }: TrafoPositionSummaryCardsProps) {
  const cards: Array<{ label: string; value: number }> = [
    { label: "Registros filtrados", value: total },
    { label: "Em estoque proprio", value: summary.inOwnCount },
    { label: "Com equipe", value: summary.withTeamCount },
    { label: "RET", value: summary.retCount },
    { label: "Fora do estoque proprio", value: summary.outsideCount },
    { label: "Pendentes de serial", value: summary.pendingSerialCount },
  ];

  return (
    <div className={styles.statsGrid}>
      {cards.map((card) => (
        <div key={card.label} className={styles.statCard}>
          <span className={styles.statLabel}>{card.label}</span>
          <strong className={styles.statValue}>{card.value}</strong>
        </div>
      ))}
    </div>
  );
}
