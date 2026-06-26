-- 269_guard_programming_stage_on_active_records.sql
-- Corrige programacoes ativas sem ETAPA valida e impede novas linhas ativas sem ETAPA numerica ou flag especial.

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
    etapa_unica = coalesce(v_current.etapa_unica, false),
    etapa_final = coalesce(v_current.etapa_final, false),
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
      'executionDate', jsonb_build_object('from', null, 'to', p_new_execution_date),
      'etapaUnica', jsonb_build_object('from', null, 'to', coalesce(v_current.etapa_unica, false)::text),
      'etapaFinal', jsonb_build_object('from', null, 'to', coalesce(v_current.etapa_final, false)::text)
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

do $$
declare
  v_row record;
begin
  for v_row in
    select
      target.*,
      source.id as source_programming_id,
      coalesce(source.etapa_unica, false) as source_etapa_unica,
      coalesce(source.etapa_final, false) as source_etapa_final
    from public.project_programming target
    join lateral (
      select coalesce(
        h.related_programming_id,
        case
          when h.metadata ->> 'sourceProgrammingId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then (h.metadata ->> 'sourceProgrammingId')::uuid
          else null
        end
      ) as source_programming_id
      from public.project_programming_history h
      where h.tenant_id = target.tenant_id
        and h.programming_id = target.id
        and h.action_type = 'CREATE'
      order by h.created_at desc, h.id desc
      limit 1
    ) link on link.source_programming_id is not null
    join public.project_programming source
      on source.tenant_id = target.tenant_id
     and source.id = link.source_programming_id
    where target.status in ('PROGRAMADA', 'REPROGRAMADA')
      and target.etapa_number is null
      and coalesce(target.etapa_unica, false) = false
      and coalesce(target.etapa_final, false) = false
      and (
        coalesce(source.etapa_unica, false) = true
        or coalesce(source.etapa_final, false) = true
      )
    for update of target
  loop
    update public.project_programming
    set
      etapa_unica = v_row.source_etapa_unica,
      etapa_final = v_row.source_etapa_final,
      updated_at = now()
    where tenant_id = v_row.tenant_id
      and id = v_row.id;

    perform public.append_project_programming_history_record(
      v_row.tenant_id,
      null,
      v_row.id,
      v_row.project_id,
      v_row.team_id,
      v_row.source_programming_id,
      'UPDATE',
      'Backfill automatico de ETAPA especial perdida no adiamento.',
      jsonb_build_object(
        'etapaUnica', jsonb_build_object('from', 'false', 'to', v_row.source_etapa_unica::text),
        'etapaFinal', jsonb_build_object('from', 'false', 'to', v_row.source_etapa_final::text)
      ),
      jsonb_build_object(
        'source', 'migration',
        'migration', '269_guard_programming_stage_on_active_records',
        'rule', 'RESTORE_SPECIAL_STAGE_FROM_POSTPONE_SOURCE',
        'sourceProgrammingId', v_row.source_programming_id
      ),
      v_row.status,
      v_row.status,
      v_row.execution_date,
      v_row.execution_date,
      v_row.team_id,
      v_row.team_id,
      v_row.start_time,
      v_row.start_time,
      v_row.end_time,
      v_row.end_time,
      null,
      null
    );
  end loop;
end;
$$;

do $$
declare
  v_row record;
  v_next_etapa_number integer;
begin
  for v_row in
    select *
    from public.project_programming
    where status in ('PROGRAMADA', 'REPROGRAMADA')
      and etapa_number is null
      and coalesce(etapa_unica, false) = false
      and coalesce(etapa_final, false) = false
    order by tenant_id, project_id, team_id, execution_date, created_at, id
    for update
  loop
    select coalesce(max(pp.etapa_number), 0) + 1
    into v_next_etapa_number
    from public.project_programming pp
    where pp.tenant_id = v_row.tenant_id
      and pp.project_id = v_row.project_id
      and pp.team_id = v_row.team_id
      and pp.id <> v_row.id
      and pp.etapa_number is not null;

    update public.project_programming
    set
      etapa_number = v_next_etapa_number,
      updated_at = now()
    where tenant_id = v_row.tenant_id
      and id = v_row.id;

    perform public.append_project_programming_history_record(
      v_row.tenant_id,
      null,
      v_row.id,
      v_row.project_id,
      v_row.team_id,
      null,
      'UPDATE',
      'Backfill automatico de ETAPA numerica obrigatoria em programacao ativa.',
      jsonb_build_object(
        'etapaNumber', jsonb_build_object('from', null, 'to', v_next_etapa_number::text)
      ),
      jsonb_build_object(
        'source', 'migration',
        'migration', '269_guard_programming_stage_on_active_records',
        'rule', 'ACTIVE_PROGRAMMING_REQUIRES_STAGE'
      ),
      v_row.status,
      v_row.status,
      v_row.execution_date,
      v_row.execution_date,
      v_row.team_id,
      v_row.team_id,
      v_row.start_time,
      v_row.start_time,
      v_row.end_time,
      v_row.end_time,
      null,
      v_next_etapa_number
    );
  end loop;
end;
$$;

alter table public.project_programming
  drop constraint if exists project_programming_active_stage_required_check;

alter table public.project_programming
  add constraint project_programming_active_stage_required_check
  check (
    status not in ('PROGRAMADA', 'REPROGRAMADA')
    or etapa_number is not null
    or coalesce(etapa_unica, false) = true
    or coalesce(etapa_final, false) = true
  );
