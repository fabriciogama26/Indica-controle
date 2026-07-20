-- 311_create_programming_normalized_rpcs.sql
-- RPCs transacionais do modelo normalizado da NOVA tela de Programacao.
-- Depende do schema criado na migration 310. Fonte da verdade:
-- docs/planejamento/Spec_Nova_Programacao_Modelo_Normalizado.md.
--
-- Simplificacao consciente em relacao a secao 11 do spec: o spec lista
-- "save_project_programming_plan" e "insert_project_programming_stage" como
-- duas RPCs separadas. Aqui viram UMA so (save_project_programming_stage, cria
-- OU edita uma etapa por chamada), porque o frontend chama a mesma operacao
-- nos dois casos (secao 9: "nao ha modal novo ou abrir... segunda porta:
-- clicar numa etapa abre o mesmo editor") e criar duas RPCs quase identicas
-- duplicaria validacao (guia_backend regra 20 / guia_sql regra 3). "Copiar
-- programacao para datas" (opcional no spec, secao 10) fica fora desta
-- entrega — pode ser adicionada depois sem alterar o que ja existe.
--
-- Todas as funcoes: SECURITY DEFINER, EXECUTE revogado de public/anon/authenticated
-- e concedido so a service_role (bloco de hardening no final deste arquivo).
-- Chamadas sempre a partir do backend (Route Handler) depois de validar bearer
-- token, tenant ativo e page_key/action via requirePageAction — nunca direto
-- via PostgREST /rpc por authenticated.

-- =============================================================================
-- 1) append_programming_history_record — helper de historico
-- =============================================================================
create or replace function public.append_programming_history_record(
  p_tenant_id uuid,
  p_programming_id uuid,
  p_programming_team_id uuid,
  p_actor_user_id uuid,
  p_action_type text,
  p_reason text default null,
  p_changes jsonb default '{}'::jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_history_id uuid;
begin
  insert into public.programming_history (
    tenant_id, programming_id, programming_team_id, action_type, reason, changes, metadata, created_by
  ) values (
    p_tenant_id, p_programming_id, p_programming_team_id, p_action_type,
    nullif(btrim(coalesce(p_reason, '')), ''), coalesce(p_changes, '{}'::jsonb), coalesce(p_metadata, '{}'::jsonb),
    p_actor_user_id
  )
  returning id into v_history_id;

  return v_history_id;
end;
$$;

-- =============================================================================
-- 2) programming_project_has_active_completion — guarda de projeto CONCLUIDO
--    (secao 6.3/9 do spec: bloqueia inserir/editar/adicionar equipe/adiar/
--    cancelar enquanto existir CONCLUIDO ativo; reabrir e a unica saida).
-- =============================================================================
create or replace function public.programming_project_has_active_completion(
  p_tenant_id uuid,
  p_project_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.programming p
    where p.tenant_id = p_tenant_id
      and p.project_id = p_project_id
      and p.status in ('PROGRAMADA', 'REPROGRAMADA')
      and p.work_completion_status = 'CONCLUIDO'
  );
$$;

