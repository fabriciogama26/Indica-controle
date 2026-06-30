-- supabase-monitoring-readonly.sql
-- Monitoramento read-only do banco Supabase/Postgres.
--
-- Para criar o relatorio no Supabase Reports, use:
--   scripts/supabase-report-indica-controle-saude-io-performance.txt
--
-- Como rodar (requer link configurado via npm run db:link):
--   npm run db:check-link
--   npx supabase db query --file scripts/supabase-monitoring-readonly.sql --linked
--
-- Observacoes:
-- - Os contadores de pg_stat_* sao acumulados desde o ultimo reset das estatisticas.
-- - O bloco de top queries usa pg_stat_statements quando a extensao existe.
--   Se ela nao estiver habilitada ou visivel, o script retorna uma linha de aviso
--   e continua os demais blocos.
-- - CPU/memoria exatas do host ficam no Database Health do Supabase; aqui aparecem
--   sinais de banco que normalmente explicam consumo alto: sessoes ativas, waits,
--   temp files, cache, queries caras e I/O por relacao.
-- - API/PostgREST e Edge Functions ficam nos logs da plataforma. Use tambem:
--   scripts/supabase-log-explorer-monitoring.txt no Supabase Logs Explorer.
-- - Este script nao altera dados persistentes. Ele cria tabelas temporarias
--   apenas para permitir blocos opcionais sem falhar quando uma extensao falta.

select
  '01_disk_io_database' as bloco,
  d.datname as database_name,
  pg_size_pretty(pg_database_size(d.datname)) as database_size,
  d.blks_read,
  d.blks_hit,
  round((100.0 * d.blks_hit / nullif(d.blks_hit + d.blks_read, 0))::numeric, 2) as cache_hit_pct,
  d.tup_returned,
  d.tup_fetched,
  d.tup_inserted,
  d.tup_updated,
  d.tup_deleted,
  d.temp_files,
  pg_size_pretty(d.temp_bytes) as temp_written,
  d.deadlocks,
  d.conflicts,
  d.stats_reset
from pg_stat_database d
where d.datname = current_database();

select
  '01_disk_io_tables' as bloco,
  s.schemaname,
  s.relname,
  pg_size_pretty(pg_total_relation_size(c.oid)) as total_size,
  s.heap_blks_read,
  s.heap_blks_hit,
  round((100.0 * s.heap_blks_hit / nullif(s.heap_blks_hit + s.heap_blks_read, 0))::numeric, 2) as heap_cache_hit_pct,
  s.idx_blks_read,
  s.idx_blks_hit,
  round((100.0 * s.idx_blks_hit / nullif(s.idx_blks_hit + s.idx_blks_read, 0))::numeric, 2) as index_cache_hit_pct,
  s.toast_blks_read,
  s.toast_blks_hit
from pg_statio_user_tables s
join pg_class c
  on c.oid = s.relid
order by (s.heap_blks_read + s.idx_blks_read + s.toast_blks_read) desc
limit 30;

select
  '02_cpu_memory_pressure' as bloco,
  a.state,
  coalesce(a.wait_event_type, '[sem_wait]') as wait_event_type,
  coalesce(a.wait_event, '[sem_wait]') as wait_event,
  count(*) as connections,
  count(*) filter (where a.query_start is not null and now() - a.query_start > interval '30 seconds') as running_over_30s,
  count(*) filter (where a.query_start is not null and now() - a.query_start > interval '5 minutes') as running_over_5min
from pg_stat_activity a
where a.datname = current_database()
group by a.state, a.wait_event_type, a.wait_event
order by connections desc, running_over_5min desc, running_over_30s desc;

select
  '02_memory_settings' as bloco,
  name,
  setting,
  unit,
  short_desc
from pg_settings
where name in (
  'shared_buffers',
  'effective_cache_size',
  'work_mem',
  'maintenance_work_mem',
  'temp_buffers',
  'max_connections'
)
order by name;

select
  '02_active_queries_now' as bloco,
  a.pid,
  a.usename,
  a.application_name,
  a.client_addr::text as client_addr,
  a.state,
  a.wait_event_type,
  a.wait_event,
  now() - a.query_start as running_for,
  left(regexp_replace(a.query, '\s+', ' ', 'g'), 700) as query_sample
from pg_stat_activity a
where a.datname = current_database()
  and a.pid <> pg_backend_pid()
  and a.state <> 'idle'
order by a.query_start nulls last
limit 30;

