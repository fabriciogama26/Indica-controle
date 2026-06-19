-- 246_create_minimum_factor_analysis_page.sql
-- Cadastra a tela Apuracao de Fator Minimo e adiciona indice para filtros por codigo de servico.

insert into public.app_pages (page_key, path, name, section, description, default_user_access)
values (
  'apuracao-fator-minimo',
  '/apuracao-fator-minimo',
  'Apuracao de Fator Minimo',
  'Operacao',
  'Simulacao de fator minimo por equipe, data e codigo de servico.',
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
  users.tenant_id,
  roles.id,
  'apuracao-fator-minimo',
  coalesce(roles.is_admin, false)
from (
  select distinct tenant_id
  from public.app_users
  where tenant_id is not null
) users
join public.app_roles roles
  on roles.ativo = true
left join public.role_page_permissions existing
  on existing.tenant_id = users.tenant_id
 and existing.role_id = roles.id
 and existing.page_key = 'apuracao-fator-minimo'
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
  'apuracao-fator-minimo',
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
 and existing.page_key = 'apuracao-fator-minimo'
where users.tenant_id is not null
  and existing.user_id is null
on conflict (tenant_id, user_id, page_key) do nothing;

create index if not exists idx_project_measurement_order_items_tenant_activity_active_order
  on public.project_measurement_order_items (tenant_id, service_activity_id, is_active, measurement_order_id)
  where is_active = true;
