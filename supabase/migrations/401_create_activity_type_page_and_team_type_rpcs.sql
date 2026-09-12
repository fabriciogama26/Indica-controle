-- 401_create_activity_type_page_and_team_type_rpcs.sql
-- Cadastra a pagina Tipo de Atividade e move salvamento/status de tipo para RPC transacional.
-- A tela administra o catalogo existente `team_types`, que ja alimenta o campo Tipo de Atividades.

create or replace function public.save_team_type_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_team_type_id uuid default null,
  p_name text default null,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.team_types%rowtype;
  v_team_type_id uuid := p_team_type_id;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_updated_at timestamptz;
  v_changes jsonb;
  v_duplicate_id uuid;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'TENANT_OR_ACTOR_REQUIRED',
      'message', 'Tenant e usuario sao obrigatorios para salvar tipo de atividade.'
    );
  end if;

  if v_name is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_REQUIRED_FIELDS',
      'message', 'Informe o nome do tipo de atividade.'
    );
  end if;

  -- `team_types` tem unique (tenant_id, name), que e case-sensitive. A checagem
  -- abaixo bloqueia divergencia so de caixa/espaco, que o indice deixaria passar.
  select tt.id
  into v_duplicate_id
  from public.team_types tt
  where tt.tenant_id = p_tenant_id
    and upper(btrim(tt.name)) = upper(v_name)
    and (v_team_type_id is null or tt.id <> v_team_type_id)
  limit 1;

  if v_duplicate_id is not null then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_NAME',
      'message', 'Ja existe tipo de atividade com este nome no tenant atual.'
    );
  end if;

  if v_team_type_id is null then
    insert into public.team_types (
      tenant_id,
      name,
      ativo,
      created_by,
      updated_by
    )
    values (
      p_tenant_id,
      v_name,
      true,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at
    into v_team_type_id, v_updated_at;
  else
    select *
    into v_current
    from public.team_types
    where tenant_id = p_tenant_id
      and id = v_team_type_id
    for update;

    if not found then
      return jsonb_build_object(
        'success', false,
        'status', 404,
        'reason', 'TEAM_TYPE_NOT_FOUND',
        'message', 'Tipo de atividade nao encontrado.'
      );
    end if;

    if p_expected_updated_at is null then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
        'message', 'Atualize a lista antes de editar o tipo de atividade.'
      );
    end if;

    if v_current.updated_at <> p_expected_updated_at then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'CONCURRENT_MODIFICATION',
        'message', format('O tipo de atividade %s foi alterado por outro usuario. Recarregue os dados antes de salvar novamente.', v_current.name)
      );
    end if;

    if not v_current.ativo then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'RECORD_INACTIVE',
        'message', 'Ative o tipo de atividade antes de editar.'
      );
    end if;

    v_changes := jsonb_strip_nulls(jsonb_build_object(
      'name', case when v_current.name is distinct from v_name then jsonb_build_object('from', v_current.name, 'to', v_name) end
    ));

    if v_changes = '{}'::jsonb then
      return jsonb_build_object(
        'success', true,
        'status', 200,
        'team_type_id', v_team_type_id,
        'updated_at', v_current.updated_at,
        'message', format('Nenhuma alteracao detectada no tipo de atividade %s.', v_current.name)
      );
    end if;

    update public.team_types
    set
      name = v_name,
      updated_by = p_actor_user_id
    where tenant_id = p_tenant_id
      and id = v_team_type_id
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
      'tipo-atividade',
      'team_types',
      v_team_type_id,
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
    'team_type_id', v_team_type_id,
    'updated_at', v_updated_at,
    'message',
      case
        when p_team_type_id is null then format('Tipo de atividade %s cadastrado com sucesso.', v_name)
        else format('Tipo de atividade %s atualizado com sucesso.', v_name)
      end
  );
exception
  when unique_violation then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_NAME',
      'message', 'Ja existe tipo de atividade com este nome no tenant atual.'
    );
end;
$$;

