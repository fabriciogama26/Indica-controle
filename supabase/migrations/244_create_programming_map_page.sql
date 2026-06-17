-- 244_create_programming_map_page.sql
-- Cadastra a tela Mapa de Programacao e preenche somente permissoes ausentes.

insert into public.app_pages (page_key, path, name, section, description)
values (
  'mapa-programacao',
  '/mapa-programacao',
  'Mapa de Programacao',
  'Operacao',
  'Mapa de obras nunca programadas e equipes sem programacao.'
)
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
  'mapa-programacao',
  roles.role_key <> 'viewer'
from (
  select distinct tenant_id
  from public.app_users
  where tenant_id is not null
) as tenants
join public.app_roles as roles
  on roles.ativo = true
 and roles.role_key in ('master', 'admin', 'supervisor', 'user', 'viewer')
left join public.role_page_permissions existing
  on existing.tenant_id = tenants.tenant_id
 and existing.role_id = roles.id
 and existing.page_key = 'mapa-programacao'
where existing.role_id is null
on conflict (tenant_id, role_id, page_key) do nothing;

with target_users as (
  select
    users.id as user_id,
    users.tenant_id,
    users.role_id,
    coalesce(roles.role_key, 'user') as role_key
  from public.app_users users
  left join public.app_roles roles
    on roles.id = users.role_id
  where users.tenant_id is not null
    and exists (
      select 1
      from public.app_user_page_permissions permissions
      where permissions.tenant_id = users.tenant_id
        and permissions.user_id = users.id
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
  users.tenant_id,
  users.user_id,
  'mapa-programacao',
  coalesce(role_permissions.can_access, users.role_key <> 'viewer'),
  null,
  null
from target_users users
left join public.role_page_permissions role_permissions
  on role_permissions.tenant_id = users.tenant_id
 and role_permissions.role_id = users.role_id
 and role_permissions.page_key = 'mapa-programacao'
left join public.app_user_page_permissions existing
  on existing.tenant_id = users.tenant_id
 and existing.user_id = users.user_id
 and existing.page_key = 'mapa-programacao'
where existing.user_id is null
on conflict (tenant_id, user_id, page_key) do nothing;
