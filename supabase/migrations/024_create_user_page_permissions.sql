-- 024_create_user_page_permissions.sql
-- Matriz de permissoes por usuario e por tela, sem suporte a delete.

create table if not exists public.app_user_page_permissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null references public.app_users(id) on delete cascade,
  page_key text not null references public.app_pages(page_key) on delete cascade,
  can_access boolean not null default false,
  can_select boolean not null default false,
  can_insert boolean not null default false,
  can_update boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  unique (tenant_id, user_id, page_key)
);

create index if not exists idx_app_user_page_permissions_tenant_user
  on public.app_user_page_permissions (tenant_id, user_id, page_key);

alter table if exists public.app_user_page_permissions enable row level security;

drop policy if exists app_user_page_permissions_tenant_select on public.app_user_page_permissions;
create policy app_user_page_permissions_tenant_select on public.app_user_page_permissions
for select
to authenticated
using (public.user_can_access_tenant(app_user_page_permissions.tenant_id));

drop policy if exists app_user_page_permissions_tenant_write on public.app_user_page_permissions;
create policy app_user_page_permissions_tenant_write on public.app_user_page_permissions
for all
to authenticated
using (public.user_is_admin_in_tenant(app_user_page_permissions.tenant_id))
with check (public.user_is_admin_in_tenant(app_user_page_permissions.tenant_id));

drop trigger if exists trg_app_user_page_permissions_audit on public.app_user_page_permissions;
create trigger trg_app_user_page_permissions_audit before insert or update on public.app_user_page_permissions
for each row execute function public.apply_audit_fields();

create or replace function public.user_has_page_action(p_page_key text, p_action text)
returns boolean
language sql
stable
as $$
  with current_app_user as (
    select au.id, au.tenant_id
    from public.app_users au
    where au.auth_user_id = auth.uid()
      and au.ativo = true
    limit 1
  )
  select coalesce(
    (
      select case lower(trim(coalesce(p_action, '')))
        when 'access' then upp.can_access
        when 'select' then upp.can_access and upp.can_select
        when 'insert' then upp.can_access and upp.can_insert
        when 'update' then upp.can_access and upp.can_update
        else false
      end
      from public.app_user_page_permissions upp
      join current_app_user cu
        on cu.id = upp.user_id
       and cu.tenant_id = upp.tenant_id
      where upp.page_key = p_page_key
      limit 1
    ),
    false
  )
$$;

comment on function public.user_has_page_action(text, text) is
'Retorna true quando o usuario autenticado possui permissao explicita para a tela e acao informadas em app_user_page_permissions.';
