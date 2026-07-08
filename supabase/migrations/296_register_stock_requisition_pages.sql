-- 296_register_stock_requisition_pages.sql
-- Cadastra as telas do fluxo de Requisicao com Atendimento no Almoxarifado.
--   /requisicao-solicitacao  -> solicitante (usuario logado) abre o pedido.
--   /requisicao-atendimento  -> almoxarife assume e atende (claim/fulfill/release/cancel).
-- Ambas nascem bloqueadas para usuarios nao administrativos (default_user_access = false).

insert into public.app_pages (page_key, path, name, section, description, default_user_access)
values
  (
    'requisicao-solicitacao',
    '/requisicao-solicitacao',
    'Solicitacao de Requisicao',
    'Almoxarifado',
    'Abertura de pedidos de requisicao de material para atendimento pelo almoxarifado.',
    false
  ),
  (
    'requisicao-atendimento',
    '/requisicao-atendimento',
    'Atendimento de Requisicoes',
    'Almoxarifado',
    'Fila de pedidos pendentes para o almoxarife aceitar, reduzir ou recusar item a item.',
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

-- Backfill de permissoes por role (admin liberado, demais bloqueados) para cada pagina.
insert into public.role_page_permissions (tenant_id, role_id, page_key, can_access)
select
  users.tenant_id,
  roles.id,
  pages.page_key,
  coalesce(roles.is_admin, false)
from (
  select distinct tenant_id
  from public.app_users
  where tenant_id is not null
) users
join public.app_roles roles
  on roles.ativo = true
cross join (values ('requisicao-solicitacao'), ('requisicao-atendimento')) as pages(page_key)
left join public.role_page_permissions existing
  on existing.tenant_id = users.tenant_id
 and existing.role_id = roles.id
 and existing.page_key = pages.page_key
where existing.role_id is null
on conflict (tenant_id, role_id, page_key) do nothing;

-- Backfill de permissoes por usuario (admin liberado, demais bloqueados) para cada pagina.
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
  pages.page_key,
  coalesce(roles.is_admin, false),
  null,
  null
from public.app_users users
left join public.app_roles roles
  on roles.id = users.role_id
 and roles.ativo = true
cross join (values ('requisicao-solicitacao'), ('requisicao-atendimento')) as pages(page_key)
left join public.app_user_page_permissions existing
  on existing.tenant_id = users.tenant_id
 and existing.user_id = users.id
 and existing.page_key = pages.page_key
where users.tenant_id is not null
  and existing.user_id is null
on conflict (tenant_id, user_id, page_key) do nothing;
