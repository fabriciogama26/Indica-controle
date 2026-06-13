begin;

do $$
declare
  v_inconsistent_count bigint;
  v_sample jsonb;
begin
  select count(*)
    into v_inconsistent_count
  from public.project_programming programming
  join public.project project_record
    on project_record.id = programming.project_id
   and project_record.tenant_id = programming.tenant_id
  where not project_record.is_active
    and programming.status in ('PROGRAMADA', 'REPROGRAMADA', 'ADIADA');

  if v_inconsistent_count > 0 then
    select jsonb_agg(to_jsonb(sample_row))
      into v_sample
    from (
      select
        programming.tenant_id,
        programming.project_id,
        programming.id as programming_id,
        programming.status
      from public.project_programming programming
      join public.project project_record
        on project_record.id = programming.project_id
       and project_record.tenant_id = programming.tenant_id
      where not project_record.is_active
        and programming.status in ('PROGRAMADA', 'REPROGRAMADA', 'ADIADA')
      order by programming.tenant_id, programming.project_id, programming.id
      limit 10
    ) sample_row;

    raise exception
      'Migration 233 bloqueada: existem % programacoes ativas vinculadas a projetos inativos. Amostra: %',
      v_inconsistent_count,
      coalesce(v_sample, '[]'::jsonb)
      using errcode = 'P0001';
  end if;
end
$$;

do $$
declare
  v_issues text;
begin
  select string_agg(format('%s=%s', relation_name, invalid_count), ', ')
    into v_issues
  from (
    select 'project_history.project_id' relation_name, count(*) invalid_count
    from public.project_history child
    join public.project parent on parent.id = child.project_id
    where parent.tenant_id <> child.tenant_id

    union all
    select 'project_cancellation_history.project_id', count(*)
    from public.project_cancellation_history child
    join public.project parent on parent.id = child.project_id
    where parent.tenant_id <> child.tenant_id

    union all
    select 'project_material_forecast.project_id', count(*)
    from public.project_material_forecast child
    join public.project parent on parent.id = child.project_id
    where parent.tenant_id <> child.tenant_id

    union all
    select 'project_material_forecast.material_id', count(*)
    from public.project_material_forecast child
    join public.materials parent on parent.id = child.material_id
    where parent.tenant_id <> child.tenant_id

    union all
    select 'project_activity_forecast.project_id', count(*)
    from public.project_activity_forecast child
    join public.project parent on parent.id = child.project_id
    where parent.tenant_id <> child.tenant_id

    union all
    select 'project_activity_forecast.service_activity_id', count(*)
    from public.project_activity_forecast child
    join public.service_activities parent on parent.id = child.service_activity_id
    where parent.tenant_id <> child.tenant_id
  ) invalid_relations
  where invalid_count > 0;

  if v_issues is not null then
    raise exception
      'Migration 233 bloqueada: referencias cruzadas entre tenants: %',
      v_issues
      using errcode = 'P0001';
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.materials'::regclass
      and conname = 'materials_id_tenant_key'
  ) then
    alter table public.materials
      add constraint materials_id_tenant_key unique (id, tenant_id);
  end if;
end
$$;

alter table public.project_history
  drop constraint if exists project_history_project_id_fkey,
  drop constraint if exists project_history_project_tenant_fk;
alter table public.project_history
  add constraint project_history_project_tenant_fk
    foreign key (project_id, tenant_id)
    references public.project(id, tenant_id)
    on delete cascade not valid;

alter table public.project_cancellation_history
  drop constraint if exists project_cancellation_history_project_id_fkey,
  drop constraint if exists project_cancellation_history_project_tenant_fk;
alter table public.project_cancellation_history
  add constraint project_cancellation_history_project_tenant_fk
    foreign key (project_id, tenant_id)
    references public.project(id, tenant_id)
    on delete cascade not valid;

alter table public.project_material_forecast
  drop constraint if exists project_material_forecast_project_id_fkey,
  drop constraint if exists project_material_forecast_material_id_fkey,
  drop constraint if exists project_material_forecast_project_tenant_fk,
  drop constraint if exists project_material_forecast_material_tenant_fk;
