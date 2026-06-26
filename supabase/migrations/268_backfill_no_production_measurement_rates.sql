-- 268_backfill_no_production_measurement_rates.sql
-- Corrige ordens SEM_PRODUCAO antigas que ficaram com taxa tecnica 1.
-- A taxa aplicada passa a seguir a ultima medicao COM_PRODUCAO valida do mesmo projeto/tenant.

do $$
declare
  v_updated_count integer := 0;
begin
  with candidate_rates as (
    select
      target.id,
      target.tenant_id,
      target.manual_rate as previous_manual_rate,
      source.manual_rate as next_manual_rate
    from public.project_measurement_orders target
    join lateral (
      select source_order.manual_rate
      from public.project_measurement_orders source_order
      where source_order.tenant_id = target.tenant_id
        and source_order.project_id = target.project_id
        and source_order.measurement_kind = 'COM_PRODUCAO'
        and source_order.status <> 'CANCELADA'
        and source_order.manual_rate > 0
      order by source_order.measurement_date desc, source_order.updated_at desc
      limit 1
    ) source on true
    where target.measurement_kind = 'SEM_PRODUCAO'
      and target.status <> 'CANCELADA'
      and target.manual_rate = 1
      and source.manual_rate <> target.manual_rate
  ),
  updated_orders as (
    update public.project_measurement_orders target
    set manual_rate = candidate_rates.next_manual_rate
    from candidate_rates
    where target.id = candidate_rates.id
      and target.tenant_id = candidate_rates.tenant_id
    returning
      target.id,
      target.tenant_id,
      candidate_rates.previous_manual_rate,
      candidate_rates.next_manual_rate
  )
  insert into public.project_measurement_order_history (
    tenant_id,
    measurement_order_id,
    action_type,
    reason,
    changes,
    metadata,
    created_by
  )
  select
    tenant_id,
    id,
    'UPDATE',
    'Backfill de taxa em medicao sem producao',
    jsonb_build_object(
      'manualRate',
      jsonb_build_object(
        'from', previous_manual_rate::text,
        'to', next_manual_rate::text
      )
    ),
    jsonb_build_object(
      'source', 'migration-268',
      'rule', 'latest-com-producao-rate-by-tenant-project'
    ),
    null
  from updated_orders;

  get diagnostics v_updated_count = row_count;
  raise notice '268_backfill_no_production_measurement_rates: % ordens SEM_PRODUCAO atualizadas.', v_updated_count;
end $$;
