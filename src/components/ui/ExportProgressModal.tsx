import styles from "./ExportProgressModal.module.css";

type ExportProgressModalProps = {
  open: boolean;
  title: string;
  message: string;
  percent?: number | null;
  id?: string;
};

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

export function ExportProgressModal({
  open,
  title,
  message,
  percent = null,
  id = "export-progress-title",
}: ExportProgressModalProps) {
  if (!open) return null;

  const normalizedPercent = typeof percent === "number" && Number.isFinite(percent)
    ? clampPercent(percent)
    : null;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby={id}>
      <article className={styles.card}>
        <div className={styles.spinner} aria-hidden="true" />
        <div className={styles.content}>
          <h4 id={id}>{title}</h4>
          <p>{message}</p>
          <div className={styles.track} aria-hidden="true">
            <div
              className={normalizedPercent === null ? `${styles.bar} ${styles.barIndeterminate}` : styles.bar}
              style={normalizedPercent === null ? undefined : { width: `${normalizedPercent}%` }}
            />
          </div>
          {normalizedPercent === null ? <strong>Aguarde...</strong> : <strong>{normalizedPercent}%</strong>}
        </div>
      </article>
    </div>
  );
}
