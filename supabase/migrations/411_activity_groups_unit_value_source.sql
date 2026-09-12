-- 411_activity_groups_unit_value_source.sql
-- Move a fonte de verdade do Valor de Atividades para o catalogo
-- `activity_groups`, mantendo `service_activities.unit_value` como snapshot.

begin;

alter table if exists public.activity_groups
  add column if not exists unit_value numeric(14, 2) not null default 0;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'activity_groups'
      and tc.constraint_name = 'activity_groups_unit_value_non_negative_check'
  ) then
    alter table public.activity_groups
      add constraint activity_groups_unit_value_non_negative_check
      check (unit_value >= 0);
  end if;
end;
$$;

with known_values as (
  select *
  from (
    values
      ('SOTAEREA', 225.92::numeric(14, 2)),
      ('SOC', 151.83::numeric(14, 2)),
      ('PODA', 215.26::numeric(14, 2)),
      ('LLEE', 413.32::numeric(14, 2)),
      ('LINHAVIVA', 413.32::numeric(14, 2)),
      ('LLEELINHAVIVA', 413.32::numeric(14, 2)),
      ('SEGURANCA', 62.31::numeric(14, 2))
  ) as rows(normalized_name, unit_value)
),
normalized_groups as (
  select
    ag.id,
    ag.tenant_id,
    regexp_replace(
      translate(
        upper(btrim(coalesce(ag.name, ''))),
        U&'\00C1\00C0\00C2\00C3\00C4\00C9\00C8\00CA\00CB\00CD\00CC\00CE\00CF\00D3\00D2\00D4\00D5\00D6\00DA\00D9\00DB\00DC\00C7',
        'AAAAAEEEEIIIIOOOOOUUUUC'
      ),
      '[^A-Z0-9]+',
      '',
      'g'
    ) as normalized_name
  from public.activity_groups ag
),
activity_values as (
  select distinct on (sa.tenant_id, sa.group_id)
    sa.tenant_id,
    sa.group_id,
    coalesce(sa.unit_value, 0)::numeric(14, 2) as unit_value
  from public.service_activities sa
  where sa.group_id is not null
  order by
    sa.tenant_id,
    sa.group_id,
    sa.ativo desc,
    sa.updated_at desc,
    sa.created_at desc
)
update public.activity_groups ag
set unit_value = coalesce(kv.unit_value, av.unit_value, ag.unit_value, 0)
from normalized_groups ng
left join known_values kv
  on kv.normalized_name = ng.normalized_name
left join activity_values av
  on av.tenant_id = ng.tenant_id
 and av.group_id = ng.id
where ag.tenant_id = ng.tenant_id
  and ag.id = ng.id;

drop function if exists public.save_activity_group_record(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz
);

