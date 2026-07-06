-- 293_create_measurement_project_activity_indicators.sql
-- Configura os codigos de atividades exibidos como indicadores no cadastro da Medicao.

create table if not exists public.measurement_project_activity_indicators (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  activity_code text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null references public.app_users(id) on delete set null,
  updated_by uuid null references public.app_users(id) on delete set null,
  constraint measurement_project_activity_indicators_code_not_blank check (btrim(activity_code) <> ''),
  constraint measurement_project_activity_indicators_code_upper_check check (activity_code = upper(btrim(activity_code))),
  constraint measurement_project_activity_indicators_sort_order_check check (sort_order >= 0),
  constraint measurement_project_activity_indicators_unique_code unique (tenant_id, activity_code)
);

create index if not exists idx_measurement_project_activity_indicators_tenant_active_order
  on public.measurement_project_activity_indicators (tenant_id, is_active, sort_order, activity_code);

alter table if exists public.measurement_project_activity_indicators enable row level security;

drop policy if exists measurement_project_activity_indicators_tenant_select on public.measurement_project_activity_indicators;
create policy measurement_project_activity_indicators_tenant_select on public.measurement_project_activity_indicators
for select to authenticated
using (public.user_can_access_tenant(measurement_project_activity_indicators.tenant_id));

drop policy if exists measurement_project_activity_indicators_tenant_insert on public.measurement_project_activity_indicators;
create policy measurement_project_activity_indicators_tenant_insert on public.measurement_project_activity_indicators
for insert to authenticated
with check (public.user_can_access_tenant(measurement_project_activity_indicators.tenant_id));

drop policy if exists measurement_project_activity_indicators_tenant_update on public.measurement_project_activity_indicators;
create policy measurement_project_activity_indicators_tenant_update on public.measurement_project_activity_indicators
for update to authenticated
using (public.user_can_access_tenant(measurement_project_activity_indicators.tenant_id))
with check (public.user_can_access_tenant(measurement_project_activity_indicators.tenant_id));

drop trigger if exists trg_measurement_project_activity_indicators_audit on public.measurement_project_activity_indicators;
create trigger trg_measurement_project_activity_indicators_audit before insert or update on public.measurement_project_activity_indicators
for each row execute function public.apply_audit_fields();

insert into public.measurement_project_activity_indicators (tenant_id, activity_code, sort_order, is_active)
select t.id, item.activity_code, item.sort_order, true
from public.tenants t
cross join (
  values
    ('AHO717'::text, 10),
    ('AHO720'::text, 20)
) as item(activity_code, sort_order)
on conflict (tenant_id, activity_code) do update
set
  sort_order = excluded.sort_order,
  is_active = true,
  updated_at = now();
