-- 417_measurement_meta_by_team_category.sql
-- Meta por tipo operacional: a operacao COMERCIAL passa a ter meta propria.
--
-- CONTEXTO
-- ---------------------------------------------------------------------------
-- Depois da 416, cada `team_types` pertence a um tipo operacional
-- (TECNICA/COMERCIAL). Como `measurement_team_type_targets` e
-- `measurement_cycle_target_items` ja sao chaveadas por `team_type_id`, o valor
-- diario e a meta do ciclo JA ficaram naturalmente separados entre as duas
-- operacoes -- essas duas tabelas nao mudam aqui.
--
-- O que travava a meta comercial era a linha do CICLO:
-- `measurement_cycle_workdays` e unique (tenant_id, cycle_start), uma linha por
-- periodo por tenant. Consequencias concretas:
--   1. cadastrar a meta comercial de um periodo que a tecnica ja cadastrou
--      voltava `DUPLICATE_META_CYCLE`;
--   2. `worked_days` (media de dias trabalhados) e uma coluna so -- gravar a
--      comercial sobrescreveria a media da tecnica no mesmo ciclo.
--
-- O QUE ESTA MIGRATION FAZ
-- ---------------------------------------------------------------------------
-- 1. `measurement_cycle_workdays.team_category_id` obrigatorio, com backfill
--    TECNICA para todo ciclo ja cadastrado -- nenhuma meta atual muda.
-- 2. A unicidade passa de (tenant, cycle_start) para
--    (tenant, tipo operacional, cycle_start): cada operacao tem o seu ciclo,
--    com seus dias uteis, seus dias padrao e sua propria media.
-- 3. `save_measurement_meta_registration` ganha `p_team_category_id`, valida que
--    TODO tipo enviado pertence a esse tipo operacional e grava o ciclo com ele.
--    A assinatura antiga e derrubada para nao sobrar overload ambiguo.
--
-- O QUE ESTA MIGRATION NAO FAZ
-- ---------------------------------------------------------------------------
-- Nao cria meta comercial nenhuma: quem cadastra e o usuario, pela tela Meta,
-- depois de existirem tipos de equipe comerciais (`/tipo-equipe`, migration 416)
-- e equipes comerciais ativas.
--
-- Nao mexe em `measurement_team_type_targets` nem em
-- `measurement_cycle_target_items`: a 416 ja as separou por tabela de tipos.

-- =============================================================================
-- 1) `measurement_cycle_workdays` por tipo operacional
-- =============================================================================
alter table if exists public.measurement_cycle_workdays
  add column if not exists team_category_id uuid null;

update public.measurement_cycle_workdays mcw
set team_category_id = tc.id
from public.team_categories tc
where tc.tenant_id = mcw.tenant_id
  and tc.code = 'TECNICA'
  and mcw.team_category_id is null;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'measurement_cycle_workdays'
      and tc.constraint_name = 'measurement_cycle_workdays_team_category_tenant_fk'
  ) then
    alter table public.measurement_cycle_workdays
      add constraint measurement_cycle_workdays_team_category_tenant_fk
      foreign key (team_category_id, tenant_id)
      references public.team_categories(id, tenant_id);
  end if;
end;
$$;

alter table if exists public.measurement_cycle_workdays
  alter column team_category_id set not null;

-- A unicidade antiga (tenant, cycle_start) e exatamente o que impedia a segunda
-- operacao de cadastrar o mesmo periodo. Ela nasceu como constraint UNIQUE na
-- 161, entao pode estar publicada como constraint ou como indice, conforme o
-- caminho por onde o ambiente foi criado -- o bloco abaixo cobre os dois.
do $$
declare
  v_constraint_name text;
begin
  select tc.constraint_name
  into v_constraint_name
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on kcu.constraint_name = tc.constraint_name
   and kcu.table_schema = tc.table_schema
  where tc.table_schema = 'public'
    and tc.table_name = 'measurement_cycle_workdays'
    and tc.constraint_type = 'UNIQUE'
  group by tc.constraint_name
  having array_agg(kcu.column_name::text order by kcu.ordinal_position) = array['tenant_id', 'cycle_start']
  limit 1;

  if v_constraint_name is not null then
    execute format(
      'alter table public.measurement_cycle_workdays drop constraint %I',
      v_constraint_name
    );
  end if;
end;
$$;

drop index if exists public.measurement_cycle_workdays_tenant_id_cycle_start_key;

create unique index if not exists measurement_cycle_workdays_tenant_category_cycle_key
  on public.measurement_cycle_workdays (tenant_id, team_category_id, cycle_start);

create index if not exists idx_measurement_cycle_workdays_tenant_category_start
  on public.measurement_cycle_workdays (tenant_id, team_category_id, cycle_start desc);

