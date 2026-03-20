-- 094_add_programming_stage_and_completion_fields.sql
-- Adiciona ETAPA e Estado Trabalho na Programacao, com suporte transacional nas RPCs full.

alter table if exists public.project_programming
  add column if not exists etapa_number integer;

alter table if exists public.project_programming
  add column if not exists work_completion_status text;

alter table if exists public.project_programming
  drop constraint if exists project_programming_etapa_number_check;

alter table if exists public.project_programming
  add constraint project_programming_etapa_number_check
  check (etapa_number is null or etapa_number > 0);

alter table if exists public.project_programming
  drop constraint if exists project_programming_work_completion_status_check;

alter table if exists public.project_programming
  add constraint project_programming_work_completion_status_check
  check (
    work_completion_status is null
    or work_completion_status in ('CONCLUIDO', 'PARCIAL')
  );

drop function if exists public.set_project_programming_execution_result(
  uuid,
  uuid,
  uuid,
  integer,
  text
);

create or replace function public.set_project_programming_execution_result(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_id uuid,
  p_etapa_number integer default null,
  p_work_completion_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_programming_id uuid;
  v_updated_at timestamptz;
  v_work_completion_status text := nullif(upper(btrim(coalesce(p_work_completion_status, ''))), '');
begin
  if p_programming_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'PROGRAMMING_ID_REQUIRED',
      'message', 'Programacao invalida para salvar ETAPA/Estado Trabalho.'
    );
  end if;

  if p_etapa_number is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'ETAPA_REQUIRED',
      'message', 'ETAPA e obrigatoria.'
    );
  end if;

  if p_etapa_number <= 0 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_ETAPA_NUMBER',
      'message', 'ETAPA deve ser um numero inteiro maior que zero.'
    );
  end if;

  if v_work_completion_status is not null
    and v_work_completion_status not in ('CONCLUIDO', 'PARCIAL') then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_WORK_COMPLETION_STATUS',
      'message', 'Estado Trabalho invalido. Use apenas CONCLUIDO ou PARCIAL.'
    );
  end if;

  update public.project_programming
  set
    etapa_number = p_etapa_number,
    work_completion_status = v_work_completion_status,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = p_programming_id
  returning id, updated_at
  into v_programming_id, v_updated_at;

  if v_programming_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'PROGRAMMING_NOT_FOUND',
      'message', 'Programacao nao encontrada para o tenant atual.'
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'programming_id', v_programming_id,
    'updated_at', v_updated_at,
    'message', 'ETAPA/Estado Trabalho salvos com sucesso.'
  );
end;
$$;

revoke all on function public.set_project_programming_execution_result(
  uuid,
  uuid,
  uuid,
  integer,
  text
) from public;

grant execute on function public.set_project_programming_execution_result(
  uuid,
  uuid,
  uuid,
  integer,
  text
) to authenticated;

grant execute on function public.set_project_programming_execution_result(
  uuid,
  uuid,
  uuid,
  integer,
  text
) to service_role;

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
declare
  v_base_result jsonb;
  v_execution_result jsonb;
  v_programming_id uuid;
  v_structured_error jsonb;
