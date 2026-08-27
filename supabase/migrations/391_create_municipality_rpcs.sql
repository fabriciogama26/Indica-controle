-- 391_create_municipality_rpcs.sql
-- Move salvamento/status de Municipio para RPC transacional.

create or replace function public.save_municipality_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_municipality_id uuid default null,
  p_name text default null,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.project_municipalities%rowtype;
  v_municipality_id uuid := p_municipality_id;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_updated_at timestamptz;
  v_changes jsonb;
  v_constraint_name text;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'TENANT_OR_ACTOR_REQUIRED',
      'message', 'Tenant e usuario sao obrigatorios para salvar Municipio.'
    );
  end if;

  if v_name is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_REQUIRED_FIELDS',
      'message', 'Informe o nome do Municipio.'
    );
  end if;

  if v_municipality_id is null then
    insert into public.project_municipalities (
      tenant_id,
      name,
      ativo,
      created_by,
      updated_by
    )
    values (
      p_tenant_id,
      v_name,
      true,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at
    into v_municipality_id, v_updated_at;
  else
    select *
    into v_current
    from public.project_municipalities
    where tenant_id = p_tenant_id
      and id = v_municipality_id
    for update;

    if not found then
      return jsonb_build_object(
        'success', false,
        'status', 404,
        'reason', 'MUNICIPALITY_NOT_FOUND',
        'message', 'Municipio nao encontrado.'
      );
    end if;

    if p_expected_updated_at is null then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
        'message', 'Atualize a lista antes de editar o Municipio.'
      );
    end if;

    if v_current.updated_at <> p_expected_updated_at then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'CONCURRENT_MODIFICATION',
        'message', format('O Municipio %s foi alterado por outro usuario. Recarregue os dados antes de salvar novamente.', v_current.name)
      );
    end if;

    if not v_current.ativo then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'RECORD_INACTIVE',
        'message', 'Ative o Municipio antes de editar.'
      );
    end if;

    v_changes := jsonb_strip_nulls(jsonb_build_object(
      'name', case when v_current.name is distinct from v_name then jsonb_build_object('from', v_current.name, 'to', v_name) end
    ));

    if v_changes = '{}'::jsonb then
      return jsonb_build_object(
        'success', true,
        'status', 200,
        'municipality_id', v_municipality_id,
        'updated_at', v_current.updated_at,
        'message', format('Nenhuma alteracao detectada no Municipio %s.', v_current.name)
      );
    end if;

    update public.project_municipalities
    set
      name = v_name,
      updated_by = p_actor_user_id
    where tenant_id = p_tenant_id
      and id = v_municipality_id
    returning updated_at
    into v_updated_at;

    insert into public.app_entity_history (
      tenant_id,
      module_key,
      entity_table,
      entity_id,
      entity_code,
      change_type,
      reason,
      changes,
      metadata,
      created_by,
      updated_by
    )
    values (
      p_tenant_id,
      'municipio',
      'project_municipalities',
      v_municipality_id,
      v_name,
      'UPDATE',
      null,
      v_changes,
      '{}'::jsonb,
      p_actor_user_id,
      p_actor_user_id
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'municipality_id', v_municipality_id,
    'updated_at', v_updated_at,
    'message',
      case
        when p_municipality_id is null then format('Municipio %s cadastrado com sucesso.', v_name)
        else format('Municipio %s atualizado com sucesso.', v_name)
      end
  );
exception
  when unique_violation then
    get stacked diagnostics v_constraint_name = constraint_name;
    if v_constraint_name = 'project_municipalities_tenant_id_name_normalized_key' then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'DUPLICATE_NAME',
        'message', 'Ja existe Municipio com este nome no tenant atual.'
      );
    end if;
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_VALUE',
      'message', 'Registro duplicado ao salvar o Municipio.'
    );
end;
$$;

