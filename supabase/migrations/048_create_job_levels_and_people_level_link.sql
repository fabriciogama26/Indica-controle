-- 048_create_job_levels_and_people_level_link.sql
-- Cria catalogo de niveis por tenant e permite people consumir nivel via text.

create table if not exists public.job_levels (
  tenant_id uuid not null,
  level text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  primary key (tenant_id, level)
);

alter table if exists public.people
  drop constraint if exists people_job_level_tenant_fk;

do $$
declare
  v_constraint record;
  v_level_data_type text;
begin
  -- Se a tabela veio de execucao anterior (level smallint), remove checks numericos e converte para text.
  for v_constraint in
    select c.conname
    from pg_constraint c
    join pg_class t
      on t.oid = c.conrelid
    join pg_namespace n
      on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'job_levels'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%level between 1 and 3%'
  loop
    execute format('alter table public.job_levels drop constraint %I', v_constraint.conname);
  end loop;

  select c.data_type
  into v_level_data_type
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'job_levels'
    and c.column_name = 'level';

  if v_level_data_type is not null and v_level_data_type <> 'text' then
    alter table public.job_levels
      alter column level type text
      using level::text;
  end if;
end;
$$;

alter table if exists public.job_levels
  drop constraint if exists chk_job_levels_level_not_blank;

alter table if exists public.job_levels
  add constraint chk_job_levels_level_not_blank
  check (btrim(level) <> '');

alter table if exists public.job_levels
  drop constraint if exists chk_job_levels_level_allowed;

alter table if exists public.job_levels
  add constraint chk_job_levels_level_allowed
  check (level in ('1', '2', '3'));

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'job_levels'
      and tc.constraint_name = 'job_levels_tenant_id_fk'
  ) then
    alter table public.job_levels
      add constraint job_levels_tenant_id_fk
      foreign key (tenant_id) references public.tenants(id);
  end if;
end;
$$;

create index if not exists idx_job_levels_tenant_active
  on public.job_levels (tenant_id, ativo, level);

insert into public.job_levels (tenant_id, level, ativo)
select t.id, v.level, true
from public.tenants t
cross join (values ('1'), ('2'), ('3')) as v(level)
on conflict (tenant_id, level) do update
set
  ativo = excluded.ativo,
  updated_at = now();

alter table if exists public.people
  add column if not exists job_level text;

alter table if exists public.people
  drop constraint if exists chk_people_job_level_range;

do $$
declare
  v_people_level_data_type text;
begin
  select c.data_type
  into v_people_level_data_type
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'people'
    and c.column_name = 'job_level';

  if v_people_level_data_type is not null and v_people_level_data_type <> 'text' then
    alter table public.people
      alter column job_level type text
      using job_level::text;
  end if;
end;
$$;

alter table if exists public.people
  add constraint chk_people_job_level_range
  check (job_level is null or job_level in ('1', '2', '3'));

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'people'
      and tc.constraint_name = 'people_job_level_tenant_fk'
  ) then
    alter table public.people
      add constraint people_job_level_tenant_fk
      foreign key (tenant_id, job_level)
      references public.job_levels(tenant_id, level);
  end if;
end;
$$;

create index if not exists idx_people_tenant_job_level
  on public.people (tenant_id, job_level, ativo, nome);

alter table if exists public.job_levels enable row level security;

drop policy if exists job_levels_tenant_select on public.job_levels;
create policy job_levels_tenant_select on public.job_levels
for select
to authenticated
using (public.user_can_access_tenant(job_levels.tenant_id));

drop policy if exists job_levels_tenant_write on public.job_levels;
create policy job_levels_tenant_write on public.job_levels
for all
to authenticated
using (public.user_can_access_tenant(job_levels.tenant_id))
with check (public.user_can_access_tenant(job_levels.tenant_id));

drop trigger if exists trg_job_levels_audit on public.job_levels;
create trigger trg_job_levels_audit before insert or update on public.job_levels
for each row execute function public.apply_audit_fields();
