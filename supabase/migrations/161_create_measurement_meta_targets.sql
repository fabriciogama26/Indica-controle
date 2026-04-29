-- 161_create_measurement_meta_targets.sql
-- Cria cadastro de metas de medicao por tipo de equipe e dias uteis por ciclo.

create table if not exists public.measurement_team_type_targets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  team_type_id uuid not null,
  daily_value numeric(14,2) not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  unique (tenant_id, team_type_id)
);

alter table if exists public.measurement_team_type_targets
  drop constraint if exists chk_measurement_team_type_targets_daily_value;

alter table if exists public.measurement_team_type_targets
  add constraint chk_measurement_team_type_targets_daily_value
  check (daily_value >= 0);

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'measurement_team_type_targets'
      and tc.constraint_name = 'measurement_team_type_targets_tenant_id_fk'
  ) then
    alter table public.measurement_team_type_targets
      add constraint measurement_team_type_targets_tenant_id_fk
      foreign key (tenant_id) references public.tenants(id);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'measurement_team_type_targets'
      and tc.constraint_name = 'measurement_team_type_targets_team_type_tenant_fk'
  ) then
    alter table public.measurement_team_type_targets
      add constraint measurement_team_type_targets_team_type_tenant_fk
      foreign key (team_type_id, tenant_id)
      references public.team_types(id, tenant_id);
  end if;
end;
$$;

create index if not exists idx_measurement_team_type_targets_tenant
  on public.measurement_team_type_targets (tenant_id, ativo, team_type_id);

alter table if exists public.measurement_team_type_targets enable row level security;

drop policy if exists measurement_team_type_targets_tenant_select on public.measurement_team_type_targets;
create policy measurement_team_type_targets_tenant_select on public.measurement_team_type_targets
for select
to authenticated
using (public.user_can_access_tenant(measurement_team_type_targets.tenant_id));

drop policy if exists measurement_team_type_targets_tenant_insert on public.measurement_team_type_targets;
create policy measurement_team_type_targets_tenant_insert on public.measurement_team_type_targets
for insert
to authenticated
with check (public.user_can_access_tenant(measurement_team_type_targets.tenant_id));

drop policy if exists measurement_team_type_targets_tenant_update on public.measurement_team_type_targets;
create policy measurement_team_type_targets_tenant_update on public.measurement_team_type_targets
for update
to authenticated
using (public.user_can_access_tenant(measurement_team_type_targets.tenant_id))
with check (public.user_can_access_tenant(measurement_team_type_targets.tenant_id));

drop trigger if exists trg_measurement_team_type_targets_audit on public.measurement_team_type_targets;
create trigger trg_measurement_team_type_targets_audit before insert or update on public.measurement_team_type_targets
for each row execute function public.apply_audit_fields();

create table if not exists public.measurement_cycle_workdays (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  cycle_start date not null,
  cycle_end date not null,
  workdays integer not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  unique (tenant_id, cycle_start)
);

alter table if exists public.measurement_cycle_workdays
  drop constraint if exists chk_measurement_cycle_workdays_dates;

alter table if exists public.measurement_cycle_workdays
  add constraint chk_measurement_cycle_workdays_dates
  check (cycle_end > cycle_start);

alter table if exists public.measurement_cycle_workdays
  drop constraint if exists chk_measurement_cycle_workdays_workdays;

alter table if exists public.measurement_cycle_workdays
  add constraint chk_measurement_cycle_workdays_workdays
  check (workdays between 0 and 31);

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'measurement_cycle_workdays'
      and tc.constraint_name = 'measurement_cycle_workdays_tenant_id_fk'
  ) then
    alter table public.measurement_cycle_workdays
      add constraint measurement_cycle_workdays_tenant_id_fk
      foreign key (tenant_id) references public.tenants(id);
  end if;
end;
$$;

create index if not exists idx_measurement_cycle_workdays_tenant_cycle
  on public.measurement_cycle_workdays (tenant_id, cycle_start desc);

alter table if exists public.measurement_cycle_workdays enable row level security;

