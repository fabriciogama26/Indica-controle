-- 057_add_team_type_to_service_activities.sql
-- Vincula atividades ao tipo de equipe (team_types) por tenant.

alter table if exists public.service_activities
  add column if not exists team_type_id uuid;

with tenant_sources as (
  select distinct sa.tenant_id
  from public.service_activities sa
  where sa.tenant_id is not null
  union
  select distinct au.tenant_id
  from public.app_users au
  where au.tenant_id is not null
)
insert into public.team_types (tenant_id, name, ativo)
select tenant_id, 'PADRAO', true
from tenant_sources
on conflict (tenant_id, name) do update
set
  ativo = true,
  updated_at = now();

update public.service_activities sa
set team_type_id = tt.id
from public.team_types tt
where sa.team_type_id is null
  and tt.tenant_id = sa.tenant_id
  and upper(btrim(tt.name)) = 'PADRAO';

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'service_activities'
      and tc.constraint_name = 'service_activities_team_type_tenant_fk'
  ) then
    alter table public.service_activities
      add constraint service_activities_team_type_tenant_fk
      foreign key (team_type_id, tenant_id)
      references public.team_types(id, tenant_id);
  end if;
end;
$$;

alter table if exists public.service_activities
  alter column team_type_id set not null;

create index if not exists idx_service_activities_tenant_team_type
  on public.service_activities (tenant_id, team_type_id, ativo, code);
