-- 377_drop_unused_stock_conflict_views.sql
-- Remove v_stock_conflicts e v_stock_conflict_items.
--
-- Contexto: a migration 007 criou as duas views SEM `security_invoker = true`.
-- View sem essa opcao executa com privilegio do owner e ignora a RLS por tenant
-- da tabela base `stock_conflicts` (006/020/021). No banco de producao a opcao
-- foi corrigida a mao, fora do versionamento -- ou seja, producao esta correta
-- mas qualquer ambiente reconstruido a partir das migrations (db reset, branch
-- de preview, projeto novo) nasce com a RLS efetivamente desligada nessas views.
--
-- Nenhum consumidor em `src/` referencia as duas views. Em vez de versionar a
-- correcao de um objeto sem uso, o objeto e removido: resolve o drift e elimina
-- a superficie exposta de uma vez. Se a tela de conflitos precisar delas no
-- futuro, recriar seguindo a regra 23 do `guias/guia_sql.md`.

begin;

drop view if exists public.v_stock_conflict_items;
drop view if exists public.v_stock_conflicts;

-- Validacao pos-aplicacao: nenhuma view de `public` acessivel por anon/authenticated
-- pode ficar sem `security_invoker = true`. Mesmo padrao de guarda da migration 375.
do $$
declare
  v_offenders text;
begin
  select string_agg(c.relname, ', ' order by c.relname)
    into v_offenders
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'v'
    and coalesce(array_to_string(c.reloptions, ','), '') not like '%security_invoker=true%'
    and (
      has_table_privilege('anon',          c.oid, 'select')
      or has_table_privilege('authenticated', c.oid, 'select')
    );

  if v_offenders is not null then
    raise exception '377: views sem security_invoker expostas a anon/authenticated: %', v_offenders;
  end if;
end;
$$;

commit;
