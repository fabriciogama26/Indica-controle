-- 102_use_programming_history_only_and_physical_rescheduled_status.sql
-- Torna REPROGRAMADA um status fisico da Programacao e usa apenas project_programming_history como timeline operacional.

alter table if exists public.project_programming
  drop constraint if exists project_programming_status_check;

alter table if exists public.project_programming
  add constraint project_programming_status_check
  check (status in ('PROGRAMADA', 'REPROGRAMADA', 'ADIADA', 'CANCELADA'));

alter table if exists public.project_programming
  drop constraint if exists project_programming_status_fields_check;

alter table if exists public.project_programming
  add constraint project_programming_status_fields_check
  check (
    (
      status in ('PROGRAMADA', 'REPROGRAMADA')
      and is_active = true
      and cancellation_reason is null
      and canceled_at is null
      and canceled_by is null
    )
    or (
      status in ('ADIADA', 'CANCELADA')
      and is_active = false
      and nullif(btrim(coalesce(cancellation_reason, '')), '') is not null
      and canceled_at is not null
      and canceled_by is not null
    )
  );

update public.project_programming pp
set status = 'REPROGRAMADA',
    updated_at = now()
where pp.status = 'PROGRAMADA'
  and exists (
    select 1
    from public.project_programming_history ph
    where ph.tenant_id = pp.tenant_id
      and (
        (ph.programming_id = pp.id and ph.action_type = 'RESCHEDULE')
        or (ph.programming_id = pp.id and coalesce(ph.metadata ->> 'source', '') = 'programacao-postpone')
        or (ph.related_programming_id = pp.id and ph.action_type = 'ADIADA')
      )
  );

create or replace function public.guard_project_inactivation_with_programming()
returns trigger
language plpgsql
as $$
begin
  if old.is_active = true and new.is_active = false then
    if exists (
      select 1
      from public.project_programming pp
      where pp.tenant_id = new.tenant_id
        and pp.project_id = new.id
        and pp.status in ('PROGRAMADA', 'REPROGRAMADA', 'ADIADA')
    ) then
      raise exception 'Nao e permitido inativar projeto com programacao programada, reprogramada ou adiada.'
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

drop function if exists public.save_project_programming(
  uuid,
  uuid,
  uuid,
  uuid,
  date,
  text,
  time,
  time,
  integer,
  text,
  text,
  text,
  jsonb,
  jsonb,
  uuid,
  timestamptz,
  uuid
);

