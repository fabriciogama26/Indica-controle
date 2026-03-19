-- 091_create_programming_full_save_rpcs.sql
-- Consolida o salvamento da Programacao em RPC transacional unica (single e batch)
-- para evitar persistencia parcial entre campos base, estruturais e ENEL.

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
  p_service_description text default null
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
  v_service_result jsonb;
  v_enel_result jsonb;
  v_documents_result jsonb;
  v_structured_error jsonb;
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

  v_service_result := public.set_project_programming_service_description(
    p_tenant_id,
    p_actor_user_id,
    v_programming_id,
    p_service_description
  );

  if coalesce((v_service_result ->> 'success')::boolean, false) = false then
    raise exception '%',
      jsonb_build_object(
        'success', false,
        'status', coalesce((v_service_result ->> 'status')::integer, 400),
        'reason', coalesce(v_service_result ->> 'reason', 'SET_SERVICE_DESCRIPTION_FAILED'),
        'message', coalesce(v_service_result ->> 'message', 'Falha ao salvar descricao do servico da programacao.')
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
  p_service_description text default null
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
      p_service_description
    );

    if coalesce((v_result ->> 'success')::boolean, false) = false then
      raise exception '%',
        jsonb_build_object(
          'success', false,
          'status', coalesce((v_result ->> 'status')::integer, 400),
          'reason', coalesce(v_result ->> 'reason', 'BATCH_FULL_CREATE_FAILED'),
          'message', coalesce(v_result ->> 'message', 'Falha ao cadastrar programacao para uma das equipes.')
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
  text
) to service_role;
