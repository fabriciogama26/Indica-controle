-- 432_pi_prefill_and_supervisor_rule.sql
-- Tres mudancas de regra na PI, todas decididas com o usuario:
--
-- 1. A PI NASCE com os dados do contrato e do contato da distribuidora ja
--    preenchidos, em vez de campos vazios que alguem teria de redigitar.
-- 2. `Descricao das atividades` passa a herdar a DESCRICAO DO SERVICO da etapa,
--    e nao a lista de atividades. Divergencia consciente com a especificacao
--    inicial do modulo, confirmada pelo usuario: as atividades da etapa viram
--    linhas do Plano de Execucao, que e outra coisa.
-- 3. O Supervisor deixa de ser obrigatorio SEMPRE e passa a ser obrigatorio
--    apenas quando a etapa VINCULADA tem mais equipes que o limite configurado.
--    PI sem Programacao nao tem etapa para contar e nunca cai nesta regra.
--
-- Alem disso, a emissao passa a recusar Supervisor ou Encarregado cujo cargo
-- nao esteja entre os configurados. A tela ja filtra os selects; esta guarda
-- existe para uma chamada direta a API nao passar por cima da regra. Ela so
-- vale quando o papel tem ao menos um cargo configurado — contrato que ainda
-- nao configurou nao pode ficar impedido de emitir por isso.
--
-- Nenhuma assinatura muda: as duas funcoes sao `create or replace` sobre a
-- versao da migration 430.

