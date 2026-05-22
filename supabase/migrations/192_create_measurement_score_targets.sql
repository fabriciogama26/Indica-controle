-- 192_create_measurement_score_targets.sql
-- Metas de pontuacao para exportacao da Medicao por tipo de equipe.

create table if not exists public.measurement_score_targets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  team_type_id uuid not null,
  target_points numeric(12, 2) not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  unique (tenant_id, team_type_id)
);

alter table if exists public.measurement_score_targets
  drop constraint if exists chk_measurement_score_targets_points;

alter table if exists public.measurement_score_targets
  add constraint chk_measurement_score_targets_points
  check (target_points >= 0);

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'measurement_score_targets'
      and tc.constraint_name = 'measurement_score_targets_tenant_id_fk'
  ) then
    alter table public.measurement_score_targets
      add constraint measurement_score_targets_tenant_id_fk
      foreign key (tenant_id) references public.tenants(id);
  end if;

  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'measurement_score_targets'
      and tc.constraint_name = 'measurement_score_targets_team_type_tenant_fk'
  ) then
    alter table public.measurement_score_targets
      add constraint measurement_score_targets_team_type_tenant_fk
      foreign key (team_type_id, tenant_id)
      references public.team_types(id, tenant_id);
  end if;
end;
$$;

create index if not exists idx_measurement_score_targets_tenant
  on public.measurement_score_targets (tenant_id, ativo, team_type_id);

alter table if exists public.measurement_score_targets enable row level security;

drop policy if exists measurement_score_targets_tenant_select on public.measurement_score_targets;
create policy measurement_score_targets_tenant_select on public.measurement_score_targets
for select
to authenticated
using (public.user_can_access_tenant(measurement_score_targets.tenant_id));

drop policy if exists measurement_score_targets_tenant_insert on public.measurement_score_targets;
create policy measurement_score_targets_tenant_insert on public.measurement_score_targets
for insert
to authenticated
with check (public.user_can_access_tenant(measurement_score_targets.tenant_id));

drop policy if exists measurement_score_targets_tenant_update on public.measurement_score_targets;
create policy measurement_score_targets_tenant_update on public.measurement_score_targets
for update
to authenticated
using (public.user_can_access_tenant(measurement_score_targets.tenant_id))
with check (public.user_can_access_tenant(measurement_score_targets.tenant_id));

drop trigger if exists trg_measurement_score_targets_audit on public.measurement_score_targets;
create trigger trg_measurement_score_targets_audit before insert or update on public.measurement_score_targets
for each row execute function public.apply_audit_fields();

insert into public.measurement_score_targets (tenant_id, team_type_id, target_points)
select
  tt.tenant_id,
  tt.id,
  case
    when upper(btrim(tt.name)) in ('LV', 'LINHA VIVA') then 28.52
    when upper(btrim(tt.name)) in ('MK', 'LM', 'LINHA MORTA', 'CESTO', 'CETO') then 50.17
    else 0
  end as target_points
from public.team_types tt
where upper(btrim(tt.name)) in ('MK', 'LM', 'LINHA MORTA', 'LV', 'LINHA VIVA', 'CESTO', 'CETO')
on conflict (tenant_id, team_type_id) do nothing;