drop policy if exists measurement_cycle_workdays_tenant_select on public.measurement_cycle_workdays;
create policy measurement_cycle_workdays_tenant_select on public.measurement_cycle_workdays
for select
to authenticated
using (public.user_can_access_tenant(measurement_cycle_workdays.tenant_id));

drop policy if exists measurement_cycle_workdays_tenant_insert on public.measurement_cycle_workdays;
create policy measurement_cycle_workdays_tenant_insert on public.measurement_cycle_workdays
for insert
to authenticated
with check (public.user_can_access_tenant(measurement_cycle_workdays.tenant_id));

drop policy if exists measurement_cycle_workdays_tenant_update on public.measurement_cycle_workdays;
create policy measurement_cycle_workdays_tenant_update on public.measurement_cycle_workdays
for update
to authenticated
using (public.user_can_access_tenant(measurement_cycle_workdays.tenant_id))
with check (public.user_can_access_tenant(measurement_cycle_workdays.tenant_id));

drop trigger if exists trg_measurement_cycle_workdays_audit on public.measurement_cycle_workdays;
create trigger trg_measurement_cycle_workdays_audit before insert or update on public.measurement_cycle_workdays
for each row execute function public.apply_audit_fields();

create table if not exists public.measurement_cycle_target_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  cycle_id uuid not null,
  team_type_id uuid not null,
  daily_value numeric(14,2) not null default 0,
  active_team_count integer not null default 0,
  daily_goal numeric(14,2) not null default 0,
  cycle_goal numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  unique (tenant_id, cycle_id, team_type_id)
);

alter table if exists public.measurement_cycle_target_items
  drop constraint if exists chk_measurement_cycle_target_items_values;

alter table if exists public.measurement_cycle_target_items
  add constraint chk_measurement_cycle_target_items_values
  check (
    daily_value >= 0
    and active_team_count >= 0
    and daily_goal >= 0
    and cycle_goal >= 0
  );

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'measurement_cycle_target_items'
      and tc.constraint_name = 'measurement_cycle_target_items_tenant_id_fk'
  ) then
    alter table public.measurement_cycle_target_items
      add constraint measurement_cycle_target_items_tenant_id_fk
      foreign key (tenant_id) references public.tenants(id);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'measurement_cycle_target_items'
      and tc.constraint_name = 'measurement_cycle_target_items_cycle_fk'
  ) then
    alter table public.measurement_cycle_target_items
      add constraint measurement_cycle_target_items_cycle_fk
      foreign key (cycle_id) references public.measurement_cycle_workdays(id);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'measurement_cycle_target_items'
      and tc.constraint_name = 'measurement_cycle_target_items_team_type_tenant_fk'
  ) then
    alter table public.measurement_cycle_target_items
      add constraint measurement_cycle_target_items_team_type_tenant_fk
      foreign key (team_type_id, tenant_id)
      references public.team_types(id, tenant_id);
  end if;
end;
$$;

create index if not exists idx_measurement_cycle_target_items_cycle
  on public.measurement_cycle_target_items (tenant_id, cycle_id, team_type_id);

alter table if exists public.measurement_cycle_target_items enable row level security;

drop policy if exists measurement_cycle_target_items_tenant_select on public.measurement_cycle_target_items;
create policy measurement_cycle_target_items_tenant_select on public.measurement_cycle_target_items
for select
to authenticated
using (public.user_can_access_tenant(measurement_cycle_target_items.tenant_id));

drop policy if exists measurement_cycle_target_items_tenant_insert on public.measurement_cycle_target_items;
create policy measurement_cycle_target_items_tenant_insert on public.measurement_cycle_target_items
for insert
to authenticated
with check (public.user_can_access_tenant(measurement_cycle_target_items.tenant_id));

drop policy if exists measurement_cycle_target_items_tenant_update on public.measurement_cycle_target_items;
create policy measurement_cycle_target_items_tenant_update on public.measurement_cycle_target_items
for update
to authenticated
using (public.user_can_access_tenant(measurement_cycle_target_items.tenant_id))
with check (public.user_can_access_tenant(measurement_cycle_target_items.tenant_id));

