-- 063_create_location_save_rpcs.sql
-- Centraliza validacoes e persistencia da Locacao, materiais previstos e atividades previstas via RPC.

create or replace function public.save_project_location_plan(
  p_tenant_id uuid,
  p_project_id uuid,
  p_actor_user_id uuid,
  p_notes text default null,
  p_questionnaire_answers jsonb default '{}'::jsonb,
  p_risks jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_initialize jsonb;
  v_plan_id uuid;
  v_project_exists boolean;
  v_questionnaire jsonb := coalesce(p_questionnaire_answers, '{}'::jsonb);
  v_planning jsonb;
  v_execution_teams jsonb;
  v_execution_forecast jsonb;
  v_pre_apr jsonb;
  v_removed_support_item_ids jsonb := '[]'::jsonb;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_needs_project_review boolean;
  v_with_shutdown boolean;
  v_cesto_qty integer;
  v_linha_morta_qty integer;
  v_linha_viva_qty integer;
  v_poda_linha_morta_qty integer;
  v_poda_linha_viva_qty integer;
  v_steps_planned_qty integer;
  v_execution_observation text;
  v_pre_apr_observation text;
  v_risk_item jsonb;
  v_risk_id_text text;
  v_risk_is_active boolean;
begin
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
      'message', 'Projeto nao encontrado para salvar a locacao.'
    );
  end if;

  if jsonb_typeof(v_questionnaire) <> 'object' then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_QUESTIONNAIRE',
      'message', 'questionnaire_answers deve ser um objeto json.'
    );
  end if;

  if jsonb_typeof(coalesce(p_risks, '[]'::jsonb)) <> 'array' then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_RISKS_PAYLOAD',
      'message', 'A lista de riscos deve ser um array json.'
    );
  end if;

  v_planning := coalesce(v_questionnaire -> 'planning', '{}'::jsonb);
  v_execution_teams := coalesce(v_questionnaire -> 'executionTeams', '{}'::jsonb);
  v_execution_forecast := coalesce(v_questionnaire -> 'executionForecast', '{}'::jsonb);
  v_pre_apr := coalesce(v_questionnaire -> 'preApr', '{}'::jsonb);

  if jsonb_typeof(v_planning) <> 'object'
    or jsonb_typeof(v_execution_teams) <> 'object'
    or jsonb_typeof(v_execution_forecast) <> 'object'
    or jsonb_typeof(v_pre_apr) <> 'object' then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_QUESTIONNAIRE_STRUCTURE',
      'message', 'A estrutura da locacao e invalida para salvar.'
    );
  end if;

  if jsonb_typeof(v_planning -> 'needsProjectReview') <> 'boolean' then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_PROJECT_REVIEW',
      'message', 'Necessario informar se ha revisao de projeto antes de salvar a locacao.'
    );
  end if;

  if jsonb_typeof(v_planning -> 'withShutdown') <> 'boolean' then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_WITH_SHUTDOWN',
      'message', 'Necessario informar se ha desligamento antes de salvar a locacao.'
    );
  end if;

  if jsonb_typeof(v_execution_teams -> 'cestoQty') <> 'number'
    or jsonb_typeof(v_execution_teams -> 'linhaMortaQty') <> 'number'
    or jsonb_typeof(v_execution_teams -> 'linhaVivaQty') <> 'number'
    or jsonb_typeof(v_execution_teams -> 'podaLinhaMortaQty') <> 'number'
    or jsonb_typeof(v_execution_teams -> 'podaLinhaVivaQty') <> 'number'
    or jsonb_typeof(v_execution_forecast -> 'stepsPlannedQty') <> 'number' then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_LOCATION_QUANTITIES',
      'message', 'As quantidades da locacao devem ser numericas e nao podem ser negativas.'
    );
  end if;

  v_needs_project_review := (v_planning ->> 'needsProjectReview')::boolean;
  v_with_shutdown := (v_planning ->> 'withShutdown')::boolean;

  v_cesto_qty := trunc((v_execution_teams ->> 'cestoQty')::numeric);
  v_linha_morta_qty := trunc((v_execution_teams ->> 'linhaMortaQty')::numeric);
  v_linha_viva_qty := trunc((v_execution_teams ->> 'linhaVivaQty')::numeric);
  v_poda_linha_morta_qty := trunc((v_execution_teams ->> 'podaLinhaMortaQty')::numeric);
  v_poda_linha_viva_qty := trunc((v_execution_teams ->> 'podaLinhaVivaQty')::numeric);
  v_steps_planned_qty := trunc((v_execution_forecast ->> 'stepsPlannedQty')::numeric);

  if v_cesto_qty < 0
    or v_linha_morta_qty < 0
    or v_linha_viva_qty < 0
    or v_poda_linha_morta_qty < 0
    or v_poda_linha_viva_qty < 0
    or v_steps_planned_qty < 0 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'NEGATIVE_LOCATION_QUANTITIES',
      'message', 'As quantidades da locacao devem ser numericas e nao podem ser negativas.'
    );
  end if;

  if v_cesto_qty <= 0
    and v_linha_morta_qty <= 0
    and v_linha_viva_qty <= 0
    and v_poda_linha_morta_qty <= 0
    and v_poda_linha_viva_qty <= 0 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'LOCATION_TEAMS_ALL_ZERO',
      'message', 'Pelo menos uma equipe para execucao deve ter quantidade maior que zero.'
    );
  end if;

  if v_steps_planned_qty <= 0 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'LOCATION_STEPS_ZERO',
      'message', 'ETAPAS PREVISTAS deve ser maior que zero para salvar a locacao.'
    );
  end if;

  if (v_execution_forecast ? 'removedSupportItemIds') then
    if jsonb_typeof(v_execution_forecast -> 'removedSupportItemIds') <> 'array' then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'INVALID_SUPPORT_ITEMS',
        'message', 'removedSupportItemIds deve ser um array json.'
      );
    end if;

    v_removed_support_item_ids := (
      select coalesce(jsonb_agg(to_jsonb(trim(value))), '[]'::jsonb)
      from jsonb_array_elements_text(v_execution_forecast -> 'removedSupportItemIds') as value
      where trim(value) <> ''
    );
  end if;

  v_execution_observation := nullif(btrim(coalesce(v_execution_forecast ->> 'observation', '')), '');
  v_pre_apr_observation := nullif(btrim(coalesce(v_pre_apr ->> 'observation', '')), '');

  v_initialize := public.initialize_project_location_plan(
    p_tenant_id,
    p_project_id,
    p_actor_user_id
  );

  if coalesce((v_initialize ->> 'success')::boolean, false) is not true then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', coalesce(v_initialize ->> 'reason', 'PROJECT_NOT_FOUND'),
      'message', 'Projeto nao encontrado para salvar a locacao.'
    );
  end if;

  v_plan_id := (v_initialize ->> 'plan_id')::uuid;

  update public.project_location_plans
  set
    notes = v_notes,
    questionnaire_answers = jsonb_build_object(
      'planning', jsonb_build_object(
        'needsProjectReview', v_needs_project_review,
        'withShutdown', v_with_shutdown
      ),
      'executionTeams', jsonb_build_object(
        'cestoQty', v_cesto_qty,
        'linhaMortaQty', v_linha_morta_qty,
        'linhaVivaQty', v_linha_viva_qty,
        'podaLinhaMortaQty', v_poda_linha_morta_qty,
        'podaLinhaVivaQty', v_poda_linha_viva_qty
      ),
      'executionForecast', jsonb_build_object(
        'stepsPlannedQty', v_steps_planned_qty,
        'observation', coalesce(v_execution_observation, ''),
        'removedSupportItemIds', v_removed_support_item_ids
      ),
      'preApr', jsonb_build_object(
        'observation', coalesce(v_pre_apr_observation, '')
      )
    ),
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and project_id = p_project_id;

  for v_risk_item in
    select value
    from jsonb_array_elements(coalesce(p_risks, '[]'::jsonb))
  loop
    if jsonb_typeof(v_risk_item) <> 'object' then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'INVALID_RISK_ITEM',
        'message', 'Cada risco enviado precisa ser um objeto json valido.'
      );
    end if;

    v_risk_id_text := nullif(btrim(coalesce(v_risk_item ->> 'id', '')), '');
    if v_risk_id_text is null then
      continue;
    end if;

    if v_risk_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'INVALID_RISK_ID',
        'message', 'A lista de riscos possui um identificador invalido.'
      );
    end if;

    if jsonb_typeof(v_risk_item -> 'isActive') <> 'boolean' then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'INVALID_RISK_STATUS',
        'message', 'Cada risco enviado precisa informar isActive como boolean.'
      );
    end if;

    v_risk_is_active := (v_risk_item ->> 'isActive')::boolean;

    update public.project_location_risks
    set
      is_active = v_risk_is_active,
      updated_by = p_actor_user_id
    where tenant_id = p_tenant_id
      and location_plan_id = v_plan_id
      and id = v_risk_id_text::uuid;
  end loop;

  update public.project
  set
    has_locacao = true,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = p_project_id
    and has_locacao = false;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'plan_id', v_plan_id,
    'message', 'Locacao atualizada com sucesso.'
  );
