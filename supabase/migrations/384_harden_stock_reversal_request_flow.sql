-- 384_harden_stock_reversal_request_flow.sql
-- Fecha brechas de negocio do fluxo de atendimento de estornos criado na 383:
-- - RPCs antigas de execucao direta ficam restritas ao service_role.
-- - Solicitante nao pode assumir/aprovar/recusar o proprio pedido.
-- - Aprovar/recusar exige pedido previamente assumido pelo atendente.
-- - BATCH exige lista explicita de itens; FULL e o unico modo que pega todos.

do $$
begin
  if to_regprocedure('public.create_stock_reversal_request(uuid, uuid, text, text, text, uuid, uuid, text, text, date, jsonb, text)') is not null
     and to_regprocedure('public.create_stock_reversal_request_v383(uuid, uuid, text, text, text, uuid, uuid, text, text, date, jsonb, text)') is null then
    alter function public.create_stock_reversal_request(uuid, uuid, text, text, text, uuid, uuid, text, text, date, jsonb, text)
      rename to create_stock_reversal_request_v383;
  end if;

  if to_regprocedure('public.claim_stock_reversal_request(uuid, uuid, text, uuid, integer)') is not null
     and to_regprocedure('public.claim_stock_reversal_request_v383(uuid, uuid, text, uuid, integer)') is null then
    alter function public.claim_stock_reversal_request(uuid, uuid, text, uuid, integer)
      rename to claim_stock_reversal_request_v383;
  end if;

  if to_regprocedure('public.reject_stock_reversal_request(uuid, uuid, uuid, text)') is not null
     and to_regprocedure('public.reject_stock_reversal_request_v383(uuid, uuid, uuid, text)') is null then
    alter function public.reject_stock_reversal_request(uuid, uuid, uuid, text)
      rename to reject_stock_reversal_request_v383;
  end if;

  if to_regprocedure('public.approve_stock_reversal_request(uuid, uuid, uuid, text)') is not null
     and to_regprocedure('public.approve_stock_reversal_request_v383(uuid, uuid, uuid, text)') is null then
    alter function public.approve_stock_reversal_request(uuid, uuid, uuid, text)
      rename to approve_stock_reversal_request_v383;
  end if;
end;
$$;

create or replace function public.create_stock_reversal_request(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_actor_name text,
  p_source text,
  p_mode text,
  p_original_stock_transfer_id uuid,
  p_original_stock_transfer_item_id uuid,
  p_reversal_reason_code text,
  p_reversal_reason_notes text default null,
  p_reversal_date date default current_date,
  p_item_ids jsonb default '[]'::jsonb,
  p_request_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text := upper(btrim(coalesce(p_mode, '')));
begin
  if v_mode = 'BATCH' then
    if jsonb_typeof(coalesce(p_item_ids, '[]'::jsonb)) <> 'array' then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'BATCH_ITEMS_REQUIRED',
        'message', 'Selecione ao menos um item para solicitar estorno em lote.'
      );
    end if;

    if jsonb_array_length(coalesce(p_item_ids, '[]'::jsonb)) = 0 then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'BATCH_ITEMS_REQUIRED',
        'message', 'Selecione ao menos um item para solicitar estorno em lote.'
      );
    end if;
  end if;

  return public.create_stock_reversal_request_v383(
    p_tenant_id => p_tenant_id,
    p_actor_user_id => p_actor_user_id,
    p_actor_name => p_actor_name,
    p_source => p_source,
    p_mode => p_mode,
    p_original_stock_transfer_id => p_original_stock_transfer_id,
    p_original_stock_transfer_item_id => p_original_stock_transfer_item_id,
    p_reversal_reason_code => p_reversal_reason_code,
    p_reversal_reason_notes => p_reversal_reason_notes,
    p_reversal_date => p_reversal_date,
    p_item_ids => p_item_ids,
    p_request_notes => p_request_notes
  );
end;
$$;

