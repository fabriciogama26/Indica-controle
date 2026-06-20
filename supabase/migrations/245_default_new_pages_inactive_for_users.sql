-- 245_default_new_pages_inactive_for_users.sql
-- Garante que novas telas nascam bloqueadas para usuarios nao administrativos.

alter table if exists public.app_pages
  add column if not exists default_user_access boolean not null default false;

update public.app_pages
set
  default_user_access = case
    when page_key = 'mapa-programacao' then false
    else true
  end,
  updated_at = now()
where default_user_access is distinct from case
  when page_key = 'mapa-programacao' then false
  else true
end;

update public.app_user_page_permissions permissions
set
  can_access = coalesce(roles.is_admin, false),
  updated_at = now()
from public.app_users users
left join public.app_roles roles
  on roles.id = users.role_id
 and roles.ativo = true
where permissions.tenant_id = users.tenant_id
  and permissions.user_id = users.id
  and permissions.page_key = 'mapa-programacao'
  and permissions.created_by is null
  and permissions.updated_by is null
  and permissions.can_access is distinct from coalesce(roles.is_admin, false);

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
  pages.page_key,
  case
    when coalesce(roles.is_admin, false) then true
    else coalesce(pages.default_user_access, false)
  end,
  null,
  null
from public.app_users users
left join public.app_roles roles
  on roles.id = users.role_id
 and roles.ativo = true
join public.app_pages pages
  on pages.ativo = true
left join public.app_user_page_permissions existing
  on existing.tenant_id = users.tenant_id
 and existing.user_id = users.id
 and existing.page_key = pages.page_key
where users.tenant_id is not null
  and existing.user_id is null
on conflict (tenant_id, user_id, page_key) do nothing;

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
    new.page_key,
    case
      when coalesce(roles.is_admin, false) then true
      else coalesce(new.default_user_access, false)
    end,
    null,
    null
  from public.app_users users
  left join public.app_roles roles
    on roles.id = users.role_id
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

create or replace function public.ensure_app_user_default_page_permissions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean := false;
begin
  if new.tenant_id is null then
    return new;
  end if;

  select coalesce(roles.is_admin, false)
  into v_is_admin
  from public.app_roles roles
  where roles.id = new.role_id
    and roles.ativo = true
  limit 1;

  insert into public.app_user_page_permissions (
    tenant_id,
    user_id,
    page_key,
    can_access,
    created_by,
    updated_by
  )
  select
    new.tenant_id,
    new.id,
    pages.page_key,
    case
      when coalesce(v_is_admin, false) then true
      else coalesce(pages.default_user_access, false)
    end,
    null,
    null
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

comment on column public.app_pages.default_user_access is
'Define o fallback de acesso para usuarios nao administrativos quando a tela ainda nao foi configurada explicitamente; novas telas nascem false.';

comment on function public.ensure_app_page_default_user_permissions() is
'Ao criar uma tela ativa em app_pages, cria permissoes explicitas para usuarios existentes: admin/master liberados e demais conforme default_user_access.';

comment on function public.ensure_app_user_default_page_permissions() is
'Ao criar um app_user, cria a matriz inicial em app_user_page_permissions respeitando default_user_access das telas.';
