-- 119_create_measurement_batch_import_partial_rpc.sql
-- Importacao em lote parcial da Medicao via RPC:
-- salva linhas validas, ignora duplicadas e retorna erros por linha.

create or replace function public.save_project_measurement_order_batch_partial(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_rows jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_row_json jsonb;
  v_row_index integer;
  v_row_numbers jsonb;
  v_row_count integer;
  v_programming_id uuid;
  v_project_id uuid;
  v_team_id uuid;
  v_execution_date date;
  v_measurement_date date;
  v_manual_rate numeric;
  v_voice_point numeric;
  v_notes text;
  v_items jsonb;
  v_context_key text;
  v_save_result jsonb;
  v_save_success boolean;
  v_save_reason text;
  v_save_message text;
  v_saved_count integer := 0;
  v_error_count integer := 0;
  v_already_registered_count integer := 0;
  v_already_registered_rows integer := 0;
  v_results jsonb := '[]'::jsonb;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_BATCH_CONTEXT',
      'message', 'Contexto invalido para importacao em lote.'
    );
  end if;

  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) = 0 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_BATCH_ROWS',
      'message', 'Nenhuma linha valida enviada para importacao.'
    );
  end if;

  for v_row in
    select row_item.item, row_item.ordinality
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality as row_item(item, ordinality)
  loop
    v_row_json := coalesce(v_row.item, '{}'::jsonb);
    v_row_index := v_row.ordinality;
    v_row_numbers := case
      when jsonb_typeof(v_row_json -> 'rowNumbers') = 'array' then coalesce(v_row_json -> 'rowNumbers', '[]'::jsonb)
      else '[]'::jsonb
    end;
    v_row_count := case
      when jsonb_typeof(v_row_numbers) = 'array' then jsonb_array_length(v_row_numbers)
      else 0
    end;

    if v_row_count = 0 then
      v_row_numbers := jsonb_build_array(v_row_index);
      v_row_count := 1;
    end if;

    v_programming_id := case
      when coalesce(nullif(btrim(v_row_json ->> 'programmingId'), ''), '') ~* '^[0-9a-f-]{36}$' then (v_row_json ->> 'programmingId')::uuid
      else null
    end;
    v_project_id := case
      when coalesce(nullif(btrim(v_row_json ->> 'projectId'), ''), '') ~* '^[0-9a-f-]{36}$' then (v_row_json ->> 'projectId')::uuid
      else null
    end;
    v_team_id := case
      when coalesce(nullif(btrim(v_row_json ->> 'teamId'), ''), '') ~* '^[0-9a-f-]{36}$' then (v_row_json ->> 'teamId')::uuid
      else null
    end;
    v_execution_date := case
      when coalesce(nullif(btrim(v_row_json ->> 'executionDate'), ''), '') ~ '^\d{4}-\d{2}-\d{2}$' then (v_row_json ->> 'executionDate')::date
      else null
    end;
    v_measurement_date := case
      when coalesce(nullif(btrim(v_row_json ->> 'measurementDate'), ''), '') ~ '^\d{4}-\d{2}-\d{2}$' then (v_row_json ->> 'measurementDate')::date
      else null
    end;
    v_manual_rate := case
      when nullif(btrim(coalesce(v_row_json ->> 'manualRate', '')), '') is not null then replace(v_row_json ->> 'manualRate', ',', '.')::numeric
      else null
    end;
    v_voice_point := case
      when nullif(btrim(coalesce(v_row_json ->> 'voicePoint', '')), '') is not null then replace(v_row_json ->> 'voicePoint', ',', '.')::numeric
      else 1
    end;
    v_notes := nullif(btrim(coalesce(v_row_json ->> 'notes', '')), '');
    v_items := case
      when jsonb_typeof(v_row_json -> 'items') = 'array' then coalesce(v_row_json -> 'items', '[]'::jsonb)
      else '[]'::jsonb
    end;

    if v_programming_id is not null then
      select pp.project_id, pp.team_id, pp.execution_date
      into v_project_id, v_team_id, v_execution_date
      from public.project_programming pp
      where pp.tenant_id = p_tenant_id
        and pp.id = v_programming_id;

      if not found then
        v_error_count := v_error_count + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'rowIndex', v_row_index,
          'rowNumbers', v_row_numbers,
          'success', false,
          'alreadyRegistered', false,
          'reason', 'PROGRAMMING_NOT_FOUND',
          'message', 'Programacao nao encontrada para a linha importada.'
        ));
        continue;
      end if;
    end if;

    if v_project_id is null or v_team_id is null or v_execution_date is null then
      v_error_count := v_error_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'rowIndex', v_row_index,
        'rowNumbers', v_row_numbers,
        'success', false,
        'alreadyRegistered', false,
        'reason', 'MISSING_MEASUREMENT_CONTEXT',
        'message', 'Projeto, equipe e data de execucao sao obrigatorios para importar a linha.'
      ));
      continue;
    end if;

    if v_measurement_date is null then
      v_measurement_date := v_execution_date;
    end if;

    if coalesce(v_manual_rate, 0) <= 0 then
      v_error_count := v_error_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'rowIndex', v_row_index,
        'rowNumbers', v_row_numbers,
        'success', false,
        'alreadyRegistered', false,
        'reason', 'INVALID_MANUAL_RATE',
        'message', 'Taxa manual invalida na linha importada.'
      ));
      continue;
    end if;

    if coalesce(v_voice_point, 0) <= 0 then
      v_voice_point := 1;
    end if;

    v_context_key := format('%s|%s|%s|%s', p_tenant_id::text, v_project_id::text, v_team_id::text, v_execution_date::text);
    perform pg_advisory_xact_lock(hashtext(v_context_key)::bigint);

    if exists (
      select 1
      from public.project_measurement_orders mo
      where mo.tenant_id = p_tenant_id
        and mo.project_id = v_project_id
        and mo.team_id = v_team_id
        and mo.execution_date = v_execution_date
    ) then
      v_already_registered_count := v_already_registered_count + 1;
      v_already_registered_rows := v_already_registered_rows + v_row_count;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'rowIndex', v_row_index,
        'rowNumbers', v_row_numbers,
        'success', false,
        'alreadyRegistered', true,
        'reason', 'MEASUREMENT_ORDER_CONTEXT_ALREADY_EXISTS',
        'message', 'Linha ignorada: medicao ja cadastrada para Projeto + Equipe + Data.'
      ));
      continue;
    end if;

    begin
      v_save_result := public.save_project_measurement_order(
        p_tenant_id,
        p_actor_user_id,
        null,
        v_programming_id,
        v_project_id,
        v_team_id,
        v_execution_date,
        v_measurement_date,
        v_voice_point,
        v_manual_rate,
        v_notes,
        v_items,
        null
      );
    exception
      when others then
        v_save_result := jsonb_build_object(
          'success', false,
          'status', 500,
          'reason', 'SAVE_MEASUREMENT_ORDER_FAILED',
          'message', format('Falha ao salvar ordem no lote: %s', sqlerrm)
        );
    end;

    v_save_success := lower(coalesce(v_save_result ->> 'success', 'false')) = 'true';
    v_save_reason := upper(coalesce(v_save_result ->> 'reason', ''));
    v_save_message := coalesce(v_save_result ->> 'message', 'Falha ao salvar ordem de medicao no lote.');

    if v_save_success then
      v_saved_count := v_saved_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'rowIndex', v_row_index,
        'rowNumbers', v_row_numbers,
        'success', true,
        'alreadyRegistered', false,
        'reason', null,
        'message', v_save_message,
        'measurementOrderId', v_save_result ->> 'measurement_order_id'
      ));
      continue;
    end if;

    if v_save_reason = 'MEASUREMENT_ORDER_ALREADY_EXISTS' then
      v_already_registered_count := v_already_registered_count + 1;
      v_already_registered_rows := v_already_registered_rows + v_row_count;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'rowIndex', v_row_index,
        'rowNumbers', v_row_numbers,
        'success', false,
        'alreadyRegistered', true,
        'reason', v_save_reason,
        'message', coalesce(v_save_message, 'Linha ignorada: ordem ja existente.')
      ));
      continue;
    end if;

    v_error_count := v_error_count + 1;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'rowIndex', v_row_index,
      'rowNumbers', v_row_numbers,
      'success', false,
      'alreadyRegistered', false,
      'reason', coalesce(v_save_reason, 'SAVE_MEASUREMENT_ORDER_FAILED'),
      'message', v_save_message
    ));
  end loop;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'savedCount', v_saved_count,
    'errorCount', v_error_count,
    'alreadyRegisteredCount', v_already_registered_count,
    'alreadyRegisteredRows', v_already_registered_rows,
    'results', v_results
  );
exception
  when others then
    return jsonb_build_object(
      'success', false,
      'status', 500,
      'reason', 'SAVE_MEASUREMENT_ORDER_BATCH_PARTIAL_FAILED',
      'message', format('Falha no lote parcial de medicao: %s', sqlerrm)
    );
end;
$$;

revoke all on function public.save_project_measurement_order_batch_partial(uuid, uuid, jsonb) from public;
grant execute on function public.save_project_measurement_order_batch_partial(uuid, uuid, jsonb) to authenticated;
grant execute on function public.save_project_measurement_order_batch_partial(uuid, uuid, jsonb) to service_role;
