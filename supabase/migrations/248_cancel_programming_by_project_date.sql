-- 248_cancel_programming_by_project_date.sql
-- Cancela atomicamente todas as programacoes ativas do mesmo Projeto + Data.

drop function if exists public.cancel_project_programming_group(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz
);

create or replace function public.cancel_project_programming_group(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_id uuid,
  p_reason text default null,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_source record;
  v_item record;
  v_result jsonb;
  v_cancelled_programming_ids uuid[] := array[]::uuid[];
  v_affected_count integer := 0;
  v_updated_at timestamptz;
  v_structured_error jsonb;
begin
  if p_programming_id is null or v_reason is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_CANCEL_GROUP_PAYLOAD',
      'message', 'Informe a programacao e o motivo do cancelamento.'
    );
  end if;

  select
    pp.id,
    pp.project_id,
    pp.team_id,
    pp.execution_date,
    pp.updated_at,
    pp.status,
    p.sob
  into v_source
  from public.project_programming pp
  join public.project p
    on p.id = pp.project_id
   and p.tenant_id = pp.tenant_id
  where pp.tenant_id = p_tenant_id
    and pp.id = p_programming_id
    and pp.status in ('PROGRAMADA', 'REPROGRAMADA')
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'PROGRAMMING_NOT_FOUND',
      'message', 'Programacao nao encontrada ou nao esta mais ativa para cancelamento.'
    );
  end if;

  if p_expected_updated_at is not null
    and date_trunc('milliseconds', v_source.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'PROGRAMMING_CONFLICT',
      'message', 'Esta programacao foi alterada por outro usuario. Atualize a grade antes de continuar.',
      'programming_id', p_programming_id
    );
  end if;

  for v_item in
    select id, team_id
    from public.project_programming
    where tenant_id = p_tenant_id
      and project_id = v_source.project_id
      and execution_date = v_source.execution_date
      and status in ('PROGRAMADA', 'REPROGRAMADA')
    order by team_id, id
    for update
  loop
    v_result := public.set_project_programming_status(
      p_tenant_id,
      p_actor_user_id,
      v_item.id,
      'CANCELADA',
      v_reason,
      case when v_item.id = v_source.id then p_expected_updated_at else null end
    );

    if coalesce((v_result ->> 'success')::boolean, false) = false then
      raise exception '%', jsonb_build_object(
        'success', false,
        'status', coalesce((v_result ->> 'status')::integer, 400),
        'reason', coalesce(v_result ->> 'reason', 'CANCEL_GROUP_ITEM_FAILED'),
        'message', coalesce(v_result ->> 'message', 'Falha ao cancelar uma das programacoes do mesmo projeto e data.'),
        'detail', v_result ->> 'detail',
        'programming_id', v_item.id
      )::text;
    end if;

    v_cancelled_programming_ids := array_append(
      v_cancelled_programming_ids,
      coalesce(nullif(v_result ->> 'programming_id', '')::uuid, v_item.id)
    );

    v_affected_count := v_affected_count + 1;
  end loop;

  if v_affected_count = 0 then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'PROGRAMMING_GROUP_NOT_FOUND',
      'message', 'Nenhuma programacao ativa encontrada para este projeto e data.'
    );
  end if;

  select updated_at
  into v_updated_at
  from public.project_programming
  where tenant_id = p_tenant_id
    and id = p_programming_id;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'programming_id', p_programming_id,
    'project_code', coalesce(v_source.sob, ''),
    'updated_at', v_updated_at,
    'programming_status', 'CANCELADA',
    'affected_count', v_affected_count,
    'cancelled_programming_ids', to_jsonb(v_cancelled_programming_ids),
    'message',
      format(
        '%s programacao(oes) do projeto %s em %s cancelada(s) com sucesso.',
        v_affected_count,
        coalesce(v_source.sob, v_source.project_id::text),
        to_char(v_source.execution_date, 'DD/MM/YYYY')
      )
  );
exception
  when others then
    begin
      v_structured_error := sqlerrm::jsonb;
    exception
      when others then
        v_structured_error := jsonb_build_object(
          'success', false,
          'status', 500,
          'reason', 'CANCEL_GROUP_FAILED',
          'message', 'Falha ao cancelar programacoes do mesmo projeto e data.',
          'detail', sqlerrm
        );
    end;

    return v_structured_error;
end;
$$;

revoke all on function public.cancel_project_programming_group(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.cancel_project_programming_group(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz
) to service_role;

do $$
declare
  v_function_oid oid :=
    'public.cancel_project_programming_group(uuid,uuid,uuid,text,timestamp with time zone)'
      ::regprocedure::oid;
begin
  if has_function_privilege('anon', v_function_oid, 'EXECUTE')
    or has_function_privilege('authenticated', v_function_oid, 'EXECUTE') then
    raise exception
      'cancel_project_programming_group nao pode ser executada por anon/authenticated';
  end if;

  if not has_function_privilege('service_role', v_function_oid, 'EXECUTE') then
    raise exception
      'cancel_project_programming_group deve permanecer executavel por service_role';
  end if;
end;
$$;
