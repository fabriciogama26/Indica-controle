export type BoardProjectRow = {
  id: string;
  sob: string;
  execution_deadline: string | null;
  service_center_text: string | null;
  service_type_text: string | null;
  city_text: string | null;
  priority_text: string | null;
  partner_text: string | null;
  utility_responsible_text: string | null;
  utility_field_manager_text: string | null;
  street: string | null;
  neighborhood: string | null;
  service_description: string | null;
  observation: string | null;
  has_locacao: boolean | null;
  is_active: boolean;
  is_test: boolean;
};

export type BoardProjectBaseRow = Omit<BoardProjectRow, "is_test"> & {
  is_test?: boolean | null;
};

export type TeamRow = {
  id: string;
  name: string;
  vehicle_plate: string | null;
  service_center_id: string | null;
  team_type_id: string;
  foreman_person_id: string;
  ativo: boolean;
};

export type TeamTypeRow = {
  id: string;
  name: string;
};

export type PersonRow = {
  id: string;
  nome: string;
};

export type ServiceCenterRow = {
  id: string;
  name: string;
};

export type SupportOptionRow = {
  id: string;
  description: string;
  location_support_item_id: string | null;
  is_active: boolean;
};

export type ProgrammingSgdTypeRow = {
  id: string;
  description: string;
  export_column: string;
  is_active: boolean;
};

export type ProgrammingEqCatalogRow = {
  id: string;
  code: string;
  label_pt: string;
  is_active: boolean;
  sort_order: number;
};

export type ProgrammingReasonCatalogRow = {
  code: string;
  label_pt: string;
  requires_notes: boolean;
  is_active: boolean;
  sort_order: number;
};

export type ProgrammingWorkCompletionCatalogRow = {
  id: string;
  code: string;
  label_pt: string;
  is_active: boolean;
  sort_order: number;
};

export type LocationPlanSupportRow = {
  project_id: string;
  questionnaire_answers: Record<string, unknown> | null;
};

export type TeamWeekSummaryRow = {
  team_id: string;
  week_start: string;
  week_end: string;
  worked_days: number | string;
  capacity_days: number | string;
  free_days: number | string;
  load_percent: number | string;
  load_status: "FREE" | "NORMAL" | "WARNING" | "OVERLOAD";
};

