-- 274_transactional_copy_programming_to_dates_selected_teams.sql
-- Torna COPY_TO_DATES atomico para multiplas datas e equipes.
--
-- Regra:
-- - valida todos os destinos antes da primeira escrita;
-- - cria lote, programacoes, vinculos e historico dentro da mesma RPC;
-- - qualquer falha levanta excecao interna e o bloco PL/pgSQL faz rollback integral.

create or replace function public.copy_project_programming_to_dates(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_source_programming_id uuid,
  p_expected_updated_at timestamptz,
  p_targets jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source public.project_programming%rowtype;
  v_model public.project_programming%rowtype;
  v_target jsonb;
  v_target_date date;
  v_target_etapa_number integer;
  v_target_dates date[] := array[]::date[];
  v_target_etapas integer[] := array[]::integer[];
  v_target_team_ids uuid[];
  v_target_team_id uuid;
  v_target_team_text text;
  v_all_target_team_ids uuid[] := array[]::uuid[];
  v_targets_normalized jsonb := '[]'::jsonb;
  v_min_target_date date;
  v_max_target_date date;
  v_min_target_etapa integer;
  v_team record;
  v_existing_max_stage integer;
  v_existing_stages jsonb;
  v_existing_dates jsonb;
  v_conflicting_row record;
  v_previous_completed_id uuid;
  v_is_anticipated boolean;
  v_activities jsonb;
  v_save_result jsonb;
  v_anticipated_result jsonb;
  v_copy_batch_id uuid;
  v_target_programming_id uuid;
  v_copied_ids uuid[] := array[]::uuid[];
  v_copied_count integer := 0;
  v_structured_error jsonb;
begin
  if p_tenant_id is null
    or p_actor_user_id is null
    or p_source_programming_id is null
    or p_expected_updated_at is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_REQUIRED_FIELDS',
      'message', 'Informe tenant, usuario, programacao de origem e versao esperada.'
    );
  end if;

  if p_targets is null or jsonb_typeof(p_targets) <> 'array' or jsonb_array_length(p_targets) = 0 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'TARGET_DATES_REQUIRED',
      'message', 'Informe ao menos uma data destino para copiar a programacao.'
    );
  end if;

  select *
  into v_source
  from public.project_programming pp
  where pp.tenant_id = p_tenant_id
    and pp.id = p_source_programming_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'SOURCE_PROGRAMMING_NOT_FOUND',
      'message', 'Programacao de origem nao encontrada.'
    );
  end if;

  if date_trunc('milliseconds', v_source.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'SOURCE_PROGRAMMING_CONFLICT',
      'message', 'Esta programacao foi alterada por outro usuario. Recarregue a grade antes de copiar.'
    );
  end if;

  if v_source.status not in ('PROGRAMADA', 'REPROGRAMADA') then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'SOURCE_PROGRAMMING_INACTIVE',
      'message', 'Somente programacoes ativas podem ser copiadas para outras datas.'
    );
  end if;

  if v_source.etapa_number is null or v_source.etapa_number < 1 or coalesce(v_source.etapa_unica, false) or coalesce(v_source.etapa_final, false) then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'SOURCE_ETAPA_REQUIRED',
      'message', 'A programacao de origem precisa ter ETAPA numerica e nao pode ser ETAPA UNICA/FINAL para copiar.'
    );
  end if;

  if exists (
    select 1
    from public.project_programming pp
    where pp.tenant_id = p_tenant_id
      and pp.project_id = v_source.project_id
      and pp.work_completion_status is not null
      and (
        public.normalize_programming_work_completion_code(pp.work_completion_status) in ('CONCLUIDO', 'COMPLETO')
        or public.normalize_programming_work_completion_code(pp.work_completion_status) like 'CONCLUIDO%'
      )
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'PROJECT_COMPLETED_REQUIRES_REOPEN',
      'message', 'Este projeto esta com Estado Trabalho CONCLUIDO. Antes de copiar a programacao, altere o Estado Trabalho para diferente de CONCLUIDO.'
    );
  end if;

  for v_target in select item.value from jsonb_array_elements(p_targets) as item(value) loop
    if coalesce(v_target ->> 'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_TARGET_DATE', 'message', 'Informe uma Data destino valida para cada copia.');
    end if;

    if coalesce(v_target ->> 'etapaNumber', '') !~ '^\d+$' then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_TARGET_ETAPA', 'message', 'Informe uma ETAPA numerica para cada data destino.');
    end if;

    v_target_date := (v_target ->> 'date')::date;
    v_target_etapa_number := (v_target ->> 'etapaNumber')::integer;
    v_target_team_ids := array[]::uuid[];

    if v_target_date = v_source.execution_date then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'TARGET_EQUALS_SOURCE_DATE', 'message', 'A data original da programacao nao pode ser selecionada como destino da copia.');
    end if;

    if v_target_date = any(v_target_dates) then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'DUPLICATED_TARGET_DATE', 'message', 'Cada data destino deve aparecer apenas uma vez.');
    end if;

    if v_target_etapa_number < 1 then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_TARGET_ETAPA', 'message', 'A ETAPA deve ser um numero inteiro maior que zero.');
    end if;

    if v_target_etapa_number = any(v_target_etapas) then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'DUPLICATED_TARGET_ETAPA', 'message', 'Cada data destino deve receber uma ETAPA diferente.');
    end if;

    if v_target_etapa_number <= v_source.etapa_number then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'TARGET_ETAPA_NOT_INCREMENTED', 'message', format('As ETAPAs de destino devem ser maiores que a etapa atual (%s).', v_source.etapa_number));
    end if;

    if jsonb_typeof(v_target -> 'teamIds') = 'array' and jsonb_array_length(v_target -> 'teamIds') > 0 then
      for v_target_team_text in select team_item.value from jsonb_array_elements_text(v_target -> 'teamIds') as team_item(value) loop
        if v_target_team_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
          return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_TARGET_TEAM', 'message', 'Uma das equipes destino e invalida.');
        end if;

        v_target_team_id := v_target_team_text::uuid;
        if not (v_target_team_id = any(v_target_team_ids)) then
          v_target_team_ids := array_append(v_target_team_ids, v_target_team_id);
        end if;
      end loop;
    else
      v_target_team_ids := array[v_source.team_id];
    end if;

    if array_length(v_target_team_ids, 1) is null then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'TARGET_TEAMS_REQUIRED', 'message', 'Informe ao menos uma equipe para cada data destino.');
    end if;

    foreach v_target_team_id in array v_target_team_ids loop
      if not (v_target_team_id = any(v_all_target_team_ids)) then
        v_all_target_team_ids := array_append(v_all_target_team_ids, v_target_team_id);
      end if;
    end loop;

    v_target_dates := array_append(v_target_dates, v_target_date);
    v_target_etapas := array_append(v_target_etapas, v_target_etapa_number);
    v_targets_normalized := v_targets_normalized || jsonb_build_array(
      jsonb_build_object(
        'date', v_target_date,
        'etapaNumber', v_target_etapa_number,
        'teamIds', to_jsonb(v_target_team_ids)
      )
    );
  end loop;

  select min(item.value), max(item.value)
  into v_min_target_date, v_max_target_date
  from unnest(v_target_dates) as item(value);

  select min(item.value)
  into v_min_target_etapa
  from unnest(v_target_etapas) as item(value);

  if (
    select count(*)
    from public.teams t
    where t.tenant_id = p_tenant_id
      and t.ativo = true
      and t.id = any(v_all_target_team_ids)
  ) <> array_length(v_all_target_team_ids, 1) then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'TARGET_TEAM_NOT_FOUND', 'message', 'Uma ou mais equipes selecionadas estao inativas ou nao pertencem ao tenant atual.');
  end if;

  for v_team in
    select t.id, t.name
    from public.teams t
    where t.tenant_id = p_tenant_id
      and t.id = any(v_all_target_team_ids)
    order by t.name nulls last, t.id
  loop
    select min((target_item.value ->> 'etapaNumber')::integer)
    into v_min_target_etapa
    from jsonb_array_elements(v_targets_normalized) as target_item(value)
    where exists (
      select 1
      from jsonb_array_elements_text(target_item.value -> 'teamIds') as team_item(value)
      where team_item.value::uuid = v_team.id
    );

    select coalesce(max(pp.etapa_number), 0)
    into v_existing_max_stage
    from public.project_programming pp
    where pp.tenant_id = p_tenant_id
      and pp.project_id = v_source.project_id
      and pp.team_id = v_team.id
      and pp.etapa_number is not null;

    if v_existing_max_stage >= v_min_target_etapa then
      select coalesce(jsonb_agg(stage order by stage), '[]'::jsonb)
      into v_existing_stages
      from (
        select distinct pp.etapa_number as stage
        from public.project_programming pp
        where pp.tenant_id = p_tenant_id
          and pp.project_id = v_source.project_id
          and pp.team_id = v_team.id
          and pp.etapa_number is not null
          and pp.etapa_number >= v_min_target_etapa
      ) stages;

      select coalesce(jsonb_agg(execution_date order by execution_date), '[]'::jsonb)
      into v_existing_dates
      from (
        select distinct pp.execution_date
        from public.project_programming pp
        where pp.tenant_id = p_tenant_id
          and pp.project_id = v_source.project_id
          and pp.team_id = v_team.id
          and pp.etapa_number is not null
          and pp.etapa_number >= v_min_target_etapa
      ) dates;

      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'ETAPA_CONFLICT',
        'enteredEtapaNumber', v_min_target_etapa,
        'hasConflict', true,
        'highestStage', v_existing_max_stage,
        'teams', jsonb_build_array(jsonb_build_object(
          'teamId', v_team.id,
          'teamName', coalesce(v_team.name, v_team.id::text),
          'highestStage', v_existing_max_stage,
          'existingStages', v_existing_stages,
          'existingDates', v_existing_dates
        )),
        'message', 'A ETAPA informada ja existe ou esta abaixo do historico encontrado para uma ou mais equipes.'
      );
    end if;
  end loop;

  for v_target in select item.value from jsonb_array_elements(v_targets_normalized) as item(value) loop
    v_target_date := (v_target ->> 'date')::date;
    v_target_etapa_number := (v_target ->> 'etapaNumber')::integer;

    for v_target_team_text in select team_item.value from jsonb_array_elements_text(v_target -> 'teamIds') as team_item(value) loop
      v_target_team_id := v_target_team_text::uuid;

      select *
      into v_model
      from public.project_programming pp
      where pp.tenant_id = p_tenant_id
        and pp.programming_group_id = v_source.programming_group_id
        and pp.team_id = v_target_team_id
        and pp.status in ('PROGRAMADA', 'REPROGRAMADA')
      order by pp.created_at asc, pp.id asc
      limit 1;

      if not found then
        v_model := v_source;
      end if;

      select pp.id, pp.project_id
      into v_conflicting_row
      from public.project_programming pp
      where pp.tenant_id = p_tenant_id
        and pp.team_id = v_target_team_id
        and pp.execution_date = v_target_date
        and pp.status in ('PROGRAMADA', 'REPROGRAMADA')
        and (
          pp.project_id = v_source.project_id
          or (
            v_model.start_time < pp.end_time
            and pp.start_time < v_model.end_time
          )
        )
      limit 1;

      if found then
        return jsonb_build_object(
          'success', false,
          'status', 409,
          'reason', 'TARGET_DATE_CONFLICT',
          'message', format('A equipe %s ja possui programacao conflitante em %s.', v_target_team_id::text, to_char(v_target_date, 'DD/MM/YYYY'))
        );
      end if;

      v_is_anticipated := public.normalize_programming_work_completion_code(v_model.work_completion_status) = 'ANTECIPADO';
      if v_is_anticipated then
        select pp.id
        into v_previous_completed_id
        from public.project_programming pp
        where pp.tenant_id = p_tenant_id
          and pp.project_id = v_source.project_id
          and pp.status in ('PROGRAMADA', 'REPROGRAMADA')
          and pp.etapa_number is not null
          and pp.etapa_number < v_target_etapa_number
          and (
            public.normalize_programming_work_completion_code(pp.work_completion_status) in ('CONCLUIDO', 'COMPLETO')
            or public.normalize_programming_work_completion_code(pp.work_completion_status) like 'CONCLUIDO%'
          )
        order by pp.etapa_number desc, pp.updated_at desc, pp.created_at desc
        limit 1;

        if v_previous_completed_id is null then
          return jsonb_build_object(
            'success', false,
            'status', 409,
            'reason', 'ANTICIPATED_SOURCE_NOT_FOUND',
            'message', 'Nao existe CONCLUIDO anterior valido para copiar uma programacao ANTECIPADO nesta ETAPA.'
          );
        end if;
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
    v_source.project_id,
    v_source.id,
    v_source.team_id,
    'single_to_dates',
    v_min_target_date,
    v_max_target_date,
    p_actor_user_id,
    p_actor_user_id
  )
  returning id into v_copy_batch_id;

  for v_target in select item.value from jsonb_array_elements(v_targets_normalized) as item(value) loop
    v_target_date := (v_target ->> 'date')::date;
    v_target_etapa_number := (v_target ->> 'etapaNumber')::integer;

    for v_target_team_text in select team_item.value from jsonb_array_elements_text(v_target -> 'teamIds') as team_item(value) loop
      v_target_team_id := v_target_team_text::uuid;

      select *
      into v_model
      from public.project_programming pp
      where pp.tenant_id = p_tenant_id
        and pp.programming_group_id = v_source.programming_group_id
        and pp.team_id = v_target_team_id
        and pp.status in ('PROGRAMADA', 'REPROGRAMADA')
      order by pp.created_at asc, pp.id asc
      limit 1;

      if not found then
        v_model := v_source;
      end if;

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
      into v_activities
      from public.project_programming_activities ppa
      where ppa.tenant_id = p_tenant_id
        and ppa.programming_id = v_model.id
        and ppa.is_active = true;

      v_is_anticipated := public.normalize_programming_work_completion_code(v_model.work_completion_status) = 'ANTECIPADO';
      v_previous_completed_id := null;

      if v_is_anticipated then
        select pp.id
        into v_previous_completed_id
        from public.project_programming pp
        where pp.tenant_id = p_tenant_id
          and pp.project_id = v_source.project_id
          and pp.status in ('PROGRAMADA', 'REPROGRAMADA')
          and pp.etapa_number is not null
          and pp.etapa_number < v_target_etapa_number
          and (
            public.normalize_programming_work_completion_code(pp.work_completion_status) in ('CONCLUIDO', 'COMPLETO')
            or public.normalize_programming_work_completion_code(pp.work_completion_status) like 'CONCLUIDO%'
          )
        order by pp.etapa_number desc, pp.updated_at desc, pp.created_at desc
        limit 1;
      end if;

      v_save_result := public.save_project_programming_full_decimal_with_electrical_and_eq(
        p_tenant_id => p_tenant_id,
        p_actor_user_id => p_actor_user_id,
        p_project_id => v_source.project_id,
        p_team_id => v_target_team_id,
        p_execution_date => v_target_date,
        p_period => v_model.period,
        p_start_time => v_model.start_time,
        p_end_time => v_model.end_time,
        p_expected_minutes => v_model.expected_minutes,
        p_feeder => v_model.feeder,
        p_support => v_model.support,
        p_note => v_model.note,
        p_documents => jsonb_build_object(
          'sgd', jsonb_build_object('number', coalesce(v_model.sgd_number, ''), 'approvedAt', coalesce(v_model.sgd_included_at::text, ''), 'requestedAt', coalesce(v_model.sgd_delivered_at::text, ''), 'includedAt', coalesce(v_model.sgd_included_at::text, ''), 'deliveredAt', coalesce(v_model.sgd_delivered_at::text, '')),
          'pi', jsonb_build_object('number', coalesce(v_model.pi_number, ''), 'approvedAt', coalesce(v_model.pi_included_at::text, ''), 'requestedAt', coalesce(v_model.pi_delivered_at::text, ''), 'includedAt', coalesce(v_model.pi_included_at::text, ''), 'deliveredAt', coalesce(v_model.pi_delivered_at::text, '')),
          'pep', jsonb_build_object('number', coalesce(v_model.pep_number, ''), 'approvedAt', coalesce(v_model.pep_included_at::text, ''), 'requestedAt', coalesce(v_model.pep_delivered_at::text, ''), 'includedAt', coalesce(v_model.pep_included_at::text, ''), 'deliveredAt', coalesce(v_model.pep_delivered_at::text, ''))
        ),
        p_activities => v_activities,
        p_programming_id => null,
        p_expected_updated_at => null,
        p_support_item_id => v_model.support_item_id,
        p_poste_qty => coalesce(v_model.poste_qty, 0),
        p_estrutura_qty => coalesce(v_model.estrutura_qty, 0),
        p_trafo_qty => coalesce(v_model.trafo_qty, 0),
        p_rede_qty => coalesce(v_model.rede_qty, 0),
        p_affected_customers => coalesce(v_model.affected_customers, 0),
        p_sgd_type_id => v_model.sgd_type_id,
        p_outage_start_time => v_model.outage_start_time,
        p_outage_end_time => v_model.outage_end_time,
        p_service_description => v_model.service_description,
        p_etapa_number => v_target_etapa_number,
        p_work_completion_status => case when v_is_anticipated then null else v_model.work_completion_status end,
        p_history_action_override => 'COPY',
        p_history_reason => 'Copia de programacao para outras datas.',
        p_history_metadata => jsonb_build_object(
          'source', 'programacao-api',
          'action', 'COPY_TO_DATES',
          'copyMode', 'single_to_dates_selected_teams',
          'copyBatchId', v_copy_batch_id,
          'selectedFromProgrammingId', v_source.id,
          'sourceProgrammingId', v_model.id,
          'sourceTeamId', v_model.team_id,
          'targetTeamId', v_target_team_id,
          'sourceExecutionDate', v_model.execution_date,
          'targetExecutionDate', v_target_date,
          'targetEtapaNumber', v_target_etapa_number
        ),
        p_campo_eletrico => v_model.campo_eletrico,
        p_electrical_eq_catalog_id => v_model.electrical_eq_catalog_id,
        p_etapa_unica => false,
        p_etapa_final => false,
        p_copied_from_programming_id => v_model.id,
        p_copy_batch_id => v_copy_batch_id
      );

      if coalesce((v_save_result ->> 'success')::boolean, false) = false then
        raise exception '%', jsonb_build_object(
          'success', false,
          'status', coalesce((v_save_result ->> 'status')::integer, 400),
          'reason', coalesce(v_save_result ->> 'reason', 'COPY_TO_DATES_ITEM_FAILED'),
          'message', coalesce(v_save_result ->> 'message', 'Falha ao copiar uma das programacoes do lote.'),
          'detail', v_save_result ->> 'detail'
        )::text;
      end if;

      v_target_programming_id := nullif(v_save_result ->> 'programming_id', '')::uuid;
      if v_target_programming_id is null then
        raise exception '%', jsonb_build_object('success', false, 'status', 500, 'reason', 'COPY_TO_DATES_INVALID_RESULT', 'message', 'Falha ao recuperar o ID da programacao copiada.')::text;
      end if;

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
        v_model.id,
        v_target_programming_id,
        v_target_team_id,
        p_actor_user_id,
        p_actor_user_id
      );

      if v_is_anticipated then
        v_anticipated_result := public.mark_project_programming_stage_anticipated(
          p_tenant_id => p_tenant_id,
          p_actor_user_id => p_actor_user_id,
          p_target_programming_id => v_target_programming_id,
          p_source_programming_id => v_previous_completed_id
        );

        if coalesce((v_anticipated_result ->> 'success')::boolean, false) = false then
          raise exception '%', jsonb_build_object(
            'success', false,
            'status', coalesce((v_anticipated_result ->> 'status')::integer, 400),
            'reason', coalesce(v_anticipated_result ->> 'reason', 'ANTICIPATED_COPY_FAILED'),
            'message', coalesce(v_anticipated_result ->> 'message', 'Falha ao marcar copia como ANTECIPADO.'),
            'detail', v_anticipated_result ->> 'detail'
          )::text;
        end if;
      end if;

      v_copied_ids := array_append(v_copied_ids, v_target_programming_id);
      v_copied_count := v_copied_count + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'copy_batch_id', v_copy_batch_id,
    'copied_count', v_copied_count,
    'copied_programming_ids', to_jsonb(v_copied_ids),
    'source_count', array_length(v_all_target_team_ids, 1),
    'message', format('Programacao copiada para %s equipe(s), totalizando %s registro(s).', array_length(v_all_target_team_ids, 1), v_copied_count)
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
      'reason', coalesce(v_structured_error ->> 'reason', 'COPY_TO_DATES_FAILED'),
      'message', coalesce(v_structured_error ->> 'message', 'Falha ao copiar programacao para as datas selecionadas.'),
      'detail', case when v_structured_error is null then sqlerrm else coalesce(v_structured_error ->> 'detail', v_structured_error ->> 'message') end
    );
end;
$$;

revoke all on function public.copy_project_programming_to_dates(uuid, uuid, uuid, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.copy_project_programming_to_dates(uuid, uuid, uuid, timestamptz, jsonb) to service_role;