alter table public.project_material_forecast
  add constraint project_material_forecast_project_tenant_fk
    foreign key (project_id, tenant_id)
    references public.project(id, tenant_id)
    on delete cascade not valid,
  add constraint project_material_forecast_material_tenant_fk
    foreign key (material_id, tenant_id)
    references public.materials(id, tenant_id) not valid;

alter table public.project_activity_forecast
  drop constraint if exists project_activity_forecast_project_id_fkey,
  drop constraint if exists project_activity_forecast_service_activity_id_fkey,
  drop constraint if exists project_activity_forecast_project_tenant_fk,
  drop constraint if exists project_activity_forecast_activity_tenant_fk;
alter table public.project_activity_forecast
  add constraint project_activity_forecast_project_tenant_fk
    foreign key (project_id, tenant_id)
    references public.project(id, tenant_id)
    on delete cascade not valid,
  add constraint project_activity_forecast_activity_tenant_fk
    foreign key (service_activity_id, tenant_id)
    references public.service_activities(id, tenant_id) not valid;

alter table public.project_history
  validate constraint project_history_project_tenant_fk;
alter table public.project_cancellation_history
  validate constraint project_cancellation_history_project_tenant_fk;
alter table public.project_material_forecast
  validate constraint project_material_forecast_project_tenant_fk;
alter table public.project_material_forecast
  validate constraint project_material_forecast_material_tenant_fk;
alter table public.project_activity_forecast
  validate constraint project_activity_forecast_project_tenant_fk;
alter table public.project_activity_forecast
  validate constraint project_activity_forecast_activity_tenant_fk;

create or replace function public.enforce_programming_active_project()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_active boolean;
begin
  if new.tenant_id is null
     or new.project_id is null
     or coalesce(new.status, '') not in ('PROGRAMADA', 'REPROGRAMADA', 'ADIADA') then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtext('project-programming-project|' || new.tenant_id::text),
    hashtext(new.project_id::text)
  );

  select project_record.is_active
    into v_project_active
  from public.project project_record
  where project_record.id = new.project_id
    and project_record.tenant_id = new.tenant_id;

  if not found then
    raise exception '%',
      jsonb_build_object(
        'success', false,
        'status', 404,
        'reason', 'PROJECT_NOT_FOUND',
        'message', 'Projeto nao encontrado no tenant atual.'
      )::text
      using errcode = 'P0001';
  end if;

  if not v_project_active then
    raise exception '%',
      jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'PROJECT_INACTIVE',
        'message', 'Projeto inativo nao pode receber programacao operacional.'
      )::text
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create or replace function public.prevent_project_inactivation_with_active_programming()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conflict public.project_programming%rowtype;
begin
  if old.is_active is distinct from true or new.is_active is distinct from false then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtext('project-programming-project|' || new.tenant_id::text),
    hashtext(new.id::text)
  );

  select programming.*
    into v_conflict
  from public.project_programming programming
  where programming.tenant_id = new.tenant_id
    and programming.project_id = new.id
    and programming.status in ('PROGRAMADA', 'REPROGRAMADA', 'ADIADA')
  order by programming.execution_date, programming.start_time, programming.id
  limit 1;

  if found then
    raise exception '%',
      jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'PROJECT_HAS_PENDING_PROGRAMMING',
        'message', format(
          'Projeto %s possui programacao operacional pendente. Resolva a programacao antes de inativar.',
          new.sob
        ),
        'detail', jsonb_build_object(
          'currentRecord', jsonb_build_object(
            'id', v_conflict.id,
            'status', v_conflict.status,
            'executionDate', v_conflict.execution_date,
            'teamId', v_conflict.team_id,
            'updatedAt', v_conflict.updated_at
          ),
          'currentUpdatedAt', v_conflict.updated_at,
          'updatedBy', v_conflict.updated_by,
          'changedFields', jsonb_build_array('isActive')
        )
      )::text
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_programming_active_project()
  from public, anon, authenticated;
revoke all on function public.prevent_project_inactivation_with_active_programming()
  from public, anon, authenticated;
