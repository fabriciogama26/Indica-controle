-- 111_move_electrical_field_into_full_rpcs_and_adjust_reschedule_rule.sql
-- Move Campo eletrico para o mesmo fluxo transacional das RPCs full (single e batch)
-- e ajusta a regra de reprogramacao para considerar projeto/equipe/data/hora inicio/hora termino/periodo.


drop function if exists public.save_project_programming_full_with_electrical_field(
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
  jsonb,
  text
);

create or replace function public.save_project_programming_full_with_electrical_field(
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
  p_history_metadata jsonb default '{}'::jsonb,
  p_campo_eletrico text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campo_eletrico text := nullif(btrim(coalesce(p_campo_eletrico, '')), '');
  v_base_result jsonb;
  v_programming_id uuid;
  v_base_action text;
  v_effective_action_override text := nullif(upper(btrim(coalesce(p_history_action_override, ''))), '');
  v_effective_reason text := nullif(btrim(coalesce(p_history_reason, '')), '');
  v_effective_metadata jsonb := case
    when jsonb_typeof(coalesce(p_history_metadata, '{}'::jsonb)) = 'object' then coalesce(p_history_metadata, '{}'::jsonb)
    else '{}'::jsonb
  end;
  v_previous_status text;
  v_previous_project_id uuid;
  v_previous_execution_date date;
  v_previous_team_id uuid;
  v_previous_start_time time;
  v_previous_end_time time;
  v_previous_period text;
  v_is_reschedule boolean := false;
  v_force_update_action boolean := false;
  v_history_id uuid;
  v_electrical_result jsonb;
  v_updated_at timestamptz;
  v_structured_error jsonb;
begin
  if v_campo_eletrico is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'ELECTRICAL_FIELD_REQUIRED',
      'message', 'Campo eletrico e obrigatorio para salvar a programacao.'
    );
  end if;

  if p_programming_id is not null then
    select
      pp.status,
      pp.project_id,
      pp.execution_date,
      pp.team_id,
      pp.start_time,
      pp.end_time,
      pp.period
    into
      v_previous_status,
      v_previous_project_id,
      v_previous_execution_date,
      v_previous_team_id,
      v_previous_start_time,
      v_previous_end_time,
      v_previous_period
    from public.project_programming pp
    where pp.tenant_id = p_tenant_id
      and pp.id = p_programming_id;

    if found then
      v_is_reschedule :=
        v_previous_project_id is distinct from p_project_id
        or v_previous_execution_date is distinct from p_execution_date
        or v_previous_team_id is distinct from p_team_id
        or v_previous_start_time is distinct from p_start_time
        or v_previous_end_time is distinct from p_end_time
        or upper(coalesce(v_previous_period, '')) is distinct from upper(coalesce(p_period, ''));

      if v_is_reschedule then
        if v_effective_action_override is null then
          v_effective_action_override := 'RESCHEDULE';
        end if;
      else
        v_force_update_action := true;
        v_effective_action_override := 'UPDATE';
        v_effective_reason := null;
      end if;
    end if;
  end if;

  v_base_result := public.save_project_programming_full(
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
    v_effective_action_override,
    v_effective_reason,
    v_effective_metadata
  );

  if coalesce((v_base_result ->> 'success')::boolean, false) = false then
    return jsonb_build_object(
      'success', false,
      'status', coalesce((v_base_result ->> 'status')::integer, 400),
      'reason', coalesce(v_base_result ->> 'reason', 'SAVE_PROGRAMMING_FULL_FAILED'),
      'message', coalesce(v_base_result ->> 'message', 'Falha ao salvar programacao em transacao unica.'),
      'detail', coalesce(v_base_result ->> 'detail', v_base_result ->> 'message')
    );
  end if;

  v_programming_id := nullif(v_base_result ->> 'programming_id', '')::uuid;
  v_base_action := coalesce(v_base_result ->> 'action', 'UPDATE');

  if v_programming_id is null then
    raise exception '%',
      jsonb_build_object(
        'success', false,
        'status', 500,
        'reason', 'SAVE_PROGRAMMING_FULL_INVALID_RESULT',
        'message', 'Falha ao recuperar o ID da programacao salva.'
      )::text;
  end if;

  if p_programming_id is not null and v_previous_project_id is distinct from p_project_id then
    update public.project_programming
    set
      project_id = p_project_id,
      updated_by = p_actor_user_id
    where tenant_id = p_tenant_id
      and id = v_programming_id;

    if not found then
      raise exception '%',
        jsonb_build_object(
          'success', false,
          'status', 404,
          'reason', 'PROGRAMMING_NOT_FOUND',
          'message', 'Programacao nao encontrada para atualizar o projeto.'
        )::text;
    end if;

    select ph.id
    into v_history_id
    from public.project_programming_history ph
    where ph.tenant_id = p_tenant_id
      and ph.programming_id = v_programming_id
    order by ph.created_at desc
    limit 1;

    if v_history_id is not null then
      update public.project_programming_history
      set
        changes = coalesce(changes, '{}'::jsonb) || jsonb_build_object(
          'projectId',
          jsonb_build_object(
            'from', v_previous_project_id::text,
            'to', p_project_id::text
          )
        )
      where id = v_history_id;
    end if;
  end if;

  if v_force_update_action and coalesce(v_previous_status, '') = 'PROGRAMADA' then
    update public.project_programming
    set
      status = 'PROGRAMADA',
      updated_by = p_actor_user_id
    where tenant_id = p_tenant_id
      and id = v_programming_id
      and status = 'REPROGRAMADA';

    if found then
      select ph.id
      into v_history_id
      from public.project_programming_history ph
      where ph.tenant_id = p_tenant_id
        and ph.programming_id = v_programming_id
      order by ph.created_at desc
      limit 1;

      if v_history_id is not null then
        update public.project_programming_history
        set changes = coalesce(changes, '{}'::jsonb) - 'status'
        where id = v_history_id;
      end if;
    end if;
  end if;

  if v_is_reschedule and coalesce(v_previous_status, '') = 'PROGRAMADA' then
    update public.project_programming
    set
      status = 'REPROGRAMADA',
      updated_by = p_actor_user_id
    where tenant_id = p_tenant_id
      and id = v_programming_id
      and status = 'PROGRAMADA';

    if found then
      select ph.id
      into v_history_id
      from public.project_programming_history ph
      where ph.tenant_id = p_tenant_id
        and ph.programming_id = v_programming_id
      order by ph.created_at desc
      limit 1;

      if v_history_id is not null then
        update public.project_programming_history
        set
          action_type = 'RESCHEDULE',
          reason = coalesce(reason, v_effective_reason),
          changes = coalesce(changes, '{}'::jsonb) || jsonb_build_object(
            'status',
            jsonb_build_object('from', 'PROGRAMADA', 'to', 'REPROGRAMADA')
          ),
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('action', 'RESCHEDULE')
        where id = v_history_id;
      end if;
    end if;
  end if;

  v_electrical_result := public.set_project_programming_campo_eletrico(
    p_tenant_id,
    p_actor_user_id,
    v_programming_id,
    v_campo_eletrico,
    coalesce(
      v_effective_action_override,
      case
        when upper(v_base_action) = 'INSERT' then 'CREATE'
        else 'UPDATE'
      end
    ),
    v_effective_reason,
    v_effective_metadata
  );

  if coalesce((v_electrical_result ->> 'success')::boolean, false) = false then
    raise exception '%',
      jsonb_build_object(
        'success', false,
        'status', coalesce((v_electrical_result ->> 'status')::integer, 400),
        'reason', coalesce(v_electrical_result ->> 'reason', 'SET_ELECTRICAL_FIELD_FAILED'),
        'message', coalesce(v_electrical_result ->> 'message', 'Falha ao salvar Campo eletrico da programacao.')
      )::text;
  end if;

  select pp.updated_at
  into v_updated_at
  from public.project_programming pp
  where pp.tenant_id = p_tenant_id
    and pp.id = v_programming_id;

  return jsonb_build_object(
    'success', true,
    'status', coalesce((v_base_result ->> 'status')::integer, 200),
    'action', v_base_action,
    'programming_id', v_programming_id,
    'project_code', coalesce(v_base_result ->> 'project_code', ''),
    'updated_at', v_updated_at,
    'message', coalesce(v_base_result ->> 'message', 'Programacao salva com sucesso.')
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
        'reason', coalesce(v_structured_error ->> 'reason', 'SAVE_PROGRAMMING_FULL_WITH_ELECTRICAL_FAILED'),
        'message', coalesce(v_structured_error ->> 'message', 'Falha ao salvar programacao em transacao unica.'),
        'detail', case when v_structured_error is null then sqlerrm else coalesce(v_structured_error ->> 'detail', v_structured_error ->> 'message') end
      );
    exception
      when others then
        return jsonb_build_object(
          'success', false,
          'status', 500,
          'reason', 'SAVE_PROGRAMMING_FULL_WITH_ELECTRICAL_FAILED',
          'message', 'Falha ao salvar programacao em transacao unica.',
          'detail', sqlerrm
        );
    end;
