-- Auditoria 15 - Supabase implicit row cap
-- PREFLIGHT: cobertura da medicao de cardinalidade.
--
-- SOMENTE LEITURA. Nenhum DDL, nenhum DML. Pode rodar em producao.
--
-- UMA UNICA INSTRUCAO NESTE ARQUIVO, DE PROPOSITO. O SQL editor do Supabase exibe
-- apenas o resultado da ULTIMA instrucao do script: com varias consultas no mesmo
-- arquivo, as anteriores rodam e o resultado e descartado em silencio.
--
-- Como rodar:
--   npm run db:coverage-live
-- ou colar este arquivo inteiro no SQL editor do Dashboard.
--
-- PARA QUE SERVE: lista toda tabela BASE de `public` que tem `tenant_id` e diz se
-- ela esta coberta por scripts/check-tenant-cardinality-live.sql. Serve para pegar
-- tabela nova que entrou no schema depois da auditoria e ficou fora da medicao —
-- sem isto, a auditoria envelhece sem ninguem notar.
--
-- COMO LER: as linhas com `coberta_pela_medicao = false` vem primeiro. Cada uma e
-- uma tabela multi-tenant cuja exposicao ao teto de 1.000 NAO foi medida. Se alguma
-- delas for transacional ou de linha de item, incluir na medicao antes da triagem.

select
  c.table_name,
  c.table_name = any (array[
    'project',
    'stock_transfer_items',
    'project_measurement_order_items',
    'stock_transfer_team_operations',
    'programming',
    'stock_transfers',
    'project_measurement_orders',
    'stock_transfer_reversals',
    'stock_transfer_item_reversals',
    'materials',
    'stock_centers',
    'teams',
    'app_users',
    'people',
    'job_titles',
    'team_types'
  ]) as coberta_pela_medicao
from information_schema.columns c
join information_schema.tables t
  on t.table_schema = c.table_schema
 and t.table_name   = c.table_name
where c.table_schema = 'public'
  and c.column_name  = 'tenant_id'
  and t.table_type   = 'BASE TABLE'
order by coberta_pela_medicao, c.table_name;
