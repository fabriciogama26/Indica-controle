-- 309_restrict_admin_rpc_execute_to_service_role.sql
-- Revoga EXECUTE de anon e authenticated nas RPCs SECURITY DEFINER que
-- regrediram apos as migrations 307 e 308.
--
-- Contexto: as migrations 307 (save_project_record) e 308
-- (save_team_stock_operation_record) recriaram as funcoes com
-- "grant execute ... to authenticated" e revogaram apenas FROM public,
-- reabrindo a superficie de execucao direta pelo client. A arquitetura usa
-- exclusivamente o client service_role no servidor (Next.js API routes);
-- nenhuma dessas RPCs e chamada com JWT de usuario autenticado.
-- O grant implicito a anon permaneceu em save_project_record porque o
-- REVOKE anterior cobria apenas FROM public (role), nao FROM anon.
--
-- Mesmo padrao das migrations 210 e 251: varredura dinamica para cobrir
-- qualquer assinatura remanescente, seguida de validacao que falha a
-- migration se sobrar qualquer funcao SECURITY DEFINER executavel por
-- anon ou authenticated.

do $$
declare
  r record;
begin
  for r in
    select
      p.oid,
      n.nspname as schema_name,
      p.proname as function_name,
      pg_get_function_identity_arguments(p.oid) as identity_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef = true
      and (
        has_function_privilege('anon',          p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute')
      )
  loop
    if has_function_privilege('anon', r.oid, 'execute') then
      execute format(
        'revoke execute on function %I.%I(%s) from anon',
        r.schema_name, r.function_name, r.identity_args
      );
    end if;

    if has_function_privilege('authenticated', r.oid, 'execute') then
      execute format(
        'revoke execute on function %I.%I(%s) from authenticated',
        r.schema_name, r.function_name, r.identity_args
      );
    end if;
  end loop;
end;
$$;

-- Validacao: nenhuma funcao SECURITY DEFINER deve ser chamavel por anon ou authenticated
do $$
declare
  v_row   record;
  v_count int := 0;
begin
  for v_row in
    select
      n.nspname || '.' || p.proname ||
        '(' || pg_get_function_identity_arguments(p.oid) || ')' as func_sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef = true
      and (
        has_function_privilege('anon',          p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute')
      )
  loop
    raise warning 'AINDA EXPOSTA: %', v_row.func_sig;
    v_count := v_count + 1;
  end loop;

  if v_count > 0 then
    raise exception
      'Migration 309: % funcao(oes) SECURITY DEFINER ainda acessiveis por anon/authenticated. Veja WARNINGs.',
      v_count;
  end if;
end;
$$;
