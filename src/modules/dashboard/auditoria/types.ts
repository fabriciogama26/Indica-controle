export type FeedbackState = { type: "success" | "error"; message: string } | null;

export type ScreenOption = { pageKey: string; name: string };

export type PaginationInfo = { page: number; pageSize: number; total: number };

export type ChangeHistoryItem = {
  id: string;
  moduleKey: string;
  entityTable: string;
  entityId: string;
  entityCode: string | null;
  changeType: string;
  reason: string | null;
  changes: Record<string, { from: string | null; to: string | null }>;
  createdAt: string;
  userName: string;
  userMatricula: string | null;
};

export type ChangeHistoryFiltersState = {
  moduleKey: string;
  userQuery: string;
  changeType: string;
  entityCode: string;
  dateFrom: string;
  dateTo: string;
};

export const EMPTY_CHANGE_FILTERS: ChangeHistoryFiltersState = {
  moduleKey: "",
  userQuery: "",
  changeType: "",
  entityCode: "",
  dateFrom: "",
  dateTo: "",
};

export type AccessLogItem = {
  id: string;
  eventType: string;
  status: string;
  reason: string | null;
  source: string;
  matricula: string | null;
  loginName: string | null;
  eventAt: string;
  sessionRef: string | null;
};

export type AccessLogFiltersState = {
  userQuery: string;
  status: string;
  eventType: string;
  reason: string;
  source: string;
  dateFrom: string;
  dateTo: string;
};

export const EMPTY_ACCESS_FILTERS: AccessLogFiltersState = {
  userQuery: "",
  status: "",
  eventType: "",
  reason: "",
  source: "",
  dateFrom: "",
  dateTo: "",
};

export type ErrorLogItem = {
  id: string;
  severity: string;
  screen: string | null;
  message: string;
  stacktrace: string | null;
  matricula: string | null;
  loginName: string | null;
  source: string;
  createdAt: string;
};

export type ErrorLogFiltersState = {
  userQuery: string;
  severity: string;
  screen: string;
  source: string;
  dateFrom: string;
  dateTo: string;
};

export const EMPTY_ERROR_FILTERS: ErrorLogFiltersState = {
  userQuery: "",
  severity: "",
  screen: "",
  source: "",
  dateFrom: "",
  dateTo: "",
};