-- =============================================================================
-- 1) `save_permission_intervention` — pre-preenchimento na criacao
-- =============================================================================
create or replace function public.save_permission_intervention(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_pi_id uuid default null,
  p_payload jsonb default '{}'::jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_insert boolean := p_pi_id is null;
  v_current public.permission_intervention%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_changes jsonb;
  v_pi_id uuid := p_pi_id;
  v_project_id uuid;
  v_work_date date;
  v_programming_id uuid;
  v_link_status text;
  v_creation_source text;
  v_snapshot jsonb;
  v_updated_at timestamptz;
  -- Valores iniciais, resolvidos SO na criacao.
  v_contract record;
  v_contact record;
  v_contact_source text;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'TENANT_OR_ACTOR_REQUIRED',
      'message', 'Tenant e usuario sao obrigatorios para salvar a PI.');
  end if;

  if v_is_insert then
    v_project_id := nullif(btrim(coalesce(p_payload ->> 'projectId', '')), '')::uuid;
    v_work_date := nullif(btrim(coalesce(p_payload ->> 'workDate', '')), '')::date;

    if v_project_id is null or v_work_date is null then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'MISSING_IDENTITY',
        'message', 'Projeto e data da etapa sao obrigatorios para criar a PI.');
    end if;

    if not exists (
      select 1 from public.project
      where tenant_id = p_tenant_id and id = v_project_id and is_active = true
    ) then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'PROJECT_NOT_FOUND',
        'message', 'Projeto nao encontrado ou inativo neste contrato.');
    end if;

    v_programming_id := public.pi_find_active_programming(p_tenant_id, v_project_id, v_work_date);
    v_link_status := case when v_programming_id is null then 'PENDING' else 'LINKED' end;
    v_creation_source := case
      when upper(coalesce(p_payload ->> 'creationSource', '')) = 'FROM_PROGRAMMING' then 'FROM_PROGRAMMING'
      else 'MANUAL'
    end;

    if v_programming_id is not null and v_creation_source = 'FROM_PROGRAMMING' then
      v_snapshot := public.pi_build_programming_snapshot(p_tenant_id, v_programming_id);
    else
      v_snapshot := null;
    end if;

    -- Contrato: uma linha por tenant desde a migration 413.
    select c.empresa, c.nome_gestor, c.email, c.telefone_corporativo, c."number"
    into v_contract
    from public.contract c
    where c.tenant_id = p_tenant_id
    limit 1;

    -- Contato da distribuidora, do cadastro que a configuracao apontar.
    select coalesce(s.utility_contact_source, 'RESPONSIBLE') into v_contact_source
    from public.pi_settings s where s.tenant_id = p_tenant_id;
    v_contact_source := coalesce(v_contact_source, 'RESPONSIBLE');

    if v_contact_source = 'FIELD_MANAGER' then
      select m.name, m.telefone_corporativo, m.email
      into v_contact
      from public.project p
      join public.project_utility_field_managers m
        on m.id = p.utility_field_manager and m.tenant_id = p.tenant_id
      where p.tenant_id = p_tenant_id and p.id = v_project_id;
    else
      select r.name, r.telefone_corporativo, r.email
      into v_contact
      from public.project p
      join public.project_utility_responsibles r
        on r.id = p.utility_responsible and r.tenant_id = p.tenant_id
      where p.tenant_id = p_tenant_id and p.id = v_project_id;
    end if;

    insert into public.permission_intervention (
      tenant_id, project_id, work_date, programming_id, creation_source, link_status, status,
      source_programming_snapshot, created_by, updated_by
    )
    values (
      p_tenant_id, v_project_id, v_work_date, v_programming_id, v_creation_source, v_link_status, 'DRAFT',
      v_snapshot, p_actor_user_id, p_actor_user_id
    )
    returning id into v_pi_id;
  else
    select * into v_current
    from public.permission_intervention
    where tenant_id = p_tenant_id and id = v_pi_id
    for update;

    if not found then
      return jsonb_build_object('success', false, 'status', 404, 'reason', 'PI_NOT_FOUND',
        'message', 'PI nao encontrada.');
    end if;

    if p_expected_updated_at is null then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
        'message', 'Atualize a tela antes de salvar a PI.');
    end if;

    if v_current.updated_at <> p_expected_updated_at then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONCURRENT_MODIFICATION',
        'message', 'Esta PI foi alterada por outro usuario. Recarregue antes de salvar.');
    end if;

    if v_current.status in ('ISSUED', 'CANCELLED') then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'PI_NOT_EDITABLE',
        'message', format('PI %s nao pode ser editada.',
          case when v_current.status = 'ISSUED' then 'ja emitida' else 'cancelada' end));
    end if;

    v_before := to_jsonb(v_current);
  end if;

  -- O payload continua sendo o conjunto COMPLETO dos campos editaveis: chave
  -- ausente grava NULO. A unica excecao e a CRIACAO, onde os campos de contrato
  -- e contato caem no valor inicial quando o payload nao os traz — e o que faz a
  -- PI nascer preenchida sem quebrar a regra de edicao.
  update public.permission_intervention set
    primary_operation_area_code = nullif(btrim(coalesce(p_payload ->> 'primaryOperationAreaCode', '')), ''),
    primary_voltage_level_code = nullif(btrim(coalesce(p_payload ->> 'primaryVoltageLevelCode', '')), ''),
    manager_name = case when v_is_insert
      then coalesce(nullif(btrim(coalesce(p_payload ->> 'managerName', '')), ''), v_contract.nome_gestor)
      else nullif(btrim(coalesce(p_payload ->> 'managerName', '')), '') end,
    company_name = case when v_is_insert
      then coalesce(nullif(btrim(coalesce(p_payload ->> 'companyName', '')), ''), v_contract.empresa)
      else nullif(btrim(coalesce(p_payload ->> 'companyName', '')), '') end,
    contract_number = case when v_is_insert
      then coalesce(nullif(btrim(coalesce(p_payload ->> 'contractNumber', '')), ''), v_contract."number")
      else nullif(btrim(coalesce(p_payload ->> 'contractNumber', '')), '') end,
    manager_phone = case when v_is_insert
      then coalesce(nullif(btrim(coalesce(p_payload ->> 'managerPhone', '')), ''), v_contract.telefone_corporativo)
      else nullif(btrim(coalesce(p_payload ->> 'managerPhone', '')), '') end,
    manager_email = case when v_is_insert
      then coalesce(nullif(btrim(coalesce(p_payload ->> 'managerEmail', '')), ''), v_contract.email)
      else nullif(btrim(coalesce(p_payload ->> 'managerEmail', '')), '') end,
    utility_contact_name = case when v_is_insert
      then coalesce(nullif(btrim(coalesce(p_payload ->> 'utilityContactName', '')), ''), v_contact.name)
      else nullif(btrim(coalesce(p_payload ->> 'utilityContactName', '')), '') end,
    utility_contact_phone = case when v_is_insert
      then coalesce(nullif(btrim(coalesce(p_payload ->> 'utilityContactPhone', '')), ''), v_contact.telefone_corporativo)
      else nullif(btrim(coalesce(p_payload ->> 'utilityContactPhone', '')), '') end,
    utility_contact_email = case when v_is_insert
      then coalesce(nullif(btrim(coalesce(p_payload ->> 'utilityContactEmail', '')), ''), v_contact.email)
      else nullif(btrim(coalesce(p_payload ->> 'utilityContactEmail', '')), '') end,
    activity_description = nullif(btrim(coalesce(p_payload ->> 'activityDescription', '')), ''),
    work_plan = nullif(btrim(coalesce(p_payload ->> 'workPlan', '')), ''),
    live_work_authorization = nullif(btrim(coalesce(p_payload ->> 'liveWorkAuthorization', '')), ''),
    pre_apr = nullif(btrim(coalesce(p_payload ->> 'preApr', '')), ''),
    emergency_authorization = nullif(btrim(coalesce(p_payload ->> 'emergencyAuthorization', '')), ''),
    start_time = nullif(btrim(coalesce(p_payload ->> 'startTime', '')), '')::time,
    end_date = nullif(btrim(coalesce(p_payload ->> 'endDate', '')), '')::date,
    end_time = nullif(btrim(coalesce(p_payload ->> 'endTime', '')), '')::time,
    secondary_date = nullif(btrim(coalesce(p_payload ->> 'secondaryDate', '')), '')::date,
    secondary_start_time = nullif(btrim(coalesce(p_payload ->> 'secondaryStartTime', '')), '')::time,
    installation_description = nullif(btrim(coalesce(p_payload ->> 'installationDescription', '')), ''),
    feeder = nullif(btrim(coalesce(p_payload ->> 'feeder', '')), ''),
    address = nullif(btrim(coalesce(p_payload ->> 'address', '')), ''),
    coord_x = nullif(btrim(coalesce(p_payload ->> 'coordX', '')), ''),
    coord_y = nullif(btrim(coalesce(p_payload ->> 'coordY', '')), ''),
    blocked_elements = nullif(btrim(coalesce(p_payload ->> 'blockedElements', '')), ''),
    cut_elements = nullif(btrim(coalesce(p_payload ->> 'cutElements', '')), ''),
    has_interfering_installation = case
      when jsonb_typeof(p_payload -> 'hasInterferingInstallation') = 'boolean'
        then (p_payload -> 'hasInterferingInstallation')::text::boolean
      else null
    end,
    interfering_description = nullif(btrim(coalesce(p_payload ->> 'interferingDescription', '')), ''),
    traffic_instructions = nullif(btrim(coalesce(p_payload ->> 'trafficInstructions', '')), ''),
    supervisor_person_id = nullif(btrim(coalesce(p_payload ->> 'supervisorPersonId', '')), '')::uuid,
    supervisor_alternate_person_id = nullif(btrim(coalesce(p_payload ->> 'supervisorAlternatePersonId', '')), '')::uuid,
    foreman_person_id = nullif(btrim(coalesce(p_payload ->> 'foremanPersonId', '')), '')::uuid,
    foreman_alternate_person_id = nullif(btrim(coalesce(p_payload ->> 'foremanAlternatePersonId', '')), '')::uuid,
    author_person_id = nullif(btrim(coalesce(p_payload ->> 'authorPersonId', '')), '')::uuid,
    validator_person_id = nullif(btrim(coalesce(p_payload ->> 'validatorPersonId', '')), '')::uuid,
    observations = nullif(btrim(coalesce(p_payload ->> 'observations', '')), ''),
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id and id = v_pi_id;

  update public.permission_intervention pi set
    supervisor_name_snapshot = (select nome from public.people where id = pi.supervisor_person_id and tenant_id = p_tenant_id),
    supervisor_alternate_name_snapshot = (select nome from public.people where id = pi.supervisor_alternate_person_id and tenant_id = p_tenant_id),
    foreman_name_snapshot = (select nome from public.people where id = pi.foreman_person_id and tenant_id = p_tenant_id),
    foreman_alternate_name_snapshot = (select nome from public.people where id = pi.foreman_alternate_person_id and tenant_id = p_tenant_id),
    author_name_snapshot = (select nome from public.people where id = pi.author_person_id and tenant_id = p_tenant_id),
    validator_name_snapshot = (select nome from public.people where id = pi.validator_person_id and tenant_id = p_tenant_id)
  where pi.tenant_id = p_tenant_id and pi.id = v_pi_id
  returning pi.updated_at into v_updated_at;

  delete from public.pi_operation_area_link where tenant_id = p_tenant_id and pi_id = v_pi_id;
  insert into public.pi_operation_area_link (tenant_id, pi_id, scope, area_code, created_by)
  select p_tenant_id, v_pi_id, 'PI', value, p_actor_user_id
  from jsonb_array_elements_text(coalesce(p_payload -> 'operationAreas', '[]'::jsonb)) as value
  on conflict do nothing;

  insert into public.pi_operation_area_link (tenant_id, pi_id, scope, area_code, created_by)
  select p_tenant_id, v_pi_id, 'CONTACT', value, p_actor_user_id
  from jsonb_array_elements_text(coalesce(p_payload -> 'contactOperationAreas', '[]'::jsonb)) as value
  on conflict do nothing;

  delete from public.pi_voltage_level_link where tenant_id = p_tenant_id and pi_id = v_pi_id;
  insert into public.pi_voltage_level_link (tenant_id, pi_id, scope, voltage_code, created_by)
  select p_tenant_id, v_pi_id, 'PI', value, p_actor_user_id
  from jsonb_array_elements_text(coalesce(p_payload -> 'voltageLevels', '[]'::jsonb)) as value
  on conflict do nothing;

  insert into public.pi_voltage_level_link (tenant_id, pi_id, scope, voltage_code, created_by)
  select p_tenant_id, v_pi_id, 'INTERFERING', value, p_actor_user_id
  from jsonb_array_elements_text(coalesce(p_payload -> 'interferingVoltageLevels', '[]'::jsonb)) as value
  on conflict do nothing;

  if v_is_insert then
    perform public.pi_append_history(
      p_tenant_id, v_pi_id, p_actor_user_id, 'CREATE', null, '{}'::jsonb,
      jsonb_build_object(
        'creationSource', v_creation_source,
        'linkStatus', v_link_status,
        'programmingId', v_programming_id,
        'utilityContactSource', v_contact_source
      )
    );
    if v_programming_id is not null and v_creation_source = 'MANUAL' then
      perform public.pi_append_history(
        p_tenant_id, v_pi_id, p_actor_user_id, 'LINK_AUTO', null, '{}'::jsonb,
        jsonb_build_object('programmingId', v_programming_id, 'trigger', 'SAVE_RECHECK')
      );
    end if;
  else
    select to_jsonb(pi) into v_after
    from public.permission_intervention pi
    where pi.tenant_id = p_tenant_id and pi.id = v_pi_id;

    select coalesce(jsonb_object_agg(
             field_key, jsonb_build_object('from', v_before -> field_key, 'to', v_after -> field_key)
           ), '{}'::jsonb)
    into v_changes
    from jsonb_object_keys(v_after) as field_key
    where (v_before -> field_key) is distinct from (v_after -> field_key)
      and field_key not in ('updated_at', 'updated_by');

    if v_changes <> '{}'::jsonb then
      perform public.pi_append_history(p_tenant_id, v_pi_id, p_actor_user_id, 'UPDATE', null, v_changes);
    end if;
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'pi_id', v_pi_id,
    'updated_at', v_updated_at,
    'link_status', coalesce(v_link_status, (select link_status from public.permission_intervention where id = v_pi_id and tenant_id = p_tenant_id)),
    'programming_id', v_programming_id,
    'message', case when v_is_insert then 'PI criada com sucesso.' else 'PI salva com sucesso.' end
  );
