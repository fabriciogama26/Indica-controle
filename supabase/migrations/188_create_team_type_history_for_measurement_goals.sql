-- 188_create_team_type_history_for_measurement_goals.sql
-- Mantem historico efetivo de tipo por equipe para metas da Medicao por periodo real.

create table if not exists public.team_type_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  team_id uuid not null references public.teams(id) on delete cascade,
  team_type_id uuid null,
  team_type_name_snapshot text not null,
  valid_from date not null,
  valid_to date null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null references public.app_users(id),
  updated_by uuid null references public.app_users(id),
  constraint team_type_history_name_not_blank check (btrim(team_type_name_snapshot) <> ''),
  constraint team_type_history_valid_period_check check (valid_to is null or valid_to >= valid_from)
);

alter table if exists public.team_type_history
  add column if not exists created_by uuid null references public.app_users(id),
  add column if not exists updated_by uuid null references public.app_users(id);

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'team_type_history'
      and tc.constraint_name = 'team_type_history_tenant_id_fk'
  ) then
    alter table public.team_type_history
      add constraint team_type_history_tenant_id_fk
      foreign key (tenant_id)
      references public.tenants(id)
      on delete cascade;
  end if;

  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'team_type_history'
      and tc.constraint_name = 'team_type_history_team_type_tenant_fk'
  ) then
    alter table public.team_type_history
      add constraint team_type_history_team_type_tenant_fk
      foreign key (team_type_id, tenant_id)
      references public.team_types(id, tenant_id);
  end if;
end;
$$;

create unique index if not exists team_type_history_tenant_team_valid_from_key
  on public.team_type_history (tenant_id, team_id, valid_from);

create index if not exists idx_team_type_history_tenant_team_period
  on public.team_type_history (tenant_id, team_id, valid_from desc, valid_to);

alter table public.team_type_history enable row level security;

drop policy if exists team_type_history_tenant_select on public.team_type_history;
create policy team_type_history_tenant_select on public.team_type_history
for select
to authenticated
using (public.user_can_access_tenant(team_type_history.tenant_id));

drop policy if exists team_type_history_tenant_insert on public.team_type_history;
create policy team_type_history_tenant_insert on public.team_type_history
for insert
to authenticated
with check (public.user_can_access_tenant(team_type_history.tenant_id));

drop policy if exists team_type_history_tenant_update on public.team_type_history;
create policy team_type_history_tenant_update on public.team_type_history
for update
to authenticated
using (public.user_can_access_tenant(team_type_history.tenant_id))
with check (public.user_can_access_tenant(team_type_history.tenant_id));

drop trigger if exists trg_team_type_history_audit on public.team_type_history;
create trigger trg_team_type_history_audit before insert or update on public.team_type_history
for each row execute function public.apply_audit_fields();

