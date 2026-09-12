-- 430_create_permission_intervention_rpcs.sql
-- Fase 1 da Permissao de Intervencao, parte 3 de 3: as RPCs de escrita.
--
-- NADA AQUI ESCREVE NA PROGRAMACAO. `programming` e suas filhas sao lidas para
-- montar snapshot e resolver vinculo, nunca alteradas. A fase que altera a
-- Programacao e separada e posterior.
--
-- POR QUE O CADASTRO RECEBE `jsonb` E NAO 40 PARAMETROS
-- ---------------------------------------------------------------------------
-- A PI tem cerca de 40 campos editaveis. Com parametros explicitos, acrescentar
-- um campo exige DROP + CREATE da funcao (a assinatura muda), e este
-- repositorio ja sofreu com isso em `save_project_programming_stage`, que
-- acumulou patches dinamicos sobre o corpo original. Com um `jsonb`, a
-- assinatura fica estavel e o contrato vive documentado aqui. Precedente no
-- projeto: a migration 107 ja le `questionnaire_answers` por `jsonb` na Locacao.
--
-- CONTRATO DO PAYLOAD: e o conjunto COMPLETO dos campos editaveis. Chave
-- ausente vale como NULO, nao como "nao mexer". O formulario sempre envia tudo;
-- assim nao existe o caso ambiguo de limpar um campo versus omiti-lo.
--
-- VALIDACAO: estas RPCs enforcam apenas os ERROS que impedem a emissao. Os
-- AVISOS de divergencia (encarregado, equipe, atividade, alimentador, horario
-- diferentes da Programacao) sao de LEITURA e ficam na camada Node, comparando
-- `source_programming_snapshot` com o estado atual — divergir nunca bloqueia.

-- =============================================================================
-- 1) Helpers internos
-- =============================================================================

-- Etapa ATIVA daquele projeto naquela data, ou NULL.
--
-- O indice parcial `programming_active_project_date_key` (migration 346)
-- garante no maximo UMA etapa ativa por projeto+data, entao esta busca nunca e
-- ambigua e nao precisa de desempate. Etapa CANCELADA, ADIADA ou ANTECIPADA
-- pode coexistir na mesma data e NAO serve para vincular.
create or replace function public.pi_find_active_programming(
  p_tenant_id uuid,
  p_project_id uuid,
  p_work_date date
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.programming p
  where p.tenant_id = p_tenant_id
    and p.project_id = p_project_id
    and p.execution_date = p_work_date
    and p.status in ('PROGRAMADA', 'REPROGRAMADA')
  limit 1;
$$;

revoke all on function public.pi_find_active_programming(uuid, uuid, date) from public, anon, authenticated;

-- Fotografia da etapa no momento em que a PI nasce dela. Imutavel a partir
-- dali: e contra ela que a divergencia e medida depois.
create or replace function public.pi_build_programming_snapshot(
  p_tenant_id uuid,
  p_programming_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'programmingId', p.id,
    'capturedAt', now(),
    'executionDate', p.execution_date,
    'status', p.status,
    'workCompletionStatus', p.work_completion_status,
    'isPendencia', p.is_pendencia,
    -- Classificacao NO MOMENTO da captura. Guardada so para leitura humana do
    -- historico: ela e derivada de posicao e muda sozinha quando outra etapa do
    -- projeto e cancelada ou adiada. NUNCA usar para reencontrar a etapa.
    'etapaNumber', p.etapa_number,
    'etapaUnica', p.etapa_unica,
    'etapaFinal', p.etapa_final,
    'serviceDescription', p.service_description,
    'feeder', p.feeder,
    'campoEletrico', p.campo_eletrico,
    'startTime', p.start_time,
    'endTime', p.end_time,
    'outageStartTime', p.outage_start_time,
    'outageEndTime', p.outage_end_time,
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
        'teamId', pt.team_id,
        'teamName', t.name,
        'foremanPersonId', pt.programmed_foreman_person_id,
        'foremanName', coalesce(pt.programmed_foreman_name_snapshot, pe.nome)
      ) order by t.name)
      from public.programming_team pt
      join public.teams t on t.id = pt.team_id and t.tenant_id = pt.tenant_id
      left join public.people pe on pe.id = pt.programmed_foreman_person_id and pe.tenant_id = pt.tenant_id
      where pt.programming_id = p.id
        and pt.tenant_id = p.tenant_id
        and pt.status = 'ATIVA'
    ), '[]'::jsonb),
    'activities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'serviceActivityId', pa.service_activity_id,
        'code', sa.code,
        'description', sa.description,
        'unit', sa.unit,
        'quantity', pa.quantity
      ) order by sa.code)
      from public.programming_activity pa
      join public.service_activities sa on sa.id = pa.service_activity_id and sa.tenant_id = pa.tenant_id
      where pa.programming_id = p.id
        and pa.tenant_id = p.tenant_id
        and pa.is_active = true
    ), '[]'::jsonb)
  )
  from public.programming p
  where p.tenant_id = p_tenant_id
    and p.id = p_programming_id;
