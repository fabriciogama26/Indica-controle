-- 249_save_copy_source_in_programming_full_rpc.sql
-- Permite gravar o vinculo direto origem -> copia dentro da transacao da RPC full.

drop function if exists public.save_project_programming_full_decimal_with_electrical_and_eq(
  uuid, uuid, uuid, uuid, date, text, time, time, integer, text, text, text,
  jsonb, jsonb, uuid, timestamptz, uuid, integer, integer, integer, numeric,
  integer, uuid, time, time, text, integer, text, text, text, jsonb, text,
  uuid, boolean, boolean
);

create or replace function public.save_project_programming_full_decimal_with_electrical_and_eq(
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
  p_rede_qty numeric default 0,
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
  p_etapa_final boolean default false,
  p_copied_from_programming_id uuid default null,
  p_copy_batch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_rede_result jsonb;
  v_programming_id uuid;
  v_history_action text;
  v_structured_error jsonb;
begin
  if p_rede_qty is not null and (p_rede_qty::text = 'NaN' or p_rede_qty < 0) then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_REDE_QTY',
      'message', 'REDE deve ser um numero maior ou igual a zero.'
    );
  end if;

  if p_copied_from_programming_id is not null and not exists (
    select 1
    from public.project_programming pp
    where pp.tenant_id = p_tenant_id
      and pp.id = p_copied_from_programming_id
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'COPY_SOURCE_NOT_FOUND',
      'message', 'Programacao de origem da copia nao encontrada no tenant atual.'
    );
  end if;

  if p_copy_batch_id is not null and not exists (
    select 1
    from public.project_programming_copy_batches batch
    where batch.tenant_id = p_tenant_id
      and batch.id = p_copy_batch_id
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'COPY_BATCH_NOT_FOUND',
      'message', 'Lote de copia nao encontrado no tenant atual.'
    );
  end if;

  v_result := public.save_project_programming_full_with_electrical_and_eq(
    p_tenant_id => p_tenant_id,
    p_actor_user_id => p_actor_user_id,
    p_project_id => p_project_id,
    p_team_id => p_team_id,
    p_execution_date => p_execution_date,
    p_period => p_period,
    p_start_time => p_start_time,
    p_end_time => p_end_time,
    p_expected_minutes => p_expected_minutes,
    p_feeder => p_feeder,
    p_support => p_support,
    p_note => p_note,
    p_documents => p_documents,
    p_activities => p_activities,
    p_programming_id => p_programming_id,
    p_expected_updated_at => p_expected_updated_at,
    p_support_item_id => p_support_item_id,
    p_poste_qty => p_poste_qty,
    p_estrutura_qty => p_estrutura_qty,
    p_trafo_qty => p_trafo_qty,
    p_rede_qty => trunc(coalesce(p_rede_qty, 0))::integer,
    p_affected_customers => p_affected_customers,
    p_sgd_type_id => p_sgd_type_id,
    p_outage_start_time => p_outage_start_time,
    p_outage_end_time => p_outage_end_time,
    p_service_description => p_service_description,
    p_etapa_number => p_etapa_number,
    p_work_completion_status => p_work_completion_status,
    p_history_action_override => p_history_action_override,
    p_history_reason => p_history_reason,
    p_history_metadata => p_history_metadata,
    p_campo_eletrico => p_campo_eletrico,
    p_electrical_eq_catalog_id => p_electrical_eq_catalog_id,
    p_etapa_unica => p_etapa_unica,
    p_etapa_final => p_etapa_final
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

  if p_copied_from_programming_id is not null or p_copy_batch_id is not null then
    update public.project_programming
    set copied_from_programming_id = p_copied_from_programming_id,
        copy_batch_id = p_copy_batch_id,
        updated_by = p_actor_user_id,
        updated_at = now()
    where tenant_id = p_tenant_id
      and id = v_programming_id;
  end if;

  v_history_action := coalesce(
    nullif(upper(btrim(coalesce(p_history_action_override, ''))), ''),
    case
      when upper(coalesce(v_result ->> 'action', 'UPDATE')) = 'INSERT' then 'CREATE'
      else 'UPDATE'
    end
  );

  v_rede_result := public.set_project_programming_rede_qty_decimal(
    p_tenant_id,
    p_actor_user_id,
    v_programming_id,
    coalesce(p_rede_qty, 0),
    v_history_action,
    p_history_reason,
    coalesce(p_history_metadata, '{}'::jsonb) ||
      jsonb_build_object(
        'source', 'save-project-programming-full-decimal',
        'copiedFromProgrammingId', p_copied_from_programming_id,
        'copyBatchId', p_copy_batch_id
      )
  );

  if coalesce((v_rede_result ->> 'success')::boolean, false) = false then
    raise exception '%',
      jsonb_build_object(
        'success', false,
        'status', coalesce((v_rede_result ->> 'status')::integer, 400),
        'reason', coalesce(v_rede_result ->> 'reason', 'SET_REDE_DECIMAL_FAILED'),
        'message', coalesce(v_rede_result ->> 'message', 'Falha ao salvar REDE decimal da programacao.')
      )::text;
  end if;

  return v_result || jsonb_build_object(
    'updated_at',
    coalesce(v_rede_result ->> 'updated_at', v_result ->> 'updated_at'),
    'copied_from_programming_id',
    p_copied_from_programming_id,
    'copy_batch_id',
    p_copy_batch_id
  );
exception
  when others then
    if left(ltrim(sqlerrm), 1) = '{' then
      begin
        v_structured_error := sqlerrm::jsonb;
      exception
        when others then
          v_structured_error := null;
      end;
    else
      v_structured_error := null;
    end if;

    return jsonb_build_object(
      'success', false,
      'status', coalesce((v_structured_error ->> 'status')::integer, 500),
      'reason', coalesce(v_structured_error ->> 'reason', 'SAVE_PROGRAMMING_FULL_DECIMAL_FAILED'),
      'message', coalesce(v_structured_error ->> 'message', 'Falha ao salvar programacao com REDE decimal.'),
      'detail', case
        when v_structured_error is null then sqlerrm
        else coalesce(v_structured_error ->> 'detail', v_structured_error ->> 'message')
      end
    );
end;
$$;

revoke all on function public.save_project_programming_full_decimal_with_electrical_and_eq(
  uuid, uuid, uuid, uuid, date, text, time, time, integer, text, text, text,
  jsonb, jsonb, uuid, timestamptz, uuid, integer, integer, integer, numeric,
  integer, uuid, time, time, text, integer, text, text, text, jsonb, text,
  uuid, boolean, boolean, uuid, uuid
) from public, anon, authenticated;

grant execute on function public.save_project_programming_full_decimal_with_electrical_and_eq(
  uuid, uuid, uuid, uuid, date, text, time, time, integer, text, text, text,
  jsonb, jsonb, uuid, timestamptz, uuid, integer, integer, integer, numeric,
  integer, uuid, time, time, text, integer, text, text, text, jsonb, text,
  uuid, boolean, boolean, uuid, uuid
) to service_role;

do $$
declare
  v_function_oid oid :=
    'public.save_project_programming_full_decimal_with_electrical_and_eq(uuid,uuid,uuid,uuid,date,text,time,time,integer,text,text,text,jsonb,jsonb,uuid,timestamp with time zone,uuid,integer,integer,integer,numeric,integer,uuid,time,time,text,integer,text,text,text,jsonb,text,uuid,boolean,boolean,uuid,uuid)'
      ::regprocedure::oid;
begin
  if has_function_privilege('anon', v_function_oid, 'EXECUTE')
    or has_function_privilege('authenticated', v_function_oid, 'EXECUTE') then
    raise exception
      'save_project_programming_full_decimal_with_electrical_and_eq nao pode ser executada por anon/authenticated';
  end if;

  if not has_function_privilege('service_role', v_function_oid, 'EXECUTE') then
    raise exception
      'save_project_programming_full_decimal_with_electrical_and_eq deve permanecer executavel por service_role';
  end if;
end;
$$;
