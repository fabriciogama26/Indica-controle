-- 385_normalize_roles_and_viewer_read_only.sql
-- Mantem somente admin, user e viewer ativos e fecha viewer como leitura apenas.

do $$
declare
  v_admin_role_id uuid;
  v_user_role_id uuid;
  v_viewer_role_id uuid;
  v_admin_migrated integer := 0;
  v_user_migrated integer := 0;
begin
  insert into public.app_roles (role_key, name, description, is_admin, ativo)
  values
    ('admin', 'Administrador', 'Perfil administrativo com acesso total.', true, true),
    ('user', 'Usuario', 'Perfil operacional padrao.', false, true),
    ('viewer', 'Viewer', 'Perfil somente leitura para telas de consulta.', false, true)
  on conflict (role_key) do update
  set
    name = excluded.name,
    description = excluded.description,
    is_admin = excluded.is_admin,
    ativo = excluded.ativo,
    updated_at = now();

  select id into v_admin_role_id from public.app_roles where role_key = 'admin' and ativo = true;
  select id into v_user_role_id from public.app_roles where role_key = 'user' and ativo = true;
  select id into v_viewer_role_id from public.app_roles where role_key = 'viewer' and ativo = true;

  if v_admin_role_id is null or v_user_role_id is null or v_viewer_role_id is null then
    raise exception '385: roles admin, user e viewer precisam existir e estar ativos.';
  end if;

  insert into public.app_user_permission_history (
    tenant_id,
    target_user_id,
    change_type,
    previous_role_id,
    new_role_id,
    metadata,
    created_by
  )
  select
    users.tenant_id,
    users.id,
    'ROLE_CHANGED',
    users.role_id,
    v_admin_role_id,
    jsonb_build_object('source', '385_normalize_roles_and_viewer_read_only', 'fromRole', 'master', 'toRole', 'admin'),
    null
  from public.app_users users
  join public.app_roles old_role
    on old_role.id = users.role_id
  where old_role.role_key = 'master';

  update public.app_users users
  set
    role_id = v_admin_role_id,
    updated_at = now()
  from public.app_roles old_role
  where users.role_id = old_role.id
    and old_role.role_key = 'master';
  get diagnostics v_admin_migrated = row_count;

  insert into public.app_user_permission_history (
    tenant_id,
    target_user_id,
    change_type,
    previous_role_id,
    new_role_id,
    metadata,
    created_by
  )
  select
    users.tenant_id,
    users.id,
    'ROLE_CHANGED',
    users.role_id,
    v_user_role_id,
    jsonb_build_object('source', '385_normalize_roles_and_viewer_read_only', 'fromRole', 'supervisor', 'toRole', 'user'),
    null
  from public.app_users users
  join public.app_roles old_role
    on old_role.id = users.role_id
  where old_role.role_key = 'supervisor';

  update public.app_users users
  set
    role_id = v_user_role_id,
    updated_at = now()
  from public.app_roles old_role
  where users.role_id = old_role.id
    and old_role.role_key = 'supervisor';
  get diagnostics v_user_migrated = row_count;

  update public.app_roles
  set
    ativo = false,
    is_admin = false,
    updated_at = now()
  where role_key in ('master', 'supervisor');

  raise notice '385: usuarios migrados master->admin=% supervisor->user=%', v_admin_migrated, v_user_migrated;
end;
$$;

create temp table viewer_read_only_pages (
  page_key text primary key
) on commit drop;

insert into viewer_read_only_pages (page_key)
values
  ('home'),
  ('dash-estoque'),
  ('dashboard-medicao'),
  ('dashboard-equipes'),
  ('dash-operacional-faturamento'),
  ('programacao-visualizacao'),
  ('medicao-visualizacao'),
  ('estoque'),
  ('estoque-equipes'),
  ('posicao-trafo'),
  ('estornos'),
  ('consumo-projeto');

with viewer_role as (
  select id as role_id
  from public.app_roles
  where role_key = 'viewer'
    and ativo = true
)
insert into public.role_page_permissions (
  tenant_id,
  role_id,
  page_key,
  can_access,
  can_create,
  can_update,
  can_cancel,
  can_reverse,
  can_import,
  can_export
)
select
  tenants.id,
  viewer_role.role_id,
  pages.page_key,
  viewer_pages.page_key is not null,
  false,
  false,
  false,
  false,
  false,
  false
from public.tenants
cross join viewer_role
join public.app_pages pages
  on pages.ativo = true
left join viewer_read_only_pages viewer_pages
  on viewer_pages.page_key = pages.page_key
on conflict (tenant_id, role_id, page_key) do update
set
  can_access = excluded.can_access,
  can_create = false,
  can_update = false,
  can_cancel = false,
  can_reverse = false,
  can_import = false,
  can_export = false,
  updated_at = now();

