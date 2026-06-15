-- 237_group_team_stock_imports_for_batch_reversal.sql
-- Identifica requisicoes criadas pelo mesmo cadastro em massa e permite estorno atomico do grupo.

alter table public.stock_transfer_team_operations
  add column if not exists operation_batch_id uuid;

create index if not exists idx_stock_transfer_team_operations_batch
  on public.stock_transfer_team_operations (tenant_id, operation_batch_id)
  where operation_batch_id is not null;

with candidate_groups as (
  select
    sto.tenant_id,
    sto.created_at,
    sto.created_by,
    sto.team_id,
    sto.operation_kind,
    sto.technical_origin_stock_center_id,
    transfer.from_stock_center_id,
    transfer.to_stock_center_id,
    transfer.project_id,
    transfer.entry_date,
    transfer.entry_type,
    transfer.notes,
    md5(concat_ws(
      '|',
      sto.tenant_id::text,
      sto.created_at::text,
      coalesce(sto.created_by::text, ''),
      sto.team_id::text,
      coalesce(sto.operation_kind, ''),
      coalesce(sto.technical_origin_stock_center_id::text, ''),
      coalesce(transfer.from_stock_center_id::text, ''),
      coalesce(transfer.to_stock_center_id::text, ''),
      coalesce(transfer.project_id::text, ''),
      transfer.entry_date::text,
      transfer.entry_type,
      coalesce(transfer.notes, '')
    )) as group_hash
  from public.stock_transfer_team_operations sto
  join public.stock_transfers transfer
    on transfer.id = sto.transfer_id
   and transfer.tenant_id = sto.tenant_id
  where sto.operation_batch_id is null
  group by
    sto.tenant_id,
    sto.created_at,
    sto.created_by,
    sto.team_id,
    sto.operation_kind,
    sto.technical_origin_stock_center_id,
    transfer.from_stock_center_id,
    transfer.to_stock_center_id,
    transfer.project_id,
    transfer.entry_date,
    transfer.entry_type,
    transfer.notes
  having count(*) > 1
),
resolved_groups as (
  select
    candidate_groups.*,
    (
      substr(group_hash, 1, 8) || '-' ||
      substr(group_hash, 9, 4) || '-' ||
      substr(group_hash, 13, 4) || '-' ||
      substr(group_hash, 17, 4) || '-' ||
      substr(group_hash, 21, 12)
    )::uuid as operation_batch_id
  from candidate_groups
)
update public.stock_transfer_team_operations sto
set operation_batch_id = resolved_groups.operation_batch_id
from public.stock_transfers transfer,
     resolved_groups
where transfer.id = sto.transfer_id
  and transfer.tenant_id = sto.tenant_id
  and sto.operation_batch_id is null
  and sto.tenant_id = resolved_groups.tenant_id
  and sto.created_at = resolved_groups.created_at
  and sto.created_by is not distinct from resolved_groups.created_by
  and sto.team_id = resolved_groups.team_id
  and sto.operation_kind is not distinct from resolved_groups.operation_kind
  and sto.technical_origin_stock_center_id is not distinct from resolved_groups.technical_origin_stock_center_id
  and transfer.from_stock_center_id is not distinct from resolved_groups.from_stock_center_id
  and transfer.to_stock_center_id is not distinct from resolved_groups.to_stock_center_id
  and transfer.project_id is not distinct from resolved_groups.project_id
  and transfer.entry_date = resolved_groups.entry_date
  and transfer.entry_type = resolved_groups.entry_type
  and transfer.notes is not distinct from resolved_groups.notes;

