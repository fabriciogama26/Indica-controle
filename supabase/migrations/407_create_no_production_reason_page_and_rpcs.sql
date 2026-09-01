-- 407_create_no_production_reason_page_and_rpcs.sql
-- Cria a tela de Cadastro Base para administrar o catalogo existente de
-- `measurement_no_production_reasons`, usado por Medicao, Medicao Asbuilt e
-- Faturamento em registros do tipo SEM_PRODUCAO.

revoke insert, update, delete on public.measurement_no_production_reasons from public, anon, authenticated;

create or replace function public.save_no_production_reason_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_no_production_reason_id uuid default null,
  p_code text default null,
  p_name text default null,
  p_sort_order integer default null,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.measurement_no_production_reasons%rowtype;
  v_no_production_reason_id uuid := p_no_production_reason_id;
  v_code text := upper(nullif(btrim(coalesce(p_code, '')), ''));
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_sort_order integer := p_sort_order;
  v_updated_at timestamptz;
  v_changes jsonb;
  v_duplicate_name_id uuid;
  v_constraint_name text;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'TENANT_OR_ACTOR_REQUIRED',
      'message', 'Tenant e usuario sao obrigatorios para salvar motivo sem producao.'
    );
  end if;

  if v_code is null or v_name is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_REQUIRED_FIELDS',
      'message', 'Informe codigo e nome do motivo sem producao.'
    );
  end if;

  if v_code !~ '^[A-Z0-9_]+$' then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_CODE',
      'message', 'Codigo do motivo sem producao deve conter apenas letras, numeros e underline.'
    );
  end if;

  if v_no_production_reason_id is null and v_sort_order is null then
    perform pg_advisory_xact_lock(hashtext('measurement_no_production_reasons'), hashtext(p_tenant_id::text));

    select coalesce((max(reason.sort_order) / 10) * 10 + 10, 10)
    into v_sort_order
    from public.measurement_no_production_reasons reason
    where reason.tenant_id = p_tenant_id;
  end if;

  if v_sort_order is null or v_sort_order < 0 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_SORT_ORDER',
      'message', 'Ordem do motivo sem producao deve ser maior ou igual a zero.'
    );
  end if;

  select reason.id
  into v_duplicate_name_id
  from public.measurement_no_production_reasons reason
  where reason.tenant_id = p_tenant_id
    and upper(btrim(reason.name)) = upper(v_name)
    and (v_no_production_reason_id is null or reason.id <> v_no_production_reason_id)
  limit 1;

  if v_duplicate_name_id is not null then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_NAME',
      'message', 'Ja existe motivo sem producao com este nome no tenant atual.'
    );
  end if;

  if v_no_production_reason_id is null then
    insert into public.measurement_no_production_reasons (
      tenant_id,
      code,
      name,
      is_active,
      sort_order,
      created_by,
      updated_by
    )
    values (
      p_tenant_id,
      v_code,
      v_name,
      true,
      v_sort_order,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at
    into v_no_production_reason_id, v_updated_at;
  else
    select *
    into v_current
    from public.measurement_no_production_reasons
    where tenant_id = p_tenant_id
      and id = v_no_production_reason_id
    for update;

    if not found then
      return jsonb_build_object(
        'success', false,
        'status', 404,
        'reason', 'NO_PRODUCTION_REASON_NOT_FOUND',
        'message', 'Motivo sem producao nao encontrado.'
      );
    end if;

    if p_expected_updated_at is null then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
        'message', 'Atualize a lista antes de editar o motivo sem producao.'
      );
    end if;

    if v_current.updated_at <> p_expected_updated_at then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'CONCURRENT_MODIFICATION',
        'message', format('O motivo sem producao %s foi alterado por outro usuario. Recarregue os dados antes de salvar novamente.', v_current.name)
      );
    end if;

    if not v_current.is_active then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'RECORD_INACTIVE',
        'message', 'Ative o motivo sem producao antes de editar.'
      );
    end if;

    v_changes := jsonb_strip_nulls(jsonb_build_object(
      'code', case when v_current.code is distinct from v_code then jsonb_build_object('from', v_current.code, 'to', v_code) end,
      'name', case when v_current.name is distinct from v_name then jsonb_build_object('from', v_current.name, 'to', v_name) end,
      'sortOrder', case when v_current.sort_order is distinct from v_sort_order then jsonb_build_object('from', v_current.sort_order::text, 'to', v_sort_order::text) end
    ));

    if v_changes = '{}'::jsonb then
      return jsonb_build_object(
        'success', true,
        'status', 200,
        'no_production_reason_id', v_no_production_reason_id,
        'updated_at', v_current.updated_at,
        'message', format('Nenhuma alteracao detectada no motivo sem producao %s.', v_current.name)
      );
    end if;

    update public.measurement_no_production_reasons
    set
      code = v_code,
      name = v_name,
      sort_order = v_sort_order,
      updated_by = p_actor_user_id
    where tenant_id = p_tenant_id
      and id = v_no_production_reason_id
    returning updated_at
    into v_updated_at;

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
      'motivo-sem-producao',
      'measurement_no_production_reasons',
      v_no_production_reason_id,
      v_code,
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
    'no_production_reason_id', v_no_production_reason_id,
    'updated_at', v_updated_at,
    'message',
      case
        when p_no_production_reason_id is null then format('Motivo sem producao %s cadastrado com sucesso.', v_name)
        else format('Motivo sem producao %s atualizado com sucesso.', v_name)
      end
  );
