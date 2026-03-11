-- 031_create_project_lookup_tables.sql
-- Normaliza campos de dominio de projetos em tabelas proprias por tenant.

create table if not exists public.project_priorities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  name_normalized text generated always as (upper(btrim(name))) stored,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  unique (tenant_id, name_normalized),
  check (btrim(name) <> '')
);

create table if not exists public.project_service_centers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  name_normalized text generated always as (upper(btrim(name))) stored,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  unique (tenant_id, name_normalized),
  check (btrim(name) <> '')
);

create table if not exists public.project_service_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  name_normalized text generated always as (upper(btrim(name))) stored,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  unique (tenant_id, name_normalized),
  check (btrim(name) <> '')
);

create table if not exists public.project_voltage_levels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  name_normalized text generated always as (upper(btrim(name))) stored,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  unique (tenant_id, name_normalized),
  check (btrim(name) <> '')
);

create table if not exists public.project_sizes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  name_normalized text generated always as (upper(btrim(name))) stored,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  unique (tenant_id, name_normalized),
  check (btrim(name) <> '')
);

create table if not exists public.project_municipalities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  name_normalized text generated always as (upper(btrim(name))) stored,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  unique (tenant_id, name_normalized),
  check (btrim(name) <> '')
);

create table if not exists public.project_contractor_responsibles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  name_normalized text generated always as (upper(btrim(name))) stored,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  unique (tenant_id, name_normalized),
  check (btrim(name) <> '')
);

create table if not exists public.project_utility_responsibles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  name_normalized text generated always as (upper(btrim(name))) stored,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  unique (tenant_id, name_normalized),
  check (btrim(name) <> '')
);

create table if not exists public.project_utility_field_managers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  name_normalized text generated always as (upper(btrim(name))) stored,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  unique (tenant_id, name_normalized),
  check (btrim(name) <> '')
);

do $$
declare
  v_table text;
  v_tables text[] := array[
    'project_priorities',
    'project_service_centers',
    'project_service_types',
    'project_voltage_levels',
    'project_sizes',
    'project_municipalities',
    'project_contractor_responsibles',
    'project_utility_responsibles',
    'project_utility_field_managers'
  ];
begin
  foreach v_table in array v_tables loop
    execute format(
      'create index if not exists idx_%1$s_tenant_active_name on public.%1$I (tenant_id, ativo, name_normalized)',
      v_table
    );

    execute format('alter table if exists public.%I enable row level security', v_table);

    execute format('drop policy if exists %1$I_tenant_select on public.%1$I', v_table);
    execute format(
      'create policy %1$I_tenant_select on public.%1$I for select to authenticated using (public.user_can_access_tenant(tenant_id))',
      v_table
    );

    execute format('drop policy if exists %1$I_tenant_write on public.%1$I', v_table);
    execute format(
      'create policy %1$I_tenant_write on public.%1$I for all to authenticated using (public.user_can_access_tenant(tenant_id)) with check (public.user_can_access_tenant(tenant_id))',
      v_table
    );

    execute format('drop trigger if exists trg_%1$s_audit on public.%1$I', v_table);
    execute format(
      'create trigger trg_%1$s_audit before insert or update on public.%1$I for each row execute function public.apply_audit_fields()',
      v_table
    );
  end loop;
end $$;

insert into public.project_priorities (tenant_id, name)
select distinct p.tenant_id, btrim(p.priority)
from public.project p
where nullif(btrim(p.priority), '') is not null
on conflict (tenant_id, name_normalized) do nothing;

insert into public.project_service_centers (tenant_id, name)
select distinct p.tenant_id, btrim(p.service_center)
from public.project p
where nullif(btrim(p.service_center), '') is not null
on conflict (tenant_id, name_normalized) do nothing;

insert into public.project_service_types (tenant_id, name)
select distinct p.tenant_id, btrim(p.service_type)
from public.project p
where nullif(btrim(p.service_type), '') is not null
on conflict (tenant_id, name_normalized) do nothing;

insert into public.project_voltage_levels (tenant_id, name)
select distinct p.tenant_id, btrim(p.voltage_level)
from public.project p
where nullif(btrim(p.voltage_level), '') is not null
on conflict (tenant_id, name_normalized) do nothing;

insert into public.project_sizes (tenant_id, name)
select distinct p.tenant_id, btrim(p.project_size)
from public.project p
where nullif(btrim(p.project_size), '') is not null
on conflict (tenant_id, name_normalized) do nothing;

insert into public.project_municipalities (tenant_id, name)
select distinct p.tenant_id, btrim(p.city)
from public.project p
where nullif(btrim(p.city), '') is not null
on conflict (tenant_id, name_normalized) do nothing;

insert into public.project_contractor_responsibles (tenant_id, name)
select distinct p.tenant_id, btrim(p.contractor_responsible)
from public.project p
where nullif(btrim(p.contractor_responsible), '') is not null
on conflict (tenant_id, name_normalized) do nothing;

