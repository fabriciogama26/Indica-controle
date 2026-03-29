-- 122_protect_duplicate_measurement_items_in_rpc.sql
-- Reforca a RPC da Medicao para bloquear atividade duplicada no mesmo payload,
-- protegendo tanto o cadastro manual quanto o cadastro em massa.

create or replace function public.save_project_measurement_order(
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
  p_items jsonb default '[]'::jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.project_measurement_orders%rowtype;
  v_order_id uuid;
  v_updated_at timestamptz;
  v_project_id uuid;
  v_team_id uuid;
  v_execution_date date;
  v_project_code text;
  v_team_name text;
  v_foreman_name text;
  v_item_count integer := coalesce(jsonb_array_length(coalesce(p_items, '[]'::jsonb)), 0);
  v_inserted_count integer := 0;
  v_action text;
  v_link_programming_id uuid := p_programming_id;
  v_programming_completion_status text;
  v_programming_completion_updated_at timestamptz;
  v_previous_item_count integer := 0;
  v_changes jsonb := '{}'::jsonb;
  v_valid_activity_count integer := 0;
  v_distinct_activity_count integer := 0;
begin
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or v_item_count = 0 then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_MEASUREMENT_ITEMS', 'message', 'Informe itens validos da ordem de medicao.');
  end if;

  if coalesce(p_measurement_date, null) is null or coalesce(p_voice_point, 0) <= 0 or coalesce(p_manual_rate, 0) <= 0 then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_MEASUREMENT_HEADER', 'message', 'Cabecalho da ordem de medicao invalido.');
  end if;

  select
    count(*),
    count(distinct source.activity_id)
  into
    v_valid_activity_count,
    v_distinct_activity_count
  from (
    select sa.id as activity_id
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as raw(item)
    join public.service_activities sa
      on sa.tenant_id = p_tenant_id
     and sa.id = case when coalesce(nullif(btrim(raw.item ->> 'activityId'), ''), '') ~* '^[0-9a-f-]{36}$' then (raw.item ->> 'activityId')::uuid else null end
     and sa.ativo = true
  ) as source;

  if v_valid_activity_count > v_distinct_activity_count then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'DUPLICATE_MEASUREMENT_ACTIVITY',
      'message', 'A mesma atividade nao pode ser repetida na ordem de medicao.'
    );
  end if;

  if p_measurement_order_id is null then
    v_project_id := p_project_id;
    v_team_id := p_team_id;
    v_execution_date := p_execution_date;

    if p_programming_id is not null then
      select
        pp.id,
        pp.project_id,
        pp.team_id,
        pp.execution_date,
        p.sob,
        t.name,
        pe.nome,
        pp.work_completion_status,
        pp.updated_at
      into
        v_link_programming_id,
        v_project_id,
        v_team_id,
        v_execution_date,
        v_project_code,
        v_team_name,
        v_foreman_name,
        v_programming_completion_status,
        v_programming_completion_updated_at
      from public.project_programming pp
      join public.project p on p.id = pp.project_id and p.tenant_id = pp.tenant_id
      join public.teams t on t.id = pp.team_id and t.tenant_id = pp.tenant_id
      left join public.people pe on pe.id = t.foreman_person_id and pe.tenant_id = t.tenant_id
      where pp.tenant_id = p_tenant_id
        and pp.id = p_programming_id
      for update;

      if not found then
        return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROGRAMMING_NOT_FOUND', 'message', 'Programacao nao encontrada para gerar a ordem.');
      end if;
    end if;

    if v_project_id is null or v_team_id is null or v_execution_date is null then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'MISSING_MEASUREMENT_CONTEXT', 'message', 'Projeto, equipe e data de execucao sao obrigatorios.');
    end if;

    if v_link_programming_id is null then
      select
        pp.id,
        pp.work_completion_status,
        pp.updated_at
      into
        v_link_programming_id,
        v_programming_completion_status,
        v_programming_completion_updated_at
      from public.project_programming pp
      where pp.tenant_id = p_tenant_id
        and pp.project_id = v_project_id
        and pp.team_id = v_team_id
        and pp.execution_date = v_execution_date
      order by
        case pp.status
          when 'PROGRAMADA' then 0
          when 'REPROGRAMADA' then 1
          when 'ADIADA' then 2
          when 'CANCELADA' then 3
          else 4
        end,
        pp.updated_at desc
      limit 1;
    end if;

    if v_link_programming_id is not null and exists (
      select 1 from public.project_measurement_orders
      where tenant_id = p_tenant_id and programming_id = v_link_programming_id
    ) then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'MEASUREMENT_ORDER_ALREADY_EXISTS', 'message', 'Ja existe ordem para esta programacao.');
    end if;

    if v_project_code is null then
      select sob into v_project_code from public.project where tenant_id = p_tenant_id and id = v_project_id and is_active = true;
      if not found then
        return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROJECT_NOT_FOUND', 'message', 'Projeto invalido para ordem de medicao.');
      end if;
    end if;

    if v_team_name is null then
      select t.name, pe.nome
      into v_team_name, v_foreman_name
      from public.teams t
      left join public.people pe on pe.id = t.foreman_person_id and pe.tenant_id = t.tenant_id
      where t.tenant_id = p_tenant_id and t.id = v_team_id and t.ativo = true;
      if not found then
        return jsonb_build_object('success', false, 'status', 404, 'reason', 'TEAM_NOT_FOUND', 'message', 'Equipe invalida para ordem de medicao.');
      end if;
    end if;

    v_programming_completion_status := upper(nullif(btrim(coalesce(v_programming_completion_status, '')), ''));
    if v_programming_completion_status not in ('CONCLUIDO', 'PARCIAL') then
      v_programming_completion_status := null;
    end if;

    insert into public.project_measurement_orders (
      tenant_id, order_number, programming_id, project_id, team_id, execution_date, measurement_date, voice_point, manual_rate, status,
      notes, project_code_snapshot, team_name_snapshot, foreman_name_snapshot, programming_completion_status_snapshot, programming_completion_status_snapshot_at, created_by, updated_by
    ) values (
      p_tenant_id,
      format('OM-%s-%s', to_char(p_measurement_date, 'YYYYMMDD'), upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))),
      v_link_programming_id, v_project_id, v_team_id, v_execution_date, p_measurement_date, p_voice_point, p_manual_rate, 'ABERTA',
      nullif(btrim(coalesce(p_notes, '')), ''), v_project_code, v_team_name, nullif(btrim(coalesce(v_foreman_name, '')), ''), v_programming_completion_status, case when v_programming_completion_status is null then null else coalesce(v_programming_completion_updated_at, now()) end, p_actor_user_id, p_actor_user_id
    ) returning id, updated_at into v_order_id, v_updated_at;

    v_action := 'CREATE';
  else
    select * into v_order
    from public.project_measurement_orders
    where tenant_id = p_tenant_id and id = p_measurement_order_id
    for update;

    if not found then
      return jsonb_build_object('success', false, 'status', 404, 'reason', 'MEASUREMENT_ORDER_NOT_FOUND', 'message', 'Ordem de medicao nao encontrada.');
    end if;

    if p_expected_updated_at is null then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'EXPECTED_UPDATED_AT_REQUIRED', 'message', 'Atualize a lista antes de editar.');
    end if;

    if date_trunc('milliseconds', v_order.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONCURRENT_MODIFICATION', 'message', 'Ordem alterada por outro usuario.');
    end if;

    if v_order.status <> 'ABERTA' then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'MEASUREMENT_ORDER_LOCKED', 'message', 'Somente ordem ABERTA pode ser editada.');
    end if;

    v_project_id := p_project_id;
    v_team_id := p_team_id;
    v_execution_date := p_execution_date;
    v_order_id := v_order.id;

    if v_project_id is null or v_team_id is null or v_execution_date is null then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'MISSING_MEASUREMENT_CONTEXT', 'message', 'Projeto, equipe e data de execucao sao obrigatorios na edicao.');
    end if;

    select sob into v_project_code
    from public.project
    where tenant_id = p_tenant_id and id = v_project_id and is_active = true;
    if not found then
      return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROJECT_NOT_FOUND', 'message', 'Projeto invalido para ordem de medicao.');
    end if;

    select t.name, pe.nome
    into v_team_name, v_foreman_name
    from public.teams t
    left join public.people pe on pe.id = t.foreman_person_id and pe.tenant_id = t.tenant_id
    where t.tenant_id = p_tenant_id and t.id = v_team_id and t.ativo = true;
    if not found then
      return jsonb_build_object('success', false, 'status', 404, 'reason', 'TEAM_NOT_FOUND', 'message', 'Equipe invalida para ordem de medicao.');
    end if;

    if p_programming_id is not null then
      select
        pp.id,
        pp.work_completion_status,
        pp.updated_at
      into
        v_link_programming_id,
        v_programming_completion_status,
        v_programming_completion_updated_at
      from public.project_programming pp
      where pp.tenant_id = p_tenant_id
        and pp.id = p_programming_id
      for update;

      if not found then
        return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROGRAMMING_NOT_FOUND', 'message', 'Programacao nao encontrada para vinculo da ordem.');
      end if;
    else
      select
        pp.id,
        pp.work_completion_status,
        pp.updated_at
      into
        v_link_programming_id,
        v_programming_completion_status,
        v_programming_completion_updated_at
      from public.project_programming pp
      where pp.tenant_id = p_tenant_id
        and pp.project_id = v_project_id
        and pp.team_id = v_team_id
        and pp.execution_date = v_execution_date
      order by
        case pp.status
          when 'PROGRAMADA' then 0
          when 'REPROGRAMADA' then 1
          when 'ADIADA' then 2
          when 'CANCELADA' then 3
          else 4
        end,
        pp.updated_at desc
      limit 1;
    end if;

    if v_link_programming_id is not null and exists (
      select 1
      from public.project_measurement_orders
      where tenant_id = p_tenant_id
        and programming_id = v_link_programming_id
        and id <> v_order_id
    ) then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'MEASUREMENT_ORDER_ALREADY_EXISTS', 'message', 'Ja existe ordem para esta programacao.');
    end if;

    v_programming_completion_status := upper(nullif(btrim(coalesce(v_programming_completion_status, '')), ''));
    if v_programming_completion_status not in ('CONCLUIDO', 'PARCIAL') then
      v_programming_completion_status := null;
    end if;

    select count(*)
    into v_previous_item_count
    from public.project_measurement_order_items
    where tenant_id = p_tenant_id
      and measurement_order_id = v_order_id
      and is_active = true;

    if v_order.project_id <> v_project_id then
      v_changes := v_changes || jsonb_build_object('projectId', jsonb_build_object('from', v_order.project_id::text, 'to', v_project_id::text));
    end if;

    if v_order.team_id <> v_team_id then
      v_changes := v_changes || jsonb_build_object('teamId', jsonb_build_object('from', v_order.team_id::text, 'to', v_team_id::text));
    end if;

    if v_order.execution_date <> v_execution_date then
      v_changes := v_changes || jsonb_build_object('executionDate', jsonb_build_object('from', v_order.execution_date::text, 'to', v_execution_date::text));
    end if;

    if v_order.manual_rate <> p_manual_rate then
      v_changes := v_changes || jsonb_build_object('manualRate', jsonb_build_object('from', v_order.manual_rate::text, 'to', p_manual_rate::text));
    end if;

    update public.project_measurement_orders
    set
      programming_id = v_link_programming_id,
      project_id = v_project_id,
      team_id = v_team_id,
      execution_date = v_execution_date,
      measurement_date = p_measurement_date,
      voice_point = p_voice_point,
      manual_rate = p_manual_rate,
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      project_code_snapshot = v_project_code,
      team_name_snapshot = v_team_name,
      foreman_name_snapshot = nullif(btrim(coalesce(v_foreman_name, '')), ''),
      programming_completion_status_snapshot = v_programming_completion_status,
      programming_completion_status_snapshot_at = case when v_programming_completion_status is null then null else coalesce(v_programming_completion_updated_at, now()) end,
      updated_by = p_actor_user_id
    where tenant_id = p_tenant_id and id = v_order_id
    returning updated_at into v_updated_at;

    update public.project_measurement_order_items
    set is_active = false, updated_by = p_actor_user_id
    where tenant_id = p_tenant_id and measurement_order_id = v_order_id and is_active = true;

    v_action := 'UPDATE';
  end if;

  insert into public.project_measurement_order_items (
    tenant_id, measurement_order_id, service_activity_id, programming_activity_id, project_activity_forecast_id,
    activity_code, activity_description, activity_unit, quantity, voice_point, manual_rate, unit_value, observation, is_active, created_by, updated_by
  )
  select
    p_tenant_id,
    v_order_id,
    sa.id,
    case when coalesce(nullif(btrim(raw.item ->> 'programmingActivityId'), ''), '') ~* '^[0-9a-f-]{36}$' then (raw.item ->> 'programmingActivityId')::uuid else null end,
    case when coalesce(nullif(btrim(raw.item ->> 'projectActivityForecastId'), ''), '') ~* '^[0-9a-f-]{36}$' then (raw.item ->> 'projectActivityForecastId')::uuid else null end,
    sa.code,
    sa.description,
    sa.unit,
    replace(raw.item ->> 'quantity', ',', '.')::numeric,
    coalesce(case when nullif(btrim(raw.item ->> 'voicePoint'), '') is not null then replace(raw.item ->> 'voicePoint', ',', '.')::numeric else null end, sa.voice_point, p_voice_point),
    coalesce(case when nullif(btrim(raw.item ->> 'manualRate'), '') is not null then replace(raw.item ->> 'manualRate', ',', '.')::numeric else null end, p_manual_rate),
    coalesce(case when nullif(btrim(raw.item ->> 'unitValue'), '') is not null then replace(raw.item ->> 'unitValue', ',', '.')::numeric else null end, sa.unit_value),
    nullif(btrim(coalesce(raw.item ->> 'observation', '')), ''),
    true,
    p_actor_user_id,
    p_actor_user_id
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as raw(item)
  join public.service_activities sa
    on sa.tenant_id = p_tenant_id
   and sa.id = case when coalesce(nullif(btrim(raw.item ->> 'activityId'), ''), '') ~* '^[0-9a-f-]{36}$' then (raw.item ->> 'activityId')::uuid else null end
   and sa.ativo = true
  where replace(raw.item ->> 'quantity', ',', '.')::numeric > 0;

  get diagnostics v_inserted_count = row_count;
  if v_inserted_count <> v_item_count then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_MEASUREMENT_ITEMS', 'message', 'Ha atividades invalidas na ordem de medicao.');
  end if;

  perform public.append_project_measurement_order_history_record(
    p_tenant_id,
    p_actor_user_id,
    v_order_id,
    v_action,
    null,
    case
      when v_action = 'UPDATE' then
        v_changes || jsonb_build_object('itemCount', jsonb_build_object('from', v_previous_item_count::text, 'to', v_item_count::text))
      else
        jsonb_build_object('itemCount', jsonb_build_object('from', null, 'to', v_item_count::text))
    end,
    jsonb_build_object('source', 'measurement-api')
  );

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'measurement_order_id', v_order_id,
    'updated_at', v_updated_at,
    'message', case when v_action = 'CREATE' then 'Ordem de medicao criada com sucesso.' else 'Ordem de medicao atualizada com sucesso.' end
  );
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'MEASUREMENT_ORDER_ALREADY_EXISTS', 'message', 'Ja existe ordem para esta programacao.');
  when others then
    return jsonb_build_object('success', false, 'status', 500, 'reason', 'SAVE_MEASUREMENT_ORDER_FAILED', 'message', format('Falha ao salvar ordem de medicao: %s', sqlerrm));
end;
$$;