-- =============================================================================
-- 3) programming_team_schedule_conflict — conflito de agenda por equipe
--    (secao 8 do spec: sobreposicao de horario, tenant-wide, so conta alocacao
--    ATIVA em etapa PROGRAMADA/REPROGRAMADA; encostar nao conta).
-- =============================================================================
create or replace function public.programming_team_schedule_conflict(
  p_tenant_id uuid,
  p_team_id uuid,
  p_execution_date date,
  p_start_time time,
  p_end_time time,
  p_exclude_programming_id uuid default null
)
returns table (
  programming_id uuid,
  project_id uuid,
  start_time time,
  end_time time
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.project_id, p.start_time, p.end_time
  from public.programming_team pt
  join public.programming p
    on p.id = pt.programming_id and p.tenant_id = pt.tenant_id
  where pt.tenant_id = p_tenant_id
    and pt.team_id = p_team_id
    and pt.status = 'ATIVA'
    and p.status in ('PROGRAMADA', 'REPROGRAMADA')
    and p.execution_date = p_execution_date
    and (p_exclude_programming_id is null or p.id <> p_exclude_programming_id)
    and p.start_time is not null
    and p.end_time is not null
    and p_start_time is not null
    and p_end_time is not null
    and p.start_time < p_end_time
    and p_start_time < p.end_time;
$$;

-- =============================================================================
-- 4) reclassify_project_programming_stages — coracao do modelo (secao 5/12)
-- =============================================================================
create or replace function public.reclassify_project_programming_stages(
  p_tenant_id uuid,
  p_project_id uuid,
  p_actor_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_count int;
  v_invalid_count int;
begin
  -- Serializa por projeto dentro da transacao da acao chamadora.
  perform pg_advisory_xact_lock(
    hashtextextended(p_tenant_id::text || ':' || p_project_id::text, 0));

  select count(*) into v_count
  from public.programming
  where tenant_id = p_tenant_id
    and project_id = p_project_id
    and status in ('PROGRAMADA', 'REPROGRAMADA')
    and coalesce(work_completion_status, '') <> 'PENDENCIA';

  for r in
    select id,
           row_number() over (order by execution_date) as pos
    from public.programming
    where tenant_id = p_tenant_id
      and project_id = p_project_id
      and status in ('PROGRAMADA', 'REPROGRAMADA')
      and coalesce(work_completion_status, '') <> 'PENDENCIA'
    order by execution_date
  loop
    if v_count = 1 then
      update public.programming
        set etapa_number = null, etapa_unica = true, etapa_final = false
        where id = r.id
          and (etapa_number is not null or etapa_unica is not true or etapa_final is not false);
    elsif r.pos = v_count then
      update public.programming
        set etapa_number = null, etapa_unica = false, etapa_final = true
        where id = r.id
          and (etapa_final is not true or etapa_number is not null or etapa_unica is not false);
    else
      update public.programming
        set etapa_number = r.pos, etapa_unica = false, etapa_final = false
        where id = r.id
          and (etapa_number is distinct from r.pos or etapa_unica is not false or etapa_final is not false);
    end if;

    if found then
      perform public.append_programming_history_record(
        p_tenant_id, r.id, null, p_actor_user_id, 'RECLASSIFY_STAGE'
      );
    end if;
  end loop;

  -- Guarda de ETAPA ativa (secao 12 do spec, nota "valida no commit"): como
  -- CHECK constraint nao pode ser deferrada no Postgres, a invariante e
  -- validada aqui, sempre o ultimo passo de toda RPC de escrita. Se nao
  -- fechar, RAISE EXCEPTION desfaz a transacao inteira da RPC chamadora.
  select count(*) into v_invalid_count
  from public.programming
  where tenant_id = p_tenant_id
    and project_id = p_project_id
    and status in ('PROGRAMADA', 'REPROGRAMADA')
    and coalesce(work_completion_status, '') <> 'PENDENCIA'
    and not (
      (etapa_unica and not etapa_final and etapa_number is null)
      or (etapa_final and not etapa_unica and etapa_number is null)
      or (not etapa_unica and not etapa_final and etapa_number is not null and etapa_number > 0)
    );

  if v_invalid_count > 0 then
    raise exception
      'programming_active_stage_classification_invalid: % etapa(s) ativa(s) fora de um estado de classificacao valido (tenant=%, project=%)',
      v_invalid_count, p_tenant_id, p_project_id;
  end if;
end;
$$;

-- =============================================================================
-- 5) save_project_programming_stage — cria OU edita uma etapa (cadastro +
--    equipes), com heranca resolvida no cliente (secao 9), checagem de
--    conflito e pendencia (secao 4.2), e reclassify no final.
-- =============================================================================
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
  p_history_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_insert boolean := p_programming_id is null;
  v_current record;
  v_final record;
  v_work_completion_status text;
  v_programming_id uuid;
  v_updated_at timestamptz;
  v_team_id uuid;
  v_conflict record;
  v_pt_id uuid;
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

  if coalesce(public.programming_project_has_active_completion(p_tenant_id, p_project_id), false) then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'PROJECT_COMPLETED_REQUIRES_REOPEN',
      'message', 'Projeto concluido: reabra antes de inserir ou editar o plano.');
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

    if v_current.execution_date <> p_execution_date then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'DATE_CHANGE_NOT_ALLOWED',
        'message', 'Para mudar a data use Adiar; edicao nao muda a data da etapa.');
    end if;

    if p_expected_updated_at is not null and v_current.updated_at <> p_expected_updated_at then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONFLICT',
        'message', 'A etapa foi alterada por outro usuario. Recarregue antes de salvar.',
        'currentUpdatedAt', v_current.updated_at);
    end if;
  end if;

  if v_is_insert then
    select p.id, p.execution_date into v_final
    from public.programming p
    where p.tenant_id = p_tenant_id
      and p.project_id = p_project_id
      and p.etapa_final = true
      and p.status in ('PROGRAMADA', 'REPROGRAMADA')
    limit 1;

    if v_final.execution_date is not null and current_date > v_final.execution_date then
      v_work_completion_status := 'PENDENCIA';
    else
      v_work_completion_status := null;
    end if;
  end if;

  -- Validacao de TODAS as equipes antes de qualquer escrita (nunca gravacao
  -- parcial — guia_backend regra 16/guia_sql secao 8 do spec).
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

  if v_is_insert then
    insert into public.programming (
      tenant_id, project_id, execution_date, status, work_completion_status,
      service_description, period, start_time, end_time, expected_minutes,
      outage_start_time, outage_end_time, feeder, campo_eletrico, affected_customers,
      sgd_type_id, electrical_eq_catalog_id, support, support_item_id,
      poste_qty, estrutura_qty, trafo_qty, rede_qty, note,
      created_by, updated_by
    ) values (
      p_tenant_id, p_project_id, p_execution_date, 'PROGRAMADA', v_work_completion_status,
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
      p_tenant_id, v_programming_id, null, p_actor_user_id, 'UPDATE_STAGE', p_history_reason
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

-- =============================================================================
-- 6) add_project_programming_team — adiciona uma equipe a uma etapa existente
-- =============================================================================
create or replace function public.add_project_programming_team(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_id uuid,
  p_team_id uuid
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

  if coalesce(public.programming_project_has_active_completion(p_tenant_id, v_stage.project_id), false) then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'PROJECT_COMPLETED_REQUIRES_REOPEN',
      'message', 'Projeto concluido: reabra antes de adicionar equipe.');
  end if;

  if not exists (
    select 1 from public.teams t where t.id = p_team_id and t.tenant_id = p_tenant_id and t.ativo = true
  ) then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'TEAM_NOT_FOUND',
      'message', 'Equipe nao encontrada ou inativa para este tenant.');
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

  insert into public.programming_team (programming_id, tenant_id, team_id, status, created_by, updated_by)
  values (p_programming_id, p_tenant_id, p_team_id, 'ATIVA', p_actor_user_id, p_actor_user_id)
  returning id into v_pt_id;

  perform public.append_programming_history_record(
    p_tenant_id, p_programming_id, v_pt_id, p_actor_user_id, 'ADD_TEAM'
  );

  return jsonb_build_object('success', true, 'status', 200, 'programming_team_id', v_pt_id,
    'message', 'Equipe adicionada com sucesso.');
