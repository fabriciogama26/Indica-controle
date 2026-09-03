-- 412_utility_distributor_contact_details.sql
-- Adiciona telefone corporativo e e-mail no cadastro de Responsaveis/Gestores da Distribuidora.

alter table if exists public.project_utility_responsibles
  add column if not exists telefone_corporativo text,
  add column if not exists email text;

alter table if exists public.project_utility_field_managers
  add column if not exists telefone_corporativo text,
  add column if not exists email text;

alter table if exists public.project_utility_responsibles
  drop constraint if exists chk_project_utility_responsibles_phone_not_blank;

alter table if exists public.project_utility_responsibles
  add constraint chk_project_utility_responsibles_phone_not_blank
  check (telefone_corporativo is null or btrim(telefone_corporativo) <> '');

alter table if exists public.project_utility_responsibles
  drop constraint if exists chk_project_utility_responsibles_email_not_blank;

alter table if exists public.project_utility_responsibles
  add constraint chk_project_utility_responsibles_email_not_blank
  check (email is null or btrim(email) <> '');

alter table if exists public.project_utility_field_managers
  drop constraint if exists chk_project_utility_field_managers_phone_not_blank;

alter table if exists public.project_utility_field_managers
  add constraint chk_project_utility_field_managers_phone_not_blank
  check (telefone_corporativo is null or btrim(telefone_corporativo) <> '');

alter table if exists public.project_utility_field_managers
  drop constraint if exists chk_project_utility_field_managers_email_not_blank;

alter table if exists public.project_utility_field_managers
  add constraint chk_project_utility_field_managers_email_not_blank
  check (email is null or btrim(email) <> '');

-- A assinatura muda (dois parametros novos). Sem o drop explicito o Postgres
-- criaria uma sobrecarga e o backend passaria a ter duas funcoes candidatas.
drop function if exists public.save_utility_distributor_contact_record(
  uuid,
  uuid,
  text,
  uuid,
  text,
  timestamptz
);

create or replace function public.save_utility_distributor_contact_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_kind text,
  p_contact_id uuid default null,
  p_name text default null,
  p_telefone_corporativo text default null,
  p_email text default null,
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
  v_current_phone text;
  v_current_email text;
  v_current_ativo boolean;
  v_current_updated_at timestamptz;
  v_contact_id uuid := p_contact_id;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_phone_raw text := nullif(btrim(coalesce(p_telefone_corporativo, '')), '');
  v_phone text;
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
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

  if v_phone_raw is not null then
    v_phone := nullif(regexp_replace(v_phone_raw, '\D', '', 'g'), '');

    if v_phone is null then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'INVALID_PHONE',
        'message', 'Informe apenas numeros no telefone corporativo.'
      );
    end if;
  end if;

  if v_email is not null and coalesce(position('@' in v_email) > 1, false) = false then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_EMAIL',
      'message', 'Informe um e-mail valido.'
    );
  end if;

  if v_contact_id is null then
    execute format(
      'insert into public.%I (tenant_id, name, telefone_corporativo, email, ativo, created_by, updated_by)
       values ($1, $2, $3, $4, true, $5, $5)
       returning id, updated_at',
      v_table
    )
    into v_contact_id, v_updated_at
    using p_tenant_id, v_name, v_phone, v_email, p_actor_user_id;
  else
    execute format(
      'select id, name, telefone_corporativo, email, ativo, updated_at
         from public.%I
        where tenant_id = $1
          and id = $2
        for update',
      v_table
    )
    into v_current_id, v_current_name, v_current_phone, v_current_email, v_current_ativo, v_current_updated_at
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
      'name', case when v_current_name is distinct from v_name then jsonb_build_object('from', v_current_name, 'to', v_name) end,
      'telefoneCorporativo', case when v_current_phone is distinct from v_phone then jsonb_build_object('from', v_current_phone, 'to', v_phone) end,
      'email', case when v_current_email is distinct from v_email then jsonb_build_object('from', v_current_email, 'to', v_email) end
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
              telefone_corporativo = $2,
              email = $3,
              updated_by = $4
        where tenant_id = $5
          and id = $6
        returning updated_at',
      v_table
    )
    into v_updated_at
    using v_name, v_phone, v_email, p_actor_user_id, p_tenant_id, v_contact_id;

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
  text,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.save_utility_distributor_contact_record(
  uuid,
  uuid,
  text,
  uuid,
  text,
  text,
  text,
  timestamptz
) to service_role;

do $$
declare
  v_save_fn regprocedure := 'public.save_utility_distributor_contact_record(uuid, uuid, text, uuid, text, text, text, timestamptz)'::regprocedure;
  v_overloads integer;
  v_responsible_columns integer;
  v_field_manager_columns integer;
begin
  if has_function_privilege('anon', v_save_fn, 'execute')
     or has_function_privilege('authenticated', v_save_fn, 'execute') then
    raise exception '412: save_utility_distributor_contact_record ainda executavel por anon/authenticated';
  end if;

  select count(*)
  into v_overloads
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'save_utility_distributor_contact_record';

  if v_overloads <> 1 then
    raise exception '412: esperada 1 assinatura de save_utility_distributor_contact_record, encontradas %', v_overloads;
  end if;

  select count(*)
  into v_responsible_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'project_utility_responsibles'
    and column_name in ('telefone_corporativo', 'email');

  if v_responsible_columns <> 2 then
    raise exception '412: colunas telefone_corporativo/email ausentes em project_utility_responsibles';
  end if;

  select count(*)
  into v_field_manager_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'project_utility_field_managers'
    and column_name in ('telefone_corporativo', 'email');

  if v_field_manager_columns <> 2 then
    raise exception '412: colunas telefone_corporativo/email ausentes em project_utility_field_managers';
  end if;
end;
$$;
