-- 400_programming_team_programmed_foreman_snapshot.sql
-- A Programacao passa a guardar o encarregado planejado da alocacao.
-- Esse snapshot nao segue automaticamente alteracoes posteriores em `teams`.

begin;

alter table if exists public.programming_team
  add column if not exists programmed_foreman_person_id uuid,
  add column if not exists programmed_foreman_name_snapshot text;

alter table if exists public.programming_team
  drop constraint if exists programming_team_programmed_foreman_person_fk;

alter table if exists public.programming_team
  add constraint programming_team_programmed_foreman_person_fk
  foreign key (programmed_foreman_person_id, tenant_id)
  references public.people(id, tenant_id);

alter table if exists public.programming_team
  drop constraint if exists programming_team_programmed_foreman_name_not_blank;

alter table if exists public.programming_team
  add constraint programming_team_programmed_foreman_name_not_blank
  check (programmed_foreman_name_snapshot is null or btrim(programmed_foreman_name_snapshot) <> '');

create index if not exists idx_programming_team_tenant_programmed_foreman
  on public.programming_team (tenant_id, programmed_foreman_person_id)
  where programmed_foreman_person_id is not null;

-- Backfill historico pelo momento em que a alocacao foi criada, nao pela data de
-- execucao. A regra de negocio e "quem estava previsto quando programou".
with candidate as (
  select
    pt.id,
    pt.tenant_id,
    coalesce(fh.foreman_person_id, t.foreman_person_id) as foreman_id,
    coalesce(
      nullif(btrim(fh.foreman_name_snapshot), ''),
      nullif(btrim(p.nome), ''),
      'Nao identificado'
    ) as foreman_name
  from public.programming_team pt
  join public.teams t
    on t.id = pt.team_id
   and t.tenant_id = pt.tenant_id
  left join lateral (
    select h.foreman_person_id, h.foreman_name_snapshot
    from public.team_foreman_history h
    where h.tenant_id = pt.tenant_id
      and h.team_id = pt.team_id
      and h.valid_from <= coalesce(pt.created_at::date, current_date)
      and (h.valid_to is null or h.valid_to >= coalesce(pt.created_at::date, current_date))
    order by h.valid_from desc, h.created_at desc
    limit 1
  ) fh on true
  left join public.people p
    on p.id = coalesce(fh.foreman_person_id, t.foreman_person_id)
   and p.tenant_id = pt.tenant_id
  where pt.programmed_foreman_person_id is null
)
update public.programming_team pt
set
  programmed_foreman_person_id = candidate.foreman_id,
  programmed_foreman_name_snapshot = candidate.foreman_name
from candidate
where pt.id = candidate.id
  and candidate.foreman_id is not null;

create or replace function public.resolve_programmed_foreman_for_team(
  p_tenant_id uuid,
  p_team_id uuid,
  p_foreman_person_id uuid default null
)
returns table(foreman_person_id uuid, foreman_name text)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id as foreman_person_id,
    nullif(btrim(p.nome), '') as foreman_name
  from public.teams t
  join public.people p
    on p.id = coalesce(p_foreman_person_id, t.foreman_person_id)
   and p.tenant_id = t.tenant_id
   and p.ativo = true
  join public.job_titles jt
    on jt.id = p.job_title_id
   and jt.tenant_id = p.tenant_id
   and jt.ativo = true
   and (
     upper(coalesce(jt.code, '')) like '%ENCARREGADO%'
     or upper(coalesce(jt.name, '')) like '%ENCARREGADO%'
   )
  where t.id = p_team_id
    and t.tenant_id = p_tenant_id
    and t.ativo = true
  limit 1
$$;

drop function if exists public.save_project_programming_stage(
  uuid, uuid, uuid, date, uuid[], uuid, timestamptz, text, text, time, time,
  integer, time, time, text, text, integer, uuid, uuid, text, uuid, numeric,
  numeric, numeric, numeric, text, text, jsonb, jsonb, boolean
);

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
  p_is_pendencia boolean default false,
  p_team_foremen jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_insert boolean := p_programming_id is null;
  v_current public.programming%rowtype;
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
  v_pendencia_exception boolean;
  v_changes jsonb := '{}'::jsonb;
  v_old_json jsonb;
  v_new_json jsonb;
  v_team_row public.teams%rowtype;
  v_existing_team_row public.programming_team%rowtype;
  v_foreman_raw text;
  v_foreman_key_present boolean;
  v_programmed_foreman_id uuid;
  v_programmed_foreman_name text;
  v_history_reason text := nullif(btrim(coalesce(p_history_reason, '')), '');
