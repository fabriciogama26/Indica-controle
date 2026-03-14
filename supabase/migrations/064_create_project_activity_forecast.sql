-- 064_create_project_activity_forecast.sql
-- Cadastro de atividades previstas por projeto e seed inicial da Locacao a partir dessa base.

create table if not exists public.project_activity_forecast (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  project_id uuid not null references public.project(id) on delete cascade,
  service_activity_id uuid not null references public.service_activities(id),
  qty_planned numeric not null,
  observation text,
  source text not null default 'MANUAL',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  unique (tenant_id, project_id, service_activity_id),
  constraint project_activity_forecast_qty_planned_check
    check (qty_planned > 0),
  constraint project_activity_forecast_source_not_blank
    check (btrim(source) <> '')
);

create index if not exists idx_project_activity_forecast_tenant_project
  on public.project_activity_forecast (tenant_id, project_id, updated_at desc);

create index if not exists idx_project_activity_forecast_tenant_activity
  on public.project_activity_forecast (tenant_id, service_activity_id);

alter table if exists public.project_activity_forecast enable row level security;

drop policy if exists project_activity_forecast_tenant_select on public.project_activity_forecast;
create policy project_activity_forecast_tenant_select on public.project_activity_forecast
for select
to authenticated
using (public.user_can_access_tenant(project_activity_forecast.tenant_id));

drop policy if exists project_activity_forecast_tenant_write on public.project_activity_forecast;
create policy project_activity_forecast_tenant_write on public.project_activity_forecast
for all
to authenticated
using (public.user_can_access_tenant(project_activity_forecast.tenant_id))
with check (public.user_can_access_tenant(project_activity_forecast.tenant_id));

drop trigger if exists trg_project_activity_forecast_audit on public.project_activity_forecast;
create trigger trg_project_activity_forecast_audit before insert or update on public.project_activity_forecast
for each row execute function public.apply_audit_fields();

create or replace function public.save_project_activity_forecast(
  p_tenant_id uuid,
  p_project_id uuid,
  p_actor_user_id uuid,
  p_quantity numeric,
  p_item_id uuid default null,
  p_activity_id uuid default null,
  p_observation text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_exists boolean;
  v_activity record;
  v_item record;
  v_observation text := nullif(btrim(coalesce(p_observation, '')), '');
begin
  if p_quantity is null or p_quantity <= 0 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_QUANTITY',
      'message', 'A quantidade da atividade prevista do projeto deve ser maior que zero.'
    );
  end if;

  select exists (
    select 1
    from public.project p
    where p.id = p_project_id
      and p.tenant_id = p_tenant_id
  )
  into v_project_exists;

  if not v_project_exists then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'PROJECT_NOT_FOUND',
      'message', 'Projeto nao encontrado para salvar atividades previstas.'
    );
  end if;

  if p_item_id is null then
    if p_activity_id is null then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'MISSING_ACTIVITY_ID',
        'message', 'Atividade obrigatoria para adicionar item previsto do projeto.'
      );
    end if;

    select
      sa.id,
      sa.code,
      sa.description
    into v_activity
    from public.service_activities sa
    where sa.tenant_id = p_tenant_id
      and sa.id = p_activity_id
      and sa.ativo = true;

    if not found then
      return jsonb_build_object(
        'success', false,
        'status', 404,
        'reason', 'ACTIVITY_NOT_FOUND',
        'message', 'Atividade nao encontrada ou inativa.'
      );
    end if;

    begin
      insert into public.project_activity_forecast (
        tenant_id,
        project_id,
        service_activity_id,
        qty_planned,
        observation,
        source,
        created_by,
        updated_by
      )
      values (
        p_tenant_id,
        p_project_id,
        v_activity.id,
        p_quantity,
        v_observation,
        'MANUAL',
        p_actor_user_id,
        p_actor_user_id
      );
    exception
      when unique_violation then
        return jsonb_build_object(
          'success', false,
          'status', 409,
          'reason', 'ACTIVITY_ALREADY_EXISTS',
          'message', 'Atividade ja adicionada no previsto deste projeto.'
        );
    end;

    select paf.id, sa.code
    into v_item
    from public.project_activity_forecast paf
    join public.service_activities sa
      on sa.id = paf.service_activity_id
     and sa.tenant_id = paf.tenant_id
    where paf.tenant_id = p_tenant_id
      and paf.project_id = p_project_id
      and paf.service_activity_id = p_activity_id;

    return jsonb_build_object(
      'success', true,
      'status', 200,
      'action', 'INSERT',
      'item_id', v_item.id,
      'entity_code', v_item.code,
      'message', 'Atividade prevista adicionada ao projeto com sucesso.'
    );
  end if;

  select paf.id, sa.code
  into v_item
  from public.project_activity_forecast paf
  join public.service_activities sa
    on sa.id = paf.service_activity_id
   and sa.tenant_id = paf.tenant_id
  where paf.tenant_id = p_tenant_id
    and paf.project_id = p_project_id
    and paf.id = p_item_id;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'PROJECT_ACTIVITY_FORECAST_NOT_FOUND',
      'message', 'Atividade prevista do projeto nao encontrada.'
    );
  end if;

  update public.project_activity_forecast
  set
    qty_planned = p_quantity,
    observation = v_observation,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and project_id = p_project_id
    and id = p_item_id;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'action', 'UPDATE',
    'item_id', v_item.id,
    'entity_code', v_item.code,
    'message', 'Atividade prevista do projeto atualizada com sucesso.'
  );