end;
$$;

-- =============================================================================
-- 7) remove_project_programming_team — marca REMOVIDA e libera a agenda
-- =============================================================================
create or replace function public.remove_project_programming_team(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_team_id uuid,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_row record;
  v_updated_at timestamptz;
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

  if p_expected_updated_at is not null and v_team_row.updated_at <> p_expected_updated_at then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONFLICT',
      'message', 'A alocacao da equipe foi alterada por outro usuario. Recarregue antes de remover.',
      'currentUpdatedAt', v_team_row.updated_at);
  end if;

  update public.programming_team
  set status = 'REMOVIDA', updated_by = p_actor_user_id
  where id = p_programming_team_id and tenant_id = p_tenant_id
  returning updated_at into v_updated_at;

  perform public.append_programming_history_record(
    p_tenant_id, v_team_row.programming_id, p_programming_team_id, p_actor_user_id, 'REMOVE_TEAM'
  );

  return jsonb_build_object('success', true, 'status', 200, 'programming_team_id', p_programming_team_id,
    'updated_at', v_updated_at, 'message', 'Equipe removida com sucesso.');
end;
$$;

-- =============================================================================
-- 8) postpone_project_programming_stage — adia (cria etapa nova na data
--    futura; a antiga vira ADIADA). Antecipa pendencia (secao 4.2).
-- =============================================================================
create or replace function public.postpone_project_programming_stage(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_id uuid,
  p_new_execution_date date,
  p_reason text,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old record;
  v_final record;
  v_work_completion_status text;
  v_team record;
  v_conflict record;
  v_new_id uuid;
  v_new_updated_at timestamptz;
  v_new_pt_id uuid;
begin
  select * into v_old
  from public.programming
  where id = p_programming_id and tenant_id = p_tenant_id
  for update;

  if v_old.id is null then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROGRAMMING_NOT_FOUND',
      'message', 'Etapa nao encontrada para este tenant.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || v_old.project_id::text, 0));

  if v_old.status not in ('PROGRAMADA', 'REPROGRAMADA') then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'STAGE_NOT_ACTIVE',
      'message', 'Somente etapas ativas podem ser adiadas.');
  end if;

  if coalesce(public.programming_project_has_active_completion(p_tenant_id, v_old.project_id), false) then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'PROJECT_COMPLETED_REQUIRES_REOPEN',
      'message', 'Projeto concluido: reabra antes de adiar.');
  end if;

  if p_expected_updated_at is not null and v_old.updated_at <> p_expected_updated_at then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONFLICT',
      'message', 'A etapa foi alterada por outro usuario. Recarregue antes de adiar.',
      'currentUpdatedAt', v_old.updated_at);
  end if;

  if p_new_execution_date is null or p_new_execution_date <= v_old.execution_date then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'DATE_MUST_BE_LATER',
      'message', 'A nova data precisa ser posterior a data atual da etapa.');
  end if;

  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'REASON_REQUIRED',
      'message', 'Informe o motivo do adiamento.');
  end if;

  -- Validacao de TODAS as equipes antes de qualquer escrita.
  for v_team in
    select * from public.programming_team
    where programming_id = p_programming_id and tenant_id = p_tenant_id and status = 'ATIVA'
  loop
    select * into v_conflict
    from public.programming_team_schedule_conflict(
      p_tenant_id, v_team.team_id, p_new_execution_date, v_old.start_time, v_old.end_time, null
    )
    limit 1;

    if v_conflict.programming_id is not null then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'TEAM_TIME_CONFLICT',
        'message', 'Uma das equipes ja tem alocacao ativa com horario sobreposto na nova data.');
    end if;
  end loop;

  select p.id, p.execution_date into v_final
  from public.programming p
  where p.tenant_id = p_tenant_id
    and p.project_id = v_old.project_id
    and p.etapa_final = true
    and p.status in ('PROGRAMADA', 'REPROGRAMADA')
  limit 1;

  if v_final.execution_date is not null and current_date > v_final.execution_date then
    v_work_completion_status := 'PENDENCIA';
  else
    v_work_completion_status := null;
  end if;

  update public.programming
  set status = 'ADIADA', work_completion_status = null, updated_by = p_actor_user_id
  where id = p_programming_id and tenant_id = p_tenant_id;

  insert into public.programming (
    tenant_id, project_id, execution_date, status, work_completion_status,
    service_description, period, start_time, end_time, expected_minutes,
    outage_start_time, outage_end_time, feeder, campo_eletrico, affected_customers,
    sgd_type_id, electrical_eq_catalog_id, support, support_item_id,
    poste_qty, estrutura_qty, trafo_qty, rede_qty, note,
    copied_from_id, created_by, updated_by
  )
  select
    p_tenant_id, v_old.project_id, p_new_execution_date, 'REPROGRAMADA', v_work_completion_status,
    v_old.service_description, v_old.period, v_old.start_time, v_old.end_time, v_old.expected_minutes,
    v_old.outage_start_time, v_old.outage_end_time, v_old.feeder, v_old.campo_eletrico, v_old.affected_customers,
    v_old.sgd_type_id, v_old.electrical_eq_catalog_id, v_old.support, v_old.support_item_id,
    v_old.poste_qty, v_old.estrutura_qty, v_old.trafo_qty, v_old.rede_qty, v_old.note,
    v_old.id, p_actor_user_id, p_actor_user_id
  returning id, updated_at into v_new_id, v_new_updated_at;

  for v_team in
    select * from public.programming_team
    where programming_id = p_programming_id and tenant_id = p_tenant_id and status = 'ATIVA'
  loop
    insert into public.programming_team (programming_id, tenant_id, team_id, status, added_from_id, created_by, updated_by)
    values (v_new_id, p_tenant_id, v_team.team_id, 'ATIVA', v_team.id, p_actor_user_id, p_actor_user_id)
    returning id into v_new_pt_id;
  end loop;

  perform public.append_programming_history_record(
    p_tenant_id, p_programming_id, null, p_actor_user_id, 'POSTPONE_STAGE', p_reason,
    jsonb_build_object('newProgrammingId', v_new_id)
  );
  perform public.append_programming_history_record(
    p_tenant_id, v_new_id, null, p_actor_user_id, 'CREATED_FROM_POSTPONE', p_reason,
    jsonb_build_object('sourceProgrammingId', p_programming_id)
  );

  perform public.reclassify_project_programming_stages(p_tenant_id, v_old.project_id, p_actor_user_id);

  return jsonb_build_object(
    'success', true, 'status', 200,
    'programming_id', p_programming_id,
    'new_programming_id', v_new_id,
    'updated_at', v_new_updated_at,
    'message', 'Etapa adiada com sucesso.'
  );
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'UNIQUE_STAGE_PER_DATE',
      'message', 'Ja existe uma etapa para este projeto na nova data.');