end;
$$;

revoke all on function public.save_project_location_plan(uuid, uuid, uuid, text, jsonb, jsonb) from public;
grant execute on function public.save_project_location_plan(uuid, uuid, uuid, text, jsonb, jsonb) to authenticated;
grant execute on function public.save_project_location_plan(uuid, uuid, uuid, text, jsonb, jsonb) to service_role;

create or replace function public.save_project_location_material(
  p_tenant_id uuid,
  p_project_id uuid,
  p_actor_user_id uuid,
  p_quantity numeric,
  p_item_id uuid default null,
  p_material_id uuid default null,
  p_observation text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_initialize jsonb;
  v_plan_id uuid;
  v_material record;
  v_item record;
  v_observation text := nullif(btrim(coalesce(p_observation, '')), '');
begin
  if p_quantity is null or p_quantity <= 0 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_QUANTITY',
      'message', 'A quantidade do material previsto deve ser maior que zero.'
    );
  end if;

  v_initialize := public.initialize_project_location_plan(
    p_tenant_id,
    p_project_id,
    p_actor_user_id
  );

  if coalesce((v_initialize ->> 'success')::boolean, false) is not true then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', coalesce(v_initialize ->> 'reason', 'PROJECT_NOT_FOUND'),
      'message', 'Projeto nao encontrado para salvar material da locacao.'
    );
  end if;

  v_plan_id := (v_initialize ->> 'plan_id')::uuid;

  if p_item_id is null then
    if p_material_id is null then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'MISSING_MATERIAL_ID',
        'message', 'Material obrigatorio para adicionar item na locacao.'
      );
    end if;

    select
      m.id,
      m.codigo,
      m.descricao,
      m.umb,
      m.tipo
    into v_material
    from public.materials m
    where m.tenant_id = p_tenant_id
      and m.id = p_material_id
      and m.is_active = true;

    if not found then
      return jsonb_build_object(
        'success', false,
        'status', 404,
        'reason', 'MATERIAL_NOT_FOUND',
        'message', 'Material nao encontrado ou inativo.'
      );
    end if;

    begin
      insert into public.project_location_materials (
        tenant_id,
        location_plan_id,
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
      values (
        p_tenant_id,
        v_plan_id,
        v_material.id,
        'MANUAL',
        btrim(coalesce(v_material.codigo, '')),
        btrim(coalesce(v_material.descricao, '')),
        nullif(btrim(coalesce(v_material.umb, '')), ''),
        nullif(btrim(coalesce(v_material.tipo, '')), ''),
        0,
        p_quantity,
        v_observation,
        p_actor_user_id,
        p_actor_user_id
      );
    exception
      when unique_violation then
        return jsonb_build_object(
          'success', false,
          'status', 409,
          'reason', 'MATERIAL_ALREADY_EXISTS',
          'message', 'Material ja adicionado na locacao deste projeto.'
        );
    end;

    select plm.id, plm.material_code
    into v_item
    from public.project_location_materials plm
    where plm.tenant_id = p_tenant_id
      and plm.location_plan_id = v_plan_id
      and plm.material_id = p_material_id;

    update public.project
    set
      has_locacao = true,
      updated_by = p_actor_user_id
    where tenant_id = p_tenant_id
      and id = p_project_id
      and has_locacao = false;

    return jsonb_build_object(
      'success', true,
      'status', 200,
      'action', 'INSERT',
      'item_id', v_item.id,
      'entity_code', v_item.material_code,
      'message', 'Material adicionado na locacao com sucesso.'
    );
  end if;

  select plm.id, plm.material_code
  into v_item
  from public.project_location_materials plm
  where plm.tenant_id = p_tenant_id
    and plm.location_plan_id = v_plan_id
    and plm.id = p_item_id;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'LOCATION_MATERIAL_NOT_FOUND',
      'message', 'Material da locacao nao encontrado.'
    );
  end if;

  update public.project_location_materials
  set
    planned_qty = p_quantity,
    observation = v_observation,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and location_plan_id = v_plan_id
    and id = p_item_id;

  update public.project
  set
    has_locacao = true,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = p_project_id
    and has_locacao = false;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'action', 'UPDATE',
    'item_id', v_item.id,
    'entity_code', v_item.material_code,
    'message', 'Material da locacao atualizado com sucesso.'
  );
