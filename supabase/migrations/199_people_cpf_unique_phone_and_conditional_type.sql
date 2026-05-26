-- 199_people_cpf_unique_phone_and_conditional_type.sql
-- Garante CPF unico por tenant, adiciona telefone opcional e recompila escrita de Pessoas.

alter table if exists public.people
  add column if not exists phone text;

alter table if exists public.people
  drop constraint if exists chk_people_phone_not_blank;

alter table if exists public.people
  add constraint chk_people_phone_not_blank
  check (phone is null or btrim(phone) <> '');

do $$
declare
  v_duplicate_summary text;
begin
  select string_agg(
    format('tenant_id=%s cpf=%s total=%s', tenant_id, cpf, total),
    '; '
  )
  into v_duplicate_summary
  from (
    select tenant_id, cpf, count(*) as total
    from public.people
    where cpf is not null
    group by tenant_id, cpf
    having count(*) > 1
    order by tenant_id, cpf
    limit 10
  ) duplicates;

  if v_duplicate_summary is not null then
    raise exception 'Existem CPFs duplicados em people. Regularize antes de aplicar a trava: %', v_duplicate_summary
      using errcode = '23505';
  end if;
end;
$$;

drop index if exists public.idx_people_tenant_cpf;

create unique index if not exists idx_people_unique_tenant_cpf
  on public.people (tenant_id, cpf)
  where cpf is not null;

create unique index if not exists idx_people_unique_tenant_cpf_matriculation
  on public.people (tenant_id, cpf, upper(btrim(matriculation::text)))
  where cpf is not null
    and matriculation is not null
    and btrim(matriculation::text) <> '';

create index if not exists idx_people_tenant_phone
  on public.people (tenant_id, phone)
  where phone is not null;

create or replace function public.save_person_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_person_id uuid default null,
  p_name text default null,
  p_matriculation text default null,
  p_job_title_id uuid default null,
  p_job_title_type_id uuid default null,
  p_job_level text default null,
  p_cpf text default null,
  p_phone text default null,
  p_changes jsonb default '{}'::jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.people%rowtype;
  v_person_id uuid;
  v_updated_at timestamptz;
  v_constraint_name text;
begin
  if p_person_id is null then
    insert into public.people (
      tenant_id,
      nome,
      matriculation,
      job_title_id,
      job_title_type_id,
      job_level,
      cpf,
      phone,
      ativo,
      cancellation_reason,
      canceled_at,
      canceled_by,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      p_name,
      nullif(btrim(coalesce(p_matriculation, '')), ''),
      p_job_title_id,
      p_job_title_type_id,
      nullif(btrim(coalesce(p_job_level, '')), ''),
      nullif(regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g'), ''),
      nullif(btrim(coalesce(p_phone, '')), ''),
      true,
      null,
      null,
      null,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at
    into v_person_id, v_updated_at;

    return jsonb_build_object(
      'success', true,
      'status', 200,
      'person_id', v_person_id,
      'updated_at', v_updated_at
    );
  end if;

  select *
  into v_current
  from public.people
  where tenant_id = p_tenant_id
    and id = p_person_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'PERSON_NOT_FOUND',
      'message', 'Pessoa nao encontrada.'
    );
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
      'message', 'Atualize a lista antes de editar a pessoa.'
    );
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'CONCURRENT_MODIFICATION',
      'message', format('A pessoa %s foi alterada por outro usuario. Recarregue os dados antes de salvar novamente.', v_current.nome)
    );
  end if;

  if not v_current.ativo then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'RECORD_INACTIVE',
      'message', 'Ative a pessoa antes de editar.'
    );
  end if;

  update public.people
  set
    nome = p_name,
    matriculation = nullif(btrim(coalesce(p_matriculation, '')), ''),
    job_title_id = p_job_title_id,
    job_title_type_id = p_job_title_type_id,
    job_level = nullif(btrim(coalesce(p_job_level, '')), ''),
    cpf = nullif(regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g'), ''),
    phone = nullif(btrim(coalesce(p_phone, '')), ''),
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = p_person_id
  returning id, updated_at
  into v_person_id, v_updated_at;

  if coalesce(jsonb_object_length(coalesce(p_changes, '{}'::jsonb)), 0) > 0 then
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
    ) values (
      p_tenant_id,
      'pessoas',
      'people',
      p_person_id,
      p_name,
      'UPDATE',
      null,
      coalesce(p_changes, '{}'::jsonb),
      '{}'::jsonb,
      p_actor_user_id,
      p_actor_user_id
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'person_id', v_person_id,
    'updated_at', v_updated_at
  );
exception
  when check_violation then
    get stacked diagnostics v_constraint_name = constraint_name;

    if v_constraint_name = 'chk_people_cpf_format' then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'INVALID_PERSON_CPF',
        'message', 'CPF invalido. Informe 11 digitos ou deixe em branco.'
      );
    end if;

    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', v_constraint_name,
      'message', 'Falha de validacao ao salvar pessoa.'
    );
  when unique_violation then
    get stacked diagnostics v_constraint_name = constraint_name;

    if v_constraint_name in (
      'people_unique_tenant_cpf_key',
      'idx_people_unique_tenant_cpf'
    ) then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'DUPLICATE_PERSON_CPF',
        'message', 'Ja existe pessoa com este CPF no tenant atual.'
      );
    end if;

    if v_constraint_name in (
      'people_unique_tenant_cpf_matriculation_key',
      'idx_people_unique_tenant_cpf_matriculation'
    ) then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'DUPLICATE_PERSON_CPF_MATRICULATION',
        'message', 'Ja existe pessoa com este CPF e esta matricula no tenant atual.'
      );
    end if;

    if v_constraint_name in (
      'people_unique_tenant_matriculation_key',
      'idx_people_unique_tenant_matriculation'
    ) or sqlerrm ilike '%Pessoa duplicada para matricula%' then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'DUPLICATE_PERSON_MATRICULATION',
        'message', 'Ja existe pessoa com esta matricula no tenant atual.'
      );
    end if;

    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_PERSON_IDENTITY',
      'message', 'Ja existe pessoa com o mesmo nome, matricula, cargo, tipo e nivel no tenant atual.'
    );
end;
$$;

revoke all on function public.save_person_record(uuid, uuid, uuid, text, text, uuid, uuid, text, text, text, jsonb, timestamptz) from public;
grant execute on function public.save_person_record(uuid, uuid, uuid, text, text, uuid, uuid, text, text, text, jsonb, timestamptz) to authenticated;
grant execute on function public.save_person_record(uuid, uuid, uuid, text, text, uuid, uuid, text, text, text, jsonb, timestamptz) to service_role;
