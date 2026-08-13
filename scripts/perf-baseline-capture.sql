-- perf-baseline-capture.sql
-- Captura de BASELINE de performance, read-only, para comparacao antes/depois.
--
-- Diferenca para scripts/supabase-monitoring-readonly.sql: aquele e um retrato
-- amplo de SAUDE do banco (18 blocos heterogeneos, bom para diagnosticar). Este
-- e estreito e ESTAVEL de proposito — mesmas colunas, uma linha por queryid,
-- pensado para ser capturado duas vezes e DIFERENCIADO. Um nao substitui o
-- outro: rode o de saude para entender o banco, este para provar um delta.
--
-- Como rodar (requer link configurado via npm run db:link):
--   npm run db:check-link
--   npx supabase db query --file scripts/perf-baseline-capture.sql --linked > Auditoria/baseline/<AAAA-MM-DD>-<rotulo>.txt
--
-- ⚠️ NAO RODE ESTE ARQUIVO NO SQL EDITOR DO SUPABASE.
--   O editor devolve apenas o resultado do ULTIMO `select`, e este script tem 10
--   blocos separados — os outros nove somem sem erro nenhum. Foi o que aconteceu
--   nas coletas de 2026-08-12: chegava so o bloco final, rodada apos rodada, e os
--   blocos 00/02/03/04 nunca apareciam.
--   Para o SQL Editor use: scripts/perf-baseline-onequery.sql
--
-- LEIA O BLOCO 02 (VEREDITO) ANTES DE QUALQUER OUTRO NUMERO.
--   pg_stat_statements acumula TUDO que passou pelo banco: trafego da aplicacao,
--   pg_dump (COPY ... TO stdout), migrations, backfills e comandos manuais do
--   Studio. Numa janela de manutencao ou logo apos um restore, o topo da lista
--   e ruido de manutencao — e um `rows_per_call` de 3.952 pode ser um DUMP, nao
--   uma consulta de tela. O bloco 02 mede quanto do tempo veio de fato da
--   aplicacao e recusa a captura quando a amostra nao serve de baseline.
--
-- Regras de uso:
-- - Os contadores sao ACUMULADOS desde stats_reset. O valor de uma captura
--   isolada nao significa nada; o que importa e a diferenca entre duas capturas
--   (T1 - T0) por queryid.
-- - O bloco 00 traz `stats_reset` e o horario da captura. Se `stats_reset`
--   mudar entre T0 e T1, os contadores zeraram no meio e o diff e INVALIDO —
--   descarte e recapture.
-- - Este script NAO executa pg_stat_statements_reset(). Resetar e escrita e
--   cega qualquer outro observador do projeto.
-- - Nao altera dados. Nao cria objeto permanente.
--
-- Nota de manutencao (bug ja cometido aqui uma vez):
--   O SQL dinamico existe SO para resolver em qual schema pg_stat_statements
--   esta visivel. O template do format() nao pode conter nenhum '%' literal —
--   format() trata '%' como especificador, entao um ilike '%tabela%' dentro do
--   template quebra com "unrecognized format() type specifier". Por isso a
--   copia crua e dinamica e minima, e TODA a classificacao (que usa ilike com
--   curinga) fica em SQL estatico logo abaixo. Ao editar: se precisar de '%',
--   coloque em SQL estatico, nunca dentro do format().

-- ---------------------------------------------------------------------------
-- 00 - Metadados da captura (obrigatorio para validar o diff depois)
-- ---------------------------------------------------------------------------
select
  '00_captura_metadados'                                   as bloco,
  now()                                                    as capturado_em,
  d.stats_reset                                            as contadores_desde,
  age(now(), d.stats_reset)                                as janela_acumulada,
  current_database()                                       as database_name,
  pg_size_pretty(pg_database_size(d.datname))              as database_size,
  d.blks_read,
  d.blks_hit,
  round((100.0 * d.blks_hit / nullif(d.blks_hit + d.blks_read, 0))::numeric, 2) as cache_hit_pct_global,
  d.temp_files,
  pg_size_pretty(d.temp_bytes)                             as temp_escrito_total
from pg_stat_database d
where d.datname = current_database();

