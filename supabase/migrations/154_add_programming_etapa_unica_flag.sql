-- 154_add_programming_etapa_unica_flag.sql
-- Adiciona flag ETAPA UNICA na Programacao.

alter table if exists public.project_programming
  add column if not exists etapa_unica boolean not null default false;

