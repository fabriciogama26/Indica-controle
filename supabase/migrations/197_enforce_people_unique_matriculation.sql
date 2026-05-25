-- 197_enforce_people_unique_matriculation.sql
-- Garante que a matricula de Pessoas seja unica por tenant.

do $$
declare
  v_duplicate_summary text;
begin
  select string_agg(
    format('tenant_id=%s matricula=%s total=%s', tenant_id, matriculation_key, total),
    '; '
  )
  into v_duplicate_summary
  from (
    select
      tenant_id,
      upper(btrim(matriculation::text)) as matriculation_key,
      count(*) as total
    from public.people
    where matriculation is not null
      and btrim(matriculation::text) <> ''
    group by tenant_id, upper(btrim(matriculation::text))
    having count(*) > 1
    order by tenant_id, upper(btrim(matriculation::text))
    limit 10
  ) duplicates;

  if v_duplicate_summary is not null then
    raise exception 'Existem matriculas duplicadas em people. Regularize antes de aplicar a trava: %', v_duplicate_summary
      using errcode = '23505';
  end if;
end;
$$;

create unique index if not exists idx_people_unique_tenant_matriculation
  on public.people (tenant_id, upper(btrim(matriculation::text)))
  where matriculation is not null
    and btrim(matriculation::text) <> '';

create or replace function public.prevent_people_duplicate_identity()
returns trigger
language plpgsql
as $$
begin
  if new.matriculation is not null
    and btrim(new.matriculation::text) <> ''
    and exists (
      select 1
      from public.people p
      where p.tenant_id = new.tenant_id
        and p.id <> new.id
        and coalesce(upper(btrim(p.matriculation::text)), '') = upper(btrim(new.matriculation::text))
    )
  then
    raise exception 'Pessoa duplicada para matricula no tenant.'
      using errcode = '23505', constraint = 'people_unique_tenant_matriculation_key';
  end if;

  if exists (
    select 1
    from public.people p
    where p.tenant_id = new.tenant_id
      and p.id <> new.id
      and lower(btrim(p.nome)) = lower(btrim(new.nome))
      and coalesce(upper(btrim(p.matriculation::text)), '') = coalesce(upper(btrim(new.matriculation::text)), '')
      and p.job_title_id = new.job_title_id
      and coalesce(p.job_title_type_id::text, '') = coalesce(new.job_title_type_id::text, '')
      and coalesce(upper(btrim(p.job_level::text)), '') = coalesce(upper(btrim(new.job_level::text)), '')
  ) then
    raise exception 'Pessoa duplicada para nome + matricula + cargo + tipo + nivel no tenant.'
      using errcode = '23505', constraint = 'people_duplicate_identity_key';
  end if;

  return new;
end;
$$;

create or replace function public.save_person_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_person_id uuid default null,
  p_name text default null,
  p_matriculation text default null,
  p_job_title_id uuid default null,
  p_job_title_type_id uuid default null,
  p_job_level text default null,
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
  when unique_violation then
    get stacked diagnostics v_constraint_name = constraint_name;

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
