-- 162_backfill_measurement_foreman_snapshots.sql
-- Corrige vigencias iniciais e recalcula snapshots historicos da Medicao.

with first_foreman_event as (
  select distinct on (h.tenant_id, h.entity_id)
    h.tenant_id,
    h.entity_id as team_id,
    h.created_at::date as change_date,
    nullif(btrim(h.changes #>> '{foremanName,from}'), '') as from_name
  from public.app_entity_history h
  where h.module_key = 'equipes'
    and h.entity_table = 'teams'
    and h.changes ? 'foremanName'
  order by h.tenant_id, h.entity_id, h.created_at asc, h.id asc
),
source_period as (
  select
    h.id,
    h.tenant_id,
    h.team_id,
    h.foreman_person_id,
    h.foreman_name_snapshot,
    h.valid_to
  from public.team_foreman_history h
  join first_foreman_event e
    on e.tenant_id = h.tenant_id
   and e.team_id = h.team_id
   and h.valid_to = e.change_date - 1
   and h.foreman_name_snapshot = e.from_name
  where h.valid_from > date '1900-01-01'
),
merged_initial_period as (
  update public.team_foreman_history target
  set
    foreman_person_id = coalesce(source_period.foreman_person_id, target.foreman_person_id),
    foreman_name_snapshot = source_period.foreman_name_snapshot,
    valid_to = source_period.valid_to,
    updated_at = now()
  from source_period
  where target.tenant_id = source_period.tenant_id
    and target.team_id = source_period.team_id
    and target.valid_from = date '1900-01-01'
  returning source_period.id
),
deleted_merged_source as (
  delete from public.team_foreman_history h
  using merged_initial_period m
  where h.id = m.id
  returning h.id
)
update public.team_foreman_history h
set
  valid_from = date '1900-01-01',
  updated_at = now()
from source_period s
where h.id = s.id
  and not exists (
    select 1
    from deleted_merged_source d
    where d.id = s.id
  );

create or replace function public.apply_measurement_team_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snapshot record;
begin
  if tg_op = 'UPDATE'
    and new.team_id is not distinct from old.team_id
    and new.execution_date is not distinct from old.execution_date
    and coalesce(current_setting('app.allow_measurement_snapshot_rewrite', true), '') <> 'on'
  then
    new.team_name_snapshot := coalesce(nullif(btrim(coalesce(old.team_name_snapshot, '')), ''), new.team_name_snapshot);
    new.foreman_name_snapshot := coalesce(nullif(btrim(coalesce(old.foreman_name_snapshot, '')), ''), new.foreman_name_snapshot);
    return new;
  end if;

  select *
  into v_snapshot
  from public.resolve_team_foreman_snapshot(new.tenant_id, new.team_id, new.execution_date);

  if v_snapshot.team_name is not null then
    new.team_name_snapshot := v_snapshot.team_name;
  end if;

  if v_snapshot.foreman_name is not null then
    new.foreman_name_snapshot := v_snapshot.foreman_name;
  end if;

  return new;
end;
$$;

select set_config('app.allow_measurement_snapshot_rewrite', 'on', false);

with resolved_orders as (
  select
    mo.id,
    mo.tenant_id,
    resolved.team_name,
    resolved.foreman_name
  from public.project_measurement_orders mo
  cross join lateral public.resolve_team_foreman_snapshot(mo.tenant_id, mo.team_id, mo.execution_date) resolved
  where mo.team_id is not null
    and mo.execution_date is not null
    and (
      mo.team_name_snapshot is distinct from resolved.team_name
      or mo.foreman_name_snapshot is distinct from resolved.foreman_name
    )
)
update public.project_measurement_orders mo
set
  team_name_snapshot = r.team_name,
  foreman_name_snapshot = r.foreman_name
from resolved_orders r
where mo.tenant_id = r.tenant_id
  and mo.id = r.id;

select set_config('app.allow_measurement_snapshot_rewrite', '', false);

revoke all on function public.apply_measurement_team_snapshot() from public;
