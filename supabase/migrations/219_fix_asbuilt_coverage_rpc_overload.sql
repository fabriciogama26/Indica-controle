-- Corrige ambiguidade entre as assinaturas antiga e nova da RPC de Medicao Asbuilt.

do $$
begin
  if to_regprocedure(
    'public.save_project_asbuilt_measurement_order_legacy_internal(uuid,uuid,uuid,uuid,text,uuid,text,jsonb,timestamptz)'
  ) is null
    and to_regprocedure(
      'public.save_project_asbuilt_measurement_order(uuid,uuid,uuid,uuid,text,uuid,text,jsonb,timestamptz)'
    ) is not null
  then
    alter function public.save_project_asbuilt_measurement_order(
      uuid, uuid, uuid, uuid, text, uuid, text, jsonb, timestamptz
    ) rename to save_project_asbuilt_measurement_order_legacy_internal;
  end if;
end;
$$;

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

  v_result := public.save_project_asbuilt_measurement_order_legacy_internal(
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

revoke all on function public.save_project_asbuilt_measurement_order_legacy_internal(
  uuid, uuid, uuid, uuid, text, uuid, text, jsonb, timestamptz
) from public, anon, authenticated;

revoke all on function public.save_project_asbuilt_measurement_order(
  uuid, uuid, uuid, uuid, text, uuid, text, jsonb, timestamptz, date
) from public, anon;

grant execute on function public.save_project_asbuilt_measurement_order(
  uuid, uuid, uuid, uuid, text, uuid, text, jsonb, timestamptz, date
) to authenticated, service_role;

notify pgrst, 'reload schema';
