-- 026_simplify_user_page_permissions.sql
-- Simplifica a matriz por usuario para permissao unica por tela.

alter table if exists public.app_user_page_permissions
  drop column if exists can_select,
  drop column if exists can_insert,
  drop column if exists can_update;

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
      select upp.can_access
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
'Retorna true quando o usuario autenticado possui permissao explicita para visualizar a tela informada em app_user_page_permissions.';
