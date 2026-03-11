-- 029_create_project_table.sql
-- Cadastro de projetos com filtros operacionais e auditoria.

create table if not exists public.project (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  sob text not null,
  service_center text not null,
  partner text not null,
  service_type text not null,
  execution_deadline date not null,
  priority text not null,
  estimated_value numeric(14, 2) not null,
  voltage_level text,
  project_size text,
  contractor_responsible text not null,
  utility_responsible text not null,
  utility_field_manager text not null,
  street text not null,
  neighborhood text not null,
  city text not null,
  service_description text,
  observation text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  unique (tenant_id, sob),
  check (btrim(sob) <> ''),
  check (btrim(service_center) <> ''),
  check (btrim(partner) <> ''),
  check (btrim(service_type) <> ''),
  check (btrim(priority) <> ''),
  check (estimated_value >= 0),
  check (btrim(contractor_responsible) <> ''),
  check (btrim(utility_responsible) <> ''),
  check (btrim(utility_field_manager) <> ''),
  check (btrim(street) <> ''),
  check (btrim(neighborhood) <> ''),
  check (btrim(city) <> '')
);

create index if not exists idx_project_tenant_deadline
  on public.project (tenant_id, execution_deadline);

create index if not exists idx_project_tenant_priority
  on public.project (tenant_id, priority);

create index if not exists idx_project_tenant_city
  on public.project (tenant_id, city);

create index if not exists idx_project_tenant_sob
  on public.project (tenant_id, sob);

alter table if exists public.project enable row level security;

drop policy if exists project_tenant_select on public.project;
create policy project_tenant_select on public.project
for select
to authenticated
using (public.user_can_access_tenant(project.tenant_id));

drop policy if exists project_tenant_write on public.project;
create policy project_tenant_write on public.project
for all
to authenticated
using (public.user_can_access_tenant(project.tenant_id))
with check (public.user_can_access_tenant(project.tenant_id));

drop trigger if exists trg_project_audit on public.project;
create trigger trg_project_audit before insert or update on public.project
for each row execute function public.apply_audit_fields();
