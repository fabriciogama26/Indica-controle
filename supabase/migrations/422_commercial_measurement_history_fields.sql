-- 422_commercial_measurement_history_fields.sql
-- Inclui os campos proprios da Medicao Comercial no historico da ordem.
--
-- CONTEXTO
-- ---------------------------------------------------------------------------
-- `save_project_commercial_measurement_order` delega cabecalho e itens para
-- `save_project_measurement_order`. A RPC tecnica grava a linha de historico
-- antes de conhecer `commercial_order_ref` (Incidencia), Processo, horarios e
-- integrantes. Depois a RPC comercial preenche esses campos em outro UPDATE,
-- mas esse segundo passo nao atualizava `project_measurement_order_history`.
--
-- Resultado visivel: editar uma ordem comercial alterando principalmente
-- `Incidencia` salvava a ordem, mas o modal de historico mostrava apenas
-- "Quantidade de itens".
--
-- O QUE ESTA MIGRATION FAZ
-- ---------------------------------------------------------------------------
-- Recria apenas a RPC comercial para:
-- 1. capturar os valores comerciais anteriores quando for edicao;
-- 2. montar um JSON de mudancas para Incidencia, Processo, horarios e
--    Eletricista 1/2;
-- 3. anexar esse JSON a linha de historico recem-criada pela RPC tecnica;
-- 4. devolver o `updated_at` final, depois do UPDATE comercial.
--
-- A RPC tecnica nao muda. O contrato HTTP tambem nao muda.

