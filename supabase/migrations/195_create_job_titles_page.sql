-- 195_create_job_titles_page.sql
-- Suporte operacional para a tela Cargo: status com motivo e integridade basica.

alter table if exists public.job_titles
  add column if not exists cancellation_reason text,
  add column if not exists canceled_at timestamptz,
  add column if not exists canceled_by uuid references public.app_users(id);

alter table if exists public.job_titles
  drop constraint if exists chk_job_titles_code_not_blank;

alter table if exists public.job_titles
  add constraint chk_job_titles_code_not_blank
  check (btrim(code) <> '');

alter table if exists public.job_titles
  drop constraint if exists chk_job_titles_name_not_blank;

alter table if exists public.job_titles
  add constraint chk_job_titles_name_not_blank
  check (btrim(name) <> '');

update public.job_titles
set
  canceled_at = coalesce(canceled_at, now()),
  cancellation_reason = case
    when nullif(btrim(coalesce(cancellation_reason, '')), '') is null
      then 'STATUS INATIVO (BACKFILL MIGRATION 195)'
    else cancellation_reason
  end
where ativo = false;

alter table if exists public.job_titles
  drop constraint if exists job_titles_active_cancellation_consistency_check;

alter table if exists public.job_titles
  add constraint job_titles_active_cancellation_consistency_check
  check (
    (ativo = true and canceled_at is null and cancellation_reason is null)
    or (
      ativo = false
      and canceled_at is not null
      and nullif(btrim(coalesce(cancellation_reason, '')), '') is not null
    )
  );

create index if not exists idx_job_title_types_tenant_job_active_name
  on public.job_title_types (tenant_id, job_title_id, ativo, name);

create index if not exists idx_job_levels_tenant_active_level
  on public.job_levels (tenant_id, ativo, level);