select
  '03_api_postgrest_current_connections' as bloco,
  a.usename,
  coalesce(nullif(a.application_name, ''), '[sem_application_name]') as application_name,
  a.client_addr::text as client_addr,
  a.state,
  count(*) as connections,
  min(now() - a.backend_start) as oldest_connection_age,
  max(now() - a.query_start) filter (where a.query_start is not null) as longest_current_query
from pg_stat_activity a
where a.datname = current_database()
  and (
    a.application_name ilike '%postgrest%'
    or a.usename in ('authenticator', 'anon', 'authenticated')
  )
group by a.usename, a.application_name, a.client_addr, a.state
order by connections desc, longest_current_query desc nulls last;

select
  '03_api_postgrest_note' as bloco,
  'Historico de requests, rotas, 4xx/5xx e tempo medio fica no Logs Explorer; ver scripts/supabase-log-explorer-monitoring.txt.' as observacao;

drop table if exists pg_temp.monitor_top_expensive_queries;

create temp table monitor_top_expensive_queries (
  bloco text,
  queryid text,
  query text,
  executions bigint,
  total_time_ms numeric,
  avg_time_ms numeric,
  max_time_ms numeric,
  avg_rows_returned numeric,
  shared_blks_read bigint,
  shared_blks_hit bigint,
  shared_blks_dirtied bigint,
  shared_blks_written bigint,
  temp_blks_read bigint,
  temp_blks_written bigint
) on commit drop;

do $$
declare
  v_pg_stat_statements regclass;
begin
  v_pg_stat_statements := coalesce(
    to_regclass('public.pg_stat_statements'),
    to_regclass('extensions.pg_stat_statements'),
    to_regclass('pg_stat_statements')
  );

  if v_pg_stat_statements is null then
    insert into pg_temp.monitor_top_expensive_queries (
      bloco,
      query
    )
    values (
      '04_top_expensive_queries',
      'pg_stat_statements nao esta habilitada ou nao esta visivel para este usuario. Habilite a extensao no Supabase para ver top queries.'
    );
  else
    execute format($query$
      insert into pg_temp.monitor_top_expensive_queries (
        bloco,
        queryid,
        query,
        executions,
        total_time_ms,
        avg_time_ms,
        max_time_ms,
        avg_rows_returned,
        shared_blks_read,
        shared_blks_hit,
        shared_blks_dirtied,
        shared_blks_written,
        temp_blks_read,
        temp_blks_written
      )
      select
        '04_top_expensive_queries' as bloco,
        s.queryid::text,
        left(regexp_replace(s.query, '\s+', ' ', 'g'), 900) as query,
        s.calls as executions,
        round(s.total_exec_time::numeric, 2) as total_time_ms,
        round(s.mean_exec_time::numeric, 2) as avg_time_ms,
        round(s.max_exec_time::numeric, 2) as max_time_ms,
        round((s.rows::numeric / nullif(s.calls, 0)), 2) as avg_rows_returned,
        s.shared_blks_read,
        s.shared_blks_hit,
        s.shared_blks_dirtied,
        s.shared_blks_written,
        s.temp_blks_read,
        s.temp_blks_written
      from %s s
      order by s.total_exec_time desc
      limit 30
    $query$, v_pg_stat_statements);
  end if;
exception
  when others then
    truncate table pg_temp.monitor_top_expensive_queries;

    insert into pg_temp.monitor_top_expensive_queries (
      bloco,
      query
    )
    values (
      '04_top_expensive_queries',
      'Nao foi possivel ler pg_stat_statements: ' || SQLERRM
    );
end;
$$;

select *
from pg_temp.monitor_top_expensive_queries;

drop table if exists pg_temp.monitor_top_queries_by_disk_read;

create temp table monitor_top_queries_by_disk_read (
  bloco text,
  queryid text,
  query text,
  executions bigint,
  total_time_ms numeric,
  avg_time_ms numeric,
  shared_blks_read bigint,
  shared_blks_written bigint,
  temp_blks_read bigint,
  temp_blks_written bigint,
  avg_rows_returned numeric
) on commit drop;

do $$
declare
  v_pg_stat_statements regclass;
