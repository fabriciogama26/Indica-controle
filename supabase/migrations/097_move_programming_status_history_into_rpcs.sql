-- 097_move_programming_status_history_into_rpcs.sql
-- Move o historico funcional de cancelamento/adiamento da Programacao para dentro das RPCs transacionais.

drop function if exists public.set_project_programming_status(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz
);

create or replace function public.set_project_programming_status(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_id uuid,
  p_status text,
  p_reason text,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_target_status text := upper(nullif(btrim(coalesce(p_status, '')), ''));
  v_current record;
  v_updated_at timestamptz;
  v_message text;
begin
  if p_programming_id is null or v_reason is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_STATUS_PAYLOAD',
      'message', 'Informe a programacao e o motivo da alteracao.'
    );
  end if;

  if v_target_status not in ('ADIADA', 'CANCELADA') then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_PROGRAMMING_STATUS',
      'message', 'Status invalido para a programacao.'
    );
  end if;

  select
    pp.id,
    pp.project_id,
    pp.team_id,
    pp.execution_date,
    pp.updated_at,
    pp.status,
    p.sob
  into v_current
  from public.project_programming pp
  join public.project p
    on p.id = pp.project_id
   and p.tenant_id = pp.tenant_id
  where pp.tenant_id = p_tenant_id
    and pp.id = p_programming_id
    and pp.status = 'PROGRAMADA'
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'PROGRAMMING_NOT_FOUND',
      'message', 'Programacao nao encontrada ou nao esta mais ativa na grade.'
    );
  end if;

  if p_expected_updated_at is not null
    and date_trunc('milliseconds', v_current.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'PROGRAMMING_CONFLICT',
      'message', 'Esta programacao foi alterada por outro usuario. Atualize a grade antes de continuar.'
    );
  end if;

  update public.project_programming
  set
    status = v_target_status,
    is_active = false,
    cancellation_reason = v_reason,
    canceled_at = now(),
    canceled_by = p_actor_user_id,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = p_programming_id;

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
    'programacao',
    'project_programming',
    p_programming_id,
    coalesce(v_current.sob, p_programming_id::text),
    case when v_target_status = 'CANCELADA' then 'CANCEL' else 'UPDATE' end,
    v_reason,
    jsonb_build_object(
      'status', jsonb_build_object('from', v_current.status, 'to', v_target_status),
      'isActive', jsonb_build_object('from', 'true', 'to', 'false'),
      'cancellationReason', jsonb_build_object('from', null, 'to', v_reason)
    ),
    jsonb_build_object(
      'action', v_target_status,
      'projectId', v_current.project_id,
      'teamId', v_current.team_id,
      'executionDate', v_current.execution_date
    ),
    p_actor_user_id,
    p_actor_user_id
  );

  select updated_at
  into v_updated_at
  from public.project_programming
  where tenant_id = p_tenant_id
    and id = p_programming_id;

  v_message := case
    when v_target_status = 'ADIADA' then format('Programacao do projeto %s adiada com sucesso.', v_current.sob)
    else format('Programacao do projeto %s cancelada com sucesso.', v_current.sob)
  end;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'programming_id', p_programming_id,
    'project_code', v_current.sob,
    'updated_at', v_updated_at,
    'programming_status', v_target_status,
    'message', v_message
  );
end;
$$;

revoke all on function public.set_project_programming_status(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz
) from public;

grant execute on function public.set_project_programming_status(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz
) to authenticated;

grant execute on function public.set_project_programming_status(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz
) to service_role;

drop function if exists public.postpone_project_programming(
  uuid,
  uuid,
  uuid,
  date,
  text,
  timestamptz
);

