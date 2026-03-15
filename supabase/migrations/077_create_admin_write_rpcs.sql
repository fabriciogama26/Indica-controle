-- 077_create_admin_write_rpcs.sql
-- Centraliza escritas administrativas e cadastrais em RPCs transacionais com controle de concorrencia.

create or replace function public.save_project_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_project_id uuid default null,
  p_sob text default null,
  p_fob text default null,
  p_service_center uuid default null,
  p_partner uuid default null,
  p_service_type uuid default null,
  p_execution_deadline date default null,
  p_priority uuid default null,
  p_estimated_value numeric default null,
  p_voltage_level uuid default null,
  p_project_size uuid default null,
  p_contractor_responsible uuid default null,
  p_utility_responsible uuid default null,
  p_utility_field_manager uuid default null,
  p_street text default null,
  p_neighborhood text default null,
  p_city uuid default null,
  p_service_description text default null,
  p_observation text default null,
  p_changes jsonb default '{}'::jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.project%rowtype;
  v_project_id uuid;
  v_updated_at timestamptz;
begin
  if p_project_id is null then
    insert into public.project (
      tenant_id,
      sob,
      fob,
      service_center,
      partner,
      service_type,
      execution_deadline,
      priority,
      estimated_value,
      voltage_level,
      project_size,
      contractor_responsible,
      utility_responsible,
      utility_field_manager,
      street,
      neighborhood,
      city,
      service_description,
      observation,
      is_active,
      cancellation_reason,
      canceled_at,
      canceled_by,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      p_sob,
      p_fob,
      p_service_center,
      p_partner,
      p_service_type,
      p_execution_deadline,
      p_priority,
      p_estimated_value,
      p_voltage_level,
      p_project_size,
      p_contractor_responsible,
      p_utility_responsible,
      p_utility_field_manager,
      p_street,
      p_neighborhood,
      p_city,
      nullif(btrim(coalesce(p_service_description, '')), ''),
      nullif(btrim(coalesce(p_observation, '')), ''),
      true,
      null,
      null,
      null,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at
    into v_project_id, v_updated_at;

    return jsonb_build_object(
      'success', true,
      'status', 200,
      'project_id', v_project_id,
      'updated_at', v_updated_at
    );
  end if;

  select *
  into v_current
  from public.project
  where id = p_project_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'PROJECT_NOT_FOUND',
      'message', 'Projeto nao encontrado.'
    );
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
      'message', 'Atualize a lista antes de editar o projeto.'
    );
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'CONCURRENT_MODIFICATION',
      'message', format('O projeto %s foi alterado por outro usuario. Recarregue os dados antes de salvar novamente.', v_current.sob)
    );
  end if;

  if not v_current.is_active then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'RECORD_INACTIVE',
      'message', 'Projeto inativo nao pode ser editado.'
    );
  end if;

  update public.project
  set
    sob = p_sob,
    fob = p_fob,
    service_center = p_service_center,
    partner = p_partner,
    service_type = p_service_type,
    execution_deadline = p_execution_deadline,
    priority = p_priority,
    estimated_value = p_estimated_value,
    voltage_level = p_voltage_level,
    project_size = p_project_size,
    contractor_responsible = p_contractor_responsible,
    utility_responsible = p_utility_responsible,
    utility_field_manager = p_utility_field_manager,
    street = p_street,
    neighborhood = p_neighborhood,
    city = p_city,
    service_description = nullif(btrim(coalesce(p_service_description, '')), ''),
    observation = nullif(btrim(coalesce(p_observation, '')), ''),
    updated_by = p_actor_user_id
  where id = p_project_id
    and tenant_id = p_tenant_id
  returning id, updated_at
  into v_project_id, v_updated_at;

  if coalesce(jsonb_object_length(coalesce(p_changes, '{}'::jsonb)), 0) > 0 then
    insert into public.project_history (
      tenant_id,
      project_id,
      change_type,
      changes,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      p_project_id,
      'UPDATE',
      coalesce(p_changes, '{}'::jsonb),
      p_actor_user_id,
      p_actor_user_id
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'project_id', v_project_id,
    'updated_at', v_updated_at
  );