$$;

revoke all on function public.pi_build_programming_snapshot(uuid, uuid) from public, anon, authenticated;

create or replace function public.pi_append_history(
  p_tenant_id uuid,
  p_pi_id uuid,
  p_actor_user_id uuid,
  p_action_type text,
  p_reason text default null,
  p_changes jsonb default '{}'::jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.pi_history (tenant_id, pi_id, action_type, reason, changes, metadata, created_by)
  values (
    p_tenant_id,
    p_pi_id,
    p_action_type,
    nullif(btrim(coalesce(p_reason, '')), ''),
    coalesce(p_changes, '{}'::jsonb),
    coalesce(p_metadata, '{}'::jsonb),
    p_actor_user_id
  );
$$;

revoke all on function public.pi_append_history(uuid, uuid, uuid, text, text, jsonb, jsonb) from public, anon, authenticated;

-- Erros que IMPEDEM a emissao. Devolve array jsonb; vazio significa liberado.
--
-- Area e tensao principais so sao exigidas quando ha MAIS DE UMA marcada. Com
-- uma so, a propria emissao resolve — cobrar escolha de um conjunto de um item
-- seria burocracia sem informacao nova.
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
  v_has_template boolean;
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

  -- Campos obrigatorios do documento. Cobrados SO na emissao: o rascunho existe
  -- justamente para ser salvo incompleto.
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
  if v_pi.supervisor_person_id is null then
    v_errors := v_errors || jsonb_build_object('code', 'SUPERVISOR_REQUIRED', 'message', 'Informe o Responsavel pela Intervencao.');
  end if;
  if v_pi.foreman_person_id is null then
    v_errors := v_errors || jsonb_build_object('code', 'FOREMAN_REQUIRED', 'message', 'Informe o Encarregado de Trabalhos.');
  end if;

  return v_errors;
end;
$$;

revoke all on function public.pi_validate_for_issue(uuid, uuid) from public, anon, authenticated;

-- =============================================================================
-- 2) `save_permission_intervention` — cria e edita
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
  v_person uuid;
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

    -- Reconsulta DENTRO da transacao: fecha a janela de corrida em que o
    -- usuario comeca uma PI manual e outra pessoa cria a Programacao daquela
    -- data antes de ele salvar. Checagem so no frontend nao resolveria.
    v_programming_id := public.pi_find_active_programming(p_tenant_id, v_project_id, v_work_date);
    v_link_status := case when v_programming_id is null then 'PENDING' else 'LINKED' end;
    v_creation_source := case
      when upper(coalesce(p_payload ->> 'creationSource', '')) = 'FROM_PROGRAMMING' then 'FROM_PROGRAMMING'
      else 'MANUAL'
    end;

    -- Snapshot so quando a PI NASCE de uma etapa. Uma PI manual que encontrou a
    -- etapa na hora de salvar fica vinculada, mas sem snapshot: ela nao herdou
    -- nada, entao nao ha "origem" contra a qual medir divergencia.
    if v_programming_id is not null and v_creation_source = 'FROM_PROGRAMMING' then
      v_snapshot := public.pi_build_programming_snapshot(p_tenant_id, v_programming_id);
    else
      v_snapshot := null;
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

  -- Atualizacao dos campos editaveis. O payload e o conjunto COMPLETO: chave
  -- ausente grava NULO.
  update public.permission_intervention set
    primary_operation_area_code = nullif(btrim(coalesce(p_payload ->> 'primaryOperationAreaCode', '')), ''),
    primary_voltage_level_code = nullif(btrim(coalesce(p_payload ->> 'primaryVoltageLevelCode', '')), ''),
    manager_name = nullif(btrim(coalesce(p_payload ->> 'managerName', '')), ''),
    company_name = nullif(btrim(coalesce(p_payload ->> 'companyName', '')), ''),
    contract_number = nullif(btrim(coalesce(p_payload ->> 'contractNumber', '')), ''),
    manager_phone = nullif(btrim(coalesce(p_payload ->> 'managerPhone', '')), ''),
    manager_email = nullif(btrim(coalesce(p_payload ->> 'managerEmail', '')), ''),
    utility_contact_name = nullif(btrim(coalesce(p_payload ->> 'utilityContactName', '')), ''),
    utility_contact_phone = nullif(btrim(coalesce(p_payload ->> 'utilityContactPhone', '')), ''),
    utility_contact_email = nullif(btrim(coalesce(p_payload ->> 'utilityContactEmail', '')), ''),
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
    -- `null` aqui e "nao informado", e deixa as DUAS caixas do documento vazias.
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

  -- Snapshot do nome de cada pessoa referenciada. Renomear alguem depois nao
  -- pode reescrever uma PI ja emitida — mesmo padrao da migration 400.
  update public.permission_intervention pi set
    supervisor_name_snapshot = (select nome from public.people where id = pi.supervisor_person_id and tenant_id = p_tenant_id),
    supervisor_alternate_name_snapshot = (select nome from public.people where id = pi.supervisor_alternate_person_id and tenant_id = p_tenant_id),
    foreman_name_snapshot = (select nome from public.people where id = pi.foreman_person_id and tenant_id = p_tenant_id),
    foreman_alternate_name_snapshot = (select nome from public.people where id = pi.foreman_alternate_person_id and tenant_id = p_tenant_id),
    author_name_snapshot = (select nome from public.people where id = pi.author_person_id and tenant_id = p_tenant_id),
    validator_name_snapshot = (select nome from public.people where id = pi.validator_person_id and tenant_id = p_tenant_id)
  where pi.tenant_id = p_tenant_id and pi.id = v_pi_id
  returning pi.updated_at into v_updated_at;

  -- Areas e tensoes marcadas: substituicao completa dos dois escopos.
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
        'programmingId', v_programming_id
      )
    );
    if v_programming_id is not null and v_creation_source = 'MANUAL' then
      -- A PI foi aberta sem Programacao e encontrou a etapa na hora de salvar.
      perform public.pi_append_history(
        p_tenant_id, v_pi_id, p_actor_user_id, 'LINK_AUTO', null, '{}'::jsonb,
        jsonb_build_object('programmingId', v_programming_id, 'trigger', 'SAVE_RECHECK')
      );
    end if;
  else
    select to_jsonb(pi) into v_after
    from public.permission_intervention pi
    where pi.tenant_id = p_tenant_id and pi.id = v_pi_id;

    -- Diff generico: comparar 40 campos a mao ficaria desatualizado na primeira
    -- coluna nova. `updated_at`/`updated_by` mudam sempre e nao sao alteracao.
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
-- 3) `save_pi_execution_steps` — substitui o Plano de Execucao inteiro
-- =============================================================================
-- Substituicao completa em vez de diff linha a linha: o plano e ordenado e
-- reordenavel, e casar linha existente com linha nova exigiria um id estavel
-- que a tela nao tem enquanto o usuario arrasta. A unique DEFERRABLE permite o
-- estado intermediario duplicado dentro da transacao.
create or replace function public.save_pi_execution_steps(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_pi_id uuid,
  p_steps jsonb default '[]'::jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.permission_intervention%rowtype;
  v_before integer;
  v_after integer;
  v_updated_at timestamptz;
begin
  if p_tenant_id is null or p_actor_user_id is null or p_pi_id is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'TENANT_OR_ACTOR_REQUIRED',
      'message', 'Tenant, usuario e PI sao obrigatorios.');
  end if;

  select * into v_current
  from public.permission_intervention
  where tenant_id = p_tenant_id and id = p_pi_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'PI_NOT_FOUND', 'message', 'PI nao encontrada.');
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
      'message', 'Atualize a tela antes de salvar o Plano de Execucao.');
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONCURRENT_MODIFICATION',
      'message', 'Esta PI foi alterada por outro usuario. Recarregue antes de salvar.');
  end if;

  if v_current.status in ('ISSUED', 'CANCELLED') then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'PI_NOT_EDITABLE',
      'message', 'O Plano de Execucao de uma PI emitida ou cancelada nao pode ser alterado.');
  end if;

  select count(*) into v_before from public.pi_execution_step
  where tenant_id = p_tenant_id and pi_id = p_pi_id;

  delete from public.pi_execution_step where tenant_id = p_tenant_id and pi_id = p_pi_id;

  insert into public.pi_execution_step (
    tenant_id, pi_id, sort_order, work_zone, team_id, team_name_snapshot, activity, origin, created_by, updated_by
  )
  select
    p_tenant_id,
    p_pi_id,
    (ordinality)::smallint,
    nullif(btrim(coalesce(step ->> 'workZone', '')), ''),
    nullif(btrim(coalesce(step ->> 'teamId', '')), '')::uuid,
    coalesce(
      (select t.name from public.teams t
       where t.tenant_id = p_tenant_id
         and t.id = nullif(btrim(coalesce(step ->> 'teamId', '')), '')::uuid),
      nullif(btrim(coalesce(step ->> 'teamName', '')), '')
    ),
    nullif(btrim(coalesce(step ->> 'activity', '')), ''),
    case upper(coalesce(step ->> 'origin', ''))
      when 'TEMPLATE' then 'TEMPLATE'
      when 'PROGRAMMING' then 'PROGRAMMING'
      else 'MANUAL'
    end,
    p_actor_user_id,
    p_actor_user_id
  from jsonb_array_elements(coalesce(p_steps, '[]'::jsonb)) with ordinality as t(step, ordinality);

  select count(*) into v_after from public.pi_execution_step
  where tenant_id = p_tenant_id and pi_id = p_pi_id;

  -- Toca a PI para o `expectedUpdatedAt` da tela acompanhar a mudanca do plano.
  update public.permission_intervention
  set updated_by = p_actor_user_id
  where tenant_id = p_tenant_id and id = p_pi_id
  returning updated_at into v_updated_at;

  perform public.pi_append_history(
    p_tenant_id, p_pi_id, p_actor_user_id, 'UPDATE_EXECUTION_PLAN', null,
    jsonb_build_object('stepCount', jsonb_build_object('from', v_before::text, 'to', v_after::text))
  );

  return jsonb_build_object(
    'success', true, 'status', 200, 'pi_id', p_pi_id, 'updated_at', v_updated_at,
    'step_count', v_after,
    'message', format('Plano de Execucao salvo com %s etapa(s).', v_after)
  );