end;
$$;

revoke all on function public.save_project_location_material(uuid, uuid, uuid, numeric, uuid, uuid, text) from public;
grant execute on function public.save_project_location_material(uuid, uuid, uuid, numeric, uuid, uuid, text) to authenticated;
grant execute on function public.save_project_location_material(uuid, uuid, uuid, numeric, uuid, uuid, text) to service_role;

create or replace function public.save_project_location_activity(
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
  v_initialize jsonb;
  v_plan_id uuid;
  v_activity record;
  v_item record;
  v_observation text := nullif(btrim(coalesce(p_observation, '')), '');
begin
  if p_quantity is null or p_quantity <= 0 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_QUANTITY',
      'message', 'A quantidade da atividade prevista deve ser maior que zero.'
    );
  end if;

  v_initialize := public.initialize_project_location_plan(
    p_tenant_id,
    p_project_id,
    p_actor_user_id
  );

  if coalesce((v_initialize ->> 'success')::boolean, false) is not true then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', coalesce(v_initialize ->> 'reason', 'PROJECT_NOT_FOUND'),
      'message', 'Projeto nao encontrado para salvar atividade da locacao.'
    );
  end if;

  v_plan_id := (v_initialize ->> 'plan_id')::uuid;

  if p_item_id is null then
    if p_activity_id is null then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'MISSING_ACTIVITY_ID',
        'message', 'Atividade obrigatoria para adicionar item na locacao.'
      );
    end if;

    select
      sa.id,
      sa.code,
      sa.description,
      sa.unit,
      sa.unit_value,
      sa.group_name,
      sa.scope,
      tt.name as team_type_name
    into v_activity
    from public.service_activities sa
    left join public.team_types tt
      on tt.id = sa.team_type_id
     and tt.tenant_id = sa.tenant_id
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
      values (
        p_tenant_id,
        v_plan_id,
        v_activity.id,
        'CATALOG',
        btrim(coalesce(v_activity.code, '')),
        btrim(coalesce(v_activity.description, '')),
        nullif(btrim(coalesce(v_activity.team_type_name, '')), ''),
        nullif(btrim(coalesce(v_activity.group_name, '')), ''),
        btrim(coalesce(v_activity.unit, '')),
        nullif(btrim(coalesce(v_activity.scope, '')), ''),
        coalesce(v_activity.unit_value, 0),
        p_quantity,
        v_observation,
        p_actor_user_id,
        p_actor_user_id
      );
    exception
      when unique_violation then
        return jsonb_build_object(
          'success', false,
          'status', 409,
          'reason', 'ACTIVITY_ALREADY_EXISTS',
          'message', 'Atividade ja adicionada na locacao deste projeto.'
        );
    end;

    select pla.id, pla.activity_code
    into v_item
    from public.project_location_activities pla
    where pla.tenant_id = p_tenant_id
      and pla.location_plan_id = v_plan_id
      and pla.service_activity_id = p_activity_id;

    update public.project
    set
      has_locacao = true,
      updated_by = p_actor_user_id
    where tenant_id = p_tenant_id
      and id = p_project_id
      and has_locacao = false;

    return jsonb_build_object(
      'success', true,
      'status', 200,
      'action', 'INSERT',
      'item_id', v_item.id,
      'entity_code', v_item.activity_code,
      'message', 'Atividade adicionada na locacao com sucesso.'
    );
  end if;

  select pla.id, pla.activity_code
  into v_item
  from public.project_location_activities pla
  where pla.tenant_id = p_tenant_id
    and pla.location_plan_id = v_plan_id
    and pla.id = p_item_id;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'LOCATION_ACTIVITY_NOT_FOUND',
      'message', 'Atividade da locacao nao encontrada.'
    );
  end if;

  update public.project_location_activities
  set
    planned_qty = p_quantity,
    observation = v_observation,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and location_plan_id = v_plan_id
    and id = p_item_id;

  update public.project
  set
    has_locacao = true,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = p_project_id
    and has_locacao = false;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'action', 'UPDATE',
    'item_id', v_item.id,
    'entity_code', v_item.activity_code,
    'message', 'Atividade da locacao atualizada com sucesso.'
  );
end;
$$;

revoke all on function public.save_project_location_activity(uuid, uuid, uuid, numeric, uuid, uuid, text) from public;
grant execute on function public.save_project_location_activity(uuid, uuid, uuid, numeric, uuid, uuid, text) to authenticated;
grant execute on function public.save_project_location_activity(uuid, uuid, uuid, numeric, uuid, uuid, text) to service_role;
