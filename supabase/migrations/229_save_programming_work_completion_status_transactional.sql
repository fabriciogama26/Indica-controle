-- 229_save_programming_work_completion_status_transactional.sql
-- Salva Estado Trabalho, sincronizacoes disparadas por trigger e historico principal
-- na mesma transacao, com concorrencia otimista por updated_at.
-- Nao cria ou altera policies RLS e nao concede permissao DELETE.

create or replace function public.save_project_programming_work_completion_status_full(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_id uuid,
  p_expected_updated_at timestamptz,
  p_work_completion_status text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current public.project_programming%rowtype;
  v_next public.project_programming%rowtype;
  v_catalog_code text;
  v_normalized_status text :=
    public.normalize_programming_work_completion_code(p_work_completion_status);
  v_reason text := coalesce(
    nullif(btrim(coalesce(p_reason, '')), ''),
    'Reabertura de projeto concluido pelo modal.'
  );
  v_history_result jsonb;
  v_updated_by_name text;
  v_structured_error jsonb;
begin
  if p_tenant_id is null
    or p_actor_user_id is null
    or p_programming_id is null
    or p_expected_updated_at is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_WORK_COMPLETION_PAYLOAD',
      'message', 'Informe programacao, versao esperada e Estado Trabalho.'
    );
  end if;

  if v_normalized_status is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'WORK_COMPLETION_STATUS_REQUIRED',
      'message', 'Selecione um Estado Trabalho para salvar.'
    );
  end if;

  if v_normalized_status in ('CONCLUIDO', 'COMPLETO')
    or v_normalized_status like 'CONCLUIDO%' then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'COMPLETED_WORK_STATUS_NOT_ALLOWED',
      'message', 'Selecione um Estado Trabalho diferente de CONCLUIDO.'
    );
  end if;

  select c.code
  into v_catalog_code
  from public.programming_work_completion_catalog c
  where c.tenant_id = p_tenant_id
    and c.code = v_normalized_status
    and c.is_active = true
  limit 1;

  if v_catalog_code is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_WORK_COMPLETION_STATUS',
      'message', 'Estado Trabalho invalido para o tenant atual.'
    );
  end if;

  select *
  into v_current
  from public.project_programming pp
  where pp.tenant_id = p_tenant_id
    and pp.id = p_programming_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'PROGRAMMING_NOT_FOUND',
      'message', 'Programacao nao encontrada.'
    );
  end if;

  if v_current.updated_at is distinct from p_expected_updated_at then
    select coalesce(
      nullif(btrim(coalesce(au.display, '')), ''),
      nullif(btrim(coalesce(au.login_name, '')), ''),
      nullif(btrim(coalesce(au.email, '')), ''),
      nullif(btrim(coalesce(au.matricula, '')), ''),
      v_current.updated_by::text
    )
    into v_updated_by_name
    from public.app_users au
    where au.tenant_id = p_tenant_id
      and au.id = v_current.updated_by
    limit 1;

    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'CONCURRENT_MODIFICATION',
      'message', 'Esta programacao foi alterada por outro usuario. Recarregue a grade antes de salvar novamente.',
      'currentRecord', jsonb_build_object(
        'id', v_current.id,
        'projectId', v_current.project_id,
        'teamId', v_current.team_id,
        'status', v_current.status,
        'executionDate', v_current.execution_date,
        'startTime', v_current.start_time,
        'endTime', v_current.end_time,
        'workCompletionStatus', v_current.work_completion_status,
        'updatedAt', v_current.updated_at
      ),
      'currentUpdatedAt', v_current.updated_at,
      'updatedBy', v_updated_by_name,
      'changedFields', jsonb_build_array('updatedAt', 'workCompletionStatus')
    );
  end if;

  if v_current.work_completion_status is not distinct from v_catalog_code then
    return jsonb_build_object(
      'success', true,
      'status', 200,
      'skipped', true,
      'programming_id', v_current.id,
      'updated_at', v_current.updated_at,
      'work_completion_status', v_current.work_completion_status,
      'message', 'Estado Trabalho ja estava salvo com o valor selecionado.'
    );
  end if;

  update public.project_programming
  set
    work_completion_status = v_catalog_code,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = p_programming_id
  returning *
  into v_next;

  v_history_result := public.append_project_programming_history_record(
    p_tenant_id => p_tenant_id,
    p_actor_user_id => p_actor_user_id,
    p_programming_id => v_next.id,
    p_project_id => v_next.project_id,
    p_team_id => v_next.team_id,
    p_related_programming_id => null,
    p_action_type => 'UPDATE',
    p_reason => v_reason,
    p_changes => jsonb_build_object(
      'workCompletionStatus',
      jsonb_build_object(
        'from', nullif(v_current.work_completion_status, ''),
        'to', nullif(v_next.work_completion_status, '')
      )
    ),
    p_metadata => jsonb_build_object(
      'action', 'SAVE_WORK_COMPLETION_STATUS_FROM_COMPLETED_MODAL',
      'source', 'programacao-api'
    ),
    p_from_status => v_current.status,
    p_to_status => v_next.status,
    p_from_execution_date => v_current.execution_date,
    p_to_execution_date => v_next.execution_date,
    p_from_team_id => v_current.team_id,
    p_to_team_id => v_next.team_id,
    p_from_start_time => v_current.start_time,
    p_to_start_time => v_next.start_time,
    p_from_end_time => v_current.end_time,
    p_to_end_time => v_next.end_time,
    p_from_etapa_number => v_current.etapa_number,
    p_to_etapa_number => v_next.etapa_number
  );

  if coalesce((v_history_result ->> 'success')::boolean, false) = false then
    raise exception '%',
      jsonb_build_object(
        'success', false,
        'status', coalesce((v_history_result ->> 'status')::integer, 500),
        'reason', coalesce(v_history_result ->> 'reason', 'APPEND_PROGRAMMING_HISTORY_FAILED'),
        'message', coalesce(v_history_result ->> 'message', 'Falha ao registrar historico do Estado Trabalho.')
      )::text;
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'skipped', false,
    'programming_id', v_next.id,
    'updated_at', v_next.updated_at,
    'work_completion_status', v_next.work_completion_status,
    'message', 'Estado Trabalho salvo com sucesso.'
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
      'reason', coalesce(v_structured_error ->> 'reason', 'SAVE_WORK_COMPLETION_STATUS_FAILED'),
      'message', coalesce(v_structured_error ->> 'message', 'Falha ao salvar Estado Trabalho em transacao unica.'),
      'detail', case
        when v_structured_error is null then sqlerrm
        else coalesce(v_structured_error ->> 'detail', v_structured_error ->> 'message')
      end
    );
end;
$$;

revoke all on function public.save_project_programming_work_completion_status_full(
  uuid,
  uuid,
  uuid,
  timestamptz,
  text,
  text
) from public, anon, authenticated;

grant execute on function public.save_project_programming_work_completion_status_full(
  uuid,
  uuid,
  uuid,
  timestamptz,
  text,
  text
) to service_role;