create or replace function public.save_activity_group_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_activity_group_id uuid default null,
  p_name text default null,
  p_unit_value numeric default null,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.activity_groups%rowtype;
  v_activity_group_id uuid := p_activity_group_id;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_unit_value numeric(14, 2) := round(coalesce(p_unit_value, -1), 2);
  v_updated_at timestamptz;
  v_changes jsonb;
  v_duplicate_id uuid;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'TENANT_OR_ACTOR_REQUIRED',
      'message', 'Tenant e usuario sao obrigatorios para salvar grupo de atividade.'
    );
  end if;

  if v_name is null or v_unit_value < 0 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_REQUIRED_FIELDS',
      'message', 'Informe o nome e o valor do grupo de atividade.'
    );
  end if;

  select ag.id
  into v_duplicate_id
  from public.activity_groups ag
  where ag.tenant_id = p_tenant_id
    and upper(btrim(ag.name)) = upper(v_name)
    and (v_activity_group_id is null or ag.id <> v_activity_group_id)
  limit 1;

  if v_duplicate_id is not null then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_NAME',
      'message', 'Ja existe grupo de atividade com este nome no tenant atual.'
    );
  end if;

  if v_activity_group_id is null then
    insert into public.activity_groups (
      tenant_id,
      name,
      unit_value,
      ativo,
      created_by,
      updated_by
    )
    values (
      p_tenant_id,
      v_name,
      v_unit_value,
      true,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at
    into v_activity_group_id, v_updated_at;
  else
    select *
    into v_current
    from public.activity_groups
    where tenant_id = p_tenant_id
      and id = v_activity_group_id
    for update;

    if not found then
      return jsonb_build_object(
        'success', false,
        'status', 404,
        'reason', 'ACTIVITY_GROUP_NOT_FOUND',
        'message', 'Grupo de atividade nao encontrado.'
      );
    end if;

    if p_expected_updated_at is null then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
        'message', 'Atualize a lista antes de editar o grupo de atividade.'
      );
    end if;

    if v_current.updated_at <> p_expected_updated_at then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'CONCURRENT_MODIFICATION',
        'message', format('O grupo de atividade %s foi alterado por outro usuario. Recarregue os dados antes de salvar novamente.', v_current.name)
      );
    end if;

    if not v_current.ativo then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'RECORD_INACTIVE',
        'message', 'Ative o grupo de atividade antes de editar.'
      );
    end if;

    v_changes := jsonb_strip_nulls(jsonb_build_object(
      'name', case when v_current.name is distinct from v_name then jsonb_build_object('from', v_current.name, 'to', v_name) end,
      'unitValue', case when v_current.unit_value is distinct from v_unit_value then jsonb_build_object('from', v_current.unit_value::text, 'to', v_unit_value::text) end
    ));

    if v_changes = '{}'::jsonb then
      return jsonb_build_object(
        'success', true,
        'status', 200,
        'activity_group_id', v_activity_group_id,
        'updated_at', v_current.updated_at,
        'message', format('Nenhuma alteracao detectada no grupo de atividade %s.', v_current.name)
      );
    end if;

    update public.activity_groups
    set
      name = v_name,
      unit_value = v_unit_value,
      updated_by = p_actor_user_id
    where tenant_id = p_tenant_id
      and id = v_activity_group_id
    returning updated_at
    into v_updated_at;

    update public.service_activities
    set
      group_name = v_name,
      unit_value = v_unit_value,
      updated_by = p_actor_user_id
    where tenant_id = p_tenant_id
      and group_id = v_activity_group_id
      and (
        group_name is distinct from v_name
        or unit_value is distinct from v_unit_value
      );

    insert into public.app_entity_history (
      tenant_id,
      module_key,
      entity_table,
      entity_id,
      entity_code,
      change_type,
      reason,
      changes,
      metadata,
      created_by,
      updated_by
    )
    values (
      p_tenant_id,
      'grupo-atividade',
      'activity_groups',
      v_activity_group_id,
      v_name,
      'UPDATE',
      null,
      v_changes,
      '{}'::jsonb,
      p_actor_user_id,
      p_actor_user_id
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'activity_group_id', v_activity_group_id,
    'updated_at', v_updated_at,
    'message',
      case
        when p_activity_group_id is null then format('Grupo de atividade %s cadastrado com sucesso.', v_name)
        else format('Grupo de atividade %s atualizado com sucesso.', v_name)
      end
  );
exception
  when unique_violation then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_NAME',
      'message', 'Ja existe grupo de atividade com este nome no tenant atual.'
    );
end;
$$;

