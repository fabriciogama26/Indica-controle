-- 286_transfer_programming_team.sql
--
-- Regra:
-- - Transferir equipe nao altera o status da programacao/grupo de origem.
-- - Apenas a linha da equipe transferida fica TRANSFERIDA e inativa.
-- - A equipe transferida entra como nova linha ativa na programacao destino.
-- - A operacao inteira deve ser transacional e rastreavel no historico.

alter table if exists public.project_programming
  drop constraint if exists project_programming_status_check;

alter table if exists public.project_programming
  add constraint project_programming_status_check
  check (status in ('PROGRAMADA', 'REPROGRAMADA', 'ADIADA', 'CANCELADA', 'ANTECIPADA', 'TRANSFERIDA'));

alter table if exists public.project_programming
  drop constraint if exists project_programming_status_fields_check;

alter table if exists public.project_programming
  add constraint project_programming_status_fields_check
  check (
    (
      status in ('PROGRAMADA', 'REPROGRAMADA')
      and is_active = true
      and cancellation_reason is null
      and canceled_at is null
      and canceled_by is null
    )
    or (
      status in ('ADIADA', 'CANCELADA', 'TRANSFERIDA')
      and is_active = false
      and nullif(btrim(coalesce(cancellation_reason, '')), '') is not null
      and canceled_at is not null
      and canceled_by is not null
    )
    or (
      status = 'ANTECIPADA'
      and is_active = false
      and cancellation_reason is null
      and canceled_at is null
      and canceled_by is null
    )
  );

create or replace function public.enforce_interrupted_programming_completed_work_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new_work_status text := public.normalize_programming_work_completion_code(new.work_completion_status);
  v_old_work_status text := null;
  v_new_id_status text;
  v_old_id_status text;
  v_new_is_completed boolean := false;
  v_old_is_completed boolean := false;
  v_is_new_interrupted_row boolean := false;
  v_status_changed_to_interrupted boolean := false;
begin
  if new.status not in ('ADIADA', 'CANCELADA', 'TRANSFERIDA') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_is_new_interrupted_row := true;
    v_status_changed_to_interrupted := true;
  elsif tg_op = 'UPDATE' then
    v_old_work_status := public.normalize_programming_work_completion_code(old.work_completion_status);
    v_is_new_interrupted_row := coalesce(old.status, '') not in ('ADIADA', 'CANCELADA', 'TRANSFERIDA');
    v_status_changed_to_interrupted := coalesce(old.status, '') is distinct from coalesce(new.status, '');
  end if;

  if new.work_completion_status_id is not null then
    select public.normalize_programming_work_completion_code(c.code)
    into v_new_id_status
    from public.programming_work_completion_catalog c
    where c.tenant_id = new.tenant_id
      and c.id = new.work_completion_status_id
    limit 1;
  end if;

  if tg_op = 'UPDATE' and old.work_completion_status_id is not null then
    select public.normalize_programming_work_completion_code(c.code)
    into v_old_id_status
    from public.programming_work_completion_catalog c
    where c.tenant_id = old.tenant_id
      and c.id = old.work_completion_status_id
    limit 1;
  end if;

  v_new_is_completed := coalesce(
    v_new_work_status in ('CONCLUIDO', 'COMPLETO')
    or v_new_work_status like 'CONCLUIDO%'
    or v_new_id_status in ('CONCLUIDO', 'COMPLETO')
    or v_new_id_status like 'CONCLUIDO%',
    false
  );

  v_old_is_completed := coalesce(
    v_old_work_status in ('CONCLUIDO', 'COMPLETO')
    or v_old_work_status like 'CONCLUIDO%'
    or v_old_id_status in ('CONCLUIDO', 'COMPLETO')
    or v_old_id_status like 'CONCLUIDO%',
    false
  );

  if v_is_new_interrupted_row
    and coalesce(v_new_is_completed or v_old_is_completed, false) then
    raise exception 'Projeto com Estado Trabalho CONCLUIDO nao pode ser interrompido ou transferido.'
      using errcode = '23514';
  end if;

  if v_status_changed_to_interrupted and exists (
    select 1
    from public.project_programming pp
    where pp.tenant_id = new.tenant_id
      and pp.project_id = new.project_id
      and pp.id <> new.id
      and (
        public.normalize_programming_work_completion_code(pp.work_completion_status) in ('CONCLUIDO', 'COMPLETO')
        or public.normalize_programming_work_completion_code(pp.work_completion_status) like 'CONCLUIDO%'
      )
  ) then
    raise exception 'Projeto com Estado Trabalho CONCLUIDO nao pode ser interrompido ou transferido.'
      using errcode = '23514';
  end if;

  new.work_completion_status := null;
  new.work_completion_status_id := null;

  return new;