exception
  when unique_violation then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_PROJECT_SOB',
      'message', 'Ja existe projeto com este SOB no tenant atual.'
    );
end;
$$;

create or replace function public.set_project_record_status(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_project_id uuid,
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
  v_current public.project%rowtype;
  v_action text := case when upper(coalesce(p_action, '')) = 'ACTIVATE' then 'ACTIVATE' else 'CANCEL' end;
  v_event_timestamp timestamptz := now();
  v_updated_at timestamptz;
  v_programming_count bigint;
  v_changes jsonb;
begin
  select *
  into v_current
  from public.project
  where id = p_project_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROJECT_NOT_FOUND', 'message', 'Projeto nao encontrado.');
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'EXPECTED_UPDATED_AT_REQUIRED', 'message', 'Atualize a lista antes de alterar o status do projeto.');
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'CONCURRENT_MODIFICATION',
      'message', format('O projeto %s foi alterado por outro usuario. Recarregue os dados antes de alterar o status.', v_current.sob)
    );
  end if;

  if v_action = 'CANCEL' and not v_current.is_active then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'STATUS_ALREADY_CHANGED', 'message', format('Projeto %s ja esta inativo.', v_current.sob));
  end if;

  if v_action = 'ACTIVATE' and v_current.is_active then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'STATUS_ALREADY_CHANGED', 'message', format('Projeto %s ja esta ativo.', v_current.sob));
  end if;

  if v_action = 'CANCEL' then
    select count(*)
    into v_programming_count
    from public.project_programming
    where tenant_id = p_tenant_id
      and project_id = p_project_id
      and status in ('PROGRAMADA', 'ADIADA');

    if v_programming_count > 0 then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'PROJECT_HAS_PENDING_PROGRAMMING',
        'message', format('Projeto %s possui programacoes programadas ou adiadas. Resolva essas etapas antes de inativar o projeto.', v_current.sob)
      );
    end if;
  end if;

  update public.project
  set
    is_active = case when v_action = 'ACTIVATE' then true else false end,
    cancellation_reason = case when v_action = 'ACTIVATE' then null else nullif(btrim(coalesce(p_reason, '')), '') end,
    canceled_at = case when v_action = 'ACTIVATE' then null else v_event_timestamp end,
    canceled_by = case when v_action = 'ACTIVATE' then null else p_actor_user_id end,
    updated_by = p_actor_user_id
  where id = p_project_id
    and tenant_id = p_tenant_id
  returning updated_at
  into v_updated_at;

  insert into public.project_cancellation_history (
    tenant_id,
    project_id,
    action_type,
    reason,
    created_by,
    updated_by
  ) values (
    p_tenant_id,
    p_project_id,
    v_action,
    nullif(btrim(coalesce(p_reason, '')), ''),
    p_actor_user_id,
    p_actor_user_id
  );

  v_changes := case
    when v_action = 'ACTIVATE' then jsonb_build_object(
      'isActive', jsonb_build_object('from', 'false', 'to', 'true'),
      'activationReason', jsonb_build_object('from', null, 'to', nullif(btrim(coalesce(p_reason, '')), '')),
      'canceledAt', jsonb_build_object('from', v_current.canceled_at, 'to', null),
      'cancellationReason', jsonb_build_object('from', v_current.cancellation_reason, 'to', null)
    )
    else jsonb_build_object(
      'isActive', jsonb_build_object('from', 'true', 'to', 'false'),
      'cancellationReason', jsonb_build_object('from', null, 'to', nullif(btrim(coalesce(p_reason, '')), '')),
      'canceledAt', jsonb_build_object('from', null, 'to', v_event_timestamp)
    )
  end;

  insert into public.project_history (
    tenant_id,
    project_id,
    change_type,
    changes,
    created_by,
    updated_by
  ) values (
    p_tenant_id,
    p_project_id,
    v_action,
    v_changes,
    p_actor_user_id,
    p_actor_user_id
  );

  return jsonb_build_object('success', true, 'status', 200, 'project_id', p_project_id, 'updated_at', v_updated_at);
end;
$$;

create or replace function public.save_material_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_material_id uuid default null,
  p_codigo text default null,
  p_descricao text default null,
  p_umb text default null,
  p_tipo text default null,
  p_unit_price numeric default null,
  p_changes jsonb default '{}'::jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.materials%rowtype;
  v_material_id uuid;
  v_updated_at timestamptz;
