-- 090_add_programming_service_description.sql
-- Adiciona campo de descricao do servico na Programacao
-- e garante persistencia por RPC com suporte ao adiamento.

alter table if exists public.project_programming
  add column if not exists service_description text;

alter table if exists public.project_programming
  drop constraint if exists project_programming_service_description_not_blank;

alter table if exists public.project_programming
  add constraint project_programming_service_description_not_blank
  check (service_description is null or btrim(service_description) <> '');

drop function if exists public.set_project_programming_service_description(
  uuid,
  uuid,
  uuid,
  text
);

create or replace function public.set_project_programming_service_description(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_id uuid,
  p_service_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_programming_id uuid;
  v_updated_at timestamptz;
  v_service_description text := nullif(btrim(coalesce(p_service_description, '')), '');
begin
  if p_programming_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'PROGRAMMING_ID_REQUIRED',
      'message', 'Programacao invalida para salvar descricao do servico.'
    );
  end if;

  update public.project_programming
  set
    service_description = v_service_description,
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
    'message', 'Descricao do servico salva com sucesso.'
  );
end;
$$;

revoke all on function public.set_project_programming_service_description(
  uuid,
  uuid,
  uuid,
  text
) from public;

grant execute on function public.set_project_programming_service_description(
  uuid,
  uuid,
  uuid,
  text
) to authenticated;

grant execute on function public.set_project_programming_service_description(
  uuid,
  uuid,
  uuid,
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
