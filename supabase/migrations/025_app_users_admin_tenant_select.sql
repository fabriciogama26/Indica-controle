-- 025_app_users_admin_tenant_select.sql
-- Permite que perfis administrativos leiam app_users do proprio tenant via RLS autenticada.

drop policy if exists app_users_tenant_admin_select on public.app_users;
create policy app_users_tenant_admin_select on public.app_users
for select
to authenticated
using (
  exists (
    select 1
    from public.app_users current_app_user
    join public.app_roles current_app_role
      on current_app_role.id = current_app_user.role_id
    where current_app_user.auth_user_id = auth.uid()
      and current_app_user.ativo = true
      and current_app_role.ativo = true
      and current_app_role.is_admin = true
      and current_app_user.tenant_id = app_users.tenant_id
  )
);
