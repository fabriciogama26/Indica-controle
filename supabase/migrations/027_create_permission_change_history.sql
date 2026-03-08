-- 027_create_permission_change_history.sql
-- Historico imutavel de alteracoes de role, status e liberacao de telas por usuario.

create table if not exists public.app_user_permission_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  target_user_id uuid not null references public.app_users(id) on delete cascade,
  page_key text references public.app_pages(page_key) on delete set null,
  change_type text not null,
  previous_can_access boolean,
  new_can_access boolean,
  previous_role_id uuid references public.app_roles(id),
  new_role_id uuid references public.app_roles(id),
  previous_ativo boolean,
  new_ativo boolean,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references public.app_users(id)
);

create index if not exists idx_app_user_permission_history_tenant_target_created
  on public.app_user_permission_history (tenant_id, target_user_id, created_at desc);

create index if not exists idx_app_user_permission_history_change_type
  on public.app_user_permission_history (change_type, created_at desc);

alter table if exists public.app_user_permission_history enable row level security;

drop policy if exists app_user_permission_history_tenant_select on public.app_user_permission_history;
create policy app_user_permission_history_tenant_select on public.app_user_permission_history
for select
to authenticated
using (public.user_can_access_tenant(app_user_permission_history.tenant_id));

drop policy if exists app_user_permission_history_tenant_insert on public.app_user_permission_history;
create policy app_user_permission_history_tenant_insert on public.app_user_permission_history
for insert
to authenticated
with check (public.user_is_admin_in_tenant(app_user_permission_history.tenant_id));

comment on table public.app_user_permission_history is
'Historico imutavel das alteracoes administrativas de permissoes por usuario, incluindo role, status, telas liberadas e convites.';
