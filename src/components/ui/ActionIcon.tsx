type ActionIconName = "details" | "edit" | "history" | "cancel" | "activate" | "exportCsv";

type ActionIconProps = {
  name: ActionIconName;
  className?: string;
};

export function ActionIcon({ name, className }: ActionIconProps) {
  switch (name) {
    case "details":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
          <path
            d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
        </svg>
      );
    case "edit":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
          <path
            d="M4.5 19.5h4l9-9a1.4 1.4 0 0 0 0-2l-2-2a1.4 1.4 0 0 0-2 0l-9 9v4Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M12.5 7.5l4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case "history":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
          <path
            d="M3.75 12a8.25 8.25 0 1 0 2.25-5.69M3.75 4.75v4h4"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M12 8.5v3.75l2.5 1.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case "cancel":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
          <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" />
          <path d="m9.5 9.5 5 5m0-5-5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case "activate":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
          <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" />
          <path
            d="m8.5 12 2.2 2.2 4.8-4.8"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
          <rect x="5" y="4.5" width="14" height="15" rx="2.2" stroke="currentColor" strokeWidth="1.7" />
          <path d="M12 8.5v6m0 0 2.5-2.5M12 14.5 9.5 12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
  }
}