begin
  if p_material_id is null then
    insert into public.materials (
      tenant_id,
      codigo,
      descricao,
      umb,
      tipo,
      unit_price,
      is_active,
      cancellation_reason,
      canceled_at,
      canceled_by,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      p_codigo,
      p_descricao,
      nullif(btrim(coalesce(p_umb, '')), ''),
      p_tipo,
      p_unit_price,
      true,
      null,
      null,
      null,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at
    into v_material_id, v_updated_at;

    return jsonb_build_object('success', true, 'status', 200, 'material_id', v_material_id, 'updated_at', v_updated_at);
  end if;

  select *
  into v_current
  from public.materials
  where id = p_material_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'MATERIAL_NOT_FOUND', 'message', 'Material nao encontrado para edicao.');
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'EXPECTED_UPDATED_AT_REQUIRED', 'message', 'Atualize a lista antes de editar o material.');
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'CONCURRENT_MODIFICATION',
      'message', format('O material %s foi alterado por outro usuario. Recarregue os dados antes de salvar novamente.', v_current.codigo)
    );
  end if;

  if not v_current.is_active then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'RECORD_INACTIVE', 'message', 'Ative o material antes de editar.');
  end if;

  update public.materials
  set
    codigo = p_codigo,
    descricao = p_descricao,
    umb = nullif(btrim(coalesce(p_umb, '')), ''),
    tipo = p_tipo,
    unit_price = p_unit_price,
    updated_by = p_actor_user_id
  where id = p_material_id
    and tenant_id = p_tenant_id
  returning id, updated_at
  into v_material_id, v_updated_at;

  if coalesce(jsonb_object_length(coalesce(p_changes, '{}'::jsonb)), 0) > 0 then
    insert into public.material_history (
      tenant_id,
      material_id,
      change_type,
      changes,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      p_material_id,
      'UPDATE',
      coalesce(p_changes, '{}'::jsonb),
      p_actor_user_id,
      p_actor_user_id
    );
  end if;

  return jsonb_build_object('success', true, 'status', 200, 'material_id', v_material_id, 'updated_at', v_updated_at);
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'DUPLICATE_MATERIAL_CODE', 'message', 'Ja existe material com este codigo no tenant atual.');
end;
$$;

create or replace function public.set_material_record_status(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_material_id uuid,
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
  v_current public.materials%rowtype;
  v_action text := case when upper(coalesce(p_action, '')) = 'ACTIVATE' then 'ACTIVATE' else 'CANCEL' end;
  v_now timestamptz := now();
  v_updated_at timestamptz;
  v_changes jsonb;
begin
  select *
  into v_current
  from public.materials
  where id = p_material_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'MATERIAL_NOT_FOUND', 'message', 'Material nao encontrado.');
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'EXPECTED_UPDATED_AT_REQUIRED', 'message', 'Atualize a lista antes de alterar o status do material.');
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONCURRENT_MODIFICATION', 'message', format('O material %s foi alterado por outro usuario. Recarregue os dados antes de alterar o status.', v_current.codigo));
  end if;

  if v_action = 'CANCEL' and not v_current.is_active then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'STATUS_ALREADY_CHANGED', 'message', format('Material %s ja esta inativo.', v_current.codigo));
  end if;

  if v_action = 'ACTIVATE' and v_current.is_active then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'STATUS_ALREADY_CHANGED', 'message', format('Material %s ja esta ativo.', v_current.codigo));
  end if;

  update public.materials
  set
    is_active = case when v_action = 'ACTIVATE' then true else false end,
    cancellation_reason = case when v_action = 'ACTIVATE' then null else nullif(btrim(coalesce(p_reason, '')), '') end,
    canceled_at = case when v_action = 'ACTIVATE' then null else v_now end,
    canceled_by = case when v_action = 'ACTIVATE' then null else p_actor_user_id end,
    updated_by = p_actor_user_id
  where id = p_material_id
    and tenant_id = p_tenant_id
  returning updated_at
  into v_updated_at;

  insert into public.material_cancellation_history (
    tenant_id,
    material_id,
    action_type,
    reason,
    created_by,
    updated_by
  ) values (
    p_tenant_id,
    p_material_id,
    v_action,
    nullif(btrim(coalesce(p_reason, '')), ''),
    p_actor_user_id,
    p_actor_user_id
  );

  v_changes := case
    when v_action = 'ACTIVATE' then jsonb_build_object(
      'isActive', jsonb_build_object('from', 'false', 'to', 'true'),
      'cancellationReason', jsonb_build_object('from', v_current.cancellation_reason, 'to', null),
      'canceledAt', jsonb_build_object('from', v_current.canceled_at, 'to', null),
      'activationReason', jsonb_build_object('from', null, 'to', nullif(btrim(coalesce(p_reason, '')), ''))
    )
    else jsonb_build_object(
      'isActive', jsonb_build_object('from', 'true', 'to', 'false'),
      'cancellationReason', jsonb_build_object('from', v_current.cancellation_reason, 'to', nullif(btrim(coalesce(p_reason, '')), '')),
      'canceledAt', jsonb_build_object('from', v_current.canceled_at, 'to', v_now)
    )
  end;

  insert into public.material_history (
    tenant_id,
    material_id,
    change_type,
    changes,
    created_by,
    updated_by
  ) values (
    p_tenant_id,
    p_material_id,
    v_action,
    v_changes,
    p_actor_user_id,
    p_actor_user_id
  );

  return jsonb_build_object('success', true, 'status', 200, 'material_id', p_material_id, 'updated_at', v_updated_at);
