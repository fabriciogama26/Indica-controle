-- 227_create_team_stock_balance_page.sql
-- Cadastra a consulta read-only de estoque por equipe na matriz de permissoes.

insert into public.app_pages (page_key, path, name, section, description)
values (
  'estoque-equipes',
  '/estoque-equipes',
  'Estoque das Equipes',
  'Almoxarifado',
  'Consulta do saldo atual de materiais nos centros proprios vinculados as equipes.'
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
  tenant_ids.tenant_id,
  roles.id,
  pages.page_key,
  true
from (
  select distinct tenant_id
  from public.app_users
  where tenant_id is not null
) tenant_ids
join public.app_roles roles
  on roles.ativo = true
 and roles.role_key in ('master', 'admin', 'supervisor', 'user', 'viewer')
join public.app_pages pages
  on pages.page_key = 'estoque-equipes'
 and pages.ativo = true
on conflict (tenant_id, role_id, page_key) do update
set
  can_access = excluded.can_access,
  updated_at = now();

with target_users as (
  select distinct
    users.id as user_id,
    users.tenant_id,
    users.role_id
  from public.app_users users
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
  target_users.tenant_id,
  target_users.user_id,
  'estoque-equipes',
  coalesce(role_permissions.can_access, true),
  null,
  null
from target_users
left join public.role_page_permissions role_permissions
  on role_permissions.tenant_id = target_users.tenant_id
 and role_permissions.role_id = target_users.role_id
 and role_permissions.page_key = 'estoque-equipes'
left join public.app_user_page_permissions existing
  on existing.tenant_id = target_users.tenant_id
 and existing.user_id = target_users.user_id
 and existing.page_key = 'estoque-equipes'
where existing.user_id is null
on conflict (tenant_id, user_id, page_key) do nothing;
