-- 061_create_location_risks.sql
-- Cria a tabela de riscos da Locacao vinculada ao plano do projeto.

create table if not exists public.project_location_risks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  location_plan_id uuid not null references public.project_location_plans(id) on delete cascade,
  description text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint project_location_risks_description_not_blank
    check (btrim(description) <> '')
);

create index if not exists idx_project_location_risks_tenant_plan_active_updated
  on public.project_location_risks (tenant_id, location_plan_id, is_active, updated_at desc);

alter table if exists public.project_location_risks enable row level security;

drop policy if exists project_location_risks_tenant_select on public.project_location_risks;
create policy project_location_risks_tenant_select on public.project_location_risks
for select
to authenticated
using (public.user_can_access_tenant(project_location_risks.tenant_id));

drop policy if exists project_location_risks_tenant_insert on public.project_location_risks;
create policy project_location_risks_tenant_insert on public.project_location_risks
for insert
to authenticated
with check (public.user_can_access_tenant(project_location_risks.tenant_id));

drop policy if exists project_location_risks_tenant_update on public.project_location_risks;
create policy project_location_risks_tenant_update on public.project_location_risks
for update
to authenticated
using (public.user_can_access_tenant(project_location_risks.tenant_id))
with check (public.user_can_access_tenant(project_location_risks.tenant_id));

drop trigger if exists trg_project_location_risks_audit on public.project_location_risks;
create trigger trg_project_location_risks_audit before insert or update on public.project_location_risks
for each row execute function public.apply_audit_fields();