end;
$$;

create or replace function public.save_service_activity_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_activity_id uuid default null,
  p_code text default null,
  p_description text default null,
  p_team_type_id uuid default null,
  p_group_name text default null,
  p_unit_value numeric default null,
  p_unit text default null,
  p_scope text default null,
  p_changes jsonb default '{}'::jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.service_activities%rowtype;
  v_activity_id uuid;
  v_updated_at timestamptz;
begin
  if p_activity_id is null then
    insert into public.service_activities (
      tenant_id,
      code,
      description,
      team_type_id,
      group_name,
      unit_value,
      unit,
      scope,
      ativo,
      cancellation_reason,
      canceled_at,
      canceled_by,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      p_code,
      p_description,
      p_team_type_id,
      nullif(btrim(coalesce(p_group_name, '')), ''),
      p_unit_value,
      p_unit,
      nullif(btrim(coalesce(p_scope, '')), ''),
      true,
      null,
      null,
      null,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at
    into v_activity_id, v_updated_at;

    return jsonb_build_object('success', true, 'status', 200, 'activity_id', v_activity_id, 'updated_at', v_updated_at);
  end if;

  select *
  into v_current
  from public.service_activities
  where id = p_activity_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'ACTIVITY_NOT_FOUND', 'message', 'Atividade nao encontrada.');
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'EXPECTED_UPDATED_AT_REQUIRED', 'message', 'Atualize a lista antes de editar a atividade.');
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONCURRENT_MODIFICATION', 'message', format('A atividade %s foi alterada por outro usuario. Recarregue os dados antes de salvar novamente.', v_current.code));
  end if;

  if not v_current.ativo then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'RECORD_INACTIVE', 'message', 'Ative a atividade antes de editar.');
  end if;

  update public.service_activities
  set
    code = p_code,
    description = p_description,
    team_type_id = p_team_type_id,
    group_name = nullif(btrim(coalesce(p_group_name, '')), ''),
    unit_value = p_unit_value,
    unit = p_unit,
    scope = nullif(btrim(coalesce(p_scope, '')), ''),
    updated_by = p_actor_user_id
  where id = p_activity_id
    and tenant_id = p_tenant_id
  returning id, updated_at
  into v_activity_id, v_updated_at;

  if coalesce(jsonb_object_length(coalesce(p_changes, '{}'::jsonb)), 0) > 0 then
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
    ) values (
      p_tenant_id,
      'atividades',
      'service_activities',
      p_activity_id,
      p_code,
      'UPDATE',
      null,
      coalesce(p_changes, '{}'::jsonb),
      '{}'::jsonb,
      p_actor_user_id,
      p_actor_user_id
    );
  end if;

  return jsonb_build_object('success', true, 'status', 200, 'activity_id', v_activity_id, 'updated_at', v_updated_at);
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'DUPLICATE_ACTIVITY_CODE', 'message', 'Ja existe atividade com este codigo no tenant atual.');
end;
$$;

