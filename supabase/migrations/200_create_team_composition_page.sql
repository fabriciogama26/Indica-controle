-- 200_create_team_composition_page.sql
-- Cria a tela Composicao de Equipe com persistencia multi-tenant e permissoes.

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'project'
      and tc.constraint_name = 'project_id_tenant_key'
  ) then
    alter table public.project
      add constraint project_id_tenant_key
      unique (id, tenant_id);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'teams'
      and tc.constraint_name = 'teams_id_tenant_key'
  ) then
    alter table public.teams
      add constraint teams_id_tenant_key
      unique (id, tenant_id);
  end if;
end;
$$;

create table if not exists public.team_compositions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  composition_date date not null,
  project_id uuid not null,
  team_id uuid not null,
  project_code_snapshot text not null,
  project_service_center_snapshot text,
  team_name_snapshot text not null,
  vehicle_plate_snapshot text,
  foreman_name_snapshot text,
  sector text not null default 'OBRA',
  yard text,
  start_time time not null default '07:30',
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint team_compositions_project_code_not_blank check (btrim(project_code_snapshot) <> ''),
  constraint team_compositions_team_name_not_blank check (btrim(team_name_snapshot) <> ''),
  constraint team_compositions_sector_not_blank check (btrim(sector) <> ''),
  constraint team_compositions_start_time_not_null check (start_time is not null)
);

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'team_compositions'
      and tc.constraint_name = 'team_compositions_tenant_id_fk'
  ) then
    alter table public.team_compositions
      add constraint team_compositions_tenant_id_fk
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
      and tc.table_name = 'team_compositions'
      and tc.constraint_name = 'team_compositions_project_tenant_fk'
  ) then
    alter table public.team_compositions
      add constraint team_compositions_project_tenant_fk
      foreign key (project_id, tenant_id)
      references public.project(id, tenant_id);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'team_compositions'
      and tc.constraint_name = 'team_compositions_team_tenant_fk'
  ) then
    alter table public.team_compositions
      add constraint team_compositions_team_tenant_fk
      foreign key (team_id, tenant_id)
      references public.teams(id, tenant_id);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'team_compositions'
      and tc.constraint_name = 'team_compositions_id_tenant_key'
  ) then
    alter table public.team_compositions
      add constraint team_compositions_id_tenant_key
      unique (id, tenant_id);
  end if;
end;
$$;

create unique index if not exists ux_team_compositions_context_active
  on public.team_compositions (tenant_id, composition_date, project_id, team_id)
  where is_active = true;

create index if not exists idx_team_compositions_tenant_date
  on public.team_compositions (tenant_id, composition_date desc, project_id, team_id);

create index if not exists idx_team_compositions_tenant_team
  on public.team_compositions (tenant_id, team_id, composition_date desc);

create table if not exists public.team_composition_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  composition_id uuid not null,
  person_id uuid not null,
  person_name_snapshot text not null,
  matriculation_snapshot text,
  cpf_snapshot text,
  phone_snapshot text,
  job_title_snapshot text,
  is_present boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint team_composition_members_name_not_blank check (btrim(person_name_snapshot) <> '')
);

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'team_composition_members'
      and tc.constraint_name = 'team_composition_members_tenant_id_fk'
  ) then
    alter table public.team_composition_members
      add constraint team_composition_members_tenant_id_fk
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
      and tc.table_name = 'team_composition_members'
      and tc.constraint_name = 'team_composition_members_composition_tenant_fk'
  ) then
    alter table public.team_composition_members
      add constraint team_composition_members_composition_tenant_fk
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
      and tc.table_name = 'team_composition_members'
      and tc.constraint_name = 'team_composition_members_composition_fk'
  ) then
    alter table public.team_composition_members
      add constraint team_composition_members_composition_fk
      foreign key (composition_id)
      references public.team_compositions(id)
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
      and tc.table_name = 'team_composition_members'
      and tc.constraint_name = 'team_composition_members_person_tenant_fk'
  ) then
    alter table public.team_composition_members
      add constraint team_composition_members_person_tenant_fk
      foreign key (person_id, tenant_id)
      references public.people(id, tenant_id);
  end if;
end;
$$;

create unique index if not exists ux_team_composition_members_person
  on public.team_composition_members (tenant_id, composition_id, person_id);

create index if not exists idx_team_composition_members_tenant_composition
  on public.team_composition_members (tenant_id, composition_id, sort_order);

