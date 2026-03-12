
-- 052_create_teams_and_page_permissions.sql
-- Cria tabela de equipes por tenant e inclui pagina Equipes na matriz de permissao.

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  vehicle_plate text not null,
  foreman_person_id uuid not null,
  ativo boolean not null default true,
  cancellation_reason text,
  canceled_at timestamptz,
  canceled_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  unique (tenant_id, name),
  unique (tenant_id, vehicle_plate)
);

alter table if exists public.teams
  drop constraint if exists chk_teams_name_not_blank;

alter table if exists public.teams
  add constraint chk_teams_name_not_blank
  check (btrim(name) <> '');

alter table if exists public.teams
  drop constraint if exists chk_teams_vehicle_plate_not_blank;

alter table if exists public.teams
  add constraint chk_teams_vehicle_plate_not_blank
  check (btrim(vehicle_plate) <> '');

alter table if exists public.teams
  drop constraint if exists teams_active_cancellation_consistency_check;

alter table if exists public.teams
  add constraint teams_active_cancellation_consistency_check
  check (
    (ativo = true and canceled_at is null and cancellation_reason is null)
    or (
      ativo = false
      and canceled_at is not null
      and nullif(btrim(coalesce(cancellation_reason, '')), '') is not null
    )
  );

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'people'
      and tc.constraint_name = 'people_id_tenant_key'
  ) then
    alter table public.people
      add constraint people_id_tenant_key
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
      and tc.constraint_name = 'teams_tenant_id_fk'
  ) then
    alter table public.teams
      add constraint teams_tenant_id_fk
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
      and tc.table_name = 'teams'
      and tc.constraint_name = 'teams_foreman_person_tenant_fk'
  ) then
    alter table public.teams
      add constraint teams_foreman_person_tenant_fk
      foreign key (foreman_person_id, tenant_id)
      references public.people(id, tenant_id);
  end if;
end;
$$;

create index if not exists idx_teams_tenant_active_name
  on public.teams (tenant_id, ativo, name);

create index if not exists idx_teams_tenant_vehicle_plate
  on public.teams (tenant_id, vehicle_plate, ativo);

create index if not exists idx_teams_tenant_foreman
  on public.teams (tenant_id, foreman_person_id, ativo, name);

alter table if exists public.teams enable row level security;

drop policy if exists teams_tenant_select on public.teams;
create policy teams_tenant_select on public.teams
for select
to authenticated
using (public.user_can_access_tenant(teams.tenant_id));

drop policy if exists teams_tenant_write on public.teams;
create policy teams_tenant_write on public.teams
for all
to authenticated
using (public.user_can_access_tenant(teams.tenant_id))
with check (public.user_can_access_tenant(teams.tenant_id));

drop trigger if exists trg_teams_audit on public.teams;
create trigger trg_teams_audit before insert or update on public.teams
for each row execute function public.apply_audit_fields();

insert into public.app_pages (page_key, path, name, section, description)
values
  ('equipes', '/equipes', 'Equipes', 'Cadastros', 'Cadastro de equipes com placa e encarregado por tenant.')
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
 and pages.page_key = 'equipes'
on conflict (tenant_id, role_id, page_key) do update
set
  can_access = excluded.can_access,
  updated_at = now();

with target_pages as (
  select page_key
  from public.app_pages
  where ativo = true
    and page_key = 'equipes'
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
