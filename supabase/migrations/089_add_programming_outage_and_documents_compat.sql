-- 089_add_programming_outage_and_documents_compat.sql
-- Adiciona janela de desligamento, torna Tipo de SGD obrigatorio
-- e ajusta compatibilidade de documentos para Data Aprovada/Data Pedido.

alter table if exists public.project_programming
  add column if not exists outage_start_time time;

alter table if exists public.project_programming
  add column if not exists outage_end_time time;

alter table if exists public.project_programming
  drop constraint if exists project_programming_outage_window_check;

alter table if exists public.project_programming
  add constraint project_programming_outage_window_check
  check (
    (outage_start_time is null and outage_end_time is null)
    or (
      outage_start_time is not null
      and outage_end_time is not null
      and outage_end_time > outage_start_time
    )
  );

alter table if exists public.project_programming
  drop constraint if exists project_programming_sgd_document_check;

alter table if exists public.project_programming
  add constraint project_programming_sgd_document_check
  check (
    (
      nullif(btrim(coalesce(sgd_number, '')), '') is null
      and sgd_included_at is null
      and sgd_delivered_at is null
    )
    or (
      nullif(btrim(coalesce(sgd_number, '')), '') is not null
      and sgd_included_at is not null
    )
  );

alter table if exists public.project_programming
  drop constraint if exists project_programming_pi_document_check;

alter table if exists public.project_programming
  add constraint project_programming_pi_document_check
  check (
    (
      nullif(btrim(coalesce(pi_number, '')), '') is null
      and pi_included_at is null
      and pi_delivered_at is null
    )
    or (
      nullif(btrim(coalesce(pi_number, '')), '') is not null
      and pi_included_at is not null
    )
  );

alter table if exists public.project_programming
  drop constraint if exists project_programming_pep_document_check;

alter table if exists public.project_programming
  add constraint project_programming_pep_document_check
  check (
    (
      nullif(btrim(coalesce(pep_number, '')), '') is null
      and pep_included_at is null
      and pep_delivered_at is null
    )
    or (
      nullif(btrim(coalesce(pep_number, '')), '') is not null
      and pep_included_at is not null
    )
  );

drop function if exists public.set_project_programming_outage_window(
  uuid,
  uuid,
  uuid,
  time,
  time
);

create or replace function public.set_project_programming_outage_window(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_id uuid,
  p_outage_start_time time default null,
  p_outage_end_time time default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_programming_id uuid;
  v_updated_at timestamptz;
begin
  if p_programming_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'PROGRAMMING_ID_REQUIRED',
      'message', 'Programacao invalida para salvar janela de desligamento.'
    );
  end if;

  if (p_outage_start_time is null and p_outage_end_time is not null)
    or (p_outage_start_time is not null and p_outage_end_time is null) then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'OUTAGE_WINDOW_INCOMPLETE',
      'message', 'Informe inicio e termino de desligamento.'
    );
  end if;

  if p_outage_start_time is not null
    and p_outage_end_time is not null
    and p_outage_end_time <= p_outage_start_time then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'OUTAGE_WINDOW_INVALID',
      'message', 'Termino de desligamento deve ser maior que inicio.'
    );
  end if;

  update public.project_programming
  set
    outage_start_time = p_outage_start_time,
    outage_end_time = p_outage_end_time,
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
    'message', 'Janela de desligamento salva com sucesso.'
  );
end;
$$;

revoke all on function public.set_project_programming_outage_window(
  uuid,
  uuid,
  uuid,
  time,
  time
) from public;

grant execute on function public.set_project_programming_outage_window(
  uuid,
  uuid,
  uuid,
  time,
  time
) to authenticated;

grant execute on function public.set_project_programming_outage_window(
  uuid,
  uuid,
  uuid,
  time,
  time
) to service_role;

drop function if exists public.set_project_programming_document_dates(
  uuid,
  uuid,
  uuid,
  jsonb
);

