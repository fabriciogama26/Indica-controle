-- 283_sync_completed_work_status_by_programming_group.sql
--
-- Regra:
-- - CONCLUIDO continua representando conclusao do projeto.
-- - A conclusao pode existir em varias equipes da mesma execucao operacional
--   quando todas pertencem ao mesmo programming_group_id.
-- - Outro programming_group_id ativo do mesmo tenant/projeto nao pode ficar
--   CONCLUIDO ao mesmo tempo.
--
-- Motivo:
-- - A migration 276 criou indice unico por tenant/projeto concluido.
-- - A migration 277 impediu a propagacao de CONCLUIDO por grupo.
-- - Operacionalmente, quando Projeto + Data + ETAPA/grupo e concluido em uma
--   equipe, as demais equipes ativas do mesmo grupo devem herdar o estado.

do $$
declare
  v_invalid_count integer;
  v_invalid_details text;
begin
  select count(*)
  into v_invalid_count
  from (
    select
      pp.tenant_id,
      pp.project_id
    from public.project_programming pp
    where pp.status in ('PROGRAMADA', 'REPROGRAMADA')
      and (
        public.normalize_programming_work_completion_code(pp.work_completion_status) in ('CONCLUIDO', 'COMPLETO')
        or public.normalize_programming_work_completion_code(pp.work_completion_status) like 'CONCLUIDO%'
      )
    group by pp.tenant_id, pp.project_id
    having count(distinct pp.programming_group_id) > 1
  ) invalid_projects;

  if v_invalid_count > 0 then
    select string_agg(
      format(
        'tenant_id=%s project_id=%s grupos_concluidos=%s',
        invalid.tenant_id,
        invalid.project_id,
        invalid.completed_groups
      ),
      '; '
      order by invalid.tenant_id, invalid.project_id
    )
    into v_invalid_details
    from (
      select
        pp.tenant_id,
        pp.project_id,
        count(distinct pp.programming_group_id) as completed_groups
      from public.project_programming pp
      where pp.status in ('PROGRAMADA', 'REPROGRAMADA')
        and (
          public.normalize_programming_work_completion_code(pp.work_completion_status) in ('CONCLUIDO', 'COMPLETO')
          or public.normalize_programming_work_completion_code(pp.work_completion_status) like 'CONCLUIDO%'
        )
      group by pp.tenant_id, pp.project_id
      having count(distinct pp.programming_group_id) > 1
      order by pp.tenant_id, pp.project_id
      limit 20
    ) invalid;

    raise exception 'Existem projetos com CONCLUIDO ativo em mais de um grupo operacional. Corrija antes da migration 283. Detalhes: %',
      coalesce(v_invalid_details, '[sem detalhes]');
  end if;
end;
$$;

drop index if exists public.idx_project_programming_one_active_completed_per_project;

create index if not exists idx_project_programming_active_completed_project_group
  on public.project_programming (tenant_id, project_id, programming_group_id)
  where status in ('PROGRAMADA', 'REPROGRAMADA')
    and work_completion_status is not null
    and (
      public.normalize_programming_work_completion_code(work_completion_status) in ('CONCLUIDO', 'COMPLETO')
      or public.normalize_programming_work_completion_code(work_completion_status) like 'CONCLUIDO%'
    );

create or replace function public.enforce_completed_work_status_group_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new_text_status text := public.normalize_programming_work_completion_code(new.work_completion_status);
  v_new_id_status text;
  v_new_is_completed boolean := false;
begin
  if new.work_completion_status_id is not null then
    select public.normalize_programming_work_completion_code(c.code)
    into v_new_id_status
    from public.programming_work_completion_catalog c
    where c.tenant_id = new.tenant_id
      and c.id = new.work_completion_status_id
    limit 1;
  end if;

  v_new_is_completed := coalesce(
    v_new_text_status in ('CONCLUIDO', 'COMPLETO')
    or v_new_text_status like 'CONCLUIDO%'
    or v_new_id_status in ('CONCLUIDO', 'COMPLETO')
    or v_new_id_status like 'CONCLUIDO%',
    false
  );

  if new.status not in ('PROGRAMADA', 'REPROGRAMADA') or not v_new_is_completed then
    return new;
  end if;

  if new.tenant_id is null or new.project_id is null or new.programming_group_id is null then
    raise exception 'Estado Trabalho CONCLUIDO exige tenant, projeto e grupo operacional preenchidos.'
      using errcode = '23514';
  end if;

  -- Serializa conclusoes concorrentes no mesmo tenant/projeto depois da troca
  -- do indice unico global por validacao de grupo operacional.
  perform pg_advisory_xact_lock(
    hashtextextended(new.tenant_id::text || ':' || new.project_id::text, 283)
  );

  if exists (
    select 1
    from public.project_programming sibling
    where sibling.tenant_id = new.tenant_id
      and sibling.project_id = new.project_id
      and sibling.id <> new.id
      and sibling.status in ('PROGRAMADA', 'REPROGRAMADA')
      and sibling.programming_group_id is distinct from new.programming_group_id
      and (
        public.normalize_programming_work_completion_code(sibling.work_completion_status) in ('CONCLUIDO', 'COMPLETO')
        or public.normalize_programming_work_completion_code(sibling.work_completion_status) like 'CONCLUIDO%'
      )
  ) then
    raise exception 'Estado Trabalho CONCLUIDO ja existe em outro grupo operacional ativo deste projeto.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_completed_work_status_group_integrity() from public, anon, authenticated;
