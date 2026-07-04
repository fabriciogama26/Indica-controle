import styles from "./Pagination.module.css";

type PaginationProps = {
  page: number;
  totalPages: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  disabled?: boolean;
  className?: string;
  actionsClassName?: string;
  buttonClassName?: string;
  prevLabel?: string;
  nextLabel?: string;
};

export function Pagination({
  page,
  totalPages,
  total,
  onPrev,
  onNext,
  disabled = false,
  className,
  actionsClassName,
  buttonClassName,
  prevLabel = "Anterior",
  nextLabel = "Proxima",
}: PaginationProps) {
  return (
    <div className={className ?? styles.pagination}>
      <span>
        Pagina {Math.min(page, totalPages)} de {totalPages} | Total: {total}
      </span>
      <div className={actionsClassName ?? styles.paginationActions}>
        <button
          type="button"
          className={buttonClassName ?? styles.ghostButton}
          onClick={onPrev}
          disabled={disabled || page <= 1}
        >
          {prevLabel}
        </button>
        <button
          type="button"
          className={buttonClassName ?? styles.ghostButton}
          onClick={onNext}
          disabled={disabled || page >= totalPages}
        >
          {nextLabel}
        </button>
      </div>
    </div>
  );
}