end;
$$;

-- =============================================================================
-- 9) cancel_project_programming_stage — cancela a etapa inteira (grupo)
-- =============================================================================
create or replace function public.cancel_project_programming_stage(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_id uuid,
  p_reason text,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target record;
  v_updated_at timestamptz;
begin
  select * into v_target
  from public.programming
  where id = p_programming_id and tenant_id = p_tenant_id
  for update;

  if v_target.id is null then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROGRAMMING_NOT_FOUND',
      'message', 'Etapa nao encontrada para este tenant.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || v_target.project_id::text, 0));

  if v_target.status not in ('PROGRAMADA', 'REPROGRAMADA') then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'STAGE_NOT_ACTIVE',
      'message', 'Somente etapas ativas podem ser canceladas.');
  end if;

  if coalesce(public.programming_project_has_active_completion(p_tenant_id, v_target.project_id), false) then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'PROJECT_COMPLETED_REQUIRES_REOPEN',
      'message', 'Projeto concluido: reabra antes de cancelar.');
  end if;

  if p_expected_updated_at is not null and v_target.updated_at <> p_expected_updated_at then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONFLICT',
      'message', 'A etapa foi alterada por outro usuario. Recarregue antes de cancelar.',
      'currentUpdatedAt', v_target.updated_at);
  end if;

  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'REASON_REQUIRED',
      'message', 'Informe o motivo do cancelamento.');
  end if;

  update public.programming
  set
    status = 'CANCELADA',
    work_completion_status = null,
    cancellation_reason = p_reason,
    canceled_at = now(),
    canceled_by = p_actor_user_id,
    updated_by = p_actor_user_id
  where id = p_programming_id and tenant_id = p_tenant_id
  returning updated_at into v_updated_at;

  perform public.append_programming_history_record(
    p_tenant_id, p_programming_id, null, p_actor_user_id, 'CANCEL_STAGE', p_reason
  );

  perform public.reclassify_project_programming_stages(p_tenant_id, v_target.project_id, p_actor_user_id);

  return jsonb_build_object(
    'success', true, 'status', 200,
    'programming_id', p_programming_id,
    'updated_at', v_updated_at,
    'message', 'Etapa cancelada com sucesso.'
  );
