-- 095_harden_programming_time_and_document_validations.sql
-- Reforca validacoes de horario, datas de documentos e alimentador na camada RPC.

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
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_SGD_APPROVED_AT', 'message', 'Data Aprovada do SGD invalida.');
  end if;
  if v_sgd_requested_raw is not null and v_sgd_requested_raw !~ '^\d{4}-\d{2}-\d{2}$' then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_SGD_REQUESTED_AT', 'message', 'Data Pedido do SGD invalida.');
  end if;
  if v_pi_approved_raw is not null and v_pi_approved_raw !~ '^\d{4}-\d{2}-\d{2}$' then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_PI_APPROVED_AT', 'message', 'Data Aprovada do PI invalida.');
  end if;
  if v_pi_requested_raw is not null and v_pi_requested_raw !~ '^\d{4}-\d{2}-\d{2}$' then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_PI_REQUESTED_AT', 'message', 'Data Pedido do PI invalida.');
  end if;
  if v_pep_approved_raw is not null and v_pep_approved_raw !~ '^\d{4}-\d{2}-\d{2}$' then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_PEP_APPROVED_AT', 'message', 'Data Aprovada do PEP invalida.');
  end if;
  if v_pep_requested_raw is not null and v_pep_requested_raw !~ '^\d{4}-\d{2}-\d{2}$' then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_PEP_REQUESTED_AT', 'message', 'Data Pedido do PEP invalida.');
  end if;

  v_sgd_approved_at := case when v_has_sgd_approved and v_sgd_approved_raw is not null then v_sgd_approved_raw::date else v_programming.sgd_included_at end;
  v_sgd_requested_at := case when v_has_sgd_requested and v_sgd_requested_raw is not null then v_sgd_requested_raw::date else v_programming.sgd_delivered_at end;
  v_pi_approved_at := case when v_has_pi_approved and v_pi_approved_raw is not null then v_pi_approved_raw::date else v_programming.pi_included_at end;
  v_pi_requested_at := case when v_has_pi_requested and v_pi_requested_raw is not null then v_pi_requested_raw::date else v_programming.pi_delivered_at end;
  v_pep_approved_at := case when v_has_pep_approved and v_pep_approved_raw is not null then v_pep_approved_raw::date else v_programming.pep_included_at end;
  v_pep_requested_at := case when v_has_pep_requested and v_pep_requested_raw is not null then v_pep_requested_raw::date else v_programming.pep_delivered_at end;

  if v_sgd_approved_at is not null and v_sgd_requested_at is not null and v_sgd_requested_at > v_sgd_approved_at then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_SGD_REQUESTED_AFTER_APPROVED', 'message', 'Data Pedido do SGD nao pode ser maior que a Data Aprovada.');
  end if;
  if v_pi_approved_at is not null and v_pi_requested_at is not null and v_pi_requested_at > v_pi_approved_at then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_PI_REQUESTED_AFTER_APPROVED', 'message', 'Data Pedido do PI nao pode ser maior que a Data Aprovada.');
  end if;
  if v_pep_approved_at is not null and v_pep_requested_at is not null and v_pep_requested_at > v_pep_approved_at then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_PEP_REQUESTED_AFTER_APPROVED', 'message', 'Data Pedido do PEP nao pode ser maior que a Data Aprovada.');
  end if;

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
  returning updated_at into v_updated_at;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'programming_id', p_programming_id,
    'updated_at', v_updated_at,
    'message', 'Datas de documentos salvas com sucesso.'
  );
end;
$$;

revoke all on function public.set_project_programming_document_dates(uuid, uuid, uuid, jsonb) from public;
grant execute on function public.set_project_programming_document_dates(uuid, uuid, uuid, jsonb) to authenticated;
grant execute on function public.set_project_programming_document_dates(uuid, uuid, uuid, jsonb) to service_role;

drop function if exists public.save_project_programming_full(
  uuid, uuid, uuid, uuid, date, text, time, time, integer, text, text, text, jsonb, jsonb, uuid, timestamptz, uuid, integer, integer, integer, integer, integer, uuid, time, time, text, integer, text
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
  if nullif(btrim(coalesce(p_feeder, '')), '') ~ '^-\d+([.,]\d+)?$' then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_FEEDER',
      'message', 'Alimentador nao pode receber valor negativo.'
    );
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

revoke all on function public.save_project_programming_full(uuid, uuid, uuid, uuid, date, text, time, time, integer, text, text, text, jsonb, jsonb, uuid, timestamptz, uuid, integer, integer, integer, integer, integer, uuid, time, time, text, integer, text) from public;
grant execute on function public.save_project_programming_full(uuid, uuid, uuid, uuid, date, text, time, time, integer, text, text, text, jsonb, jsonb, uuid, timestamptz, uuid, integer, integer, integer, integer, integer, uuid, time, time, text, integer, text) to authenticated;
grant execute on function public.save_project_programming_full(uuid, uuid, uuid, uuid, date, text, time, time, integer, text, text, text, jsonb, jsonb, uuid, timestamptz, uuid, integer, integer, integer, integer, integer, uuid, time, time, text, integer, text) to service_role;
