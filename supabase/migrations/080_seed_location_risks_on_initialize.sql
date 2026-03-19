-- 080_seed_location_risks_on_initialize.sql
-- Faz seed de riscos no bootstrap da Locacao para novos projetos.

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
  v_seeded_risks integer := 0;
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

  if not exists (
    select 1
    from public.project_location_risks plr
    where plr.tenant_id = p_tenant_id
      and plr.location_plan_id = v_plan_id
  ) then
    insert into public.project_location_risks (
      tenant_id,
      location_plan_id,
      description,
      is_active,
      created_by,
      updated_by
    )
    select
      p_tenant_id,
      v_plan_id,
      risk_catalog.description,
      risk_catalog.is_active,
      p_actor_user_id,
      p_actor_user_id
    from (
      select distinct on (lower(btrim(plr.description)))
        btrim(plr.description) as description,
        plr.is_active
      from public.project_location_risks plr
      where plr.tenant_id = p_tenant_id
        and btrim(coalesce(plr.description, '')) <> ''
      order by lower(btrim(plr.description)), plr.updated_at desc
    ) as risk_catalog;

    get diagnostics v_seeded_risks = row_count;
  else
    v_seeded_risks := 0;
  end if;

  return jsonb_build_object(
    'success', true,
    'plan_id', v_plan_id,
    'created', v_created,
    'seeded_materials', v_seeded_materials,
    'seeded_activities', v_seeded_activities,
    'seeded_risks', v_seeded_risks
  );
end;
$$;

revoke all on function public.initialize_project_location_plan(uuid, uuid, uuid) from public;
grant execute on function public.initialize_project_location_plan(uuid, uuid, uuid) to authenticated;
grant execute on function public.initialize_project_location_plan(uuid, uuid, uuid) to service_role;
