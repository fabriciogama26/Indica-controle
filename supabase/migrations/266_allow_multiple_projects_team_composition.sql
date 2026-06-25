-- 266_allow_multiple_projects_team_composition.sql
-- Permite vincular mais de um projeto a uma mesma Composicao de Equipe.

begin;

create table if not exists public.team_composition_projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  composition_id uuid not null,
  project_id uuid not null,
  project_code_snapshot text not null,
  project_service_center_snapshot text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint team_composition_projects_code_not_blank check (btrim(project_code_snapshot) <> '')
);

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'team_composition_projects'
      and tc.constraint_name = 'team_composition_projects_tenant_id_fk'
  ) then
    alter table public.team_composition_projects
      add constraint team_composition_projects_tenant_id_fk
      foreign key (tenant_id) references public.tenants(id);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'team_composition_projects'
      and tc.constraint_name = 'team_composition_projects_composition_tenant_fk'
  ) then
    alter table public.team_composition_projects
      add constraint team_composition_projects_composition_tenant_fk
      foreign key (composition_id, tenant_id)
      references public.team_compositions(id, tenant_id)
      on delete cascade;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'team_composition_projects'
      and tc.constraint_name = 'team_composition_projects_project_tenant_fk'
  ) then
    alter table public.team_composition_projects
      add constraint team_composition_projects_project_tenant_fk
      foreign key (project_id, tenant_id)
      references public.project(id, tenant_id);
  end if;
end;
$$;

create unique index if not exists ux_team_composition_projects_project
  on public.team_composition_projects (tenant_id, composition_id, project_id);

create index if not exists idx_team_composition_projects_tenant_project
  on public.team_composition_projects (tenant_id, project_id, composition_id);

create index if not exists idx_team_composition_projects_tenant_composition
  on public.team_composition_projects (tenant_id, composition_id, sort_order);

alter table public.team_composition_projects enable row level security;

drop policy if exists team_composition_projects_tenant_select on public.team_composition_projects;
create policy team_composition_projects_tenant_select on public.team_composition_projects
for select
to authenticated
using (public.user_can_access_tenant(team_composition_projects.tenant_id));

drop policy if exists team_composition_projects_tenant_insert on public.team_composition_projects;
create policy team_composition_projects_tenant_insert on public.team_composition_projects
for insert
to authenticated
with check (public.user_can_access_tenant(team_composition_projects.tenant_id));

drop policy if exists team_composition_projects_tenant_update on public.team_composition_projects;
create policy team_composition_projects_tenant_update on public.team_composition_projects
for update
to authenticated
using (public.user_can_access_tenant(team_composition_projects.tenant_id))
with check (public.user_can_access_tenant(team_composition_projects.tenant_id));

drop trigger if exists trg_team_composition_projects_audit on public.team_composition_projects;
create trigger trg_team_composition_projects_audit before insert or update on public.team_composition_projects
for each row execute function public.apply_audit_fields();

insert into public.team_composition_projects (
  tenant_id,
  composition_id,
  project_id,
  project_code_snapshot,
  project_service_center_snapshot,
  sort_order,
  created_at,
  updated_at,
  created_by,
  updated_by
)
select
  tc.tenant_id,
  tc.id,
  tc.project_id,
  coalesce(nullif(btrim(tc.project_code_snapshot), ''), btrim(p.sob::text)),
  coalesce(nullif(btrim(tc.project_service_center_snapshot), ''), nullif(btrim(pwl.service_center_text::text), '')),
  1,
  tc.created_at,
  tc.updated_at,
  tc.created_by,
  tc.updated_by
from public.team_compositions tc
join public.project p
  on p.tenant_id = tc.tenant_id
 and p.id = tc.project_id
left join public.project_with_labels pwl
  on pwl.tenant_id = tc.tenant_id
 and pwl.id = tc.project_id
where tc.project_id is not null
on conflict (tenant_id, composition_id, project_id) do nothing;

create or replace function public.save_team_composition_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_composition_id uuid,
  p_composition_date date,
  p_project_id uuid,
  p_project_ids jsonb,
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
  v_composition_id uuid;
  v_updated_at timestamptz;
  v_member_count integer := 0;
  v_valid_member_count integer := 0;
  v_distinct_person_count integer := 0;
  v_duplicate_matriculation text;
  v_duplicate_people text;
  v_foreman_count integer := 0;
  v_project_payload jsonb;
  v_project_count integer := 0;
  v_valid_project_count integer := 0;
  v_distinct_project_count integer := 0;
  v_primary_project_id uuid;
  v_project_codes text;
  v_project_centers text;
