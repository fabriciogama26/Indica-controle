-- perf-baseline-onequery.sql
-- MESMA coleta de scripts/perf-baseline-capture.sql, porem devolvendo TUDO em
-- UM UNICO resultado.
--
-- POR QUE ESTE ARQUIVO EXISTE
-- ---------------------------------------------------------------------------
-- O SQL Editor do Supabase mostra apenas o resultado do ULTIMO `select` do
-- arquivo. Como `perf-baseline-capture.sql` tem 10 blocos separados, rodar
-- aquele script no editor devolve so o bloco final e descarta os outros nove —
-- foi exatamente o que aconteceu nas coletas de 2026-08-12, em que sempre
-- chegava o ultimo bloco e nunca o `00`, `02`, `03` ou `04`.
--
-- Aqui os blocos sao empilhados com `union all` num unico `select`, entao o
-- editor devolve o conjunto completo. O `do $$` que popula as temp tables nao
-- produz resultado, entao nao atrapalha.
--
-- QUAL USAR
--   SQL Editor do Supabase  -> ESTE arquivo.
--   `npx supabase db query`  -> perf-baseline-capture.sql (imprime todos os
--                               blocos e tem os recortes extras das causas raiz).
--
-- Como rodar: colar o conteudo inteiro no SQL Editor e executar. Copiar a
-- tabela inteira do resultado.
--
-- Read-only: nao altera dados, nao reseta contadores, nao cria objeto
-- permanente. As colunas numericas ficam nulas nas linhas de texto (blocos 00,
-- 02 e 03) — isso e esperado.
--
-- Nota de manutencao: o template do `format()` NAO pode conter '%' literal
-- (format trata como especificador). Toda classificacao com `ilike '%x%'` fica
-- em SQL estatico. Ver o mesmo aviso em perf-baseline-capture.sql.

create temp table pb_raw (
  queryid            text,
  query              text,
  calls              bigint,
  total_exec_time    double precision,
  mean_exec_time     double precision,
  rows_total         bigint,
  shared_blks_read   bigint,
  shared_blks_hit    bigint,
  temp_blks_written  bigint
) on commit drop;

do $$
declare
  v_pgss regclass;
begin
  v_pgss := coalesce(
    to_regclass('public.pg_stat_statements'),
    to_regclass('extensions.pg_stat_statements'),
    to_regclass('pg_stat_statements')
  );

  if v_pgss is not null then
    execute format(
      'insert into pg_temp.pb_raw '
      || '(queryid, query, calls, total_exec_time, mean_exec_time, rows_total, '
      || ' shared_blks_read, shared_blks_hit, temp_blks_written) '
      || 'select s.queryid::text, s.query, s.calls, s.total_exec_time, s.mean_exec_time, '
      || '       s.rows, s.shared_blks_read, s.shared_blks_hit, s.temp_blks_written '
      || 'from %s s where s.calls > 0',
      v_pgss::text
    );
  end if;
end
$$;