create or replace function public.save_project_programming(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_project_id uuid,
  p_team_id uuid,
  p_execution_date date,
  p_period text,
  p_start_time time,
  p_end_time time,
  p_expected_minutes integer,
  p_feeder text default null,
  p_support text default null,
  p_note text default null,
  p_documents jsonb default '{}'::jsonb,
  p_activities jsonb default '[]'::jsonb,
  p_programming_id uuid default null,
  p_expected_updated_at timestamptz default null,
  p_support_item_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project record;
  v_team record;
  v_current public.project_programming%rowtype;
  v_programming_id uuid;
  v_action text;
  v_current_updated_at timestamptz;
  v_today date := current_date;
  v_feeder text := nullif(btrim(coalesce(p_feeder, '')), '');
  v_support text := nullif(btrim(coalesce(p_support, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_support_item record;
  v_support_item_id uuid := p_support_item_id;
  v_sgd jsonb := coalesce(p_documents -> 'sgd', '{}'::jsonb);
  v_pi jsonb := coalesce(p_documents -> 'pi', '{}'::jsonb);
  v_pep jsonb := coalesce(p_documents -> 'pep', '{}'::jsonb);
  v_sgd_number text;
  v_sgd_included_at date;
  v_sgd_delivered_at date;
  v_pi_number text;
  v_pi_included_at date;
  v_pi_delivered_at date;
  v_pep_number text;
  v_pep_included_at date;
  v_pep_delivered_at date;
  v_activity jsonb;
  v_activity_id uuid;
  v_activity_id_text text;
  v_activity_qty numeric;
  v_activity_row record;
  v_activity_ids uuid[] := array[]::uuid[];
  v_conflict_id uuid;
  v_conflict_project_code text;
  v_is_reschedule boolean := false;
begin
  if p_project_id is null
    or p_team_id is null
    or p_execution_date is null
    or p_period is null
    or p_start_time is null
    or p_end_time is null
    or p_expected_minutes is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_REQUIRED_FIELDS',
      'message', 'Preencha os campos obrigatorios da programacao.'
    );
  end if;

  if upper(btrim(p_period)) not in ('INTEGRAL', 'PARCIAL') then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_PERIOD',
      'message', 'Periodo invalido para a programacao.'
    );
  end if;

  if p_expected_minutes <= 0 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_EXPECTED_MINUTES',
      'message', 'Tempo previsto deve ser maior que zero.'
    );
  end if;

  if p_end_time <= p_start_time then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_TIME_RANGE',
      'message', 'Hora termino deve ser maior que hora inicio.'
    );
  end if;

  if jsonb_typeof(coalesce(p_documents, '{}'::jsonb)) <> 'object' then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_DOCUMENTS_PAYLOAD',
      'message', 'O bloco de documentos da programacao e invalido.'
    );
  end if;

  if jsonb_typeof(coalesce(p_activities, '[]'::jsonb)) <> 'array' then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_ACTIVITIES_PAYLOAD',
      'message', 'A lista de atividades da programacao e invalida.'
    );
  end if;

  select
    p.id,
    p.sob,
    p.service_center
  into v_project
  from public.project p
  where p.tenant_id = p_tenant_id
    and p.id = p_project_id
    and p.is_active = true;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'PROJECT_NOT_FOUND',
      'message', 'Projeto invalido para o tenant atual.'
    );
  end if;

  select
    t.id,
    t.name,
    t.service_center_id,
    sc.name as service_center_name
  into v_team
  from public.teams t
  left join public.project_service_centers sc
    on sc.id = t.service_center_id
   and sc.tenant_id = t.tenant_id
  where t.tenant_id = p_tenant_id
    and t.id = p_team_id
    and t.ativo = true;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'TEAM_NOT_FOUND',
      'message', 'Equipe invalida para o tenant atual.'
    );
  end if;

  if v_team.service_center_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'TEAM_SERVICE_CENTER_REQUIRED',
      'message', 'A equipe precisa ter uma base vinculada antes de salvar a programacao.'
    );
  end if;

  if v_team.service_center_id <> v_project.service_center then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'TEAM_SERVICE_CENTER_MISMATCH',
      'message', format(
        'A base da equipe %s nao corresponde a base da obra %s.',
        coalesce(v_team.service_center_name, 'Nao identificada'),
        v_project.sob
      )
    );
  end if;

  if v_support_item_id is not null then
    select
      id,
      description
    into v_support_item
    from public.programming_support_items
    where tenant_id = p_tenant_id
      and id = v_support_item_id
      and is_active = true;

    if not found then
      return jsonb_build_object(
        'success', false,
        'status', 404,
        'reason', 'SUPPORT_ITEM_NOT_FOUND',
        'message', 'Apoio invalido para o tenant atual.'
      );
    end if;

    v_support := nullif(btrim(coalesce(v_support_item.description, '')), '');
  else
    v_support := nullif(btrim(coalesce(p_support, '')), '');
  end if;

  if exists (
    select 1
    from (
      select nullif(btrim(coalesce(item ->> 'catalogId', '')), '') as catalog_id_text
      from jsonb_array_elements(coalesce(p_activities, '[]'::jsonb)) as item
    ) duplicated
    where duplicated.catalog_id_text is not null
    group by duplicated.catalog_id_text
    having count(*) > 1
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'DUPLICATED_ACTIVITY',
      'message', 'Nao repita a mesma atividade na mesma programacao.'
    );
  end if;

  if p_programming_id is not null then
    select *
    into v_current
    from public.project_programming pp
    where pp.tenant_id = p_tenant_id
      and pp.id = p_programming_id
      and pp.status in ('PROGRAMADA', 'REPROGRAMADA')
    for update;

    if not found then
      return jsonb_build_object(
        'success', false,
        'status', 404,
        'reason', 'PROGRAMMING_NOT_FOUND',
        'message', 'Programacao nao encontrada para edicao.'
      );
    end if;

    if p_expected_updated_at is null then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
        'message', 'Atualize a tela antes de salvar esta programacao.'
      );
    end if;

    v_current_updated_at := date_trunc('milliseconds', v_current.updated_at);
    if v_current_updated_at <> date_trunc('milliseconds', p_expected_updated_at) then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'PROGRAMMING_CONFLICT',
        'message', 'A programacao foi alterada por outro usuario. Recarregue a tela e tente novamente.'
      );
    end if;

    v_is_reschedule :=
      v_current.execution_date is distinct from p_execution_date
      or v_current.team_id is distinct from p_team_id
      or v_current.start_time is distinct from p_start_time
      or v_current.end_time is distinct from p_end_time;
  end if;

  select
    pp.id,
    proj.sob
  into v_conflict_id, v_conflict_project_code
  from public.project_programming pp
  join public.project proj
    on proj.id = pp.project_id
   and proj.tenant_id = pp.tenant_id
  where pp.tenant_id = p_tenant_id
    and pp.team_id = p_team_id
    and pp.execution_date = p_execution_date
    and pp.status in ('PROGRAMADA', 'REPROGRAMADA')
    and (p_programming_id is null or pp.id <> p_programming_id)
    and p_start_time < pp.end_time
    and p_end_time > pp.start_time
  limit 1;

  if v_conflict_id is not null then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'TEAM_TIME_CONFLICT',
      'message', format(
        'A equipe ja possui uma programacao em conflito com a obra %s neste horario.',
        coalesce(v_conflict_project_code, 'informada')
      )
    );
  end if;

  v_sgd_number := nullif(btrim(coalesce(v_sgd ->> 'number', '')), '');
  v_pi_number := nullif(btrim(coalesce(v_pi ->> 'number', '')), '');
  v_pep_number := nullif(btrim(coalesce(v_pep ->> 'number', '')), '');

  v_sgd_delivered_at := nullif(v_sgd ->> 'deliveredAt', '')::date;
  v_pi_delivered_at := nullif(v_pi ->> 'deliveredAt', '')::date;
  v_pep_delivered_at := nullif(v_pep ->> 'deliveredAt', '')::date;

  if v_current.id is not null then
    v_sgd_included_at := case
      when v_sgd_number is null then null
      when v_current.sgd_number is distinct from v_sgd_number then v_today
      else coalesce(v_current.sgd_included_at, v_today)
    end;
    v_pi_included_at := case
      when v_pi_number is null then null
      when v_current.pi_number is distinct from v_pi_number then v_today
      else coalesce(v_current.pi_included_at, v_today)
    end;
    v_pep_included_at := case
      when v_pep_number is null then null
      when v_current.pep_number is distinct from v_pep_number then v_today
      else coalesce(v_current.pep_included_at, v_today)
    end;
  else
    v_sgd_included_at := case when v_sgd_number is null then null else v_today end;
    v_pi_included_at := case when v_pi_number is null then null else v_today end;
    v_pep_included_at := case when v_pep_number is null then null else v_today end;
  end if;

  if v_current.id is null then
    v_action := 'INSERT';
    insert into public.project_programming (
      tenant_id,
      project_id,
      team_id,
      execution_date,
      period,
      start_time,
      end_time,
      expected_minutes,
      feeder,
      support,
      support_item_id,
      note,
      sgd_number,
      sgd_included_at,
      sgd_delivered_at,
      pi_number,
      pi_included_at,
      pi_delivered_at,
      pep_number,
      pep_included_at,
      pep_delivered_at,
      status,
      is_active,
      created_by,
      updated_by
    )
    values (
      p_tenant_id,
      p_project_id,
      p_team_id,
      p_execution_date,
      upper(btrim(p_period)),
      p_start_time,
      p_end_time,
      p_expected_minutes,
      v_feeder,
      v_support,
      v_support_item_id,
      v_note,
      v_sgd_number,
      v_sgd_included_at,
      v_sgd_delivered_at,
      v_pi_number,
      v_pi_included_at,
      v_pi_delivered_at,
      v_pep_number,
      v_pep_included_at,
      v_pep_delivered_at,
      'PROGRAMADA',
      true,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id into v_programming_id;
  else
    v_action := 'UPDATE';
    update public.project_programming
    set
      team_id = p_team_id,
      execution_date = p_execution_date,
      period = upper(btrim(p_period)),
      start_time = p_start_time,
      end_time = p_end_time,
      expected_minutes = p_expected_minutes,
      feeder = v_feeder,
      support = v_support,
      support_item_id = v_support_item_id,
      note = v_note,
      sgd_number = v_sgd_number,
      sgd_included_at = v_sgd_included_at,
      sgd_delivered_at = v_sgd_delivered_at,
      pi_number = v_pi_number,
      pi_included_at = v_pi_included_at,
      pi_delivered_at = v_pi_delivered_at,
      pep_number = v_pep_number,
      pep_included_at = v_pep_included_at,
      pep_delivered_at = v_pep_delivered_at,
      status = case
        when v_current.status = 'REPROGRAMADA' or v_is_reschedule then 'REPROGRAMADA'
        else 'PROGRAMADA'
      end,
      is_active = true,
      cancellation_reason = null,
      canceled_at = null,
      canceled_by = null,
      updated_by = p_actor_user_id
    where tenant_id = p_tenant_id
      and id = v_current.id;

    v_programming_id := v_current.id;
  end if;

  for v_activity in
    select value
    from jsonb_array_elements(coalesce(p_activities, '[]'::jsonb))
  loop
    v_activity_id_text := nullif(btrim(coalesce(v_activity ->> 'catalogId', '')), '');
    v_activity_qty := nullif(btrim(coalesce(v_activity ->> 'quantity', '')), '')::numeric;

    if v_activity_id_text is null or v_activity_qty is null or v_activity_qty <= 0 then
      continue;
    end if;

    v_activity_id := v_activity_id_text::uuid;

    select
      sa.id,
      sa.code,
      sa.description,
      sa.unit
    into v_activity_row
    from public.service_activities sa
    where sa.tenant_id = p_tenant_id
      and sa.id = v_activity_id
      and sa.is_active = true;

    if not found then
      return jsonb_build_object(
        'success', false,
        'status', 404,
        'reason', 'ACTIVITY_NOT_FOUND',
        'message', 'Atividade invalida para o tenant atual.'
      );
    end if;

    v_activity_ids := array_append(v_activity_ids, v_activity_id);

    if exists (
      select 1
      from public.project_programming_activities ppa
      where ppa.tenant_id = p_tenant_id
        and ppa.programming_id = v_programming_id
        and ppa.service_activity_id = v_activity_id
    ) then
      update public.project_programming_activities
      set
        quantity = v_activity_qty,
        activity_code = v_activity_row.code,
        activity_description = v_activity_row.description,
        activity_unit = v_activity_row.unit,
        is_active = true,
        updated_by = p_actor_user_id
      where tenant_id = p_tenant_id
        and programming_id = v_programming_id
        and service_activity_id = v_activity_id;
    else
      insert into public.project_programming_activities (
        tenant_id,
        programming_id,
        service_activity_id,
        activity_code,
        activity_description,
        activity_unit,
        quantity,
        is_active,
        created_by,
        updated_by
      )
      values (
        p_tenant_id,
        v_programming_id,
        v_activity_id,
        v_activity_row.code,
        v_activity_row.description,
        v_activity_row.unit,
        v_activity_qty,
        true,
        p_actor_user_id,
        p_actor_user_id
      );
    end if;
  end loop;

  update public.project_programming_activities
  set
    is_active = false,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and programming_id = v_programming_id
    and (
      cardinality(v_activity_ids) = 0
      or service_activity_id <> all(v_activity_ids)
    );

  return (
    select jsonb_build_object(
      'success', true,
      'status', 200,
      'action', v_action,
      'programming_id', pp.id,
      'project_code', proj.sob,
      'updated_at', pp.updated_at,
      'message', case
        when v_action = 'INSERT' then format('Programacao do projeto %s registrada com sucesso.', proj.sob)
        else format('Programacao do projeto %s atualizada com sucesso.', proj.sob)
      end
    )
    from public.project_programming pp
    join public.project proj
      on proj.id = pp.project_id
     and proj.tenant_id = pp.tenant_id
    where pp.tenant_id = p_tenant_id
      and pp.id = v_programming_id
  );
end;
$$;

revoke all on function public.save_project_programming(
  uuid,
  uuid,
  uuid,
  uuid,
  date,
  text,
  time,
  time,
  integer,
  text,
  text,
  text,
  jsonb,
  jsonb,
  uuid,
  timestamptz,
  uuid
) from public;

grant execute on function public.save_project_programming(
  uuid,
  uuid,
  uuid,
  uuid,
  date,
  text,
  time,
  time,
  integer,
  text,
  text,
  text,
  jsonb,
  jsonb,
  uuid,
  timestamptz,
  uuid
) to authenticated;

grant execute on function public.save_project_programming(
  uuid,
  uuid,
  uuid,
  uuid,
  date,
  text,
  time,
  time,
  integer,
  text,
  text,
  text,
  jsonb,
  jsonb,
  uuid,
  timestamptz,
  uuid
) to service_role;

drop function if exists public.set_project_programming_status(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz
);

create or replace function public.set_project_programming_status(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_id uuid,
  p_status text,
  p_reason text,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_target_status text := upper(nullif(btrim(coalesce(p_status, '')), ''));
  v_current record;
  v_updated_at timestamptz;
  v_message text;
begin
  if p_programming_id is null or v_reason is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_STATUS_PAYLOAD',
      'message', 'Informe a programacao e o motivo da alteracao.'
    );
  end if;

  if v_target_status not in ('ADIADA', 'CANCELADA') then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_PROGRAMMING_STATUS',
      'message', 'Status invalido para a programacao.'
    );
  end if;

  select
    pp.id,
    pp.project_id,
    pp.team_id,
    pp.execution_date,
    pp.start_time,
    pp.end_time,
    pp.etapa_number,
    pp.updated_at,
    pp.status,
    p.sob
  into v_current
  from public.project_programming pp
  join public.project p
    on p.id = pp.project_id
   and p.tenant_id = pp.tenant_id
  where pp.tenant_id = p_tenant_id
    and pp.id = p_programming_id
    and pp.status in ('PROGRAMADA', 'REPROGRAMADA')
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'PROGRAMMING_NOT_FOUND',
      'message', 'Programacao nao encontrada ou nao esta mais ativa na grade.'
    );
  end if;

  if p_expected_updated_at is not null
    and date_trunc('milliseconds', v_current.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'PROGRAMMING_CONFLICT',
      'message', 'Esta programacao foi alterada por outro usuario. Atualize a grade antes de continuar.'
    );
  end if;

  update public.project_programming
  set
    status = v_target_status,
    is_active = false,
    cancellation_reason = v_reason,
    canceled_at = now(),
    canceled_by = p_actor_user_id,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = p_programming_id;

  perform public.append_project_programming_history_record(
    p_tenant_id,
    p_actor_user_id,
    p_programming_id,
    v_current.project_id,
    v_current.team_id,
    null,
    v_target_status,
    v_reason,
    jsonb_build_object(
      'status', jsonb_build_object('from', v_current.status, 'to', v_target_status),
      'isActive', jsonb_build_object('from', 'true', 'to', 'false'),
      'cancellationReason', jsonb_build_object('from', null, 'to', v_reason)
    ),
    jsonb_build_object(
      'action', v_target_status,
      'projectId', v_current.project_id,
      'teamId', v_current.team_id,
      'executionDate', v_current.execution_date
    ),
    v_current.status,
    v_target_status,
    v_current.execution_date,
    v_current.execution_date,
    v_current.team_id,
    v_current.team_id,
    v_current.start_time,
    v_current.start_time,
    v_current.end_time,
    v_current.end_time,
    v_current.etapa_number,
    v_current.etapa_number
  );

  select updated_at
  into v_updated_at
  from public.project_programming
  where tenant_id = p_tenant_id
    and id = p_programming_id;

  v_message := case
    when v_target_status = 'ADIADA' then format('Programacao do projeto %s adiada com sucesso.', v_current.sob)
    else format('Programacao do projeto %s cancelada com sucesso.', v_current.sob)
  end;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'programming_id', p_programming_id,
    'project_code', v_current.sob,
    'updated_at', v_updated_at,
    'programming_status', v_target_status,
    'message', v_message
  );
