-- 022_create_page_permissions.sql
-- Base de permissoes por pagina para controle de acesso no frontend e no backend.

create table if not exists public.app_pages (
  id uuid primary key default gen_random_uuid(),
  page_key text not null unique,
  path text not null unique,
  name text not null,
  section text not null default 'Operacao',
  description text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id)
);

create table if not exists public.role_page_permissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  role text not null,
  page_key text not null references public.app_pages(page_key) on delete cascade,
  can_access boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  unique (tenant_id, role, page_key)
);

create index if not exists idx_app_pages_section
  on public.app_pages (section, page_key);

create index if not exists idx_role_page_permissions_tenant_role
  on public.role_page_permissions (tenant_id, role, page_key);

alter table if exists public.app_pages enable row level security;
alter table if exists public.role_page_permissions enable row level security;

create or replace function public.user_is_admin_in_tenant(p_tenant_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.app_users au
    where au.auth_user_id = auth.uid()
      and au.tenant_id = p_tenant_id
      and au.ativo = true
      and lower(coalesce(au.role, '')) = 'admin'
  )
$$;

drop policy if exists app_pages_authenticated_select on public.app_pages;
create policy app_pages_authenticated_select on public.app_pages
for select
to authenticated
using (ativo = true);

drop policy if exists role_page_permissions_tenant_select on public.role_page_permissions;
create policy role_page_permissions_tenant_select on public.role_page_permissions
for select
to authenticated
using (public.user_can_access_tenant(role_page_permissions.tenant_id));

drop policy if exists role_page_permissions_tenant_write on public.role_page_permissions;
create policy role_page_permissions_tenant_write on public.role_page_permissions
for all
to authenticated
using (public.user_is_admin_in_tenant(role_page_permissions.tenant_id))
with check (public.user_is_admin_in_tenant(role_page_permissions.tenant_id));

drop trigger if exists trg_app_pages_audit on public.app_pages;
create trigger trg_app_pages_audit before insert or update on public.app_pages
for each row execute function public.apply_audit_fields();

drop trigger if exists trg_role_page_permissions_audit on public.role_page_permissions;
create trigger trg_role_page_permissions_audit before insert or update on public.role_page_permissions
for each row execute function public.apply_audit_fields();

insert into public.app_pages (page_key, path, name, section, description)
values
  ('home', '/home', 'Home', 'Visao Geral', 'Painel inicial do tenant.'),
  ('estoque', '/estoque', 'Estoque Atual', 'Operacao', 'Consulta do saldo fisico consolidado.'),
  ('entrada', '/entrada', 'Entradas', 'Operacao', 'Lancamentos de entrada no estoque.'),
  ('saida', '/saida', 'Saidas', 'Operacao', 'Lancamentos de saida do estoque.'),
  ('pessoas', '/pessoas', 'Pessoas', 'Cadastros', 'Cadastro operacional de pessoas.'),
  ('materiais', '/materiais', 'Materiais', 'Cadastros', 'Catalogo de materiais do tenant.'),
  ('cadastro-base', '/cadastro-base', 'Cadastro Base', 'Cadastros', 'Ponto de entrada para cadastros de apoio.'),
  ('permissoes', '/permissoes', 'Permissoes', 'Configuracoes', 'Gerenciamento futuro de acesso por pagina.')
on conflict (page_key) do update
set
  path = excluded.path,
  name = excluded.name,
  section = excluded.section,
  description = excluded.description,
  ativo = true;

insert into public.role_page_permissions (tenant_id, role, page_key, can_access)
select
  tenants.tenant_id,
  'admin',
  pages.page_key,
  true
from (
  select distinct tenant_id
  from public.app_users
  where tenant_id is not null
) as tenants
cross join public.app_pages as pages
on conflict (tenant_id, role, page_key) do nothing;

insert into public.role_page_permissions (tenant_id, role, page_key, can_access)
select
  tenants.tenant_id,
  'user',
  pages.page_key,
  true
from (
  select distinct tenant_id
  from public.app_users
  where tenant_id is not null
) as tenants
join public.app_pages as pages
  on pages.page_key in ('home', 'estoque', 'entrada', 'saida', 'pessoas', 'materiais', 'cadastro-base')
on conflict (tenant_id, role, page_key) do nothing;

comment on function public.user_is_admin_in_tenant(uuid) is
'Retorna true quando o auth.uid() atual pertence a um app_users ativo do tenant informado com role admin.';