alter table if exists public.team_compositions enable row level security;
alter table if exists public.team_composition_members enable row level security;

drop policy if exists team_compositions_tenant_select on public.team_compositions;
create policy team_compositions_tenant_select on public.team_compositions
for select
to authenticated
using (public.user_can_access_tenant(team_compositions.tenant_id));

drop policy if exists team_compositions_tenant_write on public.team_compositions;
create policy team_compositions_tenant_write on public.team_compositions
for all
to authenticated
using (public.user_can_access_tenant(team_compositions.tenant_id))
with check (public.user_can_access_tenant(team_compositions.tenant_id));

drop policy if exists team_composition_members_tenant_select on public.team_composition_members;
create policy team_composition_members_tenant_select on public.team_composition_members
for select
to authenticated
using (public.user_can_access_tenant(team_composition_members.tenant_id));

drop policy if exists team_composition_members_tenant_write on public.team_composition_members;
create policy team_composition_members_tenant_write on public.team_composition_members
for all
to authenticated
using (public.user_can_access_tenant(team_composition_members.tenant_id))
with check (public.user_can_access_tenant(team_composition_members.tenant_id));

drop trigger if exists trg_team_compositions_audit on public.team_compositions;
create trigger trg_team_compositions_audit before insert or update on public.team_compositions
for each row execute function public.apply_audit_fields();

drop trigger if exists trg_team_composition_members_audit on public.team_composition_members;
create trigger trg_team_composition_members_audit before insert or update on public.team_composition_members
for each row execute function public.apply_audit_fields();

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
  p_expected_updated_at timestamptz default null,
  p_yard text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_missing_fields text[] := '{}';
  v_current public.team_compositions%rowtype;
  v_project record;
  v_team record;
  v_foreman_name text;
  v_foreman_phone text;
  v_composition_id uuid;
  v_updated_at timestamptz;
  v_member_count integer := 0;
  v_valid_member_count integer := 0;
  v_distinct_person_count integer := 0;
  v_duplicate_matriculation text;
  v_duplicate_people text;
  v_foreman_count integer := 0;
  v_yard text;
begin
  if p_composition_date is null then
    v_missing_fields := array_append(v_missing_fields, 'Data');
  end if;
  if p_project_id is null then
    v_missing_fields := array_append(v_missing_fields, 'Projeto');
  end if;
  if p_team_id is null then
    v_missing_fields := array_append(v_missing_fields, 'Equipe');
  end if;
  if nullif(btrim(coalesce(p_sector, '')), '') is null then
    v_missing_fields := array_append(v_missing_fields, 'Setor');
  end if;
  if p_start_time is null then
    v_missing_fields := array_append(v_missing_fields, 'Hora inicial');
  end if;
  if p_members is null or jsonb_typeof(p_members) <> 'array' or jsonb_array_length(p_members) = 0 then
    v_missing_fields := array_append(v_missing_fields, 'Ao menos uma pessoa');
  end if;

  if array_length(v_missing_fields, 1) is not null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_REQUIRED_FIELDS',
      'message', 'Campos obrigatorios pendentes: ' || array_to_string(v_missing_fields, ', ') || '.'
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
      return jsonb_build_object('success', false, 'status', 404, 'reason', 'NOT_FOUND', 'message', 'Composicao nao encontrada.');
    end if;

    if p_expected_updated_at is not null and v_current.updated_at is distinct from p_expected_updated_at then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'CONCURRENT_MODIFICATION',
        'message', 'A composicao foi alterada por outro usuario. Recarregue antes de salvar novamente.'
      );
    end if;
  end if;

  select
    p.id,
    p.sob,
    p.service_center_text
    into v_project
  from public.project_with_labels p
  where p.tenant_id = p_tenant_id
    and p.id = p_project_id
    and p.is_active = true
  limit 1;

  if v_project.id is null then
    return jsonb_build_object('success', false, 'status', 422, 'reason', 'INVALID_PROJECT', 'message', 'Projeto invalido ou inativo para o tenant atual.');
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
    return jsonb_build_object('success', false, 'status', 422, 'reason', 'INVALID_TEAM', 'message', 'Equipe invalida ou inativa para o tenant atual.');
  end if;

  v_yard := nullif(btrim(coalesce(v_team.service_center_name, p_yard, '')), '');

  if v_yard is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_TEAM_SERVICE_CENTER',
      'message', 'Campos obrigatorios pendentes: Patio/Centro de Servico da equipe.'
    );
  end if;

  select count(*)
    into v_member_count
  from jsonb_array_elements(p_members);

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

  select p.nome, p.phone::text
    into v_foreman_name, v_foreman_phone
  from public.people p
  where p.tenant_id = p_tenant_id
    and p.id = v_team.foreman_person_id
  limit 1;

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
      p_project_id,
      p_team_id,
      btrim(v_project.sob::text),
      nullif(btrim(coalesce(v_project.service_center_text::text, '')), ''),
      btrim(v_team.name::text),
      nullif(btrim(coalesce(v_team.vehicle_plate::text, '')), ''),
      nullif(btrim(coalesce(v_foreman_name, '')), ''),
      btrim(p_sector),
      v_yard,
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
      project_id = p_project_id,
      team_id = p_team_id,
      project_code_snapshot = btrim(v_project.sob::text),
      project_service_center_snapshot = nullif(btrim(coalesce(v_project.service_center_text::text, '')), ''),
      team_name_snapshot = btrim(v_team.name::text),
      vehicle_plate_snapshot = nullif(btrim(coalesce(v_team.vehicle_plate::text, '')), ''),
      foreman_name_snapshot = nullif(btrim(coalesce(v_foreman_name, '')), ''),
      sector = btrim(p_sector),
      yard = v_yard,
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
    nullif(btrim(coalesce(v_foreman_phone, '')), ''),
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
    'message', case
      when p_composition_id is null then 'Composicao cadastrada com sucesso.'
      else 'Composicao atualizada com sucesso.'
    end
  );
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'DUPLICATE_CONTEXT', 'message', 'Ja existe composicao ativa para este Projeto, Equipe e Data.');
end;
$$;