revoke all on function public.save_team_type_record(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.save_team_type_record(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz
) to service_role;

create or replace function public.set_team_type_record_status(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_team_type_id uuid,
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
  v_current public.team_types%rowtype;
  v_action text := case when upper(coalesce(p_action, '')) = 'ACTIVATE' then 'ACTIVATE' else 'CANCEL' end;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_updated_at timestamptz;
  v_next_active boolean;
  v_changes jsonb;
  v_linked_activities integer;
  v_linked_teams integer;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'TENANT_OR_ACTOR_REQUIRED',
      'message', 'Tenant e usuario sao obrigatorios para alterar tipo de atividade.'
    );
  end if;

  if p_team_type_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'TEAM_TYPE_REQUIRED',
      'message', 'Tipo de atividade invalido para atualizar status.'
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
  from public.team_types
  where tenant_id = p_tenant_id
    and id = p_team_type_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'TEAM_TYPE_NOT_FOUND',
      'message', 'Tipo de atividade nao encontrado.'
    );
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
      'message', 'Atualize a lista antes de alterar o status do tipo de atividade.'
    );
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'CONCURRENT_MODIFICATION',
      'message', format('O tipo de atividade %s foi alterado por outro usuario. Recarregue os dados antes de alterar o status.', v_current.name)
    );
  end if;

  if v_action = 'CANCEL' and not v_current.ativo then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'STATUS_ALREADY_CHANGED',
      'message', format('Tipo de atividade %s ja esta inativo.', v_current.name)
    );
  end if;

  if v_action = 'ACTIVATE' and v_current.ativo then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'STATUS_ALREADY_CHANGED',
      'message', format('Tipo de atividade %s ja esta ativo.', v_current.name)
    );
  end if;

  -- `team_types` e compartilhada com Equipes/Meta/Medicao. Inativar um tipo em uso
  -- tiraria a opcao do select de Atividades sem tocar nos registros ja gravados,
  -- entao o cancelamento so passa quando nao ha vinculo ativo.
  if v_action = 'CANCEL' then
    select count(*)
    into v_linked_activities
    from public.service_activities sa
    where sa.tenant_id = p_tenant_id
      and sa.team_type_id = p_team_type_id
      and sa.ativo = true;

    select count(*)
    into v_linked_teams
    from public.teams t
    where t.tenant_id = p_tenant_id
      and t.team_type_id = p_team_type_id
      and t.ativo = true;

    if coalesce(v_linked_activities, 0) > 0 or coalesce(v_linked_teams, 0) > 0 then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'TEAM_TYPE_IN_USE',
        'message', format(
          'Tipo de atividade %s esta em uso por %s atividade(s) e %s equipe(s) ativas. Realoque os registros antes de cancelar.',
          v_current.name,
          coalesce(v_linked_activities, 0),
          coalesce(v_linked_teams, 0)
        )
      );
    end if;
  end if;

  v_next_active := v_action = 'ACTIVATE';

  update public.team_types
  set
    ativo = v_next_active,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = p_team_type_id
  returning updated_at
  into v_updated_at;

  v_changes := jsonb_build_object(
    'isActive',
    jsonb_build_object('from', v_current.ativo::text, 'to', v_next_active::text)
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
    'tipo-atividade',
    'team_types',
    p_team_type_id,
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
    'team_type_id', p_team_type_id,
    'updated_at', v_updated_at,
    'message',
      case
        when v_action = 'ACTIVATE' then format('Tipo de atividade %s ativado com sucesso.', v_current.name)
        else format('Tipo de atividade %s cancelado com sucesso.', v_current.name)
      end
  );
end;
$$;

revoke all on function public.set_team_type_record_status(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.set_team_type_record_status(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz
) to service_role;

-- Pagina Tipo de Atividade na secao Cadastro Base.
-- `default_user_access = false`: tela nova nasce bloqueada para nao administradores,
-- conforme a 245. O trigger `trg_app_pages_default_user_permissions` cria as linhas
-- de `app_user_page_permissions` a partir desse default.
insert into public.app_pages (page_key, path, name, section, description, default_user_access)
values (
  'tipo-atividade',
  '/tipo-atividade',
  'Tipo de Atividade',
  'Cadastro Base',
  'Cadastro base dos tipos que alimentam o campo Tipo em Atividades.',
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
  'tipo-atividade',
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
 and existing.page_key = 'tipo-atividade'
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
  'tipo-atividade',
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
 and existing.page_key = 'tipo-atividade'
where users.tenant_id is not null
  and existing.user_id is null
on conflict (tenant_id, user_id, page_key) do nothing;

do $$
declare
  v_save_fn regprocedure := 'public.save_team_type_record(uuid, uuid, uuid, text, timestamptz)'::regprocedure;
  v_status_fn regprocedure := 'public.set_team_type_record_status(uuid, uuid, uuid, text, text, timestamptz)'::regprocedure;
begin
  if has_function_privilege('anon', v_save_fn, 'execute')
     or has_function_privilege('authenticated', v_save_fn, 'execute') then
    raise exception '401: save_team_type_record ainda executavel por anon/authenticated';
  end if;

  if has_function_privilege('anon', v_status_fn, 'execute')
     or has_function_privilege('authenticated', v_status_fn, 'execute') then
    raise exception '401: set_team_type_record_status ainda executavel por anon/authenticated';
  end if;

  if not exists (
    select 1
    from public.app_pages
    where page_key = 'tipo-atividade'
      and ativo = true
  ) then
    raise exception '401: pagina tipo-atividade nao foi cadastrada em app_pages';
  end if;
end;
$$;