export type ProgrammingRow = {
  id: string;
  project_id: string;
  team_id: string;
  status: "PROGRAMADA" | "REPROGRAMADA" | "ADIADA" | "CANCELADA";
  execution_date: string;
  programming_group_id: string;
  period: "INTEGRAL" | "PARCIAL";
  start_time: string;
  end_time: string;
  expected_minutes: number;
  outage_start_time: string | null;
  outage_end_time: string | null;
  feeder: string | null;
  support: string | null;
  support_item_id: string | null;
  note: string | null;
  campo_eletrico: string | null;
  service_description: string | null;
  poste_qty: number | null;
  estrutura_qty: number | null;
  trafo_qty: number | null;
  rede_qty: number | null;
  etapa_number: number | null;
  etapa_unica: boolean | null;
  etapa_final: boolean | null;
  work_completion_status: string | null;
  anticipated_by_programming_id: string | null;
  anticipated_at: string | null;
  previous_work_completion_status: string | null;
  affected_customers: number | null;
  sgd_type_id: string | null;
  electrical_eq_catalog_id: string | null;
  sgd_number: string | null;
  sgd_included_at: string | null;
  sgd_delivered_at: string | null;
  pi_number: string | null;
  pi_included_at: string | null;
  pi_delivered_at: string | null;
  pep_number: string | null;
  pep_included_at: string | null;
  pep_delivered_at: string | null;
  cancellation_reason: string | null;
  canceled_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AppUserLookupRow = {
  id: string;
  display: string | null;
  login_name: string | null;
};

export type ProgrammingActivityRow = {
  id: string;
  programming_id: string;
  service_activity_id: string;
  activity_code: string;
  activity_description: string;
  activity_unit: string;
  quantity: number | string;
  is_active: boolean;
};

export type ProgrammingHistoryRow = {
  id: string;
  entity_id: string;
  created_by: string | null;
  changed_by_name: string;
  reason: string | null;
  changes: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type ProgrammingOperationalHistoryRow = {
  id: string;
  programming_id: string;
  related_programming_id: string | null;
  created_by: string | null;
  action_type: string;
  reason: string | null;
  changes: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type SaveProgrammingPayload = {
  id?: string;
  projectId?: string;
  teamId?: string;
  date?: string;
  period?: string;
  startTime?: string;
  endTime?: string;
  expectedMinutes?: number | string;
  outageStartTime?: string;
  outageEndTime?: string;
  feeder?: string;
  support?: string;
  supportItemId?: string;
  note?: string;
  electricalField?: string;
  serviceDescription?: string;
  posteQty?: number | string;
  estruturaQty?: number | string;
  trafoQty?: number | string;
  redeQty?: number | string;
  etapaNumber?: number | string;
  etapaUnica?: boolean;
  etapaFinal?: boolean;
  workCompletionStatus?: string;
  affectedCustomers?: number | string;
  sgdTypeId?: string;
  electricalEqCatalogId?: string;
  changeReason?: string;
  expectedUpdatedAt?: string;
  activitiesLoaded?: boolean;
  documents?: {
    sgd?: { number?: string; approvedAt?: string; requestedAt?: string; includedAt?: string; deliveredAt?: string };
    pi?: { number?: string; approvedAt?: string; requestedAt?: string; includedAt?: string; deliveredAt?: string };
    pep?: { number?: string; approvedAt?: string; requestedAt?: string; includedAt?: string; deliveredAt?: string };
  };
  activities?: Array<{
    catalogId?: string;
    quantity?: number | string;
  }>;
};

export type CopyProgrammingPayload = {
  action?: "COPY";
  sourceTeamId?: string;
  targetTeamIds?: string[];
  startDate?: string;
  endDate?: string;
};

export type CopyProgrammingToDatesPayload = {
  action?: "COPY_TO_DATES";
  sourceProgrammingId?: string;
  expectedUpdatedAt?: string;
  copyScope?: "single" | "group";
  targets?: Array<{
    date?: string;
    etapaNumber?: number | string;
    teamIds?: string[];
  }>;
};

export type AddTeamToProgrammingPayload = {
  action?: "ADD_TEAM";
  sourceProgrammingId?: string;
  targetTeamId?: string;
  expectedUpdatedAt?: string;
};

export type BatchCreateProgrammingPayload = {
  action?: "BATCH_CREATE";
  projectId?: string;
  teamIds?: string[];
  date?: string;
  period?: string;
  startTime?: string;
  endTime?: string;
  expectedMinutes?: number | string;
  outageStartTime?: string;
  outageEndTime?: string;
  feeder?: string;
  support?: string;
  supportItemId?: string;
  note?: string;
  electricalField?: string;
  serviceDescription?: string;
  posteQty?: number | string;
  estruturaQty?: number | string;
  trafoQty?: number | string;
  redeQty?: number | string;
  etapaNumber?: number | string;
  etapaUnica?: boolean;
  etapaFinal?: boolean;
  workCompletionStatus?: string;
  affectedCustomers?: number | string;
  sgdTypeId?: string;
  electricalEqCatalogId?: string;
  documents?: {
    sgd?: { number?: string; approvedAt?: string; requestedAt?: string; includedAt?: string; deliveredAt?: string };
    pi?: { number?: string; approvedAt?: string; requestedAt?: string; includedAt?: string; deliveredAt?: string };
    pep?: { number?: string; approvedAt?: string; requestedAt?: string; includedAt?: string; deliveredAt?: string };
  };
  activities?: Array<{
    catalogId?: string;
    quantity?: number | string;
  }>;
};

export type CancelProgrammingPayload = {
  id?: string;
  action?: string;
  reason?: string;
  newDate?: string;
  scope?: "individual" | "group";
  expectedUpdatedAt?: string;
  workCompletionStatus?: string;
};

export type SaveProgrammingRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  detail?: string;
  action?: "INSERT" | "UPDATE";
  programming_id?: string;
  project_code?: string;
  updated_at?: string;
};

export type ProgrammingConflictRecord = {
  id: string;
  projectId: string;
  teamId: string;
  status: string;
  executionDate: string;
  startTime: string;
  endTime: string;
  updatedAt: string;
};

export type ProgrammingConflictPayload = {
  error: "conflict";
  message: string;
  currentRecord: ProgrammingConflictRecord | null;
  currentUpdatedAt: string | null;
  updatedBy: string | null;
  changedFields: string[];
};

export type CopyProgrammingResponse = {
  success?: boolean;
  copiedCount?: number;
  message?: string;
};

export type CopyProgrammingToDatesResponse = {
  success?: boolean;
  copiedCount?: number;
  copyBatchId?: string | null;
  copyBatchIds?: string[];
  sourceCount?: number;
  message?: string;
  reason?: string | null;
  detail?: string | null;
  enteredEtapaNumber?: number;
  hasConflict?: boolean;
  highestStage?: number;
  teams?: ProgrammingStageValidationTeamSummary[];
};

export type CopyProgrammingToDatesRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string | null;
  detail?: string | null;
  message?: string;
  copied_count?: number;
  copy_batch_id?: string | null;
  copied_programming_ids?: string[];
  source_count?: number;
  enteredEtapaNumber?: number;
  hasConflict?: boolean;
  highestStage?: number;
  teams?: ProgrammingStageValidationTeamSummary[];
};

export type AddTeamToProgrammingResponse = {
  success?: boolean;
  id?: string;
  addedCount?: number;
  message?: string;
  reason?: string | null;
  detail?: string | null;
  enteredEtapaNumber?: number;
  hasConflict?: boolean;
  highestStage?: number;
  teams?: ProgrammingStageValidationTeamSummary[];
};

export type BatchCreateProgrammingResponse = {
  success?: boolean;
  insertedCount?: number;
  message?: string;
  warning?: string | null;
  enteredEtapaNumber?: number;
  hasConflict?: boolean;
  highestStage?: number;
  teams?: ProgrammingStageValidationTeamSummary[];
};

export type BatchProgrammingRpcItem = {
  teamId?: string;
  programmingId?: string;
};

export type BatchProgrammingRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  detail?: string;
  project_code?: string;
  inserted_count?: number;
  items?: BatchProgrammingRpcItem[];
};

