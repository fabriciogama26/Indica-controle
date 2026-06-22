-- 255_add_anticipated_work_completion_status.sql
-- Adiciona Estado Trabalho ANTECIPADA ao catalogo por tenant para conclusao antes da etapa final.

insert into public.programming_work_completion_catalog (
  tenant_id,
  code,
  label_pt,
  is_active,
  sort_order
)
select
  t.id,
  'ANTECIPADA',
  'ANTECIPADA',
  true,
  15
from public.tenants t
on conflict (tenant_id, code) do update
set
  label_pt = excluded.label_pt,
  is_active = true,
  sort_order = excluded.sort_order,
  updated_at = now();

create or replace function public.mark_project_programming_future_stages_anticipated(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_source_programming_id uuid,
  p_source_etapa_number integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source public.project_programming%rowtype;
  v_catalog_code text;
  v_row public.project_programming%rowtype;
  v_updated_ids uuid[] := array[]::uuid[];
  v_affected_count integer := 0;
  v_history_result jsonb;
  v_structured_error jsonb;
begin
  if p_tenant_id is null
    or p_actor_user_id is null
    or p_source_programming_id is null
    or p_source_etapa_number is null
    or p_source_etapa_number < 1 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_ANTICIPATED_STAGES_PAYLOAD',
      'message', 'Informe tenant, usuario, programacao origem e ETAPA valida.'
    );
  end if;

  select c.code
  into v_catalog_code
  from public.programming_work_completion_catalog c
  where c.tenant_id = p_tenant_id
    and c.code = 'ANTECIPADA'
    and c.is_active = true
  limit 1;

  if v_catalog_code is null then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'ANTICIPATED_WORK_COMPLETION_STATUS_NOT_ACTIVE',
      'message', 'Estado Trabalho ANTECIPADA nao esta ativo no catalogo do tenant atual.'
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
      'message', 'Programacao origem nao encontrada.'
    );
  end if;

  if coalesce(public.normalize_programming_work_completion_code(v_source.work_completion_status), '') not in ('CONCLUIDO', 'COMPLETO')
    and coalesce(public.normalize_programming_work_completion_code(v_source.work_completion_status), '') not like 'CONCLUIDO%' then
    return jsonb_build_object(
      'success', true,
      'status', 200,
      'affected_count', 0,
      'updated_programming_ids', array[]::uuid[],
      'message', 'Programacao origem nao esta CONCLUIDO; nenhuma etapa futura foi alterada.'
    );
  end if;

  for v_row in
    select *
    from public.project_programming pp
    where pp.tenant_id = p_tenant_id
      and pp.project_id = v_source.project_id
      and pp.id <> v_source.id
      and pp.status in ('PROGRAMADA', 'REPROGRAMADA')
      and pp.etapa_number is not null
      and pp.etapa_number > p_source_etapa_number
      and pp.work_completion_status is distinct from v_catalog_code
    order by pp.etapa_number asc, pp.execution_date asc, pp.created_at asc
    for update
  loop
    update public.project_programming
    set
      work_completion_status = v_catalog_code,
      updated_by = p_actor_user_id
    where tenant_id = p_tenant_id
      and id = v_row.id;

    v_history_result := public.append_project_programming_history_record(
      p_tenant_id => p_tenant_id,
      p_actor_user_id => p_actor_user_id,
      p_programming_id => v_row.id,
      p_project_id => v_row.project_id,
      p_team_id => v_row.team_id,
      p_related_programming_id => v_source.id,
      p_action_type => 'UPDATE',
      p_reason => 'Atualizacao automatica por conclusao antecipada.',
      p_changes => jsonb_build_object(
        'workCompletionStatus',
        jsonb_build_object(
          'from', nullif(v_row.work_completion_status, ''),
          'to', v_catalog_code
        )
      ),
      p_metadata => jsonb_build_object(
        'source', 'programacao-api',
        'action', 'MARK_FUTURE_STAGES_ANTICIPATED',
        'sourceProgrammingId', v_source.id,
        'sourceEtapaNumber', p_source_etapa_number,
        'scope', 'project+future_etapa'
      ),
      p_from_status => v_row.status,
      p_to_status => v_row.status,
      p_from_execution_date => v_row.execution_date,
      p_to_execution_date => v_row.execution_date,
      p_from_team_id => v_row.team_id,
      p_to_team_id => v_row.team_id,
      p_from_start_time => v_row.start_time,
      p_to_start_time => v_row.start_time,
      p_from_end_time => v_row.end_time,
      p_to_end_time => v_row.end_time,
      p_from_etapa_number => v_row.etapa_number,
      p_to_etapa_number => v_row.etapa_number
    );

    if coalesce((v_history_result ->> 'success')::boolean, false) = false then
      raise exception '%',
        jsonb_build_object(
          'success', false,
          'status', coalesce((v_history_result ->> 'status')::integer, 500),
          'reason', coalesce(v_history_result ->> 'reason', 'APPEND_PROGRAMMING_HISTORY_FAILED'),
          'message', coalesce(v_history_result ->> 'message', 'Falha ao registrar historico da etapa antecipada.')
        )::text;
    end if;

    v_affected_count := v_affected_count + 1;
    v_updated_ids := array_append(v_updated_ids, v_row.id);
  end loop;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'affected_count', v_affected_count,
    'updated_programming_ids', v_updated_ids,
    'message', case
      when v_affected_count = 0 then 'Nenhuma etapa futura ativa precisava ser marcada como ANTECIPADA.'
      else 'Etapas futuras marcadas como ANTECIPADA.'
    end
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
      'reason', coalesce(v_structured_error ->> 'reason', 'MARK_FUTURE_STAGES_ANTICIPATED_FAILED'),
      'message', coalesce(v_structured_error ->> 'message', 'Falha ao marcar etapas futuras como ANTECIPADA.'),
      'detail', case
        when v_structured_error is null then sqlerrm
        else coalesce(v_structured_error ->> 'detail', v_structured_error ->> 'message')
      end
    );
end;
$$;

revoke all on function public.mark_project_programming_future_stages_anticipated(
  uuid,
  uuid,
  uuid,
  integer
) from public, anon, authenticated;

grant execute on function public.mark_project_programming_future_stages_anticipated(
  uuid,
  uuid,
  uuid,
  integer
) to service_role;
