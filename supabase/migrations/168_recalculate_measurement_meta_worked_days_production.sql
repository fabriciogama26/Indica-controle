-- 168_recalculate_measurement_meta_worked_days_production.sql
-- Recalcula dias trabalhados da Meta usando somente medicoes Com producao.

drop table if exists pg_temp.measurement_meta_cycle_average;

create temporary table measurement_meta_cycle_average on commit drop as
with valid_orders as (
  select
    mo.tenant_id,
    case
      when extract(day from mo.execution_date)::integer >= 21 then
        make_date(extract(year from mo.execution_date)::integer, extract(month from mo.execution_date)::integer, 21)
      else
        (date_trunc('month', mo.execution_date)::date - interval '1 month' + interval '20 days')::date
    end as cycle_start,
    mo.team_id,
    mo.execution_date::date as execution_date
  from public.project_measurement_orders mo
  left join public.project p
    on p.tenant_id = mo.tenant_id
   and p.id = mo.project_id
  where mo.is_active = true
    and coalesce(mo.measurement_kind, 'COM_PRODUCAO') = 'COM_PRODUCAO'
    and coalesce(mo.status, '') <> 'CANCELADA'
    and mo.team_id is not null
    and p.is_test is distinct from true
),
team_days as (
  select
    tenant_id,
    cycle_start,
    team_id,
    count(distinct execution_date)::numeric as worked_days
  from valid_orders
  group by tenant_id, cycle_start, team_id
),
cycle_average as (
  select
    tenant_id,
    cycle_start,
    round(avg(worked_days), 0) as worked_days
  from team_days
  group by tenant_id, cycle_start
)
select
  tenant_id,
  cycle_start,
  worked_days
from cycle_average;

update public.measurement_cycle_workdays cycles
set worked_days = coalesce(averages.worked_days, 0)
from pg_temp.measurement_meta_cycle_average averages
where averages.tenant_id = cycles.tenant_id
  and averages.cycle_start = cycles.cycle_start;

update public.measurement_cycle_workdays cycles
set worked_days = 0
where not exists (
  select 1
  from pg_temp.measurement_meta_cycle_average averages
  where averages.tenant_id = cycles.tenant_id
    and averages.cycle_start = cycles.cycle_start
);

update public.measurement_cycle_target_items items
set worked_cycle_goal = round(
  items.daily_value
  * coalesce(items.measured_team_count, items.active_team_count, 0)
  * coalesce(cycles.worked_days, 0),
  2
)
from public.measurement_cycle_workdays cycles
where cycles.id = items.cycle_id;
