-- 253_granular_page_permissions.sql
-- Evolui a matriz de permissoes para diferenciar cada acao da pagina.
-- Acoes: read (can_access), create, update, cancel, reverse, import, export.
-- Backfill: todas as novas colunas herdam o valor atual de can_access.

-- 1. Novas colunas granulares
alter table public.app_user_page_permissions
  add column if not exists can_create  boolean not null default false,
  add column if not exists can_update  boolean not null default false,
  add column if not exists can_cancel  boolean not null default false,
  add column if not exists can_reverse boolean not null default false,
  add column if not exists can_import  boolean not null default false,
  add column if not exists can_export  boolean not null default false;

-- 2. Backfill: preserva comportamento atual (acesso = todas as acoes liberadas)
update public.app_user_page_permissions
set
  can_create  = can_access,
  can_update  = can_access,
  can_cancel  = can_access,
  can_reverse = can_access,
  can_import  = can_access,
  can_export  = can_access;

-- 3. Recria user_has_page_action() com mapeamento real de acao -> coluna
create or replace function public.user_has_page_action(p_page_key text, p_action text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id   uuid;
  v_tenant_id uuid;
  v_result    boolean;
begin
  select au.id, au.tenant_id
  into v_user_id, v_tenant_id
  from public.app_users au
  where au.auth_user_id = auth.uid()
    and au.ativo = true
  limit 1;

  if v_user_id is null then
    return false;
  end if;

  select case p_action
    when 'read'    then upp.can_access
    when 'create'  then upp.can_access and upp.can_create
    when 'update'  then upp.can_access and upp.can_update
    when 'cancel'  then upp.can_access and upp.can_cancel
    when 'reverse' then upp.can_access and upp.can_reverse
    when 'import'  then upp.can_access and upp.can_import
    when 'export'  then upp.can_access and upp.can_export
    else               upp.can_access
  end
  into v_result
  from public.app_user_page_permissions upp
  where upp.user_id   = v_user_id
    and upp.tenant_id = v_tenant_id
    and upp.page_key  = p_page_key
  limit 1;

  return coalesce(v_result, false);
end;
$$;

comment on function public.user_has_page_action(text, text) is
'Retorna true quando o usuario autenticado possui permissao para executar a acao informada na tela. Acoes: read, create, update, cancel, reverse, import, export.';

-- 4. Atualiza save_user_permissions: toggle de pagina sincroniza todas as colunas granulares.
--    Quando o admin habilita/desabilita uma tela via UI, todas as permissoes de acao seguem o mesmo valor.
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
  v_current_permission boolean;
begin
  if jsonb_typeof(coalesce(p_permissions, '[]'::jsonb)) <> 'array' then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_PERMISSIONS_PAYLOAD', 'message', 'A lista de permissoes deve ser um array json.');
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
    role_id    = p_role_id,
    ativo      = p_ativo,
    updated_by = p_actor_user_id,
    updated_at = v_next_updated_at
  where id        = p_target_user_id
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

    select upp.can_access
    into v_current_permission
    from public.app_user_page_permissions upp
    where upp.tenant_id = p_tenant_id
      and upp.user_id   = p_target_user_id
      and upp.page_key  = v_page_key;

    -- O toggle da UI habilita/desabilita todas as acoes simultaneamente.
    -- Permissoes granulares finas sao gerenciadas por UI dedicada futura.
    insert into public.app_user_page_permissions (
      tenant_id, user_id, page_key,
      can_access, can_create, can_update, can_cancel, can_reverse, can_import, can_export,
      created_by, updated_by
    ) values (
      p_tenant_id, p_target_user_id, v_page_key,
      v_can_access, v_can_access, v_can_access, v_can_access, v_can_access, v_can_access, v_can_access,
      p_actor_user_id, p_actor_user_id
    )
    on conflict (tenant_id, user_id, page_key) do update
    set
      can_access  = excluded.can_access,
      can_create  = excluded.can_create,
      can_update  = excluded.can_update,
      can_cancel  = excluded.can_cancel,
      can_reverse = excluded.can_reverse,
      can_import  = excluded.can_import,
      can_export  = excluded.can_export,
      updated_by  = excluded.updated_by,
      updated_at  = now();

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
grant execute on function public.save_user_permissions(uuid, uuid, uuid, uuid, boolean, jsonb, timestamptz) to authenticated;
grant execute on function public.save_user_permissions(uuid, uuid, uuid, uuid, boolean, jsonb, timestamptz) to service_role;

-- 5. Atualiza trigger de novo usuario: inclui colunas granulares no insert inicial
create or replace function public.ensure_app_user_default_page_permissions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean := false;
  v_default  boolean;
begin
  if new.tenant_id is null then
    return new;
  end if;

  select coalesce(roles.is_admin, false)
  into v_is_admin
  from public.app_roles roles
  where roles.id  = new.role_id
    and roles.ativo = true
  limit 1;

  insert into public.app_user_page_permissions (
    tenant_id, user_id, page_key,
    can_access, can_create, can_update, can_cancel, can_reverse, can_import, can_export,
    created_by, updated_by
  )
  select
    new.tenant_id,
    new.id,
    pages.page_key,
    case when v_is_admin then true else coalesce(pages.default_user_access, false) end,
    case when v_is_admin then true else coalesce(pages.default_user_access, false) end,
    case when v_is_admin then true else coalesce(pages.default_user_access, false) end,
    case when v_is_admin then true else coalesce(pages.default_user_access, false) end,
    case when v_is_admin then true else coalesce(pages.default_user_access, false) end,
    case when v_is_admin then true else coalesce(pages.default_user_access, false) end,
    case when v_is_admin then true else coalesce(pages.default_user_access, false) end,
    null, null
  from public.app_pages pages
  where pages.ativo = true
  on conflict (tenant_id, user_id, page_key) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_app_users_default_page_permissions on public.app_users;
create trigger trg_app_users_default_page_permissions
after insert on public.app_users
for each row execute function public.ensure_app_user_default_page_permissions();

comment on function public.ensure_app_user_default_page_permissions() is
'Ao criar um app_user, cria a matriz inicial em app_user_page_permissions com todas as colunas granulares respeitando default_user_access das telas.';

-- 6. Atualiza trigger de nova tela: inclui colunas granulares no insert inicial
create or replace function public.ensure_app_page_default_user_permissions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.ativo is distinct from true then
    return new;
  end if;

  insert into public.app_user_page_permissions (
    tenant_id, user_id, page_key,
    can_access, can_create, can_update, can_cancel, can_reverse, can_import, can_export,
    created_by, updated_by
  )
  select
    users.tenant_id,
    users.id,
    new.page_key,
    case when coalesce(roles.is_admin, false) then true else coalesce(new.default_user_access, false) end,
    case when coalesce(roles.is_admin, false) then true else coalesce(new.default_user_access, false) end,
    case when coalesce(roles.is_admin, false) then true else coalesce(new.default_user_access, false) end,
    case when coalesce(roles.is_admin, false) then true else coalesce(new.default_user_access, false) end,
    case when coalesce(roles.is_admin, false) then true else coalesce(new.default_user_access, false) end,
    case when coalesce(roles.is_admin, false) then true else coalesce(new.default_user_access, false) end,
    case when coalesce(roles.is_admin, false) then true else coalesce(new.default_user_access, false) end,
    null, null
  from public.app_users users
  left join public.app_roles roles
    on roles.id    = users.role_id
   and roles.ativo = true
  where users.tenant_id is not null
  on conflict (tenant_id, user_id, page_key) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_app_pages_default_user_permissions on public.app_pages;
create trigger trg_app_pages_default_user_permissions
after insert on public.app_pages
for each row execute function public.ensure_app_page_default_user_permissions();

comment on function public.ensure_app_page_default_user_permissions() is
'Ao criar uma tela ativa em app_pages, cria permissoes explicitas para usuarios existentes com todas as colunas granulares.';

-- Validacao
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'app_user_page_permissions'
      and column_name  = 'can_reverse'
  ) then
    raise exception 'Migration 253: coluna can_reverse nao foi criada em app_user_page_permissions.';
  end if;
end;
$$;
