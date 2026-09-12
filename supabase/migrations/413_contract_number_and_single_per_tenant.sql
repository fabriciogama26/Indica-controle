-- 413_contract_number_and_single_per_tenant.sql
-- Formaliza o N. de contrato (coluna legada `number`) e a trava de 1 contrato por tenant.

-- `contract.number` existe no banco vivo desde antes das migrations e nunca foi
-- versionada. Aqui ela passa a ser `text`: N. de contrato e identificador, nao
-- valor aritmetico, entao zero a esquerda e formatos como '2024/001' precisam
-- sobreviver.
do $$
declare
  v_data_type text;
begin
  select data_type
  into v_data_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'contract'
    and column_name = 'number';

  if v_data_type is null then
    execute 'alter table public.contract add column "number" text';
  elsif v_data_type <> 'text' then
    raise notice '413: convertendo contract."number" de % para text', v_data_type;
    execute 'alter table public.contract alter column "number" type text using nullif(btrim("number"::text), '''')';
  end if;
end;
$$;

alter table if exists public.contract
  drop constraint if exists chk_contract_number_not_blank;

update public.contract
set "number" = null
where "number" is not null
  and btrim("number") = '';

alter table if exists public.contract
  add constraint chk_contract_number_not_blank
  check ("number" is null or btrim("number") <> '');

-- 1 contrato por tenant. A 032 declarou `tenant_id uuid not null unique` dentro
-- de um `create table if not exists`: se a tabela ja existia como `contrato`
-- legada, a constraint nunca foi aplicada. A RPC ja recusa o segundo insert,
-- mas checagem otimista no servidor nao substitui trava no banco.
do $$
declare
  v_duplicate_summary text;
  v_has_unique boolean;
begin
  select string_agg(format('tenant_id=%s total=%s', tenant_id, total), '; ')
  into v_duplicate_summary
  from (
    select tenant_id, count(*) as total
    from public.contract
    group by tenant_id
    having count(*) > 1
    order by tenant_id
    limit 10
  ) duplicates;

  if v_duplicate_summary is not null then
    raise exception '413: existem tenants com mais de um contrato. Regularize antes de aplicar a trava: %', v_duplicate_summary
      using errcode = '23505';
  end if;

  select exists (
    select 1
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum = i.indkey[0]
    where n.nspname = 'public'
      and c.relname = 'contract'
      and i.indisunique
      and i.indnatts = 1
      and a.attname = 'tenant_id'
  )
  into v_has_unique;

  if not v_has_unique then
    execute 'create unique index idx_contract_unique_tenant on public.contract (tenant_id)';
  end if;
end;
$$;

-- A assinatura muda (p_number novo). Sem o drop explicito o Postgres criaria
-- uma sobrecarga e o backend passaria a ter duas funcoes candidatas.
drop function if exists public.save_contract_control_record(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  timestamptz
);

create or replace function public.save_contract_control_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_contract_id uuid default null,
  p_name text default null,
  p_empresa text default null,
  p_nome_gestor text default null,
  p_email text default null,
  p_telefone_corporativo text default null,
  p_number text default null,
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
  v_number text := nullif(btrim(coalesce(p_number, '')), '');
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

  if v_email is not null and coalesce(position('@' in v_email) > 1, false) = false then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_EMAIL',
      'message', 'Informe um e-mail valido.'
    );
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
      "number",
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
      v_number,
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
      'telefoneCorporativo', case when v_current.telefone_corporativo is distinct from v_phone then jsonb_build_object('from', v_current.telefone_corporativo::text, 'to', v_phone::text) end,
      'numeroContrato', case when v_current."number" is distinct from v_number then jsonb_build_object('from', v_current."number", 'to', v_number) end
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
      "number" = v_number,
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
  text,
  timestamptz
) to service_role;

do $$
declare
  v_save_fn regprocedure := 'public.save_contract_control_record(uuid, uuid, uuid, text, text, text, text, text, text, timestamptz)'::regprocedure;
  v_overloads integer;
begin
  if has_function_privilege('anon', v_save_fn, 'execute')
     or has_function_privilege('authenticated', v_save_fn, 'execute') then
    raise exception '413: save_contract_control_record ainda executavel por anon/authenticated';
  end if;

  select count(*)
  into v_overloads
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'save_contract_control_record';

  if v_overloads <> 1 then
    raise exception '413: esperada 1 assinatura de save_contract_control_record, encontradas %', v_overloads;
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'contract'
      and column_name = 'number'
      and data_type = 'text'
  ) then
    raise exception '413: contract."number" text nao existe.';
  end if;

  if not exists (
    select 1
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum = i.indkey[0]
    where n.nspname = 'public'
      and c.relname = 'contract'
      and i.indisunique
      and i.indnatts = 1
      and a.attname = 'tenant_id'
  ) then
    raise exception '413: contract nao tem trava unica por tenant_id.';
  end if;
end;
$$;