create temp table viewer_permission_targets on commit drop as
with viewer_role as (
  select id as role_id
  from public.app_roles
  where role_key = 'viewer'
    and ativo = true
),
viewer_user_tenants as (
  select distinct
    users.id as user_id,
    users.tenant_id
  from public.app_users users
  join viewer_role
    on viewer_role.role_id = users.role_id
  where users.tenant_id is not null

  union

  select distinct
    users.id as user_id,
    user_tenants.tenant_id
  from public.app_users users
  join viewer_role
    on viewer_role.role_id = users.role_id
  join public.app_user_tenants user_tenants
    on user_tenants.user_id = users.id
   and user_tenants.ativo = true
  where user_tenants.tenant_id is not null
)
select
  viewer_user_tenants.tenant_id,
  viewer_user_tenants.user_id,
  pages.page_key,
  viewer_pages.page_key is not null as next_can_access,
  current_permissions.can_access as previous_can_access
from viewer_user_tenants
join public.app_pages pages
  on pages.ativo = true
left join viewer_read_only_pages viewer_pages
  on viewer_pages.page_key = pages.page_key
left join public.app_user_page_permissions current_permissions
  on current_permissions.tenant_id = viewer_user_tenants.tenant_id
 and current_permissions.user_id = viewer_user_tenants.user_id
 and current_permissions.page_key = pages.page_key;

insert into viewer_permission_targets (
  tenant_id,
  user_id,
  page_key,
  next_can_access,
  previous_can_access
)
select
  permissions.tenant_id,
  permissions.user_id,
  permissions.page_key,
  viewer_pages.page_key is not null,
  permissions.can_access
from public.app_user_page_permissions permissions
join public.app_users users
  on users.id = permissions.user_id
join public.app_roles roles
  on roles.id = users.role_id
left join viewer_read_only_pages viewer_pages
  on viewer_pages.page_key = permissions.page_key
where roles.role_key = 'viewer'
  and not exists (
    select 1
    from viewer_permission_targets targets
    where targets.tenant_id = permissions.tenant_id
      and targets.user_id = permissions.user_id
      and targets.page_key = permissions.page_key
  );

insert into public.app_user_permission_history (
  tenant_id,
  target_user_id,
  page_key,
  change_type,
  previous_can_access,
  new_can_access,
  metadata,
  created_by
)
select
  tenant_id,
  user_id,
  page_key,
  'PAGE_ACCESS_CHANGED',
  previous_can_access,
  next_can_access,
  jsonb_build_object('source', '385_normalize_roles_and_viewer_read_only'),
  null
from viewer_permission_targets
where previous_can_access is distinct from next_can_access;

insert into public.app_user_page_permissions (
  tenant_id,
  user_id,
  page_key,
  can_access,
  can_create,
  can_update,
  can_cancel,
  can_reverse,
  can_import,
  can_export,
  created_by,
  updated_by
)
select
  tenant_id,
  user_id,
  page_key,
  next_can_access,
  false,
  false,
  false,
  false,
  false,
  false,
  null,
  null
from viewer_permission_targets
on conflict (tenant_id, user_id, page_key) do update
set
  can_access = excluded.can_access,
  can_create = false,
  can_update = false,
  can_cancel = false,
  can_reverse = false,
  can_import = false,
  can_export = false,
  updated_by = null,
  updated_at = now();

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
    and tenant_id = p_tenant_id
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
  where id = p_target_user_id
    and tenant_id = p_tenant_id;

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
    from public.app_roles
    where role_key in ('master', 'supervisor')
      and ativo = true
  ) then
    raise exception '385: master/supervisor ainda estao ativos.';
  end if;

  if exists (
    select 1
    from public.app_users users
    join public.app_roles roles
      on roles.id = users.role_id
    where roles.role_key in ('master', 'supervisor')
  ) then
    raise exception '385: ainda existem usuarios vinculados a master/supervisor.';
  end if;

  if exists (
    select 1
    from public.app_user_page_permissions permissions
    join public.app_users users
      on users.id = permissions.user_id
    join public.app_roles roles
      on roles.id = users.role_id
    left join viewer_read_only_pages viewer_pages
      on viewer_pages.page_key = permissions.page_key
    where roles.role_key = 'viewer'
      and (
        coalesce(permissions.can_create, false)
        or coalesce(permissions.can_update, false)
        or coalesce(permissions.can_cancel, false)
        or coalesce(permissions.can_reverse, false)
        or coalesce(permissions.can_import, false)
        or coalesce(permissions.can_export, false)
        or (viewer_pages.page_key is null and coalesce(permissions.can_access, false))
      )
  ) then
    raise exception '385: viewer ainda possui permissao fora do modo leitura.';
  end if;
end;
$$;