exception
  when invalid_text_representation then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_FIELD_FORMAT',
      'message', 'Ha equipe com identificador invalido no Plano de Execucao.');
  when foreign_key_violation then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_REFERENCE',
      'message', 'Ha equipe que nao existe neste contrato.');
end;
$$;

revoke all on function public.save_pi_execution_steps(uuid, uuid, uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.save_pi_execution_steps(uuid, uuid, uuid, jsonb, timestamptz) to service_role;

-- =============================================================================
-- 4) `set_permission_intervention_status`
-- =============================================================================
-- Transicoes: DRAFT <-> READY, READY -> ISSUED, qualquer -> CANCELLED.
--
-- ISSUE exige READY de proposito. E o unico ponto que queima numero de
-- documento oficial, e um passo explicito de "revisada" antes disso vale mais
-- do que a economia de um clique.
create or replace function public.set_permission_intervention_status(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_pi_id uuid,
  p_action text,
  p_reason text default null,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.permission_intervention%rowtype;
  v_action text := upper(nullif(btrim(coalesce(p_action, '')), ''));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_errors jsonb;
  v_settings public.pi_settings%rowtype;
  v_sequence bigint;
  v_code text;
  v_area_token text;
  v_voltage_token text;
  v_area_code text;
  v_voltage_code text;
  v_template public.pi_document_template%rowtype;
  v_next_status text;
  v_updated_at timestamptz;
begin
  if p_tenant_id is null or p_actor_user_id is null or p_pi_id is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'TENANT_OR_ACTOR_REQUIRED',
      'message', 'Tenant, usuario e PI sao obrigatorios.');
  end if;

  if v_action is null or v_action not in ('READY', 'REOPEN', 'ISSUE', 'CANCEL') then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_ACTION',
      'message', 'Acao invalida para a PI.');
  end if;

  select * into v_current
  from public.permission_intervention
  where tenant_id = p_tenant_id and id = p_pi_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'PI_NOT_FOUND', 'message', 'PI nao encontrada.');
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
      'message', 'Atualize a tela antes de mudar o status da PI.');
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONCURRENT_MODIFICATION',
      'message', 'Esta PI foi alterada por outro usuario. Recarregue antes de continuar.');
  end if;

  if v_current.status = 'CANCELLED' then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'PI_CANCELLED',
      'message', 'PI cancelada nao aceita mudanca de status.');
  end if;

  if v_action = 'CANCEL' then
    if v_reason is null then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'CANCELLATION_REASON_REQUIRED',
        'message', 'Informe o motivo do cancelamento.');
    end if;

    update public.permission_intervention
    set status = 'CANCELLED', cancellation_reason = v_reason, cancelled_at = now(),
        cancelled_by = p_actor_user_id, updated_by = p_actor_user_id
    where tenant_id = p_tenant_id and id = p_pi_id
    returning updated_at into v_updated_at;

    perform public.pi_append_history(p_tenant_id, p_pi_id, p_actor_user_id, 'CANCEL', v_reason,
      jsonb_build_object('status', jsonb_build_object('from', v_current.status, 'to', 'CANCELLED')));

    return jsonb_build_object('success', true, 'status', 200, 'pi_id', p_pi_id,
      'updated_at', v_updated_at, 'pi_status', 'CANCELLED', 'message', 'PI cancelada com sucesso.');
  end if;

  if v_current.status = 'ISSUED' then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'PI_ALREADY_ISSUED',
      'message', 'PI ja emitida. Para desfazer, cancele e crie outra.');
  end if;

  if v_action = 'REOPEN' then
    if v_current.status <> 'READY' then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'INVALID_TRANSITION',
        'message', 'So uma PI marcada como pronta pode voltar para rascunho.');
    end if;
    v_next_status := 'DRAFT';
  elsif v_action = 'READY' then
    if v_current.status <> 'DRAFT' then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'INVALID_TRANSITION',
        'message', 'So um rascunho pode ser marcado como pronto.');
    end if;
    v_errors := public.pi_validate_for_issue(p_tenant_id, p_pi_id);
    if jsonb_array_length(v_errors) > 0 then
      return jsonb_build_object('success', false, 'status', 422, 'reason', 'VALIDATION_FAILED',
        'message', 'A PI tem pendencias que impedem a emissao.', 'errors', v_errors);
    end if;
    v_next_status := 'READY';
  else
    if v_current.status <> 'READY' then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'INVALID_TRANSITION',
        'message', 'Marque a PI como pronta antes de emitir.');
    end if;

    v_errors := public.pi_validate_for_issue(p_tenant_id, p_pi_id);
    if jsonb_array_length(v_errors) > 0 then
      return jsonb_build_object('success', false, 'status', 422, 'reason', 'VALIDATION_FAILED',
        'message', 'A PI tem pendencias que impedem a emissao.', 'errors', v_errors);
    end if;

    select * into v_settings from public.pi_settings where tenant_id = p_tenant_id;
    select * into v_template from public.pi_document_template
    where tenant_id = p_tenant_id and is_active = true limit 1;

    -- Com uma so marcada, a escolha e obvia e a emissao resolve sozinha.
    v_area_code := coalesce(v_current.primary_operation_area_code, (
      select area_code from public.pi_operation_area_link
      where tenant_id = p_tenant_id and pi_id = p_pi_id and scope = 'PI' limit 1));
    v_voltage_code := coalesce(v_current.primary_voltage_level_code, (
      select voltage_code from public.pi_voltage_level_link
      where tenant_id = p_tenant_id and pi_id = p_pi_id and scope = 'PI' limit 1));

    select code_token into v_area_token from public.pi_operation_areas
    where tenant_id = p_tenant_id and code = v_area_code;
    select code_token into v_voltage_token from public.pi_voltage_levels
    where tenant_id = p_tenant_id and code = v_voltage_code;

    if v_area_token is null or v_voltage_token is null then
      return jsonb_build_object('success', false, 'status', 422, 'reason', 'CODE_COMPONENTS_MISSING',
        'message', 'Nao foi possivel resolver a area ou a tensao que compoem o codigo da PI.');
    end if;

    -- Sequencial sob lock de linha. Dois usuarios emitindo ao mesmo tempo
    -- serializam aqui; o segundo so prossegue depois do commit do primeiro. Se
    -- a emissao falhar adiante, o incremento sofre rollback junto e nao abre
    -- buraco na numeracao.
    update public.pi_sequence_counter
    set last_value = last_value + 1, updated_at = now(), updated_by = p_actor_user_id
    where tenant_id = p_tenant_id
    returning last_value into v_sequence;

    if v_sequence is null then
      return jsonb_build_object('success', false, 'status', 422, 'reason', 'SEQUENCE_NOT_CONFIGURED',
        'message', 'Contador do codigo da PI nao configurado para este contrato.');
    end if;

    v_code := concat_ws('-',
      v_settings.code_prefix,
      v_voltage_token,
      v_area_token,
      v_settings.company_code,
      lpad(v_sequence::text, v_settings.sequence_digits, '0')
    );

    update public.permission_intervention set
      status = 'ISSUED',
      pi_sequence = v_sequence,
      pi_code = v_code,
      primary_operation_area_code = v_area_code,
      primary_voltage_level_code = v_voltage_code,
      -- Snapshot do Plano de Emergencia e do template: o documento tem de
      -- continuar reconstruivel depois de qualquer um dos dois mudar.
      emergency_plan_snapshot = v_settings.emergency_plan_text,
      emergency_plan_version_snapshot = v_settings.emergency_plan_version,
      issued_template_id = v_template.id,
      issued_template_version = v_template.version,
      issued_template_checksum = v_template.checksum_sha256,
      issued_at = now(),
      issued_by = p_actor_user_id,
      prepared_at = coalesce(v_current.prepared_at, now()),
      updated_by = p_actor_user_id
    where tenant_id = p_tenant_id and id = p_pi_id
    returning updated_at into v_updated_at;

    perform public.pi_append_history(p_tenant_id, p_pi_id, p_actor_user_id, 'ISSUE', null,
      jsonb_build_object(
        'status', jsonb_build_object('from', v_current.status, 'to', 'ISSUED'),
        'piCode', jsonb_build_object('from', null, 'to', v_code)
      ),
      jsonb_build_object(
        'sequence', v_sequence,
        'templateVersion', v_template.version,
        'templateChecksum', v_template.checksum_sha256,
        'emergencyPlanVersion', v_settings.emergency_plan_version
      ));

    return jsonb_build_object('success', true, 'status', 200, 'pi_id', p_pi_id,
      'updated_at', v_updated_at, 'pi_status', 'ISSUED', 'pi_code', v_code, 'pi_sequence', v_sequence,
      'message', format('PI emitida com o codigo %s.', v_code));
  end if;

  update public.permission_intervention
  set status = v_next_status, updated_by = p_actor_user_id
  where tenant_id = p_tenant_id and id = p_pi_id
  returning updated_at into v_updated_at;

  perform public.pi_append_history(p_tenant_id, p_pi_id, p_actor_user_id,
    case when v_next_status = 'READY' then 'MARK_READY' else 'REOPEN' end, v_reason,
    jsonb_build_object('status', jsonb_build_object('from', v_current.status, 'to', v_next_status)));

  return jsonb_build_object('success', true, 'status', 200, 'pi_id', p_pi_id,
    'updated_at', v_updated_at, 'pi_status', v_next_status,
    'message', case when v_next_status = 'READY' then 'PI marcada como pronta.' else 'PI devolvida para rascunho.' end);
