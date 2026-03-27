-- 121_relax_programming_sgd_export_column_check.sql
-- Remove o bloqueio de valores fixos em export_column para destravar novos Tipos de SGD.

alter table if exists public.programming_sgd_types
  drop constraint if exists programming_sgd_types_export_column_check;

alter table if exists public.programming_sgd_types
  add constraint programming_sgd_types_export_column_check
  check (nullif(btrim(coalesce(export_column, '')), '') is not null);