create or replace function public.save_team_stock_operation_batch_full(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_entries jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry jsonb;
  v_index integer := 0;
  v_total integer := 0;
  v_row_number integer;
  v_save_result jsonb;
  v_transfer_id uuid;
  v_operation_batch_id uuid;
  v_results jsonb := '[]'::jsonb;
  v_error_message text;
  v_error_detail text;
  v_error_payload jsonb := '{}'::jsonb;
begin
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_BATCH_PAYLOAD',
      'message', 'O lote informado para operacoes de equipe e invalido.'
    );
  end if;

  v_total := jsonb_array_length(p_entries);

  if v_total = 0 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'EMPTY_BATCH',
      'message', 'Nenhum registro valido foi enviado para o cadastro em massa.'
    );
  end if;

  if v_total > 500 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'BATCH_LIMIT_EXCEEDED',
      'message', 'Limite de importacao excedido. Maximo de 500 registros por requisicao.'
    );
  end if;

  begin
    for v_entry in
      select value
      from jsonb_array_elements(p_entries)
    loop
      v_index := v_index + 1;
      v_row_number := coalesce(nullif(v_entry ->> 'rowNumber', '')::integer, v_index);
      v_operation_batch_id := nullif(v_entry ->> 'operationBatchId', '')::uuid;

      v_save_result := public.save_team_stock_operation_record(
        p_tenant_id => p_tenant_id,
        p_actor_user_id => p_actor_user_id,
        p_operation_kind => coalesce(v_entry ->> 'operationKind', ''),
        p_stock_center_id => nullif(v_entry ->> 'stockCenterId', '')::uuid,
        p_team_id => nullif(v_entry ->> 'teamId', '')::uuid,
        p_project_id => nullif(v_entry ->> 'projectId', '')::uuid,
        p_entry_date => nullif(v_entry ->> 'entryDate', '')::date,
        p_entry_type => coalesce(v_entry ->> 'entryType', ''),
        p_notes => nullif(v_entry ->> 'notes', ''),
        p_items => coalesce(v_entry -> 'items', '[]'::jsonb)
      );

      if coalesce((v_save_result ->> 'success')::boolean, false) is not true then
        raise exception using
          message = coalesce(v_save_result ->> 'message', 'Falha ao salvar o cadastro em massa das operacoes de equipe.'),
          detail = jsonb_build_object(
            'rowNumber', v_row_number,
            'status', coalesce((v_save_result ->> 'status')::integer, 500),
            'reason', coalesce(v_save_result ->> 'reason', 'BATCH_SAVE_FAILED'),
            'details', v_save_result -> 'details'
          )::text;
      end if;

      begin
        v_transfer_id := nullif(v_save_result ->> 'transfer_id', '')::uuid;
      exception
        when others then
          v_transfer_id := null;
      end;

      if v_transfer_id is null then
        raise exception using
          message = 'Falha ao obter a transferencia criada no cadastro em massa.',
          detail = jsonb_build_object(
            'rowNumber', v_row_number,
            'status', 500,
            'reason', 'TRANSFER_ID_MISSING'
          )::text;
      end if;

      update public.stock_transfer_team_operations
      set
        operation_batch_id = v_operation_batch_id,
        updated_by = p_actor_user_id,
        updated_at = now()
      where tenant_id = p_tenant_id
        and transfer_id = v_transfer_id;

      v_results := v_results || jsonb_build_array(
        jsonb_build_object(
          'rowNumber', v_row_number,
          'success', true,
          'transferId', v_transfer_id,
          'operationBatchId', v_operation_batch_id,
          'message', coalesce(v_save_result ->> 'message', 'Operacao de equipe salva com sucesso.')
        )
      );
    end loop;

    return jsonb_build_object(
      'success', true,
      'status', 200,
      'message', 'Cadastro em massa concluido com sucesso.',
      'summary', jsonb_build_object(
        'total', v_total,
        'successCount', v_total,
        'errorCount', 0
      ),
      'results', v_results
    );
  exception
    when others then
      get stacked diagnostics
        v_error_message = message_text,
        v_error_detail = pg_exception_detail;

      begin
        if coalesce(v_error_detail, '') <> '' then
          v_error_payload := v_error_detail::jsonb;
        end if;
      exception
        when others then
          v_error_payload := '{}'::jsonb;
      end;

      return jsonb_build_object(
        'success', false,
        'status', coalesce((v_error_payload ->> 'status')::integer, 500),
        'reason', coalesce(v_error_payload ->> 'reason', 'BATCH_SAVE_FAILED'),
        'message', coalesce(nullif(v_error_message, ''), 'Falha ao salvar o cadastro em massa das operacoes de equipe.'),
        'failed_row_number', nullif(v_error_payload ->> 'rowNumber', '')::integer,
        'details', coalesce(v_error_payload -> 'details', to_jsonb(v_error_detail))
      );
  end;
end;
$$;

create or replace function public.reverse_team_stock_operation_batch_v2(
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

  select sto.operation_batch_id
  into v_operation_batch_id
  from public.stock_transfer_team_operations sto
  where sto.transfer_id = p_original_stock_transfer_id
    and sto.tenant_id = p_tenant_id;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'TEAM_OPERATION_NOT_FOUND',
      'message', 'Operacao de equipe original nao encontrada para este tenant.'
    );
  end if;

  select array_agg(sto.transfer_id order by sto.transfer_id)
  into v_transfer_ids
  from public.stock_transfer_team_operations sto
  where sto.tenant_id = p_tenant_id
    and (
      (v_operation_batch_id is not null and sto.operation_batch_id = v_operation_batch_id)
      or (v_operation_batch_id is null and sto.transfer_id = p_original_stock_transfer_id)
    );

  perform 1
  from public.stock_transfers transfer
  join public.stock_transfer_team_operations sto
    on sto.transfer_id = transfer.id
   and sto.tenant_id = transfer.tenant_id
  where transfer.tenant_id = p_tenant_id
    and transfer.id = any(v_transfer_ids)
  order by transfer.id
  for update of transfer, sto;

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
      'message', 'Nao e permitido estornar uma operacao que ja e estorno.'
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
      'message', 'Todos os materiais desta requisicao ja foram estornados.'
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

revoke all on function public.save_team_stock_operation_batch_full(uuid, uuid, jsonb) from public;
revoke all on function public.save_team_stock_operation_batch_full(uuid, uuid, jsonb) from anon;
revoke all on function public.save_team_stock_operation_batch_full(uuid, uuid, jsonb) from authenticated;
grant execute on function public.save_team_stock_operation_batch_full(uuid, uuid, jsonb) to service_role;

revoke all on function public.reverse_team_stock_operation_batch_v2(uuid, uuid, uuid, text, text, date) from public;
revoke all on function public.reverse_team_stock_operation_batch_v2(uuid, uuid, uuid, text, text, date) from anon;
revoke all on function public.reverse_team_stock_operation_batch_v2(uuid, uuid, uuid, text, text, date) from authenticated;
grant execute on function public.reverse_team_stock_operation_batch_v2(uuid, uuid, uuid, text, text, date) to service_role;
