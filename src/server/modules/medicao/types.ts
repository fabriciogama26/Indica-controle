// Tipos do dominio de Medicao.
// Extraidos de src/app/api/medicao/route.ts sem alteracao de forma.

export type MeasurementOrderStatus = "ABERTA" | "FECHADA" | "CANCELADA";
export type ProgrammingMatchStatus = "PROGRAMADA" | "NAO_PROGRAMADA";
export type ProgrammingWorkCompletionStatus = string | null;
export type MeasurementKind = "COM_PRODUCAO" | "SEM_PRODUCAO";

export type MeasurementOrderRow = {
  id: string;
  order_number: string;
  programming_id: string | null;
  project_id: string | null;
  team_id: string;
  execution_date: string;
  measurement_date: string;
  voice_point: number | string;
  manual_rate: number | string;
  measurement_kind: MeasurementKind;
  no_production_reason_id: string | null;
  no_production_reason_name_snapshot: string | null;
  status: MeasurementOrderStatus;
  notes: string | null;
  project_code_snapshot: string | null;
  team_name_snapshot: string;
  foreman_name_snapshot: string | null;
  is_active: boolean;
  cancellation_reason: string | null;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  programming_completion_status_snapshot: string | null;
  programming_completion_status_snapshot_at: string | null;
  minimum_billing_amount: number | string;
  minimum_billing_team_type_id: string | null;
  minimum_billing_team_type_name_snapshot: string | null;
  minimum_billing_score_target_id: string | null;
  minimum_billing_target_points: number | string | null;
  minimum_billing_unit_value_source_activity_id: string | null;
  minimum_billing_unit_value_group_snapshot: string | null;
  minimum_billing_unit_value: number | string | null;
  minimum_billing_calculated_at: string | null;
};

export type MeasurementOrderItemRow = {
  id: string;
  measurement_order_id: string;
  service_activity_id: string;
  programming_activity_id: string | null;
  project_activity_forecast_id: string | null;
  activity_code: string;
  activity_description: string;
  activity_unit: string;
  quantity: number | string;
  mva_quantity: number | string | null;
  worked_hours: number | string | null;
  voice_point: number | string;
  manual_rate: number | string;
  unit_value: number | string;
  total_value: number | string;
  observation: string | null;
  is_active: boolean;
  updated_at: string;
};

export type ServiceActivityIddRow = {
  id: string;
  code_idd: string | null;
};

export type MeasurementHistoryRow = {
  id: string;
  action_type: string;
  reason: string | null;
  changes: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
};

export type AppUserRow = {
  id: string;
  display: string | null;
  login_name: string | null;
};

export type MeasurementOrderAggregateItem = {
  measurement_order_id: string;
  total_value: number | string;
  quantity: number | string;
  voice_point: number | string;
};

export type ProgrammingMatchRow = {
  id: string;
  project_id: string;
  team_id: string;
  execution_date: string;
  status: string;
  work_completion_status: string | null;
  updated_at: string;
};

// `programming_history` (310) nao tem `project_id`/`from_execution_date`/
// `to_execution_date` como colunas proprias (diferente do legado
// `project_programming_history`) — so `programming_id` + `changes` (jsonb). A
// data/projeto do evento e sempre resolvida via `programmingProjectDateMap`
// (pelo `programming_id`), nunca por coluna propria da linha de historico.
export type ProgrammingWorkCompletionHistoryRow = {
  id: string;
  programming_id: string;
  changes: Record<string, unknown> | null;
  created_at: string;
};

export type MeasurementOrderActivityFilterRow = {
  measurement_order_id: string;
};

export type TeamCompositionContextRow = {
  project_id: string;
  team_id: string;
  composition_date: string;
};

export type ProjectTestRow = {
  id: string;
  is_test: boolean | null;
  is_third_party?: boolean | null;
};

export type ProjectServiceTypeProjectRow = {
  id: string;
};

export type TeamRow = {
  id: string;
  team_type_id: string | null;
};

export type TeamTypeRow = {
  id: string;
  name: string | null;
};

export type TeamTypeHistoryRow = {
  team_id: string;
  team_type_id: string | null;
  team_type_name_snapshot: string | null;
  valid_from: string;
  valid_to: string | null;
};

export type MeasurementScoreTargetRow = {
  team_type_id: string;
  target_points: number | string;
};

export type MeasurementTeamTypeTargetRow = {
  team_type_id: string;
  daily_value: number | string;
};

export type CycleWorkdaysRow = {
  id: string;
  cycle_start: string;
};

export type CycleTargetItemRow = {
  cycle_id: string;
  team_type_id: string;
  daily_value: number | string;
};

export type SaveMeasurementPayload = {
  action?: string;
  id?: string;
  programmingId?: string;
  projectId?: string;
  teamId?: string;
  executionDate?: string;
  measurementDate?: string;
  voicePoint?: string | number;
  manualRate?: string | number;
  measurementKind?: string;
  noProductionReasonId?: string;
  notes?: string;
  expectedUpdatedAt?: string;
  items?: Array<{
    activityId?: string;
    programmingActivityId?: string;
    projectActivityForecastId?: string;
    quantity?: string | number;
    mvaQuantity?: string | number;
    workedHours?: string | number;
    unitValue?: string | number;
    voicePoint?: string | number;
    manualRate?: string | number;
    observation?: string;
  }>;
};

export type SaveMeasurementBatchRowPayload = {
  rowNumbers?: number[];
  programmingId?: string;
  projectId?: string;
  teamId?: string;
  executionDate?: string;
  measurementDate?: string;
  voicePoint?: string | number;
  manualRate?: string | number;
  measurementKind?: string;
  noProductionReasonId?: string;
  notes?: string;
  items?: SaveMeasurementPayload["items"];
};

export type SaveMeasurementBatchPayload = {
  action?: "BATCH_IMPORT_PARTIAL";
  rows?: SaveMeasurementBatchRowPayload[];
};

export type UpdateStatusPayload = {
  id?: string;
  action?: "FECHAR" | "CANCELAR" | "ABRIR";
  reason?: string;
  expectedUpdatedAt?: string;
};

export type SaveMeasurementRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  measurement_order_id?: string;
  updated_at?: string;
};

export type SaveMeasurementBatchRpcItemResult = {
  rowIndex?: number;
  rowNumbers?: number[];
  success?: boolean;
  alreadyRegistered?: boolean;
  reason?: string | null;
  message?: string;
  measurementOrderId?: string;
};

export type SaveMeasurementBatchRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  savedCount?: number;
  errorCount?: number;
  alreadyRegisteredCount?: number;
  alreadyRegisteredRows?: number;
  results?: SaveMeasurementBatchRpcItemResult[];
};

export type SetMeasurementStatusRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  measurement_order_id?: string;
  updated_at?: string;
  measurement_status?: MeasurementOrderStatus;
};


export type SupabasePageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

