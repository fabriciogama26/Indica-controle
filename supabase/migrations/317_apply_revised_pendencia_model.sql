-- 317_apply_revised_pendencia_model.sql
-- Aplica o modelo REVISADO de pendencia da spec
-- (docs/planejamento/Spec_Nova_Programacao_Modelo_Normalizado.md, secoes 3.1,
-- 3.2, 4.2, 5 e 12), que supersede o modelo implementado em 311/314/316.
--
-- O QUE MUDA (e por que)
-- ---------------------------------------------------------------------------
-- Modelo ANTIGO (311/314/316, em producao ate esta migration):
--   pendencia = apenas um valor de work_completion_status; a etapa SAI da
--   numeracao (o cursor de reclassify a exclui) e perde etapa_number/unica/
--   final; a coluna Etapa da tela passa a exibir "Pendencia".
--
-- Modelo REVISADO (spec 4.2, "Revisao importante ... supersede o modelo
-- anterior de pendencia"):
--   1. Pendencia NAO e classificacao de etapa. A etapa PRESERVA a posicao por
--      data: uma Final com pendencia continua Final e continua contando.
--   2. O conjunto numeravel passa a ser
--      status in ('PROGRAMADA','REPROGRAMADA','PENDENCIA') — a pendencia esta
--      no calendario; quem sai da numeracao e ADIADA/CANCELADA/ANTECIPADA.
--   3. status ganha o valor 'PENDENCIA', ESPELHADO do Estado do Trabalho:
--      ao marcar work_completion_status='PENDENCIA' o status vira 'PENDENCIA';
--      ao sair, o status volta ao da agenda.
--   4. A coluna Etapa nunca mostra "Pendencia" (spec 3.2) — isso e ajustado no
--      front (utils.ts), fora desta migration.
--
-- DECISAO DO USUARIO (2026-07-20), registrada porque a spec se contradizia:
--   a spec 4.2 diz que PENDENCIA e SO manual; as secoes 4.1/7 (e o codigo de
--   311/313) aplicam PENDENCIA automaticamente ao programar uma data posterior
--   a etapa final. Decisao: MANTER AS DUAS ORIGENS — o default automatico
--   continua existindo E o programador tambem marca/desmarca a mao. Esta
--   migration preserva o default automatico de 311/313 intacto.
--
-- ONDE O ESPELHO E APLICADO
-- ---------------------------------------------------------------------------
-- No proprio reclassify_project_programming_stages, como PRIMEIRO passo, e nao
-- espalhado por cada RPC de escrita. Motivo: TODA RPC de escrita do modulo
-- (save, postpone, cancel, add_team, complete, reopen, set_work_completion_
-- status) ja chama reclassify como ultimo passo, na mesma transacao. Centralizar
-- ali da uma unica fonte de verdade para o espelho e evita que uma RPC futura
-- esqueca de espelhar — o mesmo motivo pelo qual a numeracao ja mora la.
--
-- previous_operational_status guarda o status de agenda enquanto a etapa esta
-- em pendencia (para saber se volta para PROGRAMADA ou REPROGRAMADA). A coluna
-- ja e usada pela antecipacao, mas NAO ha colisao: a antecipacao (secao 6 do
-- spec) nunca seleciona etapas em pendencia, e o reopen so toca linhas com
-- anticipated_by_id preenchido, que uma pendencia nunca tem.
--
-- FORA DE ESCOPO (investigado, deliberadamente nao alterado aqui)
-- ---------------------------------------------------------------------------
-- a) Concluir uma pendencia: hoje mark_project_programming_completed_and_
--    anticipate recusa (PENDENCIA_NOT_ANTICIPATING). A secao 7 da spec diz que
--    "a pendencia fecha quando essa programacao e concluida". Isso e uma
--    terceira regra em aberto e nao foi decidida — nao mexer sem decisao.
-- b) REPROGRAMADA por edicao de data (spec 3.1): decisao adiada pelo usuario;
--    anotada como pendente na spec e no doc da tela. DATE_CHANGE_NOT_ALLOWED
--    permanece como esta.
-- c) programming.updated_at nao e atualizado por trigger nem pelas RPCs de
--    update, entao expectedUpdatedAt nunca detecta conflito. Bug real, anterior
--    a esta migration, com risco de regressao no front ao ser corrigido —
--    reportado separadamente, nao corrigido aqui.

-- =============================================================================
-- 1) status ganha 'PENDENCIA' (eixo 1 passa a espelhar a pendencia)
-- =============================================================================
alter table public.programming
  drop constraint if exists programming_status_check;

