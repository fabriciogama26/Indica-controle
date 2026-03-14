-- 059_create_location_planning.sql
-- Estrutura do modulo de Locacao por projeto, com snapshot proprio de materiais e atividades.

create table if not exists public.project_location_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  project_id uuid not null references public.project(id) on delete cascade,
  questionnaire_answers jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  unique (tenant_id, project_id),
  constraint project_location_plans_questionnaire_object_check
    check (jsonb_typeof(questionnaire_answers) = 'object')
);

create index if not exists idx_project_location_plans_tenant_project
  on public.project_location_plans (tenant_id, project_id);

alter table if exists public.project_location_plans enable row level security;

drop policy if exists project_location_plans_tenant_select on public.project_location_plans;
create policy project_location_plans_tenant_select on public.project_location_plans
for select
to authenticated
using (public.user_can_access_tenant(project_location_plans.tenant_id));

drop policy if exists project_location_plans_tenant_write on public.project_location_plans;
create policy project_location_plans_tenant_write on public.project_location_plans
for all
to authenticated
using (public.user_can_access_tenant(project_location_plans.tenant_id))
with check (public.user_can_access_tenant(project_location_plans.tenant_id));

drop trigger if exists trg_project_location_plans_audit on public.project_location_plans;
create trigger trg_project_location_plans_audit before insert or update on public.project_location_plans
for each row execute function public.apply_audit_fields();

create table if not exists public.project_location_materials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  location_plan_id uuid not null references public.project_location_plans(id) on delete cascade,
  project_forecast_item_id uuid references public.project_material_forecast(id) on delete set null,
  material_id uuid not null references public.materials(id),
  source_type text not null default 'PROJECT_FORECAST',
  material_code text not null,
  material_description text not null,
  material_umb text,
  material_type text,
  original_qty numeric not null default 0,
  planned_qty numeric not null,
  observation text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  unique (tenant_id, location_plan_id, material_id),
  constraint project_location_materials_source_type_check
    check (source_type in ('PROJECT_FORECAST', 'MANUAL')),
  constraint project_location_materials_original_qty_check
    check (original_qty >= 0),
  constraint project_location_materials_planned_qty_check
    check (planned_qty > 0),
  constraint project_location_materials_material_code_not_blank
    check (btrim(material_code) <> ''),
  constraint project_location_materials_material_description_not_blank
    check (btrim(material_description) <> '')
);

create index if not exists idx_project_location_materials_tenant_plan
  on public.project_location_materials (tenant_id, location_plan_id, updated_at desc);

create index if not exists idx_project_location_materials_tenant_material
  on public.project_location_materials (tenant_id, material_id);

alter table if exists public.project_location_materials enable row level security;

drop policy if exists project_location_materials_tenant_select on public.project_location_materials;
create policy project_location_materials_tenant_select on public.project_location_materials
for select
to authenticated
using (public.user_can_access_tenant(project_location_materials.tenant_id));

drop policy if exists project_location_materials_tenant_write on public.project_location_materials;
create policy project_location_materials_tenant_write on public.project_location_materials
for all
to authenticated
using (public.user_can_access_tenant(project_location_materials.tenant_id))
with check (public.user_can_access_tenant(project_location_materials.tenant_id));

drop trigger if exists trg_project_location_materials_audit on public.project_location_materials;
create trigger trg_project_location_materials_audit before insert or update on public.project_location_materials
for each row execute function public.apply_audit_fields();

create table if not exists public.project_location_activities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  location_plan_id uuid not null references public.project_location_plans(id) on delete cascade,
  service_activity_id uuid not null references public.service_activities(id),
  source_type text not null default 'CATALOG',
  activity_code text not null,
  activity_description text not null,
  team_type_name text,
  activity_group text,
  activity_unit text not null,
  activity_scope text,
  unit_value_snapshot numeric(14, 2) not null default 0,
  planned_qty numeric not null,
  observation text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  unique (tenant_id, location_plan_id, service_activity_id),
  constraint project_location_activities_source_type_check
    check (source_type in ('CATALOG')),
  constraint project_location_activities_unit_not_blank
    check (btrim(activity_unit) <> ''),
  constraint project_location_activities_code_not_blank
    check (btrim(activity_code) <> ''),
  constraint project_location_activities_description_not_blank
    check (btrim(activity_description) <> ''),
  constraint project_location_activities_unit_value_check
    check (unit_value_snapshot >= 0),
  constraint project_location_activities_planned_qty_check
    check (planned_qty > 0)
);

