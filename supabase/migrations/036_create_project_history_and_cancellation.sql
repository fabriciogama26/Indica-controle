-- 036_create_project_history_and_cancellation.sql
-- Status ativo de projeto e historicos de alteracao/cancelamento.

alter table if exists public.project
  add column if not exists is_active boolean not null default true,
  add column if not exists cancellation_reason text,
  add column if not exists canceled_at timestamptz,
  add column if not exists canceled_by uuid references public.app_users(id);

alter table if exists public.project
  drop constraint if exists chk_project_cancel_consistency;

alter table if exists public.project
  add constraint chk_project_cancel_consistency check (
    (is_active = true and canceled_at is null and canceled_by is null and cancellation_reason is null)
    or
    (
      is_active = false
      and canceled_at is not null
      and canceled_by is not null
      and nullif(btrim(coalesce(cancellation_reason, '')), '') is not null
    )
  );

create index if not exists idx_project_tenant_is_active
  on public.project (tenant_id, is_active, updated_at desc);

create table if not exists public.project_cancellation_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null references public.project(id) on delete cascade,
  reason text not null check (btrim(reason) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id)
);

create index if not exists idx_project_cancellation_history_tenant_project_created
  on public.project_cancellation_history (tenant_id, project_id, created_at desc);

alter table if exists public.project_cancellation_history enable row level security;

drop policy if exists project_cancellation_history_tenant_select on public.project_cancellation_history;
create policy project_cancellation_history_tenant_select on public.project_cancellation_history
for select
to authenticated
using (public.user_can_access_tenant(project_cancellation_history.tenant_id));

drop policy if exists project_cancellation_history_tenant_insert on public.project_cancellation_history;
create policy project_cancellation_history_tenant_insert on public.project_cancellation_history
for insert
to authenticated
with check (public.user_can_access_tenant(project_cancellation_history.tenant_id));

drop trigger if exists trg_project_cancellation_history_audit on public.project_cancellation_history;
create trigger trg_project_cancellation_history_audit before insert or update on public.project_cancellation_history
for each row execute function public.apply_audit_fields();

create table if not exists public.project_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null references public.project(id) on delete cascade,
  change_type text not null check (change_type in ('UPDATE', 'CANCEL')),
  changes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id)
);

create index if not exists idx_project_history_tenant_project_created
  on public.project_history (tenant_id, project_id, created_at desc);

alter table if exists public.project_history enable row level security;

drop policy if exists project_history_tenant_select on public.project_history;
create policy project_history_tenant_select on public.project_history
for select
to authenticated
using (public.user_can_access_tenant(project_history.tenant_id));

drop policy if exists project_history_tenant_insert on public.project_history;
create policy project_history_tenant_insert on public.project_history
for insert
to authenticated
with check (public.user_can_access_tenant(project_history.tenant_id));

drop trigger if exists trg_project_history_audit on public.project_history;
create trigger trg_project_history_audit before insert or update on public.project_history
for each row execute function public.apply_audit_fields();