grant execute on function public.enforce_programming_active_project()
  to service_role;
grant execute on function public.prevent_project_inactivation_with_active_programming()
  to service_role;

drop trigger if exists trg_00_project_programming_project_active_guard
  on public.project_programming;
create trigger trg_00_project_programming_project_active_guard
before insert or update of tenant_id, project_id, status
on public.project_programming
for each row
execute function public.enforce_programming_active_project();

drop trigger if exists trg_00_project_active_programming_guard
  on public.project;
create trigger trg_00_project_active_programming_guard
before update of is_active
on public.project
for each row
execute function public.prevent_project_inactivation_with_active_programming();

do $$
declare
  v_policy record;
begin
  for v_policy in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = any(array[
        'project',
        'project_history',
        'project_cancellation_history',
        'project_material_forecast',
        'project_activity_forecast',
        'project_programming',
        'project_programming_activities',
        'project_programming_history',
        'project_programming_copy_batches',
        'project_programming_copy_batch_items'
      ])
      and cmd in ('ALL', 'INSERT', 'UPDATE')
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      v_policy.policyname,
      v_policy.schemaname,
      v_policy.tablename
    );
  end loop;
end
$$;

do $$
declare
  v_function record;
begin
  for v_function in
    select procedure.oid::regprocedure as signature
    from pg_proc procedure
    join pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any(array[
        'save_project_record',
        'set_project_record_status',
        'save_project_material_forecast',
        'save_project_activity_forecast',
        'replace_project_material_forecast',
        'append_project_material_forecast',
        'append_project_activity_forecast',
        'copy_project_programming_to_dates',
        'copy_team_programming_period',
        'postpone_project_programming',
        'save_project_programming_full_decimal_with_electrical_and_eq',
        'save_project_programming_batch_full_decimal_with_electrical_and_eq',
        'save_project_programming_work_completion_status_full',
        'set_project_programming_campo_eletrico',
        'set_project_programming_enel_fields',
        'set_project_programming_execution_result',
        'set_project_programming_status'
      ])
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated',
      v_function.signature
    );
    execute format(
      'grant execute on function %s to service_role',
      v_function.signature
    );
  end loop;
end
$$;

do $$
declare
  v_invalid_policy_count bigint;
  v_invalid_execute_count bigint;
begin
  select count(*)
    into v_invalid_policy_count
  from pg_policies
  where schemaname = 'public'
    and tablename = any(array[
      'project',
      'project_history',
      'project_cancellation_history',
      'project_material_forecast',
      'project_activity_forecast',
      'project_programming',
      'project_programming_activities',
      'project_programming_history',
      'project_programming_copy_batches',
      'project_programming_copy_batch_items'
    ])
    and cmd in ('ALL', 'INSERT', 'UPDATE');

  if v_invalid_policy_count > 0 then
    raise exception
      'Migration 233 invalida: ainda existem % policies de escrita direta nas tabelas criticas',
      v_invalid_policy_count;
  end if;

  select count(*)
    into v_invalid_execute_count
  from pg_proc procedure
  join pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname = any(array[
      'save_project_record',
      'set_project_record_status',
      'save_project_material_forecast',
      'save_project_activity_forecast',
      'replace_project_material_forecast',
      'append_project_material_forecast',
      'append_project_activity_forecast',
      'copy_project_programming_to_dates',
      'copy_team_programming_period',
      'postpone_project_programming',
      'save_project_programming_full_decimal_with_electrical_and_eq',
      'save_project_programming_batch_full_decimal_with_electrical_and_eq',
      'save_project_programming_work_completion_status_full',
      'set_project_programming_campo_eletrico',
      'set_project_programming_enel_fields',
      'set_project_programming_execution_result',
      'set_project_programming_status'
    ])
    and has_function_privilege('authenticated', procedure.oid, 'EXECUTE');

  if v_invalid_execute_count > 0 then
    raise exception
      'Migration 233 invalida: authenticated ainda executa % RPCs criticas',
      v_invalid_execute_count;
  end if;
end
$$;

commit;
