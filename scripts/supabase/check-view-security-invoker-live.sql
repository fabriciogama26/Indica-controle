-- check-view-security-invoker-live.sql
-- Consulta ao vivo no banco: identifica views de `public` sem
-- `security_invoker = true`, e materialized views expostas a anon/authenticated.
--
-- Como rodar (requer link configurado via npm run db:link):
--   npm run db:view-check-live
--
-- View sem `security_invoker` executa com privilegio do owner e ignora a RLS das
-- tabelas base. Materialized view nunca aplica RLS: precisa de revoke explicito.
--
-- Atencao: este check passa em producao mesmo quando as migrations estao erradas,
-- porque le o estado vivo. O check estatico (`npm run db:view-check`) e o que pega
-- o problema na origem. Rode os dois.

do $$
declare
  v_row   record;
  v_count int := 0;
begin
  for v_row in
    select
      c.relname,
      c.relkind,
      coalesce(array_to_string(c.reloptions, ','), '') as opts,
      has_table_privilege('anon',          c.oid, 'select') as anon_select,
      has_table_privilege('authenticated', c.oid, 'select') as auth_select
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('v', 'm')
      and (
        has_table_privilege('anon',          c.oid, 'select')
        or has_table_privilege('authenticated', c.oid, 'select')
      )
      and (
        (c.relkind = 'v' and coalesce(array_to_string(c.reloptions, ','), '') not like '%security_invoker=true%')
        or c.relkind = 'm'
      )
    order by c.relname
  loop
    if v_row.relkind = 'm' then
      raise warning 'MATERIALIZED VIEW SEM RLS: % | anon=% auth=%',
        v_row.relname, v_row.anon_select, v_row.auth_select;
    else
      raise warning 'VIEW SEM security_invoker: % | opts=[%] anon=% auth=%',
        v_row.relname, v_row.opts, v_row.anon_select, v_row.auth_select;
    end if;
    v_count := v_count + 1;
  end loop;

  if v_count > 0 then
    raise exception
      'FALHA: % view(s)/matview(s) expostas sem isolamento por tenant. Veja WARNINGs acima.',
      v_count;
  else
    raise notice 'OK: nenhuma view exposta sem security_invoker.';
  end if;
end;
$$;
