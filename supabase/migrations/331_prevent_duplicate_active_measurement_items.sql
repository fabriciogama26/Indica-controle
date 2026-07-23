-- 331_prevent_duplicate_active_measurement_items.sql
-- Garante que uma ordem de Medicao tenha no maximo um item ativo por atividade.

with ranked_items as (
  select
    id,
    row_number() over (
      partition by tenant_id, measurement_order_id, service_activity_id
      order by updated_at desc, created_at desc, id desc
    ) as duplicate_rank
  from public.project_measurement_order_items
  where is_active = true
)
update public.project_measurement_order_items item
set is_active = false
from ranked_items ranked
where item.id = ranked.id
  and ranked.duplicate_rank > 1;

create unique index if not exists idx_project_measurement_order_items_unique_active_activity
  on public.project_measurement_order_items (tenant_id, measurement_order_id, service_activity_id)
  where is_active = true;
