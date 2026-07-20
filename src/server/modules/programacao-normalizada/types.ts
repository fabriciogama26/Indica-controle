export type ProgrammingStatus = "PROGRAMADA" | "REPROGRAMADA" | "ADIADA" | "CANCELADA" | "ANTECIPADA";
export type ProgrammingTeamStatus = "ATIVA" | "REMOVIDA" | "TRANSFERIDA";
export type ProgrammingPeriod = "INTEGRAL" | "PARCIAL";
export type ProgrammingDocumentType = "SGD" | "PI" | "PEP";

export type ProjectRow = {
  id: string;
  sob: string;
  execution_deadline: string | null;
  city_text: string;
  service_center_text: string;
  service_type_text: string;
  priority_text: string;
  partner_text: string;
  utility_responsible_text: string;
  utility_field_manager_text: string;
  street: string;
  neighborhood: string;
  service_description: string;
};

export type TeamRow = {
  id: string;
  name: string;
  vehicle_plate: string | null;
  team_type_id: string;
  foreman_person_id: string;
  service_center_id: string | null;
  ativo: boolean;
};

export type TeamTypeRow = {
  id: string;
  name: string;
};

export type ServiceCenterRow = {
  id: string;
  name: string;
};

export type PersonRow = {
  id: string;
  nome: string;
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

export type ProgrammingWorkCompletionCatalogRow = {
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

export type ProgrammingSupportItemRow = {
  id: string;
  description: string;
  is_active: boolean;
};

export type ServiceActivityRow = {
  id: string;
  code: string;
  description: string;
  unit: string;
  ativo: boolean;
};

export type ProgrammingTeamRow = {
  id: string;
  team_id: string;
  status: ProgrammingTeamStatus;
  added_from_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ProgrammingActivityRow = {
  id: string;
  service_activity_id: string;
  quantity: number | string;
  is_active: boolean;
};

export type ProgrammingDocumentRow = {
  id: string;
  document_type: ProgrammingDocumentType;
  number: string | null;
  included_at: string | null;
  delivered_at: string | null;
};

export type ProgrammingStageRow = {
  id: string;
  project_id: string;
  execution_date: string;
  etapa_number: number | null;
  etapa_unica: boolean;
  etapa_final: boolean;
  status: ProgrammingStatus;
  work_completion_status: string | null;
  service_description: string | null;
  period: ProgrammingPeriod | null;
  start_time: string | null;
  end_time: string | null;
  expected_minutes: number | null;
  outage_start_time: string | null;
  outage_end_time: string | null;
  feeder: string | null;
  campo_eletrico: string | null;
  affected_customers: number | null;
  sgd_type_id: string | null;
  electrical_eq_catalog_id: string | null;
  support: string | null;
  support_item_id: string | null;
  poste_qty: number | string | null;
  estrutura_qty: number | string | null;
  trafo_qty: number | string | null;
  rede_qty: number | string | null;
  note: string | null;
  resolve_pendencia_de_id: string | null;
  copied_from_id: string | null;
  copy_batch_id: string | null;
  anticipated_by_id: string | null;
  anticipated_at: string | null;
  previous_work_completion_status: string | null;
  previous_operational_status: string | null;
  cancellation_reason: string | null;
  canceled_at: string | null;
  canceled_by: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  programming_team: ProgrammingTeamRow[] | null;
  programming_activity: ProgrammingActivityRow[] | null;
  programming_document: ProgrammingDocumentRow[] | null;
};

export type ProgrammingStageListStatusChip = "TODAS" | "PROGRAMADAS" | "PENDENCIAS" | "ATRASADAS" | "ADIADAS";

export type ProgrammingStageListFilters = {
  tenantId: string;
  dateFrom: string;
  dateTo: string;
  statusChip: ProgrammingStageListStatusChip;
  teamIds: string[];
  search: string;
  municipality: string;
  page: number;
  pageSize: number;
};

export type ProgrammingHistoryRow = {
  id: string;
  programming_id: string;
  programming_team_id: string | null;
  action_type: string;
  reason: string | null;
  changes: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
};

export type AppUserLookupRow = {
  id: string;
  display: string | null;
  login_name: string | null;
};

export type SaveProgrammingStagePayload = {
  programmingId?: string;
  projectId?: string;
  executionDate?: string;
  teamIds?: string[];
  expectedUpdatedAt?: string;
  serviceDescription?: string;
  period?: string;
  startTime?: string;
  endTime?: string;
  expectedMinutes?: number | string;
  outageStartTime?: string;
  outageEndTime?: string;
  feeder?: string;
  campoEletrico?: string;
  affectedCustomers?: number | string;
  sgdTypeId?: string;
  electricalEqCatalogId?: string;
  support?: string;
  supportItemId?: string;
  posteQty?: number | string;
  estruturaQty?: number | string;
  trafoQty?: number | string;
  redeQty?: number | string;
  note?: string;
  historyReason?: string;
  activities?: Array<{ catalogId?: string; quantity?: number | string }>;
  documents?: Partial<Record<Lowercase<ProgrammingDocumentType>, {
    number?: string;
    includedAt?: string;
    deliveredAt?: string;
  }>>;
};

export type AddTeamPayload = {
  programmingId?: string;
  teamId?: string;
};

export type RemoveTeamPayload = {
  programmingTeamId?: string;
  expectedUpdatedAt?: string;
};

export type PostponeStagePayload = {
  programmingId?: string;
  newExecutionDate?: string;
  reason?: string;
  expectedUpdatedAt?: string;
};

export type CancelStagePayload = {
  programmingId?: string;
  reason?: string;
  expectedUpdatedAt?: string;
};

export type CompleteStagePayload = {
  programmingId?: string;
  expectedUpdatedAt?: string;
};

export type ReopenStagePayload = {
  programmingId?: string;
  expectedUpdatedAt?: string;
};

export type SetWorkCompletionStatusPayload = {
  programmingId?: string;
  workCompletionStatus?: string | null;
  expectedUpdatedAt?: string;
};

export type ProgrammingRpcResult = {
  success?: boolean;
  status?: number;
  reason?: string | null;
  message?: string;
  detail?: string | null;
  currentUpdatedAt?: string | null;
  action?: "INSERT" | "UPDATE";
  programming_id?: string;
  new_programming_id?: string;
  programming_team_id?: string;
  updated_at?: string;
  anticipated_count?: number;
  restored_count?: number;
};
