-- 403_create_activity_category_page_and_rpcs.sql
-- Etapa 2 de 3: cadastra a pagina Categoria de Atividade e move salvamento/status
-- para RPC transacional.
--
-- A tela administra o catalogo existente `types_service_activities`, que ja
-- alimenta o campo `Categoria` de Atividades (`service_activities.type_service`).
-- Nao ha tabela nova nem migracao de dados.
--
-- POR QUE PAGINA NOVA E NAO A `/tipo-servico` EXISTENTE
-- ---------------------------------------------------------------------------
-- `/tipo-servico` e o placeholder reservado para `project_service_types`, o Tipo
-- de Servico do PROJETO, lido por Projetos, Medicao, Apuracao Fator Minimo e
-- Mapa Programacao. Sao tabelas e dominios diferentes: `types_service_activities`
-- so e lida por Atividades e pelo Dash Operacional Faturamento. Por isso, ao
-- contrario do que aconteceu com `tipo-atividade`/`tipo-equipe` na etapa 1, aqui
-- nao existe tela concorrente para reaproveitar.
--
-- `sort_order` NAO e exposto na tela: a coluna existe desde a 145, mas nenhum
-- leitor do catalogo ordena por ela (todos ordenam por `name`). Cadastro novo
-- fica com o default 100.

create or replace function public.save_activity_category_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_activity_category_id uuid default null,
  p_name text default null,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.types_service_activities%rowtype;
  v_activity_category_id uuid := p_activity_category_id;
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
      'message', 'Tenant e usuario sao obrigatorios para salvar categoria de atividade.'
    );
  end if;

  if v_name is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_REQUIRED_FIELDS',
      'message', 'Informe o nome da categoria de atividade.'
    );
  end if;

  -- `types_service_activities_tenant_name_key` e unique (tenant_id, name), que e
  -- case-sensitive. A checagem abaixo bloqueia divergencia so de caixa/espaco,
  -- que o indice deixaria passar.
  select tsa.id
  into v_duplicate_id
  from public.types_service_activities tsa
  where tsa.tenant_id = p_tenant_id
    and upper(btrim(tsa.name)) = upper(v_name)
    and (v_activity_category_id is null or tsa.id <> v_activity_category_id)
  limit 1;

  if v_duplicate_id is not null then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_NAME',
      'message', 'Ja existe categoria de atividade com este nome no tenant atual.'
    );
  end if;

  if v_activity_category_id is null then
    insert into public.types_service_activities (
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
    into v_activity_category_id, v_updated_at;
  else
    select *
    into v_current
    from public.types_service_activities
    where tenant_id = p_tenant_id
      and id = v_activity_category_id
    for update;

    if not found then
      return jsonb_build_object(
        'success', false,
        'status', 404,
        'reason', 'ACTIVITY_CATEGORY_NOT_FOUND',
        'message', 'Categoria de atividade nao encontrada.'
      );
    end if;

    if p_expected_updated_at is null then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
        'message', 'Atualize a lista antes de editar a categoria de atividade.'
      );
    end if;

    if v_current.updated_at <> p_expected_updated_at then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'CONCURRENT_MODIFICATION',
        'message', format('A categoria de atividade %s foi alterada por outro usuario. Recarregue os dados antes de salvar novamente.', v_current.name)
      );
    end if;

    if not v_current.ativo then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'RECORD_INACTIVE',
        'message', 'Ative a categoria de atividade antes de editar.'
      );
    end if;

    v_changes := jsonb_strip_nulls(jsonb_build_object(
      'name', case when v_current.name is distinct from v_name then jsonb_build_object('from', v_current.name, 'to', v_name) end
    ));

    if v_changes = '{}'::jsonb then
      return jsonb_build_object(
        'success', true,
        'status', 200,
        'activity_category_id', v_activity_category_id,
        'updated_at', v_current.updated_at,
        'message', format('Nenhuma alteracao detectada na categoria de atividade %s.', v_current.name)
      );
    end if;

    update public.types_service_activities
    set
      name = v_name,
      updated_by = p_actor_user_id
    where tenant_id = p_tenant_id
      and id = v_activity_category_id
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
      'categoria-atividade',
      'types_service_activities',
      v_activity_category_id,
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
    'activity_category_id', v_activity_category_id,
    'updated_at', v_updated_at,
    'message',
      case
        when p_activity_category_id is null then format('Categoria de atividade %s cadastrada com sucesso.', v_name)
        else format('Categoria de atividade %s atualizada com sucesso.', v_name)
      end
  );
exception
  when unique_violation then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_NAME',
      'message', 'Ja existe categoria de atividade com este nome no tenant atual.'
    );
end;
$$;

