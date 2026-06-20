-- 236_add_team_stock_operation_batch_reversal.sql
-- Estorna atomicamente todos os itens ainda ativos de uma Operacao de Equipe.

create or replace function public.reverse_team_stock_operation_batch_v1(
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
  v_item_id uuid;
  v_item_ids uuid[];
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
      'message', 'Tenant, usuario e transferencia original sao obrigatorios para o estorno em lote.'
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
      'message', 'Usuario nao autorizado para estornar operacoes deste tenant.'
    );
  end if;

  perform 1
  from public.stock_transfers transfer
  join public.stock_transfer_team_operations sto
    on sto.transfer_id = transfer.id
   and sto.tenant_id = transfer.tenant_id
  where transfer.id = p_original_stock_transfer_id
    and transfer.tenant_id = p_tenant_id
  for update of transfer, sto;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'TEAM_OPERATION_NOT_FOUND',
      'message', 'Operacao de equipe original nao encontrada para este tenant.'
    );
  end if;

  if exists (
    select 1
    from public.stock_transfer_reversals reversal
    where reversal.tenant_id = p_tenant_id
      and reversal.original_stock_transfer_id = p_original_stock_transfer_id
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'FULL_TRANSFER_ALREADY_REVERSED',
      'message', 'Esta operacao de equipe ja foi estornada integralmente.'
    );
  end if;

  if exists (
    select 1
    from public.stock_transfer_reversals reversal
    where reversal.tenant_id = p_tenant_id
      and reversal.reversal_stock_transfer_id = p_original_stock_transfer_id
  ) or exists (
    select 1
    from public.stock_transfer_item_reversals reversal
    where reversal.tenant_id = p_tenant_id
      and reversal.reversal_stock_transfer_id = p_original_stock_transfer_id
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'REVERSAL_OF_REVERSAL_NOT_ALLOWED',
      'message', 'Nao e permitido estornar uma operacao que ja e estorno.'
    );
  end if;

  perform 1
  from public.stock_transfer_items item
  where item.tenant_id = p_tenant_id
    and item.stock_transfer_id = p_original_stock_transfer_id
  order by item.id
  for update;

  select array_agg(item.id order by item.id)
  into v_item_ids
  from public.stock_transfer_items item
  where item.tenant_id = p_tenant_id
    and item.stock_transfer_id = p_original_stock_transfer_id
    and not exists (
      select 1
      from public.stock_transfer_item_reversals reversal
      where reversal.tenant_id = p_tenant_id
        and reversal.original_stock_transfer_item_id = item.id
    );

  if coalesce(array_length(v_item_ids, 1), 0) = 0 then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'ALL_ITEMS_ALREADY_REVERSED',
      'message', 'Todos os materiais desta operacao ja foram estornados.'
    );
  end if;

  begin
    foreach v_item_id in array v_item_ids
    loop
      v_item_result := public.reverse_team_stock_operation_item_record_v1(
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
          message = 'TEAM_STOCK_BATCH_REVERSAL_FAILED',
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
          message = 'TEAM_STOCK_BATCH_REVERSAL_FAILED',
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

      if sqlerrm <> 'TEAM_STOCK_BATCH_REVERSAL_FAILED' then
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
    'original_transfer_id', p_original_stock_transfer_id,
    'reversed_item_count', jsonb_array_length(v_results),
    'results', v_results,
    'message', format(
      'Estorno em lote concluido para %s material(is).',
      jsonb_array_length(v_results)
    )
  );
end;
$$;

revoke all on function public.reverse_team_stock_operation_batch_v1(uuid, uuid, uuid, text, text, date) from public;
revoke all on function public.reverse_team_stock_operation_batch_v1(uuid, uuid, uuid, text, text, date) from anon;
revoke all on function public.reverse_team_stock_operation_batch_v1(uuid, uuid, uuid, text, text, date) from authenticated;
grant execute on function public.reverse_team_stock_operation_batch_v1(uuid, uuid, uuid, text, text, date) to service_role;
