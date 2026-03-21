-- 100_harden_programming_full_self_contained.sql
-- Torna a RPC full da Programacao autocontida, sem depender da migration 090
-- para persistir service_description durante o salvamento transacional.

alter table if exists public.project_programming
  add column if not exists service_description text;

alter table if exists public.project_programming
  drop constraint if exists project_programming_service_description_not_blank;

alter table if exists public.project_programming
  add constraint project_programming_service_description_not_blank
  check (service_description is null or btrim(service_description) <> '');

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
  v_structured_error jsonb;
  v_service_description text := nullif(btrim(coalesce(p_service_description, '')), '');
begin
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
    and id = v_programming_id
  returning updated_at
  into v_updated_at;

  if v_updated_at is null then
    raise exception '%',
      jsonb_build_object(
        'success', false,
        'status', 404,
        'reason', 'PROGRAMMING_NOT_FOUND',
        'message', 'Programacao nao encontrada para salvar descricao do servico.'
      )::text;
  end if;

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

  select pp.updated_at
  into v_updated_at
  from public.project_programming pp
  where pp.tenant_id = p_tenant_id
    and pp.id = v_programming_id;

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
    null
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
