-- Adiciona a data limite dos servicos cobertos pela Medicao Asbuilt.

alter table if exists public.project_asbuilt_measurement_orders
  add column if not exists service_coverage_end_date date null;

create index if not exists idx_project_asbuilt_measurement_orders_tenant_coverage_date
  on public.project_asbuilt_measurement_orders (tenant_id, service_coverage_end_date, project_id)
  where is_active = true and status <> 'CANCELADA';

create or replace function public.enforce_asbuilt_service_coverage_end_date()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_context_date text;
begin
  if new.service_coverage_end_date is null and tg_op = 'INSERT' then
    v_context_date := nullif(current_setting('app.asbuilt_service_coverage_end_date', true), '');
    if v_context_date is not null then
      new.service_coverage_end_date := v_context_date::date;
    end if;
  end if;

  if new.service_coverage_end_date is null then
    raise exception 'Servicos considerados ate e obrigatorio para novos registros de Medicao Asbuilt.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_asbuilt_service_coverage_end_date
  on public.project_asbuilt_measurement_orders;

create trigger trg_enforce_asbuilt_service_coverage_end_date
before insert or update of service_coverage_end_date on public.project_asbuilt_measurement_orders
for each row
execute function public.enforce_asbuilt_service_coverage_end_date();

create or replace function public.save_project_asbuilt_measurement_order(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_asbuilt_measurement_order_id uuid default null,
  p_project_id uuid default null,
  p_asbuilt_kind text default 'COM_PRODUCAO',
  p_no_production_reason_id uuid default null,
  p_notes text default null,
  p_items jsonb default '[]'::jsonb,
  p_expected_updated_at timestamptz default null,
  p_service_coverage_end_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_order_id uuid;
  v_previous_coverage_end_date date;
  v_updated_at timestamptz;
begin
  if p_service_coverage_end_date is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_ASBUILT_SERVICE_COVERAGE_END_DATE',
      'message', 'Informe a data limite dos servicos considerados no Asbuilt.'
    );
  end if;

  if p_asbuilt_measurement_order_id is not null then
    select service_coverage_end_date
    into v_previous_coverage_end_date
    from public.project_asbuilt_measurement_orders
    where tenant_id = p_tenant_id
      and id = p_asbuilt_measurement_order_id;
  end if;

  perform set_config('app.asbuilt_service_coverage_end_date', p_service_coverage_end_date::text, true);

  v_result := public.save_project_asbuilt_measurement_order(
    p_tenant_id,
    p_actor_user_id,
    p_asbuilt_measurement_order_id,
    p_project_id,
    p_asbuilt_kind,
    p_no_production_reason_id,
    p_notes,
    p_items,
    p_expected_updated_at
  );

  if coalesce((v_result->>'success')::boolean, false) is not true then
    return v_result;
  end if;

  v_order_id := nullif(v_result->>'asbuilt_measurement_order_id', '')::uuid;

  update public.project_asbuilt_measurement_orders
  set
    service_coverage_end_date = p_service_coverage_end_date,
    updated_by = p_actor_user_id,
    updated_at = now()
  where tenant_id = p_tenant_id
    and id = v_order_id
  returning updated_at into v_updated_at;

  if v_previous_coverage_end_date is distinct from p_service_coverage_end_date then
    perform public.append_project_asbuilt_measurement_order_history_record(
      p_tenant_id,
      p_actor_user_id,
      v_order_id,
      case when p_asbuilt_measurement_order_id is null then 'CREATE_COVERAGE_DATE' else 'UPDATE' end,
      null,
      jsonb_build_object(
        'serviceCoverageEndDate',
        jsonb_build_object(
          'from', v_previous_coverage_end_date,
          'to', p_service_coverage_end_date
        )
      ),
      jsonb_build_object('source', 'medicao-asbuilt')
    );
  end if;

  return v_result || jsonb_build_object('updated_at', v_updated_at);
end;
$$;

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

  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    v_row_numbers := coalesce(v_row->'rowNumbers', '[]'::jsonb);

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
      nullif(v_row->>'serviceCoverageEndDate', '')::date
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

revoke all on function public.enforce_asbuilt_service_coverage_end_date() from public, anon, authenticated;
grant execute on function public.enforce_asbuilt_service_coverage_end_date() to service_role;

revoke all on function public.save_project_asbuilt_measurement_order(uuid, uuid, uuid, uuid, text, uuid, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.save_project_asbuilt_measurement_order(uuid, uuid, uuid, uuid, text, uuid, text, jsonb, timestamptz, date) from public, anon;
grant execute on function public.save_project_asbuilt_measurement_order(uuid, uuid, uuid, uuid, text, uuid, text, jsonb, timestamptz, date) to authenticated;
grant execute on function public.save_project_asbuilt_measurement_order(uuid, uuid, uuid, uuid, text, uuid, text, jsonb, timestamptz, date) to service_role;

revoke all on function public.save_project_asbuilt_measurement_order_batch_partial(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_project_asbuilt_measurement_order_batch_partial(uuid, uuid, jsonb) to authenticated;
grant execute on function public.save_project_asbuilt_measurement_order_batch_partial(uuid, uuid, jsonb) to service_role;
