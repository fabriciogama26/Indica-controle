-- 238_add_stock_transfer_batch_reversal.sql
-- Agrupa importacoes de movimentacao de estoque e permite estorno atomico dos itens ativos.

alter table public.stock_transfers
  add column if not exists operation_batch_id uuid;

create index if not exists idx_stock_transfers_operation_batch
  on public.stock_transfers (tenant_id, operation_batch_id)
  where operation_batch_id is not null;

create or replace function public.save_stock_transfer_import_entry_v1(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_operation_batch_id uuid,
  p_movement_type text,
  p_from_stock_center_id uuid,
  p_to_stock_center_id uuid,
  p_project_id uuid,
  p_entry_date date,
  p_entry_type text,
  p_notes text default null,
  p_items jsonb default '[]'::jsonb,
  p_direct_purchase boolean default false,
  p_operation_purpose text default 'NORMAL',
  p_balance_correction_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_transfer_id uuid;
begin
  if p_operation_batch_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'OPERATION_BATCH_ID_REQUIRED',
      'message', 'Identificador do lote da importacao e obrigatorio.'
    );
  end if;

  v_result := public.save_stock_transfer_record(
    p_tenant_id => p_tenant_id,
    p_actor_user_id => p_actor_user_id,
    p_movement_type => p_movement_type,
    p_from_stock_center_id => p_from_stock_center_id,
    p_to_stock_center_id => p_to_stock_center_id,
    p_project_id => p_project_id,
    p_entry_date => p_entry_date,
    p_entry_type => p_entry_type,
    p_notes => p_notes,
    p_items => p_items,
    p_direct_purchase => p_direct_purchase,
    p_operation_purpose => p_operation_purpose,
    p_balance_correction_reason => p_balance_correction_reason
  );

  if coalesce((v_result ->> 'success')::boolean, false) is not true then
    return v_result;
  end if;

  begin
    v_transfer_id := nullif(v_result ->> 'transfer_id', '')::uuid;
  exception
    when others then
      v_transfer_id := null;
  end;

  if v_transfer_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'STOCK_TRANSFER_IMPORT_BATCH_LINK_FAILED',
      detail = jsonb_build_object(
        'reason', 'TRANSFER_ID_MISSING',
        'message', 'Falha ao identificar a movimentacao criada na importacao.'
      )::text;
  end if;

  perform set_config('app.stock_transfer_internal_update', 'true', true);

  update public.stock_transfers
  set
    operation_batch_id = p_operation_batch_id,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = v_transfer_id;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'STOCK_TRANSFER_IMPORT_BATCH_LINK_FAILED',
      detail = jsonb_build_object(
        'reason', 'TRANSFER_NOT_FOUND_AFTER_SAVE',
        'message', 'Falha ao vincular a movimentacao ao lote da importacao.'
      )::text;
  end if;

  return v_result || jsonb_build_object('operation_batch_id', p_operation_batch_id);
end;
$$;