end;
$$;

revoke all on function public.set_permission_intervention_status(uuid, uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.set_permission_intervention_status(uuid, uuid, uuid, text, text, timestamptz) to service_role;

-- =============================================================================
-- 5) `link_permission_intervention_to_programming` — vinculo explicito
-- =============================================================================
-- O vinculo NUNCA sobrescreve dado da PI: cria apenas o relacionamento. Quando
-- a PI nasceu sem Programacao, ela ja tem os valores que o usuario preencheu, e
-- a Programacao tem os dela; o sistema passa a poder comparar as duas, nao a
-- substituir uma pela outra.
create or replace function public.link_permission_intervention_to_programming(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_pi_id uuid,
  p_programming_id uuid default null,
  p_reason text default null,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.permission_intervention%rowtype;
  v_programming public.programming%rowtype;
  v_target_id uuid := p_programming_id;
  v_updated_at timestamptz;
begin
  if p_tenant_id is null or p_actor_user_id is null or p_pi_id is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'TENANT_OR_ACTOR_REQUIRED',
      'message', 'Tenant, usuario e PI sao obrigatorios.');
  end if;

  select * into v_current
  from public.permission_intervention
  where tenant_id = p_tenant_id and id = p_pi_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'PI_NOT_FOUND', 'message', 'PI nao encontrada.');
  end if;

  if p_expected_updated_at is null or v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONCURRENT_MODIFICATION',
      'message', 'Esta PI foi alterada por outro usuario. Recarregue antes de vincular.');
  end if;

  if v_current.status = 'CANCELLED' then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'PI_CANCELLED',
      'message', 'PI cancelada nao aceita vinculo.');
  end if;

  -- Sem etapa informada, procura a ativa daquela data.
  if v_target_id is null then
    v_target_id := public.pi_find_active_programming(p_tenant_id, v_current.project_id, v_current.work_date);
    if v_target_id is null then
      return jsonb_build_object('success', false, 'status', 404, 'reason', 'NO_ACTIVE_PROGRAMMING',
        'message', 'Nao ha etapa ativa da Programacao para este projeto nesta data.');
    end if;
  end if;

  select * into v_programming
  from public.programming
  where tenant_id = p_tenant_id and id = v_target_id;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROGRAMMING_NOT_FOUND',
      'message', 'Etapa da Programacao nao encontrada neste contrato.');
  end if;

  if v_programming.project_id <> v_current.project_id or v_programming.execution_date is distinct from v_current.work_date then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'PROGRAMMING_MISMATCH',
      'message', 'A etapa escolhida e de outro projeto ou de outra data.');
  end if;

  -- `is not null` explicito: com `programming_id` nulo, `NULL = uuid` devolve
  -- NULL e o `IF` nao dispara. O efeito seria o desejado por acidente, e a
  -- regra 20 do guia_sql existe para nao depender disso.
  if v_current.programming_id is not null and v_current.programming_id = v_target_id then
    return jsonb_build_object('success', true, 'status', 200, 'pi_id', p_pi_id,
      'updated_at', v_current.updated_at, 'message', 'A PI ja estava vinculada a esta etapa.');
  end if;

  -- Trocar um vinculo existente e decisao humana e fica registrada. O sistema
  -- nunca faz essa troca sozinho, nem quando a etapa antiga sai do plano.
  if v_current.programming_id is not null and nullif(btrim(coalesce(p_reason, '')), '') is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'RELINK_REASON_REQUIRED',
      'message', 'Informe o motivo para trocar a etapa vinculada a esta PI.');
  end if;

  update public.permission_intervention set
    programming_id = v_target_id,
    link_status = case
      when v_programming.status in ('PROGRAMADA', 'REPROGRAMADA') then 'LINKED'
      else 'ATTENTION'
    end,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id and id = p_pi_id
  returning updated_at into v_updated_at;

  perform public.pi_append_history(
    p_tenant_id, p_pi_id, p_actor_user_id,
    case when v_current.programming_id is null then 'LINK_MANUAL' else 'RELINK' end,
    nullif(btrim(coalesce(p_reason, '')), ''),
    jsonb_build_object(
      'programmingId', jsonb_build_object('from', v_current.programming_id, 'to', v_target_id),
      'linkStatus', jsonb_build_object('from', v_current.link_status,
        'to', case when v_programming.status in ('PROGRAMADA', 'REPROGRAMADA') then 'LINKED' else 'ATTENTION' end)
    ),
    jsonb_build_object('programmingStatus', v_programming.status)
  );

  return jsonb_build_object('success', true, 'status', 200, 'pi_id', p_pi_id,
    'updated_at', v_updated_at, 'programming_id', v_target_id, 'message', 'Vinculo com a Programacao atualizado.');
