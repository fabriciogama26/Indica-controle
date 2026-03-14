-- 071_programming_week_summary_and_support_catalog.sql
-- Move resumo semanal de carga para o banco e vincula apoio da Programacao ao catalogo de apoio da Locacao.

alter table if exists public.project_programming
  add column if not exists support_item_id uuid references public.location_execution_support_items(id);

create index if not exists idx_project_programming_tenant_support_item
  on public.project_programming (tenant_id, support_item_id);

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
  timestamptz
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
    from public.location_execution_support_items
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
      and pp.status = 'PROGRAMADA'
    for update;

    if not found then
      return jsonb_build_object(
        'success', false,
        'status', 404,
        'reason', 'PROGRAMMING_NOT_FOUND',
        'message', 'Programacao nao encontrada.'
      );
    end if;

    v_current_updated_at := v_current.updated_at;
    if p_expected_updated_at is not null
      and date_trunc('milliseconds', v_current_updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'PROGRAMMING_CONFLICT',
        'message', 'Esta programacao foi alterada por outro usuario. Atualize a grade antes de salvar.'
      );
    end if;
  end if;

  perform 1
  from public.project_programming pp
  where pp.tenant_id = p_tenant_id
    and pp.team_id = p_team_id
    and pp.execution_date = p_execution_date
    and pp.status = 'PROGRAMADA'
    and (p_programming_id is null or pp.id <> p_programming_id)
  for update;

  select
    pp.id,
    p.sob
  into v_conflict_id, v_conflict_project_code
  from public.project_programming pp
  join public.project p
    on p.id = pp.project_id
   and p.tenant_id = pp.tenant_id
  where pp.tenant_id = p_tenant_id
    and pp.team_id = p_team_id
    and pp.execution_date = p_execution_date
    and pp.status = 'PROGRAMADA'
    and (p_programming_id is null or pp.id <> p_programming_id)
    and p_start_time < pp.end_time
    and p_end_time > pp.start_time
  limit 1;

  if v_conflict_id is not null then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'TEAM_SCHEDULE_OVERLAP',
      'message', format(
        'A equipe %s ja possui uma programacao sobreposta na data informada para a obra %s.',
        v_team.name,
        coalesce(v_conflict_project_code, 'Nao identificada')
      )
    );
  end if;

  v_sgd_number := nullif(btrim(coalesce(v_sgd ->> 'number', '')), '');
  v_sgd_delivered_at := case
    when nullif(btrim(coalesce(v_sgd ->> 'deliveredAt', '')), '') ~ '^\d{4}-\d{2}-\d{2}$'
      then (v_sgd ->> 'deliveredAt')::date
    else null
  end;
  v_sgd_included_at := case
    when v_sgd_number is null then null
    when p_programming_id is not null
      and v_current.sgd_number is not null
      and btrim(v_current.sgd_number) = v_sgd_number
      and v_current.sgd_included_at is not null then v_current.sgd_included_at
    else v_today
  end;

  v_pi_number := nullif(btrim(coalesce(v_pi ->> 'number', '')), '');
  v_pi_delivered_at := case
    when nullif(btrim(coalesce(v_pi ->> 'deliveredAt', '')), '') ~ '^\d{4}-\d{2}-\d{2}$'
      then (v_pi ->> 'deliveredAt')::date
    else null
  end;
  v_pi_included_at := case
    when v_pi_number is null then null
    when p_programming_id is not null
      and v_current.pi_number is not null
      and btrim(v_current.pi_number) = v_pi_number
      and v_current.pi_included_at is not null then v_current.pi_included_at
    else v_today
  end;

  v_pep_number := nullif(btrim(coalesce(v_pep ->> 'number', '')), '');
  v_pep_delivered_at := case
    when nullif(btrim(coalesce(v_pep ->> 'deliveredAt', '')), '') ~ '^\d{4}-\d{2}-\d{2}$'
      then (v_pep ->> 'deliveredAt')::date
    else null
  end;
  v_pep_included_at := case
    when v_pep_number is null then null
    when p_programming_id is not null
      and v_current.pep_number is not null
      and btrim(v_current.pep_number) = v_pep_number
      and v_current.pep_included_at is not null then v_current.pep_included_at
    else v_today
  end;

  if p_programming_id is null then
    begin
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
        support_item_id,
        support,
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
        is_active,
        status,
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
        v_support_item_id,
        v_support,
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
        true,
        'PROGRAMADA',
        p_actor_user_id,
        p_actor_user_id
      )
      returning id into v_programming_id;
    exception
      when unique_violation then
        return jsonb_build_object(
          'success', false,
          'status', 409,
          'reason', 'PROGRAMMING_ALREADY_EXISTS',
          'message', 'Ja existe programacao para este projeto, equipe e data.'
        );
    end;

    v_action := 'INSERT';
  else
    update public.project_programming
    set
      project_id = p_project_id,
      team_id = p_team_id,
      execution_date = p_execution_date,
      period = upper(btrim(p_period)),
      start_time = p_start_time,
      end_time = p_end_time,
      expected_minutes = p_expected_minutes,
      feeder = v_feeder,
      support_item_id = v_support_item_id,
      support = v_support,
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
      is_active = true,
      status = 'PROGRAMADA',
      cancellation_reason = null,
      canceled_at = null,
      canceled_by = null,
      updated_by = p_actor_user_id
    where tenant_id = p_tenant_id
      and id = p_programming_id;

    v_programming_id := p_programming_id;
    v_action := 'UPDATE';
  end if;

  for v_activity in
    select value
    from jsonb_array_elements(coalesce(p_activities, '[]'::jsonb))
  loop
    v_activity_id_text := nullif(btrim(coalesce(v_activity ->> 'catalogId', '')), '');
    if v_activity_id_text is null then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'MISSING_ACTIVITY_ID',
        'message', 'Atividade invalida na programacao.'
      );
    end if;

    begin
      v_activity_id := v_activity_id_text::uuid;
    exception
      when others then
        return jsonb_build_object(
          'success', false,
          'status', 400,
          'reason', 'INVALID_ACTIVITY_ID',
          'message', 'Atividade invalida na programacao.'
        );
    end;

    begin
      v_activity_qty := nullif(btrim(coalesce(v_activity ->> 'quantity', '')), '')::numeric;
    exception
      when others then
        return jsonb_build_object(
          'success', false,
          'status', 400,
          'reason', 'INVALID_ACTIVITY_QUANTITY',
          'message', 'Quantidade invalida para atividade da programacao.'
        );
    end;

    if v_activity_qty is null or v_activity_qty <= 0 then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'INVALID_ACTIVITY_QUANTITY',
        'message', 'Quantidade invalida para atividade da programacao.'
      );
    end if;

    select
      sa.id,
      sa.code,
      sa.description,
      sa.unit
    into v_activity_row
    from public.service_activities sa
    where sa.tenant_id = p_tenant_id
      and sa.id = v_activity_id
      and sa.ativo = true;

    if not found then
      return jsonb_build_object(
        'success', false,
        'status', 404,
        'reason', 'ACTIVITY_NOT_FOUND',
        'message', 'Atividade invalida para o tenant atual.'
      );
    end if;

    if exists (
      select 1
      from public.project_programming_activities ppa
      where ppa.tenant_id = p_tenant_id
        and ppa.programming_id = v_programming_id
        and ppa.service_activity_id = v_activity_id
    ) then
      update public.project_programming_activities
      set
        activity_code = v_activity_row.code,
        activity_description = v_activity_row.description,
        activity_unit = v_activity_row.unit,
        quantity = v_activity_qty,
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

    v_activity_ids := array_append(v_activity_ids, v_activity_id);
  end loop;

  update public.project_programming_activities
  set
    is_active = false,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and programming_id = v_programming_id
    and is_active = true
    and (
      array_length(v_activity_ids, 1) is null
      or service_activity_id <> all(v_activity_ids)
    );

  select updated_at
  into v_current_updated_at
  from public.project_programming
  where tenant_id = p_tenant_id
    and id = v_programming_id;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'action', v_action,
    'programming_id', v_programming_id,
    'project_code', v_project.sob,
    'updated_at', v_current_updated_at,
    'message',
      case
        when v_action = 'INSERT' then format('Programacao do projeto %s registrada com sucesso.', v_project.sob)
        else format('Programacao do projeto %s atualizada com sucesso.', v_project.sob)
      end
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

drop function if exists public.get_programming_week_summary(uuid, date);

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
    select
      t.id as team_id
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
      and pp.status = 'PROGRAMADA'
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