create or replace function public.save_project_commercial_measurement_order(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_measurement_order_id uuid default null,
  p_programming_id uuid default null,
  p_project_id uuid default null,
  p_team_id uuid default null,
  p_execution_date date default null,
  p_measurement_date date default null,
  p_voice_point numeric default null,
  p_manual_rate numeric default null,
  p_notes text default null,
  p_measurement_kind text default 'COM_PRODUCAO',
  p_no_production_reason_id uuid default null,
  p_items jsonb default '[]'::jsonb,
  p_expected_updated_at timestamptz default null,
  p_commercial_employee_1_person_id uuid default null,
  p_commercial_employee_2_person_id uuid default null,
  p_commercial_order_ref text default null,
  p_commercial_process_id uuid default null,
  p_commercial_start_time time default null,
  p_commercial_end_time time default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_order_id uuid;
  v_updated_at timestamptz;
  v_employee_1_name text;
  v_employee_2_name text;
  v_commercial_order_ref text := nullif(btrim(coalesce(p_commercial_order_ref, '')), '');
  v_commercial_process_name text;
  v_previous_order public.project_measurement_orders%rowtype;
  v_previous_employee_1_person_id uuid;
  v_previous_employee_1_name text;
  v_previous_employee_2_person_id uuid;
  v_previous_employee_2_name text;
  v_commercial_changes jsonb := '{}'::jsonb;
  v_action text := case when p_measurement_order_id is null then 'CREATE' else 'UPDATE' end;
  v_history_id uuid;
begin
  if p_measurement_order_id is not null then
    select *
    into v_previous_order
    from public.project_measurement_orders
    where tenant_id = p_tenant_id
      and id = p_measurement_order_id;

    select person_id, person_name_snapshot
    into v_previous_employee_1_person_id, v_previous_employee_1_name
    from public.project_commercial_measurement_order_members
    where tenant_id = p_tenant_id
      and measurement_order_id = p_measurement_order_id
      and sort_order = 1;

    select person_id, person_name_snapshot
    into v_previous_employee_2_person_id, v_previous_employee_2_name
    from public.project_commercial_measurement_order_members
    where tenant_id = p_tenant_id
      and measurement_order_id = p_measurement_order_id
      and sort_order = 2;
  end if;

  if p_commercial_employee_1_person_id is null or p_commercial_employee_2_person_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_COMMERCIAL_MEMBERS',
      'message', 'Selecione os dois eletricistas da medicao comercial.'
    );
  end if;

  if p_commercial_employee_1_person_id = p_commercial_employee_2_person_id then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'DUPLICATE_COMMERCIAL_MEMBER',
      'message', 'Os dois integrantes da medicao comercial devem ser diferentes.'
    );
  end if;

  if p_commercial_start_time is null or p_commercial_end_time is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_COMMERCIAL_TIME',
      'message', 'Informe Hora inicio e Hora termino da medicao comercial.'
    );
  end if;

  if p_commercial_end_time <= p_commercial_start_time then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_COMMERCIAL_TIME_RANGE',
      'message', 'Hora termino deve ser maior que Hora inicio.'
    );
  end if;

  select nullif(btrim(coalesce(cp.name, '')), '')
  into v_commercial_process_name
  from public.measurement_commercial_processes cp
  where cp.id = p_commercial_process_id
    and cp.tenant_id = p_tenant_id
    and cp.ativo = true;

  if v_commercial_process_name is null then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'INVALID_COMMERCIAL_PROCESS',
      'message', 'Processo invalido para o tenant atual.'
    );
  end if;

  if not public.is_commercial_team(p_tenant_id, p_team_id) then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'INVALID_TEAM_CATEGORY',
      'message', 'Selecione uma equipe comercial.'
    );
  end if;

  select nullif(btrim(coalesce(p.nome, '')), '')
  into v_employee_1_name
  from public.people p
  join public.job_titles jt
    on jt.id = p.job_title_id
   and jt.tenant_id = p.tenant_id
  where p.id = p_commercial_employee_1_person_id
    and p.tenant_id = p_tenant_id
    and p.ativo = true
    and jt.ativo = true
    and (jt.code ilike '%ELETRICISTA%' or jt.name ilike '%ELETRICISTA%');

  select nullif(btrim(coalesce(p.nome, '')), '')
  into v_employee_2_name
  from public.people p
  join public.job_titles jt
    on jt.id = p.job_title_id
   and jt.tenant_id = p.tenant_id
  where p.id = p_commercial_employee_2_person_id
    and p.tenant_id = p_tenant_id
    and p.ativo = true
    and jt.ativo = true
    and (jt.code ilike '%ELETRICISTA%' or jt.name ilike '%ELETRICISTA%');

  if v_employee_1_name is null or v_employee_2_name is null then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'INVALID_COMMERCIAL_MEMBER',
      'message', 'Integrante invalido: selecione eletricistas ativos do tenant atual.'
    );
  end if;

  if p_measurement_order_id is null then
    v_commercial_changes := v_commercial_changes
      || jsonb_build_object('commercialOrderRef', jsonb_build_object('from', null, 'to', v_commercial_order_ref))
      || jsonb_build_object('commercialProcessName', jsonb_build_object('from', null, 'to', v_commercial_process_name))
      || jsonb_build_object('commercialStartTime', jsonb_build_object('from', null, 'to', to_char(p_commercial_start_time, 'HH24:MI')))
      || jsonb_build_object('commercialEndTime', jsonb_build_object('from', null, 'to', to_char(p_commercial_end_time, 'HH24:MI')))
      || jsonb_build_object('commercialEmployee1Name', jsonb_build_object('from', null, 'to', v_employee_1_name))
      || jsonb_build_object('commercialEmployee2Name', jsonb_build_object('from', null, 'to', v_employee_2_name));
  else
    if coalesce(v_previous_order.commercial_order_ref, '') <> coalesce(v_commercial_order_ref, '') then
      v_commercial_changes := v_commercial_changes
        || jsonb_build_object('commercialOrderRef', jsonb_build_object('from', nullif(v_previous_order.commercial_order_ref, ''), 'to', v_commercial_order_ref));
    end if;

    if coalesce(v_previous_order.commercial_process_name_snapshot, '') <> coalesce(v_commercial_process_name, '') then
      v_commercial_changes := v_commercial_changes
        || jsonb_build_object('commercialProcessName', jsonb_build_object('from', nullif(v_previous_order.commercial_process_name_snapshot, ''), 'to', v_commercial_process_name));
    end if;

    if coalesce(to_char(v_previous_order.commercial_start_time, 'HH24:MI'), '') <> coalesce(to_char(p_commercial_start_time, 'HH24:MI'), '') then
      v_commercial_changes := v_commercial_changes
        || jsonb_build_object('commercialStartTime', jsonb_build_object('from', to_char(v_previous_order.commercial_start_time, 'HH24:MI'), 'to', to_char(p_commercial_start_time, 'HH24:MI')));
    end if;

    if coalesce(to_char(v_previous_order.commercial_end_time, 'HH24:MI'), '') <> coalesce(to_char(p_commercial_end_time, 'HH24:MI'), '') then
      v_commercial_changes := v_commercial_changes
        || jsonb_build_object('commercialEndTime', jsonb_build_object('from', to_char(v_previous_order.commercial_end_time, 'HH24:MI'), 'to', to_char(p_commercial_end_time, 'HH24:MI')));
    end if;

    if v_previous_employee_1_person_id is distinct from p_commercial_employee_1_person_id then
      v_commercial_changes := v_commercial_changes
        || jsonb_build_object('commercialEmployee1Name', jsonb_build_object('from', nullif(v_previous_employee_1_name, ''), 'to', v_employee_1_name));
    end if;

    if v_previous_employee_2_person_id is distinct from p_commercial_employee_2_person_id then
      v_commercial_changes := v_commercial_changes
        || jsonb_build_object('commercialEmployee2Name', jsonb_build_object('from', nullif(v_previous_employee_2_name, ''), 'to', v_employee_2_name));
    end if;
  end if;

  v_result := public.save_project_measurement_order(
    p_tenant_id => p_tenant_id,
    p_actor_user_id => p_actor_user_id,
    p_measurement_order_id => p_measurement_order_id,
    p_programming_id => p_programming_id,
    p_project_id => p_project_id,
    p_team_id => p_team_id,
    p_execution_date => p_execution_date,
    p_measurement_date => p_measurement_date,
    p_voice_point => p_voice_point,
    p_manual_rate => p_manual_rate,
    p_notes => p_notes,
    p_measurement_kind => p_measurement_kind,
    p_no_production_reason_id => p_no_production_reason_id,
    p_items => p_items,
    p_expected_updated_at => p_expected_updated_at
  );

  if coalesce((v_result ->> 'success')::boolean, false) is not true then
    return v_result;
  end if;

  v_order_id := nullif(v_result ->> 'measurement_order_id', '')::uuid;
  if v_order_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 500,
      'reason', 'MISSING_MEASUREMENT_ORDER_ID',
      'message', 'Ordem salva, mas nao foi possivel vincular os integrantes.'
    );
  end if;

  update public.project_measurement_orders
  set
    commercial_order_ref = v_commercial_order_ref,
    commercial_process_id = p_commercial_process_id,
    commercial_process_name_snapshot = v_commercial_process_name,
    commercial_start_time = p_commercial_start_time,
    commercial_end_time = p_commercial_end_time,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = v_order_id
  returning updated_at into v_updated_at;

  delete from public.project_commercial_measurement_order_members
  where tenant_id = p_tenant_id
    and measurement_order_id = v_order_id;

  insert into public.project_commercial_measurement_order_members (
    tenant_id,
    measurement_order_id,
    person_id,
    person_name_snapshot,
    sort_order,
    created_by,
    updated_by
  ) values
    (p_tenant_id, v_order_id, p_commercial_employee_1_person_id, v_employee_1_name, 1, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, v_order_id, p_commercial_employee_2_person_id, v_employee_2_name, 2, p_actor_user_id, p_actor_user_id);

  if coalesce(jsonb_object_length(v_commercial_changes), 0) > 0 then
    update public.project_measurement_order_history
    set
      changes = coalesce(changes, '{}'::jsonb) || v_commercial_changes,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('commercialFieldsIncluded', true)
    where id = (
      select h.id
      from public.project_measurement_order_history h
      where h.tenant_id = p_tenant_id
        and h.measurement_order_id = v_order_id
        and h.created_by = p_actor_user_id
        and h.action_type = v_action
        and coalesce(h.metadata ->> 'source', '') = 'measurement-api'
      order by h.created_at desc
      limit 1
    )
    returning id into v_history_id;

    if v_history_id is null then
      perform public.append_project_measurement_order_history_record(
        p_tenant_id,
        p_actor_user_id,
        v_order_id,
        v_action,
        null,
        v_commercial_changes,
        jsonb_build_object('source', 'measurement-commercial-api')
      );
    end if;
  end if;

  return v_result || jsonb_build_object('updated_at', coalesce(v_updated_at, nullif(v_result ->> 'updated_at', '')::timestamptz));
