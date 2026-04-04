-- 143_create_team_stock_operation_batch_full.sql
-- Cria RPC atomica para cadastro em massa das operacoes de equipe.

create or replace function public.save_team_stock_operation_batch_full(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_entries jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry jsonb;
  v_index integer := 0;
  v_total integer := 0;
  v_row_number integer;
  v_save_result jsonb;
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

      v_results := v_results || jsonb_build_array(
        jsonb_build_object(
          'rowNumber', v_row_number,
          'success', true,
          'transferId', coalesce(v_save_result ->> 'transfer_id', ''),
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

revoke all on function public.save_team_stock_operation_batch_full(uuid, uuid, jsonb) from public;
grant execute on function public.save_team_stock_operation_batch_full(uuid, uuid, jsonb) to authenticated;
grant execute on function public.save_team_stock_operation_batch_full(uuid, uuid, jsonb) to service_role;
