-- 062_create_location_execution_support_items.sql
-- Cria o catalogo de apoio de execucao da Locacao por tenant.

create table if not exists public.location_execution_support_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  description text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint location_execution_support_items_description_not_blank
    check (btrim(description) <> ''),
  constraint location_execution_support_items_tenant_description_key
    unique (tenant_id, description)
);

create index if not exists idx_location_execution_support_items_tenant_active_description
  on public.location_execution_support_items (tenant_id, is_active, description);

alter table if exists public.location_execution_support_items enable row level security;

drop policy if exists location_execution_support_items_tenant_select on public.location_execution_support_items;
create policy location_execution_support_items_tenant_select on public.location_execution_support_items
for select
to authenticated
using (public.user_can_access_tenant(location_execution_support_items.tenant_id));

drop policy if exists location_execution_support_items_tenant_insert on public.location_execution_support_items;
create policy location_execution_support_items_tenant_insert on public.location_execution_support_items
for insert
to authenticated
with check (public.user_can_access_tenant(location_execution_support_items.tenant_id));

drop policy if exists location_execution_support_items_tenant_update on public.location_execution_support_items;
create policy location_execution_support_items_tenant_update on public.location_execution_support_items
for update
to authenticated
using (public.user_can_access_tenant(location_execution_support_items.tenant_id))
with check (public.user_can_access_tenant(location_execution_support_items.tenant_id));

drop trigger if exists trg_location_execution_support_items_audit on public.location_execution_support_items;
create trigger trg_location_execution_support_items_audit before insert or update on public.location_execution_support_items
for each row execute function public.apply_audit_fields();
