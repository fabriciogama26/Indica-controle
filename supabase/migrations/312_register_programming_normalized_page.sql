-- 312_register_programming_normalized_page.sql
-- Cadastra a tela nova de Programacao (modelo normalizado), ao lado de
-- programacao-simples. Nasce bloqueada para usuarios nao administrativos
-- (default_user_access = false), mesmo padrao das migrations 294-296
-- (Requisicao com Atendimento).

insert into public.app_pages (page_key, path, name, section, description, default_user_access)
values (
  'programacao-normalizada',
  '/programacao-normalizada',
  'Programacao (Normalizada)',
  'Operacao',
  'Nova tela de Programacao sobre o modelo normalizado (etapa como pai, equipe como filha) — em avaliacao ao lado da tela atual.',
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

-- Backfill de permissoes por role (admin liberado, demais bloqueados).
insert into public.role_page_permissions (tenant_id, role_id, page_key, can_access)
select
  users.tenant_id,
  roles.id,
  'programacao-normalizada',
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
 and existing.page_key = 'programacao-normalizada'
where existing.role_id is null
on conflict (tenant_id, role_id, page_key) do nothing;

-- Backfill de permissoes por usuario (admin liberado, demais bloqueados).
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
  'programacao-normalizada',
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
 and existing.page_key = 'programacao-normalizada'
where users.tenant_id is not null
  and existing.user_id is null
on conflict (tenant_id, user_id, page_key) do nothing;