begin
  if p_project_id is null or p_execution_date is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'REQUIRED_FIELDS',
      'message', 'Projeto e data de execucao sao obrigatorios.');
  end if;

  if p_team_foremen is not null and jsonb_typeof(p_team_foremen) <> 'object' then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_PROGRAMMED_FOREMAN',
      'message', 'Mapa de encarregados programados invalido.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_project_id::text, 0));

  if not exists (
    select 1 from public.project pr
    where pr.id = p_project_id and pr.tenant_id = p_tenant_id
  ) then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'PROJECT_NOT_FOUND',
      'message', 'Projeto nao encontrado para este tenant.');
  end if;

  if v_is_insert then
    v_pendencia_exception := v_is_pendencia;
  else
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

    v_pendencia_exception := coalesce(v_current.is_pendencia, false);
  end if;

  if not v_pendencia_exception
     and coalesce(public.programming_project_has_active_completion(p_tenant_id, p_project_id), false) then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'PROJECT_COMPLETED_REQUIRES_REOPEN',
      'message', 'Projeto concluido: reabra antes de inserir ou editar o plano.');
  end if;

  if p_team_ids is not null then
    foreach v_team_id in array p_team_ids
    loop
      select * into v_team_row
      from public.teams t
      where t.id = v_team_id and t.tenant_id = p_tenant_id and t.ativo = true;

      if v_team_row.id is null then
        return jsonb_build_object('success', false, 'status', 400, 'reason', 'TEAM_NOT_FOUND',
          'message', 'Equipe nao encontrada ou inativa para este tenant.');
      end if;

      v_programmed_foreman_id := null;
      v_programmed_foreman_name := null;
      v_foreman_raw := nullif(btrim(coalesce(p_team_foremen ->> v_team_id::text, '')), '');
      v_foreman_key_present := coalesce(p_team_foremen ? v_team_id::text, false);

      select * into v_existing_team_row
      from public.programming_team pt
      where pt.programming_id = p_programming_id
        and pt.tenant_id = p_tenant_id
        and pt.team_id = v_team_id
        and pt.status = 'ATIVA'
      limit 1;

      if v_existing_team_row.id is not null and not v_foreman_key_present then
        v_programmed_foreman_id := v_existing_team_row.programmed_foreman_person_id;
        v_programmed_foreman_name := v_existing_team_row.programmed_foreman_name_snapshot;
      elsif v_foreman_key_present and v_foreman_raw is null then
        return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_PROGRAMMED_FOREMAN',
          'message', 'Selecione o encarregado programado para uma das equipes.');
      elsif v_foreman_key_present and v_foreman_raw is not null then
        begin
          v_programmed_foreman_id := v_foreman_raw::uuid;
        exception when invalid_text_representation then
          return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_PROGRAMMED_FOREMAN',
            'message', 'Encarregado programado invalido para uma das equipes.');
        end;
      else
        v_programmed_foreman_id := v_team_row.foreman_person_id;
      end if;

      if v_existing_team_row.id is not null and not v_foreman_key_present then
        null;
      elsif v_existing_team_row.id is not null
         and v_programmed_foreman_id is not distinct from v_existing_team_row.programmed_foreman_person_id
         and v_existing_team_row.programmed_foreman_name_snapshot is not null then
        v_programmed_foreman_name := v_existing_team_row.programmed_foreman_name_snapshot;
      else
        select rf.foreman_person_id, rf.foreman_name
          into v_programmed_foreman_id, v_programmed_foreman_name
        from public.resolve_programmed_foreman_for_team(p_tenant_id, v_team_id, v_programmed_foreman_id) rf
        limit 1;
      end if;

      if not (v_existing_team_row.id is not null and not v_foreman_key_present)
         and (v_programmed_foreman_id is null or nullif(btrim(coalesce(v_programmed_foreman_name, '')), '') is null) then
        return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_PROGRAMMED_FOREMAN',
          'message', 'Encarregado programado invalido ou inativo para uma das equipes.');
      end if;

      if v_existing_team_row.id is not null
         and v_existing_team_row.programmed_foreman_person_id is distinct from v_programmed_foreman_id
         and v_history_reason is null then
        return jsonb_build_object('success', false, 'status', 400, 'reason', 'REASON_REQUIRED',
          'message', 'Informe o motivo da alteracao do encarregado programado.');
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
      select * into v_team_row
      from public.teams t
      where t.id = v_team_id and t.tenant_id = p_tenant_id and t.ativo = true;

      select * into v_existing_team_row
      from public.programming_team pt
      where pt.programming_id = v_programming_id
        and pt.tenant_id = p_tenant_id
        and pt.team_id = v_team_id
        and pt.status = 'ATIVA'
      limit 1;

      v_programmed_foreman_id := null;
      v_programmed_foreman_name := null;
      v_foreman_raw := nullif(btrim(coalesce(p_team_foremen ->> v_team_id::text, '')), '');
      v_foreman_key_present := coalesce(p_team_foremen ? v_team_id::text, false);

      if v_existing_team_row.id is not null and not v_foreman_key_present then
        v_programmed_foreman_id := v_existing_team_row.programmed_foreman_person_id;
        v_programmed_foreman_name := v_existing_team_row.programmed_foreman_name_snapshot;
      elsif v_foreman_key_present and v_foreman_raw is null then
        raise exception 'INVALID_PROGRAMMED_FOREMAN';
      elsif v_foreman_key_present and v_foreman_raw is not null then
        v_programmed_foreman_id := v_foreman_raw::uuid;
      else
        v_programmed_foreman_id := v_team_row.foreman_person_id;
      end if;

      if v_existing_team_row.id is not null and not v_foreman_key_present then
        null;
      elsif v_existing_team_row.id is not null
         and v_programmed_foreman_id is not distinct from v_existing_team_row.programmed_foreman_person_id
         and v_existing_team_row.programmed_foreman_name_snapshot is not null then
        v_programmed_foreman_name := v_existing_team_row.programmed_foreman_name_snapshot;
      else
        select rf.foreman_person_id, rf.foreman_name
          into v_programmed_foreman_id, v_programmed_foreman_name
        from public.resolve_programmed_foreman_for_team(p_tenant_id, v_team_id, v_programmed_foreman_id) rf
        limit 1;
      end if;

      if v_existing_team_row.id is not null then
        if v_existing_team_row.programmed_foreman_person_id is distinct from v_programmed_foreman_id then
          update public.programming_team
          set
            programmed_foreman_person_id = v_programmed_foreman_id,
            programmed_foreman_name_snapshot = v_programmed_foreman_name,
            updated_by = p_actor_user_id
          where id = v_existing_team_row.id and tenant_id = p_tenant_id;

          perform public.append_programming_history_record(
            p_tenant_id, v_programming_id, v_existing_team_row.id, p_actor_user_id, 'UPDATE_PROGRAMMED_FOREMAN', v_history_reason,
            jsonb_build_object(
              'programmedForeman', jsonb_build_object('from', v_existing_team_row.programmed_foreman_name_snapshot, 'to', v_programmed_foreman_name),
              'programmedForemanId', jsonb_build_object('from', v_existing_team_row.programmed_foreman_person_id, 'to', v_programmed_foreman_id)
            )
          );
        end if;
        continue;
      end if;

      insert into public.programming_team (
        programming_id, tenant_id, team_id, status,
        programmed_foreman_person_id, programmed_foreman_name_snapshot,
        created_by, updated_by
      )
      values (
        v_programming_id, p_tenant_id, v_team_id, 'ATIVA',
        v_programmed_foreman_id, v_programmed_foreman_name,
        p_actor_user_id, p_actor_user_id
      )
      returning id into v_pt_id;

      perform public.append_programming_history_record(
        p_tenant_id, v_programming_id, v_pt_id, p_actor_user_id, 'ADD_TEAM', null,
        jsonb_build_object(
          'teamId', v_team_id,
          'programmedForeman', v_programmed_foreman_name,
          'programmedForemanId', v_programmed_foreman_id
        )
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

drop function if exists public.add_project_programming_team(uuid, uuid, uuid, uuid);

create or replace function public.add_project_programming_team(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_id uuid,
  p_team_id uuid,
  p_programmed_foreman_person_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stage record;
  v_conflict record;
  v_pt_id uuid;
  v_programmed_foreman_id uuid;
  v_programmed_foreman_name text;
begin
  select * into v_stage
  from public.programming
  where id = p_programming_id and tenant_id = p_tenant_id
  for update;

  if v_stage.id is null then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROGRAMMING_NOT_FOUND',
      'message', 'Etapa nao encontrada para este tenant.');
  end if;

  if v_stage.status not in ('PROGRAMADA', 'REPROGRAMADA') then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'STAGE_NOT_ACTIVE',
      'message', 'Somente etapas ativas podem receber equipe.');
  end if;

  if not v_stage.is_pendencia
     and coalesce(public.programming_project_has_active_completion(p_tenant_id, v_stage.project_id), false) then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'PROJECT_COMPLETED_REQUIRES_REOPEN',
      'message', 'Projeto concluido: reabra antes de adicionar equipe.');
  end if;

  if not exists (
    select 1 from public.teams t where t.id = p_team_id and t.tenant_id = p_tenant_id and t.ativo = true
  ) then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'TEAM_NOT_FOUND',
      'message', 'Equipe nao encontrada ou inativa para este tenant.');
  end if;

  select rf.foreman_person_id, rf.foreman_name
    into v_programmed_foreman_id, v_programmed_foreman_name
  from public.resolve_programmed_foreman_for_team(p_tenant_id, p_team_id, p_programmed_foreman_person_id) rf
  limit 1;

  if v_programmed_foreman_id is null or nullif(btrim(coalesce(v_programmed_foreman_name, '')), '') is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_PROGRAMMED_FOREMAN',
      'message', 'Encarregado programado invalido ou inativo para esta equipe.');
  end if;

  if exists (
    select 1 from public.programming_team pt
    where pt.programming_id = p_programming_id and pt.tenant_id = p_tenant_id
      and pt.team_id = p_team_id and pt.status = 'ATIVA'
  ) then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'TEAM_ALREADY_ACTIVE',
      'message', 'Equipe ja esta alocada nesta etapa.');
  end if;

  select * into v_conflict
  from public.programming_team_schedule_conflict(
    p_tenant_id, p_team_id, v_stage.execution_date, v_stage.start_time, v_stage.end_time, null
  )
  limit 1;

  if v_conflict.programming_id is not null then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'TEAM_TIME_CONFLICT',
      'message', 'Equipe ja tem alocacao ativa com horario sobreposto nesta data.');
  end if;

  insert into public.programming_team (
    programming_id, tenant_id, team_id, status,
    programmed_foreman_person_id, programmed_foreman_name_snapshot,
    created_by, updated_by
  )
  values (
    p_programming_id, p_tenant_id, p_team_id, 'ATIVA',
    v_programmed_foreman_id, v_programmed_foreman_name,
    p_actor_user_id, p_actor_user_id
  )
  returning id into v_pt_id;

  perform public.append_programming_history_record(
    p_tenant_id, p_programming_id, v_pt_id, p_actor_user_id, 'ADD_TEAM', null,
    jsonb_build_object(
      'teamId', p_team_id,
      'programmedForeman', v_programmed_foreman_name,
      'programmedForemanId', v_programmed_foreman_id
    )
  );

  return jsonb_build_object('success', true, 'status', 200, 'programming_team_id', v_pt_id,
    'message', 'Equipe adicionada com sucesso.');
