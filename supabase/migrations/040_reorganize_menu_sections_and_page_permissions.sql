-- 040_reorganize_menu_sections_and_page_permissions.sql
-- Reorganiza secoes do menu e garante catalogo/permissoes das novas paginas.

insert into public.app_pages (page_key, path, name, section, description)
values
  ('home', '/home', 'Dashboard Estoque', 'Visao Geral', 'Painel inicial do tenant com resumo operacional.'),
  ('projetos', '/projetos', 'Projetos', 'Operacao', 'Cadastro e acompanhamento de projetos operacionais.'),
  ('locacao', '/locacao', 'Locacao', 'Operacao', 'Controle de locacao de recursos operacionais.'),
  ('programacao', '/programacao', 'Programacao', 'Operacao', 'Planejamento e agenda de operacoes.'),
  ('medicao', '/medicao', 'Medicao', 'Operacao', 'Controle e fechamento de medicoes operacionais.'),
  ('estoque', '/estoque', 'Estoque Atual', 'Almoxarifado', 'Consulta do saldo fisico consolidado.'),
  ('entrada', '/entrada', 'Entrada Estoque', 'Almoxarifado', 'Lancamentos de entrada no estoque.'),
  ('saida', '/saida', 'Saida Estoque', 'Almoxarifado', 'Lancamentos de saida no estoque.'),
  ('materiais', '/materiais', 'Materiais', 'Cadastros', 'Catalogo de materiais do tenant.'),
  ('pessoas', '/pessoas', 'Pessoas', 'Cadastros', 'Cadastro operacional de pessoas.'),
  ('cargo', '/cargo', 'Cargo', 'Cadastros', 'Cadastro base de cargos operacionais.'),
  ('prioridade', '/prioridade', 'Prioridade', 'Cadastro Base', 'Cadastro base de prioridades operacionais.'),
  ('centro-servico', '/centro-servico', 'Centro de Servico', 'Cadastro Base', 'Cadastro base de centros de servico.'),
  ('contrato', '/contrato', 'Contrato', 'Cadastro Base', 'Cadastro base de contratos do tenant.'),
  ('imei', '/imei', 'Imei', 'Cadastro Base', 'Cadastro base de identificadores IMEI.'),
  ('tipo-servico', '/tipo-servico', 'Tipo de Servico', 'Cadastro Base', 'Cadastro base de tipos de servico.'),
  ('nivel-tensao', '/nivel-tensao', 'Nivel de Tensao', 'Cadastro Base', 'Cadastro base de niveis de tensao.'),
  ('porte', '/porte', 'Porte', 'Cadastro Base', 'Cadastro base de classificacoes de porte.'),
  (
    'responsavel-distribuidora',
    '/responsavel-distribuidora',
    'Responsavel Distribuidora',
    'Cadastro Base',
    'Cadastro base de responsaveis da distribuidora.'
  ),
  ('municipio', '/municipio', 'Municipio', 'Cadastro Base', 'Cadastro base de municipios.')
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
    when roles.role_key = 'viewer' and pages.page_key in ('home', 'estoque') then true
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
 and pages.page_key in (
   'home',
   'projetos',
   'locacao',
   'programacao',
   'medicao',
   'estoque',
   'entrada',
   'saida',
   'materiais',
   'pessoas',
   'cargo',
   'prioridade',
   'centro-servico',
   'contrato',
   'imei',
   'tipo-servico',
   'nivel-tensao',
   'porte',
   'responsavel-distribuidora',
   'municipio'
 )
on conflict (tenant_id, role_id, page_key) do update
set
  can_access = excluded.can_access,
  updated_at = now();

with target_pages as (
  select page_key
  from public.app_pages
  where ativo = true
    and page_key in (
      'home',
      'projetos',
      'locacao',
      'programacao',
      'medicao',
      'estoque',
      'entrada',
      'saida',
      'materiais',
      'pessoas',
      'cargo',
      'prioridade',
      'centro-servico',
      'contrato',
      'imei',
      'tipo-servico',
      'nivel-tensao',
      'porte',
      'responsavel-distribuidora',
      'municipio'
    )
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
      when tu.role_key = 'viewer' and tp.page_key in ('home', 'estoque') then true
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
