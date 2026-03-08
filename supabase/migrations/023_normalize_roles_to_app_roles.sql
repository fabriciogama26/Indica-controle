-- 023_normalize_roles_to_app_roles.sql
-- Normaliza os tipos de role em tabela propria e migra app_users/role_page_permissions para role_id.

create table if not exists public.app_roles (
  id uuid primary key default gen_random_uuid(),
  role_key text not null unique,
  name text not null,
  description text,
  is_admin boolean not null default false,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id)
);

create index if not exists idx_app_roles_role_key
  on public.app_roles (role_key);

alter table if exists public.app_roles enable row level security;

drop policy if exists app_roles_authenticated_select on public.app_roles;
create policy app_roles_authenticated_select on public.app_roles
for select
to authenticated
using (ativo = true);

drop trigger if exists trg_app_roles_audit on public.app_roles;
create trigger trg_app_roles_audit before insert or update on public.app_roles
for each row execute function public.apply_audit_fields();

insert into public.app_roles (role_key, name, description, is_admin)
values
  ('admin', 'Administrador', 'Perfil administrativo padrao do tenant.', true),
  ('master', 'Master', 'Perfil administrativo com acesso ampliado.', true),
  ('user', 'Usuario', 'Perfil operacional padrao do tenant.', false)
on conflict (role_key) do update
set
  name = excluded.name,
  description = excluded.description,
  is_admin = excluded.is_admin,
  ativo = true;

insert into public.app_roles (role_key, name, description, is_admin)
select distinct
  lower(trim(source.role_key)) as role_key,
  initcap(replace(lower(trim(source.role_key)), '_', ' ')) as name,
  'Perfil migrado automaticamente a partir da coluna role legada.',
  lower(trim(source.role_key)) in ('admin', 'master')
from (
  select role as role_key
  from public.app_users
  where role is not null

  union

  select role as role_key
  from public.role_page_permissions
  where role is not null
) as source
where nullif(trim(source.role_key), '') is not null
on conflict (role_key) do nothing;

alter table if exists public.app_users
  add column if not exists role_id uuid references public.app_roles(id);

update public.app_users au
set role_id = ar.id
from public.app_roles ar
where au.role_id is null
  and ar.role_key = lower(trim(coalesce(au.role, '')));

update public.app_users au
set role_id = ar.id
from public.app_roles ar
where au.role_id is null
  and ar.role_key = 'user';

alter table if exists public.app_users
  alter column role_id set not null;

create index if not exists idx_app_users_role_id
  on public.app_users (role_id);

alter table if exists public.role_page_permissions
  add column if not exists role_id uuid references public.app_roles(id);

update public.role_page_permissions rpp
set role_id = ar.id
from public.app_roles ar
where rpp.role_id is null
  and ar.role_key = lower(trim(coalesce(rpp.role, '')));

alter table if exists public.role_page_permissions
  alter column role_id set not null;

alter table if exists public.role_page_permissions
  drop constraint if exists role_page_permissions_tenant_id_role_page_key_key;

alter table if exists public.role_page_permissions
  add constraint role_page_permissions_tenant_id_role_id_page_key_key
  unique (tenant_id, role_id, page_key);

drop index if exists idx_role_page_permissions_tenant_role;
create index if not exists idx_role_page_permissions_tenant_role_id
  on public.role_page_permissions (tenant_id, role_id, page_key);

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
      and au.tenant_id = p_tenant_id
      and au.ativo = true
      and ar.ativo = true
      and ar.is_admin = true
  )
$$;

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
        and (auth_user_id is null or auth_user_id = new.id);

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
  );

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

alter table if exists public.role_page_permissions
  drop column if exists role;

alter table if exists public.app_users
  drop column if exists role;

comment on function public.user_is_admin_in_tenant(uuid) is
'Retorna true quando o auth.uid() atual pertence a um app_users ativo do tenant informado com role administrativa em app_roles.';