end;
$$;

revoke all on function public.save_project_commercial_measurement_order(
  uuid, uuid, uuid, uuid, uuid, uuid, date, date, numeric, numeric, text, text, uuid, jsonb, timestamptz, uuid, uuid, text, uuid, time, time
) from public, anon, authenticated;

grant execute on function public.save_project_commercial_measurement_order(
  uuid, uuid, uuid, uuid, uuid, uuid, date, date, numeric, numeric, text, text, uuid, jsonb, timestamptz, uuid, uuid, text, uuid, time, time
) to service_role;

-- =============================================================================
-- Validacao
-- =============================================================================
do $$
declare
  v_function regprocedure := 'public.save_project_commercial_measurement_order(uuid, uuid, uuid, uuid, uuid, uuid, date, date, numeric, numeric, text, text, uuid, jsonb, timestamptz, uuid, uuid, text, uuid, time, time)'::regprocedure;
  v_definition text;
begin
  select pg_get_functiondef(v_function::oid)
  into v_definition;

  if position('commercialOrderRef' in v_definition) = 0 then
    raise exception '422: historico da Incidencia nao foi incluido na RPC comercial.';
  end if;

  if position('commercialFieldsIncluded' in v_definition) = 0 then
    raise exception '422: marca de historico comercial ausente.';
  end if;

  if has_function_privilege('anon', v_function::oid, 'EXECUTE')
    or has_function_privilege('authenticated', v_function::oid, 'EXECUTE')
  then
    raise exception '422: save_project_commercial_measurement_order executavel por anon/authenticated.';
  end if;
end;
$$;