create temp table pb as
select
  r.queryid,
  case
    when btrim(regexp_replace(regexp_replace(r.query, '--[^\n]*', ' ', 'g'), '\s+', ' ', 'g')) ilike 'copy %'
      then 'dump/copy'
    when btrim(regexp_replace(regexp_replace(r.query, '--[^\n]*', ' ', 'g'), '\s+', ' ', 'g')) ilike 'create %'
      or btrim(regexp_replace(regexp_replace(r.query, '--[^\n]*', ' ', 'g'), '\s+', ' ', 'g')) ilike 'alter %'
      or btrim(regexp_replace(regexp_replace(r.query, '--[^\n]*', ' ', 'g'), '\s+', ' ', 'g')) ilike 'drop %'
      then 'ddl/migration'
    when r.query ilike '%pgrst_source%' or r.query ilike '%pgrst_payload%'
      then 'app (postgrest)'
    -- Preambulo que o PostgREST roda a CADA requisicao para montar o contexto
    -- da sessao. Nao e query de negocio, mas e custo de aplicacao: aparece uma
    -- vez por request. Media de 2026-08-13: 1.305.413 chamadas, 8,96% do tempo.
    when r.query ilike '%set_config(%request.jwt.claims%'
      or (r.query ilike 'select set_config(%' and r.query ilike '%search_path%')
      then 'app (postgrest setup)'
    -- Introspecao do proprio Supabase Studio: Table Editor, Extensions,
    -- catalogo de funcoes, privilegios, fusos. NAO e a aplicacao. Na captura de
    -- 2026-08-13 somava ~32% do tempo do banco e 100% do spill para disco.
    when r.query ilike '%pg_available_extensions%'
      or r.query ilike '%pg_timezone_names%'
      or r.query ilike '%base_table_info%'
      or r.query ilike '%table_privileges%'
      or r.query ilike '%proargmodes%'
      or r.query ilike '%pg_stat_statements%'
      or r.query ilike '%quoted_name%'
      then 'studio/introspeccao'
    else 'indefinido'
  end as origem,
  case
    when r.query ilike '%project_measurement_order_items%' then 'medicao/faturamento (itens)'
    when r.query ilike '%project_measurement_orders%'      then 'medicao/apuracao/dash-medicao'
    when r.query ilike '%stock_transfer_item_reversals%'   then 'dash-estoque (estorno item)'
    when r.query ilike '%stock_transfer_reversals%'        then 'dash-estoque (estorno transf)'
    when r.query ilike '%stock_transfer_items%'            then 'dash-estoque (itens)'
    when r.query ilike '%stock_transfers%'                 then 'dash-estoque'
    when r.query ilike '%project_with_labels%'             then 'projetos/dash-faturamento (view)'
    when r.query ilike '%project_billing_order%'           then 'faturamento'
    when r.query ilike '%project_asbuilt_measurement%'     then 'medicao-asbuilt'
    when r.query ilike '%project_programming%'             then 'programacao (legado)'
    when r.query ilike '%programming%'                     then 'programacao-normalizada'
    when r.query ilike '%stock_center_balances%'           then 'estoque (saldo)'
    when r.query ilike '%app_user_page_permissions%'
      or r.query ilike '%role_page_permissions%'
      or r.query ilike '%app_users%'
      or r.query ilike '%app_roles%'
      or r.query ilike '%app_user_tenants%'                then 'auth/permissao'
    else '-'
  end as rota,
  r.calls,
  round(r.total_exec_time::numeric, 2) as total_ms,
  round((100.0 * r.total_exec_time / nullif(sum(r.total_exec_time) over (), 0))::numeric, 2) as pct_tempo,
  round(r.mean_exec_time::numeric, 2) as mean_ms,
  round(((r.shared_blks_hit + r.shared_blks_read)::numeric / nullif(r.calls, 0)), 2) as blks_call,
  round((r.shared_blks_read::numeric / nullif(r.calls, 0)), 2) as blks_read_call,
  round((100.0 * r.shared_blks_hit
         / nullif(r.shared_blks_hit + r.shared_blks_read, 0))::numeric, 2) as cache_hit_pct,
  r.temp_blks_written,
  left(regexp_replace(r.query, '\s+', ' ', 'g'), 220) as query
from pg_temp.pb_raw r;

-- =============================================================================
-- RESULTADO UNICO — copiar a tabela inteira
-- =============================================================================
select ord, bloco, info, calls, total_ms, pct_tempo, mean_ms, blks_call,
       blks_read_call, cache_hit_pct, temp_blks_written, query
