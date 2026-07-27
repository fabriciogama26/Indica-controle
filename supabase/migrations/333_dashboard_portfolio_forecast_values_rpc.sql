-- 333_dashboard_portfolio_forecast_values_rpc.sql
-- Consolida o valor previsto da carteira operacional por projeto.

create or replace function public.dashboard_portfolio_forecast_values(
  p_tenant_id uuid
)
returns table (
  project_id uuid,
  total_forecast_value numeric
)
language sql
stable
set search_path = public
as $$
  select
    paf.project_id,
    coalesce(
      sum(
        coalesce(nullif(sa.voice_point, 0), 1)
        * paf.qty_planned
        * coalesce(sa.unit_value, 0)
        * 1
      ),
      0
    )::numeric as total_forecast_value
  from public.project_activity_forecast paf
  join public.service_activities sa
    on sa.id = paf.service_activity_id
   and sa.tenant_id = paf.tenant_id
  where paf.tenant_id = p_tenant_id
  group by paf.project_id;
$$;

revoke all on function public.dashboard_portfolio_forecast_values(uuid) from public;
revoke all on function public.dashboard_portfolio_forecast_values(uuid) from anon;
grant execute on function public.dashboard_portfolio_forecast_values(uuid) to authenticated;
grant execute on function public.dashboard_portfolio_forecast_values(uuid) to service_role;