create or replace function public.set_project_programming_document_dates(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_id uuid,
  p_documents jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_programming public.project_programming%rowtype;
  v_documents jsonb := coalesce(p_documents, '{}'::jsonb);
  v_sgd jsonb := coalesce(v_documents -> 'sgd', '{}'::jsonb);
  v_pi jsonb := coalesce(v_documents -> 'pi', '{}'::jsonb);
  v_pep jsonb := coalesce(v_documents -> 'pep', '{}'::jsonb);
  v_sgd_approved_raw text;
  v_sgd_requested_raw text;
  v_pi_approved_raw text;
  v_pi_requested_raw text;
  v_pep_approved_raw text;
  v_pep_requested_raw text;
  v_sgd_approved_at date;
  v_sgd_requested_at date;
  v_pi_approved_at date;
  v_pi_requested_at date;
  v_pep_approved_at date;
  v_pep_requested_at date;
  v_updated_at timestamptz;
  v_has_sgd_approved boolean;
  v_has_sgd_requested boolean;
  v_has_pi_approved boolean;
  v_has_pi_requested boolean;
  v_has_pep_approved boolean;
  v_has_pep_requested boolean;
begin
  if p_programming_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'PROGRAMMING_ID_REQUIRED',
      'message', 'Programacao invalida para salvar datas de documentos.'
    );
  end if;

  if jsonb_typeof(v_documents) <> 'object' then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_DOCUMENTS_PAYLOAD',
      'message', 'O bloco de documentos da programacao e invalido.'
    );
  end if;

  select *
  into v_programming
  from public.project_programming pp
  where pp.tenant_id = p_tenant_id
    and pp.id = p_programming_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'PROGRAMMING_NOT_FOUND',
      'message', 'Programacao nao encontrada para o tenant atual.'
    );
  end if;

  v_has_sgd_approved := (v_sgd ? 'approvedAt') or (v_sgd ? 'includedAt');
  v_has_sgd_requested := (v_sgd ? 'requestedAt') or (v_sgd ? 'deliveredAt');
  v_has_pi_approved := (v_pi ? 'approvedAt') or (v_pi ? 'includedAt');
  v_has_pi_requested := (v_pi ? 'requestedAt') or (v_pi ? 'deliveredAt');
  v_has_pep_approved := (v_pep ? 'approvedAt') or (v_pep ? 'includedAt');
  v_has_pep_requested := (v_pep ? 'requestedAt') or (v_pep ? 'deliveredAt');

  v_sgd_approved_raw := nullif(btrim(coalesce(v_sgd ->> 'approvedAt', v_sgd ->> 'includedAt', '')), '');
  v_sgd_requested_raw := nullif(btrim(coalesce(v_sgd ->> 'requestedAt', v_sgd ->> 'deliveredAt', '')), '');
  v_pi_approved_raw := nullif(btrim(coalesce(v_pi ->> 'approvedAt', v_pi ->> 'includedAt', '')), '');
  v_pi_requested_raw := nullif(btrim(coalesce(v_pi ->> 'requestedAt', v_pi ->> 'deliveredAt', '')), '');
  v_pep_approved_raw := nullif(btrim(coalesce(v_pep ->> 'approvedAt', v_pep ->> 'includedAt', '')), '');
  v_pep_requested_raw := nullif(btrim(coalesce(v_pep ->> 'requestedAt', v_pep ->> 'deliveredAt', '')), '');

  if v_sgd_approved_raw is not null and v_sgd_approved_raw !~ '^\d{4}-\d{2}-\d{2}$' then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_SGD_APPROVED_AT',
      'message', 'Data Aprovada do SGD invalida.'
    );
  end if;

  if v_sgd_requested_raw is not null and v_sgd_requested_raw !~ '^\d{4}-\d{2}-\d{2}$' then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_SGD_REQUESTED_AT',
      'message', 'Data Pedido do SGD invalida.'
    );
  end if;

  if v_pi_approved_raw is not null and v_pi_approved_raw !~ '^\d{4}-\d{2}-\d{2}$' then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_PI_APPROVED_AT',
      'message', 'Data Aprovada do PI invalida.'
    );
  end if;

  if v_pi_requested_raw is not null and v_pi_requested_raw !~ '^\d{4}-\d{2}-\d{2}$' then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_PI_REQUESTED_AT',
      'message', 'Data Pedido do PI invalida.'
    );
  end if;

  if v_pep_approved_raw is not null and v_pep_approved_raw !~ '^\d{4}-\d{2}-\d{2}$' then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_PEP_APPROVED_AT',
      'message', 'Data Aprovada do PEP invalida.'
    );
  end if;

  if v_pep_requested_raw is not null and v_pep_requested_raw !~ '^\d{4}-\d{2}-\d{2}$' then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_PEP_REQUESTED_AT',
      'message', 'Data Pedido do PEP invalida.'
    );
  end if;

  v_sgd_approved_at := case
    when v_has_sgd_approved and v_sgd_approved_raw is not null then v_sgd_approved_raw::date
    else v_programming.sgd_included_at
  end;

  v_sgd_requested_at := case
    when v_has_sgd_requested and v_sgd_requested_raw is not null then v_sgd_requested_raw::date
    else v_programming.sgd_delivered_at
  end;

  v_pi_approved_at := case
    when v_has_pi_approved and v_pi_approved_raw is not null then v_pi_approved_raw::date
    else v_programming.pi_included_at
  end;

  v_pi_requested_at := case
    when v_has_pi_requested and v_pi_requested_raw is not null then v_pi_requested_raw::date
    else v_programming.pi_delivered_at
  end;

  v_pep_approved_at := case
    when v_has_pep_approved and v_pep_approved_raw is not null then v_pep_approved_raw::date
    else v_programming.pep_included_at
  end;

  v_pep_requested_at := case
    when v_has_pep_requested and v_pep_requested_raw is not null then v_pep_requested_raw::date
    else v_programming.pep_delivered_at
  end;

  if nullif(btrim(coalesce(v_programming.sgd_number, '')), '') is null then
    v_sgd_approved_at := null;
    v_sgd_requested_at := null;
  elsif v_sgd_approved_at is null then
    v_sgd_approved_at := coalesce(v_programming.sgd_included_at, current_date);
  end if;

  if nullif(btrim(coalesce(v_programming.pi_number, '')), '') is null then
    v_pi_approved_at := null;
    v_pi_requested_at := null;
  elsif v_pi_approved_at is null then
    v_pi_approved_at := coalesce(v_programming.pi_included_at, current_date);
  end if;

  if nullif(btrim(coalesce(v_programming.pep_number, '')), '') is null then
    v_pep_approved_at := null;
    v_pep_requested_at := null;
  elsif v_pep_approved_at is null then
    v_pep_approved_at := coalesce(v_programming.pep_included_at, current_date);
  end if;

  update public.project_programming
  set
    sgd_included_at = v_sgd_approved_at,
    sgd_delivered_at = v_sgd_requested_at,
    pi_included_at = v_pi_approved_at,
    pi_delivered_at = v_pi_requested_at,
    pep_included_at = v_pep_approved_at,
    pep_delivered_at = v_pep_requested_at,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = p_programming_id
  returning updated_at
  into v_updated_at;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'programming_id', p_programming_id,
    'updated_at', v_updated_at,
    'message', 'Datas de documentos salvas com sucesso.'
  );
