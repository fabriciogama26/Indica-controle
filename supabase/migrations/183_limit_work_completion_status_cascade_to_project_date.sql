-- 183_limit_work_completion_status_cascade_to_project_date.sql
-- Estado Trabalho deve sincronizar somente programacoes ativas do mesmo Projeto + Data execucao.
-- A regra nao propaga alteracao para outros dias do mesmo projeto.

drop trigger if exists trg_project_programming_sync_work_completion_status on public.project_programming;
drop function if exists public.sync_programming_work_completion_status_by_project_date();

create or replace function public.sync_programming_work_completion_status_by_project_date()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := coalesce(new.updated_by, old.updated_by, new.created_by, old.created_by);
  v_row record;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  -- Evita recursao quando a propria sincronizacao atualizar as demais linhas.
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  -- Regra vale somente para programacoes ativas.
  if coalesce(new.status, '') not in ('PROGRAMADA', 'REPROGRAMADA') then
    return new;
  end if;

  -- So sincroniza quando o valor realmente mudou.
  if old.work_completion_status is not distinct from new.work_completion_status then
    return new;
  end if;

  for v_row in
    select
      pp.id,
      pp.project_id,
      pp.team_id,
      pp.work_completion_status
    from public.project_programming pp
    where pp.tenant_id = new.tenant_id
      and pp.project_id = new.project_id
      and pp.execution_date = new.execution_date
      and pp.status in ('PROGRAMADA', 'REPROGRAMADA')
      and pp.id <> new.id
      and pp.work_completion_status is distinct from new.work_completion_status
    for update
  loop
    update public.project_programming
    set
      work_completion_status = new.work_completion_status,
      updated_by = v_actor_user_id
    where tenant_id = new.tenant_id
      and id = v_row.id;

    perform public.append_project_programming_history_record(
      p_tenant_id => new.tenant_id,
      p_actor_user_id => v_actor_user_id,
      p_programming_id => v_row.id,
      p_project_id => v_row.project_id,
      p_team_id => v_row.team_id,
      p_related_programming_id => new.id,
      p_action_type => 'UPDATE',
      p_reason => null,
      p_changes => jsonb_build_object(
        'workCompletionStatus',
        jsonb_build_object(
          'from', nullif(v_row.work_completion_status, ''),
          'to', nullif(new.work_completion_status, '')
        )
      ),
      p_metadata => jsonb_build_object(
        'source', 'work-completion-project-date-sync',
        'syncSourceProgrammingId', new.id,
        'scope', 'project+execution_date'
      )
    );
  end loop;

  return new;
end;
$$;

create trigger trg_project_programming_sync_work_completion_status
after update of work_completion_status on public.project_programming
for each row
execute function public.sync_programming_work_completion_status_by_project_date();