export type WorkCompletionStatusRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  detail?: string;
  skipped?: boolean;
  programming_id?: string;
  updated_at?: string;
  work_completion_status?: string;
  currentRecord?: ProgrammingConflictRecord & {
    workCompletionStatus?: string | null;
  };
  currentUpdatedAt?: string;
  updatedBy?: string | null;
  changedFields?: string[];
};

export type ProgrammingHistoryListResponse = {
  history: Array<{
    id: string;
    changedAt: string;
    reason: string;
    action: string;
    changes: Record<string, unknown>;
    metadata: Record<string, unknown>;
  }>;
};

export type ProgrammingStageValidationTeamSummary = {
  teamId: string;
  teamName: string;
  highestStage: number;
  existingStages: number[];
  existingDates: string[];
};

export type ProgrammingStageValidationResponse = {
  enteredEtapaNumber: number;
  hasConflict: boolean;
  highestStage: number;
  teams: ProgrammingStageValidationTeamSummary[];
  message: string;
};

export type CancelProgrammingRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  detail?: string;
  programming_id?: string;
  project_code?: string;
  updated_at?: string;
  programming_status?: "ADIADA" | "CANCELADA";
};

export type CancelProgrammingGroupRpcResult = CancelProgrammingRpcResult & {
  affected_count?: number;
  cancelled_programming_ids?: string[];
};

export type PostponeProgrammingRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string;
  message?: string;
  detail?: string;
  programming_id?: string;
  new_programming_id?: string;
  project_code?: string;
  updated_at?: string;
};

export type PostponeProgrammingGroupRpcResult = PostponeProgrammingRpcResult & {
  affected_count?: number;
  updated_programming_ids?: string[];
  new_programming_ids?: string[];
};

export type ProgrammingTimeConflictLookupRow = {
  id: string;
  team_id: string;
  project_id: string;
  start_time: string;
  end_time: string;
};

export type TeamConflictLookupRow = {
  id: string;
  name: string | null;
  foreman_person_id: string | null;
};

export type ForemanConflictLookupRow = {
  id: string;
  nome: string | null;
};

export type ProjectConcludedProgrammingContext = {
  programmingId: string;
  executionDate: string;
  teamId: string;
  teamName: string;
  foremanName: string;
  workCompletionStatus: string;
  updatedAt: string;
};

export type ProjectConflictLookupRow = {
  id: string;
  sob: string | null;
};
