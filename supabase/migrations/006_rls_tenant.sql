-- 006_rls_tenant.sql
-- RLS por tenant_id usando app_users.auth_user_id = auth.uid()

alter table if exists public.app_users add column if not exists auth_user_id uuid;

-- app_users (somente o proprio usuario)
alter table if exists public.app_users enable row level security;
drop policy if exists app_users_select_self on public.app_users;
create policy app_users_select_self on public.app_users
for select using (auth.uid() = auth_user_id);

-- materials
alter table if exists public.materials enable row level security;
drop policy if exists materials_tenant_select on public.materials;
drop policy if exists materials_tenant_write on public.materials;
create policy materials_tenant_select on public.materials
for select using (
  exists (select 1 from public.app_users au where au.auth_user_id = auth.uid() and au.tenant_id = materials.tenant_id)
);
create policy materials_tenant_write on public.materials
for insert with check (
  exists (select 1 from public.app_users au where au.auth_user_id = auth.uid() and au.tenant_id = materials.tenant_id)
);

-- inventory_balance
alter table if exists public.inventory_balance enable row level security;
drop policy if exists inventory_tenant_select on public.inventory_balance;
drop policy if exists inventory_tenant_write on public.inventory_balance;
create policy inventory_tenant_select on public.inventory_balance
for select using (
  exists (select 1 from public.app_users au where au.auth_user_id = auth.uid() and au.tenant_id = inventory_balance.tenant_id)
);
create policy inventory_tenant_write on public.inventory_balance
for insert with check (
  exists (select 1 from public.app_users au where au.auth_user_id = auth.uid() and au.tenant_id = inventory_balance.tenant_id)
);

-- requisicoes
alter table if exists public.requisicoes enable row level security;
drop policy if exists requisicoes_tenant_select on public.requisicoes;
drop policy if exists requisicoes_tenant_write on public.requisicoes;
create policy requisicoes_tenant_select on public.requisicoes
for select using (
  exists (select 1 from public.app_users au where au.auth_user_id = auth.uid() and au.tenant_id = requisicoes.tenant_id)
);
create policy requisicoes_tenant_write on public.requisicoes
for insert with check (
  exists (select 1 from public.app_users au where au.auth_user_id = auth.uid() and au.tenant_id = requisicoes.tenant_id)
);

-- requisicao_itens
alter table if exists public.requisicao_itens enable row level security;
drop policy if exists requisicao_itens_tenant_select on public.requisicao_itens;
drop policy if exists requisicao_itens_tenant_write on public.requisicao_itens;
create policy requisicao_itens_tenant_select on public.requisicao_itens
for select using (
  exists (select 1 from public.app_users au where au.auth_user_id = auth.uid() and au.tenant_id = requisicao_itens.tenant_id)
);
create policy requisicao_itens_tenant_write on public.requisicao_itens
for insert with check (
  exists (select 1 from public.app_users au where au.auth_user_id = auth.uid() and au.tenant_id = requisicao_itens.tenant_id)
);

-- stock_movements
alter table if exists public.stock_movements enable row level security;
drop policy if exists stock_movements_tenant_select on public.stock_movements;
drop policy if exists stock_movements_tenant_write on public.stock_movements;
create policy stock_movements_tenant_select on public.stock_movements
for select using (
  exists (select 1 from public.app_users au where au.auth_user_id = auth.uid() and au.tenant_id = stock_movements.tenant_id)
);
create policy stock_movements_tenant_write on public.stock_movements
for insert with check (
  exists (select 1 from public.app_users au where au.auth_user_id = auth.uid() and au.tenant_id = stock_movements.tenant_id)
);

-- stock_conflicts
alter table if exists public.stock_conflicts enable row level security;
drop policy if exists stock_conflicts_tenant_select on public.stock_conflicts;
drop policy if exists stock_conflicts_tenant_write on public.stock_conflicts;
create policy stock_conflicts_tenant_select on public.stock_conflicts
for select using (
  exists (select 1 from public.app_users au where au.auth_user_id = auth.uid() and au.tenant_id = stock_conflicts.tenant_id)
);
create policy stock_conflicts_tenant_write on public.stock_conflicts
for insert with check (
  exists (select 1 from public.app_users au where au.auth_user_id = auth.uid() and au.tenant_id = stock_conflicts.tenant_id)
);

-- stock_conflict_items
alter table if exists public.stock_conflict_items enable row level security;
drop policy if exists stock_conflict_items_tenant_select on public.stock_conflict_items;
drop policy if exists stock_conflict_items_tenant_write on public.stock_conflict_items;
create policy stock_conflict_items_tenant_select on public.stock_conflict_items
for select using (
  exists (select 1 from public.app_users au where au.auth_user_id = auth.uid() and au.tenant_id = stock_conflict_items.tenant_id)
);
create policy stock_conflict_items_tenant_write on public.stock_conflict_items
for insert with check (
  exists (select 1 from public.app_users au where au.auth_user_id = auth.uid() and au.tenant_id = stock_conflict_items.tenant_id)
);

-- imei_whitelist
alter table if exists public.imei_whitelist enable row level security;
drop policy if exists imei_whitelist_tenant_select on public.imei_whitelist;
create policy imei_whitelist_tenant_select on public.imei_whitelist
for select using (
  exists (select 1 from public.app_users au where au.auth_user_id = auth.uid() and au.tenant_id = imei_whitelist.tenant_id)
);

-- login_audit
alter table if exists public.login_audit enable row level security;
drop policy if exists login_audit_tenant_select on public.login_audit;
create policy login_audit_tenant_select on public.login_audit
for select using (
  exists (select 1 from public.app_users au where au.auth_user_id = auth.uid() and au.tenant_id = login_audit.tenant_id)
);