end;
$$;

revoke all on function public.set_project_programming_document_dates(
  uuid,
  uuid,
  uuid,
  jsonb
) from public;

grant execute on function public.set_project_programming_document_dates(
  uuid,
  uuid,
  uuid,
  jsonb
) to authenticated;

grant execute on function public.set_project_programming_document_dates(
  uuid,
  uuid,
  uuid,
  jsonb
) to service_role;

drop function if exists public.set_project_programming_enel_fields(
  uuid,
  uuid,
  uuid,
  integer,
  uuid
);

create or replace function public.set_project_programming_enel_fields(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_id uuid,
  p_affected_customers integer default 0,
  p_sgd_type_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_programming_id uuid;
  v_updated_at timestamptz;
begin
  if p_programming_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'PROGRAMMING_ID_REQUIRED',
      'message', 'Programacao invalida para salvar campos ENEL.'
    );
  end if;

  if coalesce(p_affected_customers, 0) < 0 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_AFFECTED_CUSTOMERS',
      'message', 'Nº Clientes Afetados deve ser maior ou igual a zero.'
    );
  end if;

  if p_sgd_type_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'SGD_TYPE_REQUIRED',
      'message', 'Tipo de SGD e obrigatorio para salvar a programacao.'
    );
  end if;

  if not exists (
    select 1
    from public.programming_sgd_types pst
    where pst.tenant_id = p_tenant_id
      and pst.id = p_sgd_type_id
      and pst.is_active = true
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_SGD_TYPE',
      'message', 'Tipo de SGD invalido para o tenant atual.'
    );
  end if;

  update public.project_programming
  set
    affected_customers = coalesce(p_affected_customers, 0),
    sgd_type_id = p_sgd_type_id,
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
    'message', 'Campos ENEL salvos com sucesso.'
  );
end;
$$;

revoke all on function public.set_project_programming_enel_fields(
  uuid,
  uuid,
  uuid,
  integer,
  uuid
) from public;

grant execute on function public.set_project_programming_enel_fields(
  uuid,
  uuid,
  uuid,
  integer,
  uuid
) to authenticated;

grant execute on function public.set_project_programming_enel_fields(
  uuid,
  uuid,
  uuid,
  integer,
  uuid
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