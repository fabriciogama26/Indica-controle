-- 217_copy_programming_to_multiple_dates.sql
-- Copia uma Programacao ativa para multiplas datas com ETAPA informada por destino.

alter table if exists public.project_programming_copy_batches
  drop constraint if exists project_programming_copy_batches_mode_check;

alter table if exists public.project_programming_copy_batches
  add constraint project_programming_copy_batches_mode_check
    check (copy_mode in ('single', 'project_period', 'team_period', 'single_to_dates'));

alter table if exists public.project_programming_copy_batches
  drop constraint if exists project_programming_copy_batches_period_check;

alter table if exists public.project_programming_copy_batches
  add constraint project_programming_copy_batches_period_check
    check (
      (copy_mode = 'single' and visible_start_date is null and visible_end_date is null)
      or (
        copy_mode in ('project_period', 'team_period', 'single_to_dates')
        and visible_start_date is not null
        and visible_end_date is not null
        and visible_start_date <= visible_end_date
      )
    );

alter table if exists public.project_programming_copy_batch_items
  drop constraint if exists project_programming_copy_batch_items_unique_batch_target;

create index if not exists idx_project_programming_copy_batch_items_source_team
  on public.project_programming_copy_batch_items (tenant_id, copy_batch_id, source_programming_id, target_team_id);

