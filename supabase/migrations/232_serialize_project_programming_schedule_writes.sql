begin;

do $$
declare
  v_overlap_count bigint;
  v_overlap_sample jsonb;
begin
  select count(*)
    into v_overlap_count
  from public.project_programming a
  join public.project_programming b
    on a.id < b.id
   and a.tenant_id = b.tenant_id
   and a.team_id = b.team_id
   and a.execution_date = b.execution_date
   and a.start_time < b.end_time
   and a.end_time > b.start_time
  where a.status in ('PROGRAMADA', 'REPROGRAMADA')
    and b.status in ('PROGRAMADA', 'REPROGRAMADA');

  if v_overlap_count > 0 then
    select jsonb_agg(to_jsonb(conflict_sample))
      into v_overlap_sample
    from (
      select
        a.tenant_id,
        a.team_id,
        a.execution_date,
        a.id as first_programming_id,
        b.id as second_programming_id
      from public.project_programming a
      join public.project_programming b
        on a.id < b.id
       and a.tenant_id = b.tenant_id
       and a.team_id = b.team_id
       and a.execution_date = b.execution_date
       and a.start_time < b.end_time
       and a.end_time > b.start_time
      where a.status in ('PROGRAMADA', 'REPROGRAMADA')
        and b.status in ('PROGRAMADA', 'REPROGRAMADA')
      order by a.tenant_id, a.team_id, a.execution_date, a.start_time
      limit 10
    ) conflict_sample;

    raise exception
      'Migration 232 bloqueada: existem % sobreposicoes ativas em project_programming. Amostra: %',
      v_overlap_count,
      coalesce(v_overlap_sample, '[]'::jsonb)
      using errcode = 'P0001';
  end if;
end
$$;

create or replace function public.enforce_project_programming_schedule_concurrency()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conflict public.project_programming%rowtype;
begin
  if new.tenant_id is null
     or new.team_id is null
     or new.execution_date is null
     or new.start_time is null
     or new.end_time is null
     or coalesce(new.status, '') not in ('PROGRAMADA', 'REPROGRAMADA') then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtext('project-programming|' || new.tenant_id::text),
    hashtext(new.team_id::text || '|' || new.execution_date::text)
  );

  select programming.*
    into v_conflict
  from public.project_programming programming
  where programming.tenant_id = new.tenant_id
    and programming.team_id = new.team_id
    and programming.execution_date = new.execution_date
    and programming.status in ('PROGRAMADA', 'REPROGRAMADA')
    and programming.id is distinct from new.id
    and new.start_time < programming.end_time
    and new.end_time > programming.start_time
  order by programming.start_time, programming.id
  limit 1;

  if found then
    raise exception '%',
      jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'TEAM_TIME_CONFLICT',
        'message', 'A equipe ja possui programacao ativa neste intervalo.',
        'detail', jsonb_build_object(
          'currentRecord', jsonb_build_object(
            'id', v_conflict.id,
            'projectId', v_conflict.project_id,
            'teamId', v_conflict.team_id,
            'status', v_conflict.status,
            'executionDate', v_conflict.execution_date,
            'startTime', v_conflict.start_time,
            'endTime', v_conflict.end_time,
            'updatedAt', v_conflict.updated_at
          ),
          'currentUpdatedAt', v_conflict.updated_at,
          'updatedBy', v_conflict.updated_by,
          'changedFields', jsonb_build_array(
            'teamId',
            'executionDate',
            'startTime',
            'endTime'
          )
        )
      )::text
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_project_programming_schedule_concurrency()
  from public, anon, authenticated;
grant execute on function public.enforce_project_programming_schedule_concurrency()
  to service_role;

drop trigger if exists trg_00_project_programming_schedule_concurrency
  on public.project_programming;

create trigger trg_00_project_programming_schedule_concurrency
before insert or update of
  tenant_id,
  team_id,
  execution_date,
  start_time,
  end_time,
  status
on public.project_programming
for each row
execute function public.enforce_project_programming_schedule_concurrency();

do $$
declare
  v_is_security_definer boolean;
  v_trigger_enabled "char";
begin
  select procedure.prosecdef
    into v_is_security_definer
  from pg_proc procedure
  join pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname = 'enforce_project_programming_schedule_concurrency'
    and pg_get_function_identity_arguments(procedure.oid) = '';

  if v_is_security_definer is distinct from true then
    raise exception
      'Migration 232 invalida: enforce_project_programming_schedule_concurrency deve ser SECURITY DEFINER';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.enforce_project_programming_schedule_concurrency()',
       'EXECUTE'
     ) then
    raise exception
      'Migration 232 invalida: authenticated nao pode executar diretamente a funcao do trigger';
  end if;

  select trigger.tgenabled
    into v_trigger_enabled
  from pg_trigger trigger
  join pg_class relation
    on relation.oid = trigger.tgrelid
  join pg_namespace namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname = 'project_programming'
    and trigger.tgname = 'trg_00_project_programming_schedule_concurrency'
    and not trigger.tgisinternal;

  if v_trigger_enabled is distinct from 'O'::"char" then
    raise exception
      'Migration 232 invalida: trigger de concorrencia nao foi criado ou nao esta habilitado';
  end if;
end
$$;

commit;
