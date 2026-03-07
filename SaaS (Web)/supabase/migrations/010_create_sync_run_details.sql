-- 010_create_sync_run_details.sql
-- Complementa a auditoria de sincronizacao com passos e avisos detalhados.

alter table if exists public.sync_runs
  add column if not exists trigger_type text not null default 'MANUAL',
  add column if not exists warnings_count integer not null default 0,
  add column if not exists projects_updated integer not null default 0,
  add column if not exists balances_updated integer not null default 0,
  add column if not exists downloaded_at timestamptz,
  add column if not exists uploaded_at timestamptz,
  add column if not exists network_status text,
  add column if not exists device_label text;

create table if not exists public.sync_run_steps (
  id bigint generated always as identity primary key,
  sync_uuid uuid not null references public.sync_runs(sync_uuid) on delete cascade,
  tenant_id uuid not null,
  step_order integer not null default 0,
  step_key text not null,
  step_label text not null,
  status text not null,
  items_count integer not null default 0,
  message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_sync_run_steps_uuid_order
  on public.sync_run_steps (sync_uuid, step_order asc);

create index if not exists idx_sync_run_steps_tenant_created
  on public.sync_run_steps (tenant_id, created_at desc);

create table if not exists public.sync_run_alerts (
  id bigint generated always as identity primary key,
  sync_uuid uuid not null references public.sync_runs(sync_uuid) on delete cascade,
  tenant_id uuid not null,
  severity text not null,
  alert_code text,
  title text not null,
  message text,
  payload jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid
);

create index if not exists idx_sync_run_alerts_uuid_created
  on public.sync_run_alerts (sync_uuid, created_at desc);

create index if not exists idx_sync_run_alerts_tenant_created
  on public.sync_run_alerts (tenant_id, created_at desc);

alter table if exists public.sync_run_steps enable row level security;
alter table if exists public.sync_run_alerts enable row level security;

drop policy if exists sync_run_steps_tenant_select on public.sync_run_steps;
drop policy if exists sync_run_steps_tenant_write on public.sync_run_steps;
drop policy if exists sync_run_alerts_tenant_select on public.sync_run_alerts;
drop policy if exists sync_run_alerts_tenant_write on public.sync_run_alerts;

create policy sync_run_steps_tenant_select on public.sync_run_steps
for select using (
  exists (
    select 1
    from public.app_users au
    where au.auth_user_id = auth.uid()
      and au.tenant_id = sync_run_steps.tenant_id
  )
);

create policy sync_run_steps_tenant_write on public.sync_run_steps
for insert with check (
  exists (
    select 1
    from public.app_users au
    where au.auth_user_id = auth.uid()
      and au.tenant_id = sync_run_steps.tenant_id
  )
);

create policy sync_run_alerts_tenant_select on public.sync_run_alerts
for select using (
  exists (
    select 1
    from public.app_users au
    where au.auth_user_id = auth.uid()
      and au.tenant_id = sync_run_alerts.tenant_id
  )
);

create policy sync_run_alerts_tenant_write on public.sync_run_alerts
for insert with check (
  exists (
    select 1
    from public.app_users au
    where au.auth_user_id = auth.uid()
      and au.tenant_id = sync_run_alerts.tenant_id
  )
);