create or replace function public.claim_stock_reversal_request(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_actor_name text,
  p_request_id uuid,
  p_claim_minutes integer default 15
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested_by uuid;
begin
  select requested_by
  into v_requested_by
  from public.stock_reversal_requests
  where tenant_id = p_tenant_id
    and id = p_request_id;

  if found and v_requested_by = p_actor_user_id then
    return jsonb_build_object(
      'success', false,
      'status', 403,
      'reason', 'REQUEST_SELF_FULFILLMENT_NOT_ALLOWED',
      'message', 'Quem solicitou o estorno nao pode atender o proprio pedido.'
    );
  end if;

  return public.claim_stock_reversal_request_v383(
    p_tenant_id => p_tenant_id,
    p_actor_user_id => p_actor_user_id,
    p_actor_name => p_actor_name,
    p_request_id => p_request_id,
    p_claim_minutes => p_claim_minutes
  );
end;
$$;

create or replace function public.reject_stock_reversal_request(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_decision_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.stock_reversal_requests%rowtype;
begin
  select *
  into v_request
  from public.stock_reversal_requests
  where tenant_id = p_tenant_id
    and id = p_request_id
  for update;

  if found then
    if v_request.requested_by = p_actor_user_id then
      return jsonb_build_object(
        'success', false,
        'status', 403,
        'reason', 'REQUEST_SELF_FULFILLMENT_NOT_ALLOWED',
        'message', 'Quem solicitou o estorno nao pode atender o proprio pedido.'
      );
    end if;

    if v_request.status in ('PENDENTE', 'EM_ANALISE')
       and (
         v_request.claimed_by is null
         or v_request.claimed_by <> p_actor_user_id
         or v_request.claim_expires_at is null
         or v_request.claim_expires_at <= now()
       ) then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'REQUEST_CLAIM_REQUIRED',
        'message', 'Assuma o pedido antes de aprovar ou recusar.'
      );
    end if;
  end if;

  return public.reject_stock_reversal_request_v383(
    p_tenant_id => p_tenant_id,
    p_actor_user_id => p_actor_user_id,
    p_request_id => p_request_id,
    p_decision_notes => p_decision_notes
  );
end;
$$;

create or replace function public.approve_stock_reversal_request(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_decision_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.stock_reversal_requests%rowtype;
begin
  select *
  into v_request
  from public.stock_reversal_requests
  where tenant_id = p_tenant_id
    and id = p_request_id
  for update;

  if found then
    if v_request.requested_by = p_actor_user_id then
      return jsonb_build_object(
        'success', false,
        'status', 403,
        'reason', 'REQUEST_SELF_FULFILLMENT_NOT_ALLOWED',
        'message', 'Quem solicitou o estorno nao pode atender o proprio pedido.'
      );
    end if;

    if v_request.status in ('PENDENTE', 'EM_ANALISE')
       and (
         v_request.claimed_by is null
         or v_request.claimed_by <> p_actor_user_id
         or v_request.claim_expires_at is null
         or v_request.claim_expires_at <= now()
       ) then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'REQUEST_CLAIM_REQUIRED',
        'message', 'Assuma o pedido antes de aprovar ou recusar.'
      );
    end if;
  end if;

  return public.approve_stock_reversal_request_v383(
    p_tenant_id => p_tenant_id,
    p_actor_user_id => p_actor_user_id,
    p_request_id => p_request_id,
    p_decision_notes => p_decision_notes
  );
end;
$$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.reverse_stock_transfer_record(uuid, uuid, uuid, text, date)',
    'public.reverse_stock_transfer_record_v2(uuid, uuid, uuid, text, text, date)',
    'public.reverse_stock_transfer_item_record_v1(uuid, uuid, uuid, text, text, date)',
    'public.reverse_team_stock_operation_record(uuid, uuid, uuid, text, date)',
    'public.reverse_team_stock_operation_record_v2(uuid, uuid, uuid, text, text, date)',
    'public.reverse_team_stock_operation_item_record_v1(uuid, uuid, uuid, text, text, date)',
    'public.reverse_team_stock_operation_batch_v1(uuid, uuid, uuid, text, text, date)',
    'public.reverse_team_stock_operation_batch_v2(uuid, uuid, uuid, text, text, date)',
    'public.reverse_stock_transfer_operation_batch_v1(uuid, uuid, uuid, text, text, date)'
  ]
  loop
    if to_regprocedure(v_signature) is not null then
      execute format('revoke all on function %s from public', v_signature);
      execute format('revoke all on function %s from anon', v_signature);
      execute format('revoke all on function %s from authenticated', v_signature);
      execute format('grant execute on function %s to service_role', v_signature);
    end if;
  end loop;
