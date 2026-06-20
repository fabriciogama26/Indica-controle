-- Migration 235: índices de performance para queries de alto volume
--
-- Problema 1: dashboard-medicao faz SELECT em project_measurement_orders filtrando por
--   tenant_id + measurement_kind + is_active + status sem filtro de data.
--   Nenhum índice existente cobre measurement_kind + is_active juntos.
--   Sem este índice o banco faz scan em todas as ordens do tenant.
--
-- Problema 2: tela de Estornos filtra stock_transfer_item_reversals por created_at,
--   mas só existem índices compostos com original_transfer_id ou reversal_reason_code.
--   Sem índice direto em (tenant_id, created_at) o filtro de data não é aproveitado.

create index if not exists idx_project_measurement_orders_tenant_kind_active_status
  on public.project_measurement_orders (tenant_id, measurement_kind, is_active, status);

create index if not exists idx_stock_transfer_item_reversals_tenant_created_at
  on public.stock_transfer_item_reversals (tenant_id, created_at desc);