exception
  when invalid_text_representation or invalid_datetime_format then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_FIELD_FORMAT',
      'message', 'Ha campo de data, hora ou identificador com formato invalido.');
  when foreign_key_violation then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_REFERENCE',
      'message', 'Ha area, tensao ou pessoa que nao existe neste contrato.');
  when unique_violation then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'DUPLICATE_PI',
      'message', 'Ja existe uma PI ativa para este projeto nesta data.');
end;
$$;

revoke all on function public.save_permission_intervention(uuid, uuid, uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.save_permission_intervention(uuid, uuid, uuid, jsonb, timestamptz) to service_role;

-- =============================================================================
-- 2) `pi_validate_for_issue` — Supervisor condicional e cargo permitido
-- =============================================================================
-- Helper: a pessoa tem cargo habilitado para o papel?
create or replace function public.pi_person_has_role(
  p_tenant_id uuid,
  p_person_id uuid,
  p_role text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.people p
    join public.pi_role_job_titles r
      on r.tenant_id = p.tenant_id
     and r.job_title_id = p.job_title_id
    where p.tenant_id = p_tenant_id
      and p.id = p_person_id
      and r.role = p_role
  );
$$;

revoke all on function public.pi_person_has_role(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.pi_validate_for_issue(
  p_tenant_id uuid,
  p_pi_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pi public.permission_intervention%rowtype;
  v_settings public.pi_settings%rowtype;
  v_errors jsonb := '[]'::jsonb;
  v_area_count integer;
  v_voltage_count integer;
  v_step_count integer;
  v_team_count integer;
  v_has_template boolean;
  v_foreman_titles integer;
  v_supervisor_titles integer;
begin
  select * into v_pi
  from public.permission_intervention
  where tenant_id = p_tenant_id and id = p_pi_id;

  if not found then
    return jsonb_build_array(jsonb_build_object('code', 'PI_NOT_FOUND', 'message', 'PI nao encontrada.'));
  end if;

  select * into v_settings from public.pi_settings where tenant_id = p_tenant_id;
  if not found then
    v_errors := v_errors || jsonb_build_object(
      'code', 'SETTINGS_MISSING',
      'message', 'Configuracao da PI nao definida para este contrato.');
  elsif nullif(btrim(coalesce(v_settings.emergency_plan_text, '')), '') is null then
    v_errors := v_errors || jsonb_build_object(
      'code', 'EMERGENCY_PLAN_MISSING',
      'message', 'Plano de Emergencia nao configurado para este contrato.');
  end if;

  select exists (
    select 1 from public.pi_document_template
    where tenant_id = p_tenant_id and is_active = true
  ) into v_has_template;

  if not coalesce(v_has_template, false) then
    v_errors := v_errors || jsonb_build_object(
      'code', 'TEMPLATE_MISSING',
      'message', 'Nenhum template ativo neste contrato.');
  end if;

  select count(*) into v_area_count
  from public.pi_operation_area_link
  where tenant_id = p_tenant_id and pi_id = p_pi_id and scope = 'PI';

  if v_area_count = 0 then
    v_errors := v_errors || jsonb_build_object(
      'code', 'OPERATION_AREA_REQUIRED',
      'message', 'Marque ao menos uma Area de Atuacao.');
  elsif v_area_count > 1 and v_pi.primary_operation_area_code is null then
    v_errors := v_errors || jsonb_build_object(
      'code', 'PRIMARY_OPERATION_AREA_REQUIRED',
      'message', 'Ha mais de uma Area de Atuacao marcada. Escolha qual compoe o codigo da PI.');
  elsif v_pi.primary_operation_area_code is not null and not exists (
    select 1 from public.pi_operation_area_link
    where tenant_id = p_tenant_id and pi_id = p_pi_id and scope = 'PI'
      and area_code = v_pi.primary_operation_area_code
  ) then
    v_errors := v_errors || jsonb_build_object(
      'code', 'PRIMARY_OPERATION_AREA_NOT_SELECTED',
      'message', 'A Area de Atuacao escolhida para o codigo nao esta entre as marcadas.');
  end if;

  select count(*) into v_voltage_count
  from public.pi_voltage_level_link
  where tenant_id = p_tenant_id and pi_id = p_pi_id and scope = 'PI';

  if v_voltage_count = 0 then
    v_errors := v_errors || jsonb_build_object(
      'code', 'VOLTAGE_LEVEL_REQUIRED',
      'message', 'Marque ao menos um Nivel de Tensao.');
  elsif v_voltage_count > 1 and v_pi.primary_voltage_level_code is null then
    v_errors := v_errors || jsonb_build_object(
      'code', 'PRIMARY_VOLTAGE_LEVEL_REQUIRED',
      'message', 'Ha mais de um Nivel de Tensao marcado. Escolha qual compoe o codigo da PI.');
  elsif v_pi.primary_voltage_level_code is not null and not exists (
    select 1 from public.pi_voltage_level_link
    where tenant_id = p_tenant_id and pi_id = p_pi_id and scope = 'PI'
      and voltage_code = v_pi.primary_voltage_level_code
  ) then
    v_errors := v_errors || jsonb_build_object(
      'code', 'PRIMARY_VOLTAGE_LEVEL_NOT_SELECTED',
      'message', 'O Nivel de Tensao escolhido para o codigo nao esta entre os marcados.');
  end if;

  select count(*) into v_step_count
  from public.pi_execution_step
  where tenant_id = p_tenant_id and pi_id = p_pi_id;

  if v_step_count = 0 then
    v_errors := v_errors || jsonb_build_object(
      'code', 'EXECUTION_PLAN_EMPTY',
      'message', 'O Plano de Execucao precisa de ao menos uma etapa.');
  elsif v_step_count > 23 then
    v_errors := v_errors || jsonb_build_object(
      'code', 'EXECUTION_PLAN_OVERFLOW',
      'message', format('O Plano de Execucao tem %s etapas e o documento comporta 23. Reduza antes de emitir.', v_step_count));
  end if;

  if nullif(btrim(coalesce(v_pi.manager_name, '')), '') is null then
    v_errors := v_errors || jsonb_build_object('code', 'MANAGER_NAME_REQUIRED', 'message', 'Informe o Nome do Gestor.');
  end if;
  if nullif(btrim(coalesce(v_pi.company_name, '')), '') is null then
    v_errors := v_errors || jsonb_build_object('code', 'COMPANY_REQUIRED', 'message', 'Informe a Empresa.');
  end if;
  if nullif(btrim(coalesce(v_pi.contract_number, '')), '') is null then
    v_errors := v_errors || jsonb_build_object('code', 'CONTRACT_NUMBER_REQUIRED', 'message', 'Informe o N. do Contrato.');
  end if;
  if nullif(btrim(coalesce(v_pi.activity_description, '')), '') is null then
    v_errors := v_errors || jsonb_build_object('code', 'ACTIVITY_DESCRIPTION_REQUIRED', 'message', 'Informe a Descricao da atividade.');
  end if;
  if nullif(btrim(coalesce(v_pi.feeder, '')), '') is null then
    v_errors := v_errors || jsonb_build_object('code', 'FEEDER_REQUIRED', 'message', 'Informe o Alimentador.');
  end if;
  if nullif(btrim(coalesce(v_pi.address, '')), '') is null then
    v_errors := v_errors || jsonb_build_object('code', 'ADDRESS_REQUIRED', 'message', 'Informe o Endereco.');
  end if;
  if v_pi.foreman_person_id is null then
    v_errors := v_errors || jsonb_build_object('code', 'FOREMAN_REQUIRED', 'message', 'Informe o Encarregado de Trabalhos.');
  end if;

  -- Supervisor CONDICIONAL: exigido apenas quando a etapa vinculada tem mais
  -- equipes ativas que o limite configurado. PI sem Programacao nao tem etapa e
  -- nunca cai aqui.
  if v_pi.programming_id is not null and v_pi.supervisor_person_id is null then
    select count(*) into v_team_count
    from public.programming_team
    where tenant_id = p_tenant_id
      and programming_id = v_pi.programming_id
      and status = 'ATIVA';

    if coalesce(v_team_count, 0) > coalesce(v_settings.supervisor_required_team_count, 3) then
      v_errors := v_errors || jsonb_build_object(
        'code', 'SUPERVISOR_REQUIRED_FOR_TEAM_COUNT',
        'message', format(
          'A etapa vinculada tem %s equipes, acima do limite de %s configurado. Informe o Responsavel pela Intervencao.',
          v_team_count, coalesce(v_settings.supervisor_required_team_count, 3)));
    end if;
  end if;

  -- Cargo permitido. A tela ja filtra os selects; esta guarda impede que uma
  -- chamada direta a API passe por cima. So vale quando o papel tem cargo
  -- configurado — contrato que ainda nao configurou nao pode ficar travado.
  select count(*) into v_foreman_titles
  from public.pi_role_job_titles where tenant_id = p_tenant_id and role = 'FOREMAN';

  select count(*) into v_supervisor_titles
  from public.pi_role_job_titles where tenant_id = p_tenant_id and role = 'SUPERVISOR';

  if coalesce(v_foreman_titles, 0) > 0 then
    if v_pi.foreman_person_id is not null and not public.pi_person_has_role(p_tenant_id, v_pi.foreman_person_id, 'FOREMAN') then
      v_errors := v_errors || jsonb_build_object('code', 'FOREMAN_ROLE_INVALID',
        'message', 'O Encarregado escolhido nao tem cargo habilitado para a funcao.');
    end if;
    if v_pi.foreman_alternate_person_id is not null and not public.pi_person_has_role(p_tenant_id, v_pi.foreman_alternate_person_id, 'FOREMAN') then
      v_errors := v_errors || jsonb_build_object('code', 'FOREMAN_ALTERNATE_ROLE_INVALID',
        'message', 'O Suplente do Encarregado nao tem cargo habilitado para a funcao.');
    end if;
  end if;

  if coalesce(v_supervisor_titles, 0) > 0 then
    if v_pi.supervisor_person_id is not null and not public.pi_person_has_role(p_tenant_id, v_pi.supervisor_person_id, 'SUPERVISOR') then
      v_errors := v_errors || jsonb_build_object('code', 'SUPERVISOR_ROLE_INVALID',
        'message', 'O Responsavel pela Intervencao nao tem cargo habilitado para a funcao.');
    end if;
    if v_pi.supervisor_alternate_person_id is not null and not public.pi_person_has_role(p_tenant_id, v_pi.supervisor_alternate_person_id, 'SUPERVISOR') then
      v_errors := v_errors || jsonb_build_object('code', 'SUPERVISOR_ALTERNATE_ROLE_INVALID',
        'message', 'O Suplente do Supervisor nao tem cargo habilitado para a funcao.');
    end if;
  end if;

  return v_errors;
end;
$$;

revoke all on function public.pi_validate_for_issue(uuid, uuid) from public, anon, authenticated;

-- =============================================================================
-- 3) Verificacao
-- =============================================================================
do $$
begin
  if has_function_privilege('anon', 'public.save_permission_intervention(uuid, uuid, uuid, jsonb, timestamptz)'::regprocedure, 'execute')
     or has_function_privilege('authenticated', 'public.save_permission_intervention(uuid, uuid, uuid, jsonb, timestamptz)'::regprocedure, 'execute') then
    raise exception '432: save_permission_intervention ainda executavel por anon/authenticated';
  end if;

  if not has_function_privilege('service_role', 'public.save_permission_intervention(uuid, uuid, uuid, jsonb, timestamptz)'::regprocedure, 'execute') then
    raise exception '432: save_permission_intervention deveria continuar executavel por service_role';
  end if;

  if has_function_privilege('authenticated', 'public.pi_person_has_role(uuid, uuid, text)'::regprocedure, 'execute') then
    raise exception '432: pi_person_has_role nao deveria ser executavel por authenticated';
  end if;
end;
$$;