from (
  -- 00 - metadados da janela
  select 0 as ord, '00_meta' as bloco,
         'contadores_desde=' || coalesce(d.stats_reset::text, 'NULL')
           || ' | janela=' || coalesce(age(now(), d.stats_reset)::text, 'NULL')
           || ' | db=' || pg_size_pretty(pg_database_size(d.datname))
           || ' | cache_hit_global=' || coalesce(round((100.0 * d.blks_hit
                / nullif(d.blks_hit + d.blks_read, 0))::numeric, 2)::text, 'NULL')
           || ' | temp_total=' || pg_size_pretty(d.temp_bytes) as info,
         -- TODAS as colunas precisam de alias AQUI: num `union all` o Postgres
         -- tira os nomes do PRIMEIRO ramo. Sem alias, `null::bigint` vira
         -- `?column?` e o select externo falha com
         -- `42703: column "calls" does not exist`.
         null::bigint  as calls,
         null::numeric as total_ms,
         null::numeric as pct_tempo,
         null::numeric as mean_ms,
         null::numeric as blks_call,
         null::numeric as blks_read_call,
         null::numeric as cache_hit_pct,
         null::bigint  as temp_blks_written,
         null::text    as query
  from pg_stat_database d
  where d.datname = current_database()

  union all
  -- 02 - veredito
  select 1, '02_veredito',
         case
           when (select count(*) from pg_temp.pb) = 0
             then 'INVALIDA: pg_stat_statements vazia ou nao habilitada'
           when (select coalesce(sum(calls), 0) from pg_temp.pb where origem = 'app (postgrest)') = 0
             then 'NAO SERVE: nenhuma consulta de aplicacao na amostra'
           when (select coalesce(sum(calls), 0) from pg_temp.pb where origem = 'app (postgrest)') < 500
             then 'FRACA: menos de 500 chamadas de aplicacao'
           else 'OK: amostra dominada por trafego de aplicacao'
         end
         || ' | chamadas_app=' || (select coalesce(sum(calls), 0) from pg_temp.pb where origem = 'app (postgrest)')
         || ' | chamadas_total=' || (select coalesce(sum(calls), 0) from pg_temp.pb),
         null, null, null, null, null, null, null, null, null

  union all
  -- 03 - tempo por origem
  select 2, '03_origem', origem,
         sum(calls), round(sum(total_ms), 2),
         round(100.0 * sum(total_ms) / nullif(sum(sum(total_ms)) over (), 0), 2),
         null, null, null, null, null, null
  from pg_temp.pb
  group by origem

  union all
  -- 04 - TOP 25 por custo acumulado (so aplicacao) — o ranking que fecha o Nivel B
  select 3, '04_top_custo', rota, calls, total_ms, pct_tempo, mean_ms,
         blks_call, blks_read_call, cache_hit_pct, temp_blks_written, query
  from (
    select * from pg_temp.pb
    where origem = 'app (postgrest)'
    order by total_ms desc nulls last
    limit 25
  ) t4

  union all
  -- 04b - TOP 10 fora da aplicacao (ruido: dump, migration)
  select 4, '04b_ruido', rota, calls, total_ms, pct_tempo, mean_ms,
         blks_call, blks_read_call, cache_hit_pct, temp_blks_written, query
  from (
    select * from pg_temp.pb
    where origem <> 'app (postgrest)'
    order by total_ms desc nulls last
    limit 10
  ) t4b

  union all
  -- 08 - TOP 25 por numero de chamadas (fan-out)
  select 5, '08_chamadas', rota, calls, total_ms, pct_tempo, mean_ms,
         blks_call, blks_read_call, cache_hit_pct, temp_blks_written, query
  from (
    select * from pg_temp.pb
    where origem = 'app (postgrest)'
    order by calls desc nulls last
    limit 25
  ) t8

  union all
  -- 06 - spill para disco (qualquer linha aqui e achado)
  select 6, '06_spill', rota, calls, total_ms, pct_tempo, mean_ms,
         blks_call, blks_read_call, cache_hit_pct, temp_blks_written, query
  from pg_temp.pb
  where coalesce(temp_blks_written, 0) > 0
) resultado
order by ord, total_ms desc nulls last;
