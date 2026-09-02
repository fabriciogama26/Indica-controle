-- 410_create_utility_distributor_contact_page.sql
-- Cria a tela transacional de Responsaveis/Gestores da Distribuidora.

insert into public.app_pages (
  page_key,
  path,
  name,
  section,
  description,
  default_user_access
)
values (
  'responsavel-distribuidora',
  '/responsavel-distribuidora',
  'Responsaveis Distribuidora',
  'Cadastro Base',
  'Cadastro base de responsaveis e gestores de campo da distribuidora.',
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

create or replace function public.save_utility_distributor_contact_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_kind text,
  p_contact_id uuid default null,
  p_name text default null,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text := lower(replace(replace(btrim(coalesce(p_kind, '')), '-', ''), '_', ''));
  v_table text;
  v_singular text;
  v_current_id uuid;
  v_current_name text;
  v_current_ativo boolean;
  v_current_updated_at timestamptz;
  v_contact_id uuid := p_contact_id;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_updated_at timestamptz;
  v_changes jsonb;
begin
  if v_kind = 'responsible' then
    v_table := 'project_utility_responsibles';
    v_singular := 'responsavel da distribuidora';
  elsif v_kind = 'fieldmanager' then
    v_table := 'project_utility_field_managers';
    v_singular := 'gestor de campo da distribuidora';
    v_kind := 'fieldManager';
  else
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_CONTACT_KIND',
      'message', 'Tipo de cadastro da distribuidora invalido.'
    );
  end if;

  if p_tenant_id is null or p_actor_user_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'TENANT_OR_ACTOR_REQUIRED',
      'message', 'Tenant e usuario sao obrigatorios para salvar cadastro da distribuidora.'
    );
  end if;

  if v_name is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_REQUIRED_FIELDS',
      'message', format('Informe o nome do %s.', v_singular)
    );
  end if;

  if v_contact_id is null then
    execute format(
      'insert into public.%I (tenant_id, name, ativo, created_by, updated_by)
       values ($1, $2, true, $3, $3)
       returning id, updated_at',
      v_table
    )
    into v_contact_id, v_updated_at
    using p_tenant_id, v_name, p_actor_user_id;
  else
    execute format(
      'select id, name, ativo, updated_at
         from public.%I
        where tenant_id = $1
          and id = $2
        for update',
      v_table
    )
    into v_current_id, v_current_name, v_current_ativo, v_current_updated_at
    using p_tenant_id, v_contact_id;

    if v_current_id is null then
      return jsonb_build_object(
        'success', false,
        'status', 404,
        'reason', 'CONTACT_NOT_FOUND',
        'message', format('%s nao encontrado.', initcap(v_singular))
      );
    end if;

    if p_expected_updated_at is null then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
        'message', format('Atualize a lista antes de editar o %s.', v_singular)
      );
    end if;

    if v_current_updated_at <> p_expected_updated_at then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'CONCURRENT_MODIFICATION',
        'message', format('O cadastro %s foi alterado por outro usuario. Recarregue os dados antes de salvar novamente.', v_current_name)
      );
    end if;

    if not v_current_ativo then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'RECORD_INACTIVE',
        'message', format('Ative o %s antes de editar.', v_singular)
      );
    end if;

    v_changes := jsonb_strip_nulls(jsonb_build_object(
      'name', case when v_current_name is distinct from v_name then jsonb_build_object('from', v_current_name, 'to', v_name) end
    ));

    if v_changes = '{}'::jsonb then
      return jsonb_build_object(
        'success', true,
        'status', 200,
        'contact_id', v_contact_id,
        'updated_at', v_current_updated_at,
        'message', format('Nenhuma alteracao detectada em %s.', v_current_name)
      );
    end if;

    execute format(
      'update public.%I
          set name = $1,
              updated_by = $2
        where tenant_id = $3
          and id = $4
        returning updated_at',
      v_table
    )
    into v_updated_at
    using v_name, p_actor_user_id, p_tenant_id, v_contact_id;

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
      'responsavel-distribuidora',
      v_table,
      v_contact_id,
      v_name,
      'UPDATE',
      null,
      v_changes,
      jsonb_build_object('kind', v_kind),
      p_actor_user_id,
      p_actor_user_id
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'contact_id', v_contact_id,
    'updated_at', v_updated_at,
    'message',
      case
        when p_contact_id is null then format('%s cadastrado com sucesso.', initcap(v_singular))
        else format('%s atualizado com sucesso.', initcap(v_singular))
      end
  );
