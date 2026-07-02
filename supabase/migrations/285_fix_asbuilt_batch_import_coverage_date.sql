-- Corrige regressao da migration 259 na importacao em massa de Medicao Asbuilt.
-- A RPC de lote foi recriada sem repassar `serviceCoverageEndDate` para a RPC principal.

create or replace function public.save_project_asbuilt_measurement_order_batch_partial(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_rows jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row jsonb;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_saved_count integer := 0;
  v_error_count integer := 0;
  v_row_numbers jsonb;
  v_service_coverage_end_date date;
begin
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) = 0
  then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_ASBUILT_MEASUREMENT_BATCH',
      'message', 'Nenhuma linha valida enviada para importacao.'
    );
  end if;

  if jsonb_array_length(p_rows) > 500 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'BATCH_TOO_LARGE',
      'message', 'Maximo de 500 medicoes por importacao em lote.'
    );
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    v_row_numbers := coalesce(v_row->'rowNumbers', '[]'::jsonb);
    v_service_coverage_end_date := nullif(
      coalesce(v_row->>'serviceCoverageEndDate', v_row->>'service_coverage_end_date', ''),
      ''
    )::date;

    v_result := public.save_project_asbuilt_measurement_order(
      p_tenant_id,
      p_actor_user_id,
      null,
      nullif(v_row->>'projectId', '')::uuid,
      coalesce(v_row->>'asbuiltMeasurementKind', 'COM_PRODUCAO'),
      nullif(v_row->>'noProductionReasonId', '')::uuid,
      v_row->>'notes',
      coalesce(v_row->'items', '[]'::jsonb),
      null,
      v_service_coverage_end_date
    );

    if coalesce((v_result->>'success')::boolean, false) then
      v_saved_count := v_saved_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'rowNumbers', v_row_numbers,
        'success', true,
        'message', v_result->>'message',
        'asbuiltMeasurementOrderId', v_result->>'asbuilt_measurement_order_id'
      ));
    else
      v_error_count := v_error_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'rowNumbers', v_row_numbers,
        'success', false,
        'reason', v_result->>'reason',
        'message', v_result->>'message'
      ));
    end if;
  end loop;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'message', 'Importacao parcial de medicao-asbuilt concluida.',
    'savedCount', v_saved_count,
    'errorCount', v_error_count,
    'results', v_results
  );
end;
$$;

revoke all on function public.save_project_asbuilt_measurement_order_batch_partial(uuid, uuid, jsonb)
from public, anon;

grant execute on function public.save_project_asbuilt_measurement_order_batch_partial(uuid, uuid, jsonb)
to authenticated, service_role;

notify pgrst, 'reload schema';
