-- 067_create_project_programming.sql
-- Cria a base multi-tenant da Programacao por projeto/equipe/data e suas atividades vinculadas.

create table if not exists public.project_programming (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  project_id uuid not null references public.project(id),
  team_id uuid not null references public.teams(id),
  execution_date date not null,
  period text not null,
  start_time time not null,
  end_time time not null,
  expected_minutes integer not null,
  feeder text,
  support text,
  note text,
  sgd_number text,
  sgd_included_at date,
  sgd_delivered_at date,
  pi_number text,
  pi_included_at date,
  pi_delivered_at date,
  pep_number text,
  pep_included_at date,
  pep_delivered_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint project_programming_period_check
    check (period in ('INTEGRAL', 'PARCIAL')),
  constraint project_programming_expected_minutes_check
    check (expected_minutes > 0),
  constraint project_programming_time_range_check
    check (end_time > start_time),
  constraint project_programming_tenant_project_team_date_key
    unique (tenant_id, project_id, team_id, execution_date),
  constraint project_programming_sgd_document_check
    check (
      (
        nullif(btrim(coalesce(sgd_number, '')), '') is null
        and sgd_included_at is null
        and sgd_delivered_at is null
      )
      or (
        nullif(btrim(coalesce(sgd_number, '')), '') is not null
        and sgd_included_at is not null
        and (sgd_delivered_at is null or sgd_delivered_at >= sgd_included_at)
      )
    ),
  constraint project_programming_pi_document_check
    check (
      (
        nullif(btrim(coalesce(pi_number, '')), '') is null
        and pi_included_at is null
        and pi_delivered_at is null
      )
      or (
        nullif(btrim(coalesce(pi_number, '')), '') is not null
        and pi_included_at is not null
        and (pi_delivered_at is null or pi_delivered_at >= pi_included_at)
      )
    ),
  constraint project_programming_pep_document_check
    check (
      (
        nullif(btrim(coalesce(pep_number, '')), '') is null
        and pep_included_at is null
        and pep_delivered_at is null
      )
      or (
        nullif(btrim(coalesce(pep_number, '')), '') is not null
        and pep_included_at is not null
        and (pep_delivered_at is null or pep_delivered_at >= pep_included_at)
      )
    )
);

create index if not exists idx_project_programming_tenant_date_team
  on public.project_programming (tenant_id, execution_date, team_id);

create index if not exists idx_project_programming_tenant_project
  on public.project_programming (tenant_id, project_id, updated_at desc);

alter table if exists public.project_programming enable row level security;

drop policy if exists project_programming_tenant_select on public.project_programming;
create policy project_programming_tenant_select on public.project_programming
for select
to authenticated
using (public.user_can_access_tenant(project_programming.tenant_id));

drop policy if exists project_programming_tenant_insert on public.project_programming;
create policy project_programming_tenant_insert on public.project_programming
for insert
to authenticated
with check (public.user_can_access_tenant(project_programming.tenant_id));

drop policy if exists project_programming_tenant_update on public.project_programming;
create policy project_programming_tenant_update on public.project_programming
for update
to authenticated
using (public.user_can_access_tenant(project_programming.tenant_id))
with check (public.user_can_access_tenant(project_programming.tenant_id));

drop trigger if exists trg_project_programming_audit on public.project_programming;
create trigger trg_project_programming_audit before insert or update on public.project_programming
for each row execute function public.apply_audit_fields();

create table if not exists public.project_programming_activities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  programming_id uuid not null references public.project_programming(id) on delete cascade,
  service_activity_id uuid not null references public.service_activities(id),
  activity_code text not null,
  activity_description text not null,
  activity_unit text not null,
  quantity numeric not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint project_programming_activities_tenant_programming_activity_key
    unique (tenant_id, programming_id, service_activity_id),
  constraint project_programming_activities_code_not_blank
    check (btrim(activity_code) <> ''),
  constraint project_programming_activities_description_not_blank
    check (btrim(activity_description) <> ''),
  constraint project_programming_activities_unit_not_blank
    check (btrim(activity_unit) <> ''),
  constraint project_programming_activities_quantity_check
    check (quantity > 0)
);

create index if not exists idx_project_programming_activities_tenant_programming_active
  on public.project_programming_activities (tenant_id, programming_id, is_active, updated_at desc);

create index if not exists idx_project_programming_activities_tenant_activity
  on public.project_programming_activities (tenant_id, service_activity_id);

alter table if exists public.project_programming_activities enable row level security;

drop policy if exists project_programming_activities_tenant_select on public.project_programming_activities;
create policy project_programming_activities_tenant_select on public.project_programming_activities
for select
to authenticated
using (public.user_can_access_tenant(project_programming_activities.tenant_id));

drop policy if exists project_programming_activities_tenant_insert on public.project_programming_activities;
create policy project_programming_activities_tenant_insert on public.project_programming_activities
for insert
to authenticated
with check (public.user_can_access_tenant(project_programming_activities.tenant_id));

drop policy if exists project_programming_activities_tenant_update on public.project_programming_activities;
create policy project_programming_activities_tenant_update on public.project_programming_activities
for update
to authenticated
using (public.user_can_access_tenant(project_programming_activities.tenant_id))
with check (public.user_can_access_tenant(project_programming_activities.tenant_id));

drop trigger if exists trg_project_programming_activities_audit on public.project_programming_activities;
create trigger trg_project_programming_activities_audit before insert or update on public.project_programming_activities
for each row execute function public.apply_audit_fields();
