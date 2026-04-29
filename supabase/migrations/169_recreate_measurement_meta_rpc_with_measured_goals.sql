-- 169_recreate_measurement_meta_rpc_with_measured_goals.sql
-- Recria RPC da Meta garantindo calculo por Equipes medida.

update public.measurement_cycle_workdays
set worked_days = round(coalesce(worked_days, 0), 0)
where worked_days is distinct from round(coalesce(worked_days, 0), 0);

alter table if exists public.measurement_cycle_target_items
  add column if not exists measured_team_count integer;

update public.measurement_cycle_target_items
set measured_team_count = coalesce(measured_team_count, active_team_count, 0)
where measured_team_count is null;

alter table if exists public.measurement_cycle_target_items
  alter column measured_team_count set default 0;

alter table if exists public.measurement_cycle_target_items
  alter column measured_team_count set not null;

update public.measurement_cycle_target_items
set
  daily_goal = round(daily_value * measured_team_count, 2),
  cycle_goal = round(daily_value * measured_team_count * coalesce(cycles.workdays, 0), 2),
  standard_cycle_goal = round(daily_value * measured_team_count * coalesce(cycles.default_workdays, cycles.workdays, 0), 2),
  worked_cycle_goal = round(daily_value * measured_team_count * round(coalesce(cycles.worked_days, 0), 0), 2)
from public.measurement_cycle_workdays cycles
where cycles.id = measurement_cycle_target_items.cycle_id;

alter table if exists public.measurement_cycle_target_items
  drop constraint if exists chk_measurement_cycle_target_items_values;

alter table if exists public.measurement_cycle_target_items
  add constraint chk_measurement_cycle_target_items_values
  check (
    daily_value >= 0
    and active_team_count >= 0
    and measured_team_count >= 0
    and daily_goal >= 0
    and cycle_goal >= 0
    and standard_cycle_goal >= 0
    and worked_cycle_goal >= 0
  );

drop function if exists public.save_measurement_meta_registration(uuid, uuid, jsonb, date, date, integer, text);
drop function if exists public.save_measurement_meta_registration(uuid, uuid, jsonb, date, date, integer, text, uuid, text);
drop function if exists public.save_measurement_meta_registration(uuid, uuid, jsonb, date, date, integer, integer, text, uuid, text);
drop function if exists public.save_measurement_meta_registration(uuid, uuid, jsonb, date, date, integer, integer, numeric, text, uuid, text);