begin
  v_pg_stat_statements := coalesce(
    to_regclass('public.pg_stat_statements'),
    to_regclass('extensions.pg_stat_statements'),
    to_regclass('pg_stat_statements')
  );

  if v_pg_stat_statements is null then
    insert into pg_temp.monitor_top_queries_by_disk_read (
      bloco,
      query
    )
    values (
      '04_top_queries_by_disk_read',
      'pg_stat_statements nao esta habilitada ou nao esta visivel para este usuario. Habilite a extensao no Supabase para ver leituras de disco por query.'
    );
  else
    execute format($query$
      insert into pg_temp.monitor_top_queries_by_disk_read (
        bloco,
        queryid,
        query,
        executions,
        total_time_ms,
        avg_time_ms,
        shared_blks_read,
        shared_blks_written,
        temp_blks_read,
        temp_blks_written,
        avg_rows_returned
      )
      select
        '04_top_queries_by_disk_read' as bloco,
        s.queryid::text,
        left(regexp_replace(s.query, '\s+', ' ', 'g'), 900) as query,
        s.calls as executions,
        round(s.total_exec_time::numeric, 2) as total_time_ms,
        round(s.mean_exec_time::numeric, 2) as avg_time_ms,
        s.shared_blks_read,
        s.shared_blks_written,
        s.temp_blks_read,
        s.temp_blks_written,
        round((s.rows::numeric / nullif(s.calls, 0)), 2) as avg_rows_returned
      from %s s
      where s.shared_blks_read > 0
         or s.temp_blks_read > 0
         or s.temp_blks_written > 0
      order by (s.shared_blks_read + s.temp_blks_read + s.temp_blks_written) desc
      limit 30
    $query$, v_pg_stat_statements);
  end if;
exception
  when others then
    truncate table pg_temp.monitor_top_queries_by_disk_read;

    insert into pg_temp.monitor_top_queries_by_disk_read (
      bloco,
      query
    )
    values (
      '04_top_queries_by_disk_read',
      'Nao foi possivel ler pg_stat_statements: ' || SQLERRM
    );
end;
$$;

select *
from pg_temp.monitor_top_queries_by_disk_read;

select
  '05_cache_hit_rate_database' as bloco,
  d.datname as database_name,
  d.blks_read,
  d.blks_hit,
  round((100.0 * d.blks_hit / nullif(d.blks_hit + d.blks_read, 0))::numeric, 2) as cache_hit_pct
from pg_stat_database d
where d.datname = current_database();

select
  '05_cache_hit_rate_tables' as bloco,
  s.schemaname,
  s.relname,
  pg_size_pretty(pg_total_relation_size(s.relid)) as total_size,
  s.heap_blks_read,
  s.heap_blks_hit,
  round((100.0 * s.heap_blks_hit / nullif(s.heap_blks_hit + s.heap_blks_read, 0))::numeric, 2) as heap_cache_hit_pct,
  s.idx_blks_read,
  s.idx_blks_hit,
  round((100.0 * s.idx_blks_hit / nullif(s.idx_blks_hit + s.idx_blks_read, 0))::numeric, 2) as index_cache_hit_pct
from pg_statio_user_tables s
where (s.heap_blks_read + s.heap_blks_hit + s.idx_blks_read + s.idx_blks_hit) > 0
order by
  coalesce((100.0 * s.heap_blks_hit / nullif(s.heap_blks_hit + s.heap_blks_read, 0)), 100) asc,
  pg_total_relation_size(s.relid) desc
limit 50;

with db_size as (
  select pg_database_size(current_database())::numeric as bytes
),
table_sizes as (
  select
    n.nspname as schema_name,
    c.relname as table_name,
    c.oid as table_oid,
    pg_total_relation_size(c.oid) as total_bytes,
    pg_relation_size(c.oid) as table_bytes,
    pg_indexes_size(c.oid) as index_bytes
  from pg_class c
  join pg_namespace n
    on n.oid = c.relnamespace
  where c.relkind in ('r', 'p')
    and n.nspname not in ('pg_catalog', 'information_schema')
)
select
  '06_tables_by_size' as bloco,
  t.schema_name,
  t.table_name,
  pg_size_pretty(t.total_bytes) as total_size,
  pg_size_pretty(t.table_bytes) as table_size,
  pg_size_pretty(t.index_bytes) as indexes_size,
  coalesce(st.n_live_tup, 0) as estimated_rows,
  round((100.0 * t.total_bytes::numeric / nullif(d.bytes, 0)), 2) as database_pct
from table_sizes t
cross join db_size d
left join pg_stat_user_tables st
  on st.relid = t.table_oid
order by t.total_bytes desc
limit 50;