end;
$$;

revoke all on function public.link_permission_intervention_to_programming(uuid, uuid, uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.link_permission_intervention_to_programming(uuid, uuid, uuid, uuid, text, timestamptz) to service_role;

-- =============================================================================
-- 6) Verificacao
-- =============================================================================
do $$
declare
  v_fn text;
  v_signatures text[] := array[
    'public.pi_find_active_programming(uuid, uuid, date)',
    'public.pi_build_programming_snapshot(uuid, uuid)',
    'public.pi_append_history(uuid, uuid, uuid, text, text, jsonb, jsonb)',
    'public.pi_validate_for_issue(uuid, uuid)',
    'public.save_permission_intervention(uuid, uuid, uuid, jsonb, timestamptz)',
    'public.save_pi_execution_steps(uuid, uuid, uuid, jsonb, timestamptz)',
    'public.set_permission_intervention_status(uuid, uuid, uuid, text, text, timestamptz)',
    'public.link_permission_intervention_to_programming(uuid, uuid, uuid, uuid, text, timestamptz)'
  ];
begin
  foreach v_fn in array v_signatures
  loop
    if has_function_privilege('anon', v_fn::regprocedure, 'execute')
       or has_function_privilege('authenticated', v_fn::regprocedure, 'execute') then
      raise exception '430: % ainda executavel por anon/authenticated', v_fn;
    end if;
  end loop;

  -- Os quatro helpers internos nao sao chamados pela aplicacao e nao recebem
  -- grant nenhum; as quatro RPCs publicas rodam so como service_role.
  foreach v_fn in array array[
    'public.save_permission_intervention(uuid, uuid, uuid, jsonb, timestamptz)',
    'public.save_pi_execution_steps(uuid, uuid, uuid, jsonb, timestamptz)',
    'public.set_permission_intervention_status(uuid, uuid, uuid, text, text, timestamptz)',
    'public.link_permission_intervention_to_programming(uuid, uuid, uuid, uuid, text, timestamptz)'
  ]
  loop
    if not has_function_privilege('service_role', v_fn::regprocedure, 'execute') then
      raise exception '430: % deveria ser executavel por service_role', v_fn;
    end if;
  end loop;
end;
$$;
