-- 210_harden_function_search_path_and_rpc_execute.sql
-- Corrige alertas do Supabase Advisor:
-- - function_search_path_mutable
-- - anon/authenticated executable SECURITY DEFINER functions

do $$
declare
  r record;
begin
  for r in
    select
      n.nspname as schema_name,
      p.proname as function_name,
      pg_get_function_identity_arguments(p.oid) as identity_args
    from pg_proc p
    join pg_namespace n
      on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(array[
        'append_project_material_forecast',
        'apply_audit_fields',
        'current_app_user_id',
        'guard_project_inactivation_with_programming',
        'jsonb_object_length',
        'precheck_activity_code_conflict',
        'precheck_material_code_conflict',
        'precheck_project_material_forecast_import',
        'prevent_people_duplicate_identity',
        'project_sob_matches_priority',
        'replace_project_material_forecast',
        'resolve_conflict',
        'submit_requisicao',
        'sync_service_activities_active_flags',
        'user_can_access_tenant',
        'user_has_page_action',
        'user_is_admin_in_tenant'
      ])
  loop
    execute format(
      'alter function %I.%I(%s) set search_path = public, pg_temp',
      r.schema_name,
      r.function_name,
      r.identity_args
    );
  end loop;
end
$$;

do $$
declare
  r record;
begin
  for r in
    select
      n.nspname as schema_name,
      p.proname as function_name,
      pg_get_function_identity_arguments(p.oid) as identity_args
    from pg_proc p
    join pg_namespace n
      on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef = true
  loop
    execute format(
      'revoke execute on function %I.%I(%s) from public',
      r.schema_name,
      r.function_name,
      r.identity_args
    );

    execute format(
      'revoke execute on function %I.%I(%s) from anon',
      r.schema_name,
      r.function_name,
      r.identity_args
    );

    execute format(
      'revoke execute on function %I.%I(%s) from authenticated',
      r.schema_name,
      r.function_name,
      r.identity_args
    );

    execute format(
      'grant execute on function %I.%I(%s) to service_role',
      r.schema_name,
      r.function_name,
      r.identity_args
    );
  end loop;
end
$$;

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n
      on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(array[
        'append_project_material_forecast',
        'apply_audit_fields',
        'current_app_user_id',
        'guard_project_inactivation_with_programming',
        'jsonb_object_length',
        'precheck_activity_code_conflict',
        'precheck_material_code_conflict',
        'precheck_project_material_forecast_import',
        'prevent_people_duplicate_identity',
        'project_sob_matches_priority',
        'replace_project_material_forecast',
        'resolve_conflict',
        'submit_requisicao',
        'sync_service_activities_active_flags',
        'user_can_access_tenant',
        'user_has_page_action',
        'user_is_admin_in_tenant'
      ])
      and not exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) as cfg
        where cfg like 'search_path=%'
      )
  ) then
    raise exception 'function_search_path_mutable: target functions still have no search_path';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n
      on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef = true
      and (
        has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute')
      )
  ) then
    raise exception 'security_definer_executable: public SECURITY DEFINER functions remain executable by anon/authenticated';
  end if;
end
$$;
