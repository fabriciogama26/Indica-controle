-- 018_make_auth_user_sync_fail_open.sql
-- Garante que falhas na sincronizacao auth.users -> app_users nao bloqueiem o Invite User do Supabase Auth.

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
exception
  when others then
    raise warning 'sync_auth_user_to_app_user skipped for auth user %, email %: %',
      new.id,
      coalesce(new.email, '<null>'),
      sqlerrm;
    return new;
end;
$$;
