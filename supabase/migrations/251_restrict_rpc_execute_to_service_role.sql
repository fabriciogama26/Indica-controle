-- 251_restrict_rpc_execute_to_service_role.sql
-- Revoga EXECUTE de anon e authenticated em todas as RPCs SECURITY DEFINER
-- no schema public que ficaram expostas apos as migrations 212-247.
--
-- Contexto: a arquitetura usa exclusivamente o client service_role no servidor
-- (Next.js API routes). Nenhuma RPC e chamada com JWT de usuario autenticado.
-- Os grants a authenticated foram adicionados entre migrations 212-247 sem
-- necessidade real. Alguns tambem ficaram com grant implicito a anon porque
-- o REVOKE anterior cobria apenas FROM public (role), nao FROM anon.
--
-- Usa DO block dinamico (mesmo padrao da migration 210) para garantir
-- cobertura de todos os casos sem depender de assinaturas fixas.

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
      'Migration 251: % funcao(oes) SECURITY DEFINER ainda acessiveis por anon/authenticated. Veja WARNINGs.',
      v_count;
  end if;
end;
$$;
