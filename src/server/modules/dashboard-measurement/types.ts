export type MeasurementOrderRow = {
  id: string;
  project_id: string;
  team_id: string;
  execution_date: string;
  measurement_kind: string;
  minimum_billing_amount: number | string;
  status: string;
  project_code_snapshot: string | null;
  team_name_snapshot: string | null;
  foreman_name_snapshot: string | null;
  programming_completion_status_snapshot: string | null;
};

export type MeasurementOrderItemRow = {
  measurement_order_id: string;
  total_value: number | string;
};

export type ProjectTestRow = {
  id: string;
  is_test: boolean | null;
  is_third_party?: boolean | null;
  service_center: string | null;
  service_center_text?: string | null;
  service_type_text?: string | null;
};

export type ProjectMeta = {
  isTest: boolean;
  isThirdParty: boolean;
  serviceCenterId: string | null;
  serviceCenterName: string;
  serviceTypeText: string;
};

export type ProjectProductionDetail = {
  projectId: string;
  projectCode: string;
  serviceCenter: string;
  totalValue: number;
  orderCount: number;
};

export type CycleProjectDetail = {
  projectId: string;
  projectCode: string;
  firstActivity: string;
  valueBeforeCycle: number;
  valueInCycle: number;
  accumulatedValue: number;
  workedCycleCount: number;
  week: number | null;
};

export type CompletionAggregate = {
  value: number;
  orders: number;
  projectIds: Set<string>;
  projects: Map<string, ProjectProductionDetail>;
};

export type TeamRow = {
  id: string;
  name: string;
  team_type_id: string | null;
  foreman_person_id: string | null;
  supervisor_person_id: string | null;
  ativo?: boolean | null;
};

export type TeamTypeHistoryRow = {
  team_id: string;
  team_type_id: string | null;
  team_type_name_snapshot: string;
  valid_from: string;
  valid_to: string | null;
};

export type TeamForemanHistoryRow = {
  team_id: string;
  foreman_name_snapshot: string;
  valid_from: string;
  valid_to: string | null;
};

export type TeamSupervisorHistoryRow = {
  team_id: string;
  supervisor_person_id: string | null;
  supervisor_name_snapshot: string;
  valid_from: string;
  valid_to: string | null;
};

export type TeamTypeRow = {
  id: string;
  name: string | null;
};

export type PersonRow = {
  id: string;
  nome: string | null;
};

export type CycleWorkdaysRow = {
  id: string;
  cycle_start: string;
  cycle_end: string;
  workdays: number | string;
  default_workdays: number | string | null;
};

export type CycleTargetItemRow = {
  team_type_id: string;
  daily_value: number | string;
  daily_goal: number | string;
  cycle_goal: number | string;
  standard_cycle_goal: number | string | null;
  worked_cycle_goal: number | string | null;
  measured_team_count?: number | string | null;
};

export type ProgrammingCompletionRow = {
  project_id: string;
  execution_date: string;
  status: string;
  work_completion_status: string | null;
  is_pendencia: boolean | null;
  updated_at: string;
};

export type ProgrammingCompletionTimelineItem = {
  executionDate: string;
  status: string;
  hasPendingFlag: boolean;
  updatedAt: string;
};

export type CycleWeek = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  workdays: number;
};

export type AnnualCycleComparison = {
  cycleStart: string;
  cycleEnd: string;
  label: string;
  measuredValue: number;
  forecastValue: number;
  metaValue: number;
  measuredPercentage: number;
  forecastPercentage: number;
  measuredDifference: number;
  forecastDifference: number;
  executedWorkdays: number;
  workdays: number;
  orderCount: number;
  projectCount: number;
  teamCount: number;
  hasMeta: boolean;
};

export type ServiceScope = "ALL" | "OBRAS" | "MANUTENCAO";