end;
$$;

revoke all on function public.create_stock_reversal_request_v383(uuid, uuid, text, text, text, uuid, uuid, text, text, date, jsonb, text) from public;
revoke all on function public.create_stock_reversal_request_v383(uuid, uuid, text, text, text, uuid, uuid, text, text, date, jsonb, text) from anon;
revoke all on function public.create_stock_reversal_request_v383(uuid, uuid, text, text, text, uuid, uuid, text, text, date, jsonb, text) from authenticated;
grant execute on function public.create_stock_reversal_request_v383(uuid, uuid, text, text, text, uuid, uuid, text, text, date, jsonb, text) to service_role;

revoke all on function public.claim_stock_reversal_request_v383(uuid, uuid, text, uuid, integer) from public;
revoke all on function public.claim_stock_reversal_request_v383(uuid, uuid, text, uuid, integer) from anon;
revoke all on function public.claim_stock_reversal_request_v383(uuid, uuid, text, uuid, integer) from authenticated;
grant execute on function public.claim_stock_reversal_request_v383(uuid, uuid, text, uuid, integer) to service_role;

revoke all on function public.reject_stock_reversal_request_v383(uuid, uuid, uuid, text) from public;
revoke all on function public.reject_stock_reversal_request_v383(uuid, uuid, uuid, text) from anon;
revoke all on function public.reject_stock_reversal_request_v383(uuid, uuid, uuid, text) from authenticated;
grant execute on function public.reject_stock_reversal_request_v383(uuid, uuid, uuid, text) to service_role;

revoke all on function public.approve_stock_reversal_request_v383(uuid, uuid, uuid, text) from public;
revoke all on function public.approve_stock_reversal_request_v383(uuid, uuid, uuid, text) from anon;
revoke all on function public.approve_stock_reversal_request_v383(uuid, uuid, uuid, text) from authenticated;
grant execute on function public.approve_stock_reversal_request_v383(uuid, uuid, uuid, text) to service_role;

revoke all on function public.create_stock_reversal_request(uuid, uuid, text, text, text, uuid, uuid, text, text, date, jsonb, text) from public;
revoke all on function public.create_stock_reversal_request(uuid, uuid, text, text, text, uuid, uuid, text, text, date, jsonb, text) from anon;
revoke all on function public.create_stock_reversal_request(uuid, uuid, text, text, text, uuid, uuid, text, text, date, jsonb, text) from authenticated;
grant execute on function public.create_stock_reversal_request(uuid, uuid, text, text, text, uuid, uuid, text, text, date, jsonb, text) to service_role;

revoke all on function public.claim_stock_reversal_request(uuid, uuid, text, uuid, integer) from public;
revoke all on function public.claim_stock_reversal_request(uuid, uuid, text, uuid, integer) from anon;
revoke all on function public.claim_stock_reversal_request(uuid, uuid, text, uuid, integer) from authenticated;
grant execute on function public.claim_stock_reversal_request(uuid, uuid, text, uuid, integer) to service_role;

revoke all on function public.reject_stock_reversal_request(uuid, uuid, uuid, text) from public;
revoke all on function public.reject_stock_reversal_request(uuid, uuid, uuid, text) from anon;
revoke all on function public.reject_stock_reversal_request(uuid, uuid, uuid, text) from authenticated;
grant execute on function public.reject_stock_reversal_request(uuid, uuid, uuid, text) to service_role;

revoke all on function public.approve_stock_reversal_request(uuid, uuid, uuid, text) from public;
revoke all on function public.approve_stock_reversal_request(uuid, uuid, uuid, text) from anon;
revoke all on function public.approve_stock_reversal_request(uuid, uuid, uuid, text) from authenticated;
grant execute on function public.approve_stock_reversal_request(uuid, uuid, uuid, text) to service_role;
