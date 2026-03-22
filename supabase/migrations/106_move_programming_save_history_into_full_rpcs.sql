-- 106_move_programming_save_history_into_full_rpcs.sql
-- Move o historico operacional de CREATE/UPDATE/RESCHEDULE/BATCH_CREATE
-- para dentro das RPCs transacionais full da Programacao.

drop function if exists public.save_project_programming_full(
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
  uuid,
  integer,
  integer,
  integer,
  integer,
  integer,
  uuid,
  time,
  time,
  text,
  integer,
  text,
  text,
  text,
  jsonb
);

drop function if exists public.save_project_programming_full(
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
  uuid,
  integer,
  integer,
  integer,
  integer,
  integer,
  uuid,
  time,
  time,
  text,
  integer,
  text
);

drop function if exists public.save_project_programming_full(
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
  uuid,
  integer,
  integer,
  integer,
  integer,
  integer,
  uuid,
  time,
  time,
  text
);

create or replace function public.save_project_programming_full(
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
  p_support_item_id uuid default null,
  p_poste_qty integer default 0,
  p_estrutura_qty integer default 0,
  p_trafo_qty integer default 0,
  p_rede_qty integer default 0,
  p_affected_customers integer default 0,
  p_sgd_type_id uuid default null,
  p_outage_start_time time default null,
  p_outage_end_time time default null,
  p_service_description text default null,
  p_etapa_number integer default null,
  p_work_completion_status text default null,
  p_history_action_override text default null,
  p_history_reason text default null,
  p_history_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_save_result jsonb;
  v_programming_id uuid;
  v_project_code text;
  v_action text;
  v_message text;
  v_updated_at timestamptz;
  v_structure_result jsonb;
  v_outage_result jsonb;
  v_enel_result jsonb;
  v_documents_result jsonb;
  v_execution_result jsonb;
  v_history_result jsonb;
  v_structured_error jsonb;
  v_service_description text := nullif(btrim(coalesce(p_service_description, '')), '');
  v_previous_programming public.project_programming%rowtype;
  v_next_programming public.project_programming%rowtype;
  v_previous_team_name text;
  v_next_team_name text;
  v_previous_sgd_type_description text;
  v_next_sgd_type_description text;
  v_previous_activities jsonb := '[]'::jsonb;
  v_next_activities jsonb := '[]'::jsonb;
  v_previous_activities_text text := '[]';
  v_next_activities_text text := '[]';
  v_history_action text;
  v_history_reason text := nullif(btrim(coalesce(p_history_reason, '')), '');
  v_history_metadata jsonb := coalesce(p_history_metadata, '{}'::jsonb);
  v_changes jsonb := '{}'::jsonb;
  v_is_reschedule boolean := false;
  v_should_write_history boolean := false;
begin
  if p_programming_id is not null then
    select *
    into v_previous_programming
    from public.project_programming
    where tenant_id = p_tenant_id
      and id = p_programming_id;

    if found then
      v_is_reschedule :=
        v_previous_programming.execution_date is distinct from p_execution_date
        or v_previous_programming.team_id is distinct from p_team_id
        or v_previous_programming.start_time is distinct from p_start_time
        or v_previous_programming.end_time is distinct from p_end_time;

      select t.name
      into v_previous_team_name
      from public.teams t
      where t.tenant_id = p_tenant_id
        and t.id = v_previous_programming.team_id;

      select s.description
      into v_previous_sgd_type_description
      from public.programming_sgd_types s
      where s.tenant_id = p_tenant_id
        and s.id = v_previous_programming.sgd_type_id;

      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'code', coalesce(sa.code, ''),
            'quantity', round(coalesce(ppa.quantity, 0)::numeric, 2)
          )
          order by sa.code
        ),
        '[]'::jsonb
      )
      into v_previous_activities
      from public.project_programming_activities ppa
      join public.service_activities sa
        on sa.tenant_id = ppa.tenant_id
       and sa.id = ppa.service_activity_id
      where ppa.tenant_id = p_tenant_id
        and ppa.programming_id = p_programming_id
        and ppa.is_active = true;
    end if;
  end if;

  if p_tenant_id is null
    or p_actor_user_id is null
    or p_project_id is null
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

  if nullif(btrim(coalesce(p_feeder, '')), '') ~ '^-\d+([.,]\d+)?$' then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_FEEDER',
      'message', 'Alimentador nao pode receber valor negativo.'
    );
  end if;

  if coalesce(p_poste_qty, 0) < 0
    or coalesce(p_estrutura_qty, 0) < 0
    or coalesce(p_trafo_qty, 0) < 0
    or coalesce(p_rede_qty, 0) < 0 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_STRUCTURE_QTY',
      'message', 'POSTE, ESTRUTURA, TRAFO e REDE devem ser maiores ou iguais a zero.'
    );
  end if;

  if coalesce(p_affected_customers, 0) < 0 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_AFFECTED_CUSTOMERS',
      'message', 'Numero de clientes afetados deve ser maior ou igual a zero.'
    );
  end if;

  v_save_result := public.save_project_programming(
    p_tenant_id,
    p_actor_user_id,
    p_project_id,
    p_team_id,
    p_execution_date,
    p_period,
    p_start_time,
    p_end_time,
    p_expected_minutes,
    p_feeder,
    p_support,
    p_note,
    p_documents,
    p_activities,
    p_programming_id,
    p_expected_updated_at,
    p_support_item_id
  );

  if coalesce((v_save_result ->> 'success')::boolean, false) = false then
    return jsonb_build_object(
      'success', false,
      'status', coalesce((v_save_result ->> 'status')::integer, 400),
      'reason', coalesce(v_save_result ->> 'reason', 'SAVE_PROGRAMMING_FAILED'),
      'message', coalesce(v_save_result ->> 'message', 'Falha ao salvar programacao.')
    );
  end if;

  v_programming_id := nullif(v_save_result ->> 'programming_id', '')::uuid;
  v_project_code := coalesce(v_save_result ->> 'project_code', '');
  v_action := coalesce(v_save_result ->> 'action', 'UPDATE');
  v_message := coalesce(v_save_result ->> 'message', 'Programacao salva com sucesso.');

  if v_programming_id is null then
    raise exception '%',
      jsonb_build_object(
        'success', false,
        'status', 500,
        'reason', 'SAVE_PROGRAMMING_INVALID_RESULT',
        'message', 'Falha ao recuperar o ID da programacao salva.'
      )::text;
  end if;

  v_structure_result := public.set_project_programming_structure_quantities(
    p_tenant_id,
    p_actor_user_id,
    v_programming_id,
    coalesce(p_poste_qty, 0),
    coalesce(p_estrutura_qty, 0),
    coalesce(p_trafo_qty, 0),
    coalesce(p_rede_qty, 0)
  );

  if coalesce((v_structure_result ->> 'success')::boolean, false) = false then
    raise exception '%',
      jsonb_build_object(
        'success', false,
        'status', coalesce((v_structure_result ->> 'status')::integer, 400),
        'reason', coalesce(v_structure_result ->> 'reason', 'SET_STRUCTURE_FAILED'),
        'message', coalesce(v_structure_result ->> 'message', 'Falha ao salvar os campos estruturais da programacao.')
      )::text;
  end if;

  v_outage_result := public.set_project_programming_outage_window(
    p_tenant_id,
    p_actor_user_id,
    v_programming_id,
    p_outage_start_time,
    p_outage_end_time
  );

  if coalesce((v_outage_result ->> 'success')::boolean, false) = false then
    raise exception '%',
      jsonb_build_object(
        'success', false,
        'status', coalesce((v_outage_result ->> 'status')::integer, 400),
        'reason', coalesce(v_outage_result ->> 'reason', 'SET_OUTAGE_WINDOW_FAILED'),
        'message', coalesce(v_outage_result ->> 'message', 'Falha ao salvar janela de desligamento da programacao.')
      )::text;
  end if;

  update public.project_programming
  set
    service_description = v_service_description,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = v_programming_id;

  v_enel_result := public.set_project_programming_enel_fields(
    p_tenant_id,
    p_actor_user_id,
    v_programming_id,
    coalesce(p_affected_customers, 0),
    p_sgd_type_id
  );

  if coalesce((v_enel_result ->> 'success')::boolean, false) = false then
    raise exception '%',
      jsonb_build_object(
        'success', false,
        'status', coalesce((v_enel_result ->> 'status')::integer, 400),
        'reason', coalesce(v_enel_result ->> 'reason', 'SET_ENEL_FIELDS_FAILED'),
        'message', coalesce(v_enel_result ->> 'message', 'Falha ao salvar campos ENEL da programacao.')
      )::text;
  end if;

  v_documents_result := public.set_project_programming_document_dates(
    p_tenant_id,
    p_actor_user_id,
    v_programming_id,
    coalesce(p_documents, '{}'::jsonb)
  );

  if coalesce((v_documents_result ->> 'success')::boolean, false) = false then
    raise exception '%',
      jsonb_build_object(
        'success', false,
        'status', coalesce((v_documents_result ->> 'status')::integer, 400),
        'reason', coalesce(v_documents_result ->> 'reason', 'SET_DOCUMENT_DATES_FAILED'),
        'message', coalesce(v_documents_result ->> 'message', 'Falha ao salvar datas dos documentos da programacao.')
      )::text;
  end if;

  v_execution_result := public.set_project_programming_execution_result(
    p_tenant_id,
    p_actor_user_id,
    v_programming_id,
    p_etapa_number,
    p_work_completion_status
  );

  if coalesce((v_execution_result ->> 'success')::boolean, false) = false then
    raise exception '%',
      jsonb_build_object(
        'success', false,
        'status', coalesce((v_execution_result ->> 'status')::integer, 400),
        'reason', coalesce(v_execution_result ->> 'reason', 'SET_EXECUTION_RESULT_FAILED'),
        'message', coalesce(v_execution_result ->> 'message', 'Falha ao salvar ETAPA/Estado Trabalho da programacao.')
      )::text;
  end if;

  select *
  into v_next_programming
  from public.project_programming pp
  where pp.tenant_id = p_tenant_id
    and pp.id = v_programming_id;

  if not found then
    raise exception '%',
      jsonb_build_object(
        'success', false,
        'status', 404,
        'reason', 'PROGRAMMING_NOT_FOUND',
        'message', 'Programacao nao encontrada apos o salvamento transacional.'
      )::text;
  end if;

  v_updated_at := v_next_programming.updated_at;

  select t.name
  into v_next_team_name
  from public.teams t
  where t.tenant_id = p_tenant_id
    and t.id = v_next_programming.team_id;

  select s.description
  into v_next_sgd_type_description
  from public.programming_sgd_types s
  where s.tenant_id = p_tenant_id
    and s.id = v_next_programming.sgd_type_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'code', coalesce(sa.code, ''),
        'quantity', round(coalesce(ppa.quantity, 0)::numeric, 2)
      )
      order by sa.code
    ),
    '[]'::jsonb
  )
  into v_next_activities
  from public.project_programming_activities ppa
  join public.service_activities sa
    on sa.tenant_id = ppa.tenant_id
   and sa.id = ppa.service_activity_id
  where ppa.tenant_id = p_tenant_id
    and ppa.programming_id = v_programming_id
    and ppa.is_active = true;

  v_previous_activities_text := coalesce(v_previous_activities::text, '[]');
  v_next_activities_text := coalesce(v_next_activities::text, '[]');

  v_history_action := upper(
    coalesce(
      nullif(btrim(coalesce(p_history_action_override, '')), ''),
      case
        when v_action = 'INSERT' then 'CREATE'
        when v_is_reschedule then 'RESCHEDULE'
        else 'UPDATE'
      end
    )
  );

  v_history_metadata := jsonb_strip_nulls(
    v_history_metadata
    || jsonb_build_object(
      'action', v_history_action,
      'projectId', p_project_id,
      'teamId', v_next_programming.team_id,
      'executionDate', v_next_programming.execution_date
    )
  );

  if v_history_action in ('CREATE', 'BATCH_CREATE') then
    v_changes := v_changes || jsonb_build_object('project', jsonb_build_object('from', null, 'to', nullif(v_project_code, '')));
  end if;

  if v_history_action in ('CREATE', 'BATCH_CREATE') or nullif(v_previous_team_name, '') is distinct from nullif(v_next_team_name, '') then
    v_changes := v_changes || jsonb_build_object('team', jsonb_build_object('from', nullif(v_previous_team_name, ''), 'to', nullif(v_next_team_name, '')));
  end if;

  if v_history_action in ('CREATE', 'BATCH_CREATE') or v_previous_programming.execution_date is distinct from v_next_programming.execution_date then
    v_changes := v_changes || jsonb_build_object('executionDate', jsonb_build_object('from', case when v_previous_programming.id is null then null else v_previous_programming.execution_date::text end, 'to', v_next_programming.execution_date::text));
  end if;

  if v_history_action in ('CREATE', 'BATCH_CREATE') or v_previous_programming.period is distinct from v_next_programming.period then
    v_changes := v_changes || jsonb_build_object('period', jsonb_build_object('from', case when v_previous_programming.id is null then null else v_previous_programming.period end, 'to', v_next_programming.period));
  end if;

  if v_history_action in ('CREATE', 'BATCH_CREATE') or v_previous_programming.start_time is distinct from v_next_programming.start_time then
    v_changes := v_changes || jsonb_build_object('startTime', jsonb_build_object('from', case when v_previous_programming.id is null then null else v_previous_programming.start_time::text end, 'to', v_next_programming.start_time::text));
  end if;

  if v_history_action in ('CREATE', 'BATCH_CREATE') or v_previous_programming.end_time is distinct from v_next_programming.end_time then
    v_changes := v_changes || jsonb_build_object('endTime', jsonb_build_object('from', case when v_previous_programming.id is null then null else v_previous_programming.end_time::text end, 'to', v_next_programming.end_time::text));
  end if;

  if v_history_action in ('CREATE', 'BATCH_CREATE') or v_previous_programming.outage_start_time is distinct from v_next_programming.outage_start_time then
    v_changes := v_changes || jsonb_build_object('outageStartTime', jsonb_build_object('from', case when v_previous_programming.id is null or v_previous_programming.outage_start_time is null then null else v_previous_programming.outage_start_time::text end, 'to', case when v_next_programming.outage_start_time is null then null else v_next_programming.outage_start_time::text end));
  end if;

  if v_history_action in ('CREATE', 'BATCH_CREATE') or v_previous_programming.outage_end_time is distinct from v_next_programming.outage_end_time then
    v_changes := v_changes || jsonb_build_object('outageEndTime', jsonb_build_object('from', case when v_previous_programming.id is null or v_previous_programming.outage_end_time is null then null else v_previous_programming.outage_end_time::text end, 'to', case when v_next_programming.outage_end_time is null then null else v_next_programming.outage_end_time::text end));
  end if;

  if v_history_action in ('CREATE', 'BATCH_CREATE') or v_previous_programming.expected_minutes is distinct from v_next_programming.expected_minutes then
    v_changes := v_changes || jsonb_build_object('expectedMinutes', jsonb_build_object('from', case when v_previous_programming.id is null or v_previous_programming.expected_minutes is null then null else v_previous_programming.expected_minutes::text end, 'to', case when v_next_programming.expected_minutes is null then null else v_next_programming.expected_minutes::text end));
  end if;

  if v_history_action in ('CREATE', 'BATCH_CREATE') or nullif(v_previous_programming.feeder, '') is distinct from nullif(v_next_programming.feeder, '') then
    v_changes := v_changes || jsonb_build_object('feeder', jsonb_build_object('from', nullif(v_previous_programming.feeder, ''), 'to', nullif(v_next_programming.feeder, '')));
  end if;

  if v_history_action in ('CREATE', 'BATCH_CREATE') or nullif(v_previous_programming.support, '') is distinct from nullif(v_next_programming.support, '') then
    v_changes := v_changes || jsonb_build_object('support', jsonb_build_object('from', nullif(v_previous_programming.support, ''), 'to', nullif(v_next_programming.support, '')));
  end if;

  if v_history_action in ('CREATE', 'BATCH_CREATE') or nullif(v_previous_programming.note, '') is distinct from nullif(v_next_programming.note, '') then
    v_changes := v_changes || jsonb_build_object('note', jsonb_build_object('from', nullif(v_previous_programming.note, ''), 'to', nullif(v_next_programming.note, '')));
  end if;

  if v_history_action in ('CREATE', 'BATCH_CREATE') or nullif(v_previous_programming.service_description, '') is distinct from nullif(v_next_programming.service_description, '') then
    v_changes := v_changes || jsonb_build_object('serviceDescription', jsonb_build_object('from', nullif(v_previous_programming.service_description, ''), 'to', nullif(v_next_programming.service_description, '')));
  end if;

  if v_history_action in ('CREATE', 'BATCH_CREATE') or v_previous_programming.poste_qty is distinct from v_next_programming.poste_qty then
    v_changes := v_changes || jsonb_build_object('posteQty', jsonb_build_object('from', case when v_previous_programming.id is null or v_previous_programming.poste_qty is null then null else v_previous_programming.poste_qty::text end, 'to', case when v_next_programming.poste_qty is null then null else v_next_programming.poste_qty::text end));
  end if;

  if v_history_action in ('CREATE', 'BATCH_CREATE') or v_previous_programming.estrutura_qty is distinct from v_next_programming.estrutura_qty then
    v_changes := v_changes || jsonb_build_object('estruturaQty', jsonb_build_object('from', case when v_previous_programming.id is null or v_previous_programming.estrutura_qty is null then null else v_previous_programming.estrutura_qty::text end, 'to', case when v_next_programming.estrutura_qty is null then null else v_next_programming.estrutura_qty::text end));
  end if;

  if v_history_action in ('CREATE', 'BATCH_CREATE') or v_previous_programming.trafo_qty is distinct from v_next_programming.trafo_qty then
    v_changes := v_changes || jsonb_build_object('trafoQty', jsonb_build_object('from', case when v_previous_programming.id is null or v_previous_programming.trafo_qty is null then null else v_previous_programming.trafo_qty::text end, 'to', case when v_next_programming.trafo_qty is null then null else v_next_programming.trafo_qty::text end));
  end if;

  if v_history_action in ('CREATE', 'BATCH_CREATE') or v_previous_programming.rede_qty is distinct from v_next_programming.rede_qty then
    v_changes := v_changes || jsonb_build_object('redeQty', jsonb_build_object('from', case when v_previous_programming.id is null or v_previous_programming.rede_qty is null then null else v_previous_programming.rede_qty::text end, 'to', case when v_next_programming.rede_qty is null then null else v_next_programming.rede_qty::text end));
  end if;

  if v_history_action in ('CREATE', 'BATCH_CREATE') or v_previous_programming.etapa_number is distinct from v_next_programming.etapa_number then
    v_changes := v_changes || jsonb_build_object('etapaNumber', jsonb_build_object('from', case when v_previous_programming.id is null or v_previous_programming.etapa_number is null then null else v_previous_programming.etapa_number::text end, 'to', case when v_next_programming.etapa_number is null then null else v_next_programming.etapa_number::text end));
  end if;

  if v_history_action in ('CREATE', 'BATCH_CREATE') or v_previous_programming.work_completion_status is distinct from v_next_programming.work_completion_status then
    v_changes := v_changes || jsonb_build_object('workCompletionStatus', jsonb_build_object('from', case when v_previous_programming.id is null then null else nullif(v_previous_programming.work_completion_status, '') end, 'to', nullif(v_next_programming.work_completion_status, '')));
  end if;

  if v_history_action in ('CREATE', 'BATCH_CREATE') or v_previous_programming.affected_customers is distinct from v_next_programming.affected_customers then
    v_changes := v_changes || jsonb_build_object('affectedCustomers', jsonb_build_object('from', case when v_previous_programming.id is null or v_previous_programming.affected_customers is null then null else v_previous_programming.affected_customers::text end, 'to', case when v_next_programming.affected_customers is null then null else v_next_programming.affected_customers::text end));
  end if;

  if v_history_action in ('CREATE', 'BATCH_CREATE') or nullif(v_previous_sgd_type_description, '') is distinct from nullif(v_next_sgd_type_description, '') then
    v_changes := v_changes || jsonb_build_object('sgdType', jsonb_build_object('from', nullif(v_previous_sgd_type_description, ''), 'to', nullif(v_next_sgd_type_description, '')));
  end if;

  if v_history_action in ('CREATE', 'BATCH_CREATE') or nullif(v_previous_programming.sgd_number, '') is distinct from nullif(v_next_programming.sgd_number, '') then
    v_changes := v_changes || jsonb_build_object('sgdNumber', jsonb_build_object('from', nullif(v_previous_programming.sgd_number, ''), 'to', nullif(v_next_programming.sgd_number, '')));
  end if;

  if v_history_action in ('CREATE', 'BATCH_CREATE') or v_previous_programming.sgd_included_at is distinct from v_next_programming.sgd_included_at then
    v_changes := v_changes || jsonb_build_object('sgdApprovedAt', jsonb_build_object('from', case when v_previous_programming.id is null or v_previous_programming.sgd_included_at is null then null else v_previous_programming.sgd_included_at::text end, 'to', case when v_next_programming.sgd_included_at is null then null else v_next_programming.sgd_included_at::text end));
  end if;

  if v_history_action in ('CREATE', 'BATCH_CREATE') or v_previous_programming.sgd_delivered_at is distinct from v_next_programming.sgd_delivered_at then
    v_changes := v_changes || jsonb_build_object('sgdRequestedAt', jsonb_build_object('from', case when v_previous_programming.id is null or v_previous_programming.sgd_delivered_at is null then null else v_previous_programming.sgd_delivered_at::text end, 'to', case when v_next_programming.sgd_delivered_at is null then null else v_next_programming.sgd_delivered_at::text end));
  end if;

  if v_history_action in ('CREATE', 'BATCH_CREATE') or nullif(v_previous_programming.pi_number, '') is distinct from nullif(v_next_programming.pi_number, '') then
    v_changes := v_changes || jsonb_build_object('piNumber', jsonb_build_object('from', nullif(v_previous_programming.pi_number, ''), 'to', nullif(v_next_programming.pi_number, '')));
  end if;

  if v_history_action in ('CREATE', 'BATCH_CREATE') or v_previous_programming.pi_included_at is distinct from v_next_programming.pi_included_at then
    v_changes := v_changes || jsonb_build_object('piApprovedAt', jsonb_build_object('from', case when v_previous_programming.id is null or v_previous_programming.pi_included_at is null then null else v_previous_programming.pi_included_at::text end, 'to', case when v_next_programming.pi_included_at is null then null else v_next_programming.pi_included_at::text end));
  end if;

  if v_history_action in ('CREATE', 'BATCH_CREATE') or v_previous_programming.pi_delivered_at is distinct from v_next_programming.pi_delivered_at then
    v_changes := v_changes || jsonb_build_object('piRequestedAt', jsonb_build_object('from', case when v_previous_programming.id is null or v_previous_programming.pi_delivered_at is null then null else v_previous_programming.pi_delivered_at::text end, 'to', case when v_next_programming.pi_delivered_at is null then null else v_next_programming.pi_delivered_at::text end));
  end if;

  if v_history_action in ('CREATE', 'BATCH_CREATE') or nullif(v_previous_programming.pep_number, '') is distinct from nullif(v_next_programming.pep_number, '') then
    v_changes := v_changes || jsonb_build_object('pepNumber', jsonb_build_object('from', nullif(v_previous_programming.pep_number, ''), 'to', nullif(v_next_programming.pep_number, '')));
  end if;

  if v_history_action in ('CREATE', 'BATCH_CREATE') or v_previous_programming.pep_included_at is distinct from v_next_programming.pep_included_at then
    v_changes := v_changes || jsonb_build_object('pepApprovedAt', jsonb_build_object('from', case when v_previous_programming.id is null or v_previous_programming.pep_included_at is null then null else v_previous_programming.pep_included_at::text end, 'to', case when v_next_programming.pep_included_at is null then null else v_next_programming.pep_included_at::text end));
  end if;

  if v_history_action in ('CREATE', 'BATCH_CREATE') or v_previous_programming.pep_delivered_at is distinct from v_next_programming.pep_delivered_at then
    v_changes := v_changes || jsonb_build_object('pepRequestedAt', jsonb_build_object('from', case when v_previous_programming.id is null or v_previous_programming.pep_delivered_at is null then null else v_previous_programming.pep_delivered_at::text end, 'to', case when v_next_programming.pep_delivered_at is null then null else v_next_programming.pep_delivered_at::text end));
  end if;

  if v_history_action in ('CREATE', 'BATCH_CREATE') or v_previous_activities_text is distinct from v_next_activities_text then
    v_changes := v_changes || jsonb_build_object('activities', jsonb_build_object('from', case when v_previous_programming.id is null then null else v_previous_activities_text end, 'to', v_next_activities_text));
  end if;

  v_should_write_history :=
    v_history_action in ('CREATE', 'BATCH_CREATE', 'RESCHEDULE')
    or v_changes <> '{}'::jsonb;

  if v_should_write_history then
    v_history_result := public.append_project_programming_history_record(
      p_tenant_id,
      p_actor_user_id,
      v_programming_id,
      p_project_id,
      v_next_programming.team_id,
      null,
      v_history_action,
      case when v_history_action = 'RESCHEDULE' then v_history_reason else null end,
      v_changes,
      v_history_metadata,
      case when v_previous_programming.id is null then null else v_previous_programming.status end,
      v_next_programming.status,
      case when v_previous_programming.id is null then null else v_previous_programming.execution_date end,
      v_next_programming.execution_date,
      case when v_previous_programming.id is null then null else v_previous_programming.team_id end,
      v_next_programming.team_id,
      case when v_previous_programming.id is null then null else v_previous_programming.start_time end,
      v_next_programming.start_time,
      case when v_previous_programming.id is null then null else v_previous_programming.end_time end,
      v_next_programming.end_time,
      case when v_previous_programming.id is null then null else v_previous_programming.etapa_number end,
      v_next_programming.etapa_number
    );

    if coalesce((v_history_result ->> 'success')::boolean, false) = false then
      raise exception '%',
        jsonb_build_object(
          'success', false,
          'status', coalesce((v_history_result ->> 'status')::integer, 500),
          'reason', coalesce(v_history_result ->> 'reason', 'APPEND_PROGRAMMING_HISTORY_FAILED'),
          'message', coalesce(v_history_result ->> 'message', 'Falha ao registrar o historico operacional da programacao.')
        )::text;
    end if;
  end if;

  if v_history_action = 'RESCHEDULE' then
    v_message := format('Programacao do projeto %s reagendada com sucesso.', v_project_code);
  elsif v_history_action = 'BATCH_CREATE' then
    v_message := format('Programacao do projeto %s registrada com sucesso.', v_project_code);
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'action', v_action,
    'programming_id', v_programming_id,
    'project_code', v_project_code,
    'updated_at', v_updated_at,
    'message', v_message
  );
