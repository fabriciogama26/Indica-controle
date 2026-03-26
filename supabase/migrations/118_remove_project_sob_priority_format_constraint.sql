-- 118_remove_project_sob_priority_format_constraint.sql
-- Remove a validacao de formato por prioridade para permitir SOB livre no cadastro de projetos.

alter table public.project
  drop constraint if exists chk_project_sob_priority_format;