grant execute on function public.enforce_completed_work_status_group_integrity() to service_role;

drop trigger if exists trg_project_programming_sync_work_completion_status on public.project_programming;

do $$
declare
  v_row record;
  v_history_result jsonb;
begin
  for v_row in
    with completed_groups as (
      select distinct on (pp.tenant_id, pp.project_id, pp.programming_group_id)
        pp.tenant_id,
        pp.project_id,
        pp.programming_group_id,
        pp.id as source_programming_id,
        'CONCLUIDO'::text as source_work_completion_status,
        coalesce(pp.updated_by, pp.created_by) as actor_user_id
      from public.project_programming pp
      where pp.status in ('PROGRAMADA', 'REPROGRAMADA')
        and (
          public.normalize_programming_work_completion_code(pp.work_completion_status) in ('CONCLUIDO', 'COMPLETO')
          or public.normalize_programming_work_completion_code(pp.work_completion_status) like 'CONCLUIDO%'
        )
      order by
        pp.tenant_id,
        pp.project_id,
        pp.programming_group_id,
        pp.updated_at desc nulls last,
        pp.created_at desc nulls last,
        pp.id desc
    )
    select
      sibling.id,
      sibling.tenant_id,
      sibling.project_id,
      sibling.programming_group_id,
      sibling.team_id,
      sibling.status,
      sibling.execution_date,
      sibling.start_time,
      sibling.end_time,
      sibling.etapa_number,
      sibling.work_completion_status,
      completed_groups.source_programming_id,
      completed_groups.source_work_completion_status,
      completed_groups.actor_user_id
    from completed_groups
    join public.project_programming sibling
      on sibling.tenant_id = completed_groups.tenant_id
     and sibling.project_id = completed_groups.project_id
     and sibling.programming_group_id = completed_groups.programming_group_id
     and sibling.status in ('PROGRAMADA', 'REPROGRAMADA')
     and sibling.id <> completed_groups.source_programming_id
     and sibling.work_completion_status is distinct from completed_groups.source_work_completion_status
    order by sibling.tenant_id, sibling.project_id, sibling.programming_group_id, sibling.id
    for update of sibling
  loop
    update public.project_programming
    set
      work_completion_status = v_row.source_work_completion_status,
      updated_by = v_row.actor_user_id
    where tenant_id = v_row.tenant_id
      and id = v_row.id;

    v_history_result := public.append_project_programming_history_record(
      p_tenant_id => v_row.tenant_id,
      p_actor_user_id => v_row.actor_user_id,
      p_programming_id => v_row.id,
      p_project_id => v_row.project_id,
      p_team_id => v_row.team_id,
      p_related_programming_id => v_row.source_programming_id,
      p_action_type => 'UPDATE',
      p_reason => 'Backfill da migration 283: CONCLUIDO herdado do grupo operacional.',
      p_changes => jsonb_build_object(
        'workCompletionStatus',
        jsonb_build_object(
          'from', nullif(v_row.work_completion_status, ''),
          'to', nullif(v_row.source_work_completion_status, '')
        )
      ),
      p_metadata => jsonb_build_object(
        'source', 'supabase-migration',
        'migration', '283_sync_completed_work_status_by_programming_group',
        'action', 'BACKFILL_COMPLETED_WORK_STATUS_BY_PROGRAMMING_GROUP',
        'syncSourceProgrammingId', v_row.source_programming_id,
        'programmingGroupId', v_row.programming_group_id,
        'scope', 'programming_group_id'
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
          'message', coalesce(v_history_result ->> 'message', 'Falha ao registrar historico do backfill de CONCLUIDO por grupo.')
        )::text;
    end if;
  end loop;
end;
$$;

create or replace function public.sync_programming_work_completion_status_by_project_date()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_user_id uuid := coalesce(new.updated_by, old.updated_by, new.created_by, old.created_by);
  v_next_status text := public.normalize_programming_work_completion_code(new.work_completion_status);
  v_row record;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if coalesce(new.status, '') not in ('PROGRAMADA', 'REPROGRAMADA') then
    return new;
  end if;

  if old.work_completion_status is not distinct from new.work_completion_status then
    return new;
  end if;

  if new.programming_group_id is null then
    return new;
  end if;

  if v_next_status = 'ANTECIPADO' then
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
      and pp.programming_group_id = new.programming_group_id
      and pp.status in ('PROGRAMADA', 'REPROGRAMADA')
      and pp.id <> new.id
      and pp.work_completion_status is distinct from new.work_completion_status
    order by pp.id
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
        'source', 'work-completion-group-sync',
        'syncSourceProgrammingId', new.id,
        'programmingGroupId', new.programming_group_id,
        'scope', 'programming_group_id',
        'syncCompletedWorkStatus', coalesce(
          v_next_status in ('CONCLUIDO', 'COMPLETO')
          or v_next_status like 'CONCLUIDO%',
          false
        )
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

revoke all on function public.sync_programming_work_completion_status_by_project_date() from public, anon, authenticated;
grant execute on function public.sync_programming_work_completion_status_by_project_date() to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'project_programming'
      and t.tgname = 'zz_trg_project_programming_completed_group_integrity'
      and not t.tgisinternal
  ) then
    raise exception '283: trigger zz_trg_project_programming_completed_group_integrity nao encontrado';
  end if;
end;
$$;