create or replace function public.reverse_stock_transfer_operation_batch_v1(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_original_stock_transfer_id uuid,
  p_reversal_reason_code text,
  p_reversal_reason_notes text default null,
  p_reversal_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_operation_batch_id uuid;
  v_transfer_ids uuid[];
  v_item_ids uuid[];
  v_item_id uuid;
  v_item_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_reversal_transfer_id uuid;
  v_failure_detail text;
begin
  if p_tenant_id is null or p_actor_user_id is null or p_original_stock_transfer_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'BATCH_REVERSAL_REQUIRED_FIELDS',
      'message', 'Tenant, usuario e movimentacao original sao obrigatorios para o estorno em lote.'
    );
  end if;

  if not exists (
    select 1
    from public.app_users actor
    where actor.id = p_actor_user_id
      and actor.ativo = true
      and (
        actor.tenant_id = p_tenant_id
        or exists (
          select 1
          from public.app_user_tenants tenant_access
          where tenant_access.user_id = actor.id
            and tenant_access.tenant_id = p_tenant_id
            and tenant_access.ativo = true
        )
      )
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 403,
      'reason', 'ACTOR_NOT_ALLOWED',
      'message', 'Usuario nao autorizado para estornar movimentacoes deste tenant.'
    );
  end if;

  select transfer.operation_batch_id
  into v_operation_batch_id
  from public.stock_transfers transfer
  where transfer.id = p_original_stock_transfer_id
    and transfer.tenant_id = p_tenant_id;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'ORIGINAL_TRANSFER_NOT_FOUND',
      'message', 'Movimentacao original nao encontrada para este tenant.'
    );
  end if;

  select array_agg(transfer.id order by transfer.id)
  into v_transfer_ids
  from public.stock_transfers transfer
  where transfer.tenant_id = p_tenant_id
    and (
      (v_operation_batch_id is not null and transfer.operation_batch_id = v_operation_batch_id)
      or (v_operation_batch_id is null and transfer.id = p_original_stock_transfer_id)
    );

  if exists (
    select 1
    from public.stock_transfer_team_operations team_operation
    where team_operation.tenant_id = p_tenant_id
      and team_operation.transfer_id = any(v_transfer_ids)
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'TEAM_OPERATION_REVERSAL_REQUIRES_TEAM_FLOW',
      'message', 'O lote contem uma operacao de equipe e deve ser estornado na tela Operacoes de Equipe.'
    );
  end if;

  perform 1
  from public.stock_transfers transfer
  where transfer.tenant_id = p_tenant_id
    and transfer.id = any(v_transfer_ids)
  order by transfer.id
  for update;

  perform 1
  from public.stock_transfer_items item
  where item.tenant_id = p_tenant_id
    and item.stock_transfer_id = any(v_transfer_ids)
  order by item.id
  for update;

  if exists (
    select 1
    from public.stock_transfer_reversals reversal
    where reversal.tenant_id = p_tenant_id
      and reversal.reversal_stock_transfer_id = any(v_transfer_ids)
  ) or exists (
    select 1
    from public.stock_transfer_item_reversals reversal
    where reversal.tenant_id = p_tenant_id
      and reversal.reversal_stock_transfer_id = any(v_transfer_ids)
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'REVERSAL_OF_REVERSAL_NOT_ALLOWED',
      'message', 'Nao e permitido estornar uma movimentacao que ja e estorno.'
    );
  end if;

  select array_agg(item.id order by item.id)
  into v_item_ids
  from public.stock_transfer_items item
  where item.tenant_id = p_tenant_id
    and item.stock_transfer_id = any(v_transfer_ids)
    and not exists (
      select 1
      from public.stock_transfer_reversals full_reversal
      where full_reversal.tenant_id = p_tenant_id
        and full_reversal.original_stock_transfer_id = item.stock_transfer_id
    )
    and not exists (
      select 1
      from public.stock_transfer_item_reversals item_reversal
      where item_reversal.tenant_id = p_tenant_id
        and item_reversal.original_stock_transfer_item_id = item.id
    );

  if coalesce(array_length(v_item_ids, 1), 0) = 0 then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'ALL_ITEMS_ALREADY_REVERSED',
      'message', 'Todos os materiais desta movimentacao ja foram estornados.'
    );
  end if;

  begin
    foreach v_item_id in array v_item_ids
    loop
      v_item_result := public.reverse_stock_transfer_item_record_v1(
        p_tenant_id => p_tenant_id,
        p_actor_user_id => p_actor_user_id,
        p_original_stock_transfer_item_id => v_item_id,
        p_reversal_reason_code => p_reversal_reason_code,
        p_reversal_reason_notes => p_reversal_reason_notes,
        p_reversal_date => p_reversal_date
      );

      if coalesce((v_item_result ->> 'success')::boolean, false) is not true then
        raise exception using
          errcode = 'P0001',
          message = 'STOCK_TRANSFER_BATCH_REVERSAL_FAILED',
          detail = v_item_result::text;
      end if;

      begin
        v_reversal_transfer_id := nullif(v_item_result ->> 'transfer_id', '')::uuid;
      exception
        when others then
          v_reversal_transfer_id := null;
      end;

      if v_reversal_transfer_id is null then
        raise exception using
          errcode = 'P0001',
          message = 'STOCK_TRANSFER_BATCH_REVERSAL_FAILED',
          detail = jsonb_build_object(
            'success', false,
            'status', 500,
            'reason', 'REVERSAL_TRANSFER_ID_MISSING',
            'message', 'Falha ao obter uma das movimentacoes do estorno em lote.'
          )::text;
      end if;

      v_results := v_results || jsonb_build_array(
        jsonb_build_object(
          'item_id', v_item_id,
          'reversal_transfer_id', v_reversal_transfer_id,
          'reversal_item_id', v_item_result ->> 'reversal_item_id'
        )
      );
    end loop;
  exception
    when sqlstate 'P0001' then
      get stacked diagnostics v_failure_detail = pg_exception_detail;

      if sqlerrm <> 'STOCK_TRANSFER_BATCH_REVERSAL_FAILED' then
        raise;
      end if;

      begin
        return v_failure_detail::jsonb;
      exception
        when others then
          return jsonb_build_object(
            'success', false,
            'status', 500,
            'reason', 'BATCH_REVERSAL_FAILED',
            'message', 'Falha ao estornar o lote. Nenhum material foi alterado.'
          );
      end;
  end;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'operation_batch_id', v_operation_batch_id,
    'original_transfer_ids', to_jsonb(v_transfer_ids),
    'reversed_item_count', jsonb_array_length(v_results),
    'results', v_results,
    'message', format(
      'Estorno em lote concluido para %s material(is).',
      jsonb_array_length(v_results)
    )
  );
end;
$$;

revoke all on function public.save_stock_transfer_import_entry_v1(uuid, uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb, boolean, text, text) from public;
revoke all on function public.save_stock_transfer_import_entry_v1(uuid, uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb, boolean, text, text) from anon;
revoke all on function public.save_stock_transfer_import_entry_v1(uuid, uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb, boolean, text, text) from authenticated;
grant execute on function public.save_stock_transfer_import_entry_v1(uuid, uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb, boolean, text, text) to service_role;

revoke all on function public.reverse_stock_transfer_operation_batch_v1(uuid, uuid, uuid, text, text, date) from public;
revoke all on function public.reverse_stock_transfer_operation_batch_v1(uuid, uuid, uuid, text, text, date) from anon;
revoke all on function public.reverse_stock_transfer_operation_batch_v1(uuid, uuid, uuid, text, text, date) from authenticated;
grant execute on function public.reverse_stock_transfer_operation_batch_v1(uuid, uuid, uuid, text, text, date) to service_role;