end;
$$;

revoke all on function public.set_project_programming_status(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz
) from public;

grant execute on function public.set_project_programming_status(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz
) to authenticated;

grant execute on function public.set_project_programming_status(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz
) to service_role;

drop function if exists public.postpone_project_programming(
  uuid,
  uuid,
  uuid,
  date,
  text,
  timestamptz
);

create or replace function public.postpone_project_programming(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_id uuid,
  p_new_execution_date date,
  p_reason text,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_current record;
  v_documents jsonb;
  v_activities jsonb;
  v_save_result jsonb;
  v_new_programming_id uuid;
  v_updated_at timestamptz;
begin
  if p_programming_id is null or v_reason is null or p_new_execution_date is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_POSTPONE_PAYLOAD',
      'message', 'Informe programacao, motivo e nova data para o adiamento.'
    );
  end if;

  select
    pp.*,
    p.sob
  into v_current
  from public.project_programming pp
  join public.project p
    on p.id = pp.project_id
   and p.tenant_id = pp.tenant_id
  where pp.tenant_id = p_tenant_id
    and pp.id = p_programming_id
    and pp.status in ('PROGRAMADA', 'REPROGRAMADA')
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'PROGRAMMING_NOT_FOUND',
      'message', 'Programacao nao encontrada ou nao esta mais ativa para adiamento.'
    );
  end if;

  if p_new_execution_date <= v_current.execution_date then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'NON_FORWARD_EXECUTION_DATE',
      'message', 'Informe uma nova data posterior a data atual da programacao.'
    );
  end if;

  if p_expected_updated_at is not null
    and date_trunc('milliseconds', v_current.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'PROGRAMMING_CONFLICT',
      'message', 'Esta programacao foi alterada por outro usuario. Atualize a grade antes de continuar.'
    );
  end if;

  v_documents := jsonb_build_object(
    'sgd', jsonb_build_object(
      'number', coalesce(v_current.sgd_number, ''),
      'includedAt', coalesce(v_current.sgd_included_at, null),
      'deliveredAt', coalesce(v_current.sgd_delivered_at, null)
    ),
    'pi', jsonb_build_object(
      'number', coalesce(v_current.pi_number, ''),
      'includedAt', coalesce(v_current.pi_included_at, null),
      'deliveredAt', coalesce(v_current.pi_delivered_at, null)
    ),
    'pep', jsonb_build_object(
      'number', coalesce(v_current.pep_number, ''),
      'includedAt', coalesce(v_current.pep_included_at, null),
      'deliveredAt', coalesce(v_current.pep_delivered_at, null)
    )
  );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'catalogId', service_activity_id,
        'quantity', quantity
      )
    ) filter (where is_active = true),
    '[]'::jsonb
  )
  into v_activities
  from public.project_programming_activities
  where tenant_id = p_tenant_id
    and programming_id = p_programming_id;

  v_save_result := public.save_project_programming(
    p_tenant_id,
    p_actor_user_id,
    v_current.project_id,
    v_current.team_id,
    p_new_execution_date,
    v_current.period,
    v_current.start_time,
    v_current.end_time,
    v_current.expected_minutes,
    v_current.feeder,
    v_current.support,
    v_current.note,
    v_documents,
    v_activities,
    null,
    null,
    v_current.support_item_id
  );

  if coalesce((v_save_result ->> 'success')::boolean, false) = false then
    return jsonb_build_object(
      'success', false,
      'status', coalesce((v_save_result ->> 'status')::integer, 400),
      'reason', coalesce(v_save_result ->> 'reason', 'POSTPONE_CREATE_FAILED'),
      'message', coalesce(v_save_result ->> 'message', 'Falha ao criar a nova programacao adiada.')
    );
  end if;

  v_new_programming_id := nullif(v_save_result ->> 'programming_id', '')::uuid;

  if v_new_programming_id is null then
    raise exception '%',
      jsonb_build_object(
        'success', false,
        'status', 500,
        'reason', 'POSTPONE_INVALID_RESULT',
        'message', 'Falha ao recuperar a nova programacao adiada.'
      )::text;
  end if;

  update public.project_programming
  set
    service_description = v_current.service_description,
    poste_qty = coalesce(v_current.poste_qty, 0),
    estrutura_qty = coalesce(v_current.estrutura_qty, 0),
    trafo_qty = coalesce(v_current.trafo_qty, 0),
    rede_qty = coalesce(v_current.rede_qty, 0),
    etapa_number = v_current.etapa_number,
    work_completion_status = null,
    affected_customers = coalesce(v_current.affected_customers, 0),
    sgd_type_id = v_current.sgd_type_id,
    outage_start_time = v_current.outage_start_time,
    outage_end_time = v_current.outage_end_time,
    sgd_included_at = v_current.sgd_included_at,
    sgd_delivered_at = v_current.sgd_delivered_at,
    pi_included_at = v_current.pi_included_at,
    pi_delivered_at = v_current.pi_delivered_at,
    pep_included_at = v_current.pep_included_at,
    pep_delivered_at = v_current.pep_delivered_at,
    status = 'REPROGRAMADA',
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = v_new_programming_id;

  update public.project_programming
  set
    status = 'ADIADA',
    is_active = false,
    cancellation_reason = v_reason,
    canceled_at = now(),
    canceled_by = p_actor_user_id,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = p_programming_id;

  perform public.append_project_programming_history_record(
    p_tenant_id,
    p_actor_user_id,
    p_programming_id,
    v_current.project_id,
    v_current.team_id,
    v_new_programming_id,
    'ADIADA',
    v_reason,
    jsonb_build_object(
      'status', jsonb_build_object('from', v_current.status, 'to', 'ADIADA'),
      'executionDate', jsonb_build_object('from', v_current.execution_date, 'to', p_new_execution_date),
      'isActive', jsonb_build_object('from', 'true', 'to', 'false'),
      'cancellationReason', jsonb_build_object('from', null, 'to', v_reason)
    ),
    jsonb_build_object(
      'action', 'ADIADA',
      'projectId', v_current.project_id,
      'teamId', v_current.team_id,
      'executionDate', v_current.execution_date,
      'newExecutionDate', p_new_execution_date,
      'newProgrammingId', v_new_programming_id
    ),
    v_current.status,
    'ADIADA',
    v_current.execution_date,
    p_new_execution_date,
    v_current.team_id,
    v_current.team_id,
    v_current.start_time,
    v_current.start_time,
    v_current.end_time,
    v_current.end_time,
    v_current.etapa_number,
    v_current.etapa_number
  );

  perform public.append_project_programming_history_record(
    p_tenant_id,
    p_actor_user_id,
    v_new_programming_id,
    v_current.project_id,
    v_current.team_id,
    p_programming_id,
    'CREATE',
    v_reason,
    jsonb_build_object(
      'project', jsonb_build_object('from', null, 'to', coalesce(v_current.sob, v_current.project_id::text)),
      'status', jsonb_build_object('from', null, 'to', 'REPROGRAMADA'),
      'executionDate', jsonb_build_object('from', null, 'to', p_new_execution_date)
    ),
    jsonb_build_object(
      'action', 'CREATE',
      'source', 'programacao-postpone',
      'projectId', v_current.project_id,
      'teamId', v_current.team_id,
      'executionDate', p_new_execution_date,
      'sourceProgrammingId', p_programming_id
    ),
    null,
    'REPROGRAMADA',
    null,
    p_new_execution_date,
    null,
    v_current.team_id,
    null,
    v_current.start_time,
    null,
    v_current.end_time,
    null,
    v_current.etapa_number
  );

  select updated_at
  into v_updated_at
  from public.project_programming
  where tenant_id = p_tenant_id
    and id = p_programming_id;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'programming_id', p_programming_id,
    'new_programming_id', v_new_programming_id,
    'project_code', coalesce(v_current.sob, ''),
    'updated_at', v_updated_at,
    'message', format('Programacao do projeto %s adiada com sucesso. Nova programacao criada para %s.', v_current.sob, to_char(p_new_execution_date, 'DD/MM/YYYY'))
  );