insert into public.project_utility_responsibles (tenant_id, name)
select distinct p.tenant_id, btrim(p.utility_responsible)
from public.project p
where nullif(btrim(p.utility_responsible), '') is not null
on conflict (tenant_id, name_normalized) do nothing;

insert into public.project_utility_field_managers (tenant_id, name)
select distinct p.tenant_id, btrim(p.utility_field_manager)
from public.project p
where nullif(btrim(p.utility_field_manager), '') is not null
on conflict (tenant_id, name_normalized) do nothing;

insert into public.project_contractor_responsibles (tenant_id, name)
select distinct pe.tenant_id, btrim(pe.nome)
from public.people pe
where pe.ativo = true
  and nullif(btrim(pe.nome), '') is not null
on conflict (tenant_id, name_normalized) do nothing;

insert into public.project_utility_responsibles (tenant_id, name)
select distinct pe.tenant_id, btrim(pe.nome)
from public.people pe
where pe.ativo = true
  and nullif(btrim(pe.nome), '') is not null
on conflict (tenant_id, name_normalized) do nothing;

insert into public.project_utility_field_managers (tenant_id, name)
select distinct pe.tenant_id, btrim(pe.nome)
from public.people pe
where pe.ativo = true
  and nullif(btrim(pe.nome), '') is not null
on conflict (tenant_id, name_normalized) do nothing;

insert into public.project_priorities (tenant_id, name)
select t.tenant_id, p.name
from (
  select distinct tenant_id
  from public.app_users
  where tenant_id is not null
) t
cross join (
  values
    ('GRUPO B - FLUXO'),
    ('DRP / DRC'),
    ('GRUPO A - FLUXO'),
    ('FUSESAVER')
) as p(name)
on conflict (tenant_id, name_normalized) do nothing;

alter table if exists public.project
  add column if not exists priority_id uuid references public.project_priorities(id),
  add column if not exists service_center_id uuid references public.project_service_centers(id),
  add column if not exists service_type_id uuid references public.project_service_types(id),
  add column if not exists voltage_level_id uuid references public.project_voltage_levels(id),
  add column if not exists project_size_id uuid references public.project_sizes(id),
  add column if not exists municipality_id uuid references public.project_municipalities(id),
  add column if not exists contractor_responsible_id uuid references public.project_contractor_responsibles(id),
  add column if not exists utility_responsible_id uuid references public.project_utility_responsibles(id),
  add column if not exists utility_field_manager_id uuid references public.project_utility_field_managers(id);

update public.project p
set priority_id = l.id
from public.project_priorities l
where p.priority_id is null
  and p.tenant_id = l.tenant_id
  and upper(btrim(p.priority)) = l.name_normalized;

update public.project p
set service_center_id = l.id
from public.project_service_centers l
where p.service_center_id is null
  and p.tenant_id = l.tenant_id
  and upper(btrim(p.service_center)) = l.name_normalized;

update public.project p
set service_type_id = l.id
from public.project_service_types l
where p.service_type_id is null
  and p.tenant_id = l.tenant_id
  and upper(btrim(p.service_type)) = l.name_normalized;

update public.project p
set voltage_level_id = l.id
from public.project_voltage_levels l
where p.voltage_level_id is null
  and p.tenant_id = l.tenant_id
  and upper(btrim(coalesce(p.voltage_level, ''))) = l.name_normalized;

update public.project p
set project_size_id = l.id
from public.project_sizes l
where p.project_size_id is null
  and p.tenant_id = l.tenant_id
  and upper(btrim(coalesce(p.project_size, ''))) = l.name_normalized;

update public.project p
set municipality_id = l.id
from public.project_municipalities l
where p.municipality_id is null
  and p.tenant_id = l.tenant_id
  and upper(btrim(p.city)) = l.name_normalized;

update public.project p
set contractor_responsible_id = l.id
from public.project_contractor_responsibles l
where p.contractor_responsible_id is null
  and p.tenant_id = l.tenant_id
  and upper(btrim(p.contractor_responsible)) = l.name_normalized;

update public.project p
set utility_responsible_id = l.id
from public.project_utility_responsibles l
where p.utility_responsible_id is null
  and p.tenant_id = l.tenant_id
  and upper(btrim(p.utility_responsible)) = l.name_normalized;

update public.project p
set utility_field_manager_id = l.id
from public.project_utility_field_managers l
where p.utility_field_manager_id is null
  and p.tenant_id = l.tenant_id
  and upper(btrim(p.utility_field_manager)) = l.name_normalized;

alter table if exists public.project
  alter column priority_id set not null,
  alter column service_center_id set not null,
  alter column service_type_id set not null,
  alter column municipality_id set not null,
  alter column contractor_responsible_id set not null,
  alter column utility_responsible_id set not null,
  alter column utility_field_manager_id set not null;

create index if not exists idx_project_priority_id
  on public.project (tenant_id, priority_id);

create index if not exists idx_project_service_center_id
  on public.project (tenant_id, service_center_id);

create index if not exists idx_project_service_type_id
  on public.project (tenant_id, service_type_id);

create index if not exists idx_project_municipality_id
  on public.project (tenant_id, municipality_id);
