-- 427_split_pi_template_screen.sql
-- Separa a administracao do template Word da PI numa tela propria de Cadastro
-- Base (`Modelo de PI`, `/modelo-pi`), deixando `/permissao-intervencao` livre
-- para ser o cadastro da PI.
--
-- POR QUE SEPARAR
-- ---------------------------------------------------------------------------
-- Sao publicos diferentes. Subir e validar o modelo oficial e ato de quem
-- administra o contrato, acontece raramente e vale para o tenant inteiro.
-- Preencher a PI e rotina da operacao, acontece todo dia e e por projeto/data.
-- Manter os dois na mesma tela obrigaria a liberar a troca do modelo oficial
-- para todo mundo que precisa emitir uma PI.
--
-- A migration 426 registrou `permissao-intervencao` com o painel de template
-- dentro. Aqui a chave nova nasce e a antiga PERMANECE: ela continua sendo a
-- tela da PI, hoje em construcao, e ja carrega as permissoes que os usuarios
-- receberam. Nenhuma tabela, RPC ou politica da 426 muda.

-- =============================================================================
-- 1) Tela `Modelo de PI` em `app_pages`
-- =============================================================================
insert into public.app_pages (page_key, path, name, section, description, default_user_access)
values (
  'modelo-pi',
  '/modelo-pi',
  'Modelo de PI',
  'Cadastro Base',
  'Versoes do template Word da Permissao de Intervencao, com conferencia de tags e versao ativa por contrato.',
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

-- =============================================================================
-- 2) Descricao da tela da PI, agora sem o template
-- =============================================================================
update public.app_pages
set
  description = 'Permissao de Intervencao (PI) vinculada a Projeto + Data da etapa.',
  updated_at = now()
where page_key = 'permissao-intervencao';

-- =============================================================================
-- 3) Propagacao de permissao da tela nova
-- =============================================================================
insert into public.role_page_permissions (tenant_id, role_id, page_key, can_access)
select
  tenants.tenant_id,
  roles.id,
  'modelo-pi',
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
 and existing.page_key = 'modelo-pi'
where existing.role_id is null
on conflict (tenant_id, role_id, page_key) do nothing;

-- Herda o que ja foi concedido em `permissao-intervencao` pela 426, em vez de
-- nascer so para admin: quem recebeu a tela quando o painel de template vivia
-- dentro dela nao pode perder o acesso pela separacao. Usuario sem a chave
-- antiga cai no default do papel.
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
  'modelo-pi',
  coalesce(anterior.can_access, roles.is_admin, false),
  null,
  null
from public.app_users users
left join public.app_roles roles
  on roles.id = users.role_id
 and roles.ativo = true
left join public.app_user_page_permissions anterior
  on anterior.tenant_id = users.tenant_id
 and anterior.user_id = users.id
 and anterior.page_key = 'permissao-intervencao'
left join public.app_user_page_permissions existing
  on existing.tenant_id = users.tenant_id
 and existing.user_id = users.id
 and existing.page_key = 'modelo-pi'
where users.tenant_id is not null
  and existing.user_id is null
on conflict (tenant_id, user_id, page_key) do nothing;

-- =============================================================================
-- 4) Verificacao
-- =============================================================================
do $$
begin
  if not exists (
    select 1
    from public.app_pages
    where page_key = 'modelo-pi'
      and path = '/modelo-pi'
      and section = 'Cadastro Base'
      and ativo = true
      and default_user_access = false
  ) then
    raise exception '427: pagina modelo-pi nao foi cadastrada corretamente em app_pages';
  end if;

  if not exists (
    select 1
    from public.app_pages
    where page_key = 'permissao-intervencao'
      and ativo = true
  ) then
    raise exception '427: pagina permissao-intervencao deveria continuar ativa';
  end if;

  -- Ninguem pode ter perdido acesso na separacao.
  if exists (
    select 1
    from public.app_user_page_permissions anterior
    left join public.app_user_page_permissions nova
      on nova.tenant_id = anterior.tenant_id
     and nova.user_id = anterior.user_id
     and nova.page_key = 'modelo-pi'
    where anterior.page_key = 'permissao-intervencao'
      and anterior.can_access = true
      and coalesce(nova.can_access, false) = false
  ) then
    raise exception '427: existe usuario com acesso a permissao-intervencao que ficou sem acesso a modelo-pi';
  end if;
end;
$$;