create or replace function public.postpone_project_programming(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_id uuid,
  p_new_execution_date date,
  p_reason text,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_current record;
  v_documents jsonb;
  v_activities jsonb;
  v_save_result jsonb;
  v_new_programming_id uuid;
  v_updated_at timestamptz;
begin
  if p_programming_id is null or v_reason is null or p_new_execution_date is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_POSTPONE_PAYLOAD',
      'message', 'Informe programacao, motivo e nova data para o adiamento.'
    );
  end if;

  select
    pp.*,
    p.sob
  into v_current
  from public.project_programming pp
  join public.project p
    on p.id = pp.project_id
   and p.tenant_id = pp.tenant_id
  where pp.tenant_id = p_tenant_id
    and pp.id = p_programming_id
    and pp.status = 'PROGRAMADA'
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'PROGRAMMING_NOT_FOUND',
      'message', 'Programacao nao encontrada ou nao esta mais ativa na grade.'
    );
  end if;

  if p_new_execution_date = v_current.execution_date then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'SAME_EXECUTION_DATE',
      'message', 'Informe uma nova data diferente da data atual da programacao.'
    );
  end if;

  if p_new_execution_date < current_date then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'PAST_EXECUTION_DATE',
      'message', 'Informe uma nova data igual ou posterior a hoje para concluir o adiamento.'
    );
  end if;

  if p_expected_updated_at is not null
    and date_trunc('milliseconds', v_current.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'PROGRAMMING_CONFLICT',
      'message', 'Esta programacao foi alterada por outro usuario. Atualize a grade antes de continuar.'
    );
  end if;

  v_documents := jsonb_build_object(
    'sgd', jsonb_build_object(
      'number', v_current.sgd_number,
      'approvedAt', v_current.sgd_included_at,
      'requestedAt', v_current.sgd_delivered_at,
      'includedAt', v_current.sgd_included_at,
      'deliveredAt', v_current.sgd_delivered_at
    ),
    'pi', jsonb_build_object(
      'number', v_current.pi_number,
      'approvedAt', v_current.pi_included_at,
      'requestedAt', v_current.pi_delivered_at,
      'includedAt', v_current.pi_included_at,
      'deliveredAt', v_current.pi_delivered_at
    ),
    'pep', jsonb_build_object(
      'number', v_current.pep_number,
      'approvedAt', v_current.pep_included_at,
      'requestedAt', v_current.pep_delivered_at,
      'includedAt', v_current.pep_included_at,
      'deliveredAt', v_current.pep_delivered_at
    )
  );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'catalogId', ppa.service_activity_id,
        'quantity', ppa.quantity
      )
    ),
    '[]'::jsonb
  )
  into v_activities
  from public.project_programming_activities ppa
  where ppa.tenant_id = p_tenant_id
    and ppa.programming_id = p_programming_id
    and ppa.is_active = true;

  v_save_result := public.save_project_programming(
    p_tenant_id,
    p_actor_user_id,
    v_current.project_id,
    v_current.team_id,
    p_new_execution_date,
    v_current.period,
    v_current.start_time,
    v_current.end_time,
    v_current.expected_minutes,
    v_current.feeder,
    v_current.support,
    v_current.note,
    v_documents,
    v_activities,
    null,
    null,
    v_current.support_item_id
  );

  if coalesce((v_save_result ->> 'success')::boolean, false) = false then
    return jsonb_build_object(
      'success', false,
      'status', coalesce((v_save_result ->> 'status')::integer, 400),
      'reason', coalesce(v_save_result ->> 'reason', 'POSTPONE_CREATE_NEW_FAILED'),
      'message', coalesce(v_save_result ->> 'message', 'Falha ao criar a nova programacao para adiamento.')
    );
  end if;

  v_new_programming_id := nullif(v_save_result ->> 'programming_id', '')::uuid;

  if v_new_programming_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 500,
      'reason', 'POSTPONE_NEW_PROGRAMMING_ID_MISSING',
      'message', 'Falha ao recuperar o ID da nova programacao.'
    );
  end if;

  update public.project_programming
  set
    service_description = v_current.service_description,
    poste_qty = coalesce(v_current.poste_qty, 0),
    estrutura_qty = coalesce(v_current.estrutura_qty, 0),
    trafo_qty = coalesce(v_current.trafo_qty, 0),
    rede_qty = coalesce(v_current.rede_qty, 0),
    etapa_number = v_current.etapa_number,
    work_completion_status = null,
    affected_customers = coalesce(v_current.affected_customers, 0),
    sgd_type_id = v_current.sgd_type_id,
    outage_start_time = v_current.outage_start_time,
    outage_end_time = v_current.outage_end_time,
    sgd_included_at = v_current.sgd_included_at,
    sgd_delivered_at = v_current.sgd_delivered_at,
    pi_included_at = v_current.pi_included_at,
    pi_delivered_at = v_current.pi_delivered_at,
    pep_included_at = v_current.pep_included_at,
    pep_delivered_at = v_current.pep_delivered_at,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = v_new_programming_id;

  update public.project_programming
  set
    status = 'ADIADA',
    is_active = false,
    cancellation_reason = v_reason,
    canceled_at = now(),
    canceled_by = p_actor_user_id,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = p_programming_id;

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
  ) values
  (
    p_tenant_id,
    'programacao',
    'project_programming',
    p_programming_id,
    coalesce(v_current.sob, p_programming_id::text),
    'UPDATE',
    v_reason,
    jsonb_build_object(
      'status', jsonb_build_object('from', v_current.status, 'to', 'ADIADA'),
      'isActive', jsonb_build_object('from', 'true', 'to', 'false'),
      'cancellationReason', jsonb_build_object('from', null, 'to', v_reason)
    ),
    jsonb_build_object(
      'action', 'ADIADA',
      'projectId', v_current.project_id,
      'teamId', v_current.team_id,
      'executionDate', v_current.execution_date,
      'newExecutionDate', p_new_execution_date,
      'newProgrammingId', v_new_programming_id
    ),
    p_actor_user_id,
    p_actor_user_id
  ),
  (
    p_tenant_id,
    'programacao',
    'project_programming',
    v_new_programming_id,
    coalesce(v_current.sob, v_new_programming_id::text),
    'UPDATE',
    v_reason,
    jsonb_build_object(
      'project', jsonb_build_object('from', null, 'to', coalesce(v_current.sob, v_current.project_id::text)),
      'executionDate', jsonb_build_object('from', null, 'to', p_new_execution_date)
    ),
    jsonb_build_object(
      'action', 'CREATE',
      'source', 'programacao-postpone',
      'projectId', v_current.project_id,
      'teamId', v_current.team_id,
      'executionDate', p_new_execution_date,
      'sourceProgrammingId', p_programming_id
    ),
    p_actor_user_id,
    p_actor_user_id
  );

  select updated_at
  into v_updated_at
  from public.project_programming
  where tenant_id = p_tenant_id
    and id = p_programming_id;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'programming_id', p_programming_id,
    'new_programming_id', v_new_programming_id,
    'project_code', coalesce(v_current.sob, ''),
    'updated_at', v_updated_at,
    'message', format('Programacao do projeto %s adiada com sucesso. Nova programacao criada para %s.', v_current.sob, to_char(p_new_execution_date, 'DD/MM/YYYY'))
  );
end;
$$;

revoke all on function public.postpone_project_programming(
  uuid,
  uuid,
  uuid,
  date,
  text,
  timestamptz
) from public;

grant execute on function public.postpone_project_programming(
  uuid,
  uuid,
  uuid,
  date,
  text,
  timestamptz
) to authenticated;

grant execute on function public.postpone_project_programming(
  uuid,
  uuid,
  uuid,
  date,
  text,
  timestamptz
) to service_role;
