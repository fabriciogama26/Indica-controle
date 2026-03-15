-- 079_create_people_and_invite_write_rpcs.sql
-- Centraliza escrita de Pessoas e auditoria de Invite em RPCs.

create or replace function public.save_person_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_person_id uuid default null,
  p_name text default null,
  p_matriculation text default null,
  p_job_title_id uuid default null,
  p_job_title_type_id uuid default null,
  p_job_level text default null,
  p_changes jsonb default '{}'::jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.people%rowtype;
  v_person_id uuid;
  v_updated_at timestamptz;
begin
  if p_person_id is null then
    insert into public.people (
      tenant_id,
      nome,
      matriculation,
      job_title_id,
      job_title_type_id,
      job_level,
      ativo,
      cancellation_reason,
      canceled_at,
      canceled_by,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      p_name,
      nullif(btrim(coalesce(p_matriculation, '')), ''),
      p_job_title_id,
      p_job_title_type_id,
      nullif(btrim(coalesce(p_job_level, '')), ''),
      true,
      null,
      null,
      null,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at
    into v_person_id, v_updated_at;

    return jsonb_build_object(
      'success', true,
      'status', 200,
      'person_id', v_person_id,
      'updated_at', v_updated_at
    );
  end if;

  select *
  into v_current
  from public.people
  where tenant_id = p_tenant_id
    and id = p_person_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'PERSON_NOT_FOUND',
      'message', 'Pessoa nao encontrada.'
    );
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
      'message', 'Atualize a lista antes de editar a pessoa.'
    );
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'CONCURRENT_MODIFICATION',
      'message', format('A pessoa %s foi alterada por outro usuario. Recarregue os dados antes de salvar novamente.', v_current.nome)
    );
  end if;

  if not v_current.ativo then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'RECORD_INACTIVE',
      'message', 'Ative a pessoa antes de editar.'
    );
  end if;

  update public.people
  set
    nome = p_name,
    matriculation = nullif(btrim(coalesce(p_matriculation, '')), ''),
    job_title_id = p_job_title_id,
    job_title_type_id = p_job_title_type_id,
    job_level = nullif(btrim(coalesce(p_job_level, '')), ''),
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = p_person_id
  returning id, updated_at
  into v_person_id, v_updated_at;

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
      'pessoas',
      'people',
      p_person_id,
      p_name,
      'UPDATE',
      null,
      coalesce(p_changes, '{}'::jsonb),
      '{}'::jsonb,
      p_actor_user_id,
      p_actor_user_id
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'person_id', v_person_id,
    'updated_at', v_updated_at
  );
exception
  when unique_violation then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_PERSON_IDENTITY',
      'message', 'Ja existe pessoa com o mesmo nome, matricula, cargo, tipo e nivel no tenant atual.'
    );
end;
$$;

create or replace function public.set_person_record_status(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_person_id uuid,
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
  v_current public.people%rowtype;
  v_action text := case when upper(coalesce(p_action, '')) = 'ACTIVATE' then 'ACTIVATE' else 'CANCEL' end;
  v_now timestamptz := now();
  v_updated_at timestamptz;
  v_changes jsonb;
begin
  select *
  into v_current
  from public.people
  where tenant_id = p_tenant_id
    and id = p_person_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'PERSON_NOT_FOUND',
      'message', 'Pessoa nao encontrada.'
    );
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
      'message', 'Atualize a lista antes de alterar o status da pessoa.'
    );
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'CONCURRENT_MODIFICATION',
      'message', format('A pessoa %s foi alterada por outro usuario. Recarregue os dados antes de alterar o status.', v_current.nome)
    );
  end if;

  if v_action = 'CANCEL' and not v_current.ativo then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'STATUS_ALREADY_CHANGED',
      'message', format('Pessoa %s ja esta inativa.', v_current.nome)
    );
  end if;

  if v_action = 'ACTIVATE' and v_current.ativo then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'STATUS_ALREADY_CHANGED',
      'message', format('Pessoa %s ja esta ativa.', v_current.nome)
    );
  end if;

  update public.people
  set
    ativo = case when v_action = 'ACTIVATE' then true else false end,
    cancellation_reason = case when v_action = 'ACTIVATE' then null else nullif(btrim(coalesce(p_reason, '')), '') end,
    canceled_at = case when v_action = 'ACTIVATE' then null else v_now end,
    canceled_by = case when v_action = 'ACTIVATE' then null else p_actor_user_id end,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = p_person_id
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
    'pessoas',
    'people',
    p_person_id,
    v_current.nome,
    v_action,
    nullif(btrim(coalesce(p_reason, '')), ''),
    v_changes,
    '{}'::jsonb,
    p_actor_user_id,
    p_actor_user_id
  );

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'person_id', p_person_id,
    'updated_at', v_updated_at
  );
end;
$$;

create or replace function public.append_user_invite_history(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_email text default null,
  p_redirect_to text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_exists boolean := false;
begin
  if p_tenant_id is null or p_actor_user_id is null or p_target_user_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_INVITE_HISTORY_PAYLOAD',
      'message', 'Payload invalido para registrar historico do convite.'
    );
  end if;

  select exists(
    select 1
    from public.app_users au
    where au.tenant_id = p_tenant_id
      and au.id = p_target_user_id
  )
  into v_target_exists;

  if not v_target_exists then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'TARGET_USER_NOT_FOUND',
      'message', 'Usuario nao encontrado no tenant atual.'
    );
  end if;

  insert into public.app_user_permission_history (
    tenant_id,
    target_user_id,
    change_type,
    metadata,
    created_by
  ) values (
    p_tenant_id,
    p_target_user_id,
    'INVITE_SENT',
    jsonb_build_object(
      'email', nullif(btrim(coalesce(p_email, '')), ''),
      'redirectTo', nullif(btrim(coalesce(p_redirect_to, '')), '')
    ),
    p_actor_user_id
  );

  return jsonb_build_object(
    'success', true,
    'status', 200
  );
end;
$$;

revoke all on function public.save_person_record(uuid, uuid, uuid, text, text, uuid, uuid, text, jsonb, timestamptz) from public;
grant execute on function public.save_person_record(uuid, uuid, uuid, text, text, uuid, uuid, text, jsonb, timestamptz) to authenticated;
grant execute on function public.save_person_record(uuid, uuid, uuid, text, text, uuid, uuid, text, jsonb, timestamptz) to service_role;

revoke all on function public.set_person_record_status(uuid, uuid, uuid, text, text, timestamptz) from public;
grant execute on function public.set_person_record_status(uuid, uuid, uuid, text, text, timestamptz) to authenticated;
grant execute on function public.set_person_record_status(uuid, uuid, uuid, text, text, timestamptz) to service_role;

revoke all on function public.append_user_invite_history(uuid, uuid, uuid, text, text) from public;
grant execute on function public.append_user_invite_history(uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.append_user_invite_history(uuid, uuid, uuid, text, text) to service_role;