end;
$$;

revoke all on function public.save_project_programming_full_with_electrical_field(
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
  jsonb,
  text
) from public;

grant execute on function public.save_project_programming_full_with_electrical_field(
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
  jsonb,
  text
) to authenticated;

grant execute on function public.save_project_programming_full_with_electrical_field(
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
  jsonb,
  text
) to service_role;


drop function if exists public.save_project_programming_batch_full_with_electrical_field(
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
  text,
  text
);

create or replace function public.save_project_programming_batch_full_with_electrical_field(
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
  p_work_completion_status text default null,
  p_campo_eletrico text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campo_eletrico text := nullif(btrim(coalesce(p_campo_eletrico, '')), '');
  v_base_result jsonb;
  v_item jsonb;
  v_programming_id uuid;
  v_electrical_result jsonb;
  v_structured_error jsonb;
begin
  if v_campo_eletrico is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'ELECTRICAL_FIELD_REQUIRED',
      'message', 'Campo eletrico e obrigatorio para salvar a programacao.'
    );
  end if;

  v_base_result := public.save_project_programming_batch_full(
    p_tenant_id,
    p_actor_user_id,
    p_project_id,
    p_team_ids,
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
    p_work_completion_status
  );

  if coalesce((v_base_result ->> 'success')::boolean, false) = false then
    return jsonb_build_object(
      'success', false,
      'status', coalesce((v_base_result ->> 'status')::integer, 400),
      'reason', coalesce(v_base_result ->> 'reason', 'BATCH_FULL_CREATE_FAILED'),
      'message', coalesce(v_base_result ->> 'message', 'Falha ao cadastrar programacao em lote.'),
      'detail', coalesce(v_base_result ->> 'detail', v_base_result ->> 'message')
    );
  end if;

  for v_item in
    select value
    from jsonb_array_elements(coalesce(v_base_result -> 'items', '[]'::jsonb))
  loop
    v_programming_id := nullif(v_item ->> 'programmingId', '')::uuid;

    if v_programming_id is null then
      raise exception '%',
        jsonb_build_object(
          'success', false,
          'status', 500,
          'reason', 'BATCH_FULL_CREATE_INVALID_RESULT',
          'message', 'Falha ao recuperar o ID da programacao cadastrada.'
        )::text;
    end if;

    v_electrical_result := public.set_project_programming_campo_eletrico(
      p_tenant_id,
      p_actor_user_id,
      v_programming_id,
      v_campo_eletrico,
      'BATCH_CREATE',
      null,
      jsonb_build_object('source', 'programacao-simples', 'mode', 'batch')
    );

    if coalesce((v_electrical_result ->> 'success')::boolean, false) = false then
      raise exception '%',
        jsonb_build_object(
          'success', false,
          'status', coalesce((v_electrical_result ->> 'status')::integer, 400),
          'reason', coalesce(v_electrical_result ->> 'reason', 'SET_ELECTRICAL_FIELD_FAILED'),
          'message', coalesce(v_electrical_result ->> 'message', 'Falha ao salvar Campo eletrico em uma das equipes.')
        )::text;
    end if;
  end loop;

  return v_base_result;
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
        'reason', coalesce(v_structured_error ->> 'reason', 'BATCH_FULL_WITH_ELECTRICAL_FAILED'),
        'message', coalesce(v_structured_error ->> 'message', 'Falha ao cadastrar programacao em lote.'),
        'detail', case when v_structured_error is null then sqlerrm else coalesce(v_structured_error ->> 'detail', v_structured_error ->> 'message') end
      );
    exception
      when others then
        return jsonb_build_object(
          'success', false,
          'status', 500,
          'reason', 'BATCH_FULL_WITH_ELECTRICAL_FAILED',
          'message', 'Falha ao cadastrar programacao em lote.',
          'detail', sqlerrm
        );
    end;
end;
$$;

revoke all on function public.save_project_programming_batch_full_with_electrical_field(
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
  text,
  text
) from public;

grant execute on function public.save_project_programming_batch_full_with_electrical_field(
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
  text,
  text
) to authenticated;

grant execute on function public.save_project_programming_batch_full_with_electrical_field(
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
  text,
  text
) to service_role;


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
    campo_eletrico = v_current.campo_eletrico,
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
    return jsonb_build_object(
      'success', false,
      'status', 500,
      'reason', 'POSTPONE_PROGRAMMING_FAILED',
      'message', 'Falha ao adiar programacao.',
      'detail', sqlerrm
    );
end;
$$;