end;
$$;

-- =============================================================================
-- 10) mark_project_programming_completed_and_anticipate — conclui e antecipa
--     por execution_date posterior (secao 6 do spec, corrige a brecha da
--     migration atual que so antecipava por etapa_number).
-- =============================================================================
create or replace function public.mark_project_programming_completed_and_anticipate(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_id uuid,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target record;
  v_row record;
  v_updated_at timestamptz;
  v_anticipated_count integer := 0;
begin
  select * into v_target
  from public.programming
  where id = p_programming_id and tenant_id = p_tenant_id
  for update;

  if v_target.id is null then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROGRAMMING_NOT_FOUND',
      'message', 'Etapa nao encontrada para este tenant.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || v_target.project_id::text, 0));

  if v_target.status not in ('PROGRAMADA', 'REPROGRAMADA') then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'STAGE_NOT_ACTIVE',
      'message', 'Somente etapas ativas podem ser concluidas.');
  end if;

  if coalesce(v_target.work_completion_status, '') = 'PENDENCIA' then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'PENDENCIA_NOT_ANTICIPATING',
      'message', 'Uma pendencia nao antecipa outras etapas; conclua normalmente pelo Estado Trabalho.');
  end if;

  if p_expected_updated_at is not null and v_target.updated_at <> p_expected_updated_at then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONFLICT',
      'message', 'A etapa foi alterada por outro usuario. Recarregue antes de concluir.',
      'currentUpdatedAt', v_target.updated_at);
  end if;

  if exists (
    select 1 from public.programming p
    where p.tenant_id = p_tenant_id
      and p.project_id = v_target.project_id
      and p.id <> v_target.id
      and p.status in ('PROGRAMADA', 'REPROGRAMADA')
      and p.work_completion_status = 'CONCLUIDO'
  ) then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'PROJECT_ALREADY_COMPLETED',
      'message', 'Ja existe uma etapa concluida ativa neste projeto.');
  end if;

  update public.programming
  set work_completion_status = 'CONCLUIDO', updated_by = p_actor_user_id
  where id = p_programming_id and tenant_id = p_tenant_id
  returning updated_at into v_updated_at;

  for v_row in
    select * from public.programming
    where tenant_id = p_tenant_id
      and project_id = v_target.project_id
      and id <> v_target.id
      and status in ('PROGRAMADA', 'REPROGRAMADA')
      and coalesce(work_completion_status, '') <> 'PENDENCIA'
      and execution_date > v_target.execution_date
    for update
  loop
    update public.programming
    set
      status = 'ANTECIPADA',
      work_completion_status = 'ANTECIPADO',
      anticipated_by_id = v_target.id,
      anticipated_at = now(),
      previous_work_completion_status = v_row.work_completion_status,
      previous_operational_status = v_row.status,
      updated_by = p_actor_user_id
    where id = v_row.id and tenant_id = p_tenant_id;

    v_anticipated_count := v_anticipated_count + 1;

    perform public.append_programming_history_record(
      p_tenant_id, v_row.id, null, p_actor_user_id, 'ANTICIPATE_STAGE', null,
      jsonb_build_object('anticipatedById', v_target.id)
    );
  end loop;

  perform public.append_programming_history_record(
    p_tenant_id, p_programming_id, null, p_actor_user_id, 'COMPLETE_STAGE', null,
    jsonb_build_object('anticipatedCount', v_anticipated_count)
  );

  perform public.reclassify_project_programming_stages(p_tenant_id, v_target.project_id, p_actor_user_id);

  return jsonb_build_object(
    'success', true, 'status', 200,
    'programming_id', p_programming_id,
    'updated_at', v_updated_at,
    'anticipated_count', v_anticipated_count,
    'message', 'Etapa concluida com sucesso.'
  );
