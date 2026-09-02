-- 409_contract_control_fields_and_rpc.sql
-- Adiciona campos de registro/controle em contract e cria RPC transacional de edicao.

do $$
declare
  v_has_legacy_email boolean;
  v_has_email boolean;
  v_has_conflict boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'contract'
      and column_name = 'e-mail'
  )
  into v_has_legacy_email;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'contract'
      and column_name = 'email'
  )
  into v_has_email;

  if v_has_legacy_email and not v_has_email then
    execute 'alter table public.contract rename column "e-mail" to email';
  elsif v_has_legacy_email and v_has_email then
    execute $sql$
      select exists (
        select 1
        from public.contract
        where nullif(btrim(email), '') is not null
          and nullif(btrim("e-mail"), '') is not null
          and nullif(btrim(email), '') <> nullif(btrim("e-mail"), '')
      )
    $sql$
    into v_has_conflict;

    if coalesce(v_has_conflict, false) then
      raise exception '409: contract.email e contract."e-mail" possuem valores divergentes. Resolver manualmente antes da migration.';
    end if;

    execute 'update public.contract set email = coalesce(nullif(btrim(email), ''''), nullif(btrim("e-mail"), ''''))';
    execute 'alter table public.contract drop column "e-mail"';
  end if;
end;
$$;

alter table if exists public.contract
  add column if not exists telefone_corporativo numeric,
  add column if not exists email text,
  add column if not exists nome_gestor text,
  add column if not exists empresa text;

update public.contract
set empresa = name
where nullif(btrim(coalesce(empresa, '')), '') is null
  and nullif(btrim(coalesce(name, '')), '') is not null;

create or replace function public.save_contract_control_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_contract_id uuid default null,
  p_name text default null,
  p_empresa text default null,
  p_nome_gestor text default null,
  p_email text default null,
  p_telefone_corporativo text default null,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.contract%rowtype;
  v_contract_id uuid := p_contract_id;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_empresa text := nullif(btrim(coalesce(p_empresa, '')), '');
  v_nome_gestor text := nullif(btrim(coalesce(p_nome_gestor, '')), '');
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_phone_raw text := nullif(btrim(coalesce(p_telefone_corporativo, '')), '');
  v_phone_digits text;
  v_phone numeric;
  v_updated_at timestamptz;
  v_changes jsonb;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'TENANT_OR_ACTOR_REQUIRED',
      'message', 'Tenant e usuario sao obrigatorios para salvar contrato.'
    );
  end if;

  if v_name is null then
    v_name := v_empresa;
  end if;

  if v_name is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_REQUIRED_FIELDS',
      'message', 'Informe o nome do contrato.'
    );
  end if;

  if v_phone_raw is not null then
    v_phone_digits := regexp_replace(v_phone_raw, '\D', '', 'g');
    if nullif(v_phone_digits, '') is null then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'INVALID_PHONE',
        'message', 'Informe apenas numeros no telefone corporativo.'
      );
    end if;
    v_phone := v_phone_digits::numeric;
  end if;

  if v_contract_id is null then
    if exists (
      select 1
      from public.contract
      where tenant_id = p_tenant_id
    ) then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'CONTRACT_ALREADY_EXISTS',
        'message', 'Ja existe contrato cadastrado para o tenant atual.'
      );
    end if;

    insert into public.contract (
      tenant_id,
      name,
      empresa,
      nome_gestor,
      email,
      telefone_corporativo,
      ativo,
      created_by,
      updated_by
    )
    values (
      p_tenant_id,
      v_name,
      v_empresa,
      v_nome_gestor,
      v_email,
      v_phone,
      true,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at
    into v_contract_id, v_updated_at;
  else
    select *
    into v_current
    from public.contract
    where tenant_id = p_tenant_id
      and id = v_contract_id
    for update;

    if not found then
      return jsonb_build_object(
        'success', false,
        'status', 404,
        'reason', 'CONTRACT_NOT_FOUND',
        'message', 'Contrato nao encontrado.'
      );
    end if;

    if p_expected_updated_at is null then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
        'message', 'Atualize a lista antes de editar o contrato.'
      );
    end if;

    if v_current.updated_at <> p_expected_updated_at then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'CONCURRENT_MODIFICATION',
        'message', format('O contrato %s foi alterado por outro usuario. Recarregue os dados antes de salvar novamente.', v_current.name)
      );
    end if;

    if not v_current.ativo then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'RECORD_INACTIVE',
        'message', 'Ative o contrato antes de editar.'
      );
    end if;

    v_changes := jsonb_strip_nulls(jsonb_build_object(
      'name', case when v_current.name is distinct from v_name then jsonb_build_object('from', v_current.name, 'to', v_name) end,
      'empresa', case when v_current.empresa is distinct from v_empresa then jsonb_build_object('from', v_current.empresa, 'to', v_empresa) end,
      'nomeGestor', case when v_current.nome_gestor is distinct from v_nome_gestor then jsonb_build_object('from', v_current.nome_gestor, 'to', v_nome_gestor) end,
      'email', case when v_current.email is distinct from v_email then jsonb_build_object('from', v_current.email, 'to', v_email) end,
      'telefoneCorporativo', case when v_current.telefone_corporativo is distinct from v_phone then jsonb_build_object('from', v_current.telefone_corporativo::text, 'to', v_phone::text) end
    ));

    if v_changes = '{}'::jsonb then
      return jsonb_build_object(
        'success', true,
        'status', 200,
        'contract_id', v_contract_id,
        'updated_at', v_current.updated_at,
        'message', format('Nenhuma alteracao detectada no contrato %s.', v_current.name)
      );
    end if;

    update public.contract
    set
      name = v_name,
      empresa = v_empresa,
      nome_gestor = v_nome_gestor,
      email = v_email,
      telefone_corporativo = v_phone,
      updated_by = p_actor_user_id
    where tenant_id = p_tenant_id
      and id = v_contract_id
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
      'contrato',
      'contract',
      v_contract_id,
      coalesce(v_empresa, v_name),
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
    'contract_id', v_contract_id,
    'updated_at', v_updated_at,
    'message',
      case
        when p_contract_id is null then format('Contrato %s cadastrado com sucesso.', v_name)
        else format('Contrato %s atualizado com sucesso.', v_name)
      end
  );
exception
  when unique_violation then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_CONTRACT',
      'message', 'Ja existe contrato cadastrado para o tenant atual.'
    );
end;
$$;

revoke all on function public.save_contract_control_record(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.save_contract_control_record(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  timestamptz
) to service_role;

do $$
declare
  v_save_fn regprocedure := 'public.save_contract_control_record(uuid, uuid, uuid, text, text, text, text, text, timestamptz)'::regprocedure;
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'contract'
      and column_name = 'telefone_corporativo'
      and data_type = 'numeric'
  ) then
    raise exception '409: contract.telefone_corporativo numeric nao existe.';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'contract'
      and column_name = 'e-mail'
  ) then
    raise exception '409: coluna legada contract."e-mail" ainda existe.';
  end if;

  if has_function_privilege('anon', v_save_fn, 'execute')
     or has_function_privilege('authenticated', v_save_fn, 'execute') then
    raise exception '409: save_contract_control_record ainda executavel por anon/authenticated';
  end if;
end;
$$;
