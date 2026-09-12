-- check-security-definer-live.sql
-- Consulta ao vivo no banco: identifica funcoes SECURITY DEFINER acessiveis
-- por anon ou authenticated no schema public.
--
-- Como rodar (requer link configurado via npm run db:link):
--   npm run db:security-check-live
--
-- Nenhuma funcao deve aparecer nos WARNINGs. Se aparecer, adicione REVOKE na
-- migration que criou a funcao e rode npm run db:migration-list para verificar.

do $$
declare
  v_row   record;
  v_count int := 0;
begin
  for v_row in
    select
      n.nspname || '.' || p.proname ||
        '(' || pg_get_function_identity_arguments(p.oid) || ')' as func_sig,
      has_function_privilege('anon',          p.oid, 'execute') as anon_exec,
      has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef = true
      and (
        has_function_privilege('anon',          p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute')
      )
    order by p.proname
  loop
    raise warning 'EXPOSTA: % | anon=% auth=%',
      v_row.func_sig, v_row.anon_exec, v_row.auth_exec;
    v_count := v_count + 1;
  end loop;

  if v_count > 0 then
    raise exception
      'FALHA: % funcao(oes) SECURITY DEFINER acessiveis por anon/authenticated. Veja WARNINGs acima.',
      v_count;
  else
    raise notice 'OK: nenhuma funcao SECURITY DEFINER exposta para anon/authenticated.';
  end if;
end;
$$;
