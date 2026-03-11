-- 028_add_operation_menu_pages.sql
-- Atualiza o catalogo de paginas para o novo menu de operacao e inclui novas telas.

insert into public.app_pages (page_key, path, name, section, description)
values
  ('projetos', '/projetos', 'Projetos', 'Operacao', 'Cadastro e acompanhamento de projetos operacionais.'),
  ('locacao', '/locacao', 'Locacao', 'Operacao', 'Controle de locacao de recursos operacionais.'),
  ('programacao', '/programacao', 'Programacao', 'Operacao', 'Planejamento e agenda de operacoes.'),
  ('materiais', '/materiais', 'Materiais', 'Operacao', 'Catalogo de materiais do tenant.'),
  ('entrada', '/entrada', 'Entrada Estoque', 'Operacao', 'Lancamentos de entrada no estoque.'),
  ('saida', '/saida', 'Saida Estoque', 'Operacao', 'Lancamentos de saida do estoque.')
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
  true
from (
  select distinct tenant_id
  from public.app_users
  where tenant_id is not null
) as tenants
join public.app_roles as roles
  on roles.ativo = true
 and roles.role_key in ('admin', 'master', 'supervisor', 'user')
join public.app_pages as pages
  on pages.ativo = true
 and pages.page_key in ('projetos', 'locacao', 'programacao', 'materiais', 'entrada', 'saida')
on conflict (tenant_id, role_id, page_key) do update
set
  can_access = excluded.can_access,
  updated_at = now();
