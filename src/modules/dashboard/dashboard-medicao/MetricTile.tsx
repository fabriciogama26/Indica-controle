"use client";

import { ActionIcon } from "@/components/ui/ActionIcon";

import styles from "./DashboardMeasurementPageView.module.css";

type MetricTileProps = {
  label: string;
  value: string;
  help?: string;
};

export function MetricTile({ label, value, help }: MetricTileProps) {
  return (
    <div className={styles.metric}>
      <div className={styles.metricLabel}>
        <span>{label}</span>
        {help ? (
          <button type="button" className={styles.infoButton} aria-label={`Como ${label} e calculado`} title={help}>
            <ActionIcon name="info" className={styles.infoIcon} />
          </button>
        ) : null}
      </div>
      <strong>{value}</strong>
    </div>
  );
}
