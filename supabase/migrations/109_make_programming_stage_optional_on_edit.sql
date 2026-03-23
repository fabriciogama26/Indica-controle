-- 109_make_programming_stage_optional_on_edit.sql
-- Permite salvar ETAPA/Estado Trabalho com ETAPA nula quando necessario.

drop function if exists public.set_project_programming_execution_result(
  uuid,
  uuid,
  uuid,
  integer,
  text
);

create or replace function public.set_project_programming_execution_result(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_id uuid,
  p_etapa_number integer default null,
  p_work_completion_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_programming_id uuid;
  v_updated_at timestamptz;
  v_work_completion_status text := nullif(upper(btrim(coalesce(p_work_completion_status, ''))), '');
begin
  if p_programming_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'PROGRAMMING_ID_REQUIRED',
      'message', 'Programacao invalida para salvar ETAPA/Estado Trabalho.'
    );
  end if;

  if p_etapa_number is not null and p_etapa_number <= 0 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_ETAPA_NUMBER',
      'message', 'ETAPA deve ser um numero inteiro maior que zero.'
    );
  end if;

  if v_work_completion_status is not null
    and v_work_completion_status not in ('CONCLUIDO', 'PARCIAL') then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_WORK_COMPLETION_STATUS',
      'message', 'Estado Trabalho invalido. Use apenas CONCLUIDO ou PARCIAL.'
    );
  end if;

  update public.project_programming
  set
    etapa_number = p_etapa_number,
    work_completion_status = v_work_completion_status,
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
    'message', 'ETAPA/Estado Trabalho salvos com sucesso.'
  );
end;
$$;

revoke all on function public.set_project_programming_execution_result(
  uuid,
  uuid,
  uuid,
  integer,
  text
) from public;

grant execute on function public.set_project_programming_execution_result(
  uuid,
  uuid,
  uuid,
  integer,
  text
) to authenticated;

grant execute on function public.set_project_programming_execution_result(
  uuid,
  uuid,
  uuid,
  integer,
  text
) to service_role;