end;
$$;

revoke all on function public.enforce_interrupted_programming_completed_work_status() from public, anon, authenticated;
grant execute on function public.enforce_interrupted_programming_completed_work_status() to service_role;

create or replace function public.transfer_project_programming_team(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_source_programming_id uuid,
  p_destination_programming_id uuid,
  p_expected_updated_at timestamptz,
  p_destination_expected_updated_at timestamptz,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source public.project_programming%rowtype;
  v_destination public.project_programming%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_activities jsonb := '[]'::jsonb;
  v_documents jsonb := '{}'::jsonb;
  v_metadata jsonb := '{}'::jsonb;
  v_save_result jsonb;
  v_history_result jsonb;
  v_new_programming_id uuid;
  v_source_updated_at timestamptz;
  v_structured_error jsonb;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 401,
      'reason', 'INVALID_SESSION',
      'message', 'Sessao invalida para transferir equipe.'
    );
  end if;

  if p_source_programming_id is null or p_destination_programming_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_TRANSFER_PAYLOAD',
      'message', 'Informe programacao de origem e destino.'
    );
  end if;

  if p_source_programming_id = p_destination_programming_id then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'SAME_PROGRAMMING_TRANSFER',
      'message', 'Origem e destino da transferencia devem ser diferentes.'
    );
  end if;

  if v_reason is null or char_length(v_reason) < 10 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'TRANSFER_REASON_REQUIRED',
      'message', 'Informe o motivo da transferencia com pelo menos 10 caracteres.'
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

  select *
  into v_destination
  from public.project_programming pp
  where pp.tenant_id = p_tenant_id
    and pp.id = p_destination_programming_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'DESTINATION_PROGRAMMING_NOT_FOUND',
      'message', 'Programacao destino nao encontrada.'
    );
  end if;

  if v_source.status not in ('PROGRAMADA', 'REPROGRAMADA') or coalesce(v_source.is_active, false) = false then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'SOURCE_PROGRAMMING_NOT_ACTIVE',
      'message', 'A equipe de origem precisa estar em programacao ativa para ser transferida.'
    );
  end if;

  if v_destination.status not in ('PROGRAMADA', 'REPROGRAMADA') or coalesce(v_destination.is_active, false) = false then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DESTINATION_PROGRAMMING_NOT_ACTIVE',
      'message', 'A programacao destino precisa estar ativa.'
    );
  end if;

  if v_source.programming_group_id = v_destination.programming_group_id then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'SAME_PROGRAMMING_GROUP_TRANSFER',
      'message', 'A equipe ja pertence ao mesmo grupo de programacao.'
    );
  end if;

  if v_source.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'SOURCE_PROGRAMMING_CONFLICT',
      'message', 'A programacao de origem foi alterada por outro usuario. Atualize a tela e tente novamente.'
    );
  end if;

  if v_destination.updated_at is distinct from p_destination_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DESTINATION_PROGRAMMING_CONFLICT',
      'message', 'A programacao destino foi alterada por outro usuario. Atualize a tela e tente novamente.'
    );
  end if;

  if exists (
    select 1
    from public.project_programming pp
    where pp.tenant_id = p_tenant_id
      and pp.programming_group_id = v_destination.programming_group_id
      and pp.team_id = v_source.team_id
      and pp.status in ('PROGRAMADA', 'REPROGRAMADA')
      and coalesce(pp.is_active, false) = true
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'TEAM_ALREADY_IN_DESTINATION_GROUP',
      'message', 'Esta equipe ja esta ativa na programacao destino.'
    );
  end if;

  if exists (
    select 1
    from public.project_programming pp
    where pp.tenant_id = p_tenant_id
      and pp.project_id = v_destination.project_id
      and (
        public.normalize_programming_work_completion_code(pp.work_completion_status) in ('CONCLUIDO', 'COMPLETO')
        or public.normalize_programming_work_completion_code(pp.work_completion_status) like 'CONCLUIDO%'
      )
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'PROJECT_COMPLETED',
      'message', 'Projeto destino ja esta CONCLUIDO e nao permite receber equipe transferida.'
    );
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'catalogId', ppa.service_activity_id,
        'quantity', ppa.quantity
      )
      order by ppa.activity_code nulls last, ppa.id
    ),
    '[]'::jsonb
  )
  into v_activities
  from public.project_programming_activities ppa
  where ppa.tenant_id = p_tenant_id
    and ppa.programming_id = v_destination.id
    and coalesce(ppa.is_active, true) = true;

  v_documents := jsonb_build_object(
    'sgd', jsonb_build_object(
      'number', v_destination.sgd_number,
      'approvedAt', v_destination.sgd_included_at,
      'requestedAt', v_destination.sgd_delivered_at,
      'includedAt', v_destination.sgd_included_at,
      'deliveredAt', v_destination.sgd_delivered_at
    ),
    'pi', jsonb_build_object(
      'number', v_destination.pi_number,
      'approvedAt', v_destination.pi_included_at,
      'requestedAt', v_destination.pi_delivered_at,
      'includedAt', v_destination.pi_included_at,
      'deliveredAt', v_destination.pi_delivered_at
    ),
    'pep', jsonb_build_object(
      'number', v_destination.pep_number,
      'approvedAt', v_destination.pep_included_at,
      'requestedAt', v_destination.pep_delivered_at,
      'includedAt', v_destination.pep_included_at,
      'deliveredAt', v_destination.pep_delivered_at
    )
  );

  v_metadata := jsonb_build_object(
    'source', 'transfer-project-programming-team',
    'action', 'TRANSFER_TEAM',
    'sourceProgrammingId', v_source.id,
    'destinationProgrammingId', v_destination.id,
    'sourceProgrammingGroupId', v_source.programming_group_id,
    'destinationProgrammingGroupId', v_destination.programming_group_id,
    'sourceProjectId', v_source.project_id,
    'destinationProjectId', v_destination.project_id,
    'sourceTeamId', v_source.team_id,
    'destinationTeamId', v_source.team_id,
    'sourceExecutionDate', v_source.execution_date,
    'destinationExecutionDate', v_destination.execution_date,
    'sourceEtapaNumber', v_source.etapa_number,
    'destinationEtapaNumber', v_destination.etapa_number,
    'sourceEtapaUnica', v_source.etapa_unica,
    'destinationEtapaUnica', v_destination.etapa_unica,
    'sourceEtapaFinal', v_source.etapa_final,
    'destinationEtapaFinal', v_destination.etapa_final
  );

  update public.project_programming
  set
    status = 'TRANSFERIDA',
    is_active = false,
    cancellation_reason = v_reason,
    canceled_at = now(),
    canceled_by = p_actor_user_id,
    work_completion_status = null,
    work_completion_status_id = null,
    updated_by = p_actor_user_id,
    updated_at = now()
  where tenant_id = p_tenant_id
    and id = v_source.id
  returning updated_at into v_source_updated_at;

  v_save_result := public.save_project_programming_full_decimal_with_electrical_and_eq(
    p_tenant_id => p_tenant_id,
    p_actor_user_id => p_actor_user_id,
    p_project_id => v_destination.project_id,
    p_team_id => v_source.team_id,
    p_execution_date => v_destination.execution_date,
    p_period => v_destination.period,
    p_start_time => v_destination.start_time,
    p_end_time => v_destination.end_time,
    p_expected_minutes => v_destination.expected_minutes,
    p_feeder => v_destination.feeder,
    p_support => v_destination.support,
    p_note => v_destination.note,
    p_documents => v_documents,
    p_activities => v_activities,
    p_programming_id => null,
    p_expected_updated_at => null,
    p_support_item_id => v_destination.support_item_id,
    p_poste_qty => coalesce(v_destination.poste_qty, 0),
    p_estrutura_qty => coalesce(v_destination.estrutura_qty, 0),
    p_trafo_qty => coalesce(v_destination.trafo_qty, 0),
    p_rede_qty => coalesce(v_destination.rede_qty, 0),
    p_affected_customers => coalesce(v_destination.affected_customers, 0),
    p_sgd_type_id => v_destination.sgd_type_id,
    p_outage_start_time => v_destination.outage_start_time,
    p_outage_end_time => v_destination.outage_end_time,
    p_service_description => v_destination.service_description,
    p_etapa_number => v_destination.etapa_number,
    p_work_completion_status => v_destination.work_completion_status,
    p_history_action_override => 'TRANSFER_TEAM',
    p_history_reason => v_reason,
    p_history_metadata => v_metadata,
    p_campo_eletrico => v_destination.campo_eletrico,
    p_electrical_eq_catalog_id => v_destination.electrical_eq_catalog_id,
    p_etapa_unica => coalesce(v_destination.etapa_unica, false),
    p_etapa_final => coalesce(v_destination.etapa_final, false),
    p_copied_from_programming_id => v_destination.id,
    p_copy_batch_id => null
  );

  if coalesce((v_save_result ->> 'success')::boolean, false) = false then
    raise exception '%',
      jsonb_build_object(
        'success', false,
        'status', coalesce((v_save_result ->> 'status')::integer, 500),
        'reason', coalesce(v_save_result ->> 'reason', 'TRANSFER_DESTINATION_SAVE_FAILED'),
        'message', coalesce(v_save_result ->> 'message', 'Falha ao criar linha da equipe transferida no destino.'),
        'detail', coalesce(v_save_result ->> 'detail', v_save_result ->> 'message')
      )::text;
  end if;

  v_new_programming_id := nullif(v_save_result ->> 'programming_id', '')::uuid;
  if v_new_programming_id is null then
    raise exception '%',
      jsonb_build_object(
        'success', false,
        'status', 500,
        'reason', 'TRANSFER_DESTINATION_INVALID_RESULT',
        'message', 'Falha ao recuperar a nova linha da equipe transferida.'
      )::text;
  end if;

  v_metadata := v_metadata || jsonb_build_object('newProgrammingId', v_new_programming_id);

  v_history_result := public.append_project_programming_history_record(
    p_tenant_id => p_tenant_id,
    p_actor_user_id => p_actor_user_id,
    p_programming_id => v_source.id,
    p_project_id => v_source.project_id,
    p_team_id => v_source.team_id,
    p_related_programming_id => v_new_programming_id,
    p_action_type => 'TRANSFER_TEAM',
    p_reason => v_reason,
    p_changes => jsonb_build_object(
      'status', jsonb_build_object('from', v_source.status, 'to', 'TRANSFERIDA'),
      'isActive', jsonb_build_object('from', v_source.is_active, 'to', false),
      'destinationProgrammingId', jsonb_build_object('from', null, 'to', v_destination.id),
      'newProgrammingId', jsonb_build_object('from', null, 'to', v_new_programming_id)
    ),
    p_metadata => v_metadata,
    p_from_status => v_source.status,
    p_to_status => 'TRANSFERIDA',
    p_from_execution_date => v_source.execution_date,
    p_to_execution_date => v_destination.execution_date,
    p_from_team_id => v_source.team_id,
    p_to_team_id => v_source.team_id,
    p_from_start_time => v_source.start_time,
    p_to_start_time => v_destination.start_time,
    p_from_end_time => v_source.end_time,
    p_to_end_time => v_destination.end_time,
    p_from_etapa_number => v_source.etapa_number,
    p_to_etapa_number => v_destination.etapa_number
  );

  if coalesce((v_history_result ->> 'success')::boolean, false) = false then
    raise exception '%',
      jsonb_build_object(
        'success', false,
        'status', coalesce((v_history_result ->> 'status')::integer, 500),
        'reason', coalesce(v_history_result ->> 'reason', 'TRANSFER_HISTORY_FAILED'),
        'message', coalesce(v_history_result ->> 'message', 'Falha ao registrar historico da transferencia.')
      )::text;
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'source_programming_id', v_source.id,
    'destination_programming_id', v_destination.id,
    'new_programming_id', v_new_programming_id,
    'updated_at', v_source_updated_at,
    'message', 'Equipe transferida com sucesso.'
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
      'reason', coalesce(v_structured_error ->> 'reason', 'TRANSFER_PROGRAMMING_TEAM_FAILED'),
      'message', coalesce(v_structured_error ->> 'message', 'Falha ao transferir equipe entre programacoes.'),
      'detail', case
        when v_structured_error is null then sqlerrm
        else coalesce(v_structured_error ->> 'detail', v_structured_error ->> 'message')
      end
    );
end;
$$;

revoke all on function public.transfer_project_programming_team(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz, text
) from public, anon, authenticated;

grant execute on function public.transfer_project_programming_team(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz, text
) to service_role;

do $$
declare
  v_function_oid oid :=
    'public.transfer_project_programming_team(uuid,uuid,uuid,uuid,timestamp with time zone,timestamp with time zone,text)'
      ::regprocedure::oid;
begin
  if has_function_privilege('anon', v_function_oid, 'EXECUTE')
    or has_function_privilege('authenticated', v_function_oid, 'EXECUTE') then
    raise exception 'transfer_project_programming_team nao pode ser executada por anon/authenticated';
  end if;

  if not has_function_privilege('service_role', v_function_oid, 'EXECUTE') then
    raise exception 'transfer_project_programming_team deve permanecer executavel por service_role';
  end if;
end;
$$;
