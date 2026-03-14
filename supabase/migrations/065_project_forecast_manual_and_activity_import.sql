-- 065_project_forecast_manual_and_activity_import.sql
-- Adiciona RPC para cadastro manual de materiais previstos e importacao protegida de atividades previstas por projeto.

create or replace function public.save_project_material_forecast(
  p_tenant_id uuid,
  p_project_id uuid,
  p_actor_user_id uuid,
  p_quantity numeric,
  p_item_id uuid default null,
  p_material_id uuid default null,
  p_observation text default null,
  p_source text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_exists boolean;
  v_material record;
  v_item record;
  v_observation text := nullif(btrim(coalesce(p_observation, '')), '');
  v_source text := nullif(btrim(coalesce(p_source, '')), '');
begin
  if p_quantity is null or p_quantity <= 0 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_QUANTITY',
      'message', 'A quantidade do material previsto do projeto deve ser maior que zero.'
    );
  end if;

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
      'status', 404,
      'reason', 'PROJECT_NOT_FOUND',
      'message', 'Projeto nao encontrado para salvar materiais previstos.'
    );
  end if;

  if p_item_id is null then
    if p_material_id is null then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'MISSING_MATERIAL_ID',
        'message', 'Material obrigatorio para adicionar item previsto do projeto.'
      );
    end if;

    select
      m.id,
      m.codigo
    into v_material
    from public.materials m
    where m.tenant_id = p_tenant_id
      and m.id = p_material_id
      and m.is_active = true;

    if not found then
      return jsonb_build_object(
        'success', false,
        'status', 404,
        'reason', 'MATERIAL_NOT_FOUND',
        'message', 'Material nao encontrado ou inativo.'
      );
    end if;

    begin
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
        v_material.id,
        p_quantity,
        v_observation,
        coalesce(v_source, 'MANUAL'),
        now(),
        p_actor_user_id,
        p_actor_user_id
      );
    exception
      when unique_violation then
        return jsonb_build_object(
          'success', false,
          'status', 409,
          'reason', 'MATERIAL_ALREADY_EXISTS',
          'message', 'Material ja adicionado no previsto deste projeto.'
        );
    end;

    select pmf.id, m.codigo
    into v_item
    from public.project_material_forecast pmf
    join public.materials m
      on m.id = pmf.material_id
     and m.tenant_id = pmf.tenant_id
    where pmf.tenant_id = p_tenant_id
      and pmf.project_id = p_project_id
      and pmf.material_id = p_material_id;

    return jsonb_build_object(
      'success', true,
      'status', 200,
      'action', 'INSERT',
      'item_id', v_item.id,
      'entity_code', v_item.codigo,
      'message', 'Material previsto adicionado ao projeto com sucesso.'
    );
  end if;

  select pmf.id, m.codigo
  into v_item
  from public.project_material_forecast pmf
  join public.materials m
    on m.id = pmf.material_id
   and m.tenant_id = pmf.tenant_id
  where pmf.tenant_id = p_tenant_id
    and pmf.project_id = p_project_id
    and pmf.id = p_item_id;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'PROJECT_MATERIAL_FORECAST_NOT_FOUND',
      'message', 'Material previsto do projeto nao encontrado.'
    );
  end if;

  update public.project_material_forecast
  set
    qty_planned = p_quantity,
    observation = v_observation,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and project_id = p_project_id
    and id = p_item_id;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'action', 'UPDATE',
    'item_id', v_item.id,
    'entity_code', v_item.codigo,
    'message', 'Material previsto do projeto atualizado com sucesso.'
  );
end;
$$;

revoke all on function public.save_project_material_forecast(uuid, uuid, uuid, numeric, uuid, uuid, text, text) from public;
grant execute on function public.save_project_material_forecast(uuid, uuid, uuid, numeric, uuid, uuid, text, text) to authenticated;
grant execute on function public.save_project_material_forecast(uuid, uuid, uuid, numeric, uuid, uuid, text, text) to service_role;

create or replace function public.precheck_project_activity_forecast_import(
  p_tenant_id uuid,
  p_project_id uuid,
  p_activity_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
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

  if p_activity_ids is null or cardinality(p_activity_ids) = 0 then
    return jsonb_build_object(
      'success', false,
      'reason', 'EMPTY_ITEMS'
    );
  end if;

  select coalesce(array_agg(sa.code order by sa.code), '{}')
  into v_duplicate_codes
  from (
    select service_activity_id
    from unnest(p_activity_ids) as t(service_activity_id)
    group by service_activity_id
    having count(*) > 1
  ) d
  join public.service_activities sa
    on sa.id = d.service_activity_id
   and sa.tenant_id = p_tenant_id;

  if cardinality(v_duplicate_codes) > 0 then
    return jsonb_build_object(
      'success', false,
      'reason', 'DUPLICATE_CODE_IN_FILE',
      'codes', to_jsonb(v_duplicate_codes)
    );
  end if;

  select coalesce(array_agg(sa.code order by sa.code), '{}')
  into v_already_imported_codes
  from public.project_activity_forecast paf
  join public.service_activities sa
    on sa.id = paf.service_activity_id
   and sa.tenant_id = paf.tenant_id
  where paf.tenant_id = p_tenant_id
    and paf.project_id = p_project_id
    and paf.service_activity_id = any(p_activity_ids);

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

revoke all on function public.precheck_project_activity_forecast_import(uuid, uuid, uuid[]) from public;
grant execute on function public.precheck_project_activity_forecast_import(uuid, uuid, uuid[]) to authenticated;
grant execute on function public.precheck_project_activity_forecast_import(uuid, uuid, uuid[]) to service_role;

create or replace function public.append_project_activity_forecast(
  p_tenant_id uuid,
  p_project_id uuid,
  p_actor_user_id uuid,
  p_items jsonb,
  p_source text default 'IMPORT_XLSX'
)
returns jsonb
language plpgsql
security definer
set search_path = public
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

  select public.precheck_project_activity_forecast_import(
    p_tenant_id,
    p_project_id,
    coalesce(
      array(
        select (value ->> 'activity_id')::uuid
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
    insert into public.project_activity_forecast (
      tenant_id,
      project_id,
      service_activity_id,
      qty_planned,
      observation,
      source,
      created_by,
      updated_by
    )
    values (
      p_tenant_id,
      p_project_id,
      (v_item ->> 'activity_id')::uuid,
      (v_item ->> 'qty_planned')::numeric,
      nullif(btrim(coalesce(v_item ->> 'observation', '')), ''),
      coalesce(v_source, 'IMPORT_XLSX'),
      p_actor_user_id,
      p_actor_user_id
    );

    v_inserted := v_inserted + 1;
  end loop;

  return jsonb_build_object('success', true, 'inserted', v_inserted);
end;
$$;

revoke all on function public.append_project_activity_forecast(uuid, uuid, uuid, jsonb, text) from public;
grant execute on function public.append_project_activity_forecast(uuid, uuid, uuid, jsonb, text) to authenticated;
grant execute on function public.append_project_activity_forecast(uuid, uuid, uuid, jsonb, text) to service_role;
