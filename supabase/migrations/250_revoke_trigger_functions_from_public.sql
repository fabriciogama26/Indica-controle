-- 250_revoke_trigger_functions_from_public.sql
-- Corrige funcoes SECURITY DEFINER criadas na migration 245 sem restricao de EXECUTE.
-- Adicionalmente: corrige search_path mutable (usa 'public' em vez de 'public, pg_temp').
--
-- Contexto: migration 210 aplicou REVOKE em todas as funcoes SECURITY DEFINER existentes,
-- mas as duas funcoes abaixo foram criadas depois sem o REVOKE obrigatorio.

revoke all on function public.ensure_app_page_default_user_permissions()
  from public, anon, authenticated;

revoke all on function public.ensure_app_user_default_page_permissions()
  from public, anon, authenticated;

alter function public.ensure_app_page_default_user_permissions()
  set search_path = public, pg_temp;

alter function public.ensure_app_user_default_page_permissions()
  set search_path = public, pg_temp;

-- Validacao: garante que as duas funcoes existem e estao SECURITY DEFINER
do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'ensure_app_page_default_user_permissions',
        'ensure_app_user_default_page_permissions'
      )
      and p.prosecdef = true
  ) then
    raise exception 'Migration 250: funcoes alvo nao encontradas ou nao sao SECURITY DEFINER';
  end if;
end;
$$;
