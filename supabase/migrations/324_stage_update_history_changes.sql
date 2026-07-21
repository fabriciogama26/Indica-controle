-- 324_stage_update_history_changes.sql
-- Achado 12: as edicoes (UPDATE_STAGE) gravavam changes = {} — o historico
-- mostrava "houve edicao" mas nao O QUE mudou. Agora o save monta o diff De/Para
-- por campo de cadastro (comparando v_current com os novos valores normalizados)
-- e grava em programming_history.changes. Corpo identico ao da 318 (save) + a
-- montagem de v_changes no ramo de UPDATE. Equipes/atividades/documentos
-- seguem com seus proprios registros (ADD_TEAM/REMOVE_TEAM etc.).

create or replace function public.save_project_programming_stage(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_project_id uuid,
  p_execution_date date,
  p_team_ids uuid[] default null,
  p_programming_id uuid default null,
  p_expected_updated_at timestamptz default null,
  p_service_description text default null,
  p_period text default null,
  p_start_time time default null,
  p_end_time time default null,
  p_expected_minutes integer default null,
  p_outage_start_time time default null,
  p_outage_end_time time default null,
  p_feeder text default null,
  p_campo_eletrico text default null,
  p_affected_customers integer default null,
  p_sgd_type_id uuid default null,
  p_electrical_eq_catalog_id uuid default null,
  p_support text default null,
  p_support_item_id uuid default null,
  p_poste_qty numeric default null,
  p_estrutura_qty numeric default null,
  p_trafo_qty numeric default null,
  p_rede_qty numeric default null,
  p_note text default null,
  p_history_reason text default null,
  p_documents jsonb default '{}'::jsonb,
  p_activities jsonb default '[]'::jsonb,
  p_is_pendencia boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_insert boolean := p_programming_id is null;
  v_current record;
  v_programming_id uuid;
  v_updated_at timestamptz;
  v_team_id uuid;
  v_conflict record;
  v_pt_id uuid;
  v_activity_item jsonb;
  v_activity_catalog_id uuid;
  v_activity_quantity numeric;
  v_doc_number text;
  v_doc_included date;
  v_doc_delivered date;
  v_is_pendencia boolean := coalesce(p_is_pendencia, false);
  v_changes jsonb := '{}'::jsonb;
  v_old_json jsonb;
  v_new_json jsonb;
begin
  if p_project_id is null or p_execution_date is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'REQUIRED_FIELDS',
      'message', 'Projeto e data de execucao sao obrigatorios.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_project_id::text, 0));

  if not exists (
    select 1 from public.project pr
    where pr.id = p_project_id and pr.tenant_id = p_tenant_id
  ) then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'PROJECT_NOT_FOUND',
      'message', 'Projeto nao encontrado para este tenant.');
  end if;

  if not v_is_insert then
    select * into v_current
    from public.programming
    where id = p_programming_id and tenant_id = p_tenant_id
    for update;

    if v_current.id is null then
      return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROGRAMMING_NOT_FOUND',
        'message', 'Etapa nao encontrada para este tenant.');
    end if;

    if v_current.project_id <> p_project_id then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'PROJECT_MISMATCH',
        'message', 'A etapa nao pertence ao projeto informado.');
    end if;

    if v_current.execution_date is distinct from p_execution_date then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'DATE_CHANGE_NOT_ALLOWED',
        'message', 'Para mudar a data use Adiar; edicao nao muda a data da etapa.');
    end if;

    if p_expected_updated_at is not null and v_current.updated_at <> p_expected_updated_at then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONFLICT',
        'message', 'A etapa foi alterada por outro usuario. Recarregue antes de salvar.',
        'currentUpdatedAt', v_current.updated_at);
    end if;
  end if;

  -- Trava de projeto CONCLUIDO com excecao de pendencia (secao 4.2/9): no INSERT
  -- vale a flag recebida; no UPDATE vale a flag ja gravada na etapa.
  if not (case when v_is_insert then v_is_pendencia else v_current.is_pendencia end)
     and coalesce(public.programming_project_has_active_completion(p_tenant_id, p_project_id), false) then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'PROJECT_COMPLETED_REQUIRES_REOPEN',
      'message', 'Projeto concluido: reabra antes de inserir ou editar o plano.');
  end if;

  -- Validacao de TODAS as equipes antes de qualquer escrita.
  if p_team_ids is not null then
    foreach v_team_id in array p_team_ids
    loop
      if not exists (
        select 1 from public.teams t
        where t.id = v_team_id and t.tenant_id = p_tenant_id and t.ativo = true
      ) then
        return jsonb_build_object('success', false, 'status', 400, 'reason', 'TEAM_NOT_FOUND',
          'message', 'Equipe nao encontrada ou inativa para este tenant.');
      end if;

      select * into v_conflict
      from public.programming_team_schedule_conflict(
        p_tenant_id, v_team_id, p_execution_date, p_start_time, p_end_time, p_programming_id
      )
      limit 1;

      if v_conflict.programming_id is not null then
        return jsonb_build_object('success', false, 'status', 409, 'reason', 'TEAM_TIME_CONFLICT',
          'message', 'Uma das equipes ja tem alocacao ativa com horario sobreposto nesta data.');
      end if;
    end loop;
  end if;

  -- Validacao de TODAS as atividades antes de qualquer escrita.
  if p_activities is not null and jsonb_typeof(p_activities) = 'array' then
    for v_activity_item in select value from jsonb_array_elements(p_activities)
    loop
      v_activity_catalog_id := nullif(btrim(coalesce(v_activity_item ->> 'catalogId', '')), '')::uuid;

      begin
        v_activity_quantity := nullif(btrim(coalesce(v_activity_item ->> 'quantity', '')), '')::numeric;
      exception when others then
        return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_ACTIVITY_QUANTITY',
          'message', 'Quantidade de atividade invalida.');
      end;

      if v_activity_catalog_id is null or v_activity_quantity is null or v_activity_quantity <= 0 then
        return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_ACTIVITY',
          'message', 'Atividade ou quantidade invalida.');
      end if;

      if not exists (
        select 1 from public.service_activities sa
        where sa.id = v_activity_catalog_id and sa.tenant_id = p_tenant_id and sa.ativo = true
      ) then
        return jsonb_build_object('success', false, 'status', 400, 'reason', 'ACTIVITY_NOT_FOUND',
          'message', 'Atividade nao encontrada ou inativa para este tenant.');
      end if;
    end loop;
  end if;

  if v_is_insert then
    insert into public.programming (
      tenant_id, project_id, execution_date, status, work_completion_status, is_pendencia,
      service_description, period, start_time, end_time, expected_minutes,
      outage_start_time, outage_end_time, feeder, campo_eletrico, affected_customers,
      sgd_type_id, electrical_eq_catalog_id, support, support_item_id,
      poste_qty, estrutura_qty, trafo_qty, rede_qty, note,
      created_by, updated_by
    ) values (
      p_tenant_id, p_project_id, p_execution_date, 'PROGRAMADA', null, v_is_pendencia,
      nullif(btrim(coalesce(p_service_description, '')), ''), p_period, p_start_time, p_end_time, p_expected_minutes,
      p_outage_start_time, p_outage_end_time, nullif(btrim(coalesce(p_feeder, '')), ''),
      nullif(btrim(coalesce(p_campo_eletrico, '')), ''), p_affected_customers,
      p_sgd_type_id, p_electrical_eq_catalog_id, nullif(btrim(coalesce(p_support, '')), ''), p_support_item_id,
      p_poste_qty, p_estrutura_qty, p_trafo_qty, p_rede_qty, nullif(btrim(coalesce(p_note, '')), ''),
      p_actor_user_id, p_actor_user_id
    )
    returning id, updated_at into v_programming_id, v_updated_at;

    perform public.append_programming_history_record(
      p_tenant_id, v_programming_id, null, p_actor_user_id, 'CREATE_STAGE', p_history_reason
    );
  else
    -- F12: monta o diff De/Para dos campos de cadastro (v_current = valor antigo)
    -- para o historico UPDATE_STAGE. Chaves camelCase = HISTORY_FIELD_LABELS.
    v_old_json := jsonb_build_object(
      'serviceDescription', v_current.service_description,
      'period', v_current.period,
      'startTime', v_current.start_time,
      'endTime', v_current.end_time,
      'expectedMinutes', v_current.expected_minutes,
      'outageStartTime', v_current.outage_start_time,
      'outageEndTime', v_current.outage_end_time,
      'feeder', v_current.feeder,
      'campoEletrico', v_current.campo_eletrico,
      'affectedCustomers', v_current.affected_customers,
      'sgdTypeId', v_current.sgd_type_id,
      'electricalEqCatalogId', v_current.electrical_eq_catalog_id,
      'support', v_current.support,
      'supportItemId', v_current.support_item_id,
      'posteQty', v_current.poste_qty,
      'estruturaQty', v_current.estrutura_qty,
      'trafoQty', v_current.trafo_qty,
      'redeQty', v_current.rede_qty,
      'note', v_current.note
    );
    v_new_json := jsonb_build_object(
      'serviceDescription', nullif(btrim(coalesce(p_service_description, '')), ''),
      'period', p_period,
      'startTime', p_start_time,
      'endTime', p_end_time,
      'expectedMinutes', p_expected_minutes,
      'outageStartTime', p_outage_start_time,
      'outageEndTime', p_outage_end_time,
      'feeder', nullif(btrim(coalesce(p_feeder, '')), ''),
      'campoEletrico', nullif(btrim(coalesce(p_campo_eletrico, '')), ''),
      'affectedCustomers', p_affected_customers,
      'sgdTypeId', p_sgd_type_id,
      'electricalEqCatalogId', p_electrical_eq_catalog_id,
      'support', nullif(btrim(coalesce(p_support, '')), ''),
      'supportItemId', p_support_item_id,
      'posteQty', p_poste_qty::numeric(14,2),
      'estruturaQty', p_estrutura_qty::numeric(14,2),
      'trafoQty', p_trafo_qty::numeric(14,2),
      'redeQty', p_rede_qty::numeric(14,2),
      'note', nullif(btrim(coalesce(p_note, '')), '')
    );
    select coalesce(jsonb_object_agg(k.key, jsonb_build_object('from', v_old_json -> k.key, 'to', v_new_json -> k.key)), '{}'::jsonb)
    into v_changes
    from jsonb_object_keys(v_new_json) as k(key)
    where (v_old_json -> k.key) is distinct from (v_new_json -> k.key);

    update public.programming
    set
      service_description = nullif(btrim(coalesce(p_service_description, '')), ''),
      period = p_period,
      start_time = p_start_time,
      end_time = p_end_time,
      expected_minutes = p_expected_minutes,
      outage_start_time = p_outage_start_time,
      outage_end_time = p_outage_end_time,
      feeder = nullif(btrim(coalesce(p_feeder, '')), ''),
      campo_eletrico = nullif(btrim(coalesce(p_campo_eletrico, '')), ''),
      affected_customers = p_affected_customers,
      sgd_type_id = p_sgd_type_id,
      electrical_eq_catalog_id = p_electrical_eq_catalog_id,
      support = nullif(btrim(coalesce(p_support, '')), ''),
      support_item_id = p_support_item_id,
      poste_qty = p_poste_qty,
      estrutura_qty = p_estrutura_qty,
      trafo_qty = p_trafo_qty,
      rede_qty = p_rede_qty,
      note = nullif(btrim(coalesce(p_note, '')), ''),
      updated_by = p_actor_user_id
    where id = p_programming_id and tenant_id = p_tenant_id
    returning id, updated_at into v_programming_id, v_updated_at;

    perform public.append_programming_history_record(
      p_tenant_id, v_programming_id, null, p_actor_user_id, 'UPDATE_STAGE', p_history_reason, v_changes
    );
  end if;

  if p_team_ids is not null then
    update public.programming_team
    set status = 'REMOVIDA', updated_by = p_actor_user_id
    where programming_id = v_programming_id
      and tenant_id = p_tenant_id
      and status = 'ATIVA'
      and not (team_id = any (p_team_ids));

    foreach v_team_id in array p_team_ids
    loop
      if exists (
        select 1 from public.programming_team pt
        where pt.programming_id = v_programming_id and pt.tenant_id = p_tenant_id
          and pt.team_id = v_team_id and pt.status = 'ATIVA'
      ) then
        continue;
      end if;

      insert into public.programming_team (programming_id, tenant_id, team_id, status, created_by, updated_by)
      values (v_programming_id, p_tenant_id, v_team_id, 'ATIVA', p_actor_user_id, p_actor_user_id)
      returning id into v_pt_id;

      perform public.append_programming_history_record(
        p_tenant_id, v_programming_id, v_pt_id, p_actor_user_id, 'ADD_TEAM'
      );
    end loop;
  end if;

  if p_activities is not null and jsonb_typeof(p_activities) = 'array' then
    update public.programming_activity
    set is_active = false, updated_by = p_actor_user_id
    where programming_id = v_programming_id
      and tenant_id = p_tenant_id
      and is_active = true
      and not (
        service_activity_id = any (
          select (value ->> 'catalogId')::uuid
          from jsonb_array_elements(p_activities)
        )
      );

    for v_activity_item in select value from jsonb_array_elements(p_activities)
    loop
      v_activity_catalog_id := (v_activity_item ->> 'catalogId')::uuid;
      v_activity_quantity := (v_activity_item ->> 'quantity')::numeric;

      update public.programming_activity
      set quantity = v_activity_quantity, is_active = true, updated_by = p_actor_user_id
      where programming_id = v_programming_id and tenant_id = p_tenant_id
        and service_activity_id = v_activity_catalog_id;

      if not found then
        insert into public.programming_activity (
          programming_id, tenant_id, service_activity_id, quantity, is_active, created_by, updated_by
        ) values (
          v_programming_id, p_tenant_id, v_activity_catalog_id, v_activity_quantity, true, p_actor_user_id, p_actor_user_id
        );
      end if;
    end loop;
  end if;

  v_doc_number := nullif(btrim(coalesce(p_documents -> 'sgd' ->> 'number', '')), '');
  v_doc_included := nullif(p_documents -> 'sgd' ->> 'includedAt', '')::date;
  v_doc_delivered := nullif(p_documents -> 'sgd' ->> 'deliveredAt', '')::date;
  if v_doc_number is null and v_doc_included is null and v_doc_delivered is null then
    delete from public.programming_document
      where programming_id = v_programming_id and tenant_id = p_tenant_id and document_type = 'SGD';
  else
    insert into public.programming_document (programming_id, tenant_id, document_type, number, included_at, delivered_at, created_by, updated_by)
    values (v_programming_id, p_tenant_id, 'SGD', v_doc_number, v_doc_included, v_doc_delivered, p_actor_user_id, p_actor_user_id)
    on conflict (programming_id, document_type) do update
    set number = excluded.number, included_at = excluded.included_at, delivered_at = excluded.delivered_at,
        updated_by = excluded.updated_by, updated_at = now();
  end if;

  v_doc_number := nullif(btrim(coalesce(p_documents -> 'pi' ->> 'number', '')), '');
  v_doc_included := nullif(p_documents -> 'pi' ->> 'includedAt', '')::date;
  v_doc_delivered := nullif(p_documents -> 'pi' ->> 'deliveredAt', '')::date;
  if v_doc_number is null and v_doc_included is null and v_doc_delivered is null then
    delete from public.programming_document
      where programming_id = v_programming_id and tenant_id = p_tenant_id and document_type = 'PI';
  else
    insert into public.programming_document (programming_id, tenant_id, document_type, number, included_at, delivered_at, created_by, updated_by)
    values (v_programming_id, p_tenant_id, 'PI', v_doc_number, v_doc_included, v_doc_delivered, p_actor_user_id, p_actor_user_id)
    on conflict (programming_id, document_type) do update
    set number = excluded.number, included_at = excluded.included_at, delivered_at = excluded.delivered_at,
        updated_by = excluded.updated_by, updated_at = now();
  end if;

  v_doc_number := nullif(btrim(coalesce(p_documents -> 'pep' ->> 'number', '')), '');
  v_doc_included := nullif(p_documents -> 'pep' ->> 'includedAt', '')::date;
  v_doc_delivered := nullif(p_documents -> 'pep' ->> 'deliveredAt', '')::date;
  if v_doc_number is null and v_doc_included is null and v_doc_delivered is null then
    delete from public.programming_document
      where programming_id = v_programming_id and tenant_id = p_tenant_id and document_type = 'PEP';
  else
    insert into public.programming_document (programming_id, tenant_id, document_type, number, included_at, delivered_at, created_by, updated_by)
    values (v_programming_id, p_tenant_id, 'PEP', v_doc_number, v_doc_included, v_doc_delivered, p_actor_user_id, p_actor_user_id)
    on conflict (programming_id, document_type) do update
    set number = excluded.number, included_at = excluded.included_at, delivered_at = excluded.delivered_at,
        updated_by = excluded.updated_by, updated_at = now();
  end if;

  perform public.reclassify_project_programming_stages(p_tenant_id, p_project_id, p_actor_user_id);

  select updated_at into v_updated_at from public.programming where id = v_programming_id;

  return jsonb_build_object(
    'success', true, 'status', 200,
    'action', case when v_is_insert then 'INSERT' else 'UPDATE' end,
    'programming_id', v_programming_id,
    'updated_at', v_updated_at,
    'message', case when v_is_insert then 'Etapa criada com sucesso.' else 'Etapa atualizada com sucesso.' end
  );
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'UNIQUE_STAGE_PER_DATE',
      'message', 'Ja existe uma etapa para este projeto nesta data.');
end;
$$;


-- Hardening de grants (reaplica por seguranca).
do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = 'save_project_programming_stage'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);

    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '324: funcao % ainda executavel por anon/authenticated', v_fn;
    end if;
  end loop;
end;
$$;