revoke all on function public.save_activity_category_record(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.save_activity_category_record(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz
) to service_role;

create or replace function public.set_activity_category_record_status(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_activity_category_id uuid,
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
  v_current public.types_service_activities%rowtype;
  v_action text := case when upper(coalesce(p_action, '')) = 'ACTIVATE' then 'ACTIVATE' else 'CANCEL' end;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_updated_at timestamptz;
  v_next_active boolean;
  v_changes jsonb;
  v_linked_activities integer;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'TENANT_OR_ACTOR_REQUIRED',
      'message', 'Tenant e usuario sao obrigatorios para alterar categoria de atividade.'
    );
  end if;

  if p_activity_category_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'ACTIVITY_CATEGORY_REQUIRED',
      'message', 'Categoria de atividade invalida para atualizar status.'
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
  from public.types_service_activities
  where tenant_id = p_tenant_id
    and id = p_activity_category_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'ACTIVITY_CATEGORY_NOT_FOUND',
      'message', 'Categoria de atividade nao encontrada.'
    );
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
      'message', 'Atualize a lista antes de alterar o status da categoria de atividade.'
    );
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'CONCURRENT_MODIFICATION',
      'message', format('A categoria de atividade %s foi alterada por outro usuario. Recarregue os dados antes de alterar o status.', v_current.name)
    );
  end if;

  if v_action = 'CANCEL' and not v_current.ativo then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'STATUS_ALREADY_CHANGED',
      'message', format('Categoria de atividade %s ja esta inativa.', v_current.name)
    );
  end if;

  if v_action = 'ACTIVATE' and v_current.ativo then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'STATUS_ALREADY_CHANGED',
      'message', format('Categoria de atividade %s ja esta ativa.', v_current.name)
    );
  end if;

  -- `/api/activities/meta` so lista categoria com `ativo = true`. Inativar uma
  -- categoria em uso tiraria a opcao do select sem tocar nas atividades ja
  -- gravadas, deixando cadastro antigo impossivel de reeditar: `Categoria` e
  -- campo obrigatorio no formulario de Atividades.
  if v_action = 'CANCEL' then
    select count(*)
    into v_linked_activities
    from public.service_activities sa
    where sa.tenant_id = p_tenant_id
      and sa.type_service = p_activity_category_id
      and sa.ativo = true;

    if coalesce(v_linked_activities, 0) > 0 then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'ACTIVITY_CATEGORY_IN_USE',
        'message', format(
          'Categoria de atividade %s esta em uso por %s atividade(s) ativa(s). Realoque os registros antes de cancelar.',
          v_current.name,
          coalesce(v_linked_activities, 0)
        )
      );
    end if;
  end if;

  v_next_active := v_action = 'ACTIVATE';

  update public.types_service_activities
  set
    ativo = v_next_active,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = p_activity_category_id
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
    'categoria-atividade',
    'types_service_activities',
    p_activity_category_id,
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
    'activity_category_id', p_activity_category_id,
    'updated_at', v_updated_at,
    'message',
      case
        when v_action = 'ACTIVATE' then format('Categoria de atividade %s ativada com sucesso.', v_current.name)
        else format('Categoria de atividade %s cancelada com sucesso.', v_current.name)
      end
  );
end;
$$;

revoke all on function public.set_activity_category_record_status(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.set_activity_category_record_status(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz
) to service_role;

-- =============================================================================
-- Pagina Categoria de Atividade na secao Cadastro Base
-- =============================================================================
-- `default_user_access = false`: tela nova nasce bloqueada para nao
-- administradores, conforme a 245. O trigger
-- `trg_app_pages_default_user_permissions` cria as linhas de
-- `app_user_page_permissions` a partir desse default. Por isso a chave NAO entra
-- em `DEFAULT_USER_PAGE_ACCESS` no `authorization.ts`.
insert into public.app_pages (page_key, path, name, section, description, default_user_access)
values (
  'categoria-atividade',
  '/categoria-atividade',
  'Categoria de Atividade',
  'Cadastro Base',
  'Cadastro base das categorias que alimentam o campo Categoria em Atividades.',
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
  'categoria-atividade',
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
 and existing.page_key = 'categoria-atividade'
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
  'categoria-atividade',
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
 and existing.page_key = 'categoria-atividade'
where users.tenant_id is not null
  and existing.user_id is null
on conflict (tenant_id, user_id, page_key) do nothing;

-- =============================================================================
-- Validacao pos-aplicacao
-- =============================================================================
do $$
declare
  v_save_fn regprocedure := 'public.save_activity_category_record(uuid, uuid, uuid, text, timestamptz)'::regprocedure;
  v_status_fn regprocedure := 'public.set_activity_category_record_status(uuid, uuid, uuid, text, text, timestamptz)'::regprocedure;
begin
  if has_function_privilege('anon', v_save_fn, 'execute')
     or has_function_privilege('authenticated', v_save_fn, 'execute') then
    raise exception '403: save_activity_category_record ainda executavel por anon/authenticated';
  end if;

  if has_function_privilege('anon', v_status_fn, 'execute')
     or has_function_privilege('authenticated', v_status_fn, 'execute') then
    raise exception '403: set_activity_category_record_status ainda executavel por anon/authenticated';
  end if;

  if not exists (
    select 1
    from public.app_pages
    where page_key = 'categoria-atividade'
      and ativo = true
  ) then
    raise exception '403: pagina categoria-atividade nao foi cadastrada em app_pages';
  end if;
end;
$$;
