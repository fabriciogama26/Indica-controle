-- 291_warehouse_address_history_action_index.sql
-- Substitui o indice de warehouse_address_history por um composto que inclui action_type,
-- necessario porque a consulta paginada de historico da Configuracao do Mapa filtra por
-- action_type = 'CONFIG_SAVE' e o volume de ADDRESS_ASSIGN/ADDRESS_CLEAR tende a crescer
-- muito mais rapido que CONFIG_SAVE por mapa.

drop index if exists public.idx_warehouse_address_history_tenant_map_created;

create index if not exists idx_warehouse_address_history_tenant_map_action_created
  on public.warehouse_address_history (tenant_id, map_id, action_type, created_at desc);
