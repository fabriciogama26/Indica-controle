-- 412_allow_measurement_uncancel_status_action.sql
-- Permite descancelar ordem de Medicao usando a acao ABRIR, com motivo e
-- controle de concorrencia iguais aos da reabertura de ordem FECHADA.

begin;

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
set search_path = public, pg_temp
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
      'message', case when v_action = 'ABRIR' then 'Motivo da abertura ou descancelamento e obrigatorio (minimo 10 caracteres).' else 'Motivo do cancelamento e obrigatorio (minimo 10 caracteres).' end
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
    if v_order.status not in ('FECHADA', 'CANCELADA') then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'STATUS_ALREADY_CHANGED', 'message', 'Somente ordem FECHADA ou CANCELADA pode ser aberta.');
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
      case when v_order.status = 'CANCELADA' then 'UNCANCEL' else 'OPEN' end,
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
      'message', case when v_order.status = 'CANCELADA' then 'Ordem descancelada com sucesso.' else 'Ordem reaberta com sucesso.' end
    );
  end if;

  if v_order.status = 'CANCELADA' then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'STATUS_ALREADY_CHANGED', 'message', 'Ordem ja esta cancelada.');
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

revoke all on function public.set_project_measurement_order_status(uuid, uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.set_project_measurement_order_status(uuid, uuid, uuid, text, text, timestamptz) to service_role;

do $$
declare
  v_status_fn regprocedure := 'public.set_project_measurement_order_status(uuid, uuid, uuid, text, text, timestamptz)'::regprocedure;
begin
  if has_function_privilege('anon', v_status_fn, 'execute')
     or has_function_privilege('authenticated', v_status_fn, 'execute') then
    raise exception '412: set_project_measurement_order_status ainda executavel por anon/authenticated';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n
      on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'set_project_measurement_order_status'
      and pg_get_function_identity_arguments(p.oid) = 'p_tenant_id uuid, p_actor_user_id uuid, p_measurement_order_id uuid, p_action text, p_reason text, p_expected_updated_at timestamp with time zone'
      and p.prosrc like '%v_order.status not in (''FECHADA'', ''CANCELADA'')%'
      and exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) as cfg
        where cfg = 'search_path=public, pg_temp'
      )
  ) then
    raise exception '412: funcao de status da Medicao nao contem a regra de descancelamento esperada';
  end if;
end;
$$;

commit;
