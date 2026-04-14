-- 152_fix_programming_full_overload_recursion_and_add_eq_wrappers.sql
-- Corrige sobrecargas recursivas criadas na migration 151 e cria wrappers estaveis
-- para salvar Ponto eletrico + Nº EQ no mesmo fluxo transacional.

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
  jsonb,
  text,
  uuid
);

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
  text,
  text,
  uuid
);

drop function if exists public.save_project_programming_full_with_electrical_and_eq(
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
  text,
  uuid
);

create or replace function public.save_project_programming_full_with_electrical_and_eq(
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
  p_campo_eletrico text default null,
  p_electrical_eq_catalog_id uuid default null
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
  v_action text;
  v_electrical_result jsonb;
  v_eq_result jsonb;
  v_structured_error jsonb;
begin
  if p_electrical_eq_catalog_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'ELECTRICAL_EQ_REQUIRED',
      'message', 'Selecione o Nº EQ (RE, CO, CF, CC ou TR).'
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
    p_service_description,
    p_etapa_number,
    p_work_completion_status,
    p_history_action_override,
    p_history_reason,
    p_history_metadata
  );

  if coalesce((v_base_result ->> 'success')::boolean, false) = false then
    return v_base_result;
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

  v_action := coalesce(
    nullif(upper(btrim(coalesce(p_history_action_override, ''))), ''),
    case
      when upper(coalesce(v_base_result ->> 'action', 'UPDATE')) = 'INSERT' then 'CREATE'
      else 'UPDATE'
    end
  );

  if v_campo_eletrico is not null then
    v_electrical_result := public.set_project_programming_campo_eletrico(
      p_tenant_id,
      p_actor_user_id,
      v_programming_id,
      v_campo_eletrico,
      v_action,
      p_history_reason,
      p_history_metadata
    );

    if coalesce((v_electrical_result ->> 'success')::boolean, false) = false then
      raise exception '%',
        jsonb_build_object(
          'success', false,
          'status', coalesce((v_electrical_result ->> 'status')::integer, 400),
          'reason', coalesce(v_electrical_result ->> 'reason', 'SET_ELECTRICAL_FIELD_FAILED'),
          'message', coalesce(v_electrical_result ->> 'message', 'Falha ao salvar Ponto eletrico da programacao.')
        )::text;
    end if;
  end if;

  v_eq_result := public.set_project_programming_electrical_eq_catalog(
    p_tenant_id,
    p_actor_user_id,
    v_programming_id,
    p_electrical_eq_catalog_id,
    v_action,
    p_history_reason,
    p_history_metadata
  );

  if coalesce((v_eq_result ->> 'success')::boolean, false) = false then
    raise exception '%',
      jsonb_build_object(
        'success', false,
        'status', coalesce((v_eq_result ->> 'status')::integer, 400),
        'reason', coalesce(v_eq_result ->> 'reason', 'SET_EQ_CATALOG_FAILED'),
        'message', coalesce(v_eq_result ->> 'message', 'Falha ao salvar Nº EQ da programacao.')
      )::text;
  end if;

  return v_base_result || jsonb_build_object(
    'updated_at',
    coalesce(
      v_eq_result ->> 'updated_at',
      v_electrical_result ->> 'updated_at',
      v_base_result ->> 'updated_at'
    )
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

revoke all on function public.save_project_programming_full_with_electrical_and_eq(
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
  text,
  uuid
) from public;

grant execute on function public.save_project_programming_full_with_electrical_and_eq(
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
  text,
  uuid
) to authenticated;

grant execute on function public.save_project_programming_full_with_electrical_and_eq(
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
  text,
  uuid
) to service_role;

drop function if exists public.save_project_programming_batch_full_with_electrical_and_eq(
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
  text,
  uuid
);

create or replace function public.save_project_programming_batch_full_with_electrical_and_eq(
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
  p_campo_eletrico text default null,
  p_electrical_eq_catalog_id uuid default null
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
  v_eq_result jsonb;
  v_structured_error jsonb;
begin
  if p_electrical_eq_catalog_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'ELECTRICAL_EQ_REQUIRED',
      'message', 'Selecione o Nº EQ (RE, CO, CF, CC ou TR).'
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
    return v_base_result;
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

    if v_campo_eletrico is not null then
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
            'message', coalesce(v_electrical_result ->> 'message', 'Falha ao salvar Ponto eletrico em uma das equipes.')
          )::text;
      end if;
    end if;

    v_eq_result := public.set_project_programming_electrical_eq_catalog(
      p_tenant_id,
      p_actor_user_id,
      v_programming_id,
      p_electrical_eq_catalog_id,
      'BATCH_CREATE',
      null,
      jsonb_build_object('source', 'programacao-simples', 'mode', 'batch')
    );

    if coalesce((v_eq_result ->> 'success')::boolean, false) = false then
      raise exception '%',
        jsonb_build_object(
          'success', false,
          'status', coalesce((v_eq_result ->> 'status')::integer, 400),
          'reason', coalesce(v_eq_result ->> 'reason', 'SET_EQ_CATALOG_FAILED'),
          'message', coalesce(v_eq_result ->> 'message', 'Falha ao salvar Nº EQ em uma das equipes.')
        )::text;
    end if;
  end loop;

  return v_base_result;
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

revoke all on function public.save_project_programming_batch_full_with_electrical_and_eq(
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
  text,
  uuid
) from public;

grant execute on function public.save_project_programming_batch_full_with_electrical_and_eq(
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
  text,
  uuid
) to authenticated;

grant execute on function public.save_project_programming_batch_full_with_electrical_and_eq(
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
  text,
  uuid
) to service_role;
