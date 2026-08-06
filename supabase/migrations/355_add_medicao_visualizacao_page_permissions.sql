-- 355_add_medicao_visualizacao_page_permissions.sql
-- Registra a tela `Visualizacao Medicao` em app_pages e faz o backfill de permissoes por tenant.
--
-- CONTEXTO
-- ---------------------------------------------------------------------------
-- Tela nova de consulta/extracao da Medicao: so filtros e os dois botoes de CSV
-- (`Exportar Excel (CSV)` e `Detalhamento (CSV)`). Nao cadastra, nao edita e nao
-- muda status de ordem. A rota `GET /api/medicao/export` passa a aceitar
-- `medicao/export` OU `medicao-visualizacao/export`, entao esta tela precisa das
-- acoes `read` e `export` para funcionar.
--
-- MODELO DE PERMISSAO
-- ---------------------------------------------------------------------------
-- Conforme a migration 253, as 7 colunas de acao andam juntas: o toggle da tela
-- de Permissoes liga/desliga todas simultaneamente. Por isso o backfill escreve
-- as 7 colunas com o mesmo valor, e nao apenas `can_access` — se gravasse so
-- `can_access`, `can_export` ficaria no default `false` e o botao de CSV
-- responderia 403 para todo usuario nao-admin.
--
-- CRITERIO DO BACKFILL
-- ---------------------------------------------------------------------------
-- Cada usuario existente recebe em `medicao-visualizacao` o MESMO valor que ja
-- possui em `medicao`. Assim a publicacao nao amplia o alcance de ninguem: quem
-- ja podia extrair a Medicao continua podendo, quem nao podia continua sem. A
-- liberacao para perfis de consulta (que nao tem `medicao`) e feita depois pelo
-- administrador na tela de Permissoes. Usuario sem linha de `medicao` cai no
-- default do papel.

insert into public.app_pages (page_key, path, name, section, description, default_user_access)
values
  (
    'medicao-visualizacao',
    '/medicao-visualizacao',
    'Visualizacao Medicao',
    'Operacao',
    'Consulta por filtros e extracao CSV das ordens de medicao, sem cadastro.',
    coalesce((select default_user_access from public.app_pages where page_key = 'medicao'), false)
  )
on conflict (page_key) do update
set
  path = excluded.path,
  name = excluded.name,
  section = excluded.section,
  description = excluded.description,
  ativo = true,
  updated_at = now();

-- Template por papel (nao lido em runtime — a sessao usa app_user_page_permissions —
-- mas mantido consistente, mesmo criterio da migration 348).
insert into public.role_page_permissions (tenant_id, role_id, page_key, can_access)
select
  medicao_perm.tenant_id,
  medicao_perm.role_id,
  'medicao-visualizacao',
  medicao_perm.can_access
from public.role_page_permissions as medicao_perm
join public.app_pages as pages
  on pages.ativo = true
 and pages.page_key = 'medicao-visualizacao'
where medicao_perm.page_key = 'medicao'
on conflict (tenant_id, role_id, page_key) do update
set
  can_access = excluded.can_access,
  updated_at = now();

insert into public.app_user_page_permissions (
  tenant_id,
  user_id,
  page_key,
  can_access,
  can_create,
  can_update,
  can_cancel,
  can_reverse,
  can_import,
  can_export,
  created_by,
  updated_by
)
select
  au.tenant_id,
  au.id,
  'medicao-visualizacao',
  coalesce(medicao_perm.can_access, role_default.can_access, false),
  coalesce(medicao_perm.can_access, role_default.can_access, false),
  coalesce(medicao_perm.can_access, role_default.can_access, false),
  coalesce(medicao_perm.can_access, role_default.can_access, false),
  coalesce(medicao_perm.can_access, role_default.can_access, false),
  coalesce(medicao_perm.can_access, role_default.can_access, false),
  coalesce(medicao_perm.can_access and medicao_perm.can_export, role_default.can_access, false),
  null,
  null
from public.app_users au
left join public.app_user_page_permissions medicao_perm
  on medicao_perm.tenant_id = au.tenant_id
 and medicao_perm.user_id = au.id
 and medicao_perm.page_key = 'medicao'
left join public.role_page_permissions role_default
  on role_default.tenant_id = au.tenant_id
 and role_default.role_id = au.role_id
 and role_default.page_key = 'medicao'
where au.tenant_id is not null
on conflict (tenant_id, user_id, page_key) do nothing;

-- =============================================================================
-- Validacao pos-execucao: quem exporta Medicao hoje precisa exportar aqui tambem.
-- =============================================================================
do $$
declare
  v_missing integer;
begin
  select count(*)
  into v_missing
  from public.app_user_page_permissions medicao_perm
  left join public.app_user_page_permissions view_perm
    on view_perm.tenant_id = medicao_perm.tenant_id
   and view_perm.user_id = medicao_perm.user_id
   and view_perm.page_key = 'medicao-visualizacao'
  where medicao_perm.page_key = 'medicao'
    and medicao_perm.can_access = true
    and medicao_perm.can_export = true
    and (view_perm.can_access is distinct from true or view_perm.can_export is distinct from true);

  if v_missing > 0 then
    raise exception '355: % usuario(s) exportam medicao mas ficaram sem read+export em medicao-visualizacao.', v_missing;
  end if;
end;
$$;