exception
  when others then
    begin
      return nullif(sqlerrm, '')::jsonb;
    exception
      when others then
        return jsonb_build_object(
          'success', false,
          'status', 500,
          'reason', 'POSTPONE_PROGRAMMING_FAILED',
          'message', 'Falha ao adiar programacao.',
          'detail', sqlerrm
        );
    end;
end;
$$;

revoke all on function public.postpone_project_programming(
  uuid,
  uuid,
  uuid,
  date,
  text,
  timestamptz
) from public;

grant execute on function public.postpone_project_programming(
  uuid,
  uuid,
  uuid,
  date,
  text,
  timestamptz
) to authenticated;

grant execute on function public.postpone_project_programming(
  uuid,
  uuid,
  uuid,
  date,
  text,
  timestamptz
) to service_role;

drop function if exists public.copy_team_programming_period(uuid, uuid, uuid, uuid[], date, date);

create or replace function public.copy_team_programming_period(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_source_team_id uuid,
  p_target_team_ids uuid[],
  p_visible_start_date date,
  p_visible_end_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_team record;
  v_target_team record;
  v_source_item public.project_programming%rowtype;
  v_source_project record;
  v_copy_batch_id uuid;
  v_copy_result jsonb;
  v_target_programming_id uuid;
  v_target_team_ids uuid[];
  v_target_team_id uuid;
  v_target_ids_count integer;
  v_copied_count integer := 0;
  v_source_activities jsonb;
  v_conflicting_row record;
  v_structured_error jsonb;
begin
  if p_tenant_id is null
    or p_actor_user_id is null
    or p_source_team_id is null
    or p_visible_start_date is null
    or p_visible_end_date is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_REQUIRED_FIELDS',
      'message', 'Informe tenant, usuario, equipe de origem e periodo visivel.'
    );
  end if;

  if p_visible_start_date > p_visible_end_date then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_PERIOD',
      'message', 'Periodo visivel invalido para a copia da programacao.'
    );
  end if;

  select array_agg(distinct item) filter (where item is not null)
  into v_target_team_ids
  from unnest(coalesce(p_target_team_ids, array[]::uuid[])) as item;

  v_target_ids_count := coalesce(array_length(v_target_team_ids, 1), 0);
  if v_target_ids_count = 0 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'TARGET_TEAM_REQUIRED',
      'message', 'Selecione ao menos uma equipe de destino para copiar a programacao.'
    );
  end if;

  select
    t.id,
    t.name,
    t.service_center_id
  into v_source_team
  from public.teams t
  where t.tenant_id = p_tenant_id
    and t.id = p_source_team_id
    and t.ativo = true;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'SOURCE_TEAM_NOT_FOUND',
      'message', 'Equipe de origem nao encontrada ou inativa.'
    );
  end if;

  if not exists (
    select 1
    from public.project_programming pp
    where pp.tenant_id = p_tenant_id
      and pp.team_id = p_source_team_id
      and pp.status in ('PROGRAMADA', 'REPROGRAMADA')
      and pp.execution_date between p_visible_start_date and p_visible_end_date
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'SOURCE_TEAM_HAS_NO_PROGRAMMING',
      'message', 'A equipe de origem nao possui programacoes ativas no periodo visivel.'
    );
  end if;

  insert into public.project_programming_copy_batches (
    tenant_id,
    project_id,
    source_programming_id,
    source_team_id,
    copy_mode,
    visible_start_date,
    visible_end_date,
    created_by,
    updated_by
  )
  values (
    p_tenant_id,
    null,
    null,
    p_source_team_id,
    'team_period',
    p_visible_start_date,
    p_visible_end_date,
    p_actor_user_id,
    p_actor_user_id
  )
  returning id into v_copy_batch_id;

  for v_source_item in
    select *
    from public.project_programming pp
    where pp.tenant_id = p_tenant_id
      and pp.team_id = p_source_team_id
      and pp.status in ('PROGRAMADA', 'REPROGRAMADA')
      and pp.execution_date between p_visible_start_date and p_visible_end_date
    order by pp.execution_date asc, pp.start_time asc
  loop
    select p.id, p.sob, p.service_center
    into v_source_project
    from public.project p
    where p.tenant_id = p_tenant_id
      and p.id = v_source_item.project_id
      and p.is_active = true;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'catalogId', ppa.service_activity_id,
          'quantity', ppa.quantity
        )
        order by ppa.created_at, ppa.id
      ),
      '[]'::jsonb
    )
    into v_source_activities
    from public.project_programming_activities ppa
    where ppa.tenant_id = p_tenant_id
      and ppa.programming_id = v_source_item.id
      and ppa.is_active = true;

    foreach v_target_team_id in array v_target_team_ids loop
      if v_target_team_id = p_source_team_id then
        return jsonb_build_object(
          'success', false,
          'status', 400,
          'reason', 'TARGET_EQUALS_SOURCE',
          'message', 'Nao e permitido copiar para a mesma equipe de origem.'
        );
      end if;

      select t.id, t.name, t.service_center_id
      into v_target_team
      from public.teams t
      where t.tenant_id = p_tenant_id
        and t.id = v_target_team_id
        and t.ativo = true;

      if not found then
        return jsonb_build_object(
          'success', false,
          'status', 404,
          'reason', 'TARGET_TEAM_NOT_FOUND',
          'message', 'Uma das equipes de destino nao existe ou esta inativa.'
        );
      end if;

      if v_target_team.service_center_id <> v_source_project.service_center then
        return jsonb_build_object(
          'success', false,
          'status', 409,
          'reason', 'TEAM_SERVICE_CENTER_MISMATCH',
          'message', format(
            'A equipe %s nao pertence a mesma base da obra %s e nao pode receber a copia.',
            coalesce(v_target_team.name, v_target_team_id::text),
            coalesce(v_source_project.sob, v_source_item.project_id::text)
          )
        );
      end if;

      select pp.id
      into v_conflicting_row
      from public.project_programming pp
      where pp.tenant_id = p_tenant_id
        and pp.team_id = v_target_team_id
        and pp.status in ('PROGRAMADA', 'REPROGRAMADA')
        and pp.execution_date = v_source_item.execution_date
        and (
          pp.project_id = v_source_item.project_id
          or (v_source_item.start_time < pp.end_time and pp.start_time < v_source_item.end_time)
        )
      limit 1;

      if found then
        return jsonb_build_object(
          'success', false,
          'status', 409,
          'reason', 'TARGET_TEAM_CONFLICT',
          'message', format(
            'A equipe %s ja possui programacao conflitante em %s.',
            coalesce(v_target_team.name, v_target_team_id::text),
            to_char(v_source_item.execution_date, 'DD/MM/YYYY')
          )
        );
      end if;

      v_copy_result := public.save_project_programming_full(
        p_tenant_id,
        p_actor_user_id,
        v_source_item.project_id,
        v_target_team_id,
        v_source_item.execution_date,
        v_source_item.period,
        v_source_item.start_time,
        v_source_item.end_time,
        v_source_item.expected_minutes,
        v_source_item.feeder,
        v_source_item.support,
        v_source_item.note,
        jsonb_build_object(
          'sgd', jsonb_build_object(
            'number', coalesce(v_source_item.sgd_number, ''),
            'approvedAt', coalesce(v_source_item.sgd_included_at::text, ''),
            'requestedAt', coalesce(v_source_item.sgd_delivered_at::text, ''),
            'includedAt', coalesce(v_source_item.sgd_included_at::text, ''),
            'deliveredAt', coalesce(v_source_item.sgd_delivered_at::text, '')
          ),
          'pi', jsonb_build_object(
            'number', coalesce(v_source_item.pi_number, ''),
            'approvedAt', coalesce(v_source_item.pi_included_at::text, ''),
            'requestedAt', coalesce(v_source_item.pi_delivered_at::text, ''),
            'includedAt', coalesce(v_source_item.pi_included_at::text, ''),
            'deliveredAt', coalesce(v_source_item.pi_delivered_at::text, '')
          ),
          'pep', jsonb_build_object(
            'number', coalesce(v_source_item.pep_number, ''),
            'approvedAt', coalesce(v_source_item.pep_included_at::text, ''),
            'requestedAt', coalesce(v_source_item.pep_delivered_at::text, ''),
            'includedAt', coalesce(v_source_item.pep_included_at::text, ''),
            'deliveredAt', coalesce(v_source_item.pep_delivered_at::text, '')
          )
        ),
        v_source_activities,
        null,
        null,
        v_source_item.support_item_id,
        coalesce(v_source_item.poste_qty, 0),
        coalesce(v_source_item.estrutura_qty, 0),
        coalesce(v_source_item.trafo_qty, 0),
        coalesce(v_source_item.rede_qty, 0),
        coalesce(v_source_item.affected_customers, 0),
        v_source_item.sgd_type_id,
        v_source_item.outage_start_time,
        v_source_item.outage_end_time,
        v_source_item.service_description,
        v_source_item.etapa_number,
        v_source_item.work_completion_status
      );

      if coalesce((v_copy_result ->> 'success')::boolean, false) = false then
        raise exception '%',
          jsonb_build_object(
            'success', false,
            'status', coalesce((v_copy_result ->> 'status')::integer, 400),
            'reason', coalesce(v_copy_result ->> 'reason', 'COPY_FAILED'),
            'message', coalesce(v_copy_result ->> 'message', 'Falha ao copiar programacao para uma das equipes.')
          )::text;
      end if;

      v_target_programming_id := (v_copy_result ->> 'programming_id')::uuid;

      update public.project_programming
      set copied_from_programming_id = v_source_item.id,
          copy_batch_id = v_copy_batch_id,
          status = case when v_source_item.status = 'REPROGRAMADA' then 'REPROGRAMADA' else status end,
          updated_by = p_actor_user_id
      where tenant_id = p_tenant_id
        and id = v_target_programming_id;

      insert into public.project_programming_copy_batch_items (
        tenant_id,
        copy_batch_id,
        source_programming_id,
        target_programming_id,
        target_team_id,
        created_by,
        updated_by
      )
      values (
        p_tenant_id,
        v_copy_batch_id,
        v_source_item.id,
        v_target_programming_id,
        v_target_team_id,
        p_actor_user_id,
        p_actor_user_id
      );

      perform public.append_project_programming_history_record(
        p_tenant_id,
        p_actor_user_id,
        v_target_programming_id,
        v_source_item.project_id,
        v_target_team_id,
        v_source_item.id,
        'COPY',
        null,
        jsonb_build_object(
          'copiedFromProgrammingId', jsonb_build_object('from', null, 'to', v_source_item.id),
          'executionDate', jsonb_build_object('from', null, 'to', v_source_item.execution_date),
          'status', jsonb_build_object('from', null, 'to', case when v_source_item.status = 'REPROGRAMADA' then 'REPROGRAMADA' else 'PROGRAMADA' end)
        ),
        jsonb_build_object(
          'action', 'COPY',
          'copyBatchId', v_copy_batch_id,
          'copyMode', 'team_period',
          'sourceProgrammingId', v_source_item.id,
          'sourceTeamId', p_source_team_id,
          'targetTeamId', v_target_team_id
        ),
        null,
        case when v_source_item.status = 'REPROGRAMADA' then 'REPROGRAMADA' else 'PROGRAMADA' end,
        null,
        v_source_item.execution_date,
        null,
        v_target_team_id,
        null,
        v_source_item.start_time,
        null,
        v_source_item.end_time,
        null,
        v_source_item.etapa_number
      );

      v_copied_count := v_copied_count + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'copy_batch_id', v_copy_batch_id,
    'copied_count', v_copied_count,
    'message', case
      when v_copied_count = 1 then 'Programacao copiada com sucesso para 1 equipe.'
      else format('Programacao copiada com sucesso para %s equipes.', v_copied_count)
    end
  );