-- =============================================================================
-- 2) `save_measurement_meta_registration` com tipo operacional
-- =============================================================================
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
  p_reason text default null,
  p_team_category_id uuid default null
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

  if not exists (
    select 1
    from public.team_categories tc
    where tc.id = p_team_category_id
      and tc.tenant_id = p_tenant_id
      and tc.ativo = true
  ) then
    return jsonb_build_object('success', false, 'status', 422, 'reason', 'INVALID_TEAM_CATEGORY', 'message', 'Tipo operacional invalido para o tenant atual.');
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

    -- Conta so as equipes ATIVAS do tipo. Como o tipo pertence a um tipo
    -- operacional (416), a contagem ja fica restrita a operacao certa.
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

    -- Sem esta trava, a tela de uma operacao poderia sobrescrever o valor diario
    -- de um tipo da outra: `measurement_team_type_targets` e chaveada so por
    -- `team_type_id`, e o payload vem do cliente.
    if not exists (
      select 1
      from public.team_types tt
      where tt.tenant_id = p_tenant_id
        and tt.id = v_team_type_id
        and tt.team_category_id = p_team_category_id
    ) then
      return jsonb_build_object('success', false, 'status', 422, 'reason', 'TEAM_TYPE_CATEGORY_MISMATCH', 'message', 'Ha tipo de equipe de outro tipo operacional na meta enviada.');
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

    -- O ciclo nao troca de operacao na edicao: seria o mesmo que mover a meta
    -- inteira de lado, e os itens ja gravados continuariam apontando para tipos
    -- da operacao antiga.
    if v_existing_cycle.team_category_id is distinct from p_team_category_id then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'META_CYCLE_CATEGORY_MISMATCH', 'message', 'Este cadastro de meta pertence a outro tipo operacional.');
    end if;

    if exists (
      select 1
      from public.measurement_cycle_workdays mcw
      where mcw.tenant_id = p_tenant_id
        and mcw.team_category_id = p_team_category_id
        and mcw.cycle_start = p_cycle_start
        and mcw.id <> p_cycle_id
    ) then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'DUPLICATE_META_CYCLE', 'message', 'Ja existe cadastro de meta para este ciclo neste tipo operacional.');
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
        and mcw.team_category_id = p_team_category_id
        and mcw.cycle_start = p_cycle_start
    ) then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'DUPLICATE_META_CYCLE', 'message', 'Ja existe cadastro de meta para este ciclo neste tipo operacional.');
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
      updated_by = excluded.updated_by,
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
      team_category_id,
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
      p_team_category_id,
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
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'DUPLICATE_META_CYCLE', 'message', 'Ja existe cadastro de meta para este ciclo neste tipo operacional.');
  when others then
    return jsonb_build_object('success', false, 'status', 500, 'reason', 'SAVE_META_FAILED', 'message', format('Falha ao salvar cadastro de metas: %s', sqlerrm));
end;
$$;

-- A versao da 169 concedia EXECUTE a `authenticated`, de antes do padrao fixado
-- pelas 251/309/393. O app chama por Route Handler com `service_role`, entao a
-- funcao nova ja nasce fechada.
revoke all on function public.save_measurement_meta_registration(
  uuid, uuid, jsonb, date, date, integer, integer, numeric, text, uuid, text, uuid
) from public, anon, authenticated;

grant execute on function public.save_measurement_meta_registration(
  uuid, uuid, jsonb, date, date, integer, integer, numeric, text, uuid, text, uuid
) to service_role;

-- =============================================================================
-- Validacao pos-aplicacao
-- =============================================================================
do $$
declare
  v_save_fn regprocedure := 'public.save_measurement_meta_registration(uuid, uuid, jsonb, date, date, integer, integer, numeric, text, uuid, text, uuid)'::regprocedure;
  v_missing integer;
  v_old_overloads integer;
  v_old_signatures text;
begin
  select count(*)
  into v_missing
  from public.measurement_cycle_workdays
  where team_category_id is null;

  if v_missing > 0 then
    raise exception '417: % ciclo(s) de meta ficaram sem team_category_id.', v_missing;
  end if;

  -- A unicidade antiga nao pode sobrar: com ela, a segunda operacao continuaria
  -- sem conseguir cadastrar o mesmo periodo.
  if exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'measurement_cycle_workdays'
      and indexdef ilike '%unique%'
      and indexdef ilike '%(tenant_id, cycle_start)%'
  ) then
    raise exception '417: unicidade antiga (tenant_id, cycle_start) ainda publicada em measurement_cycle_workdays';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'measurement_cycle_workdays'
      and indexname = 'measurement_cycle_workdays_tenant_category_cycle_key'
  ) then
    raise exception '417: unicidade nova por tipo operacional nao foi criada';
  end if;

  select count(*), coalesce(string_agg(sig, ' | '), '(nenhuma)')
  into v_old_overloads, v_old_signatures
  from (
    select pg_get_function_identity_arguments(p.oid) as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'save_measurement_meta_registration'
      and p.oid <> v_save_fn::oid
  ) leftovers;

  if v_old_overloads > 0 then
    raise exception '417: % versao(oes) antiga(s) de save_measurement_meta_registration ainda publicada(s): %',
      v_old_overloads, v_old_signatures;
  end if;

  if has_function_privilege('anon', v_save_fn, 'execute')
     or has_function_privilege('authenticated', v_save_fn, 'execute') then
    raise exception '417: save_measurement_meta_registration ainda executavel por anon/authenticated';
  end if;
end;
$$;
