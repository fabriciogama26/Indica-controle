-- 037_project_activation_history_rules.sql
-- Suporte a ativacao de projeto com historico dedicado.

alter table if exists public.project_history
  drop constraint if exists project_history_change_type_check;

alter table if exists public.project_history
  add constraint project_history_change_type_check
  check (change_type in ('UPDATE', 'CANCEL', 'ACTIVATE'));

alter table if exists public.project_cancellation_history
  add column if not exists action_type text;

update public.project_cancellation_history
set action_type = coalesce(nullif(btrim(action_type), ''), 'CANCEL');

alter table if exists public.project_cancellation_history
  alter column action_type set not null;

alter table if exists public.project_cancellation_history
  drop constraint if exists project_cancellation_history_action_type_check;

alter table if exists public.project_cancellation_history
  add constraint project_cancellation_history_action_type_check
  check (action_type in ('CANCEL', 'ACTIVATE'));

create index if not exists idx_project_cancellation_history_tenant_project_action_created
  on public.project_cancellation_history (tenant_id, project_id, action_type, created_at desc);