exception
  when others then
    begin
      if left(ltrim(sqlerrm), 1) = '{' then
        v_structured_error := sqlerrm::jsonb;
      else
        v_structured_error := null;
      end if;

      return jsonb_build_object(
        'success', false,
        'status', coalesce((v_structured_error ->> 'status')::integer, 500),
        'reason', coalesce(v_structured_error ->> 'reason', 'SAVE_PROGRAMMING_FULL_FAILED'),
        'message', coalesce(v_structured_error ->> 'message', 'Falha ao salvar programacao em transacao unica.'),
        'detail', case when v_structured_error is null then sqlerrm else coalesce(v_structured_error ->> 'detail', v_structured_error ->> 'message') end
      );
    exception
      when others then
        return jsonb_build_object(
          'success', false,
          'status', 500,
          'reason', 'SAVE_PROGRAMMING_FULL_FAILED',
          'message', 'Falha ao salvar programacao em transacao unica.',
          'detail', sqlerrm
        );
    end;
end;
$$;

create or replace function public.save_project_programming_full(
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
  p_support_item_id uuid default null,
  p_poste_qty integer default 0,
  p_estrutura_qty integer default 0,
  p_trafo_qty integer default 0,
  p_rede_qty integer default 0,
  p_affected_customers integer default 0,
  p_sgd_type_id uuid default null,
  p_outage_start_time time default null,
  p_outage_end_time time default null,
  p_service_description text default null,
  p_etapa_number integer default null,
  p_work_completion_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.save_project_programming_full(
    p_tenant_id,
    p_actor_user_id,
    p_project_id,
    p_team_id,
    p_execution_date,
    p_period,
    p_start_time,
    p_end_time,
    p_expected_minutes,
    p_feeder,
    p_support,
    p_note,
    p_documents,
    p_activities,
    p_programming_id,
    p_expected_updated_at,
    p_support_item_id,
    p_poste_qty,
    p_estrutura_qty,
    p_trafo_qty,
    p_rede_qty,
    p_affected_customers,
    p_sgd_type_id,
    p_outage_start_time,
    p_outage_end_time,
    p_service_description,
    p_etapa_number,
    p_work_completion_status,
    null,
    null,
    '{}'::jsonb
  );
end;
$$;

create or replace function public.save_project_programming_full(
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
  p_support_item_id uuid default null,
  p_poste_qty integer default 0,
  p_estrutura_qty integer default 0,
  p_trafo_qty integer default 0,
  p_rede_qty integer default 0,
  p_affected_customers integer default 0,
  p_sgd_type_id uuid default null,
  p_outage_start_time time default null,
  p_outage_end_time time default null,
  p_service_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.save_project_programming_full(
    p_tenant_id,
    p_actor_user_id,
    p_project_id,
    p_team_id,
    p_execution_date,
    p_period,
    p_start_time,
    p_end_time,
    p_expected_minutes,
    p_feeder,
    p_support,
    p_note,
    p_documents,
    p_activities,
    p_programming_id,
    p_expected_updated_at,
    p_support_item_id,
    p_poste_qty,
    p_estrutura_qty,
    p_trafo_qty,
    p_rede_qty,
    p_affected_customers,
    p_sgd_type_id,
    p_outage_start_time,
    p_outage_end_time,
    p_service_description,
    null,
    null,
    null,
    null,
    '{}'::jsonb
  );
end;
$$;

revoke all on function public.save_project_programming_full(
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
  uuid,
  integer,
  integer,
  integer,
  integer,
  integer,
  uuid,
  time,
  time,
  text,
  integer,
  text,
  text,
  text,
  jsonb
) from public;

grant execute on function public.save_project_programming_full(
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
  uuid,
  integer,
  integer,
  integer,
  integer,
  integer,
  uuid,
  time,
  time,
  text,
  integer,
  text,
  text,
  text,
  jsonb
) to authenticated;

grant execute on function public.save_project_programming_full(
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
  uuid,
  integer,
  integer,
  integer,
  integer,
  integer,
  uuid,
  time,
  time,
  text,
  integer,
  text,
  text,
  text,
  jsonb
) to service_role;

revoke all on function public.save_project_programming_full(
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
  uuid,
  integer,
  integer,
  integer,
  integer,
  integer,
  uuid,
  time,
  time,
  text,
  integer,
  text
) from public;

grant execute on function public.save_project_programming_full(
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
  uuid,
  integer,
  integer,
  integer,
  integer,
  integer,
  uuid,
  time,
  time,
  text,
  integer,
  text
) to authenticated;

grant execute on function public.save_project_programming_full(
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
  uuid,
  integer,
  integer,
  integer,
  integer,
  integer,
  uuid,
  time,
  time,
  text,
  integer,
  text
) to service_role;

revoke all on function public.save_project_programming_full(
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
  uuid,
  integer,
  integer,
  integer,
  integer,
  integer,
  uuid,
  time,
  time,
  text
) from public;

grant execute on function public.save_project_programming_full(
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
  uuid,
  integer,
  integer,
  integer,
  integer,
  integer,
  uuid,
  time,
  time,
  text
) to authenticated;

grant execute on function public.save_project_programming_full(
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
  uuid,
  integer,
  integer,
  integer,
  integer,
  integer,
  uuid,
  time,
  time,
  text
) to service_role;

drop function if exists public.save_project_programming_batch_full(
  uuid,
  uuid,
  uuid,
  uuid[],
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
  integer,
  integer,
  integer,
  integer,
  integer,
  uuid,
  time,
  time,
  text,
  integer,
  text
);

create or replace function public.save_project_programming_batch_full(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_project_id uuid,
  p_team_ids uuid[],
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
  p_support_item_id uuid default null,
  p_poste_qty integer default 0,
  p_estrutura_qty integer default 0,
  p_trafo_qty integer default 0,
  p_rede_qty integer default 0,
  p_affected_customers integer default 0,
  p_sgd_type_id uuid default null,
  p_outage_start_time time default null,
  p_outage_end_time time default null,
  p_service_description text default null,
  p_etapa_number integer default null,
  p_work_completion_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_ids uuid[];
  v_team_id uuid;
  v_result jsonb;
  v_programming_id uuid;
  v_project_code text;
  v_inserted_count integer := 0;
  v_programming_ids uuid[] := array[]::uuid[];
  v_items jsonb := '[]'::jsonb;
  v_structured_error jsonb;
begin
  select array_agg(distinct item) filter (where item is not null)
  into v_team_ids
  from unnest(coalesce(p_team_ids, array[]::uuid[])) as item;

  if coalesce(array_length(v_team_ids, 1), 0) = 0 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'TEAM_IDS_REQUIRED',
      'message', 'Informe ao menos uma equipe para cadastrar a programacao.'
    );
  end if;

  foreach v_team_id in array v_team_ids loop
    v_result := public.save_project_programming_full(
      p_tenant_id,
      p_actor_user_id,
      p_project_id,
      v_team_id,
      p_execution_date,
      p_period,
      p_start_time,
      p_end_time,
      p_expected_minutes,
      p_feeder,
      p_support,
      p_note,
      p_documents,
      p_activities,
      null,
      null,
      p_support_item_id,
      p_poste_qty,
      p_estrutura_qty,
      p_trafo_qty,
      p_rede_qty,
      p_affected_customers,
      p_sgd_type_id,
      p_outage_start_time,
      p_outage_end_time,
      p_service_description,
      p_etapa_number,
      p_work_completion_status,
      'BATCH_CREATE',
      null,
      jsonb_build_object('source', 'programacao-simples')
    );

    if coalesce((v_result ->> 'success')::boolean, false) = false then
      raise exception '%',
        jsonb_build_object(
          'success', false,
          'status', coalesce((v_result ->> 'status')::integer, 400),
          'reason', coalesce(v_result ->> 'reason', 'BATCH_FULL_CREATE_FAILED'),
          'message', coalesce(v_result ->> 'message', 'Falha ao cadastrar programacao para uma das equipes.'),
          'detail', coalesce(v_result ->> 'detail', v_result ->> 'message')
        )::text;
    end if;

    v_programming_id := nullif(v_result ->> 'programming_id', '')::uuid;
    if v_programming_id is null then
      raise exception '%',
        jsonb_build_object(
          'success', false,
          'status', 500,
          'reason', 'BATCH_FULL_CREATE_INVALID_RESULT',
          'message', 'Falha ao recuperar o ID da programacao cadastrada.'
        )::text;
    end if;

    v_project_code := coalesce(nullif(v_result ->> 'project_code', ''), v_project_code);
    v_programming_ids := array_append(v_programming_ids, v_programming_id);
    v_inserted_count := v_inserted_count + 1;
    v_items := v_items || jsonb_build_array(
      jsonb_build_object(
        'teamId', v_team_id,
        'programmingId', v_programming_id
      )
    );
  end loop;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'inserted_count', v_inserted_count,
    'project_code', coalesce(v_project_code, ''),
    'programming_ids', v_programming_ids,
    'items', v_items,
    'message', case
      when v_inserted_count = 1 then 'Programacao cadastrada com sucesso para 1 equipe.'
      else format('Programacao cadastrada com sucesso para %s equipes.', v_inserted_count)
    end
  );
exception
  when others then
    begin
      if left(ltrim(sqlerrm), 1) = '{' then
        v_structured_error := sqlerrm::jsonb;
      else
        v_structured_error := null;
      end if;

      return jsonb_build_object(
        'success', false,
        'status', coalesce((v_structured_error ->> 'status')::integer, 500),
        'reason', coalesce(v_structured_error ->> 'reason', 'BATCH_FULL_CREATE_FAILED'),
        'message', coalesce(v_structured_error ->> 'message', 'Falha ao cadastrar programacao em lote.'),
        'detail', case when v_structured_error is null then sqlerrm else coalesce(v_structured_error ->> 'detail', v_structured_error ->> 'message') end
      );
    exception
      when others then
        return jsonb_build_object(
          'success', false,
          'status', 500,
          'reason', 'BATCH_FULL_CREATE_FAILED',
          'message', 'Falha ao cadastrar programacao em lote.',
          'detail', sqlerrm
        );
    end;
end;
$$;

revoke all on function public.save_project_programming_batch_full(
  uuid,
  uuid,
  uuid,
  uuid[],
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
  integer,
  integer,
  integer,
  integer,
  integer,
  uuid,
  time,
  time,
  text,
  integer,
  text
) from public;

grant execute on function public.save_project_programming_batch_full(
  uuid,
  uuid,
  uuid,
  uuid[],
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
  integer,
  integer,
  integer,
  integer,
  integer,
  uuid,
  time,
  time,
  text,
  integer,
  text
) to authenticated;

grant execute on function public.save_project_programming_batch_full(
  uuid,
  uuid,
  uuid,
  uuid[],
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
  integer,
  integer,
  integer,
  integer,
  integer,
  uuid,
  time,
  time,
  text,
  integer,
  text
) to service_role;
