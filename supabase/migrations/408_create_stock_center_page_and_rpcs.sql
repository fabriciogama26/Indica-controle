-- 408_create_stock_center_page_and_rpcs.sql
-- Cria a tela de Cadastro Base para administrar somente centros fisicos de
-- estoque (`stock_centers`) usados pela Solicitacao de Requisicao. Centros
-- proprios vinculados a equipes continuam invisiveis e bloqueados nesta tela.

revoke insert, update, delete on public.stock_centers from public, anon, authenticated;

create or replace function public.save_stock_center_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_stock_center_id uuid default null,
  p_name text default null,
  p_description text default null,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.stock_centers%rowtype;
  v_stock_center_id uuid := p_stock_center_id;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_updated_at timestamptz;
  v_changes jsonb;
  v_duplicate_id uuid;
  v_constraint_name text;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'TENANT_OR_ACTOR_REQUIRED',
      'message', 'Tenant e usuario sao obrigatorios para salvar centro de estoque.'
    );
  end if;

  if v_name is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_REQUIRED_FIELDS',
      'message', 'Informe o nome do centro de estoque.'
    );
  end if;

  select center.id
  into v_duplicate_id
  from public.stock_centers center
  where center.tenant_id = p_tenant_id
    and upper(btrim(center.name)) = upper(v_name)
    and (v_stock_center_id is null or center.id <> v_stock_center_id)
  limit 1;

  if v_duplicate_id is not null then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_NAME',
      'message', 'Ja existe centro de estoque com este nome no tenant atual.'
    );
  end if;

  if v_stock_center_id is null then
    insert into public.stock_centers (
      tenant_id,
      name,
      description,
      is_active,
      center_type,
      controls_balance,
      created_by,
      updated_by
    )
    values (
      p_tenant_id,
      v_name,
      v_description,
      true,
      'OWN',
      true,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at
    into v_stock_center_id, v_updated_at;
  else
    select *
    into v_current
    from public.stock_centers
    where tenant_id = p_tenant_id
      and id = v_stock_center_id
    for update;

    if not found then
      return jsonb_build_object(
        'success', false,
        'status', 404,
        'reason', 'STOCK_CENTER_NOT_FOUND',
        'message', 'Centro de estoque nao encontrado.'
      );
    end if;

    if v_current.center_type <> 'OWN' or v_current.controls_balance is distinct from true then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'UNSUPPORTED_STOCK_CENTER',
        'message', 'Esta tela administra somente centros fisicos de estoque proprio.'
      );
    end if;

    if exists (
      select 1
      from public.teams team
      where team.tenant_id = p_tenant_id
        and team.stock_center_id = v_stock_center_id
    ) then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'TEAM_STOCK_CENTER',
        'message', 'Centro de estoque vinculado a equipe nao pode ser exibido nem alterado por esta tela.'
      );
    end if;

    if p_expected_updated_at is null then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
        'message', 'Atualize a lista antes de editar o centro de estoque.'
      );
    end if;

    if v_current.updated_at <> p_expected_updated_at then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'CONCURRENT_MODIFICATION',
        'message', format('O centro de estoque %s foi alterado por outro usuario. Recarregue os dados antes de salvar novamente.', v_current.name)
      );
    end if;

    if not v_current.is_active then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'RECORD_INACTIVE',
        'message', 'Ative o centro de estoque antes de editar.'
      );
    end if;

    v_changes := jsonb_strip_nulls(jsonb_build_object(
      'name', case when v_current.name is distinct from v_name then jsonb_build_object('from', v_current.name, 'to', v_name) end,
      'description', case when v_current.description is distinct from v_description then jsonb_build_object('from', v_current.description, 'to', v_description) end
    ));

    if v_changes = '{}'::jsonb then
      return jsonb_build_object(
        'success', true,
        'status', 200,
        'stock_center_id', v_stock_center_id,
        'updated_at', v_current.updated_at,
        'message', format('Nenhuma alteracao detectada no centro de estoque %s.', v_current.name)
      );
    end if;

    update public.stock_centers
    set
      name = v_name,
      description = v_description,
      center_type = 'OWN',
      controls_balance = true,
      updated_by = p_actor_user_id
    where tenant_id = p_tenant_id
      and id = v_stock_center_id
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
      'centro-estoque',
      'stock_centers',
      v_stock_center_id,
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
    'stock_center_id', v_stock_center_id,
    'updated_at', v_updated_at,
    'message',
      case
        when p_stock_center_id is null then format('Centro de estoque %s cadastrado com sucesso.', v_name)
        else format('Centro de estoque %s atualizado com sucesso.', v_name)
      end
  );
exception
  when unique_violation then
    get stacked diagnostics v_constraint_name = constraint_name;
    if v_constraint_name = 'stock_centers_tenant_id_name_key' then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'DUPLICATE_NAME',
        'message', 'Ja existe centro de estoque com este nome no tenant atual.'
      );
    end if;
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_VALUE',
      'message', 'Registro duplicado ao salvar o centro de estoque.'
    );
end;
$$;