end;
$$;

revoke all on function public.save_project_activity_forecast(uuid, uuid, uuid, numeric, uuid, uuid, text) from public;
grant execute on function public.save_project_activity_forecast(uuid, uuid, uuid, numeric, uuid, uuid, text) to authenticated;
grant execute on function public.save_project_activity_forecast(uuid, uuid, uuid, numeric, uuid, uuid, text) to service_role;

alter table public.project_location_activities
  drop constraint if exists project_location_activities_source_type_check;

alter table public.project_location_activities
  add constraint project_location_activities_source_type_check
  check (source_type in ('CATALOG', 'PROJECT_FORECAST'));

create or replace function public.initialize_project_location_plan(
  p_tenant_id uuid,
  p_project_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_id uuid;
  v_project_exists boolean;
  v_created boolean := false;
  v_created_rows integer := 0;
  v_seeded_materials integer := 0;
  v_seeded_activities integer := 0;
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

  if not exists (
    select 1
    from public.project_location_activities pla
    where pla.tenant_id = p_tenant_id
      and pla.location_plan_id = v_plan_id
  ) then
    insert into public.project_location_activities (
      tenant_id,
      location_plan_id,
      service_activity_id,
      source_type,
      activity_code,
      activity_description,
      team_type_name,
      activity_group,
      activity_unit,
      activity_scope,
      unit_value_snapshot,
      planned_qty,
      observation,
      created_by,
      updated_by
    )
    select
      p_tenant_id,
      v_plan_id,
      paf.service_activity_id,
      'PROJECT_FORECAST',
      coalesce(sa.code, ''),
      coalesce(sa.description, ''),
      tt.name,
      sa.group_name,
      coalesce(sa.unit, ''),
      sa.scope,
      coalesce(sa.unit_value, 0),
      paf.qty_planned,
      paf.observation,
      p_actor_user_id,
      p_actor_user_id
    from public.project_activity_forecast paf
    join public.service_activities sa
      on sa.id = paf.service_activity_id
     and sa.tenant_id = paf.tenant_id
    left join public.team_types tt
      on tt.id = sa.team_type_id
     and tt.tenant_id = sa.tenant_id
    where paf.tenant_id = p_tenant_id
      and paf.project_id = p_project_id
    on conflict (tenant_id, location_plan_id, service_activity_id) do nothing;

    get diagnostics v_seeded_activities = row_count;
  else
    v_seeded_activities := 0;
  end if;

  return jsonb_build_object(
    'success', true,
    'plan_id', v_plan_id,
    'created', v_created,
    'seeded_materials', v_seeded_materials,
    'seeded_activities', v_seeded_activities
  );
end;
$$;

revoke all on function public.initialize_project_location_plan(uuid, uuid, uuid) from public;
grant execute on function public.initialize_project_location_plan(uuid, uuid, uuid) to authenticated;
grant execute on function public.initialize_project_location_plan(uuid, uuid, uuid) to service_role;