exception
  when unique_violation then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_NAME',
      'message', format('Ja existe %s com este nome no tenant atual.', v_singular)
    );
end;
$$;

revoke all on function public.save_utility_distributor_contact_record(
  uuid,
  uuid,
  text,
  uuid,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.save_utility_distributor_contact_record(
  uuid,
  uuid,
  text,
  uuid,
  text,
  timestamptz
) to service_role;

create or replace function public.set_utility_distributor_contact_status(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_kind text,
  p_contact_id uuid,
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
  v_kind text := lower(replace(replace(btrim(coalesce(p_kind, '')), '-', ''), '_', ''));
  v_table text;
  v_singular text;
  v_current_id uuid;
  v_current_name text;
  v_current_ativo boolean;
  v_current_updated_at timestamptz;
  v_action text := case when upper(coalesce(p_action, '')) = 'ACTIVATE' then 'ACTIVATE' else 'CANCEL' end;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_updated_at timestamptz;
  v_next_active boolean;
  v_changes jsonb;
begin
  if v_kind = 'responsible' then
    v_table := 'project_utility_responsibles';
    v_singular := 'responsavel da distribuidora';
  elsif v_kind = 'fieldmanager' then
    v_table := 'project_utility_field_managers';
    v_singular := 'gestor de campo da distribuidora';
    v_kind := 'fieldManager';
  else
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_CONTACT_KIND',
      'message', 'Tipo de cadastro da distribuidora invalido.'
    );
  end if;

  if p_tenant_id is null or p_actor_user_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'TENANT_OR_ACTOR_REQUIRED',
      'message', 'Tenant e usuario sao obrigatorios para alterar cadastro da distribuidora.'
    );
  end if;

  if p_contact_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'CONTACT_REQUIRED',
      'message', format('%s invalido para atualizar status.', initcap(v_singular))
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

  execute format(
    'select id, name, ativo, updated_at
       from public.%I
      where tenant_id = $1
        and id = $2
      for update',
    v_table
  )
  into v_current_id, v_current_name, v_current_ativo, v_current_updated_at
  using p_tenant_id, p_contact_id;

  if v_current_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'CONTACT_NOT_FOUND',
      'message', format('%s nao encontrado.', initcap(v_singular))
    );
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
      'message', format('Atualize a lista antes de alterar o status do %s.', v_singular)
    );
  end if;

  if v_current_updated_at <> p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'CONCURRENT_MODIFICATION',
      'message', format('O cadastro %s foi alterado por outro usuario. Recarregue os dados antes de alterar o status.', v_current_name)
    );
  end if;

  if v_action = 'CANCEL' and not v_current_ativo then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'STATUS_ALREADY_CHANGED',
      'message', format('%s ja esta inativo.', initcap(v_singular))
    );
  end if;

  if v_action = 'ACTIVATE' and v_current_ativo then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'STATUS_ALREADY_CHANGED',
      'message', format('%s ja esta ativo.', initcap(v_singular))
    );
  end if;

  v_next_active := v_action = 'ACTIVATE';

  execute format(
    'update public.%I
        set ativo = $1,
            updated_by = $2
      where tenant_id = $3
        and id = $4
      returning updated_at',
    v_table
  )
  into v_updated_at
  using v_next_active, p_actor_user_id, p_tenant_id, p_contact_id;

  v_changes := jsonb_build_object(
    'isActive',
    jsonb_build_object('from', v_current_ativo::text, 'to', v_next_active::text)
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
    'responsavel-distribuidora',
    v_table,
    p_contact_id,
    v_current_name,
    v_action,
    v_reason,
    v_changes,
    jsonb_build_object('kind', v_kind),
    p_actor_user_id,
    p_actor_user_id
  );

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'contact_id', p_contact_id,
    'updated_at', v_updated_at,
    'message',
      case
        when v_action = 'ACTIVATE' then format('%s ativado com sucesso.', initcap(v_singular))
        else format('%s cancelado com sucesso.', initcap(v_singular))
      end
  );