drop policy if exists measurement_cycle_target_items_tenant_delete on public.measurement_cycle_target_items;
create policy measurement_cycle_target_items_tenant_delete on public.measurement_cycle_target_items
for delete
to authenticated
using (public.user_can_access_tenant(measurement_cycle_target_items.tenant_id));

drop trigger if exists trg_measurement_cycle_target_items_audit on public.measurement_cycle_target_items;
create trigger trg_measurement_cycle_target_items_audit before insert or update on public.measurement_cycle_target_items
for each row execute function public.apply_audit_fields();

create table if not exists public.measurement_meta_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  cycle_id uuid not null,
  action_type text not null,
  reason text,
  changes jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references public.app_users(id)
);

alter table if exists public.measurement_meta_history
  drop constraint if exists chk_measurement_meta_history_action;

alter table if exists public.measurement_meta_history
  add constraint chk_measurement_meta_history_action
  check (action_type in ('CREATE', 'UPDATE'));

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'measurement_meta_history'
      and tc.constraint_name = 'measurement_meta_history_tenant_id_fk'
  ) then
    alter table public.measurement_meta_history
      add constraint measurement_meta_history_tenant_id_fk
      foreign key (tenant_id) references public.tenants(id);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'measurement_meta_history'
      and tc.constraint_name = 'measurement_meta_history_cycle_fk'
  ) then
    alter table public.measurement_meta_history
      add constraint measurement_meta_history_cycle_fk
      foreign key (cycle_id) references public.measurement_cycle_workdays(id);
  end if;
end;
$$;

create index if not exists idx_measurement_meta_history_cycle
  on public.measurement_meta_history (tenant_id, cycle_id, created_at desc);

alter table if exists public.measurement_meta_history enable row level security;

drop policy if exists measurement_meta_history_tenant_select on public.measurement_meta_history;
create policy measurement_meta_history_tenant_select on public.measurement_meta_history
for select
to authenticated
using (public.user_can_access_tenant(measurement_meta_history.tenant_id));

drop policy if exists measurement_meta_history_tenant_insert on public.measurement_meta_history;
create policy measurement_meta_history_tenant_insert on public.measurement_meta_history
for insert
to authenticated
with check (public.user_can_access_tenant(measurement_meta_history.tenant_id));

