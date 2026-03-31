-- 125_require_closed_before_measurement_cancel.sql
-- Regra de status da Medicao: cancelar somente quando a ordem estiver FECHADA.

create or replace function public.set_project_measurement_order_status(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_measurement_order_id uuid,
  p_action text,
  p_reason text default null,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.project_measurement_orders%rowtype;
  v_action text := upper(coalesce(p_action, ''));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_updated_at timestamptz;
begin
  if p_measurement_order_id is null or v_action not in ('FECHAR', 'CANCELAR', 'ABRIR') then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_STATUS_PAYLOAD', 'message', 'Acao de status invalida.');
  end if;

  if v_action in ('CANCELAR', 'ABRIR') and (v_reason is null or char_length(v_reason) < 10) then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', case when v_action = 'ABRIR' then 'REOPEN_REASON_REQUIRED' else 'CANCELLATION_REASON_REQUIRED' end,
      'message', case when v_action = 'ABRIR' then 'Motivo da reabertura e obrigatorio (minimo 10 caracteres).' else 'Motivo do cancelamento e obrigatorio (minimo 10 caracteres).' end
    );
  end if;

  select * into v_order
  from public.project_measurement_orders
  where tenant_id = p_tenant_id and id = p_measurement_order_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'MEASUREMENT_ORDER_NOT_FOUND', 'message', 'Ordem nao encontrada.');
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'EXPECTED_UPDATED_AT_REQUIRED', 'message', 'Atualize a lista antes de alterar status.');
  end if;

  if date_trunc('milliseconds', v_order.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONCURRENT_MODIFICATION', 'message', 'Ordem alterada por outro usuario.');
  end if;

  if v_action = 'FECHAR' then
    if v_order.status <> 'ABERTA' then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'STATUS_ALREADY_CHANGED', 'message', 'Somente ordem ABERTA pode ser fechada.');
    end if;

    update public.project_measurement_orders
    set
      status = 'FECHADA',
      is_active = true,
      updated_by = p_actor_user_id
    where tenant_id = p_tenant_id and id = p_measurement_order_id
    returning updated_at into v_updated_at;

    perform public.append_project_measurement_order_history_record(
      p_tenant_id,
      p_actor_user_id,
      p_measurement_order_id,
      'CLOSE',
      null,
      jsonb_build_object('status', jsonb_build_object('from', v_order.status, 'to', 'FECHADA')),
      jsonb_build_object('source', 'measurement-api')
    );

    return jsonb_build_object(
      'success', true,
      'status', 200,
      'measurement_order_id', p_measurement_order_id,
      'updated_at', v_updated_at,
      'measurement_status', 'FECHADA',
      'message', 'Ordem fechada com sucesso.'
    );
  end if;

  if v_action = 'ABRIR' then
    if v_order.status <> 'FECHADA' then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'STATUS_ALREADY_CHANGED', 'message', 'Somente ordem FECHADA pode ser reaberta.');
    end if;

    update public.project_measurement_orders
    set
      status = 'ABERTA',
      is_active = true,
      cancellation_reason = null,
      canceled_at = null,
      canceled_by = null,
      updated_by = p_actor_user_id
    where tenant_id = p_tenant_id and id = p_measurement_order_id
    returning updated_at into v_updated_at;

    perform public.append_project_measurement_order_history_record(
      p_tenant_id,
      p_actor_user_id,
      p_measurement_order_id,
      'OPEN',
      v_reason,
      jsonb_build_object('status', jsonb_build_object('from', v_order.status, 'to', 'ABERTA')),
      jsonb_build_object('source', 'measurement-api')
    );

    return jsonb_build_object(
      'success', true,
      'status', 200,
      'measurement_order_id', p_measurement_order_id,
      'updated_at', v_updated_at,
      'measurement_status', 'ABERTA',
      'message', 'Ordem reaberta com sucesso.'
    );
  end if;

  if v_order.status = 'CANCELADA' then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'STATUS_ALREADY_CHANGED', 'message', 'Ordem ja esta cancelada.');
  end if;

  if v_order.status <> 'FECHADA' then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'STATUS_ALREADY_CHANGED', 'message', 'Somente ordem FECHADA pode ser cancelada.');
  end if;

  update public.project_measurement_orders
  set
    status = 'CANCELADA',
    is_active = false,
    cancellation_reason = v_reason,
    canceled_at = now(),
    canceled_by = p_actor_user_id,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id and id = p_measurement_order_id
  returning updated_at into v_updated_at;

  perform public.append_project_measurement_order_history_record(
    p_tenant_id,
    p_actor_user_id,
    p_measurement_order_id,
    'CANCEL',
    v_reason,
    jsonb_build_object('status', jsonb_build_object('from', v_order.status, 'to', 'CANCELADA')),
    jsonb_build_object('source', 'measurement-api')
  );

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'measurement_order_id', p_measurement_order_id,
    'updated_at', v_updated_at,
    'measurement_status', 'CANCELADA',
    'message', 'Ordem cancelada com sucesso.'
  );
end;
$$;

revoke all on function public.set_project_measurement_order_status(uuid, uuid, uuid, text, text, timestamptz) from public;
grant execute on function public.set_project_measurement_order_status(uuid, uuid, uuid, text, text, timestamptz) to authenticated;
grant execute on function public.set_project_measurement_order_status(uuid, uuid, uuid, text, text, timestamptz) to service_role;
