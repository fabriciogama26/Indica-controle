-- 434_fix_pi_prefill_unassigned_record.sql
-- Segundo e ultimo defeito do pre-preenchimento da 432, encontrado pelo teste
-- de fumaca: `record "v_contract" is not assigned yet` ao EDITAR uma PI.
--
-- CAUSA
-- ---------------------------------------------------------------------------
-- `v_contract` e `v_contact` eram `record` atribuidos SOMENTE dentro do ramo
-- de criacao, mas referenciados no UPDATE que roda nos dois caminhos, dentro de
-- `case when v_is_insert then ... else ... end`.
--
-- O CASE do SQL e preguicoso nos RAMOS, mas o PL/pgSQL precisa resolver a
-- estrutura do `record` para montar a consulta, e um `record` sem atribuicao
-- nao tem estrutura nenhuma. O erro sai antes de o ramo ser escolhido — por
-- isso criar funcionava e editar quebrava.
--
-- CORRECAO
-- ---------------------------------------------------------------------------
-- Trocar os dois `record` por oito variaveis escalares `text`, que nascem NULL
-- e podem ser lidas em qualquer ramo sem estourar. O cast para `text` (que a
-- 433 introduziu por causa de `contract.telefone_corporativo` ser numeric)
-- passa para o proprio SELECT, onde fica mais claro.
--
-- Nenhuma regra de negocio muda e a assinatura continua a mesma.

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
  -- Escalares, e nao `record`: um `record` nao atribuido estoura ao ser
  -- referenciado, mesmo no ramo do CASE que nao e tomado. Era esse o defeito.
  v_contract_manager text;
  v_contract_company text;
  v_contract_number text;
  v_contract_phone text;
  v_contract_email text;
  v_contact_name text;
  v_contact_phone text;
  v_contact_email text;
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
    select c.nome_gestor::text, c.empresa::text, c."number"::text,
           c.telefone_corporativo::text, c.email::text
    into v_contract_manager, v_contract_company, v_contract_number,
         v_contract_phone, v_contract_email
    from public.contract c
    where c.tenant_id = p_tenant_id
    limit 1;

    -- Contato da distribuidora, do cadastro que a configuracao apontar.
    select coalesce(s.utility_contact_source, 'RESPONSIBLE') into v_contact_source
    from public.pi_settings s where s.tenant_id = p_tenant_id;
    v_contact_source := coalesce(v_contact_source, 'RESPONSIBLE');

    if v_contact_source = 'FIELD_MANAGER' then
      select m.name::text, m.telefone_corporativo::text, m.email::text
      into v_contact_name, v_contact_phone, v_contact_email
      from public.project p
      join public.project_utility_field_managers m
        on m.id = p.utility_field_manager and m.tenant_id = p.tenant_id
      where p.tenant_id = p_tenant_id and p.id = v_project_id;
    else
      select r.name::text, r.telefone_corporativo::text, r.email::text
      into v_contact_name, v_contact_phone, v_contact_email
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
      then coalesce(nullif(btrim(coalesce(p_payload ->> 'managerName', '')), ''), v_contract_manager)
      else nullif(btrim(coalesce(p_payload ->> 'managerName', '')), '') end,
    company_name = case when v_is_insert
      then coalesce(nullif(btrim(coalesce(p_payload ->> 'companyName', '')), ''), v_contract_company)
      else nullif(btrim(coalesce(p_payload ->> 'companyName', '')), '') end,
    contract_number = case when v_is_insert
      then coalesce(nullif(btrim(coalesce(p_payload ->> 'contractNumber', '')), ''), v_contract_number)
      else nullif(btrim(coalesce(p_payload ->> 'contractNumber', '')), '') end,
    manager_phone = case when v_is_insert
      then coalesce(nullif(btrim(coalesce(p_payload ->> 'managerPhone', '')), ''), v_contract_phone)
      else nullif(btrim(coalesce(p_payload ->> 'managerPhone', '')), '') end,
    manager_email = case when v_is_insert
      then coalesce(nullif(btrim(coalesce(p_payload ->> 'managerEmail', '')), ''), v_contract_email)
      else nullif(btrim(coalesce(p_payload ->> 'managerEmail', '')), '') end,
    utility_contact_name = case when v_is_insert
      then coalesce(nullif(btrim(coalesce(p_payload ->> 'utilityContactName', '')), ''), v_contact_name)
      else nullif(btrim(coalesce(p_payload ->> 'utilityContactName', '')), '') end,
    utility_contact_phone = case when v_is_insert
      then coalesce(nullif(btrim(coalesce(p_payload ->> 'utilityContactPhone', '')), ''), v_contact_phone)
      else nullif(btrim(coalesce(p_payload ->> 'utilityContactPhone', '')), '') end,
    utility_contact_email = case when v_is_insert
      then coalesce(nullif(btrim(coalesce(p_payload ->> 'utilityContactEmail', '')), ''), v_contact_email)
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
