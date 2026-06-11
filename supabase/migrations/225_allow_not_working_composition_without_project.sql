-- 225_allow_not_working_composition_without_project.sql
-- Permite composicao sem projeto somente quando a equipe nao atuou.

begin;

alter table public.team_compositions
  alter column project_id drop not null,
  alter column project_code_snapshot drop not null;

alter table public.team_compositions
  drop constraint if exists team_compositions_project_code_not_blank;

alter table public.team_compositions
  drop constraint if exists team_compositions_project_by_work_status_check;

alter table public.team_compositions
  add constraint team_compositions_project_by_work_status_check
  check (
    (
      work_status = 'WORKING'
      and project_id is not null
      and nullif(btrim(coalesce(project_code_snapshot, '')), '') is not null
    )
    or work_status = 'NOT_WORKING'
  );

create unique index if not exists ux_team_compositions_not_working_active
  on public.team_compositions (tenant_id, composition_date, team_id)
  where is_active = true
    and work_status = 'NOT_WORKING';

create or replace function public.save_team_composition_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_composition_id uuid,
  p_composition_date date,
  p_project_id uuid,
  p_team_id uuid,
  p_sector text,
  p_start_time time,
  p_notes text,
  p_members jsonb,
  p_work_status text,
  p_expected_updated_at timestamptz default null,
  p_yard text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_work_status text := upper(btrim(coalesce(p_work_status, '')));
  v_current public.team_compositions%rowtype;
  v_team record;
  v_foreman record;
  v_member_person_id uuid;
  v_member_is_present boolean;
  v_resolved_yard text;
  v_result jsonb;
  v_composition_id uuid;
  v_updated_at timestamptz;
