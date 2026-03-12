-- 055_add_people_status_and_cancellation_fields.sql
-- Adiciona suporte de cancelamento/ativacao com motivo em people.

alter table if exists public.people
  add column if not exists cancellation_reason text,
  add column if not exists canceled_at timestamptz,
  add column if not exists canceled_by uuid references public.app_users(id);

update public.people
set
  canceled_at = coalesce(canceled_at, now()),
  cancellation_reason = case
    when nullif(btrim(coalesce(cancellation_reason, '')), '') is null
      then 'STATUS INATIVO (BACKFILL MIGRATION 055)'
    else cancellation_reason
  end
where ativo = false;

alter table if exists public.people
  drop constraint if exists people_active_cancellation_consistency_check;

alter table if exists public.people
  add constraint people_active_cancellation_consistency_check
  check (
    (ativo = true and canceled_at is null and cancellation_reason is null)
    or (
      ativo = false
      and canceled_at is not null
      and nullif(btrim(coalesce(cancellation_reason, '')), '') is not null
    )
  );