end;
$$;

-- =============================================================================
-- 11) reopen_project_programming_completed — reverte conclusao/antecipacao
-- =============================================================================
create or replace function public.reopen_project_programming_completed(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_id uuid,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target record;
  v_row record;
  v_updated_at timestamptz;
  v_restored_count integer := 0;
begin
  select * into v_target
  from public.programming
  where id = p_programming_id and tenant_id = p_tenant_id
  for update;

  if v_target.id is null then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROGRAMMING_NOT_FOUND',
      'message', 'Etapa nao encontrada para este tenant.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || v_target.project_id::text, 0));

  if coalesce(v_target.work_completion_status, '') <> 'CONCLUIDO' then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'STAGE_NOT_COMPLETED',
      'message', 'Esta etapa nao esta concluida.');
  end if;

  if p_expected_updated_at is not null and v_target.updated_at <> p_expected_updated_at then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONFLICT',
      'message', 'A etapa foi alterada por outro usuario. Recarregue antes de reabrir.',
      'currentUpdatedAt', v_target.updated_at);
  end if;

  update public.programming
  set work_completion_status = null, updated_by = p_actor_user_id
  where id = p_programming_id and tenant_id = p_tenant_id
  returning updated_at into v_updated_at;

  for v_row in
    select * from public.programming
    where tenant_id = p_tenant_id
      and anticipated_by_id = v_target.id
    for update
  loop
    update public.programming
    set
      status = coalesce(v_row.previous_operational_status, 'PROGRAMADA'),
      work_completion_status = v_row.previous_work_completion_status,
      anticipated_by_id = null,
      anticipated_at = null,
      previous_work_completion_status = null,
      previous_operational_status = null,
      updated_by = p_actor_user_id
    where id = v_row.id and tenant_id = p_tenant_id;

    v_restored_count := v_restored_count + 1;

    perform public.append_programming_history_record(
      p_tenant_id, v_row.id, null, p_actor_user_id, 'RESTORE_ANTICIPATED_STAGE'
    );
  end loop;

  perform public.append_programming_history_record(
    p_tenant_id, p_programming_id, null, p_actor_user_id, 'REOPEN_STAGE', null,
    jsonb_build_object('restoredCount', v_restored_count)
  );

  perform public.reclassify_project_programming_stages(p_tenant_id, v_target.project_id, p_actor_user_id);

  return jsonb_build_object(
    'success', true, 'status', 200,
    'programming_id', p_programming_id,
    'updated_at', v_updated_at,
    'restored_count', v_restored_count,
    'message', 'Etapa reaberta com sucesso.'
  );