create or replace function public.set_service_activity_record_status(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_activity_id uuid,
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
  v_current public.service_activities%rowtype;
  v_action text := case when upper(coalesce(p_action, '')) = 'ACTIVATE' then 'ACTIVATE' else 'CANCEL' end;
  v_now timestamptz := now();
  v_updated_at timestamptz;
  v_changes jsonb;
begin
  select *
  into v_current
  from public.service_activities
  where id = p_activity_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'ACTIVITY_NOT_FOUND', 'message', 'Atividade nao encontrada.');
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'EXPECTED_UPDATED_AT_REQUIRED', 'message', 'Atualize a lista antes de alterar o status da atividade.');
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONCURRENT_MODIFICATION', 'message', format('A atividade %s foi alterada por outro usuario. Recarregue os dados antes de alterar o status.', v_current.code));
  end if;

  if v_action = 'CANCEL' and not v_current.ativo then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'STATUS_ALREADY_CHANGED', 'message', format('Atividade %s ja esta inativa.', v_current.code));
  end if;

  if v_action = 'ACTIVATE' and v_current.ativo then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'STATUS_ALREADY_CHANGED', 'message', format('Atividade %s ja esta ativa.', v_current.code));
  end if;

  update public.service_activities
  set
    ativo = case when v_action = 'ACTIVATE' then true else false end,
    cancellation_reason = case when v_action = 'ACTIVATE' then null else nullif(btrim(coalesce(p_reason, '')), '') end,
    canceled_at = case when v_action = 'ACTIVATE' then null else v_now end,
    canceled_by = case when v_action = 'ACTIVATE' then null else p_actor_user_id end,
    updated_by = p_actor_user_id
  where id = p_activity_id
    and tenant_id = p_tenant_id
  returning updated_at
  into v_updated_at;

  v_changes := case
    when v_action = 'ACTIVATE' then jsonb_build_object(
      'isActive', jsonb_build_object('from', 'false', 'to', 'true'),
      'cancellationReason', jsonb_build_object('from', v_current.cancellation_reason, 'to', null),
      'canceledAt', jsonb_build_object('from', v_current.canceled_at, 'to', null),
      'activationReason', jsonb_build_object('from', null, 'to', nullif(btrim(coalesce(p_reason, '')), ''))
    )
    else jsonb_build_object(
      'isActive', jsonb_build_object('from', 'true', 'to', 'false'),
      'cancellationReason', jsonb_build_object('from', v_current.cancellation_reason, 'to', nullif(btrim(coalesce(p_reason, '')), '')),
      'canceledAt', jsonb_build_object('from', v_current.canceled_at, 'to', v_now)
    )
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
  ) values (
    p_tenant_id,
    'atividades',
    'service_activities',
    p_activity_id,
    v_current.code,
    v_action,
    nullif(btrim(coalesce(p_reason, '')), ''),
    v_changes,
    '{}'::jsonb,
    p_actor_user_id,
    p_actor_user_id
  );

  return jsonb_build_object('success', true, 'status', 200, 'activity_id', p_activity_id, 'updated_at', v_updated_at);
end;
$$;

create or replace function public.save_team_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_team_id uuid default null,
  p_name text default null,
  p_vehicle_plate text default null,
  p_service_center_id uuid default null,
  p_team_type_id uuid default null,
  p_foreman_person_id uuid default null,
  p_changes jsonb default '{}'::jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.teams%rowtype;
  v_team_id uuid;
  v_updated_at timestamptz;
