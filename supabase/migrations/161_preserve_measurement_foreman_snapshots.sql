-- 161_preserve_measurement_foreman_snapshots.sql
-- Mantem historico efetivo de encarregado por equipe e preserva snapshot historico na Medicao.

create table if not exists public.team_foreman_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  team_id uuid not null references public.teams(id) on delete cascade,
  foreman_person_id uuid null references public.people(id),
  foreman_name_snapshot text not null,
  valid_from date not null,
  valid_to date null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null references public.app_users(id),
  updated_by uuid null references public.app_users(id),
  constraint team_foreman_history_name_not_blank check (btrim(foreman_name_snapshot) <> ''),
  constraint team_foreman_history_valid_period_check check (valid_to is null or valid_to >= valid_from)
);

alter table if exists public.team_foreman_history
  add column if not exists created_by uuid null references public.app_users(id),
  add column if not exists updated_by uuid null references public.app_users(id);

create unique index if not exists team_foreman_history_tenant_team_valid_from_key
  on public.team_foreman_history (tenant_id, team_id, valid_from);

create index if not exists idx_team_foreman_history_tenant_team_period
  on public.team_foreman_history (tenant_id, team_id, valid_from desc, valid_to);

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'team_foreman_history'
      and tc.constraint_name = 'team_foreman_history_tenant_id_fk'
  ) then
    alter table public.team_foreman_history
      add constraint team_foreman_history_tenant_id_fk
      foreign key (tenant_id)
      references public.tenants(id)
      on delete cascade;
  end if;
end;
$$;

alter table public.team_foreman_history enable row level security;

drop policy if exists team_foreman_history_tenant_select on public.team_foreman_history;
create policy team_foreman_history_tenant_select on public.team_foreman_history
for select
to authenticated
using (public.user_can_access_tenant(team_foreman_history.tenant_id));

drop policy if exists team_foreman_history_tenant_insert on public.team_foreman_history;
create policy team_foreman_history_tenant_insert on public.team_foreman_history
for insert
to authenticated
with check (public.user_can_access_tenant(team_foreman_history.tenant_id));

drop policy if exists team_foreman_history_tenant_update on public.team_foreman_history;
create policy team_foreman_history_tenant_update on public.team_foreman_history
for update
to authenticated
using (public.user_can_access_tenant(team_foreman_history.tenant_id))
with check (public.user_can_access_tenant(team_foreman_history.tenant_id));

drop trigger if exists trg_team_foreman_history_audit on public.team_foreman_history;
create trigger trg_team_foreman_history_audit before insert or update on public.team_foreman_history
for each row execute function public.apply_audit_fields();