create index if not exists idx_project_location_activities_tenant_plan
  on public.project_location_activities (tenant_id, location_plan_id, updated_at desc);

create index if not exists idx_project_location_activities_tenant_activity
  on public.project_location_activities (tenant_id, service_activity_id);

alter table if exists public.project_location_activities enable row level security;

drop policy if exists project_location_activities_tenant_select on public.project_location_activities;
create policy project_location_activities_tenant_select on public.project_location_activities
for select
to authenticated
using (public.user_can_access_tenant(project_location_activities.tenant_id));

drop policy if exists project_location_activities_tenant_write on public.project_location_activities;
create policy project_location_activities_tenant_write on public.project_location_activities
for all
to authenticated
using (public.user_can_access_tenant(project_location_activities.tenant_id))
with check (public.user_can_access_tenant(project_location_activities.tenant_id));

drop trigger if exists trg_project_location_activities_audit on public.project_location_activities;
create trigger trg_project_location_activities_audit before insert or update on public.project_location_activities
for each row execute function public.apply_audit_fields();

create or replace function public.initialize_project_location_plan(
  p_tenant_id uuid,
  p_project_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_plan_id uuid;
  v_project_exists boolean;
  v_created boolean := false;
  v_created_rows integer := 0;
  v_seeded_materials integer := 0;
begin
  select exists (
    select 1
    from public.project p
    where p.id = p_project_id
      and p.tenant_id = p_tenant_id
  )
  into v_project_exists;

  if not v_project_exists then
    return jsonb_build_object('success', false, 'reason', 'PROJECT_NOT_FOUND');
  end if;

  insert into public.project_location_plans (
    tenant_id,
    project_id,
    questionnaire_answers,
    created_by,
    updated_by
  )
  values (
    p_tenant_id,
    p_project_id,
    '{}'::jsonb,
    p_actor_user_id,
    p_actor_user_id
  )
  on conflict (tenant_id, project_id) do nothing;

  get diagnostics v_created_rows = row_count;
  v_created := v_created_rows > 0;

  select pl.id
  into v_plan_id
  from public.project_location_plans pl
  where pl.tenant_id = p_tenant_id
    and pl.project_id = p_project_id;

  if not exists (
    select 1
    from public.project_location_materials plm
    where plm.tenant_id = p_tenant_id
      and plm.location_plan_id = v_plan_id
  ) then
    insert into public.project_location_materials (
      tenant_id,
      location_plan_id,
      project_forecast_item_id,
      material_id,
      source_type,
      material_code,
      material_description,
      material_umb,
      material_type,
      original_qty,
      planned_qty,
      observation,
      created_by,
      updated_by
    )
    select
      p_tenant_id,
      v_plan_id,
      pmf.id,
      pmf.material_id,
      'PROJECT_FORECAST',
      coalesce(m.codigo, ''),
      coalesce(m.descricao, ''),
      m.umb,
      m.tipo,
      pmf.qty_planned,
      pmf.qty_planned,
      pmf.observation,
      p_actor_user_id,
      p_actor_user_id
    from public.project_material_forecast pmf
    join public.materials m
      on m.id = pmf.material_id
     and m.tenant_id = pmf.tenant_id
    where pmf.tenant_id = p_tenant_id
      and pmf.project_id = p_project_id
    on conflict (tenant_id, location_plan_id, material_id) do nothing;

    get diagnostics v_seeded_materials = row_count;
  else
    v_seeded_materials := 0;
  end if;

  return jsonb_build_object(
    'success', true,
    'plan_id', v_plan_id,
    'created', v_created,
    'seeded_materials', v_seeded_materials
  );
end;
$$;

revoke all on function public.initialize_project_location_plan(uuid, uuid, uuid) from public;
grant execute on function public.initialize_project_location_plan(uuid, uuid, uuid) to authenticated;
grant execute on function public.initialize_project_location_plan(uuid, uuid, uuid) to service_role;