begin
  if p_team_id is null then
    insert into public.teams (
      tenant_id,
      name,
      vehicle_plate,
      service_center_id,
      team_type_id,
      foreman_person_id,
      ativo,
      cancellation_reason,
      canceled_at,
      canceled_by,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      p_name,
      p_vehicle_plate,
      p_service_center_id,
      p_team_type_id,
      p_foreman_person_id,
      true,
      null,
      null,
      null,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at
    into v_team_id, v_updated_at;

    return jsonb_build_object('success', true, 'status', 200, 'team_id', v_team_id, 'updated_at', v_updated_at);
  end if;

  select *
  into v_current
  from public.teams
  where id = p_team_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'TEAM_NOT_FOUND', 'message', 'Equipe nao encontrada.');
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'EXPECTED_UPDATED_AT_REQUIRED', 'message', 'Atualize a lista antes de editar a equipe.');
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONCURRENT_MODIFICATION', 'message', format('A equipe %s foi alterada por outro usuario. Recarregue os dados antes de salvar novamente.', v_current.name));
  end if;

  if not v_current.ativo then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'RECORD_INACTIVE', 'message', 'Ative a equipe antes de editar.');
  end if;

  update public.teams
  set
    name = p_name,
    vehicle_plate = p_vehicle_plate,
    service_center_id = p_service_center_id,
    team_type_id = p_team_type_id,
    foreman_person_id = p_foreman_person_id,
    updated_by = p_actor_user_id
  where id = p_team_id
    and tenant_id = p_tenant_id
  returning id, updated_at
  into v_team_id, v_updated_at;

  if coalesce(jsonb_object_length(coalesce(p_changes, '{}'::jsonb)), 0) > 0 then
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
    ) values (
      p_tenant_id,
      'equipes',
      'teams',
      p_team_id,
      p_name,
      'UPDATE',
      null,
      coalesce(p_changes, '{}'::jsonb),
      '{}'::jsonb,
      p_actor_user_id,
      p_actor_user_id
    );
  end if;

  return jsonb_build_object('success', true, 'status', 200, 'team_id', v_team_id, 'updated_at', v_updated_at);
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'DUPLICATE_TEAM_COMBINATION', 'message', 'Ja existe equipe com o mesmo nome, encarregado e placa no tenant atual.');
end;
$$;

create or replace function public.set_team_record_status(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_team_id uuid,
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
  v_current public.teams%rowtype;
  v_action text := case when upper(coalesce(p_action, '')) = 'ACTIVATE' then 'ACTIVATE' else 'CANCEL' end;
  v_now timestamptz := now();
  v_updated_at timestamptz;
  v_changes jsonb;
begin
  select *
  into v_current
  from public.teams
  where id = p_team_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'TEAM_NOT_FOUND', 'message', 'Equipe nao encontrada.');
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'EXPECTED_UPDATED_AT_REQUIRED', 'message', 'Atualize a lista antes de alterar o status da equipe.');
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONCURRENT_MODIFICATION', 'message', format('A equipe %s foi alterada por outro usuario. Recarregue os dados antes de alterar o status.', v_current.name));
  end if;

  if v_action = 'CANCEL' and not v_current.ativo then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'STATUS_ALREADY_CHANGED', 'message', format('Equipe %s ja esta inativa.', v_current.name));
  end if;

  if v_action = 'ACTIVATE' and v_current.ativo then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'STATUS_ALREADY_CHANGED', 'message', format('Equipe %s ja esta ativa.', v_current.name));
  end if;

  update public.teams
  set
    ativo = case when v_action = 'ACTIVATE' then true else false end,
    cancellation_reason = case when v_action = 'ACTIVATE' then null else nullif(btrim(coalesce(p_reason, '')), '') end,
    canceled_at = case when v_action = 'ACTIVATE' then null else v_now end,
    canceled_by = case when v_action = 'ACTIVATE' then null else p_actor_user_id end,
    updated_by = p_actor_user_id
  where id = p_team_id
    and tenant_id = p_tenant_id
  returning updated_at
  into v_updated_at;

  v_changes := case
    when v_action = 'ACTIVATE' then jsonb_build_object(
      'isActive', jsonb_build_object('from', 'false', 'to', 'true'),
      'cancellationReason', jsonb_build_object('from', v_current.cancellation_reason, 'to', null),
      'canceledAt', jsonb_build_object('from', v_current.canceled_at, 'to', null),
      'activationReason', jsonb_build_object('from', null, 'to', nullif(btrim(coalesce(p_reason, '')), ''))
    )
    else jsonb_build_object(
      'isActive', jsonb_build_object('from', 'true', 'to', 'false'),
      'cancellationReason', jsonb_build_object('from', v_current.cancellation_reason, 'to', nullif(btrim(coalesce(p_reason, '')), '')),
      'canceledAt', jsonb_build_object('from', v_current.canceled_at, 'to', v_now)
    )
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
  ) values (
    p_tenant_id,
    'equipes',
    'teams',
    p_team_id,
    v_current.name,
    v_action,
    nullif(btrim(coalesce(p_reason, '')), ''),
    v_changes,
    '{}'::jsonb,
    p_actor_user_id,
    p_actor_user_id
  );

  return jsonb_build_object('success', true, 'status', 200, 'team_id', p_team_id, 'updated_at', v_updated_at);
