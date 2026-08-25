-- 386_harden_admin_tenant_links.sql
-- Garante que administradores tenham vinculo ativo em app_user_tenants antes
-- de exigir selecao de contrato no login.

create or replace function public.ensure_app_user_tenant_link(
  p_user_id uuid,
  p_tenant_id uuid,
  p_make_default boolean default false,
  p_ativo boolean default true,
  p_actor_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_should_be_default boolean;
begin
  if p_user_id is null or p_tenant_id is null then
    return;
  end if;

  v_should_be_default := coalesce(p_ativo, true)
    and (
      coalesce(p_make_default, false)
      or not exists (
        select 1
        from public.app_user_tenants existing_default
        where existing_default.user_id = p_user_id
          and existing_default.ativo = true
          and existing_default.is_default = true
      )
    );

  insert into public.app_user_tenants (
    user_id,
    tenant_id,
    is_default,
    ativo,
    created_by,
    updated_by
  ) values (
    p_user_id,
    p_tenant_id,
    v_should_be_default,
    coalesce(p_ativo, true),
    p_actor_user_id,
    p_actor_user_id
  )
  on conflict (user_id, tenant_id) do update
  set
    ativo = excluded.ativo,
    is_default = case
      when not excluded.ativo then public.app_user_tenants.is_default
      when exists (
        select 1
        from public.app_user_tenants other_default
        where other_default.user_id = excluded.user_id
          and other_default.tenant_id <> excluded.tenant_id
          and other_default.ativo = true
          and other_default.is_default = true
      ) then false
      when public.app_user_tenants.is_default or excluded.is_default then true
      else false
    end,
    updated_by = excluded.updated_by,
    updated_at = now();
end;
$$;

revoke all on function public.ensure_app_user_tenant_link(uuid, uuid, boolean, boolean, uuid) from public;
revoke all on function public.ensure_app_user_tenant_link(uuid, uuid, boolean, boolean, uuid) from anon;
revoke all on function public.ensure_app_user_tenant_link(uuid, uuid, boolean, boolean, uuid) from authenticated;
grant execute on function public.ensure_app_user_tenant_link(uuid, uuid, boolean, boolean, uuid) to service_role;

select public.ensure_app_user_tenant_link(
  users.id,
  users.tenant_id,
  true,
  users.ativo,
  null
)
from public.app_users users
where users.tenant_id is not null;

create or replace function public.user_is_admin_in_tenant(p_tenant_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.app_users au
    join public.app_roles ar
      on ar.id = au.role_id
    where au.auth_user_id = auth.uid()
      and au.ativo = true
      and ar.ativo = true
      and ar.is_admin = true
      and (
        au.tenant_id = p_tenant_id
        or exists (
          select 1
          from public.app_user_tenants tenant_access
          where tenant_access.user_id = au.id
            and tenant_access.tenant_id = p_tenant_id
            and tenant_access.ativo = true
        )
      )
  )
$$;

comment on function public.user_is_admin_in_tenant(uuid) is
'Retorna true quando auth.uid() atual pertence a app_users ativo com role administrativa e acesso ao tenant informado via app_user_tenants ou tenant home.';

create or replace function public.sync_auth_user_to_app_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text := nullif(trim(coalesce(new.email, '')), '');
  v_email_norm text := lower(coalesce(v_email, ''));
  v_metadata jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_tenant_id uuid;
  v_matricula text;
  v_login_name text;
  v_role_key text := 'user';
  v_role_id uuid;
  v_ativo boolean := true;
  v_match_count integer := 0;
  v_match_id uuid;
  v_match_tenant_id uuid;
  v_match_ativo boolean;
begin
  if v_email_norm <> '' then
    select count(*), min(id)
      into v_match_count, v_match_id
    from public.app_users
    where lower(trim(email)) = v_email_norm;

    if v_match_count = 1 then
      update public.app_users
      set auth_user_id = new.id,
          email = coalesce(v_email, email),
          updated_at = now()
      where id = v_match_id
        and (auth_user_id is null or auth_user_id = new.id)
      returning tenant_id, ativo
        into v_match_tenant_id, v_match_ativo;

      perform public.ensure_app_user_tenant_link(v_match_id, v_match_tenant_id, true, v_match_ativo, v_match_id);

      return new;
    end if;
  end if;

  begin
    v_tenant_id := nullif(trim(coalesce(v_metadata ->> 'tenant_id', '')), '')::uuid;
  exception
    when others then
      v_tenant_id := null;
  end;

  v_matricula := nullif(trim(coalesce(v_metadata ->> 'matricula', '')), '');
  v_login_name := lower(nullif(trim(coalesce(v_metadata ->> 'login_name', '')), ''));
  v_role_key := coalesce(nullif(trim(coalesce(v_metadata ->> 'role', '')), ''), 'user');

  select id
    into v_role_id
  from public.app_roles
  where role_key = lower(v_role_key)
    and ativo = true
  limit 1;

  if v_role_id is null then
    select id
      into v_role_id
    from public.app_roles
    where role_key = 'user'
      and ativo = true
    limit 1;
  end if;

  begin
    if v_metadata ? 'ativo' then
      v_ativo := coalesce((v_metadata ->> 'ativo')::boolean, true);
    end if;
  exception
    when others then
      v_ativo := true;
  end;

  if v_tenant_id is null or v_matricula is null or v_email is null then
    return new;
  end if;

  if v_login_name is null then
    v_login_name := lower(v_matricula);
  end if;

  select count(*), min(id)
    into v_match_count, v_match_id
  from public.app_users
  where tenant_id = v_tenant_id
    and (
      matricula = v_matricula
      or lower(trim(email)) = v_email_norm
      or lower(trim(login_name)) = v_login_name
    );

  if v_match_count = 1 then
    update public.app_users
    set auth_user_id = new.id,
        email = v_email,
        role_id = v_role_id,
        ativo = v_ativo,
        login_name = v_login_name,
        updated_at = now()
    where id = v_match_id
      and (auth_user_id is null or auth_user_id = new.id);

    perform public.ensure_app_user_tenant_link(v_match_id, v_tenant_id, true, v_ativo, v_match_id);

    return new;
  end if;

  if v_match_count > 1 then
    return new;
  end if;

  insert into public.app_users (
    tenant_id,
    auth_user_id,
    matricula,
    email,
    role_id,
    ativo,
    login_name
  )
  values (
    v_tenant_id,
    new.id,
    v_matricula,
    v_email,
    v_role_id,
    v_ativo,
    v_login_name
  )
  returning id
    into v_match_id;

  perform public.ensure_app_user_tenant_link(v_match_id, v_tenant_id, true, v_ativo, v_match_id);

  return new;
exception
  when others then
    raise warning 'sync_auth_user_to_app_user skipped for auth user %, email %: %',
      new.id,
      coalesce(new.email, '<null>'),
      sqlerrm;
    return new;
end;
$$;

revoke all on function public.sync_auth_user_to_app_user() from public;
revoke all on function public.sync_auth_user_to_app_user() from anon;
revoke all on function public.sync_auth_user_to_app_user() from authenticated;

create or replace function public.save_user_permissions(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_role_id uuid,
  p_ativo boolean,
  p_permissions jsonb default '[]'::jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_user public.app_users%rowtype;
  v_next_updated_at timestamptz := now();
  v_permission_item jsonb;
  v_page_key text;
  v_can_access boolean;
  v_can_action boolean;
  v_current_permission boolean;
  v_role_key text;
  v_viewer_page_keys constant text[] := array[
    'home',
    'dash-estoque',
    'dashboard-medicao',
    'dashboard-equipes',
    'dash-operacional-faturamento',
    'programacao-visualizacao',
    'medicao-visualizacao',
    'estoque',
    'estoque-equipes',
    'posicao-trafo',
    'estornos',
    'consumo-projeto'
  ];
begin
  -- Somente administradores podem gerenciar permissoes de outros usuarios.
  -- service_role (auth.uid() null) e chamadas internas ignoram esta verificacao.
  if auth.uid() is not null and not public.user_is_admin_in_tenant(p_tenant_id) then
    return jsonb_build_object('success', false, 'status', 403, 'reason', 'FORBIDDEN', 'message', 'Somente administradores podem gerenciar permissoes.');
  end if;

  if jsonb_typeof(coalesce(p_permissions, '[]'::jsonb)) <> 'array' then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_PERMISSIONS_PAYLOAD', 'message', 'A lista de permissoes deve ser um array json.');
  end if;

  select role_key
  into v_role_key
  from public.app_roles
  where id = p_role_id
    and ativo = true;

  if v_role_key is null then
    return jsonb_build_object('success', false, 'status', 422, 'reason', 'INVALID_ROLE', 'message', 'Role invalido para o usuario selecionado.');
  end if;

  if v_role_key not in ('admin', 'user', 'viewer') then
    return jsonb_build_object('success', false, 'status', 422, 'reason', 'INACTIVE_ROLE', 'message', 'Use apenas admin, user ou viewer.');
  end if;

  select *
  into v_target_user
  from public.app_users
  where id = p_target_user_id
    and (
      tenant_id = p_tenant_id
      or exists (
        select 1
        from public.app_user_tenants user_tenants
        where user_tenants.user_id = public.app_users.id
          and user_tenants.tenant_id = p_tenant_id
          and user_tenants.ativo = true
      )
    )
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'TARGET_USER_NOT_FOUND', 'message', 'Usuario nao encontrado no tenant atual.');
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'EXPECTED_UPDATED_AT_REQUIRED', 'message', 'Recarregue as credenciais do usuario antes de salvar.');
  end if;

  if v_target_user.updated_at <> p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'CONCURRENT_MODIFICATION',
      'message', format('As credenciais do usuario %s foram alteradas por outro administrador. Recarregue os dados antes de salvar novamente.', v_target_user.login_name)
    );
  end if;

  update public.app_users
  set
    role_id = p_role_id,
    ativo = p_ativo,
    updated_by = p_actor_user_id,
    updated_at = v_next_updated_at
  where id = p_target_user_id;

  if v_role_key = 'admin' and p_ativo then
    perform public.ensure_app_user_tenant_link(p_target_user_id, p_tenant_id, false, true, p_actor_user_id);
  end if;

  if v_target_user.role_id is distinct from p_role_id then
    insert into public.app_user_permission_history (
      tenant_id, target_user_id, change_type,
      previous_role_id, new_role_id, metadata, created_by
    ) values (
      p_tenant_id, p_target_user_id, 'ROLE_CHANGED',
      v_target_user.role_id, p_role_id,
      jsonb_build_object('previousRoleId', v_target_user.role_id, 'newRoleId', p_role_id),
      p_actor_user_id
    );
  end if;

  if v_target_user.ativo is distinct from p_ativo then
    insert into public.app_user_permission_history (
      tenant_id, target_user_id, change_type,
      previous_ativo, new_ativo, created_by
    ) values (
      p_tenant_id, p_target_user_id, 'STATUS_CHANGED',
      v_target_user.ativo, p_ativo, p_actor_user_id
    );
  end if;

  for v_permission_item in
    select value
    from jsonb_array_elements(coalesce(p_permissions, '[]'::jsonb))
  loop
    v_page_key := nullif(btrim(coalesce(v_permission_item ->> 'pageKey', '')), '');
    if v_page_key is null then
      continue;
    end if;

    v_can_access := coalesce((v_permission_item ->> 'enabled')::boolean, false);

    if v_role_key = 'viewer' and v_page_key <> all(v_viewer_page_keys) then
      v_can_access := false;
    end if;

    v_can_action := case
      when v_role_key = 'viewer' then false
      else v_can_access
    end;

    select upp.can_access
    into v_current_permission
    from public.app_user_page_permissions upp
    where upp.tenant_id = p_tenant_id
      and upp.user_id = p_target_user_id
      and upp.page_key = v_page_key;

    insert into public.app_user_page_permissions (
      tenant_id, user_id, page_key,
      can_access, can_create, can_update, can_cancel, can_reverse, can_import, can_export,
      created_by, updated_by
    ) values (
      p_tenant_id, p_target_user_id, v_page_key,
      v_can_access, v_can_action, v_can_action, v_can_action, v_can_action, v_can_action, v_can_action,
      p_actor_user_id, p_actor_user_id
    )
    on conflict (tenant_id, user_id, page_key) do update
    set
      can_access = excluded.can_access,
      can_create = excluded.can_create,
      can_update = excluded.can_update,
      can_cancel = excluded.can_cancel,
      can_reverse = excluded.can_reverse,
      can_import = excluded.can_import,
      can_export = excluded.can_export,
      updated_by = excluded.updated_by,
      updated_at = now();

    if v_current_permission is distinct from v_can_access then
      insert into public.app_user_permission_history (
        tenant_id, target_user_id, page_key, change_type,
        previous_can_access, new_can_access, created_by
      ) values (
        p_tenant_id, p_target_user_id, v_page_key, 'PAGE_ACCESS_CHANGED',
        v_current_permission, v_can_access, p_actor_user_id
      );
    end if;
  end loop;

  return jsonb_build_object('success', true, 'status', 200, 'updated_at', v_next_updated_at);
end;
$$;

revoke all on function public.save_user_permissions(uuid, uuid, uuid, uuid, boolean, jsonb, timestamptz) from public;
revoke all on function public.save_user_permissions(uuid, uuid, uuid, uuid, boolean, jsonb, timestamptz) from anon;
revoke all on function public.save_user_permissions(uuid, uuid, uuid, uuid, boolean, jsonb, timestamptz) from authenticated;
grant execute on function public.save_user_permissions(uuid, uuid, uuid, uuid, boolean, jsonb, timestamptz) to service_role;

do $$
begin
  if exists (
    select 1
    from public.app_users users
    join public.app_roles roles
      on roles.id = users.role_id
    where users.ativo = true
      and roles.ativo = true
      and roles.is_admin = true
      and not exists (
        select 1
        from public.app_user_tenants user_tenants
        where user_tenants.user_id = users.id
          and user_tenants.tenant_id = users.tenant_id
          and user_tenants.ativo = true
      )
  ) then
    raise exception '386: ainda existem administradores ativos sem vinculo ativo em app_user_tenants.';
  end if;
end;
$$;
