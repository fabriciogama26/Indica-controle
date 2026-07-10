-- 300_fix_supabase_advisor_performance_warnings.sql
-- Fecha warnings de performance do Supabase Advisor:
-- - auth_rls_initplan em policies que chamavam auth.uid() por linha.
-- - multiple_permissive_policies em SELECT duplicado.
-- - duplicate_index em indices identicos herdados de nomes antigos.

-- 1) app_users: une leitura do proprio usuario + leitura administrativa do tenant
-- em uma unica policy SELECT e usa initplan para auth.uid().
drop policy if exists app_users_select_self on public.app_users;
drop policy if exists app_users_tenant_admin_select on public.app_users;
drop policy if exists app_users_select_self_or_tenant_admin on public.app_users;

create policy app_users_select_self_or_tenant_admin
  on public.app_users
  for select
  to authenticated
  using (
    auth_user_id = (select auth.uid())
    or exists (
      select 1
      from public.app_users current_app_user
      join public.app_roles current_app_role
        on current_app_role.id = current_app_user.role_id
      where current_app_user.auth_user_id = (select auth.uid())
        and current_app_user.ativo = true
        and current_app_role.ativo = true
        and current_app_role.is_admin = true
        and current_app_user.tenant_id = app_users.tenant_id
    )
  );

-- 2) app_user_tenants: mantem regra atual e evita reavaliar auth.uid() por linha.
drop policy if exists app_user_tenants_self_select on public.app_user_tenants;
create policy app_user_tenants_self_select
  on public.app_user_tenants
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_users au
      where au.auth_user_id = (select auth.uid())
        and au.id = app_user_tenants.user_id
        and au.ativo = true
    )
  );

-- 3) Remove SELECT gerado a partir de antigas policies FOR ALL ja coberto pelas
-- policies *_tenant_select canonicas.
drop policy if exists harden_project_activity_forecast_tenant_write_select_ab6514f0
  on public.project_activity_forecast;
drop policy if exists harden_project_location_activities_tenant_write_select_54e5d336
  on public.project_location_activities;
drop policy if exists harden_project_location_materials_tenant_write_select_f6616e26
  on public.project_location_materials;
drop policy if exists harden_project_location_plans_tenant_write_select_8e0807c4
  on public.project_location_plans;
drop policy if exists harden_project_material_forecast_tenant_write_select_f0167e80
  on public.project_material_forecast;

-- 4) Team Composition foi criado apos o hardening 173 com FOR ALL.
-- Separa escrita para nao duplicar SELECT e nao reintroduzir DELETE.
drop policy if exists team_compositions_tenant_write on public.team_compositions;
drop policy if exists team_compositions_tenant_insert on public.team_compositions;
drop policy if exists team_compositions_tenant_update on public.team_compositions;

create policy team_compositions_tenant_insert
  on public.team_compositions
  for insert
  to authenticated
  with check (public.user_can_access_tenant(team_compositions.tenant_id));

create policy team_compositions_tenant_update
  on public.team_compositions
  for update
  to authenticated
  using (public.user_can_access_tenant(team_compositions.tenant_id))
  with check (public.user_can_access_tenant(team_compositions.tenant_id));

drop policy if exists team_composition_members_tenant_write on public.team_composition_members;
drop policy if exists team_composition_members_tenant_insert on public.team_composition_members;
drop policy if exists team_composition_members_tenant_update on public.team_composition_members;

create policy team_composition_members_tenant_insert
  on public.team_composition_members
  for insert
  to authenticated
  with check (public.user_can_access_tenant(team_composition_members.tenant_id));

create policy team_composition_members_tenant_update
  on public.team_composition_members
  for update
  to authenticated
  using (public.user_can_access_tenant(team_composition_members.tenant_id))
  with check (public.user_can_access_tenant(team_composition_members.tenant_id));

-- 5) Indices duplicados: remove nomes legados preservando os equivalentes atuais.
drop index if exists public.idx_job_levels_tenant_active;
drop index if exists public.idx_job_title_types_tenant_active;
drop index if exists public.idx_project_priority_id;
drop index if exists public.idx_project_municipality_id;

do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'app_users'
      and policyname in ('app_users_select_self', 'app_users_tenant_admin_select')
  ) then
    raise exception '300: policies antigas de app_users ainda existem';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'app_users'
      and policyname = 'app_users_select_self_or_tenant_admin'
  ) then
    raise exception '300: policy app_users_select_self_or_tenant_admin nao foi criada';
  end if;

  if exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'idx_job_levels_tenant_active',
        'idx_job_title_types_tenant_active',
        'idx_project_priority_id',
        'idx_project_municipality_id'
      )
  ) then
    raise exception '300: indices duplicados legados ainda existem';
  end if;
end;
$$;