alter table public.programming
  add constraint programming_status_check
  check (status in ('PROGRAMADA', 'REPROGRAMADA', 'ADIADA', 'CANCELADA', 'ANTECIPADA', 'PENDENCIA'));

-- =============================================================================
-- 2) reclassify_project_programming_stages — espelho + numeracao com pendencia
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

  -- ---------------------------------------------------------------------------
  -- Passo 1: espelho status <-> Estado do Trabalho (spec 3.1/4.2). Roda ANTES
  -- da numeracao porque a numeracao le o status.
  -- ---------------------------------------------------------------------------

  -- 1a) Entrou em pendencia: guarda o status de agenda e espelha.
  update public.programming
  set previous_operational_status = status,
      status = 'PENDENCIA'
  where tenant_id = p_tenant_id
    and project_id = p_project_id
    and coalesce(work_completion_status, '') = 'PENDENCIA'
    and status in ('PROGRAMADA', 'REPROGRAMADA');

  -- 1b) Saiu da pendencia: volta ao status de agenda guardado.
  update public.programming
  set status = case
                 when previous_operational_status in ('PROGRAMADA', 'REPROGRAMADA')
                   then previous_operational_status
                 else 'PROGRAMADA'
               end,
      previous_operational_status = null
  where tenant_id = p_tenant_id
    and project_id = p_project_id
    and status = 'PENDENCIA'
    and coalesce(work_completion_status, '') <> 'PENDENCIA';

  -- ---------------------------------------------------------------------------
  -- Passo 2: numeracao. Conjunto NUMERAVEL = etapas no calendario. A pendencia
  -- CONTA (spec 4.2/5); quem sai e ADIADA/CANCELADA/ANTECIPADA.
  -- ---------------------------------------------------------------------------
  select count(*) into v_count
  from public.programming
  where tenant_id = p_tenant_id
    and project_id = p_project_id
    and status in ('PROGRAMADA', 'REPROGRAMADA', 'PENDENCIA');

  -- Zera classificacao de quem saiu do calendario.
  update public.programming
    set etapa_number = null, etapa_unica = false, etapa_final = false
    where tenant_id = p_tenant_id and project_id = p_project_id
      and status in ('ADIADA', 'CANCELADA', 'ANTECIPADA')
      and (etapa_number is not null or etapa_unica is not false or etapa_final is not false);

  for r in
    select id,
           row_number() over (order by execution_date) as pos
    from public.programming
    where tenant_id = p_tenant_id
      and project_id = p_project_id
      and status in ('PROGRAMADA', 'REPROGRAMADA', 'PENDENCIA')
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

  -- ---------------------------------------------------------------------------
  -- Passo 3: guarda de ETAPA ativa (spec secao 12). Como CHECK constraint nao
  -- pode ser deferrada no Postgres, a invariante e validada aqui, sempre o
  -- ultimo passo de toda RPC de escrita. Agora inclui as etapas em pendencia,
  -- que passaram a ser numeraveis.
  -- ---------------------------------------------------------------------------
  select count(*) into v_invalid_count
  from public.programming
  where tenant_id = p_tenant_id
    and project_id = p_project_id
    and status in ('PROGRAMADA', 'REPROGRAMADA', 'PENDENCIA')
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

  -- Espelho tem que fechar tambem: nao pode sobrar status/Estado do Trabalho
  -- desalinhados depois do passo 1.
  select count(*) into v_invalid_count
  from public.programming
  where tenant_id = p_tenant_id
    and project_id = p_project_id
    and (
      (status = 'PENDENCIA' and coalesce(work_completion_status, '') <> 'PENDENCIA')
      or (status in ('PROGRAMADA', 'REPROGRAMADA') and coalesce(work_completion_status, '') = 'PENDENCIA')
    );

  if v_invalid_count > 0 then
    raise exception
      'programming_pendencia_mirror_invalid: % etapa(s) com status e Estado do Trabalho de pendencia desalinhados (tenant=%, project=%)',
      v_invalid_count, p_tenant_id, p_project_id;
  end if;
end;
$$;

