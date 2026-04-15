-- 156_add_programming_etapa_final_flag.sql
-- Adiciona flag ETAPA FINAL na Programacao.

alter table if exists public.project_programming
  add column if not exists etapa_final boolean not null default false;
