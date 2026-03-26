-- 120_allow_multiple_programming_sgd_types_per_export_column.sql
-- Remove a trava de um unico Tipo de SGD por export_column em cada tenant.
-- Mantem o controle de colunas tecnicas permitidas e define fallback padrao.

alter table if exists public.programming_sgd_types
  drop constraint if exists programming_sgd_types_tenant_export_column_key;

alter table if exists public.programming_sgd_types
  alter column export_column set default 'AREA_LIVRE';

create index if not exists idx_programming_sgd_types_tenant_export_column
  on public.programming_sgd_types (tenant_id, export_column);
