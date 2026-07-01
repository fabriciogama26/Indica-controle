-- 284_clear_interrupted_programming_work_completion_status.sql
--
-- Regra:
-- - Programacoes ADIADA e CANCELADA nao devem manter Estado Trabalho.
-- - O banco limpa work_completion_status e work_completion_status_id nesses status.
-- - Projeto/linha CONCLUIDO continua bloqueando adiamento/cancelamento ate reabertura.
--
-- Motivo:
-- - A migration 258 bloqueava apenas ADIADA/CANCELADA + CONCLUIDO.
-- - Operacionalmente, linhas interrompidas nao representam execucao finalizada ou parcial.

do $$
declare
  v_row record;
  v_history_result jsonb;
begin
  for v_row in
    select
      pp.id,
      pp.tenant_id,
      pp.project_id,
      pp.team_id,
      pp.status,
      pp.execution_date,
      pp.start_time,
      pp.end_time,
      pp.etapa_number,
      pp.work_completion_status,
      pp.work_completion_status_id,
      coalesce(pp.updated_by, pp.created_by) as actor_user_id
    from public.project_programming pp
    where pp.status in ('ADIADA', 'CANCELADA')
      and (
        pp.work_completion_status is not null
        or pp.work_completion_status_id is not null
      )
    order by pp.tenant_id, pp.project_id, pp.execution_date, pp.id
    for update
  loop
    update public.project_programming
    set
      work_completion_status = null,
      work_completion_status_id = null,
      updated_by = v_row.actor_user_id
    where tenant_id = v_row.tenant_id
      and id = v_row.id;

    v_history_result := public.append_project_programming_history_record(
      p_tenant_id => v_row.tenant_id,
      p_actor_user_id => v_row.actor_user_id,
      p_programming_id => v_row.id,
      p_project_id => v_row.project_id,
      p_team_id => v_row.team_id,
      p_related_programming_id => null,
      p_action_type => 'UPDATE',
      p_reason => 'Backfill da migration 284: Estado Trabalho removido de programacao ADIADA/CANCELADA.',
      p_changes => jsonb_build_object(
        'workCompletionStatus',
        jsonb_build_object(
          'from', nullif(v_row.work_completion_status, ''),
          'to', null
        ),
        'workCompletionStatusId',
        jsonb_build_object(
          'from', v_row.work_completion_status_id,
          'to', null
        )
      ),
      p_metadata => jsonb_build_object(
        'source', 'supabase-migration',
        'migration', '284_clear_interrupted_programming_work_completion_status',
        'action', 'CLEAR_INTERRUPTED_WORK_COMPLETION_STATUS',
        'scope', 'interrupted_status'
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
          'message', coalesce(v_history_result ->> 'message', 'Falha ao registrar historico do backfill de Estado Trabalho interrompido.')
        )::text;
    end if;
  end loop;
end;
$$;

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
  if new.status not in ('ADIADA', 'CANCELADA') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_is_new_interrupted_row := true;
    v_status_changed_to_interrupted := true;
  elsif tg_op = 'UPDATE' then
    v_old_work_status := public.normalize_programming_work_completion_code(old.work_completion_status);
    v_is_new_interrupted_row := coalesce(old.status, '') not in ('ADIADA', 'CANCELADA');
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
    raise exception 'Projeto com Estado Trabalho CONCLUIDO nao pode ser adiado ou cancelado.'
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
    raise exception 'Projeto com Estado Trabalho CONCLUIDO nao pode ser adiado ou cancelado.'
      using errcode = '23514';
  end if;

  new.work_completion_status := null;
  new.work_completion_status_id := null;

  return new;
end;
$$;

revoke all on function public.enforce_interrupted_programming_completed_work_status() from public, anon, authenticated;
grant execute on function public.enforce_interrupted_programming_completed_work_status() to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'project_programming'
      and t.tgname = 'zz_trg_project_programming_block_interrupted_completed'
      and not t.tgisinternal
  ) then
    raise exception '284: trigger zz_trg_project_programming_block_interrupted_completed nao encontrado';
  end if;
end;
$$;
