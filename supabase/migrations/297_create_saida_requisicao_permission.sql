-- 297_create_saida_requisicao_permission.sql
-- Cria a permissao virtual "Requisicao direta" (saida-requisicao) que controla, dentro de
-- Operacoes de Equipe (/saida), quem pode fazer a operacao REQUISITION. Devolucao e Retorno de
-- campo continuam sob a permissao 'saida'.
--
-- Nao e uma pagina navegavel (nao entra no menu nem em ROUTE_PAGE_KEYS); serve apenas como flag
-- de permissao na matriz de acesso. Nasce BLOQUEADA para todos (default_user_access = false);
-- perfis administrativos continuam liberados por bypass de is_admin no backend.

insert into public.app_pages (page_key, path, name, section, description, default_user_access)
values (
  'saida-requisicao',
  '/saida',
  'Requisicao direta (Operacoes de Equipe)',
  'Almoxarifado',
  'Permite executar a operacao Requisicao dentro de Operacoes de Equipe. Sem esta permissao o usuario so faz Devolucao e Retorno de campo.',
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

-- Backfill por role: apenas perfis administrativos nascem com acesso.
insert into public.role_page_permissions (tenant_id, role_id, page_key, can_access)
select
  users.tenant_id,
  roles.id,
  'saida-requisicao',
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
 and existing.page_key = 'saida-requisicao'
where existing.role_id is null
on conflict (tenant_id, role_id, page_key) do nothing;

-- Backfill por usuario: apenas administradores nascem com acesso; demais bloqueados.
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
  'saida-requisicao',
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
 and existing.page_key = 'saida-requisicao'
where users.tenant_id is not null
  and existing.user_id is null
on conflict (tenant_id, user_id, page_key) do nothing;
