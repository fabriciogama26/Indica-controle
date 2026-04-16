-- 159_fix_programming_full_wrappers_etapa_flags_recursion.sql
-- Corrige wrappers da 158:
-- 1) elimina chamada recursiva/ambigua por overload;
-- 2) chama funcoes base com assinatura correta (sem campo_eletrico/N EQ);
-- 3) aplica campo_eletrico, N EQ e flags de etapa no mesmo fluxo do wrapper.

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
  uuid,
  boolean,
  boolean
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
  p_electrical_eq_catalog_id uuid default null,
  p_etapa_unica boolean default false,
  p_etapa_final boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campo_eletrico text := nullif(btrim(coalesce(p_campo_eletrico, '')), '');
  v_result jsonb;
  v_programming_id uuid;
  v_action text;
  v_electrical_result jsonb;
  v_eq_result jsonb;
  v_updated_at timestamptz;
  v_structured_error jsonb;
begin
  if coalesce(p_etapa_unica, false) and coalesce(p_etapa_final, false) then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_ETAPA_FLAGS',
      'message', 'Selecione apenas uma opcao: ETAPA UNICA ou ETAPA FINAL.'
    );
  end if;

  if p_electrical_eq_catalog_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'ELECTRICAL_EQ_REQUIRED',
      'message', 'Selecione o tipo do N EQ (RE, CO, CF, CC ou TR).'
    );
  end if;

  v_result := public.save_project_programming_full(
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

  if coalesce((v_result ->> 'success')::boolean, false) = false then
    return v_result;
  end if;

  v_programming_id := nullif(v_result ->> 'programming_id', '')::uuid;
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
      when upper(coalesce(v_result ->> 'action', 'UPDATE')) = 'INSERT' then 'CREATE'
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
        'message', coalesce(v_eq_result ->> 'message', 'Falha ao salvar N EQ da programacao.')
      )::text;
  end if;

  update public.project_programming
  set
    etapa_unica = coalesce(p_etapa_unica, false),
    etapa_final = coalesce(p_etapa_final, false),
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
        'message', 'Programacao nao encontrada para o tenant atual.'
      )::text;
  end if;

  return v_result || jsonb_build_object(
    'updated_at',
    coalesce(
      to_char(v_updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      v_eq_result ->> 'updated_at',
      v_electrical_result ->> 'updated_at',
      v_result ->> 'updated_at'
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
  uuid,
  boolean,
  boolean
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
  uuid,
  boolean,
  boolean
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
  uuid,
  boolean,
  boolean
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
  uuid,
  boolean,
  boolean
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
  p_electrical_eq_catalog_id uuid default null,
  p_etapa_unica boolean default false,
  p_etapa_final boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campo_eletrico text := nullif(btrim(coalesce(p_campo_eletrico, '')), '');
  v_result jsonb;
  v_item jsonb;
  v_programming_id uuid;
  v_electrical_result jsonb;
  v_eq_result jsonb;
  v_structured_error jsonb;
begin
  if coalesce(p_etapa_unica, false) and coalesce(p_etapa_final, false) then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_ETAPA_FLAGS',
      'message', 'Selecione apenas uma opcao: ETAPA UNICA ou ETAPA FINAL.'
    );
  end if;

  if p_electrical_eq_catalog_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'ELECTRICAL_EQ_REQUIRED',
      'message', 'Selecione o tipo do N EQ (RE, CO, CF, CC ou TR).'
    );
  end if;

  v_result := public.save_project_programming_batch_full(
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

  if coalesce((v_result ->> 'success')::boolean, false) = false then
    return v_result;
  end if;

  for v_item in
    select value
    from jsonb_array_elements(coalesce(v_result -> 'items', '[]'::jsonb))
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
          'message', coalesce(v_eq_result ->> 'message', 'Falha ao salvar N EQ em uma das equipes.')
        )::text;
    end if;
  end loop;

  update public.project_programming
  set
    etapa_unica = coalesce(p_etapa_unica, false),
    etapa_final = coalesce(p_etapa_final, false),
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id in (
      select nullif(item ->> 'programmingId', '')::uuid
      from jsonb_array_elements(coalesce(v_result -> 'items', '[]'::jsonb)) item
      where nullif(item ->> 'programmingId', '') is not null
    );

  return v_result;
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
  uuid,
  boolean,
  boolean
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
  uuid,
  boolean,
  boolean
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
  uuid,
  boolean,
  boolean
) to service_role;