exception
  when unique_violation then
    get stacked diagnostics v_constraint_name = constraint_name;
    if v_constraint_name = 'measurement_no_production_reasons_unique_code' then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'DUPLICATE_CODE',
        'message', 'Ja existe motivo sem producao com este codigo no tenant atual.'
      );
    end if;
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_VALUE',
      'message', 'Registro duplicado ao salvar o motivo sem producao.'
    );
end;
$$;

revoke all on function public.save_no_production_reason_record(
  uuid,
  uuid,
  uuid,
  text,
  text,
  integer,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.save_no_production_reason_record(
  uuid,
  uuid,
  uuid,
  text,
  text,
  integer,
  timestamptz
) to service_role;

create or replace function public.set_no_production_reason_record_status(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_no_production_reason_id uuid,
  p_action text,
  p_reason text,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.measurement_no_production_reasons%rowtype;
  v_action text := case when upper(coalesce(p_action, '')) = 'ACTIVATE' then 'ACTIVATE' else 'CANCEL' end;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_updated_at timestamptz;
  v_next_active boolean;
  v_changes jsonb;
  v_measurement_count integer;
  v_asbuilt_count integer;
  v_billing_count integer;
  v_total_usage integer;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'TENANT_OR_ACTOR_REQUIRED',
      'message', 'Tenant e usuario sao obrigatorios para alterar motivo sem producao.'
    );
  end if;

  if p_no_production_reason_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'NO_PRODUCTION_REASON_REQUIRED',
      'message', 'Motivo sem producao invalido para atualizar status.'
    );
  end if;

  if v_reason is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', case when v_action = 'ACTIVATE' then 'ACTIVATION_REASON_REQUIRED' else 'CANCELLATION_REASON_REQUIRED' end,
      'message', case when v_action = 'ACTIVATE' then 'Informe o motivo da ativacao.' else 'Informe o motivo do cancelamento.' end
    );
  end if;

  select *
  into v_current
  from public.measurement_no_production_reasons
  where tenant_id = p_tenant_id
    and id = p_no_production_reason_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'NO_PRODUCTION_REASON_NOT_FOUND',
      'message', 'Motivo sem producao nao encontrado.'
    );
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
      'message', 'Atualize a lista antes de alterar o status do motivo sem producao.'
    );
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'CONCURRENT_MODIFICATION',
      'message', format('O motivo sem producao %s foi alterado por outro usuario. Recarregue os dados antes de alterar o status.', v_current.name)
    );
  end if;

  if v_action = 'CANCEL' and not v_current.is_active then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'STATUS_ALREADY_CHANGED',
      'message', format('Motivo sem producao %s ja esta inativo.', v_current.name)
    );
  end if;

  if v_action = 'ACTIVATE' and v_current.is_active then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'STATUS_ALREADY_CHANGED',
      'message', format('Motivo sem producao %s ja esta ativo.', v_current.name)
    );
  end if;

  if v_action = 'CANCEL' then
    select count(*)
    into v_measurement_count
    from public.project_measurement_orders orders
    where orders.tenant_id = p_tenant_id
      and orders.no_production_reason_id = p_no_production_reason_id
      and orders.is_active = true;

    select count(*)
    into v_asbuilt_count
    from public.project_asbuilt_measurement_orders orders
    where orders.tenant_id = p_tenant_id
      and orders.no_production_reason_id = p_no_production_reason_id
      and orders.is_active = true;

    select count(*)
    into v_billing_count
    from public.project_billing_orders orders
    where orders.tenant_id = p_tenant_id
      and orders.no_production_reason_id = p_no_production_reason_id
      and orders.is_active = true;

    v_total_usage := coalesce(v_measurement_count, 0) + coalesce(v_asbuilt_count, 0) + coalesce(v_billing_count, 0);

    if v_total_usage > 0 then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'NO_PRODUCTION_REASON_IN_USE',
        'message', format(
          'Motivo sem producao %s esta em uso por %s registro(s) ativo(s). Realoque ou cancele os registros antes de inativar.',
          v_current.name,
          v_total_usage
        )
      );
    end if;
  end if;

  v_next_active := v_action = 'ACTIVATE';

  update public.measurement_no_production_reasons
  set
    is_active = v_next_active,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = p_no_production_reason_id
  returning updated_at
  into v_updated_at;

  v_changes := jsonb_build_object(
    'isActive',
    jsonb_build_object('from', v_current.is_active::text, 'to', v_next_active::text)
  ) || case
    when v_action = 'ACTIVATE' then jsonb_build_object('activationReason', jsonb_build_object('from', null, 'to', v_reason))
    else jsonb_build_object('cancellationReason', jsonb_build_object('from', null, 'to', v_reason))
  end;

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
    'motivo-sem-producao',
    'measurement_no_production_reasons',
    p_no_production_reason_id,
    v_current.code,
    v_action,
    v_reason,
    v_changes,
    '{}'::jsonb,
    p_actor_user_id,
    p_actor_user_id
  );

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'no_production_reason_id', p_no_production_reason_id,
    'updated_at', v_updated_at,
    'message',
      case
        when v_action = 'ACTIVATE' then format('Motivo sem producao %s ativado com sucesso.', v_current.name)
        else format('Motivo sem producao %s cancelado com sucesso.', v_current.name)
      end
  );