begin
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
    p_service_description
  );

  if coalesce((v_base_result ->> 'success')::boolean, false) = false then
    return jsonb_build_object(
      'success', false,
      'status', coalesce((v_base_result ->> 'status')::integer, 400),
      'reason', coalesce(v_base_result ->> 'reason', 'SAVE_PROGRAMMING_FULL_FAILED'),
      'message', coalesce(v_base_result ->> 'message', 'Falha ao salvar programacao em transacao unica.')
    );
  end if;

  v_programming_id := nullif(v_base_result ->> 'programming_id', '')::uuid;
  if v_programming_id is null then
    raise exception '%',
      jsonb_build_object(
        'success', false,
        'status', 500,
        'reason', 'SAVE_PROGRAMMING_FULL_INVALID_RESULT',
        'message', 'Falha ao recuperar o ID da programacao salva.'
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

  return jsonb_build_object(
    'success', true,
    'status', coalesce((v_base_result ->> 'status')::integer, 200),
    'action', coalesce(v_base_result ->> 'action', 'UPDATE'),
    'programming_id', v_programming_id,
    'project_code', coalesce(v_base_result ->> 'project_code', ''),
    'updated_at', coalesce(v_execution_result ->> 'updated_at', v_base_result ->> 'updated_at'),
    'message', coalesce(v_base_result ->> 'message', 'Programacao salva com sucesso.')
  );
exception
  when others then
    begin
      v_structured_error := nullif(sqlerrm, '')::jsonb;
      return jsonb_build_object(
        'success', false,
        'status', coalesce((v_structured_error ->> 'status')::integer, 500),
        'reason', coalesce(v_structured_error ->> 'reason', 'SAVE_PROGRAMMING_FULL_FAILED'),
        'message', coalesce(v_structured_error ->> 'message', 'Falha ao salvar programacao em transacao unica.')
      );
    exception
      when others then
        return jsonb_build_object(
          'success', false,
          'status', 500,
          'reason', 'SAVE_PROGRAMMING_FULL_FAILED',
          'message', 'Falha ao salvar programacao em transacao unica.'
        );
    end;
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
  v_base_result jsonb;
  v_item jsonb;
  v_programming_id uuid;
  v_execution_result jsonb;
  v_structured_error jsonb;
begin
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
    p_service_description
  );

  if coalesce((v_base_result ->> 'success')::boolean, false) = false then
    return jsonb_build_object(
      'success', false,
      'status', coalesce((v_base_result ->> 'status')::integer, 400),
      'reason', coalesce(v_base_result ->> 'reason', 'BATCH_FULL_CREATE_FAILED'),
      'message', coalesce(v_base_result ->> 'message', 'Falha ao cadastrar programacao em lote.')
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
          'message', coalesce(v_execution_result ->> 'message', 'Falha ao salvar ETAPA/Estado Trabalho em uma das equipes.')
        )::text;
    end if;
  end loop;

  return jsonb_build_object(
    'success', true,
    'status', coalesce((v_base_result ->> 'status')::integer, 200),
    'inserted_count', coalesce((v_base_result ->> 'inserted_count')::integer, 0),
    'project_code', coalesce(v_base_result ->> 'project_code', ''),
    'programming_ids', coalesce(v_base_result -> 'programming_ids', '[]'::jsonb),
    'items', coalesce(v_base_result -> 'items', '[]'::jsonb),
    'message', coalesce(v_base_result ->> 'message', 'Programacao cadastrada com sucesso.')
  );
exception
  when others then
    begin
      v_structured_error := nullif(sqlerrm, '')::jsonb;
      return jsonb_build_object(
        'success', false,
        'status', coalesce((v_structured_error ->> 'status')::integer, 500),
        'reason', coalesce(v_structured_error ->> 'reason', 'BATCH_FULL_CREATE_FAILED'),
        'message', coalesce(v_structured_error ->> 'message', 'Falha ao cadastrar programacao em lote.')
      );
    exception
      when others then
        return jsonb_build_object(
          'success', false,
          'status', 500,
          'reason', 'BATCH_FULL_CREATE_FAILED',
          'message', 'Falha ao cadastrar programacao em lote.'
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
    and pp.status = 'PROGRAMADA'
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'PROGRAMMING_NOT_FOUND',
      'message', 'Programacao nao encontrada ou nao esta mais ativa na grade.'
    );
  end if;

  if p_new_execution_date = v_current.execution_date then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'SAME_EXECUTION_DATE',
      'message', 'Informe uma nova data diferente da data atual da programacao.'
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
      'number', v_current.sgd_number,
      'approvedAt', v_current.sgd_included_at,
      'requestedAt', v_current.sgd_delivered_at,
      'includedAt', v_current.sgd_included_at,
      'deliveredAt', v_current.sgd_delivered_at
    ),
    'pi', jsonb_build_object(
      'number', v_current.pi_number,
      'approvedAt', v_current.pi_included_at,
      'requestedAt', v_current.pi_delivered_at,
      'includedAt', v_current.pi_included_at,
      'deliveredAt', v_current.pi_delivered_at
    ),
    'pep', jsonb_build_object(
      'number', v_current.pep_number,
      'approvedAt', v_current.pep_included_at,
      'requestedAt', v_current.pep_delivered_at,
      'includedAt', v_current.pep_included_at,
      'deliveredAt', v_current.pep_delivered_at
    )
  );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'catalogId', ppa.service_activity_id,
        'quantity', ppa.quantity
      )
    ),
    '[]'::jsonb
  )
  into v_activities
  from public.project_programming_activities ppa
  where ppa.tenant_id = p_tenant_id
    and ppa.programming_id = p_programming_id
    and ppa.is_active = true;

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
      'reason', coalesce(v_save_result ->> 'reason', 'POSTPONE_CREATE_NEW_FAILED'),
      'message', coalesce(v_save_result ->> 'message', 'Falha ao criar a nova programacao para adiamento.')
    );
  end if;

  v_new_programming_id := nullif(v_save_result ->> 'programming_id', '')::uuid;

  if v_new_programming_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 500,
      'reason', 'POSTPONE_NEW_PROGRAMMING_ID_MISSING',
      'message', 'Falha ao recuperar o ID da nova programacao.'
    );
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