end;
$$;

-- =============================================================================
-- 12) Hardening de grants — revoga public/anon/authenticated, concede so
--     service_role (padrao das migrations 295/298/309). Resolvido
--     dinamicamente via pg_proc para nao depender de transcrever a assinatura
--     completa (26 parametros em save_project_programming_stage) na mao.
-- =============================================================================
do $$
declare
  v_fn regprocedure;
  v_name text;
  v_names text[] := array[
    'append_programming_history_record',
    'programming_project_has_active_completion',
    'programming_team_schedule_conflict',
    'reclassify_project_programming_stages',
    'save_project_programming_stage',
    'add_project_programming_team',
    'remove_project_programming_team',
    'postpone_project_programming_stage',
    'cancel_project_programming_stage',
    'mark_project_programming_completed_and_anticipate',
    'reopen_project_programming_completed'
  ];
begin
  foreach v_name in array v_names
  loop
    for v_fn in
      select p.oid::regprocedure
      from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname = v_name
    loop
      execute format('revoke all on function %s from public, anon, authenticated', v_fn);
      execute format('grant execute on function %s to service_role', v_fn);
    end loop;
  end loop;
end;
$$;

do $$
declare
  v_fn regprocedure;
  v_name text;
  v_names text[] := array[
    'append_programming_history_record',
    'programming_project_has_active_completion',
    'programming_team_schedule_conflict',
    'reclassify_project_programming_stages',
    'save_project_programming_stage',
    'add_project_programming_team',
    'remove_project_programming_team',
    'postpone_project_programming_stage',
    'cancel_project_programming_stage',
    'mark_project_programming_completed_and_anticipate',
    'reopen_project_programming_completed'
  ];
begin
  foreach v_name in array v_names
  loop
    for v_fn in
      select p.oid::regprocedure
      from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname = v_name
    loop
      if has_function_privilege('anon', v_fn, 'execute') then
        raise exception '311: funcao % ainda executavel por anon', v_fn;
      end if;

      if has_function_privilege('authenticated', v_fn, 'execute') then
        raise exception '311: funcao % ainda executavel por authenticated', v_fn;
      end if;
    end loop;
  end loop;
end;
$$;
