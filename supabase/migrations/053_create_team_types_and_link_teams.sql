-- 053_create_team_types_and_link_teams.sql
-- Cria tipos de equipe por tenant, vincula em teams e inclui a pagina Tipo de Equipe na matriz de permissao.

create table if not exists public.team_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  unique (tenant_id, name)
);

alter table if exists public.team_types
  drop constraint if exists chk_team_types_name_not_blank;

alter table if exists public.team_types
  add constraint chk_team_types_name_not_blank
  check (btrim(name) <> '');

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'team_types'
      and tc.constraint_name = 'team_types_tenant_id_fk'
  ) then
    alter table public.team_types
      add constraint team_types_tenant_id_fk
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
      and tc.table_name = 'team_types'
      and tc.constraint_name = 'team_types_id_tenant_key'
  ) then
    alter table public.team_types
      add constraint team_types_id_tenant_key
      unique (id, tenant_id);
  end if;
end;
$$;

create index if not exists idx_team_types_tenant_active_name
  on public.team_types (tenant_id, ativo, name);

alter table if exists public.team_types enable row level security;

drop policy if exists team_types_tenant_select on public.team_types;
create policy team_types_tenant_select on public.team_types
for select
to authenticated
using (public.user_can_access_tenant(team_types.tenant_id));

drop policy if exists team_types_tenant_write on public.team_types;
create policy team_types_tenant_write on public.team_types
for all
to authenticated
using (public.user_can_access_tenant(team_types.tenant_id))
with check (public.user_can_access_tenant(team_types.tenant_id));

drop trigger if exists trg_team_types_audit on public.team_types;
create trigger trg_team_types_audit before insert or update on public.team_types
for each row execute function public.apply_audit_fields();

with tenant_sources as (
  select tenant_id
  from public.app_users
  where tenant_id is not null
  union
  select tenant_id
  from public.teams
  where tenant_id is not null
)
insert into public.team_types (tenant_id, name, ativo)
select tenant_id, 'PADRAO', true
from tenant_sources
on conflict (tenant_id, name) do update
set
  ativo = true,
  updated_at = now();

alter table if exists public.teams
  add column if not exists team_type_id uuid;

update public.teams t
set team_type_id = tt.id
from public.team_types tt
where t.team_type_id is null
  and tt.tenant_id = t.tenant_id
  and upper(btrim(tt.name)) = 'PADRAO';

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'teams'
      and tc.constraint_name = 'teams_team_type_tenant_fk'
  ) then
    alter table public.teams
      add constraint teams_team_type_tenant_fk
      foreign key (team_type_id, tenant_id)
      references public.team_types(id, tenant_id);
  end if;
end;
$$;

alter table if exists public.teams
  alter column team_type_id set not null;

create index if not exists idx_teams_tenant_team_type
  on public.teams (tenant_id, team_type_id, ativo, name);

insert into public.app_pages (page_key, path, name, section, description)
values
  ('tipo-equipe', '/tipo-equipe', 'Tipo de Equipe', 'Cadastro Base', 'Cadastro base dos tipos de equipes do tenant.')
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
 and pages.page_key = 'tipo-equipe'
on conflict (tenant_id, role_id, page_key) do update
set
  can_access = excluded.can_access,
  updated_at = now();

with target_pages as (
  select page_key
  from public.app_pages
  where ativo = true
    and page_key = 'tipo-equipe'
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

