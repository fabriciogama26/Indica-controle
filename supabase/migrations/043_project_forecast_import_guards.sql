-- 043_project_forecast_import_guards.sql
-- Protecoes para importacao de materiais previstos por Edge Function.

create or replace function public.precheck_project_material_forecast_import(
  p_tenant_id uuid,
  p_project_id uuid,
  p_material_ids uuid[]
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_project_exists boolean;
  v_duplicate_codes text[];
  v_already_imported_codes text[];
begin
  select exists (
    select 1
    from public.project p
    where p.id = p_project_id
      and p.tenant_id = p_tenant_id
  )
  into v_project_exists;

  if not v_project_exists then
    return jsonb_build_object(
      'success', false,
      'reason', 'PROJECT_NOT_FOUND'
    );
  end if;

  if p_material_ids is null or cardinality(p_material_ids) = 0 then
    return jsonb_build_object(
      'success', false,
      'reason', 'EMPTY_ITEMS'
    );
  end if;

  select coalesce(array_agg(m.codigo order by m.codigo), '{}')
  into v_duplicate_codes
  from (
    select material_id
    from unnest(p_material_ids) as t(material_id)
    group by material_id
    having count(*) > 1
  ) d
  join public.materials m
    on m.id = d.material_id
   and m.tenant_id = p_tenant_id;

  if cardinality(v_duplicate_codes) > 0 then
    return jsonb_build_object(
      'success', false,
      'reason', 'DUPLICATE_CODE_IN_FILE',
      'codes', to_jsonb(v_duplicate_codes)
    );
  end if;

  select coalesce(array_agg(m.codigo order by m.codigo), '{}')
  into v_already_imported_codes
  from public.project_material_forecast pmf
  join public.materials m
    on m.id = pmf.material_id
   and m.tenant_id = pmf.tenant_id
  where pmf.tenant_id = p_tenant_id
    and pmf.project_id = p_project_id
    and pmf.material_id = any(p_material_ids);

  if cardinality(v_already_imported_codes) > 0 then
    return jsonb_build_object(
      'success', false,
      'reason', 'CODE_ALREADY_IMPORTED',
      'codes', to_jsonb(v_already_imported_codes)
    );
  end if;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.precheck_project_material_forecast_import(uuid, uuid, uuid[]) from public;
grant execute on function public.precheck_project_material_forecast_import(uuid, uuid, uuid[]) to authenticated;
grant execute on function public.precheck_project_material_forecast_import(uuid, uuid, uuid[]) to service_role;

create or replace function public.append_project_material_forecast(
  p_tenant_id uuid,
  p_project_id uuid,
  p_actor_user_id uuid,
  p_items jsonb,
  p_source text default 'IMPORT_XLSX'
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_project_exists boolean;
  v_item jsonb;
  v_inserted integer := 0;
  v_source text := nullif(btrim(coalesce(p_source, '')), '');
  v_check jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return jsonb_build_object('success', false, 'reason', 'INVALID_ITEMS_PAYLOAD');
  end if;

  select exists (
    select 1
    from public.project p
    where p.id = p_project_id
      and p.tenant_id = p_tenant_id
  )
  into v_project_exists;

  if not v_project_exists then
    return jsonb_build_object('success', false, 'reason', 'PROJECT_NOT_FOUND');
  end if;

  select public.precheck_project_material_forecast_import(
    p_tenant_id,
    p_project_id,
    coalesce(
      array(
        select (value ->> 'material_id')::uuid
        from jsonb_array_elements(p_items)
      ),
      '{}'::uuid[]
    )
  )
  into v_check;

  if coalesce((v_check ->> 'success')::boolean, false) = false then
    return v_check;
  end if;

  for v_item in
    select value
    from jsonb_array_elements(p_items)
  loop
    insert into public.project_material_forecast (
      tenant_id,
      project_id,
      material_id,
      qty_planned,
      observation,
      source,
      imported_at,
      created_by,
      updated_by
    )
    values (
      p_tenant_id,
      p_project_id,
      (v_item ->> 'material_id')::uuid,
      (v_item ->> 'qty_planned')::numeric,
      null,
      coalesce(v_source, 'IMPORT_XLSX'),
      now(),
      p_actor_user_id,
      p_actor_user_id
    );

    v_inserted := v_inserted + 1;
  end loop;

  return jsonb_build_object('success', true, 'inserted', v_inserted);
end;
$$;

revoke all on function public.append_project_material_forecast(uuid, uuid, uuid, jsonb, text) from public;
grant execute on function public.append_project_material_forecast(uuid, uuid, uuid, jsonb, text) to authenticated;
grant execute on function public.append_project_material_forecast(uuid, uuid, uuid, jsonb, text) to service_role;