end;
$$;

revoke all on function public.set_no_production_reason_record_status(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.set_no_production_reason_record_status(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz
) to service_role;

insert into public.app_pages (page_key, path, name, section, description, default_user_access)
values (
  'motivo-sem-producao',
  '/motivo-sem-producao',
  'Motivo sem producao',
  'Cadastro Base',
  'Cadastro base dos motivos usados em ordens sem producao.',
  false
)
on conflict (page_key) do update
set
  path = excluded.path,
  name = excluded.name,
  section = excluded.section,
  description = excluded.description,
  default_user_access = false,
  ativo = true,
  updated_at = now();

insert into public.role_page_permissions (tenant_id, role_id, page_key, can_access)
select
  tenants.tenant_id,
  roles.id,
  'motivo-sem-producao',
  coalesce(roles.is_admin, false)
from (
  select distinct tenant_id
  from public.app_users
  where tenant_id is not null
) tenants
join public.app_roles roles
  on roles.ativo = true
left join public.role_page_permissions existing
  on existing.tenant_id = tenants.tenant_id
 and existing.role_id = roles.id
 and existing.page_key = 'motivo-sem-producao'
where existing.role_id is null
on conflict (tenant_id, role_id, page_key) do nothing;

insert into public.app_user_page_permissions (
  tenant_id,
  user_id,
  page_key,
  can_access,
  created_by,
  updated_by
)
select
  users.tenant_id,
  users.id,
  'motivo-sem-producao',
  coalesce(roles.is_admin, false),
  null,
  null
from public.app_users users
left join public.app_roles roles
  on roles.id = users.role_id
 and roles.ativo = true
left join public.app_user_page_permissions existing
  on existing.tenant_id = users.tenant_id
 and existing.user_id = users.id
 and existing.page_key = 'motivo-sem-producao'
where users.tenant_id is not null
  and existing.user_id is null
on conflict (tenant_id, user_id, page_key) do nothing;

do $$
declare
  v_save_fn regprocedure := 'public.save_no_production_reason_record(uuid, uuid, uuid, text, text, integer, timestamptz)'::regprocedure;
  v_status_fn regprocedure := 'public.set_no_production_reason_record_status(uuid, uuid, uuid, text, text, timestamptz)'::regprocedure;
begin
  if has_function_privilege('anon', v_save_fn, 'execute')
     or has_function_privilege('authenticated', v_save_fn, 'execute') then
    raise exception '407: save_no_production_reason_record ainda executavel por anon/authenticated';
  end if;

  if has_function_privilege('anon', v_status_fn, 'execute')
     or has_function_privilege('authenticated', v_status_fn, 'execute') then
    raise exception '407: set_no_production_reason_record_status ainda executavel por anon/authenticated';
  end if;

  if not exists (
    select 1
    from public.app_pages
    where page_key = 'motivo-sem-producao'
      and ativo = true
      and default_user_access = false
  ) then
    raise exception '407: pagina motivo-sem-producao nao foi cadastrada corretamente em app_pages';
  end if;
end;
$$;
