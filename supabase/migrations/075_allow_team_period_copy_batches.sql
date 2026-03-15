-- 075_allow_team_period_copy_batches.sql
-- Adapta os lotes de copia da Programacao para permitir copia da linha inteira
-- da equipe no periodo visivel, sem depender de um card ou obra unicos.

alter table if exists public.project_programming_copy_batches
  alter column project_id drop not null,
  alter column source_programming_id drop not null;

alter table if exists public.project_programming_copy_batches
  drop constraint if exists project_programming_copy_batches_mode_check;

alter table if exists public.project_programming_copy_batches
  add constraint project_programming_copy_batches_mode_check
    check (copy_mode in ('single', 'project_period', 'team_period'));

alter table if exists public.project_programming_copy_batches
  drop constraint if exists project_programming_copy_batches_period_check;

alter table if exists public.project_programming_copy_batches
  add constraint project_programming_copy_batches_period_check
    check (
      (copy_mode = 'single' and visible_start_date is null and visible_end_date is null)
      or (
        copy_mode in ('project_period', 'team_period')
        and visible_start_date is not null
        and visible_end_date is not null
        and visible_start_date <= visible_end_date
      )
    );
