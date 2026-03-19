-- 085_add_programming_structure_fields_and_actions_support.sql
-- Adiciona campos estruturais na Programacao e atualiza RPCs de salvamento.

alter table if exists public.project_programming
  add column if not exists poste_qty integer not null default 0;

alter table if exists public.project_programming
  add column if not exists estrutura_qty integer not null default 0;

alter table if exists public.project_programming
  add column if not exists trafo_qty integer not null default 0;

alter table if exists public.project_programming
  add column if not exists rede_qty integer not null default 0;

alter table if exists public.project_programming
  drop constraint if exists project_programming_structure_qty_check;

alter table if exists public.project_programming
  add constraint project_programming_structure_qty_check
  check (
    poste_qty >= 0
    and estrutura_qty >= 0
    and trafo_qty >= 0
    and rede_qty >= 0
  );

drop function if exists public.set_project_programming_structure_quantities(
  uuid,
  uuid,
  uuid,
  integer,
  integer,
  integer,
  integer
);

create or replace function public.set_project_programming_structure_quantities(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_id uuid,
  p_poste_qty integer default 0,
  p_estrutura_qty integer default 0,
  p_trafo_qty integer default 0,
  p_rede_qty integer default 0
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
      'message', 'Programacao invalida para salvar campos estruturais.'
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

  update public.project_programming
  set
    poste_qty = coalesce(p_poste_qty, 0),
    estrutura_qty = coalesce(p_estrutura_qty, 0),
    trafo_qty = coalesce(p_trafo_qty, 0),
    rede_qty = coalesce(p_rede_qty, 0),
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
    'message', 'Campos estruturais salvos com sucesso.'
  );
end;
$$;

revoke all on function public.set_project_programming_structure_quantities(
  uuid,
  uuid,
  uuid,
  integer,
  integer,
  integer,
  integer
) from public;

grant execute on function public.set_project_programming_structure_quantities(
  uuid,
  uuid,
  uuid,
  integer,
  integer,
  integer,
  integer
) to authenticated;

grant execute on function public.set_project_programming_structure_quantities(
  uuid,
  uuid,
  uuid,
  integer,
  integer,
  integer,
  integer
) to service_role;

drop function if exists public.save_project_programming_batch(
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
  uuid
);

drop function if exists public.save_project_programming_batch(
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
  integer
);

create or replace function public.save_project_programming_batch(
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
  p_rede_qty integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_team_ids uuid[];
  v_result jsonb;
  v_programming_id uuid;
  v_project_code text;
  v_inserted_count integer := 0;
  v_programming_ids uuid[] := array[]::uuid[];
  v_items jsonb := '[]'::jsonb;
  v_structured_error jsonb;
begin
  if p_tenant_id is null
    or p_actor_user_id is null
    or p_project_id is null
    or p_execution_date is null
    or p_period is null
    or p_start_time is null
    or p_end_time is null
    or p_expected_minutes is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_REQUIRED_FIELDS',
      'message', 'Preencha os campos obrigatorios da programacao em lote.'
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

  if jsonb_typeof(coalesce(p_documents, '{}'::jsonb)) <> 'object' then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_DOCUMENTS_PAYLOAD',
      'message', 'O bloco de documentos da programacao em lote e invalido.'
    );
  end if;

  if jsonb_typeof(coalesce(p_activities, '[]'::jsonb)) <> 'array' then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_ACTIVITIES_PAYLOAD',
      'message', 'A lista de atividades da programacao em lote e invalida.'
    );
  end if;

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
    v_result := public.save_project_programming(
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
      p_support_item_id
    );

    if coalesce((v_result ->> 'success')::boolean, false) = false then
      raise exception '%',
        jsonb_build_object(
          'success', false,
          'status', coalesce((v_result ->> 'status')::integer, 400),
          'reason', coalesce(v_result ->> 'reason', 'BATCH_CREATE_FAILED'),
          'message', coalesce(v_result ->> 'message', 'Falha ao cadastrar programacao para uma das equipes.')
        )::text;
    end if;

    v_programming_id := nullif(v_result ->> 'programming_id', '')::uuid;
    if v_programming_id is null then
      raise exception '%',
        jsonb_build_object(
          'success', false,
          'status', 500,
          'reason', 'BATCH_CREATE_INVALID_RESULT',
          'message', 'Falha ao recuperar o ID da programacao cadastrada.'
        )::text;
    end if;

    update public.project_programming
    set
      poste_qty = coalesce(p_poste_qty, 0),
      estrutura_qty = coalesce(p_estrutura_qty, 0),
      trafo_qty = coalesce(p_trafo_qty, 0),
      rede_qty = coalesce(p_rede_qty, 0),
      updated_by = p_actor_user_id
    where tenant_id = p_tenant_id
      and id = v_programming_id;

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
        'reason', coalesce(v_structured_error ->> 'reason', 'BATCH_CREATE_FAILED'),
        'message', coalesce(v_structured_error ->> 'message', 'Falha ao cadastrar programacao em lote.')
      );
    exception
      when others then
        return jsonb_build_object(
          'success', false,
          'status', 500,
          'reason', 'BATCH_CREATE_FAILED',
          'message', 'Falha ao cadastrar programacao em lote.'
        );
    end;
end;
$$;

revoke all on function public.save_project_programming_batch(
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
  integer
) from public;

grant execute on function public.save_project_programming_batch(
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
  integer
) to authenticated;

grant execute on function public.save_project_programming_batch(
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
  integer
) to service_role;