create or replace function public.save_measurement_meta_registration(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_targets jsonb,
  p_cycle_start date,
  p_cycle_end date,
  p_workdays integer,
  p_notes text default null,
  p_cycle_id uuid default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target jsonb;
  v_team_type_id uuid;
  v_daily_value numeric(14,2);
  v_active_team_count integer;
  v_cycle_id uuid;
  v_existing_cycle public.measurement_cycle_workdays%rowtype;
  v_action text;
  v_previous_summary jsonb := '{}'::jsonb;
  v_next_summary jsonb := '{}'::jsonb;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_CONTEXT', 'message', 'Contexto invalido para salvar metas.');
  end if;

  if p_cycle_start is null or p_cycle_end is null or p_cycle_end <= p_cycle_start then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_CYCLE', 'message', 'Ciclo invalido para salvar metas.');
  end if;

  if p_workdays is null or p_workdays < 0 or p_workdays > 31 then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_WORKDAYS', 'message', 'Dias uteis deve estar entre 0 e 31.');
  end if;

  if p_targets is null or jsonb_typeof(p_targets) <> 'array' or jsonb_array_length(p_targets) = 0 then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_TARGETS', 'message', 'Informe metas validas por tipo de equipe.');
  end if;

  if p_cycle_id is not null then
    select *
    into v_existing_cycle
    from public.measurement_cycle_workdays
    where tenant_id = p_tenant_id
      and id = p_cycle_id
    for update;

    if v_existing_cycle.id is null then
      return jsonb_build_object('success', false, 'status', 404, 'reason', 'META_CYCLE_NOT_FOUND', 'message', 'Cadastro de meta do ciclo nao encontrado.');
    end if;

    if exists (
      select 1
      from public.measurement_cycle_workdays mcw
      where mcw.tenant_id = p_tenant_id
        and mcw.cycle_start = p_cycle_start
        and mcw.id <> p_cycle_id
    ) then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'DUPLICATE_META_CYCLE', 'message', 'Ja existe cadastro de meta para este ciclo.');
    end if;

    select jsonb_build_object(
      'cycleStart', v_existing_cycle.cycle_start,
      'cycleEnd', v_existing_cycle.cycle_end,
      'workdays', v_existing_cycle.workdays,
      'notes', v_existing_cycle.notes,
      'totalDailyGoal', coalesce(sum(mcti.daily_goal), 0),
      'totalCycleGoal', coalesce(sum(mcti.cycle_goal), 0)
    )
    into v_previous_summary
    from public.measurement_cycle_target_items mcti
    where mcti.tenant_id = p_tenant_id
      and mcti.cycle_id = p_cycle_id;

    v_cycle_id := p_cycle_id;
    v_action := 'UPDATE';
  else
    if exists (
      select 1
      from public.measurement_cycle_workdays mcw
      where mcw.tenant_id = p_tenant_id
        and mcw.cycle_start = p_cycle_start
    ) then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'DUPLICATE_META_CYCLE', 'message', 'Ja existe cadastro de meta para este ciclo.');
    end if;

    v_cycle_id := gen_random_uuid();
    v_action := 'CREATE';
  end if;

  for v_target in select value from jsonb_array_elements(p_targets)
  loop
    v_team_type_id := nullif(btrim(coalesce(v_target ->> 'teamTypeId', '')), '')::uuid;
    v_daily_value := coalesce(nullif(btrim(coalesce(v_target ->> 'dailyValue', '')), '')::numeric, 0);

    if v_daily_value < 0 then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_DAILY_VALUE', 'message', 'Valor diario invalido para tipo de equipe.');
    end if;

    if not exists (
      select 1
      from public.team_types tt
      where tt.tenant_id = p_tenant_id
        and tt.id = v_team_type_id
        and tt.ativo = true
    ) then
      return jsonb_build_object('success', false, 'status', 422, 'reason', 'INVALID_TEAM_TYPE', 'message', 'Tipo de equipe invalido para o tenant atual.');
    end if;

    insert into public.measurement_team_type_targets (
      tenant_id,
      team_type_id,
      daily_value,
      ativo,
      created_by,
      updated_by
    )
    values (
      p_tenant_id,
      v_team_type_id,
      v_daily_value,
      true,
      p_actor_user_id,
      p_actor_user_id
    )
    on conflict (tenant_id, team_type_id) do update
    set
      daily_value = excluded.daily_value,
      ativo = true,
      updated_by = p_actor_user_id,
      updated_at = now();
  end loop;

  insert into public.measurement_cycle_workdays (
    id,
    tenant_id,
    cycle_start,
    cycle_end,
    workdays,
    notes,
    created_by,
    updated_by
  )
  values (
    v_cycle_id,
    p_tenant_id,
    p_cycle_start,
    p_cycle_end,
    p_workdays,
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_actor_user_id,
    p_actor_user_id
  )
  on conflict (tenant_id, cycle_start) do update
  set
    cycle_end = excluded.cycle_end,
    workdays = excluded.workdays,
    notes = excluded.notes,
    updated_by = p_actor_user_id,
    updated_at = now();

  delete from public.measurement_cycle_target_items
  where tenant_id = p_tenant_id
    and cycle_id = v_cycle_id;

  for v_target in select value from jsonb_array_elements(p_targets)
  loop
    v_team_type_id := nullif(btrim(coalesce(v_target ->> 'teamTypeId', '')), '')::uuid;
    v_daily_value := coalesce(nullif(btrim(coalesce(v_target ->> 'dailyValue', '')), '')::numeric, 0);

    select count(*)
    into v_active_team_count
    from public.teams t
    where t.tenant_id = p_tenant_id
      and t.team_type_id = v_team_type_id
      and t.ativo = true;

    insert into public.measurement_cycle_target_items (
      tenant_id,
      cycle_id,
      team_type_id,
      daily_value,
      active_team_count,
      daily_goal,
      cycle_goal,
      created_by,
      updated_by
    )
    values (
      p_tenant_id,
      v_cycle_id,
      v_team_type_id,
      v_daily_value,
      v_active_team_count,
      round(v_daily_value * v_active_team_count, 2),
      round(v_daily_value * v_active_team_count * p_workdays, 2),
      p_actor_user_id,
      p_actor_user_id
    );
  end loop;

  select jsonb_build_object(
    'cycleStart', p_cycle_start,
    'cycleEnd', p_cycle_end,
    'workdays', p_workdays,
    'notes', nullif(btrim(coalesce(p_notes, '')), ''),
    'totalDailyGoal', coalesce(sum(mcti.daily_goal), 0),
    'totalCycleGoal', coalesce(sum(mcti.cycle_goal), 0)
  )
  into v_next_summary
  from public.measurement_cycle_target_items mcti
  where mcti.tenant_id = p_tenant_id
    and mcti.cycle_id = v_cycle_id;

  insert into public.measurement_meta_history (
    tenant_id,
    cycle_id,
    action_type,
    reason,
    changes,
    metadata,
    created_by
  )
  values (
    p_tenant_id,
    v_cycle_id,
    v_action,
    nullif(btrim(coalesce(p_reason, '')), ''),
    jsonb_build_object('from', v_previous_summary, 'to', v_next_summary),
    jsonb_build_object('targetCount', jsonb_array_length(p_targets)),
    p_actor_user_id
  );

  return jsonb_build_object('success', true, 'status', 200, 'cycle_id', v_cycle_id, 'message', 'Cadastro de metas salvo com sucesso.');
