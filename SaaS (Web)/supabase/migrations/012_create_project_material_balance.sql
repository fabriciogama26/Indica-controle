-- 012_create_project_material_balance.sql
-- Separa saldo fisico do estoque do saldo liquido por projeto/material.

create table if not exists public.project_material_balance (
  tenant_id uuid not null,
  projeto text not null,
  material_id uuid not null references public.materials(id),
  qty_issued numeric not null default 0,
  qty_returned numeric not null default 0,
  qty_net numeric generated always as (qty_issued - qty_returned) stored,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, projeto, material_id),
  check (btrim(projeto) <> ''),
  check (qty_issued >= 0),
  check (qty_returned >= 0)
);

create index if not exists idx_project_material_balance_tenant_project
  on public.project_material_balance (tenant_id, projeto);

create index if not exists idx_project_material_balance_tenant_material
  on public.project_material_balance (tenant_id, material_id);

alter table if exists public.stock_movements
  add column if not exists projeto text,
  add column if not exists movement_type text;

create index if not exists idx_stock_movements_tenant_project_material_created
  on public.stock_movements (tenant_id, projeto, material_id, created_at desc);

alter table if exists public.project_material_balance enable row level security;

drop policy if exists project_material_balance_tenant_select on public.project_material_balance;
drop policy if exists project_material_balance_tenant_write on public.project_material_balance;

create policy project_material_balance_tenant_select on public.project_material_balance
for select using (
  exists (
    select 1
    from public.app_users au
    where au.auth_user_id = auth.uid()
      and au.tenant_id = project_material_balance.tenant_id
  )
);

create policy project_material_balance_tenant_write on public.project_material_balance
for all using (
  exists (
    select 1
    from public.app_users au
    where au.auth_user_id = auth.uid()
      and au.tenant_id = project_material_balance.tenant_id
  )
)
with check (
  exists (
    select 1
    from public.app_users au
    where au.auth_user_id = auth.uid()
      and au.tenant_id = project_material_balance.tenant_id
  )
);