with db_size as (
  select pg_database_size(current_database())::numeric as bytes
),
table_sizes as (
  select
    n.nspname as schema_name,
    c.relname as table_name,
    c.oid as table_oid,
    pg_total_relation_size(c.oid) as total_bytes,
    pg_relation_size(c.oid) as table_bytes,
    pg_indexes_size(c.oid) as index_bytes
  from pg_class c
  join pg_namespace n
    on n.oid = c.relnamespace
  where c.relkind in ('r', 'p')
    and n.nspname not in ('pg_catalog', 'information_schema')
    and c.relname ~* '(programming|programacao|history|audit|log|import|sync|aso|activity|ativ|measurement|billing|stock|transfer|temp|export)'
)
select
  '06_tables_suspect_growth' as bloco,
  t.schema_name,
  t.table_name,
  pg_size_pretty(t.total_bytes) as total_size,
  pg_size_pretty(t.index_bytes) as indexes_size,
  coalesce(st.n_live_tup, 0) as estimated_rows,
  round((100.0 * t.total_bytes::numeric / nullif(d.bytes, 0)), 2) as database_pct
from table_sizes t
cross join db_size d
left join pg_stat_user_tables st
  on st.relid = t.table_oid
order by t.total_bytes desc, t.table_name
limit 80;

select
  '07_unused_indexes' as bloco,
  s.schemaname,
  s.relname as table_name,
  s.indexrelname as index_name,
  pg_size_pretty(pg_relation_size(s.indexrelid)) as index_size,
  s.idx_scan,
  s.idx_tup_read,
  s.idx_tup_fetch,
  i.indisprimary,
  i.indisunique
from pg_stat_user_indexes s
join pg_index i
  on i.indexrelid = s.indexrelid
where s.idx_scan = 0
  and not i.indisprimary
  and not i.indisunique
  and pg_relation_size(s.indexrelid) > 0
order by pg_relation_size(s.indexrelid) desc
limit 50;

select
  '07_tables_with_seq_scans' as bloco,
  s.schemaname,
  s.relname as table_name,
  pg_size_pretty(pg_total_relation_size(s.relid)) as total_size,
  s.n_live_tup as estimated_rows,
  s.seq_scan,
  s.seq_tup_read,
  round((s.seq_tup_read::numeric / nullif(s.seq_scan, 0)), 2) as avg_rows_per_seq_scan,
  s.idx_scan,
  s.idx_tup_fetch,
  round((100.0 * s.seq_scan / nullif(s.seq_scan + s.idx_scan, 0))::numeric, 2) as seq_scan_pct
from pg_stat_user_tables s
where s.seq_scan > 0
order by s.seq_tup_read desc, pg_total_relation_size(s.relid) desc
limit 50;

select
  '08_connections_summary' as bloco,
  a.usename,
  coalesce(nullif(a.application_name, ''), '[sem_application_name]') as application_name,
  a.state,
  count(*) as connections,
  count(*) filter (where a.wait_event_type is not null) as waiting_connections,
  min(a.backend_start) as oldest_backend_start,
  max(now() - a.query_start) filter (where a.query_start is not null) as longest_current_query
from pg_stat_activity a
where a.datname = current_database()
group by a.usename, a.application_name, a.state
order by connections desc, waiting_connections desc, longest_current_query desc nulls last;

select
  '08_blocking_queries' as bloco,
  blocked.pid as blocked_pid,
  blocked.usename as blocked_user,
  blocked.application_name as blocked_application,
  now() - blocked.query_start as blocked_duration,
  left(regexp_replace(blocked.query, '\s+', ' ', 'g'), 700) as blocked_query,
  blocking.pid as blocking_pid,
  blocking.usename as blocking_user,
  blocking.application_name as blocking_application,
  now() - blocking.query_start as blocking_duration,
  left(regexp_replace(blocking.query, '\s+', ' ', 'g'), 700) as blocking_query
from pg_stat_activity blocked
join pg_stat_activity blocking
  on blocking.pid = any(pg_blocking_pids(blocked.pid))
where blocked.datname = current_database()
order by blocked_duration desc;

select
  '08_locks_by_relation' as bloco,
  coalesce(n.nspname, '[sem_schema]') as schema_name,
  coalesce(c.relname, '[sem_relacao]') as relation_name,
  l.locktype,
  l.mode,
  l.granted,
  count(*) as locks
from pg_locks l
left join pg_class c
  on c.oid = l.relation
left join pg_namespace n
  on n.oid = c.relnamespace
group by n.nspname, c.relname, l.locktype, l.mode, l.granted
order by locks desc, l.granted asc, relation_name
limit 80;