revoke all on function public.save_activity_group_record(
  uuid,
  uuid,
  uuid,
  text,
  numeric,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.save_activity_group_record(
  uuid,
  uuid,
  uuid,
  text,
  numeric,
  timestamptz
) to service_role;

create or replace function public.save_service_activity_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_activity_id uuid default null,
  p_code text default null,
  p_code_idd text default null,
  p_description text default null,
  p_team_type_id uuid default null,
  p_type_service uuid default null,
  p_group_id uuid default null,
  p_unit_value numeric default null,
  p_voice_point numeric default null,
  p_unit text default null,
  p_scope text default null,
  p_changes jsonb default '{}'::jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.service_activities%rowtype;
  v_activity_id uuid;
  v_updated_at timestamptz;
  v_group_name text;
  v_group_unit_value numeric(14, 2);
begin
  if p_type_service is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'CATEGORY_REQUIRED',
      'message', 'Categoria obrigatoria para salvar atividade.'
    );
  end if;

  if coalesce(p_voice_point, 0) <= 0 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'VOICE_POINT_REQUIRED',
      'message', 'Pontos obrigatorio para salvar atividade.'
    );
  end if;

  if p_group_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'GROUP_REQUIRED',
      'message', 'Grupo obrigatorio para salvar atividade.'
    );
  end if;

  if not exists (
    select 1
    from public.types_service_activities tsa
    where tsa.tenant_id = p_tenant_id
      and tsa.id = p_type_service
      and tsa.ativo = true
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'INVALID_CATEGORY',
      'message', 'Categoria invalida para o tenant atual.'
    );
  end if;

  select ag.name, ag.unit_value
  into v_group_name, v_group_unit_value
  from public.activity_groups ag
  where ag.tenant_id = p_tenant_id
    and ag.id = p_group_id
    and ag.ativo = true;

  if v_group_name is null then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'INVALID_GROUP',
      'message', 'Grupo invalido para o tenant atual.'
    );
  end if;

  if p_activity_id is null then
    insert into public.service_activities (
      tenant_id,
      code,
      code_idd,
      description,
      team_type_id,
      type_service,
      group_id,
      group_name,
      unit_value,
      voice_point,
      unit,
      scope,
      ativo,
      cancellation_reason,
      canceled_at,
      canceled_by,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      p_code,
      nullif(btrim(coalesce(p_code_idd, '')), ''),
      p_description,
      p_team_type_id,
      p_type_service,
      p_group_id,
      v_group_name,
      v_group_unit_value,
      p_voice_point,
      p_unit,
      nullif(btrim(coalesce(p_scope, '')), ''),
      true,
      null,
      null,
      null,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at
    into v_activity_id, v_updated_at;

    return jsonb_build_object(
      'success', true,
      'status', 200,
      'activity_id', v_activity_id,
      'updated_at', v_updated_at
    );
  end if;

  select *
  into v_current
  from public.service_activities
  where id = p_activity_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'ACTIVITY_NOT_FOUND',
      'message', 'Atividade nao encontrada.'
    );
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
      'message', 'Atualize a lista antes de editar a atividade.'
    );
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'CONCURRENT_MODIFICATION',
      'message', format('A atividade %s foi alterada por outro usuario. Recarregue os dados antes de salvar novamente.', v_current.code)
    );
  end if;

  if not v_current.ativo then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'RECORD_INACTIVE',
      'message', 'Ative a atividade antes de editar.'
    );
  end if;

  update public.service_activities
  set
    code = p_code,
    code_idd = nullif(btrim(coalesce(p_code_idd, '')), ''),
    description = p_description,
    team_type_id = p_team_type_id,
    type_service = p_type_service,
    group_id = p_group_id,
    group_name = v_group_name,
    unit_value = v_group_unit_value,
    voice_point = p_voice_point,
    unit = p_unit,
    scope = nullif(btrim(coalesce(p_scope, '')), ''),
    updated_by = p_actor_user_id
  where id = p_activity_id
    and tenant_id = p_tenant_id
  returning id, updated_at
  into v_activity_id, v_updated_at;

  if coalesce(jsonb_object_length(coalesce(p_changes, '{}'::jsonb)), 0) > 0 then
    insert into public.app_entity_history (
      tenant_id,
      module_key,
      entity_table,
      entity_id,
      entity_code,
      change_type,
      reason,
      changes,
      metadata,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      'atividades',
      'service_activities',
      p_activity_id,
      p_code,
      'UPDATE',
      null,
      coalesce(p_changes, '{}'::jsonb),
      '{}'::jsonb,
      p_actor_user_id,
      p_actor_user_id
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'activity_id', v_activity_id,
    'updated_at', v_updated_at
  );
exception
  when unique_violation then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_ACTIVITY_CODE',
      'message', 'Ja existe atividade com este codigo no tenant atual.'
    );
end;
$$;

revoke all on function public.save_service_activity_record(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  uuid,
  uuid,
  uuid,
  numeric,
  numeric,
  text,
  text,
  jsonb,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.save_service_activity_record(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  uuid,
  uuid,
  uuid,
  numeric,
  numeric,
  text,
  text,
  jsonb,
  timestamptz
) to service_role;

do $$
declare
  v_save_group_fn regprocedure := 'public.save_activity_group_record(uuid, uuid, uuid, text, numeric, timestamptz)'::regprocedure;
  v_save_activity_fn regprocedure := 'public.save_service_activity_record(uuid, uuid, uuid, text, text, text, uuid, uuid, uuid, numeric, numeric, text, text, jsonb, timestamptz)'::regprocedure;
begin
  if has_function_privilege('anon', v_save_group_fn, 'execute')
     or has_function_privilege('authenticated', v_save_group_fn, 'execute') then
    raise exception '411: save_activity_group_record ainda executavel por anon/authenticated';
  end if;

  if has_function_privilege('anon', v_save_activity_fn, 'execute')
     or has_function_privilege('authenticated', v_save_activity_fn, 'execute') then
    raise exception '411: save_service_activity_record ainda executavel por anon/authenticated';
  end if;

  if exists (
    select 1
    from public.activity_groups
    where unit_value is null
       or unit_value < 0
  ) then
    raise exception '411: existem grupos de atividade sem valor valido';
  end if;
end;
$$;

commit;