with type_events as (
  select
    h.tenant_id,
    h.entity_id as team_id,
    h.created_at::date as change_date,
    nullif(btrim(h.changes #>> '{teamTypeName,from}'), '') as from_name,
    nullif(btrim(h.changes #>> '{teamTypeName,to}'), '') as to_name,
    lag(h.created_at::date) over (
      partition by h.tenant_id, h.entity_id
      order by h.created_at asc, h.id asc
    ) as previous_change_date
  from public.app_entity_history h
  where h.module_key = 'equipes'
    and h.entity_table = 'teams'
    and h.changes ? 'teamTypeName'
),
previous_periods as (
  select
    e.tenant_id,
    e.team_id,
    tt.id as team_type_id,
    e.from_name as team_type_name_snapshot,
    coalesce(e.previous_change_date, date '1900-01-01') as valid_from,
    (e.change_date - 1) as valid_to
  from type_events e
  join public.teams t
    on t.tenant_id = e.tenant_id
   and t.id = e.team_id
  left join public.team_types tt
    on tt.tenant_id = e.tenant_id
   and lower(btrim(tt.name)) = lower(btrim(e.from_name))
  where e.from_name is not null
),
valid_previous_periods as (
  select *
  from previous_periods
  where valid_from <= valid_to
)
insert into public.team_type_history (
  tenant_id,
  team_id,
  team_type_id,
  team_type_name_snapshot,
  valid_from,
  valid_to
)
select
  tenant_id,
  team_id,
  team_type_id,
  team_type_name_snapshot,
  valid_from,
  valid_to
from valid_previous_periods
on conflict (tenant_id, team_id, valid_from) do update
set
  team_type_id = excluded.team_type_id,
  team_type_name_snapshot = excluded.team_type_name_snapshot,
  valid_to = excluded.valid_to,
  updated_at = now();

with latest_type_event as (
  select distinct on (h.tenant_id, h.entity_id)
    h.tenant_id,
    h.entity_id as team_id,
    h.created_at::date as change_date,
    nullif(btrim(h.changes #>> '{teamTypeName,to}'), '') as to_name
  from public.app_entity_history h
  where h.module_key = 'equipes'
    and h.entity_table = 'teams'
    and h.changes ? 'teamTypeName'
  order by h.tenant_id, h.entity_id, h.created_at desc, h.id desc
)
insert into public.team_type_history (
  tenant_id,
  team_id,
  team_type_id,
  team_type_name_snapshot,
  valid_from,
  valid_to
)
select
  t.tenant_id,
  t.id,
  t.team_type_id,
  coalesce(e.to_name, nullif(btrim(coalesce(tt.name, '')), ''), 'Nao identificado'),
  coalesce(e.change_date, t.created_at::date, current_date),
  null::date
from public.teams t
left join public.team_types tt
  on tt.tenant_id = t.tenant_id
 and tt.id = t.team_type_id
left join latest_type_event e
  on e.tenant_id = t.tenant_id
 and e.team_id = t.id
on conflict (tenant_id, team_id, valid_from) do update
set
  team_type_id = excluded.team_type_id,
  team_type_name_snapshot = excluded.team_type_name_snapshot,
  valid_to = null,
  updated_at = now();

create or replace function public.sync_team_type_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_effective_date date;
  v_team_type_name text;
  v_updated_existing_count integer := 0;
begin
  if tg_op = 'UPDATE' and new.team_type_id is not distinct from old.team_type_id then
    return new;
  end if;

  v_effective_date := coalesce(new.updated_at::date, new.created_at::date, current_date);

  select nullif(btrim(coalesce(tt.name, '')), '')
  into v_team_type_name
  from public.team_types tt
  where tt.tenant_id = new.tenant_id
    and tt.id = new.team_type_id;

  v_team_type_name := coalesce(v_team_type_name, 'Nao identificado');

  if tg_op = 'UPDATE' then
    update public.team_type_history h
    set
      team_type_id = new.team_type_id,
      team_type_name_snapshot = v_team_type_name,
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

    update public.team_type_history h
    set
      valid_to = v_effective_date - 1,
      updated_at = now()
    where h.tenant_id = new.tenant_id
      and h.team_id = new.id
      and h.valid_to is null;
  end if;

  insert into public.team_type_history (
    tenant_id,
    team_id,
    team_type_id,
    team_type_name_snapshot,
    valid_from,
    valid_to
  ) values (
    new.tenant_id,
    new.id,
    new.team_type_id,
    v_team_type_name,
    v_effective_date,
    null
  )
  on conflict (tenant_id, team_id, valid_from) do update
  set
    team_type_id = excluded.team_type_id,
    team_type_name_snapshot = excluded.team_type_name_snapshot,
    valid_to = null,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists trg_sync_team_type_history on public.teams;
create trigger trg_sync_team_type_history
after insert or update of team_type_id on public.teams
for each row execute function public.sync_team_type_history();

revoke all on function public.sync_team_type_history() from public;