with foreman_events as (
  select
    h.tenant_id,
    h.entity_id as team_id,
    h.created_at::date as change_date,
    nullif(btrim(h.changes #>> '{foremanName,from}'), '') as from_name,
    nullif(btrim(h.changes #>> '{foremanName,to}'), '') as to_name,
    lag(h.created_at::date) over (
      partition by h.tenant_id, h.entity_id
      order by h.created_at asc, h.id asc
    ) as previous_change_date
  from public.app_entity_history h
  where h.module_key = 'equipes'
    and h.entity_table = 'teams'
    and h.changes ? 'foremanName'
),
previous_periods as (
  select
    e.tenant_id,
    e.team_id,
    null::uuid as foreman_person_id,
    e.from_name as foreman_name_snapshot,
    coalesce(e.previous_change_date, date '1900-01-01') as valid_from,
    (e.change_date - 1) as valid_to
  from foreman_events e
  join public.teams t
    on t.tenant_id = e.tenant_id
   and t.id = e.team_id
  where e.from_name is not null
),
valid_previous_periods as (
  select *
  from previous_periods
  where valid_from <= valid_to
)
insert into public.team_foreman_history (
  tenant_id,
  team_id,
  foreman_person_id,
  foreman_name_snapshot,
  valid_from,
  valid_to
)
select
  tenant_id,
  team_id,
  foreman_person_id,
  foreman_name_snapshot,
  valid_from,
  valid_to
from valid_previous_periods
on conflict (tenant_id, team_id, valid_from) do update
set
  foreman_person_id = excluded.foreman_person_id,
  foreman_name_snapshot = excluded.foreman_name_snapshot,
  valid_to = excluded.valid_to,
  updated_at = now();

with latest_foreman_event as (
  select distinct on (h.tenant_id, h.entity_id)
    h.tenant_id,
    h.entity_id as team_id,
    h.created_at::date as change_date,
    nullif(btrim(h.changes #>> '{foremanName,to}'), '') as to_name
  from public.app_entity_history h
  where h.module_key = 'equipes'
    and h.entity_table = 'teams'
    and h.changes ? 'foremanName'
  order by h.tenant_id, h.entity_id, h.created_at desc, h.id desc
)
insert into public.team_foreman_history (
  tenant_id,
  team_id,
  foreman_person_id,
  foreman_name_snapshot,
  valid_from,
  valid_to
)
select
  t.tenant_id,
  t.id,
  t.foreman_person_id,
  coalesce(e.to_name, nullif(btrim(coalesce(p.nome, '')), ''), 'Nao identificado'),
  coalesce(e.change_date, t.created_at::date, current_date),
  null::date
from public.teams t
left join public.people p
  on p.id = t.foreman_person_id
 and p.tenant_id = t.tenant_id
left join latest_foreman_event e
  on e.tenant_id = t.tenant_id
 and e.team_id = t.id
where t.foreman_person_id is not null
on conflict (tenant_id, team_id, valid_from) do update
set
  foreman_person_id = excluded.foreman_person_id,
  foreman_name_snapshot = excluded.foreman_name_snapshot,
  valid_to = excluded.valid_to,
  updated_at = now();

create or replace function public.sync_team_foreman_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_effective_date date;
  v_foreman_name text;
  v_updated_existing_count integer := 0;
begin
  if tg_op = 'UPDATE' and new.foreman_person_id is not distinct from old.foreman_person_id then
    return new;
  end if;

  v_effective_date := coalesce(new.updated_at::date, new.created_at::date, current_date);

  select nullif(btrim(coalesce(p.nome, '')), '')
  into v_foreman_name
  from public.people p
  where p.tenant_id = new.tenant_id
    and p.id = new.foreman_person_id;

  v_foreman_name := coalesce(v_foreman_name, 'Nao identificado');

  if tg_op = 'UPDATE' then
    update public.team_foreman_history h
    set
      foreman_person_id = new.foreman_person_id,
      foreman_name_snapshot = v_foreman_name,
      valid_to = null,
      updated_at = now()
    where h.tenant_id = new.tenant_id
      and h.team_id = new.id
      and h.valid_to is null
      and h.valid_from >= v_effective_date;

    get diagnostics v_updated_existing_count = row_count;
    if v_updated_existing_count > 0 then
      return new;
    end if;

    update public.team_foreman_history h
    set
      valid_to = v_effective_date - 1,
      updated_at = now()
    where h.tenant_id = new.tenant_id
      and h.team_id = new.id
      and h.valid_to is null;
  end if;

  insert into public.team_foreman_history (
    tenant_id,
    team_id,
    foreman_person_id,
    foreman_name_snapshot,
    valid_from,
    valid_to
  ) values (
    new.tenant_id,
    new.id,
    new.foreman_person_id,
    v_foreman_name,
    v_effective_date,
    null
  )
  on conflict (tenant_id, team_id, valid_from) do update
  set
    foreman_person_id = excluded.foreman_person_id,
    foreman_name_snapshot = excluded.foreman_name_snapshot,
    valid_to = null,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists trg_sync_team_foreman_history on public.teams;
create trigger trg_sync_team_foreman_history
after insert or update of foreman_person_id on public.teams
for each row execute function public.sync_team_foreman_history();

create or replace function public.resolve_team_foreman_snapshot(
  p_tenant_id uuid,
  p_team_id uuid,
  p_execution_date date
)
returns table (
  team_name text,
  foreman_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(nullif(btrim(coalesce(t.name, '')), ''), 'Nao informado') as team_name,
    coalesce(
      nullif(btrim(coalesce(h.foreman_name_snapshot, '')), ''),
      nullif(btrim(coalesce(p.nome, '')), ''),
      'Nao identificado'
    ) as foreman_name
  from public.teams t
  left join public.people p
    on p.id = t.foreman_person_id
   and p.tenant_id = t.tenant_id
  left join lateral (
    select fh.foreman_name_snapshot
    from public.team_foreman_history fh
    where fh.tenant_id = t.tenant_id
      and fh.team_id = t.id
      and fh.valid_from <= p_execution_date
      and (fh.valid_to is null or fh.valid_to >= p_execution_date)
    order by fh.valid_from desc, fh.created_at desc
    limit 1
  ) h on true
  where t.tenant_id = p_tenant_id
    and t.id = p_team_id
  limit 1;
$$;

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

drop trigger if exists trg_apply_measurement_team_snapshot on public.project_measurement_orders;
create trigger trg_apply_measurement_team_snapshot
before insert or update of team_id, execution_date, team_name_snapshot, foreman_name_snapshot
on public.project_measurement_orders
for each row execute function public.apply_measurement_team_snapshot();

revoke all on function public.sync_team_foreman_history() from public;
revoke all on function public.apply_measurement_team_snapshot() from public;
revoke all on function public.resolve_team_foreman_snapshot(uuid, uuid, date) from public;
grant execute on function public.resolve_team_foreman_snapshot(uuid, uuid, date) to authenticated;
grant execute on function public.resolve_team_foreman_snapshot(uuid, uuid, date) to service_role;
