export type ViewMode = "week" | "day";
export type ScheduleTone =
  | "planned"
  | "partial"
  | "complete"
  | "issue"
  | "rescheduled"
  | "postponed"
  | "cancelled";
export type PeriodMode = "integral" | "partial";
export type DocumentKey = "sgd" | "pi" | "pep";
export type ProgrammingStatus = "PROGRAMADA" | "ADIADA" | "CANCELADA";

export type ProjectItem = {
  id: string;
  code: string;
  serviceName: string;
  city: string;
  base: string;
  serviceType: string;
  priority: string;
  note: string;
  hasLocacao: boolean;
  defaultSupportItemId?: string | null;
  defaultSupportLabel?: string | null;
};

export type TeamItem = {
  id: string;
  name: string;
  serviceCenterId?: string | null;
  serviceCenterName: string;
  teamTypeName: string;
  foremanName: string;
};

export type DocumentEntry = {
  number: string;
  includedAt: string;
  deliveredAt: string;
};

export type ActivityCatalogItem = {
  id: string;
  code: string;
  description: string;
  unit: string;
};

export type ScheduleActivityItem = {
  catalogId: string;
  code: string;
  description: string;
  quantity: number;
  unit: string;
};

export type ScheduleItem = {
  id: string;
  projectId: string;
  teamId: string;
  status: ProgrammingStatus;
  date: string;
  period: PeriodMode;
  startTime: string;
  endTime: string;
  updatedAt: string;
  expectedMinutes: number;
  activities: ScheduleActivityItem[];
  documents: Record<DocumentKey, DocumentEntry>;
  feeder: string;
  support: string;
  supportItemId: string | null;
  note: string;
  projectBase: string;
  statusReason: string;
  statusChangedAt: string;
  hasIssue: boolean;
  wasRescheduled: boolean;
  lastReschedule: {
    id: string;
    changedAt: string;
    reason: string;
    fromDate: string;
    toDate: string;
  } | null;
};

export type SupportOptionItem = {
  id: string;
  description: string;
};

export type TeamSummaryItem = {
  teamId: string;
  weekStart: string;
  weekEnd: string;
  workedDays: number;
  capacityDays: number;
  freeDays: number;
  loadPercent: number;
  loadStatus: "FREE" | "NORMAL" | "WARNING" | "OVERLOAD";
};

export type DragPayload =
  | { kind: "project"; projectId: string }
  | { kind: "schedule"; scheduleId: string };

export type ScheduleFormState = {
  period: PeriodMode;
  startTime: string;
  endTime: string;
  activities: ScheduleActivityItem[];
  activitySearch: string;
  activityQuantity: string;
  documents: Record<DocumentKey, DocumentEntry>;
  feeder: string;
  supportItemId: string;
  note: string;
};

export type ModalState = {
  scheduleId: string | null;
  projectId: string;
  teamId: string;
  date: string;
  form: ScheduleFormState;
};

export type StatusAction = "cancel" | "postpone";

export type CancelModalState = {
  scheduleId: string;
  projectCode: string;
  expectedUpdatedAt: string;
  action: StatusAction;
};

export type SaveRequestPayload = {
  id?: string;
  projectId: string;
  teamId: string;
  date: string;
  period: PeriodMode;
  startTime: string;
  endTime: string;
  expectedMinutes: number;
  feeder: string;
  note: string;
  supportItemId?: string;
  expectedUpdatedAt?: string;
  changeReason?: string;
  documents: Record<DocumentKey, { number: string; deliveredAt: string }>;
  activities: Array<{ catalogId: string; quantity: number }>;
};

export type ReprogramModalState = {
  projectCode: string;
  payload: SaveRequestPayload;
};

export type CopyModalState = {
  sourceTeamId: string;
  targetTeamIds: string[];
};

export type FeedbackState = {
  type: "success" | "error";
  message: string;
};

export type ProgrammingResponse = {
  projects?: ProjectItem[];
  teams?: TeamItem[];
  supportOptions?: SupportOptionItem[];
  teamSummaries?: TeamSummaryItem[];
  schedules?: Array<{
    id: string;
    projectId: string;
    teamId: string;
    status: ProgrammingStatus;
    date: string;
    period: PeriodMode;
    startTime: string;
    endTime: string;
    updatedAt: string;
    expectedMinutes: number;
    feeder: string;
    support: string;
    supportItemId?: string | null;
    note: string;
    projectBase: string;
    statusReason?: string;
    statusChangedAt?: string;
    wasRescheduled?: boolean;
    lastReschedule?: {
      id: string;
      changedAt: string;
      reason: string;
      fromDate: string;
      toDate: string;
    } | null;
    activities?: ScheduleActivityItem[];
    documents?: Partial<Record<DocumentKey, Partial<DocumentEntry>>>;
  }>;
  message?: string;
};

export type ActivityCatalogResponse = {
  items?: Array<{
    id: string;
    code: string;
    description: string;
    unit: string;
  }>;
  message?: string;
};

export type SaveProgrammingResponse = {
  id?: string;
  updatedAt?: string;
  warning?: string;
  error?: "conflict";
  currentUpdatedAt?: string | null;
  updatedBy?: string | null;
  changedFields?: string[];
  currentRecord?: {
    id: string;
    executionDate: string;
    startTime: string;
    endTime: string;
    updatedAt: string;
  } | null;
  message?: string;
};

export type CopyProgrammingResponse = {
  copiedCount?: number;
  message?: string;
};
