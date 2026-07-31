-- 349_programming_team_cancel_and_postpone.sql
-- Fase 2 do plano de participacao por equipe (Fase 1/1b: reutilizacao de
-- data, migrations 346/347/348, ja aplicadas). Hoje "Cancelar"/"Adiar" so
-- agem na ETAPA inteira; a unica acao no nivel de equipe e "Remover", que
-- significa "cadastrada por engano" (REMOVIDA) — nao existe caminho para
-- "estava programada e foi cancelada" nem para "essa equipe especifica vai
-- pra outro dia" sem mexer nas demais equipes da etapa.
--
-- DECISAO (aprovada pelo usuario)
-- ---------------------------------------------------------------------------
-- REMOVIDA continua sendo so correcao de cadastro. Dois conceitos novos:
--   CANCELADA  — a equipe estava programada, mas sua participacao foi
--                cancelada (com motivo/quem/quando, igual ao cancelamento de
--                etapa). A etapa em si NAO muda de status.
--   EM_ESPERA  — reservado para uso futuro (nao escrito por nenhuma RPC nesta
--                migration; entra no CHECK agora para nao exigir outro ALTER
--                quando a acao existir).
-- TRANSFERIDA (ja existia no enum, nunca usada) passa a ser escrita pelo
-- "Adiar equipe": a participacao de origem vira TRANSFERIDA e aponta
-- (`moved_to_id`) para a nova linha de `programming_team` na etapa de
-- destino — mesma ideia de `added_from_id`, so que pra frente.
--
-- Nenhuma das duas acoes novas muda o status da ETAPA. Cancelar/Adiar a
-- etapa inteira continua existindo do mesmo jeito, sem mudanca de
-- comportamento.
--
-- GUARDA DA ULTIMA EQUIPE ATIVA
-- ---------------------------------------------------------------------------
-- Cancelar ou adiar a UNICA equipe ATIVA restante da etapa esvazia a etapa
-- silenciosamente — pode ser exatamente o que o usuario quer (planejamento) ou
-- pode ser abandonar uma etapa operacional por engano. As duas RPCs abaixo
-- recebem `p_confirm_last_team boolean default false`: se a alocacao alvo for
-- a ultima ATIVA e a flag vier false, devolvem `reason = 'LAST_ACTIVE_TEAM'`
-- SEM gravar nada — o front decide (cancelar a etapa inteira, confirmar
-- mantendo sem equipe, ou voltar) e so entao rechama com a flag true.
--
-- ADIAR EQUIPE — DESTINO
-- ---------------------------------------------------------------------------
-- Se ja existe etapa ATIVA do projeto na nova data (indice parcial da 346
-- garante no maximo uma), a equipe entra nela. Senao, cria uma etapa nova
-- HERDANDO o cadastro da etapa de origem (servico/periodo/horario/SGD/etc —
-- decisao do usuario: mesmo padrao que `postpone_project_programming_stage`
-- ja usa ao criar a linha REPROGRAMADA), com `copied_from_id` apontando para
-- a etapa de origem.

-- =============================================================================
-- 1) Schema: novos status + colunas de rastreio da participacao
-- =============================================================================
alter table public.programming_team
  drop constraint if exists programming_team_status_check;

alter table public.programming_team
  add constraint programming_team_status_check
  check (status in ('ATIVA', 'REMOVIDA', 'TRANSFERIDA', 'CANCELADA', 'EM_ESPERA'));

alter table public.programming_team
  add column if not exists participation_reason text null,
  add column if not exists status_changed_at timestamptz null,
  add column if not exists status_changed_by uuid null references public.app_users(id),
  add column if not exists moved_to_id uuid null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'programming_team_moved_to_tenant_fk'
  ) then
    alter table public.programming_team
      add constraint programming_team_moved_to_tenant_fk
      foreign key (moved_to_id, tenant_id) references public.programming_team (id, tenant_id)
      on delete set null (moved_to_id);
  end if;
end;
$$;

comment on column public.programming_team.participation_reason is
  'Motivo de CANCELADA/TRANSFERIDA (cancel_project_programming_team/postpone_project_programming_team). Null para ATIVA/REMOVIDA.';