end;
$$;

create or replace function public.save_user_permissions(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_role_id uuid,
  p_ativo boolean,
  p_permissions jsonb default '[]'::jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_user public.app_users%rowtype;
  v_next_updated_at timestamptz := now();
  v_permission_item jsonb;
  v_page_key text;
  v_can_access boolean;
  v_current_permission boolean;
begin
  if jsonb_typeof(coalesce(p_permissions, '[]'::jsonb)) <> 'array' then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_PERMISSIONS_PAYLOAD', 'message', 'A lista de permissoes deve ser um array json.');
  end if;

  select *
  into v_target_user
  from public.app_users
  where id = p_target_user_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'TARGET_USER_NOT_FOUND', 'message', 'Usuario nao encontrado no tenant atual.');
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'EXPECTED_UPDATED_AT_REQUIRED', 'message', 'Recarregue as credenciais do usuario antes de salvar.');
  end if;

  if v_target_user.updated_at <> p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'CONCURRENT_MODIFICATION',
      'message', format('As credenciais do usuario %s foram alteradas por outro administrador. Recarregue os dados antes de salvar novamente.', v_target_user.login_name)
    );
  end if;

  update public.app_users
  set
    role_id = p_role_id,
    ativo = p_ativo,
    updated_by = p_actor_user_id,
    updated_at = v_next_updated_at
  where id = p_target_user_id
    and tenant_id = p_tenant_id;

  if v_target_user.role_id is distinct from p_role_id then
    insert into public.app_user_permission_history (
      tenant_id,
      target_user_id,
      change_type,
      previous_role_id,
      new_role_id,
      metadata,
      created_by
    ) values (
      p_tenant_id,
      p_target_user_id,
      'ROLE_CHANGED',
      v_target_user.role_id,
      p_role_id,
      jsonb_build_object(
        'previousRoleId', v_target_user.role_id,
        'newRoleId', p_role_id
      ),
      p_actor_user_id
    );
  end if;

  if v_target_user.ativo is distinct from p_ativo then
    insert into public.app_user_permission_history (
      tenant_id,
      target_user_id,
      change_type,
      previous_ativo,
      new_ativo,
      created_by
    ) values (
      p_tenant_id,
      p_target_user_id,
      'STATUS_CHANGED',
      v_target_user.ativo,
      p_ativo,
      p_actor_user_id
    );
  end if;

  for v_permission_item in
    select value
    from jsonb_array_elements(coalesce(p_permissions, '[]'::jsonb))
  loop
    v_page_key := nullif(btrim(coalesce(v_permission_item ->> 'pageKey', '')), '');
    if v_page_key is null then
      continue;
    end if;

    v_can_access := coalesce((v_permission_item ->> 'enabled')::boolean, false);

    select upp.can_access
    into v_current_permission
    from public.app_user_page_permissions upp
    where upp.tenant_id = p_tenant_id
      and upp.user_id = p_target_user_id
      and upp.page_key = v_page_key;

    insert into public.app_user_page_permissions (
      tenant_id,
      user_id,
      page_key,
      can_access,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      p_target_user_id,
      v_page_key,
      v_can_access,
      p_actor_user_id,
      p_actor_user_id
    )
    on conflict (tenant_id, user_id, page_key) do update
    set
      can_access = excluded.can_access,
      updated_by = excluded.updated_by,
      updated_at = now();

    if v_current_permission is distinct from v_can_access then
      insert into public.app_user_permission_history (
        tenant_id,
        target_user_id,
        page_key,
        change_type,
        previous_can_access,
        new_can_access,
        created_by
      ) values (
        p_tenant_id,
        p_target_user_id,
        v_page_key,
        'PAGE_ACCESS_CHANGED',
        v_current_permission,
        v_can_access,
        p_actor_user_id
      );
    end if;
  end loop;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'updated_at', v_next_updated_at
  );
