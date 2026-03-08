-- 021_rls_to_authenticated.sql
-- Restringe policies multi-tenant ao role authenticated.

drop policy if exists app_users_select_self on public.app_users;
create policy app_users_select_self on public.app_users
for select
to authenticated
using (auth.uid() = auth_user_id);

drop policy if exists imei_whitelist_tenant_select on public.imei_whitelist;
create policy imei_whitelist_tenant_select on public.imei_whitelist
for select
to authenticated
using (public.user_can_access_tenant(imei_whitelist.tenant_id));

drop policy if exists login_audit_tenant_select on public.login_audit;
create policy login_audit_tenant_select on public.login_audit
for select
to authenticated
using (public.user_can_access_tenant(login_audit.tenant_id));

drop policy if exists app_error_logs_tenant_select on public.app_error_logs;
create policy app_error_logs_tenant_select on public.app_error_logs
for select
to authenticated
using (public.user_can_access_tenant(app_error_logs.tenant_id));

drop policy if exists materials_tenant_select on public.materials;
drop policy if exists materials_tenant_write on public.materials;
create policy materials_tenant_select on public.materials
for select
to authenticated
using (public.user_can_access_tenant(materials.tenant_id));
create policy materials_tenant_write on public.materials
for insert
to authenticated
with check (public.user_can_access_tenant(materials.tenant_id));

drop policy if exists inventory_tenant_select on public.inventory_balance;
drop policy if exists inventory_tenant_write on public.inventory_balance;
create policy inventory_tenant_select on public.inventory_balance
for select
to authenticated
using (public.user_can_access_tenant(inventory_balance.tenant_id));
create policy inventory_tenant_write on public.inventory_balance
for insert
to authenticated
with check (public.user_can_access_tenant(inventory_balance.tenant_id));

drop policy if exists requisicoes_tenant_select on public.requisicoes;
drop policy if exists requisicoes_tenant_write on public.requisicoes;
create policy requisicoes_tenant_select on public.requisicoes
for select
to authenticated
using (public.user_can_access_tenant(requisicoes.tenant_id));
create policy requisicoes_tenant_write on public.requisicoes
for insert
to authenticated
with check (public.user_can_access_tenant(requisicoes.tenant_id));

drop policy if exists requisicao_itens_tenant_select on public.requisicao_itens;
drop policy if exists requisicao_itens_tenant_write on public.requisicao_itens;
create policy requisicao_itens_tenant_select on public.requisicao_itens
for select
to authenticated
using (public.user_can_access_tenant(requisicao_itens.tenant_id));
create policy requisicao_itens_tenant_write on public.requisicao_itens
for insert
to authenticated
with check (public.user_can_access_tenant(requisicao_itens.tenant_id));

drop policy if exists stock_movements_tenant_select on public.stock_movements;
drop policy if exists stock_movements_tenant_write on public.stock_movements;
create policy stock_movements_tenant_select on public.stock_movements
for select
to authenticated
using (public.user_can_access_tenant(stock_movements.tenant_id));
create policy stock_movements_tenant_write on public.stock_movements
for insert
to authenticated
with check (public.user_can_access_tenant(stock_movements.tenant_id));

drop policy if exists stock_conflicts_tenant_select on public.stock_conflicts;
drop policy if exists stock_conflicts_tenant_write on public.stock_conflicts;
create policy stock_conflicts_tenant_select on public.stock_conflicts
for select
to authenticated
using (public.user_can_access_tenant(stock_conflicts.tenant_id));
create policy stock_conflicts_tenant_write on public.stock_conflicts
for insert
to authenticated
with check (public.user_can_access_tenant(stock_conflicts.tenant_id));

drop policy if exists stock_conflict_items_tenant_select on public.stock_conflict_items;
drop policy if exists stock_conflict_items_tenant_write on public.stock_conflict_items;
create policy stock_conflict_items_tenant_select on public.stock_conflict_items
for select
to authenticated
using (public.user_can_access_tenant(stock_conflict_items.tenant_id));
create policy stock_conflict_items_tenant_write on public.stock_conflict_items
for insert
to authenticated
with check (public.user_can_access_tenant(stock_conflict_items.tenant_id));

drop policy if exists sync_runs_tenant_select on public.sync_runs;
drop policy if exists sync_runs_tenant_write on public.sync_runs;
create policy sync_runs_tenant_select on public.sync_runs
for select
to authenticated
using (public.user_can_access_tenant(sync_runs.tenant_id));
create policy sync_runs_tenant_write on public.sync_runs
for insert
to authenticated
with check (public.user_can_access_tenant(sync_runs.tenant_id));

drop policy if exists sync_run_steps_tenant_select on public.sync_run_steps;
drop policy if exists sync_run_steps_tenant_write on public.sync_run_steps;
create policy sync_run_steps_tenant_select on public.sync_run_steps
for select
to authenticated
using (public.user_can_access_tenant(sync_run_steps.tenant_id));
create policy sync_run_steps_tenant_write on public.sync_run_steps
for insert
to authenticated
with check (public.user_can_access_tenant(sync_run_steps.tenant_id));

drop policy if exists sync_run_alerts_tenant_select on public.sync_run_alerts;
drop policy if exists sync_run_alerts_tenant_write on public.sync_run_alerts;
create policy sync_run_alerts_tenant_select on public.sync_run_alerts
for select
to authenticated
using (public.user_can_access_tenant(sync_run_alerts.tenant_id));
create policy sync_run_alerts_tenant_write on public.sync_run_alerts
for insert
to authenticated
with check (public.user_can_access_tenant(sync_run_alerts.tenant_id));

drop policy if exists project_material_balance_tenant_select on public.project_material_balance;
drop policy if exists project_material_balance_tenant_write on public.project_material_balance;
create policy project_material_balance_tenant_select on public.project_material_balance
for select
to authenticated
using (public.user_can_access_tenant(project_material_balance.tenant_id));
create policy project_material_balance_tenant_write on public.project_material_balance
for all
to authenticated
using (public.user_can_access_tenant(project_material_balance.tenant_id))
with check (public.user_can_access_tenant(project_material_balance.tenant_id));

drop policy if exists job_titles_tenant_select on public.job_titles;
drop policy if exists job_titles_tenant_write on public.job_titles;
create policy job_titles_tenant_select on public.job_titles
for select
to authenticated
using (public.user_can_access_tenant(job_titles.tenant_id));
create policy job_titles_tenant_write on public.job_titles
for all
to authenticated
using (public.user_can_access_tenant(job_titles.tenant_id))
with check (public.user_can_access_tenant(job_titles.tenant_id));

drop policy if exists people_tenant_select on public.people;
drop policy if exists people_tenant_write on public.people;
create policy people_tenant_select on public.people
for select
to authenticated
using (public.user_can_access_tenant(people.tenant_id));
create policy people_tenant_write on public.people
for all
to authenticated
using (public.user_can_access_tenant(people.tenant_id))
with check (public.user_can_access_tenant(people.tenant_id));