comment on column public.programming_team.moved_to_id is
  'Preenchido so quando status=TRANSFERIDA: aponta para a linha nova de programming_team criada na etapa de destino pelo Adiar equipe. Simetrico a added_from_id (que aponta pra tras).';

-- =============================================================================
-- 2) cancel_project_programming_team — cancela so a participacao da equipe
-- =============================================================================
create or replace function public.cancel_project_programming_team(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_team_id uuid,
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
  v_stage record;
  v_active_count integer;
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

  select * into v_stage
  from public.programming
  where id = v_team_row.programming_id and tenant_id = p_tenant_id
  for update;

  if v_stage.id is null then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROGRAMMING_NOT_FOUND',
      'message', 'Etapa da alocacao nao encontrada para este tenant.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || v_stage.project_id::text, 0));

  if v_stage.status not in ('PROGRAMADA', 'REPROGRAMADA') then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'STAGE_NOT_ACTIVE',
      'message', 'A etapa desta alocacao nao esta ativa.');
  end if;

  if not v_stage.is_pendencia
     and coalesce(public.programming_project_has_active_completion(p_tenant_id, v_stage.project_id), false) then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'PROJECT_COMPLETED_REQUIRES_REOPEN',
      'message', 'Projeto concluido: reabra antes de cancelar participacao de equipe.');
  end if;

  if p_expected_updated_at is not null and v_team_row.updated_at <> p_expected_updated_at then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONFLICT',
      'message', 'A alocacao da equipe foi alterada por outro usuario. Recarregue antes de cancelar.',
      'currentUpdatedAt', v_team_row.updated_at);
  end if;

  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'REASON_REQUIRED',
      'message', 'Informe o motivo do cancelamento da equipe.');
  end if;

  select count(*) into v_active_count
  from public.programming_team
  where programming_id = v_stage.id and tenant_id = p_tenant_id and status = 'ATIVA';

  if v_active_count = 1 and not p_confirm_last_team then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'LAST_ACTIVE_TEAM',
      'message', 'Esta e a unica equipe ativa da etapa. Confirme para manter a etapa sem equipe, ou cancele a etapa inteira.');
  end if;

  update public.programming_team
  set
    status = 'CANCELADA',
    participation_reason = p_reason,
    status_changed_at = now(),
    status_changed_by = p_actor_user_id,
    updated_by = p_actor_user_id
  where id = p_programming_team_id and tenant_id = p_tenant_id
  returning updated_at into v_updated_at;

  perform public.append_programming_history_record(
    p_tenant_id, v_stage.id, p_programming_team_id, p_actor_user_id, 'CANCEL_TEAM_PARTICIPATION', p_reason,
    jsonb_build_object('status', jsonb_build_object('from', 'ATIVA', 'to', 'CANCELADA'))
  );

  return jsonb_build_object(
    'success', true, 'status', 200,
    'programming_team_id', p_programming_team_id,
    'updated_at', v_updated_at,
    'message', 'Participacao da equipe cancelada com sucesso.'
  );
end;
$$;

-- =============================================================================
-- 3) postpone_project_programming_team — adia so uma equipe (transferencia
--    atomica: origem vira TRANSFERIDA, equipe entra na etapa de destino)
-- =============================================================================
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

  -- Etapa de destino: reusa a ATIVA existente na nova data (indice parcial da
  -- 346 garante no maximo uma) ou cria uma nova herdando o cadastro da etapa
  -- de origem.
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

  insert into public.programming_team (programming_id, tenant_id, team_id, status, added_from_id, created_by, updated_by)
  values (v_dest_stage.id, p_tenant_id, v_team_row.team_id, 'ATIVA', p_programming_team_id, p_actor_user_id, p_actor_user_id)
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
    jsonb_build_object('sourceProgrammingTeamId', p_programming_team_id, 'sourceProgrammingId', v_origin_stage.id)
  );

  -- So teve efeito real quando a etapa de destino foi criada agora; idempotente
  -- e barato de chamar sempre.
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

-- =============================================================================
-- 4) Hardening de grants: service_role apenas
-- =============================================================================
do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('cancel_project_programming_team', 'postpone_project_programming_team')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);

    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '349: funcao % ainda executavel por anon/authenticated', v_fn;
    end if;
  end loop;
end;
$$;
