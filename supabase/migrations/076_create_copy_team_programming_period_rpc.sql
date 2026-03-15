-- 076_create_copy_team_programming_period_rpc.sql
-- Centraliza a copia da linha da equipe no periodo visivel em uma RPC transacional.

drop function if exists public.copy_team_programming_period(uuid, uuid, uuid, uuid[], date, date);

create or replace function public.copy_team_programming_period(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_source_team_id uuid,
  p_target_team_ids uuid[],
  p_visible_start_date date,
  p_visible_end_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_team record;
  v_target_team record;
  v_source_item public.project_programming%rowtype;
  v_source_project record;
  v_copy_batch_id uuid;
  v_copy_result jsonb;
  v_target_programming_id uuid;
  v_target_team_ids uuid[];
  v_target_team_id uuid;
  v_target_ids_count integer;
  v_copied_count integer := 0;
  v_source_activities jsonb;
  v_conflicting_row record;
  v_structured_error jsonb;
begin
  if p_tenant_id is null
    or p_actor_user_id is null
    or p_source_team_id is null
    or p_visible_start_date is null
    or p_visible_end_date is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_REQUIRED_FIELDS',
      'message', 'Informe tenant, usuario, equipe de origem e periodo visivel.'
    );
  end if;

  if p_visible_start_date > p_visible_end_date then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_PERIOD',
      'message', 'Periodo visivel invalido para a copia da programacao.'
    );
  end if;

  select array_agg(distinct item) filter (where item is not null)
  into v_target_team_ids
  from unnest(coalesce(p_target_team_ids, array[]::uuid[])) as item;

  v_target_ids_count := coalesce(array_length(v_target_team_ids, 1), 0);
  if v_target_ids_count = 0 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'TARGET_TEAM_REQUIRED',
      'message', 'Selecione ao menos uma equipe de destino para copiar a programacao.'
    );
  end if;

  select
    t.id,
    t.name,
    t.service_center_id
  into v_source_team
  from public.teams t
  where t.tenant_id = p_tenant_id
    and t.id = p_source_team_id
    and t.ativo = true;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'SOURCE_TEAM_NOT_FOUND',
      'message', 'Equipe de origem nao encontrada ou inativa.'
    );
  end if;

  if v_source_team.service_center_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'SOURCE_TEAM_SERVICE_CENTER_REQUIRED',
      'message', 'A equipe de origem precisa ter base vinculada para copiar a programacao.'
    );
  end if;

  if not exists (
    select 1
    from public.project_programming pp
    where pp.tenant_id = p_tenant_id
      and pp.team_id = p_source_team_id
      and pp.status = 'PROGRAMADA'
      and pp.execution_date >= p_visible_start_date
      and pp.execution_date <= p_visible_end_date
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'SOURCE_TEAM_HAS_NO_PROGRAMMING',
      'message', 'A equipe de origem nao possui programacoes ativas no periodo visivel.'
    );
  end if;

  foreach v_target_team_id in array v_target_team_ids loop
    if v_target_team_id = p_source_team_id then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'TARGET_EQUALS_SOURCE',
        'message', 'Nao e permitido copiar para a mesma equipe de origem.'
      );
    end if;

    select
      t.id,
      t.name,
      t.service_center_id
    into v_target_team
    from public.teams t
    where t.tenant_id = p_tenant_id
      and t.id = v_target_team_id
      and t.ativo = true;

    if not found then
      return jsonb_build_object(
        'success', false,
        'status', 404,
        'reason', 'TARGET_TEAM_NOT_FOUND',
        'message', 'Uma das equipes de destino nao existe ou esta inativa.'
      );
    end if;
  end loop;

  for v_source_item in
    select *
    from public.project_programming pp
    where pp.tenant_id = p_tenant_id
      and pp.team_id = p_source_team_id
      and pp.status = 'PROGRAMADA'
      and pp.execution_date >= p_visible_start_date
      and pp.execution_date <= p_visible_end_date
    order by pp.execution_date asc, pp.start_time asc
  loop
    select
      p.id,
      p.sob,
      p.service_center
    into v_source_project
    from public.project p
    where p.tenant_id = p_tenant_id
      and p.id = v_source_item.project_id
      and p.is_active = true;

    if not found then
      return jsonb_build_object(
        'success', false,
        'status', 404,
        'reason', 'PROJECT_NOT_FOUND',
        'message', 'Uma das obras da equipe de origem nao foi encontrada.'
      );
    end if;

    foreach v_target_team_id in array v_target_team_ids loop
      select
        t.id,
        t.name,
        t.service_center_id
      into v_target_team
      from public.teams t
      where t.tenant_id = p_tenant_id
        and t.id = v_target_team_id
        and t.ativo = true;

      if v_target_team.service_center_id <> v_source_project.service_center then
        return jsonb_build_object(
          'success', false,
          'status', 409,
          'reason', 'TEAM_SERVICE_CENTER_MISMATCH',
          'message', format(
            'A equipe %s nao pertence a mesma base da obra %s e nao pode receber a copia.',
            coalesce(v_target_team.name, v_target_team_id::text),
            coalesce(v_source_project.sob, v_source_item.project_id::text)
          )
        );
      end if;

      select
        pp.id,
        p.sob as project_code
      into v_conflicting_row
      from public.project_programming pp
      left join public.project p
        on p.id = pp.project_id
       and p.tenant_id = pp.tenant_id
      where pp.tenant_id = p_tenant_id
        and pp.team_id = v_target_team_id
        and pp.status = 'PROGRAMADA'
        and pp.execution_date = v_source_item.execution_date
        and (
          pp.project_id = v_source_item.project_id
          or (
            v_source_item.start_time < pp.end_time
            and pp.start_time < v_source_item.end_time
          )
        )
      limit 1;

      if found then
        return jsonb_build_object(
          'success', false,
          'status', 409,
          'reason', 'TARGET_TEAM_CONFLICT',
          'message', format(
            'A equipe %s ja possui programacao conflitante em %s.',
            coalesce(v_target_team.name, v_target_team_id::text),
            to_char(v_source_item.execution_date, 'DD/MM/YYYY')
          )
        );
      end if;
    end loop;
  end loop;

  insert into public.project_programming_copy_batches (
    tenant_id,
    project_id,
    source_programming_id,
    source_team_id,
    copy_mode,
    visible_start_date,
    visible_end_date,
    created_by,
    updated_by
  )
  values (
    p_tenant_id,
    null,
    null,
    p_source_team_id,
    'team_period',
    p_visible_start_date,
    p_visible_end_date,
    p_actor_user_id,
    p_actor_user_id
  )
  returning id into v_copy_batch_id;

  for v_source_item in
    select *
    from public.project_programming pp
    where pp.tenant_id = p_tenant_id
      and pp.team_id = p_source_team_id
      and pp.status = 'PROGRAMADA'
      and pp.execution_date >= p_visible_start_date
      and pp.execution_date <= p_visible_end_date
    order by pp.execution_date asc, pp.start_time asc
  loop
    select
      p.id,
      p.sob,
      p.service_center
    into v_source_project
    from public.project p
    where p.tenant_id = p_tenant_id
      and p.id = v_source_item.project_id
      and p.is_active = true;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'catalogId', ppa.service_activity_id,
          'quantity', ppa.quantity
        )
        order by ppa.created_at, ppa.id
      ),
      '[]'::jsonb
    )
    into v_source_activities
    from public.project_programming_activities ppa
    where ppa.tenant_id = p_tenant_id
      and ppa.programming_id = v_source_item.id;

    foreach v_target_team_id in array v_target_team_ids loop
      v_copy_result := public.save_project_programming(
        p_tenant_id,
        p_actor_user_id,
        v_source_item.project_id,
        v_target_team_id,
        v_source_item.execution_date,
        v_source_item.period,
        v_source_item.start_time,
        v_source_item.end_time,
        v_source_item.expected_minutes,
        v_source_item.feeder,
        v_source_item.support,
        v_source_item.note,
        jsonb_build_object(
          'sgd', jsonb_build_object(
            'number', coalesce(v_source_item.sgd_number, ''),
            'deliveredAt', coalesce(v_source_item.sgd_delivered_at::text, '')
          ),
          'pi', jsonb_build_object(
            'number', coalesce(v_source_item.pi_number, ''),
            'deliveredAt', coalesce(v_source_item.pi_delivered_at::text, '')
          ),
          'pep', jsonb_build_object(
            'number', coalesce(v_source_item.pep_number, ''),
            'deliveredAt', coalesce(v_source_item.pep_delivered_at::text, '')
          )
        ),
        v_source_activities,
        null,
        null,
        v_source_item.support_item_id
      );

      if coalesce((v_copy_result ->> 'success')::boolean, false) = false then
        raise exception '%',
          jsonb_build_object(
            'success', false,
            'status', coalesce((v_copy_result ->> 'status')::integer, 400),
            'reason', coalesce(v_copy_result ->> 'reason', 'COPY_FAILED'),
            'message', coalesce(v_copy_result ->> 'message', 'Falha ao copiar programacao para uma das equipes.')
          )::text;
      end if;

      v_target_programming_id := (v_copy_result ->> 'programming_id')::uuid;

      update public.project_programming
      set copied_from_programming_id = v_source_item.id,
          copy_batch_id = v_copy_batch_id,
          updated_by = p_actor_user_id
      where tenant_id = p_tenant_id
        and id = v_target_programming_id;

      insert into public.project_programming_copy_batch_items (
        tenant_id,
        copy_batch_id,
        source_programming_id,
        target_programming_id,
        target_team_id,
        created_by,
        updated_by
      )
      values (
        p_tenant_id,
        v_copy_batch_id,
        v_source_item.id,
        v_target_programming_id,
        v_target_team_id,
        p_actor_user_id,
        p_actor_user_id
      );

      insert into public.app_entity_history (
        tenant_id,
        module_key,
        entity_table,
        entity_id,
        entity_code,
        change_type,
        reason,
        changes,
        metadata,
        created_by,
        updated_by
      )
      values (
        p_tenant_id,
        'programacao',
        'project_programming',
        v_target_programming_id,
        coalesce(v_source_project.sob, v_source_item.project_id::text),
        'UPDATE',
        null,
        jsonb_build_object(
          'copiedFromProgrammingId', jsonb_build_object('from', null, 'to', v_source_item.id),
          'copiedFromTeam', jsonb_build_object('from', v_source_team.name, 'to', (select name from public.teams where id = v_target_team_id and tenant_id = p_tenant_id limit 1)),
          'executionDate', jsonb_build_object('from', null, 'to', v_source_item.execution_date)
        ),
        jsonb_build_object(
          'action', 'COPY',
          'copyBatchId', v_copy_batch_id,
          'copyMode', 'team_period',
          'sourceProgrammingId', v_source_item.id,
          'sourceTeamId', p_source_team_id,
          'targetTeamId', v_target_team_id
        ),
        p_actor_user_id,
        p_actor_user_id
      );

      v_copied_count := v_copied_count + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'copy_batch_id', v_copy_batch_id,
    'copied_count', v_copied_count,
    'message', case
      when v_copied_count = 1 then 'Programacao copiada com sucesso para a equipe selecionada.'
      else format('Programacoes copiadas com sucesso (%s registros).', v_copied_count)
    end
  );
exception
  when others then
    begin
      v_structured_error := nullif(sqlerrm, '')::jsonb;
      return jsonb_build_object(
        'success', false,
        'status', coalesce((v_structured_error ->> 'status')::integer, 500),
        'reason', coalesce(v_structured_error ->> 'reason', 'COPY_TEAM_PROGRAMMING_FAILED'),
        'message', coalesce(v_structured_error ->> 'message', 'Falha ao copiar a linha da equipe no periodo visivel.')
      );
    exception
      when others then
        return jsonb_build_object(
          'success', false,
          'status', 500,
          'reason', 'COPY_TEAM_PROGRAMMING_FAILED',
          'message', 'Falha ao copiar a linha da equipe no periodo visivel.'
        );
    end;
end;
$$;

revoke all on function public.copy_team_programming_period(uuid, uuid, uuid, uuid[], date, date) from public;
grant execute on function public.copy_team_programming_period(uuid, uuid, uuid, uuid[], date, date) to authenticated;
grant execute on function public.copy_team_programming_period(uuid, uuid, uuid, uuid[], date, date) to service_role;