-- =============================================================================
-- 3) programming_team_schedule_conflict — pendencia ocupa agenda
-- =============================================================================
-- Uma etapa em pendencia continua no calendario, com data, horario e equipe
-- alocada (spec 4.2). Portanto ela OCUPA a agenda da equipe: sem isso, a mesma
-- equipe poderia ser alocada em outro projeto no mesmo horario. Quem libera a
-- agenda continua sendo REMOVIDA/TRANSFERIDA (equipe) e ADIADA/CANCELADA/
-- ANTECIPADA (etapa), como na secao 8 da spec.
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
    and p.status in ('PROGRAMADA', 'REPROGRAMADA', 'PENDENCIA')
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
-- 4) set_project_programming_work_completion_status — sem zerar classificacao
-- =============================================================================
-- Muda em relacao a 316: a etapa que entra em pendencia PRESERVA
-- etapa_number/etapa_unica/etapa_final (spec 4.2, "a etapa preserva a posicao").
-- O bloco que zerava a classificacao sai — ele existia so porque, no modelo
-- antigo, reclassify nunca mais visitaria a linha. Agora visita.
-- Tambem passa a aceitar etapa com status 'PENDENCIA' como ativa (senao o
-- usuario entra em pendencia e nao consegue mais sair) e a reler updated_at
-- DEPOIS do reclassify, ja que o espelho pode alterar a propria linha.
create or replace function public.set_project_programming_work_completion_status(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_id uuid,
  p_work_completion_status text default null,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target record;
  v_status text;
  v_updated_at timestamptz;
begin
  v_status := nullif(btrim(coalesce(p_work_completion_status, '')), '');

  if v_status is not null and v_status not in ('PARCIAL_PLANEJADO', 'PARCIAL_NAO_PLANEJADO', 'BENEFICIO_ATINGIDO', 'PENDENCIA') then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_WORK_COMPLETION_STATUS',
      'message', 'Estado do trabalho invalido para edicao manual. Use Concluir/Reabrir para Concluido.');
  end if;

  select * into v_target
  from public.programming
  where id = p_programming_id and tenant_id = p_tenant_id
  for update;

  if v_target.id is null then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROGRAMMING_NOT_FOUND',
      'message', 'Etapa nao encontrada para este tenant.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || v_target.project_id::text, 0));

  if v_target.status not in ('PROGRAMADA', 'REPROGRAMADA', 'PENDENCIA') then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'STAGE_NOT_ACTIVE',
      'message', 'Somente etapas ativas podem ter o Estado do trabalho alterado.');
  end if;

  if coalesce(v_target.work_completion_status, '') = 'CONCLUIDO' then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'STAGE_COMPLETED_REQUIRES_REOPEN',
      'message', 'Etapa concluida: reabra antes de mudar o Estado do trabalho.');
  end if;

  if coalesce(v_target.work_completion_status, '') = 'ANTECIPADO' then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'STAGE_ANTICIPATED_NOT_EDITABLE',
      'message', 'Etapa antecipada automaticamente: reabra a etapa que antecipou antes de mudar o Estado do trabalho.');
  end if;

  if coalesce(public.programming_project_has_active_completion(p_tenant_id, v_target.project_id), false) then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'PROJECT_COMPLETED_REQUIRES_REOPEN',
      'message', 'Projeto concluido: reabra antes de mudar o Estado do trabalho de outra etapa.');
  end if;

  if p_expected_updated_at is not null and v_target.updated_at <> p_expected_updated_at then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONFLICT',
      'message', 'A etapa foi alterada por outro usuario. Recarregue antes de tentar novamente.',
      'currentUpdatedAt', v_target.updated_at);
  end if;

  update public.programming
  set work_completion_status = v_status, updated_by = p_actor_user_id
  where id = p_programming_id and tenant_id = p_tenant_id;

  perform public.append_programming_history_record(
    p_tenant_id, p_programming_id, null, p_actor_user_id, 'SET_WORK_COMPLETION_STATUS', null,
    jsonb_build_object('workCompletionStatus', jsonb_build_object('from', v_target.work_completion_status, 'to', v_status))
  );

  -- Espelha status <-> Estado do Trabalho e renumera o projeto no mesmo commit.
  perform public.reclassify_project_programming_stages(p_tenant_id, v_target.project_id, p_actor_user_id);

  select updated_at into v_updated_at
  from public.programming
  where id = p_programming_id and tenant_id = p_tenant_id;

  return jsonb_build_object(
    'success', true, 'status', 200,
    'programming_id', p_programming_id,
    'updated_at', v_updated_at,
    'message', 'Estado do trabalho atualizado com sucesso.'
  );
end;
$$;

