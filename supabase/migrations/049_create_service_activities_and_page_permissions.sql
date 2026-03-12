-- 049_create_service_activities_and_page_permissions.sql
-- Cria tabela de atividades de contratos/servicos por tenant e inclui pagina Atividades na matriz de permissao.

create table if not exists public.service_activities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  description text not null,
  group_name text not null,
  unit_value numeric(14, 2) not null default 0,
  unit text not null,
  scope text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  unique (tenant_id, code)
);

alter table if exists public.service_activities
  drop constraint if exists chk_service_activities_code_not_blank;

alter table if exists public.service_activities
  add constraint chk_service_activities_code_not_blank
  check (btrim(code) <> '');

alter table if exists public.service_activities
  drop constraint if exists chk_service_activities_description_not_blank;

alter table if exists public.service_activities
  add constraint chk_service_activities_description_not_blank
  check (btrim(description) <> '');

alter table if exists public.service_activities
  drop constraint if exists chk_service_activities_group_name_not_blank;

alter table if exists public.service_activities
  add constraint chk_service_activities_group_name_not_blank
  check (btrim(group_name) <> '');

alter table if exists public.service_activities
  drop constraint if exists chk_service_activities_unit_not_blank;

alter table if exists public.service_activities
  add constraint chk_service_activities_unit_not_blank
  check (btrim(unit) <> '');

alter table if exists public.service_activities
  drop constraint if exists chk_service_activities_scope_not_blank;

alter table if exists public.service_activities
  add constraint chk_service_activities_scope_not_blank
  check (btrim(scope) <> '');

alter table if exists public.service_activities
  drop constraint if exists chk_service_activities_unit_value_non_negative;

alter table if exists public.service_activities
  add constraint chk_service_activities_unit_value_non_negative
  check (unit_value >= 0);

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'service_activities'
      and tc.constraint_name = 'service_activities_tenant_id_fk'
  ) then
    alter table public.service_activities
      add constraint service_activities_tenant_id_fk
      foreign key (tenant_id) references public.tenants(id);
  end if;
end;
$$;

create index if not exists idx_service_activities_tenant_active_code
  on public.service_activities (tenant_id, ativo, code);

create index if not exists idx_service_activities_tenant_group
  on public.service_activities (tenant_id, group_name, ativo);

alter table if exists public.service_activities enable row level security;

drop policy if exists service_activities_tenant_select on public.service_activities;
create policy service_activities_tenant_select on public.service_activities
for select
to authenticated
using (public.user_can_access_tenant(service_activities.tenant_id));

drop policy if exists service_activities_tenant_write on public.service_activities;
create policy service_activities_tenant_write on public.service_activities
for all
to authenticated
using (public.user_can_access_tenant(service_activities.tenant_id))
with check (public.user_can_access_tenant(service_activities.tenant_id));

drop trigger if exists trg_service_activities_audit on public.service_activities;
create trigger trg_service_activities_audit before insert or update on public.service_activities
for each row execute function public.apply_audit_fields();

insert into public.app_pages (page_key, path, name, section, description)
values
  ('atividades', '/atividades', 'Atividades', 'Cadastro Base', 'Cadastro de atividades de contratos e servicos.')
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
 and pages.page_key = 'atividades'
on conflict (tenant_id, role_id, page_key) do update
set
  can_access = excluded.can_access,
  updated_at = now();

with target_pages as (
  select page_key
  from public.app_pages
  where ativo = true
    and page_key = 'atividades'
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