insert into public.app_pages (page_key, path, name, section, description)
values
  (
    'composicao-equipe',
    '/composicao-equipe',
    'Composicao de Equipe',
    'Operacao',
    'Cadastro da composicao diaria de equipe por projeto e pessoas.'
  )
on conflict (page_key) do update
set
  path = excluded.path,
  name = excluded.name,
  section = excluded.section,
  description = excluded.description,
  ativo = true,
  updated_at = now();

insert into public.role_page_permissions (tenant_id, role_id, page_key, can_access)
select
  tenants.tenant_id,
  roles.id,
  pages.page_key,
  case
    when roles.role_key = 'viewer' then false
    else true
  end as can_access
from (
  select distinct tenant_id
  from public.app_users
  where tenant_id is not null
) as tenants
join public.app_roles as roles
  on roles.ativo = true
 and roles.role_key in ('master', 'admin', 'supervisor', 'user', 'viewer')
join public.app_pages as pages
  on pages.ativo = true
 and pages.page_key = 'composicao-equipe'
on conflict (tenant_id, role_id, page_key) do update
set
  can_access = excluded.can_access,
  updated_at = now();

with target_pages as (
  select page_key
  from public.app_pages
  where ativo = true
    and page_key = 'composicao-equipe'
),
target_users as (
  select
    au.id as user_id,
    au.tenant_id,
    au.role_id,
    coalesce(ar.role_key, 'user') as role_key
  from public.app_users au
  left join public.app_roles ar
    on ar.id = au.role_id
  where au.tenant_id is not null
    and exists (
      select 1
      from public.app_user_page_permissions upp
      where upp.tenant_id = au.tenant_id
        and upp.user_id = au.id
    )
)
insert into public.app_user_page_permissions (
  tenant_id,
  user_id,
  page_key,
  can_access,
  created_by,
  updated_by
)
select
  tu.tenant_id,
  tu.user_id,
  tp.page_key,
  coalesce(
    rpp.can_access,
    case
      when tu.role_key = 'viewer' then false
      else true
    end
  ) as can_access,
  null,
  null
from target_users tu
cross join target_pages tp
left join public.app_user_page_permissions existing
  on existing.tenant_id = tu.tenant_id
 and existing.user_id = tu.user_id
 and existing.page_key = tp.page_key
left join public.role_page_permissions rpp
  on rpp.tenant_id = tu.tenant_id
 and rpp.role_id = tu.role_id
 and rpp.page_key = tp.page_key
where existing.user_id is null
on conflict (tenant_id, user_id, page_key) do nothing;