exception
  when others then
    begin
      v_structured_error := nullif(sqlerrm, '')::jsonb;
      return jsonb_build_object(
        'success', false,
        'status', coalesce((v_structured_error ->> 'status')::integer, 500),
        'reason', coalesce(v_structured_error ->> 'reason', 'COPY_FAILED'),
        'message', coalesce(v_structured_error ->> 'message', 'Falha ao copiar programacao entre equipes.')
      );
    exception
      when others then
        return jsonb_build_object(
          'success', false,
          'status', 500,
          'reason', 'COPY_FAILED',
          'message', 'Falha ao copiar programacao entre equipes.'
        );
    end;
end;
$$;

revoke all on function public.copy_team_programming_period(uuid, uuid, uuid, uuid[], date, date) from public;
grant execute on function public.copy_team_programming_period(uuid, uuid, uuid, uuid[], date, date) to authenticated;
grant execute on function public.copy_team_programming_period(uuid, uuid, uuid, uuid[], date, date) to service_role;

create or replace function public.get_programming_week_summary(
  p_tenant_id uuid,
  p_week_start date
)
returns table (
  team_id uuid,
  week_start date,
  week_end date,
  worked_days integer,
  capacity_days integer,
  free_days integer,
  load_percent integer,
  load_status text
)
language sql
security definer
set search_path = public
as $$
  with scoped_teams as (
    select t.id as team_id
    from public.teams t
    where t.tenant_id = p_tenant_id
      and t.ativo = true
  ),
  worked as (
    select
      pp.team_id,
      count(distinct pp.execution_date)::integer as worked_days
    from public.project_programming pp
    where pp.tenant_id = p_tenant_id
      and pp.status in ('PROGRAMADA', 'REPROGRAMADA')
      and pp.execution_date >= p_week_start
      and pp.execution_date <= (p_week_start + 6)
    group by pp.team_id
  )
  select
    st.team_id,
    p_week_start as week_start,
    (p_week_start + 6) as week_end,
    coalesce(w.worked_days, 0) as worked_days,
    5 as capacity_days,
    greatest(5 - coalesce(w.worked_days, 0), 0) as free_days,
    case
      when coalesce(w.worked_days, 0) <= 0 then 0
      else round((coalesce(w.worked_days, 0)::numeric / 5::numeric) * 100)::integer
    end as load_percent,
    case
      when coalesce(w.worked_days, 0) >= 7 then 'OVERLOAD'
      when coalesce(w.worked_days, 0) = 6 then 'WARNING'
      when coalesce(w.worked_days, 0) >= 1 then 'NORMAL'
      else 'FREE'
    end as load_status
  from scoped_teams st
  left join worked w
    on w.team_id = st.team_id
  order by st.team_id;
$$;

revoke all on function public.get_programming_week_summary(uuid, date) from public;
grant execute on function public.get_programming_week_summary(uuid, date) to authenticated;
grant execute on function public.get_programming_week_summary(uuid, date) to service_role;
