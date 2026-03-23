-- 107_add_location_plan_structured_fields_and_history.sql
-- Estrutura campos fisicos da Locacao, cria historico dedicado e endurece concorrencia do save principal.

alter table if exists public.project_location_plans
  add column if not exists feeder text,
  add column if not exists sgd_type_id uuid,
  add column if not exists cut_element integer;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'project_location_plans_cut_element_non_negative_check'
      and conrelid = 'public.project_location_plans'::regclass
  ) then
    alter table public.project_location_plans
      add constraint project_location_plans_cut_element_non_negative_check
      check (cut_element is null or cut_element >= 0);
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.programming_sgd_types') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'project_location_plans_sgd_type_id_fk'
        and conrelid = 'public.project_location_plans'::regclass
    ) then
    alter table public.project_location_plans
      add constraint project_location_plans_sgd_type_id_fk
      foreign key (sgd_type_id)
      references public.programming_sgd_types(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists idx_project_location_plans_tenant_sgd_type
  on public.project_location_plans (tenant_id, sgd_type_id)
  where sgd_type_id is not null;

update public.project_location_plans pl
set
  feeder = coalesce(
    nullif(btrim(coalesce(pl.questionnaire_answers #>> '{planning,feeder}', '')), ''),
    pl.feeder
  ),
  sgd_type_id = coalesce(
    case
      when nullif(btrim(coalesce(pl.questionnaire_answers #>> '{planning,sgdTypeId}', '')), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then (pl.questionnaire_answers #>> '{planning,sgdTypeId}')::uuid
      else null
    end,
    pl.sgd_type_id
  ),
  cut_element = coalesce(
    case
      when nullif(btrim(coalesce(pl.questionnaire_answers #>> '{planning,cutElement}', '')), '') ~ '^\d+$'
        then (pl.questionnaire_answers #>> '{planning,cutElement}')::integer
      else null
    end,
    pl.cut_element
  )
where pl.tenant_id is not null;

create table if not exists public.project_location_plan_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  location_plan_id uuid not null references public.project_location_plans(id) on delete cascade,
  project_id uuid null references public.project(id) on delete set null,
  action_type text not null default 'UPDATE',
  reason text null,
  changes jsonb not null default '{}'::jsonb,
  snapshot_before jsonb not null default '{}'::jsonb,
  snapshot_after jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid null references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint project_location_plan_history_action_not_blank check (btrim(action_type) <> ''),
  constraint project_location_plan_history_reason_not_blank check (reason is null or btrim(reason) <> ''),
  constraint project_location_plan_history_changes_object_check check (jsonb_typeof(changes) = 'object'),
  constraint project_location_plan_history_snapshot_before_object_check check (jsonb_typeof(snapshot_before) = 'object'),
  constraint project_location_plan_history_snapshot_after_object_check check (jsonb_typeof(snapshot_after) = 'object'),
  constraint project_location_plan_history_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create index if not exists idx_project_location_plan_history_tenant_plan_created
  on public.project_location_plan_history (tenant_id, location_plan_id, created_at desc);

create index if not exists idx_project_location_plan_history_tenant_project_created
  on public.project_location_plan_history (tenant_id, project_id, created_at desc);

alter table if exists public.project_location_plan_history enable row level security;

drop policy if exists project_location_plan_history_tenant_select on public.project_location_plan_history;
create policy project_location_plan_history_tenant_select on public.project_location_plan_history
for select
to authenticated
using (public.user_can_access_tenant(project_location_plan_history.tenant_id));

drop policy if exists project_location_plan_history_tenant_insert on public.project_location_plan_history;
create policy project_location_plan_history_tenant_insert on public.project_location_plan_history
for insert
to authenticated
with check (public.user_can_access_tenant(project_location_plan_history.tenant_id));

drop function if exists public.append_project_location_plan_history_record(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  jsonb,
  jsonb,
  jsonb,
  jsonb
);

create or replace function public.append_project_location_plan_history_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_location_plan_id uuid,
  p_project_id uuid default null,
  p_action_type text default 'UPDATE',
  p_reason text default null,
  p_changes jsonb default '{}'::jsonb,
  p_snapshot_before jsonb default '{}'::jsonb,
  p_snapshot_after jsonb default '{}'::jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action_type text := upper(nullif(btrim(coalesce(p_action_type, '')), ''));
begin
  if p_tenant_id is null or p_location_plan_id is null or v_action_type is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_LOCATION_HISTORY_PAYLOAD',
      'message', 'Informe tenant, plano de locacao e acao para registrar historico.'
    );
  end if;

  insert into public.project_location_plan_history (
    tenant_id,
    location_plan_id,
    project_id,
    action_type,
    reason,
    changes,
    snapshot_before,
    snapshot_after,
    metadata,
    created_by
  ) values (
    p_tenant_id,
    p_location_plan_id,
    p_project_id,
    v_action_type,
    nullif(btrim(coalesce(p_reason, '')), ''),
    coalesce(p_changes, '{}'::jsonb),
    coalesce(p_snapshot_before, '{}'::jsonb),
    coalesce(p_snapshot_after, '{}'::jsonb),
    coalesce(p_metadata, '{}'::jsonb),
    p_actor_user_id
  );

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'message', 'Historico da locacao registrado com sucesso.'
  );
end;
$$;

revoke all on function public.append_project_location_plan_history_record(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  jsonb,
  jsonb,
  jsonb,
  jsonb
) from public;

grant execute on function public.append_project_location_plan_history_record(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  jsonb,
  jsonb,
  jsonb,
  jsonb
) to authenticated;

grant execute on function public.append_project_location_plan_history_record(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  jsonb,
  jsonb,
  jsonb,
  jsonb
) to service_role;

create or replace function public.save_project_location_plan(
  p_tenant_id uuid,
  p_project_id uuid,
  p_actor_user_id uuid,
  p_notes text default null,
  p_questionnaire_answers jsonb default '{}'::jsonb,
  p_risks jsonb default '[]'::jsonb,
  p_expected_updated_at timestamptz default null
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
  v_cesto_qty_raw numeric;
  v_linha_morta_qty_raw numeric;
  v_linha_viva_qty_raw numeric;
  v_poda_linha_morta_qty_raw numeric;
  v_poda_linha_viva_qty_raw numeric;
  v_steps_planned_qty_raw numeric;
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
  v_feeder text;
  v_sgd_type_id_text text;
  v_sgd_type_id uuid;
  v_cut_element_text text;
  v_cut_element_raw numeric;
  v_cut_element integer;
  v_current_plan record;
  v_next_questionnaire jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_snapshot_before jsonb := '{}'::jsonb;
  v_snapshot_after jsonb := '{}'::jsonb;
  v_updated_notes text;
  v_updated_questionnaire jsonb;
  v_updated_feeder text;
  v_updated_sgd_type_id uuid;
  v_updated_cut_element integer;
  v_updated_at timestamptz;
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

  if p_expected_updated_at is null then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'LOCATION_PLAN_EXPECTED_UPDATED_AT_REQUIRED',
      'message', 'Atualize a locacao antes de salvar para evitar sobreposicao de dados.'
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
      'message', 'As quantidades da locacao devem ser numericas.'
    );
  end if;

  v_needs_project_review := (v_planning ->> 'needsProjectReview')::boolean;
  v_with_shutdown := (v_planning ->> 'withShutdown')::boolean;

  if (v_needs_project_review or v_with_shutdown) and v_notes is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'LOCATION_NOTES_REQUIRED',
      'message', 'Informe observacoes da locacao quando houver revisao de projeto ou desligamento.'
    );
  end if;

  v_cesto_qty_raw := (v_execution_teams ->> 'cestoQty')::numeric;
  v_linha_morta_qty_raw := (v_execution_teams ->> 'linhaMortaQty')::numeric;
  v_linha_viva_qty_raw := (v_execution_teams ->> 'linhaVivaQty')::numeric;
  v_poda_linha_morta_qty_raw := (v_execution_teams ->> 'podaLinhaMortaQty')::numeric;
  v_poda_linha_viva_qty_raw := (v_execution_teams ->> 'podaLinhaVivaQty')::numeric;
  v_steps_planned_qty_raw := (v_execution_forecast ->> 'stepsPlannedQty')::numeric;

  if v_cesto_qty_raw <> trunc(v_cesto_qty_raw)
    or v_linha_morta_qty_raw <> trunc(v_linha_morta_qty_raw)
    or v_linha_viva_qty_raw <> trunc(v_linha_viva_qty_raw)
    or v_poda_linha_morta_qty_raw <> trunc(v_poda_linha_morta_qty_raw)
    or v_poda_linha_viva_qty_raw <> trunc(v_poda_linha_viva_qty_raw)
    or v_steps_planned_qty_raw <> trunc(v_steps_planned_qty_raw) then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_INTEGER_QUANTITIES',
      'message', 'As equipes e ETAPAS PREVISTAS devem usar numeros inteiros.'
    );
  end if;

  v_cesto_qty := trunc(v_cesto_qty_raw);
  v_linha_morta_qty := trunc(v_linha_morta_qty_raw);
  v_linha_viva_qty := trunc(v_linha_viva_qty_raw);
  v_poda_linha_morta_qty := trunc(v_poda_linha_morta_qty_raw);
  v_poda_linha_viva_qty := trunc(v_poda_linha_viva_qty_raw);
  v_steps_planned_qty := trunc(v_steps_planned_qty_raw);

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
      'message', 'As quantidades da locacao nao podem ser negativas.'
    );
  end if;

  if v_cesto_qty > 50
    or v_linha_morta_qty > 50
    or v_linha_viva_qty > 50
    or v_poda_linha_morta_qty > 50
    or v_poda_linha_viva_qty > 50 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'LOCATION_TEAM_LIMIT_EXCEEDED',
      'message', 'As equipes da locacao nao podem ultrapassar 50.'
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

  if v_steps_planned_qty > 1000 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'LOCATION_STEPS_LIMIT_EXCEEDED',
      'message', 'ETAPAS PREVISTAS nao pode ultrapassar 1000.'
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
  v_feeder := nullif(btrim(coalesce(v_planning ->> 'feeder', '')), '');
  v_sgd_type_id_text := nullif(btrim(coalesce(v_planning ->> 'sgdTypeId', '')), '');
  v_cut_element_text := nullif(btrim(coalesce(v_planning ->> 'cutElement', '')), '');

  if v_sgd_type_id_text is not null then
    if v_sgd_type_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'INVALID_SGD_TYPE_ID',
        'message', 'Tipo de SGD invalido para a locacao.'
      );
    end if;

    v_sgd_type_id := v_sgd_type_id_text::uuid;

    if to_regclass('public.programming_sgd_types') is null then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'SGD_TYPE_CATALOG_NOT_AVAILABLE',
        'message', 'Catalogo de Tipo de SGD nao esta disponivel no ambiente.'
      );
    end if;

    perform 1
    from public.programming_sgd_types pst
    where pst.tenant_id = p_tenant_id
      and pst.id = v_sgd_type_id
      and pst.is_active = true;

    if not found then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'INVALID_SGD_TYPE',
        'message', 'Tipo de SGD invalido para o tenant atual.'
      );
    end if;
  else
    v_sgd_type_id := null;
  end if;

  if v_cut_element_text is not null then
    if v_cut_element_text !~ '^\d+$' then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'INVALID_CUT_ELEMENT',
        'message', 'Elemento de corte deve ser um numero inteiro nao-negativo.'
      );
    end if;

    v_cut_element_raw := v_cut_element_text::numeric;
    if v_cut_element_raw <> trunc(v_cut_element_raw) or v_cut_element_raw < 0 then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'INVALID_CUT_ELEMENT',
        'message', 'Elemento de corte deve ser um numero inteiro nao-negativo.'
      );
    end if;

    v_cut_element := trunc(v_cut_element_raw);
  else
    v_cut_element := null;
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
      'message', 'Projeto nao encontrado para salvar a locacao.'
    );
  end if;

  v_plan_id := (v_initialize ->> 'plan_id')::uuid;

  select
    pl.id,
    pl.notes,
    pl.questionnaire_answers,
    pl.feeder,
    pl.sgd_type_id,
    pl.cut_element,
    pl.updated_at
  into v_current_plan
  from public.project_location_plans pl
  where pl.tenant_id = p_tenant_id
    and pl.project_id = p_project_id
    and pl.id = v_plan_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'LOCATION_PLAN_NOT_FOUND',
      'message', 'Plano de locacao nao encontrado para o projeto.'
    );
  end if;

  if date_trunc('milliseconds', v_current_plan.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'LOCATION_PLAN_CONFLICT',
      'message', 'Esta locacao foi alterada por outro usuario. Reabra o projeto antes de salvar.'
    );
  end if;

  v_next_questionnaire := jsonb_build_object(
    'planning', jsonb_build_object(
      'needsProjectReview', v_needs_project_review,
      'withShutdown', v_with_shutdown,
      'feeder', coalesce(v_feeder, ''),
      'sgdTypeId', case when v_sgd_type_id is null then null else v_sgd_type_id::text end,
      'cutElement', v_cut_element
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
  );

  v_snapshot_before := jsonb_build_object(
    'notes', coalesce(v_current_plan.notes, ''),
    'questionnaireAnswers', coalesce(v_current_plan.questionnaire_answers, '{}'::jsonb),
    'feeder', nullif(btrim(coalesce(v_current_plan.feeder, '')), ''),
    'sgdTypeId', case when v_current_plan.sgd_type_id is null then null else v_current_plan.sgd_type_id::text end,
    'cutElement', v_current_plan.cut_element,
    'updatedAt', v_current_plan.updated_at
  );

  update public.project_location_plans
  set
    notes = v_notes,
    questionnaire_answers = v_next_questionnaire,
    feeder = v_feeder,
    sgd_type_id = v_sgd_type_id,
    cut_element = v_cut_element,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and project_id = p_project_id
    and id = v_plan_id
  returning
    notes,
    questionnaire_answers,
    feeder,
    sgd_type_id,
    cut_element,
    updated_at
  into
    v_updated_notes,
    v_updated_questionnaire,
    v_updated_feeder,
    v_updated_sgd_type_id,
    v_updated_cut_element,
    v_updated_at;

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

  if coalesce(v_current_plan.notes, '') is distinct from coalesce(v_updated_notes, '') then
    v_changes := v_changes || jsonb_build_object(
      'notes',
      jsonb_build_object('from', v_current_plan.notes, 'to', v_updated_notes)
    );
  end if;

  if coalesce(v_current_plan.questionnaire_answers, '{}'::jsonb) is distinct from coalesce(v_updated_questionnaire, '{}'::jsonb) then
    v_changes := v_changes || jsonb_build_object(
      'questionnaireAnswers',
      jsonb_build_object(
        'from', coalesce(v_current_plan.questionnaire_answers, '{}'::jsonb),
        'to', coalesce(v_updated_questionnaire, '{}'::jsonb)
      )
    );
  end if;

  if nullif(btrim(coalesce(v_current_plan.feeder, '')), '') is distinct from nullif(btrim(coalesce(v_updated_feeder, '')), '') then
    v_changes := v_changes || jsonb_build_object(
      'feeder',
      jsonb_build_object(
        'from', nullif(btrim(coalesce(v_current_plan.feeder, '')), ''),
        'to', nullif(btrim(coalesce(v_updated_feeder, '')), '')
      )
    );
  end if;

  if v_current_plan.sgd_type_id is distinct from v_updated_sgd_type_id then
    v_changes := v_changes || jsonb_build_object(
      'sgdTypeId',
      jsonb_build_object(
        'from', case when v_current_plan.sgd_type_id is null then null else v_current_plan.sgd_type_id::text end,
        'to', case when v_updated_sgd_type_id is null then null else v_updated_sgd_type_id::text end
      )
    );
  end if;

  if v_current_plan.cut_element is distinct from v_updated_cut_element then
    v_changes := v_changes || jsonb_build_object(
      'cutElement',
      jsonb_build_object(
        'from', v_current_plan.cut_element,
        'to', v_updated_cut_element
      )
    );
  end if;

  v_changes := v_changes || jsonb_build_object(
    'updatedAt',
    jsonb_build_object('from', v_current_plan.updated_at, 'to', v_updated_at)
  );

  v_snapshot_after := jsonb_build_object(
    'notes', coalesce(v_updated_notes, ''),
    'questionnaireAnswers', coalesce(v_updated_questionnaire, '{}'::jsonb),
    'feeder', nullif(btrim(coalesce(v_updated_feeder, '')), ''),
    'sgdTypeId', case when v_updated_sgd_type_id is null then null else v_updated_sgd_type_id::text end,
    'cutElement', v_updated_cut_element,
    'updatedAt', v_updated_at
  );

  perform public.append_project_location_plan_history_record(
    p_tenant_id,
    p_actor_user_id,
    v_plan_id,
    p_project_id,
    'UPDATE',
    null,
    v_changes,
    v_snapshot_before,
    v_snapshot_after,
    jsonb_build_object(
      'source', 'save_project_location_plan'
    )
  );

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'plan_id', v_plan_id,
    'updated_at', v_updated_at,
    'message', 'Locacao atualizada com sucesso.'
  );
end;
$$;

revoke all on function public.save_project_location_plan(uuid, uuid, uuid, text, jsonb, jsonb, timestamptz) from public;
grant execute on function public.save_project_location_plan(uuid, uuid, uuid, text, jsonb, jsonb, timestamptz) to authenticated;
grant execute on function public.save_project_location_plan(uuid, uuid, uuid, text, jsonb, jsonb, timestamptz) to service_role;