revoke all on function public.save_stock_center_record(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.save_stock_center_record(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz
) to service_role;

create or replace function public.set_stock_center_record_status(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_stock_center_id uuid,
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
  v_current public.stock_centers%rowtype;
  v_action text := case when upper(coalesce(p_action, '')) = 'ACTIVATE' then 'ACTIVATE' else 'CANCEL' end;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_updated_at timestamptz;
  v_next_active boolean;
  v_changes jsonb;
  v_balance_count integer;
  v_open_request_count integer;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'TENANT_OR_ACTOR_REQUIRED',
      'message', 'Tenant e usuario sao obrigatorios para alterar centro de estoque.'
    );
  end if;

  if p_stock_center_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'STOCK_CENTER_REQUIRED',
      'message', 'Centro de estoque invalido para atualizar status.'
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
  from public.stock_centers
  where tenant_id = p_tenant_id
    and id = p_stock_center_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'STOCK_CENTER_NOT_FOUND',
      'message', 'Centro de estoque nao encontrado.'
    );
  end if;

  if v_current.center_type <> 'OWN' or v_current.controls_balance is distinct from true then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'UNSUPPORTED_STOCK_CENTER',
      'message', 'Esta tela administra somente centros fisicos de estoque proprio.'
    );
  end if;

  if exists (
    select 1
    from public.teams team
    where team.tenant_id = p_tenant_id
      and team.stock_center_id = p_stock_center_id
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'TEAM_STOCK_CENTER',
      'message', 'Centro de estoque vinculado a equipe nao pode ser exibido nem alterado por esta tela.'
    );
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
      'message', 'Atualize a lista antes de alterar o status do centro de estoque.'
    );
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'CONCURRENT_MODIFICATION',
      'message', format('O centro de estoque %s foi alterado por outro usuario. Recarregue os dados antes de alterar o status.', v_current.name)
    );
  end if;

  if v_action = 'CANCEL' and not v_current.is_active then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'STATUS_ALREADY_CHANGED',
      'message', format('Centro de estoque %s ja esta inativo.', v_current.name)
    );
  end if;

  if v_action = 'ACTIVATE' and v_current.is_active then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'STATUS_ALREADY_CHANGED',
      'message', format('Centro de estoque %s ja esta ativo.', v_current.name)
    );
  end if;

  if v_action = 'CANCEL' then
    select count(*)
    into v_balance_count
    from public.stock_center_balances balance
    where balance.tenant_id = p_tenant_id
      and balance.stock_center_id = p_stock_center_id
      and balance.quantity <> 0;

    if coalesce(v_balance_count, 0) > 0 then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'STOCK_CENTER_HAS_BALANCE',
        'message', format('Centro de estoque %s possui saldo e nao pode ser inativado.', v_current.name)
      );
    end if;

    select count(*)
    into v_open_request_count
    from public.stock_requisition_requests request
    where request.tenant_id = p_tenant_id
      and request.stock_center_id = p_stock_center_id
      and request.status in ('PENDING', 'EM_ATENDIMENTO');

    if coalesce(v_open_request_count, 0) > 0 then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'STOCK_CENTER_OPEN_REQUESTS',
        'message', format('Centro de estoque %s possui requisicao aberta e nao pode ser inativado.', v_current.name)
      );
    end if;
  end if;

  v_next_active := v_action = 'ACTIVATE';

  update public.stock_centers
  set
    is_active = v_next_active,
    center_type = 'OWN',
    controls_balance = true,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = p_stock_center_id
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
    'centro-estoque',
    'stock_centers',
    p_stock_center_id,
    v_current.name,
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
    'stock_center_id', p_stock_center_id,
    'updated_at', v_updated_at,
    'message',
      case
        when v_action = 'ACTIVATE' then format('Centro de estoque %s ativado com sucesso.', v_current.name)
        else format('Centro de estoque %s cancelado com sucesso.', v_current.name)
      end
  );
end;
$$;

revoke all on function public.set_stock_center_record_status(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.set_stock_center_record_status(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz
) to service_role;

insert into public.app_pages (page_key, path, name, section, description, default_user_access)
values (
  'centro-estoque',
  '/centro-estoque',
  'Centro de estoque',
  'Cadastro Base',
  'Cadastro base dos centros fisicos de estoque usados pelo almoxarifado.',
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
  'centro-estoque',
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
 and existing.page_key = 'centro-estoque'
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
  'centro-estoque',
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
 and existing.page_key = 'centro-estoque'
where users.tenant_id is not null
  and existing.user_id is null
on conflict (tenant_id, user_id, page_key) do nothing;

do $$
declare
  v_save_fn regprocedure := 'public.save_stock_center_record(uuid, uuid, uuid, text, text, timestamptz)'::regprocedure;
  v_status_fn regprocedure := 'public.set_stock_center_record_status(uuid, uuid, uuid, text, text, timestamptz)'::regprocedure;
begin
  if has_function_privilege('anon', v_save_fn, 'execute')
     or has_function_privilege('authenticated', v_save_fn, 'execute') then
    raise exception '408: save_stock_center_record ainda executavel por anon/authenticated';
  end if;

  if has_function_privilege('anon', v_status_fn, 'execute')
     or has_function_privilege('authenticated', v_status_fn, 'execute') then
    raise exception '408: set_stock_center_record_status ainda executavel por anon/authenticated';
  end if;

  if has_table_privilege('anon', 'public.stock_centers', 'insert')
     or has_table_privilege('anon', 'public.stock_centers', 'update')
     or has_table_privilege('authenticated', 'public.stock_centers', 'insert')
     or has_table_privilege('authenticated', 'public.stock_centers', 'update') then
    raise exception '408: stock_centers ainda permite escrita direta por anon/authenticated';
  end if;

  if not exists (
    select 1
    from public.app_pages
    where page_key = 'centro-estoque'
      and ativo = true
      and default_user_access = false
  ) then
    raise exception '408: pagina centro-estoque nao foi cadastrada corretamente em app_pages';
  end if;
end;
$$;