drop function if exists public.copy_project_programming_to_dates(uuid, uuid, uuid, timestamptz, jsonb);

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
set search_path = public
as $$
declare
  v_source_item public.project_programming%rowtype;
  v_source_project record;
  v_source_team record;
  v_target jsonb;
  v_target_date date;
  v_target_etapa_number integer;
  v_target_dates date[] := array[]::date[];
  v_target_etapas integer[] := array[]::integer[];
  v_min_target_date date;
  v_max_target_date date;
  v_min_target_etapa integer;
  v_existing_max_stage integer := 0;
  v_existing_stages jsonb := '[]'::jsonb;
  v_existing_dates jsonb := '[]'::jsonb;
  v_source_activities jsonb;
  v_copy_batch_id uuid;
  v_copy_result jsonb;
  v_rede_result jsonb;
  v_history_result jsonb;
  v_target_programming_id uuid;
  v_copied_count integer := 0;
  v_conflicting_row record;
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
  into v_source_item
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

  if v_source_item.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'SOURCE_PROGRAMMING_CONFLICT',
      'message', 'Esta programacao foi alterada por outro usuario. Recarregue a grade antes de copiar.'
    );
  end if;

  if v_source_item.status not in ('PROGRAMADA', 'REPROGRAMADA') then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'SOURCE_PROGRAMMING_INACTIVE',
      'message', 'Somente programacoes ativas podem ser copiadas para outras datas.'
    );
  end if;

  if coalesce(v_source_item.etapa_unica, false) or coalesce(v_source_item.etapa_final, false) then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'SOURCE_ETAPA_FLAG_BLOCKED',
      'message', 'Programacoes marcadas como ETAPA UNICA ou ETAPA FINAL nao podem ser copiadas para outras datas.'
    );
  end if;

  if v_source_item.etapa_number is null or v_source_item.etapa_number < 1 then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'SOURCE_ETAPA_REQUIRED',
      'message', 'A programacao de origem precisa ter uma ETAPA numerica para permitir copia incrementada.'
    );
  end if;

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
      'message', 'Projeto da programacao de origem nao encontrado ou inativo.'
    );
  end if;

  select
    t.id,
    t.name,
    t.service_center_id
  into v_source_team
  from public.teams t
  where t.tenant_id = p_tenant_id
    and t.id = v_source_item.team_id
    and t.ativo = true;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'TEAM_NOT_FOUND',
      'message', 'Equipe da programacao de origem nao encontrada ou inativa.'
    );
  end if;

  if exists (
    select 1
    from public.project_programming pp
    where pp.tenant_id = p_tenant_id
      and pp.project_id = v_source_item.project_id
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

  for v_target in select value from jsonb_array_elements(p_targets) loop
    if coalesce(v_target ->> 'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'INVALID_TARGET_DATE',
        'message', 'Informe uma Data destino valida para cada copia.'
      );
    end if;

    if coalesce(v_target ->> 'etapaNumber', '') !~ '^\d+$' then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'INVALID_TARGET_ETAPA',
        'message', 'Informe uma ETAPA numerica para cada data destino.'
      );
    end if;

    v_target_date := (v_target ->> 'date')::date;
    v_target_etapa_number := (v_target ->> 'etapaNumber')::integer;

    if v_target_date = v_source_item.execution_date then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'TARGET_EQUALS_SOURCE_DATE',
        'message', 'A data original da programacao nao pode ser selecionada como destino da copia.'
      );
    end if;

    if v_target_date = any(v_target_dates) then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'DUPLICATED_TARGET_DATE',
        'message', 'Cada data destino deve aparecer apenas uma vez.'
      );
    end if;

    if v_target_etapa_number < 1 then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'INVALID_TARGET_ETAPA',
        'message', 'A ETAPA deve ser um numero inteiro maior que zero.'
      );
    end if;

    if v_target_etapa_number = any(v_target_etapas) then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'DUPLICATED_TARGET_ETAPA',
        'message', 'Cada data destino deve receber uma ETAPA diferente.'
      );
    end if;

    if v_target_etapa_number <= v_source_item.etapa_number then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'TARGET_ETAPA_NOT_INCREMENTED',
        'message', format('As ETAPAs de destino devem ser maiores que a etapa atual (%s).', v_source_item.etapa_number)
      );
    end if;

    v_target_dates := array_append(v_target_dates, v_target_date);
    v_target_etapas := array_append(v_target_etapas, v_target_etapa_number);
  end loop;

  select min(item), max(item)
  into v_min_target_date, v_max_target_date
  from unnest(v_target_dates) as item;

  select min(item)
  into v_min_target_etapa
  from unnest(v_target_etapas) as item;

  select coalesce(max(pp.etapa_number), 0)
  into v_existing_max_stage
  from public.project_programming pp
  where pp.tenant_id = p_tenant_id
    and pp.project_id = v_source_item.project_id
    and pp.team_id = v_source_item.team_id
    and pp.etapa_number is not null;

  if v_min_target_etapa <= v_existing_max_stage then
    select coalesce(jsonb_agg(stage order by stage), '[]'::jsonb)
    into v_existing_stages
    from (
      select distinct pp.etapa_number as stage
      from public.project_programming pp
      where pp.tenant_id = p_tenant_id
        and pp.project_id = v_source_item.project_id
        and pp.team_id = v_source_item.team_id
        and pp.etapa_number is not null
        and pp.etapa_number >= v_min_target_etapa
    ) stages;

    select coalesce(jsonb_agg(execution_date order by execution_date), '[]'::jsonb)
    into v_existing_dates
    from (
      select distinct pp.execution_date
      from public.project_programming pp
      where pp.tenant_id = p_tenant_id
        and pp.project_id = v_source_item.project_id
        and pp.team_id = v_source_item.team_id
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
      'teams', jsonb_build_array(
        jsonb_build_object(
          'teamId', v_source_item.team_id,
          'teamName', coalesce(v_source_team.name, v_source_item.team_id::text),
          'highestStage', v_existing_max_stage,
          'existingStages', v_existing_stages,
          'existingDates', v_existing_dates
        )
      ),
      'message', 'A ETAPA informada ja existe ou esta abaixo do historico encontrado para este projeto/equipe.'
    );
  end if;

  foreach v_target_date in array v_target_dates loop
    select
      pp.id,
      p.sob as project_code
    into v_conflicting_row
    from public.project_programming pp
    left join public.project p
      on p.id = pp.project_id
     and p.tenant_id = pp.tenant_id
    where pp.tenant_id = p_tenant_id
      and pp.team_id = v_source_item.team_id
      and pp.status in ('PROGRAMADA', 'REPROGRAMADA')
      and pp.execution_date = v_target_date
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
        'reason', 'TARGET_DATE_CONFLICT',
        'message', format(
          'A equipe %s ja possui programacao conflitante em %s.',
          coalesce(v_source_team.name, v_source_item.team_id::text),
          to_char(v_target_date, 'DD/MM/YYYY')
        )
      );
    end if;
  end loop;

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
    and ppa.programming_id = v_source_item.id
    and ppa.is_active = true;

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
    v_source_item.project_id,
    v_source_item.id,
    v_source_item.team_id,
    'single_to_dates',
    v_min_target_date,
    v_max_target_date,
    p_actor_user_id,
    p_actor_user_id
  )
  returning id into v_copy_batch_id;

  for v_target in select value from jsonb_array_elements(p_targets) loop
    v_target_date := (v_target ->> 'date')::date;
    v_target_etapa_number := (v_target ->> 'etapaNumber')::integer;

    v_copy_result := public.save_project_programming_full_with_electrical_and_eq(
      p_tenant_id => p_tenant_id,
      p_actor_user_id => p_actor_user_id,
      p_project_id => v_source_item.project_id,
      p_team_id => v_source_item.team_id,
      p_execution_date => v_target_date,
      p_period => v_source_item.period,
      p_start_time => v_source_item.start_time,
      p_end_time => v_source_item.end_time,
      p_expected_minutes => v_source_item.expected_minutes,
      p_feeder => v_source_item.feeder,
      p_support => v_source_item.support,
      p_note => v_source_item.note,
      p_documents => jsonb_build_object(
        'sgd', jsonb_build_object(
          'number', coalesce(v_source_item.sgd_number, ''),
          'approvedAt', coalesce(v_source_item.sgd_included_at::text, ''),
          'requestedAt', coalesce(v_source_item.sgd_delivered_at::text, ''),
          'includedAt', coalesce(v_source_item.sgd_included_at::text, ''),
          'deliveredAt', coalesce(v_source_item.sgd_delivered_at::text, '')
        ),
        'pi', jsonb_build_object(
          'number', coalesce(v_source_item.pi_number, ''),
          'approvedAt', coalesce(v_source_item.pi_included_at::text, ''),
          'requestedAt', coalesce(v_source_item.pi_delivered_at::text, ''),
          'includedAt', coalesce(v_source_item.pi_included_at::text, ''),
          'deliveredAt', coalesce(v_source_item.pi_delivered_at::text, '')
        ),
        'pep', jsonb_build_object(
          'number', coalesce(v_source_item.pep_number, ''),
          'approvedAt', coalesce(v_source_item.pep_included_at::text, ''),
          'requestedAt', coalesce(v_source_item.pep_delivered_at::text, ''),
          'includedAt', coalesce(v_source_item.pep_included_at::text, ''),
          'deliveredAt', coalesce(v_source_item.pep_delivered_at::text, '')
        )
      ),
      p_activities => v_source_activities,
      p_programming_id => null,
      p_expected_updated_at => null,
      p_support_item_id => v_source_item.support_item_id,
      p_poste_qty => coalesce(v_source_item.poste_qty, 0),
      p_estrutura_qty => coalesce(v_source_item.estrutura_qty, 0),
      p_trafo_qty => coalesce(v_source_item.trafo_qty, 0),
      p_rede_qty => trunc(coalesce(v_source_item.rede_qty, 0))::integer,
      p_affected_customers => coalesce(v_source_item.affected_customers, 0),
      p_sgd_type_id => v_source_item.sgd_type_id,
      p_outage_start_time => v_source_item.outage_start_time,
      p_outage_end_time => v_source_item.outage_end_time,
      p_service_description => v_source_item.service_description,
      p_etapa_number => v_target_etapa_number,
      p_work_completion_status => null,
      p_history_action_override => 'COPY',
      p_history_reason => 'Copia de programacao para outras datas.',
      p_history_metadata => jsonb_build_object(
        'source', 'programacao-api',
        'copyMode', 'single_to_dates',
        'copyBatchId', v_copy_batch_id,
        'sourceProgrammingId', v_source_item.id,
        'sourceExecutionDate', v_source_item.execution_date,
        'targetExecutionDate', v_target_date
      ),
      p_campo_eletrico => v_source_item.campo_eletrico,
      p_electrical_eq_catalog_id => v_source_item.electrical_eq_catalog_id,
      p_etapa_unica => false,
      p_etapa_final => false
    );

    if coalesce((v_copy_result ->> 'success')::boolean, false) = false then
      raise exception '%',
        jsonb_build_object(
          'success', false,
          'status', coalesce((v_copy_result ->> 'status')::integer, 400),
          'reason', coalesce(v_copy_result ->> 'reason', 'COPY_TO_DATES_FAILED'),
          'message', coalesce(v_copy_result ->> 'message', 'Falha ao copiar programacao para uma das datas.')
        )::text;
    end if;

    v_target_programming_id := nullif(v_copy_result ->> 'programming_id', '')::uuid;
    if v_target_programming_id is null then
      raise exception '%',
        jsonb_build_object(
          'success', false,
          'status', 500,
          'reason', 'COPY_TO_DATES_INVALID_RESULT',
          'message', 'Falha ao recuperar o ID da programacao copiada.'
        )::text;
    end if;

    update public.project_programming
    set copied_from_programming_id = v_source_item.id,
        copy_batch_id = v_copy_batch_id,
        updated_by = p_actor_user_id,
        updated_at = now()
    where tenant_id = p_tenant_id
      and id = v_target_programming_id;

    v_rede_result := public.set_project_programming_rede_qty_decimal(
      p_tenant_id,
      p_actor_user_id,
      v_target_programming_id,
      coalesce(v_source_item.rede_qty, 0),
      'COPY',
      'Copia de programacao para outras datas.',
      jsonb_build_object(
        'source', 'programacao-api',
        'copyMode', 'single_to_dates',
        'copyBatchId', v_copy_batch_id,
        'sourceProgrammingId', v_source_item.id,
        'sourceExecutionDate', v_source_item.execution_date,
        'targetExecutionDate', v_target_date
      )
    );

    if coalesce((v_rede_result ->> 'success')::boolean, false) = false then
      raise exception '%',
        jsonb_build_object(
          'success', false,
          'status', coalesce((v_rede_result ->> 'status')::integer, 400),
          'reason', coalesce(v_rede_result ->> 'reason', 'SET_REDE_DECIMAL_FAILED'),
          'message', coalesce(v_rede_result ->> 'message', 'Falha ao preservar REDE decimal da programacao copiada.')
        )::text;
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
      v_source_item.id,
      v_target_programming_id,
      v_source_item.team_id,
      p_actor_user_id,
      p_actor_user_id
    );

    v_history_result := public.append_project_programming_history_record(
      p_tenant_id => p_tenant_id,
      p_actor_user_id => p_actor_user_id,
      p_programming_id => v_target_programming_id,
      p_project_id => v_source_item.project_id,
      p_team_id => v_source_item.team_id,
      p_related_programming_id => v_source_item.id,
      p_action_type => 'COPY',
      p_reason => 'Copia de programacao para outras datas.',
      p_changes => jsonb_build_object(
        'copiedFromProgrammingId', jsonb_build_object('from', null, 'to', v_source_item.id),
        'executionDate', jsonb_build_object('from', v_source_item.execution_date, 'to', v_target_date),
        'etapaNumber', jsonb_build_object('from', v_source_item.etapa_number, 'to', v_target_etapa_number)
      ),
      p_metadata => jsonb_build_object(
        'source', 'programacao-api',
        'action', 'COPY_TO_DATES',
        'copyBatchId', v_copy_batch_id,
        'copyMode', 'single_to_dates',
        'sourceProgrammingId', v_source_item.id,
        'sourceTeamId', v_source_item.team_id,
        'targetTeamId', v_source_item.team_id,
        'sourceExecutionDate', v_source_item.execution_date,
        'targetExecutionDate', v_target_date
      ),
      p_from_status => v_source_item.status,
      p_to_status => 'PROGRAMADA',
      p_from_execution_date => v_source_item.execution_date,
      p_to_execution_date => v_target_date,
      p_from_team_id => v_source_item.team_id,
      p_to_team_id => v_source_item.team_id,
      p_from_start_time => v_source_item.start_time,
      p_to_start_time => v_source_item.start_time,
      p_from_end_time => v_source_item.end_time,
      p_to_end_time => v_source_item.end_time,
      p_from_etapa_number => v_source_item.etapa_number,
      p_to_etapa_number => v_target_etapa_number
    );

    if coalesce((v_history_result ->> 'success')::boolean, false) = false then
      raise exception '%',
        jsonb_build_object(
          'success', false,
          'status', coalesce((v_history_result ->> 'status')::integer, 500),
          'reason', coalesce(v_history_result ->> 'reason', 'APPEND_PROGRAMMING_HISTORY_FAILED'),
          'message', coalesce(v_history_result ->> 'message', 'Falha ao registrar historico da copia da programacao.')
        )::text;
    end if;

    v_copied_count := v_copied_count + 1;
  end loop;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'copy_batch_id', v_copy_batch_id,
    'copied_count', v_copied_count,
    'message', case
      when v_copied_count = 1 then 'Programacao copiada com sucesso para 1 data.'
      else format('Programacao copiada com sucesso para %s datas.', v_copied_count)
    end
  );
exception
  when others then
    begin
      v_structured_error := nullif(sqlerrm, '')::jsonb;
      return jsonb_build_object(
        'success', false,
        'status', coalesce((v_structured_error ->> 'status')::integer, 500),
        'reason', coalesce(v_structured_error ->> 'reason', 'COPY_TO_DATES_FAILED'),
        'message', coalesce(v_structured_error ->> 'message', 'Falha ao copiar programacao para as datas selecionadas.')
      );
    exception
      when others then
        return jsonb_build_object(
          'success', false,
          'status', 500,
          'reason', 'COPY_TO_DATES_FAILED',
          'message', 'Falha ao copiar programacao para as datas selecionadas.'
        );
    end;
end;
$$;

revoke all on function public.copy_project_programming_to_dates(uuid, uuid, uuid, timestamptz, jsonb) from public;
grant execute on function public.copy_project_programming_to_dates(uuid, uuid, uuid, timestamptz, jsonb) to authenticated;
grant execute on function public.copy_project_programming_to_dates(uuid, uuid, uuid, timestamptz, jsonb) to service_role;