-- ---------------------------------------------------------------------------
-- 01a - Copia crua de pg_stat_statements (unica parte dinamica)
-- ---------------------------------------------------------------------------
create temp table perf_baseline_raw (
  queryid            text,
  query              text,
  calls              bigint,
  total_exec_time    double precision,
  mean_exec_time     double precision,
  rows_total         bigint,
  shared_blks_read   bigint,
  shared_blks_hit    bigint,
  temp_blks_read     bigint,
  temp_blks_written  bigint
) on commit drop;

create temp table perf_baseline_aviso (
  bloco  text,
  aviso  text
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

  if v_pgss is null then
    insert into pg_temp.perf_baseline_aviso (bloco, aviso)
    values (
      '01_baseline_por_query',
      'pg_stat_statements nao esta habilitada ou nao esta visivel para este usuario. '
      || 'Habilite em Dashboard do Supabase > Database > Extensions e recapture. '
      || 'Sem ela nao existe baseline: o Nivel B da auditoria fica bloqueado.'
    );
  else
    -- Template SEM nenhum '%' literal — so o '%s' da relacao. Ver nota de
    -- manutencao no topo do arquivo.
    execute format(
      'insert into pg_temp.perf_baseline_raw '
      || '(queryid, query, calls, total_exec_time, mean_exec_time, rows_total, '
      || ' shared_blks_read, shared_blks_hit, temp_blks_read, temp_blks_written) '
      || 'select s.queryid::text, s.query, s.calls, s.total_exec_time, s.mean_exec_time, '
      || '       s.rows, s.shared_blks_read, s.shared_blks_hit, '
      || '       s.temp_blks_read, s.temp_blks_written '
      || 'from %s s where s.calls > 0',
      v_pgss::text
    );
  end if;
end
$$;

select '01_aviso' as bloco, aviso from pg_temp.perf_baseline_aviso;

-- ---------------------------------------------------------------------------
-- 01b - Baseline por query (estatico: origem + rota + metricas por chamada)
-- ---------------------------------------------------------------------------
create temp table perf_baseline_queries as
with normalizado as (
  select
    r.*,
    -- Texto sem comentarios de cabecalho, para classificar pelo comando real.
    btrim(regexp_replace(regexp_replace(r.query, '--[^\n]*', ' ', 'g'), '\s+', ' ', 'g')) as query_limpa
  from pg_temp.perf_baseline_raw r
)
select
  '01_baseline_por_query'                                     as bloco,
  -- ORIGEM: separa trafego de aplicacao de ruido de manutencao. Sem esta
  -- coluna, um COPY de pg_dump aparece no topo de rows_per_call e e lido como
  -- se fosse uma consulta de tela.
  case
    when n.query_limpa ilike 'copy %'                              then 'dump/copy (pg_dump, NAO e a aplicacao)'
    when n.query_limpa ilike 'create %'
      or n.query_limpa ilike 'alter %'
      or n.query_limpa ilike 'drop %'
      or n.query_limpa ilike 'grant %'
      or n.query_limpa ilike 'revoke %'
      or n.query_limpa ilike 'comment on %'                        then 'ddl/migration'
    when n.query_limpa ilike 'vacuum%'
      or n.query_limpa ilike 'analyze%'
      or n.query_limpa ilike 'reindex%'
      or n.query_limpa ilike 'checkpoint%'                         then 'manutencao'
    -- PostgREST empacota toda requisicao da API numa CTE `pgrst_source`.
    -- E o fingerprint mais confiavel de trafego vindo da aplicacao.
    when n.query_limpa ilike '%pgrst_source%'
      or n.query_limpa ilike '%pgrst_payload%'                     then 'app (postgrest)'
    -- Migrations e scripts avulsos costumam ser insert/update/delete/with de
    -- carga unica, com poucas chamadas. Nao da para separar com certeza; fica
    -- em 'indefinido' para nao contaminar o veredito nos dois sentidos.
    else 'indefinido'
  end                                                         as origem,
  case
    when n.query ilike '%project_measurement_order_items%' then 'medicao/faturamento (itens)'
    when n.query ilike '%project_measurement_orders%'      then 'medicao/apuracao/dash-medicao'
    when n.query ilike '%stock_transfer_items%'            then 'dash-estoque (itens)'
    when n.query ilike '%stock_transfers%'                 then 'dash-estoque'
    -- `stock_centers` e lida por 8 rotas com filtros quase iguais; este bucket
    -- NAO isola o dash-estoque. O denominador de carregamentos nao sai daqui —
    -- ver Auditoria/07-baseline-p1.md §1.
    when n.query ilike '%stock_centers%'                   then 'stock_centers (compartilhada por varias rotas)'
    when n.query ilike '%project_with_labels%'             then 'projetos/dash-faturamento (view)'
    when n.query ilike '%project_billing_order%'           then 'faturamento'
    when n.query ilike '%project_asbuilt_measurement%'     then 'medicao-asbuilt'
    when n.query ilike '%project_programming%'             then 'programacao (legado)'
    when n.query ilike '%programming%'                     then 'programacao-normalizada'
    when n.query ilike '%stock_center_balances%'           then 'estoque (saldo)'
    when n.query ilike '%app_user_page_permissions%'
      or n.query ilike '%role_page_permissions%'           then 'auth/permissao (custo fixo por request)'
    else '-'
  end                                                         as rota_suspeita,
  n.queryid,
  n.calls,
  round(n.total_exec_time::numeric, 2)                        as total_exec_time_ms,
  round((100.0 * n.total_exec_time
         / nullif(sum(n.total_exec_time) over (), 0))::numeric, 2) as pct_do_tempo_total,
  round(n.mean_exec_time::numeric, 2)                         as mean_exec_time_ms,
  -- ATENCAO: para trafego PostgREST, `rows` NAO e o numero de linhas lidas.
  -- O PostgREST embrulha o resultado em json_agg(), entao o SELECT externo
  -- devolve SEMPRE 1 linha com o conjunto inteiro dentro de um JSON — e
  -- rows_per_call fica 1,00 mesmo numa consulta que varreu 20.000 linhas.
  -- Mantido so para queries que NAO sao postgrest. Para medir volume em
  -- consulta de aplicacao, use blks_total_per_call abaixo.
  round((n.rows_total::numeric        / nullif(n.calls, 0)), 2) as rows_per_call,
  -- Blocos TOCADOS por chamada (cache + disco), de 8 kB cada. E a medida de
  -- trabalho que sobrevive ao empacotamento do PostgREST: uma consulta que le
  -- 20.000 linhas toca muitos blocos, esteja o resultado em json_agg ou nao.
  round(((n.shared_blks_hit + n.shared_blks_read)::numeric
         / nullif(n.calls, 0)), 2)                            as blks_total_per_call,
  n.shared_blks_read,
  round((n.shared_blks_read::numeric  / nullif(n.calls, 0)), 2) as blks_read_per_call,
  n.shared_blks_hit,
  round((100.0 * n.shared_blks_hit
         / nullif(n.shared_blks_hit + n.shared_blks_read, 0))::numeric, 2) as cache_hit_pct,
  n.temp_blks_written,
  round((n.temp_blks_written::numeric / nullif(n.calls, 0)), 2) as temp_written_per_call,
  left(n.query_limpa, 500)                                    as query
from normalizado n;

-- ---------------------------------------------------------------------------
-- 02 - VEREDITO DA CAPTURA — ler ANTES de qualquer outro numero
-- ---------------------------------------------------------------------------
select
  '02_veredito' as bloco,
  case
    when (select count(*) from pg_temp.perf_baseline_queries) = 0
      then 'INVALIDA: pg_stat_statements vazia ou indisponivel.'
    when (select coalesce(sum(calls), 0) from pg_temp.perf_baseline_queries
          where origem = 'app (postgrest)') = 0
      then 'NAO SERVE DE BASELINE: nenhuma consulta de aplicacao (PostgREST) na amostra. '
           || 'Os contadores so tem dump/migration/manutencao. Provavel janela de restore, '
           || 'stats_reset recente, ou banco que nao e o de producao. Deixe a aplicacao rodar '
           || 'e recapture. NAO use rows_per_call desta captura: valores altos aqui sao COPY de pg_dump.'
    when (select coalesce(sum(calls), 0) from pg_temp.perf_baseline_queries
          where origem = 'app (postgrest)') < 500
      then 'FRACA: menos de 500 chamadas de aplicacao acumuladas. Serve para conferir se a '
           || 'coleta funciona, nao para baseline. Espere acumular trafego e recapture.'
    when (select coalesce(sum(total_exec_time_ms), 0) from pg_temp.perf_baseline_queries
          where origem = 'app (postgrest)')
       < 0.20 * (select coalesce(sum(total_exec_time_ms), 0) from pg_temp.perf_baseline_queries)
      then 'SUSPEITA: menos de 20% do tempo total veio da aplicacao. A janela esta dominada por '
           || 'manutencao. Confira o bloco 03 antes de concluir qualquer coisa.'
    else 'OK: amostra dominada por trafego de aplicacao. Pode ser usada como baseline.'
  end as veredito,
  (select coalesce(sum(calls), 0) from pg_temp.perf_baseline_queries
    where origem = 'app (postgrest)')                                          as chamadas_app,
  (select coalesce(sum(calls), 0) from pg_temp.perf_baseline_queries)          as chamadas_total,
  round((select coalesce(sum(total_exec_time_ms), 0) from pg_temp.perf_baseline_queries
          where origem = 'app (postgrest)'), 2)                                as tempo_app_ms,
  round((select coalesce(sum(total_exec_time_ms), 0) from pg_temp.perf_baseline_queries), 2) as tempo_total_ms;

-- 03 - De onde veio o tempo. Se 'dump/copy' ou 'ddl/migration' dominarem,
--      a captura e de janela de manutencao e nao representa a aplicacao.
select
  '03_tempo_por_origem' as bloco,
  origem,
  count(*)                                    as queries_distintas,
  sum(calls)                                  as chamadas,
  round(sum(total_exec_time_ms), 2)           as tempo_total_ms,
  round(100.0 * sum(total_exec_time_ms)
        / nullif(sum(sum(total_exec_time_ms)) over (), 0), 2) as pct_do_tempo
from pg_temp.perf_baseline_queries
group by origem
order by tempo_total_ms desc;

-- ---------------------------------------------------------------------------
-- 04 - Top por custo acumulado, SOMENTE trafego de aplicacao
--      `total_exec_time` e o criterio, nao `mean_exec_time`:
--      150 ms x 100.000 execucoes custa mais que 2 s x 10.
-- ---------------------------------------------------------------------------
select *
from pg_temp.perf_baseline_queries
where origem = 'app (postgrest)'
order by total_exec_time_ms desc nulls last
limit 40;

-- 04b - Mesmo top, sem filtro de origem. So para inspecionar o ruido —
--       NAO tirar conclusao de performance de aplicacao daqui.
select *
from pg_temp.perf_baseline_queries
where origem <> 'app (postgrest)'
order by total_exec_time_ms desc nulls last
limit 20;

-- ---------------------------------------------------------------------------
-- 05 - Recorte das rotas sob mudanca (P2.1 dash-estoque, P2.2 faturamento)
--      Este e o recorte que sera comparado depois da RPC.
--      O DENOMINADOR (nº de carregamentos do dashboard) nao sai daqui nem de
--      lugar nenhum do pg_stat_statements: nenhuma consulta do dash-estoque tem
--      assinatura unica o bastante para ser isolada. Pegue a contagem de
--      requisicoes de GET /api/dash-estoque no log da hospedagem.
--      Ver Auditoria/07-baseline-p1.md §1.
-- ---------------------------------------------------------------------------
select *
from pg_temp.perf_baseline_queries
where origem = 'app (postgrest)'
  and rota_suspeita in (
    'dash-estoque',
    'dash-estoque (itens)',
    'stock_centers (compartilhada por varias rotas)',
    'estoque (saldo)',
    'medicao/apuracao/dash-medicao',
    'medicao/faturamento (itens)',
    'projetos/dash-faturamento (view)',
    'faturamento'
  )
order by rota_suspeita, total_exec_time_ms desc nulls last;

-- ---------------------------------------------------------------------------
-- 06 - Sinais das 3 causas raiz de High Disk I/O (so aplicacao)
-- ---------------------------------------------------------------------------

-- Causa #1: memoria estourando work_mem e indo para disco.
select
  '06_causa1_spill_para_disco' as bloco,
  rota_suspeita, queryid, calls, temp_blks_written, temp_written_per_call,
  pg_size_pretty((temp_blks_written * 8192)::bigint) as temp_escrito, query
from pg_temp.perf_baseline_queries
where origem = 'app (postgrest)'
  and coalesce(temp_blks_written, 0) > 0
order by temp_blks_written desc
limit 25;

-- Causa #2: cache hit baixo com leitura de disco alta.
-- Alvo >= 99% em tabela quente. Abaixo de 90% com blks_read alto e ALTO.
select
  '06_causa2_cache_hit_baixo' as bloco,
  rota_suspeita, queryid, calls, cache_hit_pct, shared_blks_read, blks_read_per_call,
  pg_size_pretty((shared_blks_read * 8192)::bigint) as lido_do_disco, query
from pg_temp.perf_baseline_queries
where origem = 'app (postgrest)'
  and coalesce(shared_blks_read, 0) > 0
order by shared_blks_read desc
limit 25;

-- Causa #3: queries lentas. ~1 s e o limiar citado pela documentacao Supabase.
select
  '06_causa3_queries_lentas' as bloco,
  rota_suspeita, queryid, mean_exec_time_ms, calls, total_exec_time_ms,
  pct_do_tempo_total, rows_per_call, query
from pg_temp.perf_baseline_queries
where origem = 'app (postgrest)'
  and coalesce(mean_exec_time_ms, 0) > 1000
order by total_exec_time_ms desc;

-- ---------------------------------------------------------------------------
-- 07 - Custo por chamada das tabelas quentes (SO aplicacao)
--      E o bloco que CONFIRMA ou DERRUBA o achado estrutural do Nivel D
--      ("carrega milhares de linhas para agregar em JavaScript").
--
--      NAO use rows_per_call para isso: em trafego PostgREST ela e SEMPRE 1,00,
--      porque o json_agg() do PostgREST devolve o resultado inteiro empacotado
--      em uma unica linha. Uma consulta que varreu 20.000 linhas aparece com
--      rows_per_call = 1,00 igual a uma que leu uma linha so.
--
--      Use `blks_total_per_call` (blocos de 8 kB tocados por chamada):
--        < 100      (~800 kB)  leitura pontual, saudavel
--        100-1.000  (ate ~8 MB) recorte medio
--        > 1.000    (> ~8 MB)  varredura ampla por chamada — confirma o achado
--      Cruzar sempre com `calls`: custo acumulado = blocos/chamada x chamadas.
-- ---------------------------------------------------------------------------
select
  '07_custo_por_chamada' as bloco,
  rota_suspeita, queryid, calls,
  blks_total_per_call,
  pg_size_pretty((blks_total_per_call * 8192)::bigint) as lido_por_chamada,
  mean_exec_time_ms,
  total_exec_time_ms,
  blks_read_per_call,
  rows_per_call,          -- sempre 1,00 em postgrest; mantido so como evidencia
  query
from pg_temp.perf_baseline_queries
where origem = 'app (postgrest)'
  and rota_suspeita <> '-'
order by blks_total_per_call desc nulls last
limit 30;

-- ---------------------------------------------------------------------------
-- 08 - Consultas com MUITAS chamadas (candidatas a N+1)
--      Uma consulta barata chamada 20.000 vezes custa mais que uma cara chamada
--      10 vezes. Contagem muito acima do numero de carregamentos de tela e o
--      sintoma classico de N+1 — uma chamada por registro em vez de uma por lote.
-- ---------------------------------------------------------------------------
select
  '08_muitas_chamadas' as bloco,
  rota_suspeita, queryid, calls, mean_exec_time_ms, total_exec_time_ms,
  pct_do_tempo_total, blks_total_per_call, query
from pg_temp.perf_baseline_queries
where origem = 'app (postgrest)'
order by calls desc nulls last
limit 25;
