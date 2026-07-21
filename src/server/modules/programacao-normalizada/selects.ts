// Select com embedding PostgREST (via FK): uma query traz a etapa + as 3 filhas,
// sem join manual no Node (guia_backend regra 24/27 — filtro e agregacao no banco).
export const PROGRAMMING_STAGE_SELECT_WITH_CHILDREN = `
  id, project_id, execution_date, etapa_number, etapa_unica, etapa_final, status, work_completion_status, is_pendencia,
  service_description, period, start_time, end_time, expected_minutes, outage_start_time, outage_end_time,
  feeder, campo_eletrico, affected_customers, sgd_type_id, electrical_eq_catalog_id, support, support_item_id,
  poste_qty, estrutura_qty, trafo_qty, rede_qty, note,
  resolve_pendencia_de_id, copied_from_id, copy_batch_id, anticipated_by_id, anticipated_at,
  previous_work_completion_status, previous_operational_status, cancellation_reason, canceled_at, canceled_by,
  created_by, updated_by, created_at, updated_at,
  programming_team ( id, team_id, status, added_from_id, created_at, updated_at ),
  programming_activity ( id, service_activity_id, quantity, is_active ),
  programming_document ( id, document_type, number, included_at, delivered_at )
`;