revoke all on function public.save_municipality_record(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.save_municipality_record(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz
) to service_role;

create or replace function public.set_municipality_record_status(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_municipality_id uuid,
  p_action text,
  p_reason text,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.project_municipalities%rowtype;
  v_action text := case when upper(coalesce(p_action, '')) = 'ACTIVATE' then 'ACTIVATE' else 'CANCEL' end;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_updated_at timestamptz;
  v_next_active boolean;
  v_changes jsonb;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'TENANT_OR_ACTOR_REQUIRED',
      'message', 'Tenant e usuario sao obrigatorios para alterar Municipio.'
    );
  end if;

  if p_municipality_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MUNICIPALITY_REQUIRED',
      'message', 'Municipio invalido para atualizar status.'
    );
  end if;

  if v_reason is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', case when v_action = 'ACTIVATE' then 'ACTIVATION_REASON_REQUIRED' else 'CANCELLATION_REASON_REQUIRED' end,
      'message', case when v_action = 'ACTIVATE' then 'Informe o motivo da ativacao.' else 'Informe o motivo do cancelamento.' end
    );
  end if;

  select *
  into v_current
  from public.project_municipalities
  where tenant_id = p_tenant_id
    and id = p_municipality_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'MUNICIPALITY_NOT_FOUND',
      'message', 'Municipio nao encontrado.'
    );
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
      'message', 'Atualize a lista antes de alterar o status do Municipio.'
    );
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'CONCURRENT_MODIFICATION',
      'message', format('O Municipio %s foi alterado por outro usuario. Recarregue os dados antes de alterar o status.', v_current.name)
    );
  end if;

  if v_action = 'CANCEL' and not v_current.ativo then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'STATUS_ALREADY_CHANGED',
      'message', format('Municipio %s ja esta inativo.', v_current.name)
    );
  end if;

  if v_action = 'ACTIVATE' and v_current.ativo then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'STATUS_ALREADY_CHANGED',
      'message', format('Municipio %s ja esta ativo.', v_current.name)
    );
  end if;

  v_next_active := v_action = 'ACTIVATE';

  update public.project_municipalities
  set
    ativo = v_next_active,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = p_municipality_id
  returning updated_at
  into v_updated_at;

  v_changes := jsonb_build_object(
    'isActive',
    jsonb_build_object('from', v_current.ativo::text, 'to', v_next_active::text)
  ) || case
    when v_action = 'ACTIVATE' then jsonb_build_object('activationReason', jsonb_build_object('from', null, 'to', v_reason))
    else jsonb_build_object('cancellationReason', jsonb_build_object('from', null, 'to', v_reason))
  end;

  insert into public.app_entity_history (
    tenant_id,
    module_key,
    entity_table,
    entity_id,
    entity_code,
    change_type,
    reason,
    changes,
    metadata,
    created_by,
    updated_by
  )
  values (
    p_tenant_id,
    'municipio',
    'project_municipalities',
    p_municipality_id,
    v_current.name,
    v_action,
    v_reason,
    v_changes,
    '{}'::jsonb,
    p_actor_user_id,
    p_actor_user_id
  );

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'municipality_id', p_municipality_id,
    'updated_at', v_updated_at,
    'message',
      case
        when v_action = 'ACTIVATE' then format('Municipio %s ativado com sucesso.', v_current.name)
        else format('Municipio %s cancelado com sucesso.', v_current.name)
      end
  );
end;
$$;

revoke all on function public.set_municipality_record_status(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.set_municipality_record_status(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz
) to service_role;

do $$
declare
  v_save_fn regprocedure := 'public.save_municipality_record(uuid, uuid, uuid, text, timestamptz)'::regprocedure;
  v_status_fn regprocedure := 'public.set_municipality_record_status(uuid, uuid, uuid, text, text, timestamptz)'::regprocedure;
begin
  if has_function_privilege('anon', v_save_fn, 'execute')
     or has_function_privilege('authenticated', v_save_fn, 'execute') then
    raise exception '391: save_municipality_record ainda executavel por anon/authenticated';
  end if;

  if has_function_privilege('anon', v_status_fn, 'execute')
     or has_function_privilege('authenticated', v_status_fn, 'execute') then
    raise exception '391: set_municipality_record_status ainda executavel por anon/authenticated';
  end if;
end;
$$;