-- =============================================================================
-- 5) add_project_programming_team — etapa em pendencia aceita equipe
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

  if v_stage.status not in ('PROGRAMADA', 'REPROGRAMADA', 'PENDENCIA') then
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
-- 6) cancel_project_programming_stage — etapa em pendencia pode ser cancelada
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

  if v_target.status not in ('PROGRAMADA', 'REPROGRAMADA', 'PENDENCIA') then
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

  -- work_completion_status volta a branco (spec: ADIADA/CANCELADA limpam o
  -- Estado do Trabalho) — inclusive quando a etapa estava em pendencia, e
  -- previous_operational_status e descartado porque nao ha mais para onde voltar.
  update public.programming
  set
    status = 'CANCELADA',
    work_completion_status = null,
    previous_operational_status = null,
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
-- 7) postpone_project_programming_stage — etapa em pendencia pode ser adiada
-- =============================================================================
-- Alem do guard, a busca da etapa Final passa a considerar status 'PENDENCIA',
-- porque no modelo revisado uma pendencia PODE ser a Final (ela conta na
-- numeracao). Sem isso, o default automatico de pendencia da nova etapa deixaria
-- de funcionar justamente nos projetos cuja Final esta em pendencia.
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

  if v_old.status not in ('PROGRAMADA', 'REPROGRAMADA', 'PENDENCIA') then
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
    and p.status in ('PROGRAMADA', 'REPROGRAMADA', 'PENDENCIA')
  limit 1;

  if v_final.execution_date is not null and current_date > v_final.execution_date then
    v_work_completion_status := 'PENDENCIA';
  else
    v_work_completion_status := null;
  end if;

  update public.programming
  set status = 'ADIADA',
      work_completion_status = null,
      previous_operational_status = null,
      updated_by = p_actor_user_id
  where id = p_programming_id and tenant_id = p_tenant_id;

  -- A etapa nova nasce 'REPROGRAMADA'; se herdar o default de pendencia, o
  -- espelho no reclassify converte o status para 'PENDENCIA' e guarda
  -- 'REPROGRAMADA' em previous_operational_status, no mesmo commit.
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
-- 8) save_project_programming_stage — busca da Final considera pendencia
-- =============================================================================
-- Unica mudanca de comportamento em relacao a 313: o lookup da etapa Final
-- (usado pelo default automatico de pendencia) passa a aceitar status
-- 'PENDENCIA'. O corpo restante e identico ao da migration 313 — replicado
-- porque CREATE OR REPLACE exige o corpo inteiro.
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
  p_activities jsonb default '[]'::jsonb
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
  v_activity_item jsonb;
  v_activity_catalog_id uuid;
  v_activity_quantity numeric;
  v_doc_number text;
  v_doc_included date;
  v_doc_delivered date;
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
      and p.status in ('PROGRAMADA', 'REPROGRAMADA', 'PENDENCIA')
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

  -- Atividades: desativa quem saiu da lista, atualiza quantidade de quem ficou,
  -- insere quem e novo.
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

  -- Documentos: SGD/PI/PEP, upsert por tipo ou remove quando todos os campos ficam vazios.
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

-- =============================================================================
-- 9) Hardening de grants (mesmo padrao das migrations 311/313/314/316)
-- =============================================================================
do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in (
        'reclassify_project_programming_stages',
        'programming_team_schedule_conflict',
        'set_project_programming_work_completion_status',
        'add_project_programming_team',
        'cancel_project_programming_stage',
        'postpone_project_programming_stage',
        'save_project_programming_stage'
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;
end;
$$;

do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in (
        'reclassify_project_programming_stages',
        'programming_team_schedule_conflict',
        'set_project_programming_work_completion_status',
        'add_project_programming_team',
        'cancel_project_programming_stage',
        'postpone_project_programming_stage',
        'save_project_programming_stage'
      )
  loop
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception '317: funcao % ainda executavel por anon', v_fn;
    end if;

    if has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '317: funcao % ainda executavel por authenticated', v_fn;
    end if;
  end loop;
end;
$$;

-- =============================================================================
-- 10) Backfill do dado ja gravado
-- =============================================================================
-- a) Espelha o status das etapas que hoje estao em pendencia pelo Estado do
--    Trabalho mas ainda com status de agenda (todo o dado atual, ja que
--    'PENDENCIA' so agora passa a ser um status valido).
update public.programming
set previous_operational_status = status,
    status = 'PENDENCIA'
where coalesce(work_completion_status, '') = 'PENDENCIA'
  and status in ('PROGRAMADA', 'REPROGRAMADA');

-- b) Renumera TODO projeto que tenha pelo menos uma etapa em pendencia: sao
--    exatamente os projetos cuja numeracao o modelo antigo distorceu (a
--    migration 316 zerou a classificacao dessas etapas e a numeracao das demais
--    foi calculada sem elas). reclassify e idempotente.
do $$
declare
  r record;
begin
  for r in
    select distinct tenant_id, project_id
    from public.programming
    where status = 'PENDENCIA'
  loop
    perform public.reclassify_project_programming_stages(r.tenant_id, r.project_id, null);
  end loop;
end;
$$;
