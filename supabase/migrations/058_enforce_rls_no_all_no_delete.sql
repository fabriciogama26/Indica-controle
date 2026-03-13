-- 058_enforce_rls_no_all_no_delete.sql
-- Padroniza RLS de cadastros/permissoes para SELECT + INSERT + UPDATE (sem ALL e sem DELETE).

do $$
declare
  v_table text;
  v_tables text[] := array[
    'project_material_balance',
    'job_titles',
    'people',
    'role_page_permissions',
    'app_user_page_permissions',
    'project',
    'project_priorities',
    'project_service_centers',
    'project_service_types',
    'project_voltage_levels',
    'project_sizes',
    'project_municipalities',
    'project_contractor_responsibles',
    'project_utility_responsibles',
    'project_utility_field_managers',
    'contrato',
    'contract',
    'project_material_forecast',
    'job_title_types',
    'job_levels',
    'service_activities',
    'teams',
    'team_types'
  ];
begin
  foreach v_table in array v_tables loop
    if to_regclass(format('public.%I', v_table)) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', v_table);

    execute format('drop policy if exists %1$I_tenant_write on public.%1$I', v_table);
    execute format('drop policy if exists %1$I_tenant_insert on public.%1$I', v_table);
    execute format('drop policy if exists %1$I_tenant_update on public.%1$I', v_table);
    execute format('drop policy if exists %1$I_tenant_delete on public.%1$I', v_table);

    execute format(
      'create policy %1$I_tenant_insert on public.%1$I for insert to authenticated with check (public.user_can_access_tenant(tenant_id))',
      v_table
    );

    execute format(
      'create policy %1$I_tenant_update on public.%1$I for update to authenticated using (public.user_can_access_tenant(tenant_id)) with check (public.user_can_access_tenant(tenant_id))',
      v_table
    );
  end loop;
end;
$$;

do $$
declare
  r record;
  v_table text;
  v_tables text[] := array[
    'project_material_balance',
    'job_titles',
    'people',
    'role_page_permissions',
    'app_user_page_permissions',
    'project',
    'project_priorities',
    'project_service_centers',
    'project_service_types',
    'project_voltage_levels',
    'project_sizes',
    'project_municipalities',
    'project_contractor_responsibles',
    'project_utility_responsibles',
    'project_utility_field_managers',
    'contrato',
    'contract',
    'project_material_forecast',
    'job_title_types',
    'job_levels',
    'service_activities',
    'teams',
    'team_types'
  ];
begin
  foreach v_table in array v_tables loop
    if to_regclass(format('public.%I', v_table)) is null then
      continue;
    end if;

    for r in
      select p.policyname
      from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = v_table
        and p.cmd in ('ALL', 'DELETE')
    loop
      execute format('drop policy if exists %I on public.%I', r.policyname, v_table);
    end loop;
  end loop;
end;
$$;
