-- 017_sync_auth_users_to_app_users.sql
-- Sincroniza auth.users com public.app_users sem depender de insert manual em todos os casos.

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
  v_role text := 'user';
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
  v_role := coalesce(nullif(trim(coalesce(v_metadata ->> 'role', '')), ''), 'user');

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
        role = v_role,
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
    role,
    ativo,
    login_name
  )
  values (
    v_tenant_id,
    new.id,
    v_matricula,
    v_email,
    v_role,
    v_ativo,
    v_login_name
  );

  return new;
end;
$$;

drop trigger if exists trg_sync_auth_user_to_app_user on auth.users;
create trigger trg_sync_auth_user_to_app_user
after insert or update of email, raw_user_meta_data, email_confirmed_at, phone_confirmed_at
on auth.users
for each row
execute function public.sync_auth_user_to_app_user();

update public.app_users au
set auth_user_id = u.id,
    email = coalesce(u.email, au.email),
    updated_at = now()
from auth.users u
where au.auth_user_id is null
  and lower(trim(au.email)) = lower(trim(coalesce(u.email, '')))
  and (
    select count(*)
    from public.app_users au2
    where lower(trim(au2.email)) = lower(trim(coalesce(u.email, '')))
  ) = 1;