begin
  if v_work_status not in ('WORKING', 'NOT_WORKING') then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_WORK_STATUS',
      'message', 'Situacao da equipe invalida.'
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

  if p_composition_date is null
    or p_team_id is null
    or nullif(btrim(coalesce(p_sector, '')), '') is null
    or p_start_time is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_REQUIRED_FIELDS',
      'message', 'Campos obrigatorios pendentes para salvar composicao.'
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

  v_resolved_yard := nullif(btrim(coalesce(v_team.service_center_name, p_yard, '')), '');

  if v_resolved_yard is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_TEAM_SERVICE_CENTER',
      'message', 'Campos obrigatorios pendentes: Patio/Centro de Servico da equipe.'
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

  if v_work_status = 'NOT_WORKING' then
    if p_project_id is not null
      or (
        p_project_ids is not null
        and (
          jsonb_typeof(p_project_ids) <> 'array'
          or jsonb_array_length(p_project_ids) > 0
        )
      ) then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'PROJECT_NOT_ALLOWED',
        'message', 'Projeto nao deve ser informado quando a equipe nao atuou.'
      );
    end if;

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

      delete from public.team_composition_projects
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
  end if;

  v_project_payload := case
    when p_project_ids is not null and jsonb_typeof(p_project_ids) = 'array' then p_project_ids
    when p_project_id is not null then jsonb_build_array(p_project_id::text)
    else '[]'::jsonb
  end;

  if p_project_ids is not null and jsonb_typeof(p_project_ids) <> 'array' then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_PROJECT_LIST',
      'message', 'Lista de projetos invalida.'
    );
  end if;

  select count(*)
    into v_project_count
  from jsonb_array_elements(v_project_payload);

  if v_project_count = 0 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'PROJECT_REQUIRED',
      'message', 'Campos obrigatorios pendentes: Projeto.'
    );
  end if;

  with input_projects as (
    select
      row_number() over () as sort_order,
      case
        when item.value #>> '{}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then (item.value #>> '{}')::uuid
        else null
      end as project_id
    from jsonb_array_elements(v_project_payload) as item(value)
  )
  select
    count(project_id),
    count(distinct project_id)
    into v_valid_project_count, v_distinct_project_count
  from input_projects;

  if v_valid_project_count <> v_project_count then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_PROJECT',
      'message', 'Um ou mais projetos da composicao sao invalidos.'
    );
  end if;

  if v_distinct_project_count <> v_project_count then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'DUPLICATE_PROJECT',
      'message', 'O mesmo projeto nao pode aparecer duas vezes na composicao.'
    );
  end if;

  with input_projects as (
    select
      row_number() over () as sort_order,
      (item.value #>> '{}')::uuid as project_id
    from jsonb_array_elements(v_project_payload) as item(value)
  ),
  project_data as (
    select
      ip.sort_order,
      p.id,
      btrim(p.sob::text) as sob,
      nullif(btrim(coalesce(p.service_center_text::text, '')), '') as service_center_text
    from input_projects ip
    join public.project_with_labels p
      on p.tenant_id = p_tenant_id
     and p.id = ip.project_id
     and p.is_active = true
  )
  select
    count(*),
    (array_agg(id order by sort_order))[1],
    string_agg(sob, ', ' order by sort_order),
    string_agg(service_center_text, ', ' order by sort_order)
    into v_valid_project_count, v_primary_project_id, v_project_codes, v_project_centers
  from project_data;

  if v_valid_project_count <> v_project_count then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'INVALID_PROJECT_TENANT',
      'message', 'Um ou mais projetos sao invalidos ou inativos para o tenant atual.'
    );
  end if;

  select count(*)
    into v_member_count
  from jsonb_array_elements(p_members);

  if p_members is null or jsonb_typeof(p_members) <> 'array' or v_member_count = 0 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_REQUIRED_FIELDS',
      'message', 'Campos obrigatorios pendentes: Ao menos uma pessoa.'
    );
  end if;

  with input_members as (
    select
      row_number() over () as sort_order,
      case
        when (item.value ->> 'personId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then (item.value ->> 'personId')::uuid
        else null
      end as person_id,
      coalesce((item.value ->> 'isPresent')::boolean, true) as is_present
    from jsonb_array_elements(p_members) as item(value)
  )
  select
    count(person_id),
    count(distinct person_id)
    into v_valid_member_count, v_distinct_person_count
  from input_members;

  if v_valid_member_count <> v_member_count then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_MEMBER', 'message', 'Uma ou mais pessoas da composicao sao invalidas.');
  end if;

  if v_distinct_person_count <> v_member_count then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'DUPLICATE_PERSON', 'message', 'A mesma pessoa nao pode aparecer duas vezes na composicao.');
  end if;

  with input_members as (
    select
      row_number() over () as sort_order,
      (item.value ->> 'personId')::uuid as person_id,
      coalesce((item.value ->> 'isPresent')::boolean, true) as is_present
    from jsonb_array_elements(p_members) as item(value)
  ),
  people_data as (
    select
      im.person_id,
      p.nome,
      p.matriculation::text as matriculation,
      jt.name as job_title_name
    from input_members im
    join public.people p
      on p.tenant_id = p_tenant_id
     and p.id = im.person_id
     and p.ativo = true
    left join public.job_titles jt
      on jt.tenant_id = p.tenant_id
     and jt.id = p.job_title_id
  ),
  duplicates as (
    select upper(btrim(coalesce(matriculation::text, ''))) as matriculation
    from people_data
    where nullif(btrim(coalesce(matriculation::text, '')), '') is not null
    group by upper(btrim(coalesce(matriculation::text, '')))
    having count(*) > 1
  ),
  foremen as (
    select count(*) as total
    from people_data
    where upper(coalesce(job_title_name, '')) like '%ENCARREGADO%'
  )
  select
    (select count(*) from people_data),
    (select matriculation from duplicates limit 1),
    (select total from foremen)
    into v_valid_member_count, v_duplicate_matriculation, v_foreman_count;

  if v_valid_member_count <> v_member_count then
    return jsonb_build_object('success', false, 'status', 422, 'reason', 'INVALID_MEMBER_TENANT', 'message', 'Uma ou mais pessoas estao inativas ou nao pertencem ao tenant atual.');
  end if;

  if v_duplicate_matriculation is not null then
    select string_agg(nome, ' / ')
      into v_duplicate_people
    from public.people
    where tenant_id = p_tenant_id
      and upper(btrim(coalesce(matriculation::text, ''))) = v_duplicate_matriculation;

    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'DUPLICATE_MATRICULATION',
      'message', 'Matricula duplicada na composicao: ' || v_duplicate_matriculation || coalesce(' (' || v_duplicate_people || ')', '') || '.'
    );
  end if;

  if coalesce(v_foreman_count, 0) > 1 then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'MULTIPLE_FOREMEN', 'message', 'A composicao nao pode conter mais de um encarregado.');
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
      v_primary_project_id,
      p_team_id,
      v_project_codes,
      v_project_centers,
      btrim(v_team.name::text),
      nullif(btrim(coalesce(v_team.vehicle_plate::text, '')), ''),
      nullif(btrim(coalesce(v_foreman.nome::text, '')), ''),
      'WORKING',
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
      project_id = v_primary_project_id,
      team_id = p_team_id,
      project_code_snapshot = v_project_codes,
      project_service_center_snapshot = v_project_centers,
      team_name_snapshot = btrim(v_team.name::text),
      vehicle_plate_snapshot = nullif(btrim(coalesce(v_team.vehicle_plate::text, '')), ''),
      foreman_name_snapshot = nullif(btrim(coalesce(v_foreman.nome::text, '')), ''),
      work_status = 'WORKING',
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

    delete from public.team_composition_projects
    where tenant_id = p_tenant_id
      and composition_id = v_composition_id;
  end if;

  insert into public.team_composition_projects (
    tenant_id,
    composition_id,
    project_id,
    project_code_snapshot,
    project_service_center_snapshot,
    sort_order,
    created_by,
    updated_by
  )
  with input_projects as (
    select
      row_number() over () as sort_order,
      (item.value #>> '{}')::uuid as project_id
    from jsonb_array_elements(v_project_payload) as item(value)
  )
  select
    p_tenant_id,
    v_composition_id,
    p.id,
    btrim(p.sob::text),
    nullif(btrim(coalesce(p.service_center_text::text, '')), ''),
    ip.sort_order,
    p_actor_user_id,
    p_actor_user_id
  from input_projects ip
  join public.project_with_labels p
    on p.tenant_id = p_tenant_id
   and p.id = ip.project_id
   and p.is_active = true
  order by ip.sort_order;

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
  with input_members as (
    select
      row_number() over () as sort_order,
      (item.value ->> 'personId')::uuid as person_id,
      coalesce((item.value ->> 'isPresent')::boolean, true) as is_present
    from jsonb_array_elements(p_members) as item(value)
  )
  select
    p_tenant_id,
    v_composition_id,
    p.id,
    btrim(p.nome),
    nullif(btrim(coalesce(p.matriculation::text, '')), ''),
    nullif(btrim(coalesce(p.cpf::text, '')), ''),
    nullif(btrim(coalesce(v_foreman.phone::text, '')), ''),
    nullif(btrim(coalesce(jt.name, '')), ''),
    im.is_present,
    im.sort_order,
    p_actor_user_id,
    p_actor_user_id
  from input_members im
  join public.people p
    on p.tenant_id = p_tenant_id
   and p.id = im.person_id
   and p.ativo = true
  left join public.job_titles jt
    on jt.tenant_id = p.tenant_id
   and jt.id = p.job_title_id
  order by im.sort_order;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'composition_id', v_composition_id,
    'updated_at', v_updated_at,
    'work_status', 'WORKING',
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
      'message', 'Ja existe composicao ativa para esta Equipe, Data e Projeto principal.'
    );
end;
$$;

revoke all on function public.save_team_composition_record(
  uuid, uuid, uuid, date, uuid, jsonb, uuid, text, time, text, jsonb, text, timestamptz, text
) from public;
revoke all on function public.save_team_composition_record(
  uuid, uuid, uuid, date, uuid, jsonb, uuid, text, time, text, jsonb, text, timestamptz, text
) from anon;
revoke all on function public.save_team_composition_record(
  uuid, uuid, uuid, date, uuid, jsonb, uuid, text, time, text, jsonb, text, timestamptz, text
) from authenticated;
grant execute on function public.save_team_composition_record(
  uuid, uuid, uuid, date, uuid, jsonb, uuid, text, time, text, jsonb, text, timestamptz, text
) to service_role;

notify pgrst, 'reload schema';

commit;
