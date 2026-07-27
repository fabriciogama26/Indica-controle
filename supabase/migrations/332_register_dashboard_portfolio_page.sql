-- 332_register_dashboard_portfolio_page.sql
-- Cadastra o Dashboard Carteira Operacional com acesso inicial restrito a administradores.

insert into public.app_pages (page_key, path, name, section, description, default_user_access)
values (
  'dashboard-carteira-operacional',
  '/dashboard-carteira-operacional',
  'Dashboard Carteira Operacional',
  'Visao Geral',
  'Analise de saude, renovacao, envelhecimento e potencial financeiro da carteira operacional.',
  false
)
on conflict (page_key) do update
set
  path = excluded.path,
  name = excluded.name,
  section = excluded.section,
  description = excluded.description,
  default_user_access = false,
  ativo = true,
  updated_at = now();

insert into public.role_page_permissions (tenant_id, role_id, page_key, can_access)
select
  tenants.tenant_id,
  roles.id,
  'dashboard-carteira-operacional',
  coalesce(roles.is_admin, false)
from (
  select distinct tenant_id
  from public.app_users
  where tenant_id is not null
) tenants
join public.app_roles roles
  on roles.ativo = true
left join public.role_page_permissions existing
  on existing.tenant_id = tenants.tenant_id
 and existing.role_id = roles.id
 and existing.page_key = 'dashboard-carteira-operacional'
where existing.role_id is null
on conflict (tenant_id, role_id, page_key) do nothing;

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
  users.id,
  'dashboard-carteira-operacional',
  coalesce(roles.is_admin, false),
  null,
  null
from public.app_users users
left join public.app_roles roles
  on roles.id = users.role_id
 and roles.ativo = true
left join public.app_user_page_permissions existing
  on existing.tenant_id = users.tenant_id
 and existing.user_id = users.id
 and existing.page_key = 'dashboard-carteira-operacional'
where users.tenant_id is not null
  and existing.user_id is null
on conflict (tenant_id, user_id, page_key) do nothing;