begin
  if v_work_status not in ('WORKING', 'NOT_WORKING') then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_WORK_STATUS',
      'message', 'Situacao da equipe invalida.'
    );
  end if;

  if v_work_status = 'WORKING' then
    if p_project_id is null then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'PROJECT_REQUIRED',
        'message', 'Campos obrigatorios pendentes: Projeto.'
      );
    end if;

    v_result := public.save_team_composition_record(
      p_tenant_id,
      p_actor_user_id,
      p_composition_id,
      p_composition_date,
      p_project_id,
      p_team_id,
      p_sector,
      p_start_time,
      p_notes,
      p_members,
      p_expected_updated_at,
      p_yard
    );

    if coalesce((v_result ->> 'success')::boolean, false) is not true then
      return v_result;
    end if;

    v_composition_id := (v_result ->> 'composition_id')::uuid;

    update public.team_compositions
    set
      work_status = 'WORKING',
      updated_by = p_actor_user_id
    where tenant_id = p_tenant_id
      and id = v_composition_id
    returning updated_at into v_updated_at;

    return v_result || jsonb_build_object(
      'work_status', 'WORKING',
      'updated_at', v_updated_at
    );
  end if;

  if p_composition_date is null
    or p_team_id is null
    or nullif(btrim(coalesce(p_sector, '')), '') is null
    or p_start_time is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_REQUIRED_FIELDS',
      'message', 'Campos obrigatorios pendentes para registrar equipe sem atuacao.'
    );
  end if;

  if p_project_id is not null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'PROJECT_NOT_ALLOWED',
      'message', 'Projeto nao deve ser informado quando a equipe nao atuou.'
    );
  end if;

  select
    t.id,
    t.name,
    t.vehicle_plate,
    t.foreman_person_id,
    sc.name as service_center_name
    into v_team
  from public.teams t
  left join public.project_service_centers sc
    on sc.tenant_id = t.tenant_id
   and sc.id = t.service_center_id
  where t.tenant_id = p_tenant_id
    and t.id = p_team_id
    and t.ativo = true
  limit 1;

  if v_team.id is null then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'INVALID_TEAM',
      'message', 'Equipe invalida ou inativa para o tenant atual.'
    );
  end if;

  select
    p.id,
    p.nome,
    p.matriculation::text as matriculation,
    p.cpf::text as cpf,
    p.phone::text as phone,
    jt.name as job_title_name
    into v_foreman
  from public.people p
  left join public.job_titles jt
    on jt.tenant_id = p.tenant_id
   and jt.id = p.job_title_id
  where p.tenant_id = p_tenant_id
    and p.id = v_team.foreman_person_id
    and p.ativo = true
  limit 1;

  if v_foreman.id is null then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'INVALID_TEAM_FOREMAN',
      'message', 'A equipe precisa possuir encarregado ativo para registrar que nao atuou.'
    );
  end if;

  if p_members is null
    or jsonb_typeof(p_members) <> 'array'
    or jsonb_array_length(p_members) <> 1 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'NOT_WORKING_MEMBER_RULE',
      'message', 'Equipe que nao atuou deve possuir somente o encarregado da equipe, marcado como nao presente.'
    );
  end if;

  if coalesce(p_members -> 0 ->> 'personId', '') ~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_member_person_id := (p_members -> 0 ->> 'personId')::uuid;
  end if;

  v_member_is_present := case
    when jsonb_typeof(p_members -> 0 -> 'isPresent') = 'boolean'
      then (p_members -> 0 ->> 'isPresent')::boolean
    else true
  end;

  if v_member_person_id is distinct from v_team.foreman_person_id
    or v_member_is_present is distinct from false then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'NOT_WORKING_MEMBER_RULE',
      'message', 'Equipe que nao atuou deve possuir somente o encarregado da equipe, marcado como nao presente.'
    );
  end if;

  v_resolved_yard := nullif(btrim(coalesce(v_team.service_center_name, p_yard, '')), '');

  if v_resolved_yard is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_TEAM_SERVICE_CENTER',
      'message', 'Campos obrigatorios pendentes: Patio/Centro de Servico da equipe.'
    );
  end if;

  if p_composition_id is not null then
    select *
      into v_current
    from public.team_compositions
    where tenant_id = p_tenant_id
      and id = p_composition_id
    for update;

    if not found then
      return jsonb_build_object(
        'success', false,
        'status', 404,
        'reason', 'NOT_FOUND',
        'message', 'Composicao nao encontrada.'
      );
    end if;

    if p_expected_updated_at is null
      or v_current.updated_at is distinct from p_expected_updated_at then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'CONCURRENT_MODIFICATION',
        'message', 'A composicao foi alterada por outro usuario. Recarregue antes de salvar novamente.'
      );
    end if;
  end if;

  if p_composition_id is null then
    insert into public.team_compositions (
      tenant_id,
      composition_date,
      project_id,
      team_id,
      project_code_snapshot,
      project_service_center_snapshot,
      team_name_snapshot,
      vehicle_plate_snapshot,
      foreman_name_snapshot,
      work_status,
      sector,
      yard,
      start_time,
      notes,
      is_active,
      created_by,
      updated_by
    )
    values (
      p_tenant_id,
      p_composition_date,
      null,
      p_team_id,
      null,
      null,
      btrim(v_team.name::text),
      nullif(btrim(coalesce(v_team.vehicle_plate::text, '')), ''),
      nullif(btrim(coalesce(v_foreman.nome::text, '')), ''),
      'NOT_WORKING',
      btrim(p_sector),
      v_resolved_yard,
      p_start_time,
      nullif(btrim(coalesce(p_notes, '')), ''),
      true,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at into v_composition_id, v_updated_at;
  else
    update public.team_compositions
    set
      composition_date = p_composition_date,
      project_id = null,
      team_id = p_team_id,
      project_code_snapshot = null,
      project_service_center_snapshot = null,
      team_name_snapshot = btrim(v_team.name::text),
      vehicle_plate_snapshot = nullif(btrim(coalesce(v_team.vehicle_plate::text, '')), ''),
      foreman_name_snapshot = nullif(btrim(coalesce(v_foreman.nome::text, '')), ''),
      work_status = 'NOT_WORKING',
      sector = btrim(p_sector),
      yard = v_resolved_yard,
      start_time = p_start_time,
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      is_active = true,
      updated_by = p_actor_user_id
    where tenant_id = p_tenant_id
      and id = p_composition_id
    returning id, updated_at into v_composition_id, v_updated_at;

    delete from public.team_composition_members
    where tenant_id = p_tenant_id
      and composition_id = v_composition_id;
  end if;

  insert into public.team_composition_members (
    tenant_id,
    composition_id,
    person_id,
    person_name_snapshot,
    matriculation_snapshot,
    cpf_snapshot,
    phone_snapshot,
    job_title_snapshot,
    is_present,
    sort_order,
    created_by,
    updated_by
  )
  values (
    p_tenant_id,
    v_composition_id,
    v_foreman.id,
    btrim(v_foreman.nome::text),
    nullif(btrim(coalesce(v_foreman.matriculation::text, '')), ''),
    nullif(btrim(coalesce(v_foreman.cpf::text, '')), ''),
    nullif(btrim(coalesce(v_foreman.phone::text, '')), ''),
    nullif(btrim(coalesce(v_foreman.job_title_name::text, '')), ''),
    false,
    1,
    p_actor_user_id,
    p_actor_user_id
  );

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'composition_id', v_composition_id,
    'updated_at', v_updated_at,
    'work_status', 'NOT_WORKING',
    'message', case
      when p_composition_id is null then 'Composicao cadastrada com sucesso.'
      else 'Composicao atualizada com sucesso.'
    end
  );
exception
  when unique_violation then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_CONTEXT',
      'message', 'Ja existe composicao ativa para esta Equipe e Data.'
    );
end;
$$;

revoke all on function public.save_team_composition_record(
  uuid, uuid, uuid, date, uuid, uuid, text, time, text, jsonb, text, timestamptz, text
) from public;
revoke all on function public.save_team_composition_record(
  uuid, uuid, uuid, date, uuid, uuid, text, time, text, jsonb, text, timestamptz, text
) from anon;
revoke all on function public.save_team_composition_record(
  uuid, uuid, uuid, date, uuid, uuid, text, time, text, jsonb, text, timestamptz, text
) from authenticated;
grant execute on function public.save_team_composition_record(
  uuid, uuid, uuid, date, uuid, uuid, text, time, text, jsonb, text, timestamptz, text
) to service_role;

notify pgrst, 'reload schema';

commit;
