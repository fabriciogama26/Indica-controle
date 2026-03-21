-- 099_harden_programming_batch_full_self_contained.sql
-- Remove a dependencia da RPC de lote em sobrecargas antigas para evitar erro generico em ambientes com migrations parciais.

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
  v_team_ids uuid[];
  v_team_id uuid;
  v_result jsonb;
  v_execution_result jsonb;
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
      p_service_description,
      p_etapa_number,
      p_work_completion_status
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
