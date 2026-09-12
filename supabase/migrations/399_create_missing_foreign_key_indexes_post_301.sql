-- 399_create_missing_foreign_key_indexes_post_301.sql
-- Fecha a nova leva de alertas INFO `unindexed_foreign_keys` do Supabase Advisor.
--
-- A migration 301 ja corrigiu as FKs existentes naquela data. Desde entao,
-- novas tabelas e novas relacoes foram criadas; esta migration repete a
-- varredura dinamica para cobrir o estado atual do banco sem listar 62 FKs a
-- mao.
--
-- Observacao operacional:
-- - A migration cria indices nas colunas da FK na ordem declarada pela constraint,
--   que e o criterio usado pelo linter para considerar a FK coberta.
-- - `unused_index` NAO e tratado aqui: remover indices marcados como "unused"
--   exige auditoria de workload/periodo, pois estatisticas podem zerar apos
--   deploy, restore ou pouca janela de uso.

do $$
declare
  v_fk record;
  v_index_name text;
begin
  for v_fk in
    with foreign_keys as (
      select
        c.oid as constraint_oid,
        n.nspname as schema_name,
        t.relname as table_name,
        c.conname as constraint_name,
        c.conkey as key_attnums,
        string_agg(quote_ident(a.attname), ', ' order by k.ordinality) as index_columns
      from pg_constraint c
      join pg_class t
        on t.oid = c.conrelid
      join pg_namespace n
        on n.oid = t.relnamespace
      join unnest(c.conkey) with ordinality as k(attnum, ordinality)
        on true
      join pg_attribute a
        on a.attrelid = c.conrelid
       and a.attnum = k.attnum
      where c.contype = 'f'
        and n.nspname = 'public'
        and t.relkind in ('r', 'p')
      group by c.oid, n.nspname, t.relname, c.conname, c.conrelid, c.conkey
      having not exists (
        select 1
        from pg_index i
        where i.indrelid = c.conrelid
          and i.indisvalid = true
          and i.indisready = true
          and i.indpred is null
          and array(
            select indexed_attnum
            from unnest((i.indkey::int2[])[0:array_length(c.conkey, 1) - 1]) as indexed(indexed_attnum)
          ) = c.conkey
      )
    )
    select *
    from foreign_keys
    order by schema_name, table_name, constraint_name
  loop
    v_index_name := left(
      format('idx_fk_%s_%s', v_fk.table_name, v_fk.constraint_name),
      54
    ) || '_' || substr(md5(v_fk.schema_name || '.' || v_fk.table_name || '.' || v_fk.constraint_name), 1, 8);

    execute format(
      'create index if not exists %I on %I.%I (%s)',
      v_index_name,
      v_fk.schema_name,
      v_fk.table_name,
      v_fk.index_columns
    );
  end loop;
end;
$$;

do $$
declare
  v_remaining integer;
begin
  with foreign_keys as (
    select
      c.oid as constraint_oid,
      c.conrelid,
      c.conkey
    from pg_constraint c
    join pg_class t
      on t.oid = c.conrelid
    join pg_namespace n
      on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and t.relkind in ('r', 'p')
      and not exists (
        select 1
        from pg_index i
        where i.indrelid = c.conrelid
          and i.indisvalid = true
          and i.indisready = true
          and i.indpred is null
          and array(
            select indexed_attnum
            from unnest((i.indkey::int2[])[0:array_length(c.conkey, 1) - 1]) as indexed(indexed_attnum)
          ) = c.conkey
      )
  )
  select count(*)
  into v_remaining
  from foreign_keys;

  if coalesce(v_remaining, 0) > 0 then
    raise exception '399: ainda existem % foreign keys publicas sem indice cobrindo as colunas', v_remaining;
  end if;
end;
$$;
