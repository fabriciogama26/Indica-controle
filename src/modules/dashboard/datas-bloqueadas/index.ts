// Fachada publica do modulo. A Programacao, o Mapa de Programacao e a
// Visualizacao de Programacao consomem SOMENTE o que sai daqui.
export { BlockedDatesPageView } from "./BlockedDatesPageView";
export {
  findBlockedDatesFor,
  formatBlockedDateLabel,
  formatBlockedDateShort,
  getMonthWindow,
  normalizeMunicipalityName,
} from "./blockedDates";
export { useActiveBlockedDates } from "./useActiveBlockedDates";
export {
  BLOCKED_DATE_KIND_LABELS,
  BLOCKED_DATE_SCOPE_LABELS,
  type ActiveBlockedDate,
  type BlockedDateItem,
  type BlockedDateKind,
  type BlockedDateScope,
} from "./types";
