-- Auditoria 15 - Supabase implicit row cap
-- MEDICAO: exposicao real ao teto de 1.000 linhas do PostgREST, por tenant.
--
-- SOMENTE LEITURA. Nenhum DDL, nenhum DML. Pode rodar em producao.
-- Nao e migration de proposito: e SELECT puro, e em supabase/migrations/ seria
-- reaplicado em todo `db reset` e em todo ambiente novo sem efeito nenhum.
--
-- UMA UNICA INSTRUCAO NESTE ARQUIVO, DE PROPOSITO. O SQL editor do Supabase exibe
-- apenas o resultado da ULTIMA instrucao do script: com varias consultas no mesmo
-- arquivo, as anteriores rodam e o resultado e descartado em silencio.
--
-- Como rodar:
--   npm run db:cardinality-live
-- ou colar este arquivo inteiro no SQL editor do Dashboard.
--
-- ============================================================================
-- POR QUE DINAMICA, E NAO UMA LISTA DE TABELAS
--
-- A primeira versao deste arquivo trazia 16 tabelas escolhidas a mao. O preflight
-- de cobertura (2026-08-21) mostrou que existem 114 tabelas BASE com `tenant_id`:
-- a lista cobria 14%, e deixava de fora justamente as familias mais expostas —
-- linhas de item (project_activity_forecast, project_billing_order_items,
-- programming_activity, requisicao_itens), transacionais (stock_movements,
-- project_programming) e TODAS as tabelas de historico, que crescem
-- monotonicamente e nunca sao podadas (project_history, programming_history,
-- material_history, login_audit, app_error_logs, idempotency_requests).
--
-- Lista fixa envelhece: tabela nova entra no schema e fica fora da auditoria em
-- silencio. Esta versao descobre as tabelas em `information_schema` e mede todas,
-- entao nao ha o que manter e nao ha o que esquecer.
-- ============================================================================
--
-- POR QUE POR TENANT, E NAO COUNT(*) GLOBAL:
-- o truncamento acontece na consulta de UM tenant. Uma tabela com 20.000 linhas
-- globais e nenhum tenant acima de 300 nao tem exposicao; outra com 1.500 globais e
-- um tenant com 1.200 ja tem defeito potencial concreto. O numero que governa a
-- prioridade e MAX(linhas por tenant).
--
-- ANOTAR A DATA DA EXECUCAO no documento da auditoria: contagem de linha envelhece.
--
-- Colunas:
--   total_rows           linhas globais (contexto, NAO prioridade)
--   max_rows_per_tenant  O NUMERO QUE IMPORTA
--   tenant_count         quantos tenants tem linha nesta tabela
--   tenants_over_500/900/1000
--   largest_tenant_hash  md5 truncado do tenant campeao: estavel entre execucoes,
--                        permite dizer "e o mesmo tenant de antes" sem expor o UUID
--                        num documento versionado
--   prioridade           P0 >1000 | P1 900-1000 | P2 500-899 | P3 <500
--
-- CUSTO: uma varredura agregada por tabela. Com o banco medido em 90,5 MB
-- (Auditoria/11-infraestrutura.md) isso e trivial. Em banco grande, rodar fora de
-- horario de pico.
--
-- NOTA SOBRE RLS: `query_to_xml` executa com os privilegios de quem chama. Rodando
-- como owner no SQL editor, a medicao enxerga todos os tenants — que e exatamente o
-- necessario para calcular MAX por tenant. Nenhum `tenant_id` e exposto: so o hash.

with alvo as (
  select c.table_name
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema
   and t.table_name   = c.table_name
  where c.table_schema = 'public'
    and c.column_name  = 'tenant_id'
    and t.table_type   = 'BASE TABLE'
),
medido as (
  select
    a.table_name,
    query_to_xml(
      format(
        'select coalesce(sum(n), 0) as total_rows,'
        ' coalesce(max(n), 0) as max_rows_per_tenant,'
        ' count(*) as tenant_count,'
        ' count(*) filter (where n > 500) as over_500,'
        ' count(*) filter (where n > 900) as over_900,'
        ' count(*) filter (where n > 1000) as over_1000,'
        ' coalesce(left(md5((array_agg(tenant_id order by n desc))[1]::text), 8), ''-'') as largest_tenant_hash'
        ' from (select tenant_id, count(*) as n from public.%I group by tenant_id) s',
        a.table_name
      ),
      false, true, ''
    ) as doc
  from alvo a
),
extraido as (
  select
    table_name,
    (xpath('/row/total_rows/text()',          doc))[1]::text::bigint as total_rows,
    (xpath('/row/max_rows_per_tenant/text()', doc))[1]::text::bigint as max_rows_per_tenant,
    (xpath('/row/tenant_count/text()',        doc))[1]::text::bigint as tenant_count,
    (xpath('/row/over_500/text()',            doc))[1]::text::bigint as tenants_over_500,
    (xpath('/row/over_900/text()',            doc))[1]::text::bigint as tenants_over_900,
    (xpath('/row/over_1000/text()',           doc))[1]::text::bigint as tenants_over_1000,
    (xpath('/row/largest_tenant_hash/text()', doc))[1]::text         as largest_tenant_hash
  from medido
)
select
  table_name as tabela,
  total_rows,
  max_rows_per_tenant,
  tenant_count,
  tenants_over_500,
  tenants_over_900,
  tenants_over_1000,
  largest_tenant_hash,
  case
    when max_rows_per_tenant > 1000 then 'P0'
    when max_rows_per_tenant >= 900 then 'P1'
    when max_rows_per_tenant >= 500 then 'P2'
    else 'P3'
  end as prioridade
from extraido
order by max_rows_per_tenant desc, tabela;
