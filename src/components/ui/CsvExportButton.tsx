import { ActionIcon } from "@/components/ui/ActionIcon";
import styles from "./CsvExportButton.module.css";

type CsvExportButtonProps = {
  onClick: () => void;
  disabled?: boolean;
  isLoading?: boolean;
  className?: string;
  idleLabel?: string;
  loadingLabel?: string;
};

function joinClasses(...classNames: Array<string | undefined>) {
  return classNames.filter(Boolean).join(" ");
}

export function CsvExportButton({
  onClick,
  disabled = false,
  isLoading = false,
  className,
  idleLabel = "Exportar Excel (CSV)",
  loadingLabel = "Exportando...",
}: CsvExportButtonProps) {
  return (
    <button type="button" className={joinClasses(className)} onClick={onClick} disabled={disabled}>
      <span className={styles.label}>
        <ActionIcon name="exportCsv" className={styles.icon} />
        <span>{isLoading ? loadingLabel : idleLabel}</span>
      </span>
    </button>
  );
}