end;
$$;

revoke all on function public.save_project_record(uuid, uuid, uuid, text, text, uuid, uuid, uuid, date, uuid, numeric, uuid, uuid, uuid, uuid, uuid, text, text, uuid, text, text, jsonb, timestamptz) from public;
grant execute on function public.save_project_record(uuid, uuid, uuid, text, text, uuid, uuid, uuid, date, uuid, numeric, uuid, uuid, uuid, uuid, uuid, text, text, uuid, text, text, jsonb, timestamptz) to authenticated;
grant execute on function public.save_project_record(uuid, uuid, uuid, text, text, uuid, uuid, uuid, date, uuid, numeric, uuid, uuid, uuid, uuid, uuid, text, text, uuid, text, text, jsonb, timestamptz) to service_role;

revoke all on function public.set_project_record_status(uuid, uuid, uuid, text, text, timestamptz) from public;
grant execute on function public.set_project_record_status(uuid, uuid, uuid, text, text, timestamptz) to authenticated;
grant execute on function public.set_project_record_status(uuid, uuid, uuid, text, text, timestamptz) to service_role;

revoke all on function public.save_material_record(uuid, uuid, uuid, text, text, text, text, numeric, jsonb, timestamptz) from public;
grant execute on function public.save_material_record(uuid, uuid, uuid, text, text, text, text, numeric, jsonb, timestamptz) to authenticated;
grant execute on function public.save_material_record(uuid, uuid, uuid, text, text, text, text, numeric, jsonb, timestamptz) to service_role;

revoke all on function public.set_material_record_status(uuid, uuid, uuid, text, text, timestamptz) from public;
grant execute on function public.set_material_record_status(uuid, uuid, uuid, text, text, timestamptz) to authenticated;
grant execute on function public.set_material_record_status(uuid, uuid, uuid, text, text, timestamptz) to service_role;

revoke all on function public.save_service_activity_record(uuid, uuid, uuid, text, text, uuid, text, numeric, text, text, jsonb, timestamptz) from public;
grant execute on function public.save_service_activity_record(uuid, uuid, uuid, text, text, uuid, text, numeric, text, text, jsonb, timestamptz) to authenticated;
grant execute on function public.save_service_activity_record(uuid, uuid, uuid, text, text, uuid, text, numeric, text, text, jsonb, timestamptz) to service_role;

revoke all on function public.set_service_activity_record_status(uuid, uuid, uuid, text, text, timestamptz) from public;
grant execute on function public.set_service_activity_record_status(uuid, uuid, uuid, text, text, timestamptz) to authenticated;
grant execute on function public.set_service_activity_record_status(uuid, uuid, uuid, text, text, timestamptz) to service_role;

revoke all on function public.save_team_record(uuid, uuid, uuid, text, text, uuid, uuid, uuid, jsonb, timestamptz) from public;
grant execute on function public.save_team_record(uuid, uuid, uuid, text, text, uuid, uuid, uuid, jsonb, timestamptz) to authenticated;
grant execute on function public.save_team_record(uuid, uuid, uuid, text, text, uuid, uuid, uuid, jsonb, timestamptz) to service_role;

revoke all on function public.set_team_record_status(uuid, uuid, uuid, text, text, timestamptz) from public;
grant execute on function public.set_team_record_status(uuid, uuid, uuid, text, text, timestamptz) to authenticated;
grant execute on function public.set_team_record_status(uuid, uuid, uuid, text, text, timestamptz) to service_role;

revoke all on function public.save_user_permissions(uuid, uuid, uuid, uuid, boolean, jsonb, timestamptz) from public;
grant execute on function public.save_user_permissions(uuid, uuid, uuid, uuid, boolean, jsonb, timestamptz) to authenticated;
grant execute on function public.save_user_permissions(uuid, uuid, uuid, uuid, boolean, jsonb, timestamptz) to service_role;
