-- 334_dashboard_portfolio_goal_coverage_rpc.sql
-- Consolida a cobertura da meta pela carteira operacional.

create or replace function public.dashboard_portfolio_goal_coverage(
  p_tenant_id uuid,
  p_cycle_start date,
  p_produced_value numeric default 0,
  p_remaining_potential numeric default 0,
  p_reference_date date default current_date
)
returns table (
  cycle_start date,
  cycle_end date,
  cycle_goal numeric,
  daily_goal numeric,
  produced_value numeric,
  remaining_cycle_goal numeric,
  remaining_potential numeric,
  coverage_percentage numeric,
  autonomy_business_days numeric,
  depletion_date date,
  status text
)
language plpgsql
stable
set search_path = public
as $$
declare
  v_cycle_id uuid;
  v_cycle_end date;
  v_cycle_goal numeric := 0;
  v_daily_goal numeric := 0;
  v_days_needed integer := 0;
  v_days_counted integer := 0;
  v_cursor date;
begin
  select
    mcw.id,
    mcw.cycle_end
  into
    v_cycle_id,
    v_cycle_end
  from public.measurement_cycle_workdays mcw
  where mcw.tenant_id = p_tenant_id
    and mcw.cycle_start = p_cycle_start
  limit 1;

  if v_cycle_id is not null then
    select
      coalesce(sum(mcti.cycle_goal), 0),
      coalesce(sum(mcti.daily_goal), 0)
    into
      v_cycle_goal,
      v_daily_goal
    from public.measurement_cycle_target_items mcti
    where mcti.tenant_id = p_tenant_id
      and mcti.cycle_id = v_cycle_id;
  end if;

  cycle_start := p_cycle_start;
  cycle_end := v_cycle_end;
  cycle_goal := coalesce(v_cycle_goal, 0);
  daily_goal := coalesce(v_daily_goal, 0);
  produced_value := greatest(coalesce(p_produced_value, 0), 0);
  remaining_potential := greatest(coalesce(p_remaining_potential, 0), 0);
  remaining_cycle_goal := greatest(cycle_goal - produced_value, 0);

  if v_cycle_id is null or cycle_goal <= 0 or daily_goal <= 0 then
    coverage_percentage := 0;
    autonomy_business_days := 0;
    depletion_date := null;
    status := 'SEM_META';
    return next;
    return;
  end if;

  coverage_percentage := case
    when remaining_cycle_goal <= 0 then 100
    else (remaining_potential / remaining_cycle_goal) * 100
  end;
  autonomy_business_days := remaining_potential / daily_goal;

  if remaining_potential <= 0 then
    depletion_date := p_reference_date;
  else
    v_days_needed := greatest(1, ceiling(autonomy_business_days)::integer);
    v_cursor := coalesce(p_reference_date, p_cycle_start, current_date);

    while v_days_counted < v_days_needed loop
      if extract(isodow from v_cursor) between 1 and 5 then
        v_days_counted := v_days_counted + 1;
      end if;

      if v_days_counted < v_days_needed then
        v_cursor := v_cursor + 1;
      end if;
    end loop;

    depletion_date := v_cursor;
  end if;

  status := case
    when coverage_percentage >= 120 then 'SAUDAVEL'
    when coverage_percentage >= 80 then 'ATENCAO'
    else 'RISCO'
  end;

  return next;
end;
$$;

revoke all on function public.dashboard_portfolio_goal_coverage(uuid, date, numeric, numeric, date) from public;
revoke all on function public.dashboard_portfolio_goal_coverage(uuid, date, numeric, numeric, date) from anon;
grant execute on function public.dashboard_portfolio_goal_coverage(uuid, date, numeric, numeric, date) to authenticated;
grant execute on function public.dashboard_portfolio_goal_coverage(uuid, date, numeric, numeric, date) to service_role;