end;
$$;

create or replace function public.postpone_project_programming_team(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_team_id uuid,
  p_new_execution_date date,
  p_reason text,
  p_expected_updated_at timestamptz default null,
  p_confirm_last_team boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_row record;
  v_origin_stage record;
  v_dest_stage record;
  v_conflict record;
  v_active_count integer;
  v_new_team_id uuid;
  v_new_team_updated_at timestamptz;
  v_origin_updated_at timestamptz;
begin
  select * into v_team_row
  from public.programming_team
  where id = p_programming_team_id and tenant_id = p_tenant_id
  for update;

  if v_team_row.id is null then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROGRAMMING_TEAM_NOT_FOUND',
      'message', 'Alocacao de equipe nao encontrada para este tenant.');
  end if;

  if v_team_row.status <> 'ATIVA' then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'TEAM_NOT_ACTIVE',
      'message', 'Esta alocacao de equipe ja nao esta ativa.');
  end if;

  select * into v_origin_stage
  from public.programming
  where id = v_team_row.programming_id and tenant_id = p_tenant_id
  for update;

  if v_origin_stage.id is null then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROGRAMMING_NOT_FOUND',
      'message', 'Etapa da alocacao nao encontrada para este tenant.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || v_origin_stage.project_id::text, 0));

  if v_origin_stage.status not in ('PROGRAMADA', 'REPROGRAMADA') then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'STAGE_NOT_ACTIVE',
      'message', 'A etapa desta alocacao nao esta ativa.');
  end if;

  if not v_origin_stage.is_pendencia
     and coalesce(public.programming_project_has_active_completion(p_tenant_id, v_origin_stage.project_id), false) then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'PROJECT_COMPLETED_REQUIRES_REOPEN',
      'message', 'Projeto concluido: reabra antes de adiar equipe.');
  end if;

  if p_expected_updated_at is not null and v_team_row.updated_at <> p_expected_updated_at then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONFLICT',
      'message', 'A alocacao da equipe foi alterada por outro usuario. Recarregue antes de adiar.',
      'currentUpdatedAt', v_team_row.updated_at);
  end if;

  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'REASON_REQUIRED',
      'message', 'Informe o motivo do adiamento da equipe.');
  end if;

  if p_new_execution_date is null or p_new_execution_date <= v_origin_stage.execution_date then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'DATE_MUST_BE_LATER',
      'message', 'A nova data precisa ser posterior a data atual da etapa.');
  end if;

  select count(*) into v_active_count
  from public.programming_team
  where programming_id = v_origin_stage.id and tenant_id = p_tenant_id and status = 'ATIVA';

  if v_active_count = 1 and not p_confirm_last_team then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'LAST_ACTIVE_TEAM',
      'message', 'Esta e a unica equipe ativa da etapa. Confirme para manter a etapa sem equipe, ou adie a etapa inteira.');
  end if;

  select * into v_conflict
  from public.programming_team_schedule_conflict(
    p_tenant_id, v_team_row.team_id, p_new_execution_date, v_origin_stage.start_time, v_origin_stage.end_time, null
  )
  limit 1;

  if v_conflict.programming_id is not null then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'TEAM_TIME_CONFLICT',
      'message', 'Esta equipe ja tem alocacao ativa com horario sobreposto na nova data.');
  end if;

  select * into v_dest_stage
  from public.programming
  where tenant_id = p_tenant_id
    and project_id = v_origin_stage.project_id
    and execution_date = p_new_execution_date
    and status in ('PROGRAMADA', 'REPROGRAMADA')
  for update;

  if v_dest_stage.id is null then
    insert into public.programming (
      tenant_id, project_id, execution_date, status, work_completion_status,
      service_description, period, start_time, end_time, expected_minutes,
      outage_start_time, outage_end_time, feeder, campo_eletrico, affected_customers,
      sgd_type_id, electrical_eq_catalog_id, support, support_item_id,
      poste_qty, estrutura_qty, trafo_qty, rede_qty, note,
      copied_from_id, created_by, updated_by
    )
    select
      p_tenant_id, v_origin_stage.project_id, p_new_execution_date, 'PROGRAMADA', null,
      v_origin_stage.service_description, v_origin_stage.period, v_origin_stage.start_time, v_origin_stage.end_time,
      v_origin_stage.expected_minutes, v_origin_stage.outage_start_time, v_origin_stage.outage_end_time,
      v_origin_stage.feeder, v_origin_stage.campo_eletrico, v_origin_stage.affected_customers,
      v_origin_stage.sgd_type_id, v_origin_stage.electrical_eq_catalog_id, v_origin_stage.support, v_origin_stage.support_item_id,
      v_origin_stage.poste_qty, v_origin_stage.estrutura_qty, v_origin_stage.trafo_qty, v_origin_stage.rede_qty, v_origin_stage.note,
      v_origin_stage.id, p_actor_user_id, p_actor_user_id
    returning * into v_dest_stage;
  end if;

  insert into public.programming_team (
    programming_id, tenant_id, team_id, status, added_from_id,
    programmed_foreman_person_id, programmed_foreman_name_snapshot,
    created_by, updated_by
  )
  values (
    v_dest_stage.id, p_tenant_id, v_team_row.team_id, 'ATIVA', p_programming_team_id,
    v_team_row.programmed_foreman_person_id, v_team_row.programmed_foreman_name_snapshot,
    p_actor_user_id, p_actor_user_id
  )
  returning id, updated_at into v_new_team_id, v_new_team_updated_at;

  update public.programming_team
  set
    status = 'TRANSFERIDA',
    participation_reason = p_reason,
    status_changed_at = now(),
    status_changed_by = p_actor_user_id,
    moved_to_id = v_new_team_id,
    updated_by = p_actor_user_id
  where id = p_programming_team_id and tenant_id = p_tenant_id
  returning updated_at into v_origin_updated_at;

  perform public.append_programming_history_record(
    p_tenant_id, v_origin_stage.id, p_programming_team_id, p_actor_user_id, 'POSTPONE_TEAM_PARTICIPATION', p_reason,
    jsonb_build_object('movedToProgrammingTeamId', v_new_team_id, 'newProgrammingId', v_dest_stage.id, 'newExecutionDate', p_new_execution_date)
  );
  perform public.append_programming_history_record(
    p_tenant_id, v_dest_stage.id, v_new_team_id, p_actor_user_id, 'CREATED_FROM_POSTPONE_TEAM', p_reason,
    jsonb_build_object(
      'sourceProgrammingTeamId', p_programming_team_id,
      'sourceProgrammingId', v_origin_stage.id,
      'programmedForeman', v_team_row.programmed_foreman_name_snapshot,
      'programmedForemanId', v_team_row.programmed_foreman_person_id
    )
  );

  perform public.reclassify_project_programming_stages(p_tenant_id, v_origin_stage.project_id, p_actor_user_id);

  return jsonb_build_object(
    'success', true, 'status', 200,
    'programming_team_id', p_programming_team_id,
    'updated_at', v_origin_updated_at,
    'new_programming_team_id', v_new_team_id,
    'new_programming_id', v_dest_stage.id,
    'new_execution_date', p_new_execution_date,
    'message', 'Equipe adiada com sucesso.'
  );
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'TEAM_ALREADY_ACTIVE',
      'message', 'Esta equipe ja esta alocada na etapa de destino.');
end;
$$;

revoke all on function public.resolve_programmed_foreman_for_team(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.resolve_programmed_foreman_for_team(uuid, uuid, uuid) to service_role;

revoke all on function public.save_project_programming_stage(
  uuid, uuid, uuid, date, uuid[], uuid, timestamptz, text, text, time, time,
  integer, time, time, text, text, integer, uuid, uuid, text, uuid, numeric,
  numeric, numeric, numeric, text, text, jsonb, jsonb, boolean, jsonb
) from public, anon, authenticated;
grant execute on function public.save_project_programming_stage(
  uuid, uuid, uuid, date, uuid[], uuid, timestamptz, text, text, time, time,
  integer, time, time, text, text, integer, uuid, uuid, text, uuid, numeric,
  numeric, numeric, numeric, text, text, jsonb, jsonb, boolean, jsonb
) to service_role;

revoke all on function public.add_project_programming_team(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.add_project_programming_team(uuid, uuid, uuid, uuid, uuid) to service_role;

revoke all on function public.postpone_project_programming_team(uuid, uuid, uuid, date, text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.postpone_project_programming_team(uuid, uuid, uuid, date, text, timestamptz, boolean) to service_role;

commit;