exception
  when invalid_text_representation then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_PAYLOAD', 'message', 'Payload invalido para salvar metas.');
  when others then
    return jsonb_build_object('success', false, 'status', 500, 'reason', 'SAVE_META_FAILED', 'message', format('Falha ao salvar cadastro de metas: %s', sqlerrm));
end;
$$;

insert into public.app_pages (page_key, path, name, section, description)
values
  ('meta', '/meta', 'Meta', 'Cadastros', 'Cadastro de metas de medicao por tipo de equipe e dias uteis por ciclo.')
on conflict (page_key) do update
set
  path = excluded.path,
  name = excluded.name,
  section = excluded.section,
  description = excluded.description,
  ativo = true,
  updated_at = now();

insert into public.role_page_permissions (tenant_id, role_id, page_key, can_access)
select
  tenants.tenant_id,
  roles.id,
  pages.page_key,
  case
    when roles.role_key = 'viewer' then false
    else true
  end as can_access
from (
  select distinct tenant_id
  from public.app_users
  where tenant_id is not null
) as tenants
join public.app_roles as roles
  on roles.ativo = true
 and roles.role_key in ('master', 'admin', 'supervisor', 'user', 'viewer')
join public.app_pages as pages
  on pages.ativo = true
 and pages.page_key = 'meta'
on conflict (tenant_id, role_id, page_key) do update
set
  can_access = excluded.can_access,
  updated_at = now();

with target_pages as (
  select page_key
  from public.app_pages
  where ativo = true
    and page_key = 'meta'
),
target_users as (
  select
    au.id as user_id,
    au.tenant_id,
    au.role_id,
    coalesce(ar.role_key, 'user') as role_key
  from public.app_users au
  left join public.app_roles ar
    on ar.id = au.role_id
  where au.tenant_id is not null
    and exists (
      select 1
      from public.app_user_page_permissions upp
      where upp.tenant_id = au.tenant_id
        and upp.user_id = au.id
    )
)
insert into public.app_user_page_permissions (
  tenant_id,
  user_id,
  page_key,
  can_access,
  created_by,
  updated_by
)
select
  tu.tenant_id,
  tu.user_id,
  tp.page_key,
  coalesce(
    rpp.can_access,
    case
      when tu.role_key = 'viewer' then false
      else true
    end
  ) as can_access,
  null,
  null
from target_users tu
cross join target_pages tp
left join public.app_user_page_permissions existing
  on existing.tenant_id = tu.tenant_id
 and existing.user_id = tu.user_id
 and existing.page_key = tp.page_key
left join public.role_page_permissions rpp
  on rpp.tenant_id = tu.tenant_id
 and rpp.role_id = tu.role_id
 and rpp.page_key = tp.page_key
where existing.user_id is null
on conflict (tenant_id, user_id, page_key) do nothing;