create function public.save_measurement_meta_registration(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_targets jsonb,
  p_cycle_start date,
  p_cycle_end date,
  p_workdays integer,
  p_default_workdays integer,
  p_worked_days numeric,
  p_notes text default null,
  p_cycle_id uuid default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target jsonb;
  v_team_type_id uuid;
  v_daily_value numeric(14,2);
  v_active_team_count integer;
  v_measured_team_count integer;
  v_cycle_id uuid;
  v_existing_cycle public.measurement_cycle_workdays%rowtype;
  v_action text;
  v_previous_summary jsonb := '{}'::jsonb;
  v_next_summary jsonb := '{}'::jsonb;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_CONTEXT', 'message', 'Contexto invalido para salvar metas.');
  end if;

  if p_cycle_start is null or p_cycle_end is null or p_cycle_end <= p_cycle_start then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_CYCLE', 'message', 'Ciclo invalido para salvar metas.');
  end if;

  if p_workdays is null or p_workdays < 0 or p_workdays > 31 then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_WORKDAYS', 'message', 'Dias uteis deve estar entre 0 e 31.');
  end if;

  if p_default_workdays is null or p_default_workdays < 0 or p_default_workdays > 31 then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_DEFAULT_WORKDAYS', 'message', 'Dias padrao deve estar entre 0 e 31.');
  end if;

  if p_worked_days is null or p_worked_days < 0 or p_worked_days > 31 then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_WORKED_DAYS', 'message', 'Dias trabalhados deve estar entre 0 e 31.');
  end if;

  if p_targets is null or jsonb_typeof(p_targets) <> 'array' or jsonb_array_length(p_targets) = 0 then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_TARGETS', 'message', 'Informe metas validas por tipo de equipe.');
  end if;

  for v_target in select item.value from jsonb_array_elements(p_targets) as item(value)
  loop
    v_team_type_id := nullif(btrim(coalesce(v_target ->> 'teamTypeId', '')), '')::uuid;
    v_daily_value := coalesce(nullif(btrim(coalesce(v_target ->> 'dailyValue', '')), '')::numeric, 0);

    if v_daily_value < 0 then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_DAILY_VALUE', 'message', 'Valor diario invalido para tipo de equipe.');
    end if;

    select count(*)
    into v_active_team_count
    from public.teams t
    where t.tenant_id = p_tenant_id
      and t.team_type_id = v_team_type_id
      and t.ativo = true;

    if not exists (
      select 1
      from public.team_types tt
      where tt.tenant_id = p_tenant_id
        and tt.id = v_team_type_id
        and tt.ativo = true
    ) then
      return jsonb_build_object('success', false, 'status', 422, 'reason', 'INVALID_TEAM_TYPE', 'message', 'Tipo de equipe invalido para o tenant atual.');
    end if;

    v_measured_team_count := coalesce(nullif(btrim(coalesce(v_target ->> 'measuredTeamCount', '')), '')::integer, v_active_team_count);
    if v_measured_team_count < 0 or v_measured_team_count > 999 then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_MEASURED_TEAM_COUNT', 'message', 'Equipes medida deve estar entre 0 e 999.');
    end if;
  end loop;

  if p_cycle_id is not null then
    select *
    into v_existing_cycle
    from public.measurement_cycle_workdays
    where tenant_id = p_tenant_id
      and id = p_cycle_id
    for update;

    if v_existing_cycle.id is null then
      return jsonb_build_object('success', false, 'status', 404, 'reason', 'META_CYCLE_NOT_FOUND', 'message', 'Cadastro de meta do ciclo nao encontrado.');
    end if;

    if exists (
      select 1
      from public.measurement_cycle_workdays mcw
      where mcw.tenant_id = p_tenant_id
        and mcw.cycle_start = p_cycle_start
        and mcw.id <> p_cycle_id
    ) then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'DUPLICATE_META_CYCLE', 'message', 'Ja existe cadastro de meta para este ciclo.');
    end if;

    select jsonb_build_object(
      'cycleStart', v_existing_cycle.cycle_start,
      'cycleEnd', v_existing_cycle.cycle_end,
      'workdays', v_existing_cycle.workdays,
      'defaultWorkdays', v_existing_cycle.default_workdays,
      'workedDays', v_existing_cycle.worked_days,
      'notes', v_existing_cycle.notes,
      'totalMeasuredTeams', coalesce(sum(mcti.measured_team_count), 0),
      'totalDailyGoal', coalesce(sum(mcti.daily_goal), 0),
      'totalCycleGoal', coalesce(sum(mcti.cycle_goal), 0),
      'totalStandardCycleGoal', coalesce(sum(mcti.standard_cycle_goal), 0),
      'totalWorkedCycleGoal', coalesce(sum(mcti.worked_cycle_goal), 0)
    )
    into v_previous_summary
    from public.measurement_cycle_target_items mcti
    where mcti.tenant_id = p_tenant_id
      and mcti.cycle_id = p_cycle_id;

    v_cycle_id := p_cycle_id;
    v_action := 'UPDATE';
  else
    if exists (
      select 1
      from public.measurement_cycle_workdays mcw
      where mcw.tenant_id = p_tenant_id
        and mcw.cycle_start = p_cycle_start
    ) then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'DUPLICATE_META_CYCLE', 'message', 'Ja existe cadastro de meta para este ciclo.');
    end if;

    v_cycle_id := gen_random_uuid();
    v_action := 'CREATE';
  end if;

  for v_target in select item.value from jsonb_array_elements(p_targets) as item(value)
  loop
    v_team_type_id := nullif(btrim(coalesce(v_target ->> 'teamTypeId', '')), '')::uuid;
    v_daily_value := coalesce(nullif(btrim(coalesce(v_target ->> 'dailyValue', '')), '')::numeric, 0);

    insert into public.measurement_team_type_targets (
      tenant_id,
      team_type_id,
      daily_value,
      ativo,
      created_by,
      updated_by
    )
    values (
      p_tenant_id,
      v_team_type_id,
      v_daily_value,
      true,
      p_actor_user_id,
      p_actor_user_id
    )
    on conflict (tenant_id, team_type_id) do update
    set
      daily_value = excluded.daily_value,
      ativo = true,
      updated_by = p_actor_user_id,
      updated_at = now();
  end loop;

  if v_action = 'UPDATE' then
    update public.measurement_cycle_workdays
    set
      cycle_start = p_cycle_start,
      cycle_end = p_cycle_end,
      workdays = p_workdays,
      default_workdays = p_default_workdays,
      worked_days = round(p_worked_days, 0),
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      updated_by = p_actor_user_id,
      updated_at = now()
    where tenant_id = p_tenant_id
      and id = v_cycle_id;
  else
    insert into public.measurement_cycle_workdays (
      id,
      tenant_id,
      cycle_start,
      cycle_end,
      workdays,
      default_workdays,
      worked_days,
      notes,
      created_by,
      updated_by
    )
    values (
      v_cycle_id,
      p_tenant_id,
      p_cycle_start,
      p_cycle_end,
      p_workdays,
      p_default_workdays,
      round(p_worked_days, 0),
      nullif(btrim(coalesce(p_notes, '')), ''),
      p_actor_user_id,
      p_actor_user_id
    );
  end if;

  delete from public.measurement_cycle_target_items
  where tenant_id = p_tenant_id
    and cycle_id = v_cycle_id;

  for v_target in select item.value from jsonb_array_elements(p_targets) as item(value)
  loop
    v_team_type_id := nullif(btrim(coalesce(v_target ->> 'teamTypeId', '')), '')::uuid;
    v_daily_value := coalesce(nullif(btrim(coalesce(v_target ->> 'dailyValue', '')), '')::numeric, 0);

    select count(*)
    into v_active_team_count
    from public.teams t
    where t.tenant_id = p_tenant_id
      and t.team_type_id = v_team_type_id
      and t.ativo = true;

    v_measured_team_count := coalesce(nullif(btrim(coalesce(v_target ->> 'measuredTeamCount', '')), '')::integer, v_active_team_count);

    insert into public.measurement_cycle_target_items (
      tenant_id,
      cycle_id,
      team_type_id,
      daily_value,
      active_team_count,
      measured_team_count,
      daily_goal,
      cycle_goal,
      standard_cycle_goal,
      worked_cycle_goal,
      created_by,
      updated_by
    )
    values (
      p_tenant_id,
      v_cycle_id,
      v_team_type_id,
      v_daily_value,
      v_active_team_count,
      v_measured_team_count,
      round(v_daily_value * v_measured_team_count, 2),
      round(v_daily_value * v_measured_team_count * p_workdays, 2),
      round(v_daily_value * v_measured_team_count * p_default_workdays, 2),
      round(v_daily_value * v_measured_team_count * round(p_worked_days, 0), 2),
      p_actor_user_id,
      p_actor_user_id
    );
  end loop;

  select jsonb_build_object(
    'cycleStart', p_cycle_start,
    'cycleEnd', p_cycle_end,
    'workdays', p_workdays,
    'defaultWorkdays', p_default_workdays,
    'workedDays', round(p_worked_days, 0),
    'notes', nullif(btrim(coalesce(p_notes, '')), ''),
    'totalMeasuredTeams', coalesce(sum(mcti.measured_team_count), 0),
    'totalDailyGoal', coalesce(sum(mcti.daily_goal), 0),
    'totalCycleGoal', coalesce(sum(mcti.cycle_goal), 0),
    'totalStandardCycleGoal', coalesce(sum(mcti.standard_cycle_goal), 0),
    'totalWorkedCycleGoal', coalesce(sum(mcti.worked_cycle_goal), 0)
  )
  into v_next_summary
  from public.measurement_cycle_target_items mcti
  where mcti.tenant_id = p_tenant_id
    and mcti.cycle_id = v_cycle_id;

  insert into public.measurement_meta_history (
    tenant_id,
    cycle_id,
    action_type,
    reason,
    changes,
    metadata,
    created_by
  )
  values (
    p_tenant_id,
    v_cycle_id,
    v_action,
    nullif(btrim(coalesce(p_reason, '')), ''),
    jsonb_build_object('from', v_previous_summary, 'to', v_next_summary),
    jsonb_build_object('targetCount', jsonb_array_length(p_targets)),
    p_actor_user_id
  );

  return jsonb_build_object('success', true, 'status', 200, 'cycle_id', v_cycle_id, 'message', 'Cadastro de metas salvo com sucesso.');
exception
  when invalid_text_representation then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_PAYLOAD', 'message', 'Payload invalido para salvar metas.');
  when unique_violation then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'DUPLICATE_META_CYCLE', 'message', 'Ja existe cadastro de meta para este ciclo.');
  when others then
    return jsonb_build_object('success', false, 'status', 500, 'reason', 'SAVE_META_FAILED', 'message', format('Falha ao salvar cadastro de metas: %s', sqlerrm));
end;
$$;

grant execute on function public.save_measurement_meta_registration(uuid, uuid, jsonb, date, date, integer, integer, numeric, text, uuid, text)
  to authenticated;
