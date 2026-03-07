-- 009_create_sync_runs.sql
-- Registro de sincronizações executadas pelo app.

create table if not exists public.sync_runs (
  id bigint generated always as identity primary key,
  sync_uuid uuid not null unique,
  tenant_id uuid not null,
  user_id uuid,
  device_id text,
  source text not null default 'APP',
  started_at timestamptz not null,
  finished_at timestamptz,
  status text not null,
  pending_total integer not null default 0,
  pending_sent integer not null default 0,
  materials_updated integer not null default 0,
  conflicts_found integer not null default 0,
  errors_count integer not null default 0,
  message text,
  app_version text,
  created_at timestamptz not null default now()
);

create index if not exists idx_sync_runs_tenant_started_at on public.sync_runs (tenant_id, started_at desc);
create index if not exists idx_sync_runs_user_started_at on public.sync_runs (user_id, started_at desc);

alter table if exists public.sync_runs enable row level security;

drop policy if exists sync_runs_tenant_select on public.sync_runs;
drop policy if exists sync_runs_tenant_write on public.sync_runs;

create policy sync_runs_tenant_select on public.sync_runs
for select using (
  exists (
    select 1
    from public.app_users au
    where au.auth_user_id = auth.uid()
      and au.tenant_id = sync_runs.tenant_id
  )
);

create policy sync_runs_tenant_write on public.sync_runs
for insert with check (
  exists (
    select 1
    from public.app_users au
    where au.auth_user_id = auth.uid()
      and au.tenant_id = sync_runs.tenant_id
  )
);