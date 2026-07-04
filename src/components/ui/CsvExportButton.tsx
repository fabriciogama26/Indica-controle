import { ActionIcon } from "@/components/ui/ActionIcon";
import { ExportProgressModal } from "@/components/ui/ExportProgressModal";
import styles from "./CsvExportButton.module.css";

type CsvExportButtonProps = {
  onClick: () => void;
  disabled?: boolean;
  isLoading?: boolean;
  className?: string;
  idleLabel?: string;
  loadingLabel?: string;
  modalTitle?: string;
  modalMessage?: string;
  showProgressModal?: boolean;
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
  modalTitle = "Gerando...",
  modalMessage = "Preparando arquivo para download.",
  showProgressModal = true,
}: CsvExportButtonProps) {
  return (
    <>
      <button type="button" className={joinClasses(className)} onClick={onClick} disabled={disabled}>
        <span className={styles.label}>
          <ActionIcon name="exportCsv" className={styles.icon} />
          <span>{isLoading ? loadingLabel : idleLabel}</span>
        </span>
      </button>
      <ExportProgressModal
        open={showProgressModal && isLoading}
        title={modalTitle}
        message={modalMessage}
      />
    </>
  );
}