end;
$$;

revoke all on function public.set_utility_distributor_contact_status(
  uuid,
  uuid,
  text,
  uuid,
  text,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.set_utility_distributor_contact_status(
  uuid,
  uuid,
  text,
  uuid,
  text,
  text,
  timestamptz
) to service_role;

-- A rota ja existia como placeholder. A 253 pode ter copiado `can_access` para
-- acoes de escrita/exportacao; ao transformar em CRUD real, preservamos leitura
-- e devolvemos escrita de nao-admin para liberacao explicita em /permissoes.
do $$
declare
  v_user_perms_updated integer := 0;
  v_role_perms_updated integer := 0;
begin
  update public.app_user_page_permissions upp
  set
    can_create = false,
    can_update = false,
    can_cancel = false,
    can_export = false,
    updated_at = now()
  from public.app_users au
  left join public.app_roles r
    on r.id = au.role_id
   and r.ativo = true
  where upp.user_id = au.id
    and upp.tenant_id = au.tenant_id
    and upp.page_key = 'responsavel-distribuidora'
    and coalesce(r.is_admin, false) = false
    and (
      coalesce(upp.can_create, false) = true
      or coalesce(upp.can_update, false) = true
      or coalesce(upp.can_cancel, false) = true
      or coalesce(upp.can_export, false) = true
    );
  get diagnostics v_user_perms_updated = row_count;

  update public.role_page_permissions rpp
  set
    can_create = false,
    can_update = false,
    can_cancel = false,
    can_export = false,
    updated_at = now()
  from public.app_roles r
  where r.id = rpp.role_id
    and rpp.page_key = 'responsavel-distribuidora'
    and coalesce(r.is_admin, false) = false
    and (
      coalesce(rpp.can_create, false) = true
      or coalesce(rpp.can_update, false) = true
      or coalesce(rpp.can_cancel, false) = true
      or coalesce(rpp.can_export, false) = true
    );
  get diagnostics v_role_perms_updated = row_count;

  raise notice '410: escrita em responsavel-distribuidora revogada para nao-admin | app_user_page_permissions=% | role_page_permissions=%',
    v_user_perms_updated, v_role_perms_updated;
end;
$$;

do $$
declare
  v_save_fn regprocedure := 'public.save_utility_distributor_contact_record(uuid, uuid, text, uuid, text, timestamptz)'::regprocedure;
  v_status_fn regprocedure := 'public.set_utility_distributor_contact_status(uuid, uuid, text, uuid, text, text, timestamptz)'::regprocedure;
  v_write_leaks integer;
begin
  if has_function_privilege('anon', v_save_fn, 'execute')
     or has_function_privilege('authenticated', v_save_fn, 'execute') then
    raise exception '410: save_utility_distributor_contact_record ainda executavel por anon/authenticated';
  end if;

  if has_function_privilege('anon', v_status_fn, 'execute')
     or has_function_privilege('authenticated', v_status_fn, 'execute') then
    raise exception '410: set_utility_distributor_contact_status ainda executavel por anon/authenticated';
  end if;

  if not exists (
    select 1
    from public.app_pages
    where page_key = 'responsavel-distribuidora'
      and path = '/responsavel-distribuidora'
      and ativo = true
  ) then
    raise exception '410: pagina responsavel-distribuidora nao cadastrada/ativa';
  end if;

  select count(*)
  into v_write_leaks
  from public.app_user_page_permissions upp
  join public.app_users au
    on au.id = upp.user_id
   and au.tenant_id = upp.tenant_id
  left join public.app_roles r
    on r.id = au.role_id
   and r.ativo = true
  where upp.page_key = 'responsavel-distribuidora'
    and coalesce(r.is_admin, false) = false
    and (
      coalesce(upp.can_create, false) = true
      or coalesce(upp.can_update, false) = true
      or coalesce(upp.can_cancel, false) = true
      or coalesce(upp.can_export, false) = true
    );

  if v_write_leaks > 0 then
    raise exception '410: % permissao(oes) de escrita em responsavel-distribuidora sobraram para nao-admin', v_write_leaks;
  end if;
end;
$$;
