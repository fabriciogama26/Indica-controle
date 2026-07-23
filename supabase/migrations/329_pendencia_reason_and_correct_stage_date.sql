-- 329_pendencia_reason_and_correct_stage_date.sql
-- Achados 3 e 10.
--
-- F3: marcar/desmarcar a flag is_pendencia passa a EXIGIR MOTIVO + DESCRICAO do
--   que ficou pendente, e aceita o
--   vinculo opcional de origem (resolve_pendencia_de_id — a etapa parcial que
--   originou a sobra). Antes qualquer etapa ativa podia ser marcada sem
--   justificativa e sem rastro de origem, mesmo a flag mudando regras criticas
--   (escapa da antecipacao e libera a trava de projeto concluido).
--
--   DECISAO (2026-07-21): NAO se obriga work_completion_status na propria
--   pendencia. is_pendencia responde POR QUE a etapa existe; work_completion_
--   status responde O QUE aconteceu na execucao. Uma pendencia recem-programada
--   ainda nao foi executada, entao o estado correto dela e EM BRANCO (a fazer)
--   — obrigar preenchimento so faria o usuario escolher um valor falso.
--   O que se obriga: motivo, descricao do servico restante e, quando houver
--   etapa de ORIGEM, que ela ja tenha o Estado do Trabalho preenchido (nao da
--   para registrar uma sobra de uma etapa cujo resultado ainda nao foi lancado).
--   Origem aceita: PARCIAL_NAO_PLANEJADO, PARCIAL_PLANEJADO, BENEFICIO_ATINGIDO
--   ou CONCLUIDO. Pendencia SEM origem continua permitida (sobra descoberta
--   depois), com motivo e descricao obrigatorios.
--
-- F10: nova RPC correct_project_programming_stage_date — corrige a data de
--   execucao da etapa MANTENDO o mesmo registro. Regras decididas:
--     - mesmo programming.id; PRESERVA o status atual (nao vira REPROGRAMADA:
--       e correcao de cadastro, nao remarcacao — remarcar continua no Adiar);
--     - aceita data anterior ou posterior;
--     - motivo obrigatorio; grava data antiga, data nova e motivo no historico;
--     - checa duplicidade (projeto + data) e conflito de agenda de TODAS as
--       equipes ativas na data nova;
--     - expectedUpdatedAt; reclassify; tudo na mesma transacao.
--   BLOQUEIOS: etapa CANCELADA, ANTECIPADA ou com Estado Trabalho CONCLUIDO
--   (para concluida, reabrir antes — evita alterar retroativamente a base usada
--   na antecipacao). Etapa ADIADA sem data continua pelo fluxo do Adiar
--   (definir nova data), nao por aqui.

-- =============================================================================
-- 1) set_project_programming_pendencia_flag — motivo obrigatorio + origem (F3)
-- =============================================================================
-- A assinatura MUDA (ganha p_reason e p_resolve_pendencia_de_id). Sem o DROP
-- abaixo o Postgres criaria uma SOBRECARGA e a versao antiga (sem motivo)
-- continuaria chamavel, furando a regra nova. Dropar a assinatura antiga e
-- obrigatorio.
drop function if exists public.set_project_programming_pendencia_flag(uuid, uuid, uuid, boolean, timestamptz);

create or replace function public.set_project_programming_pendencia_flag(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_id uuid,
  p_is_pendencia boolean,
  p_reason text default null,
  p_description text default null,
  p_resolve_pendencia_de_id uuid default null,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target record;
  v_origin record;
  v_reason text;
  v_description text;
  v_updated_at timestamptz;
  v_next boolean := coalesce(p_is_pendencia, false);
begin
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');

  if v_reason is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'REASON_REQUIRED',
      'message', 'Informe o motivo para marcar/desmarcar a pendencia.');
  end if;

  v_description := nullif(btrim(coalesce(p_description, '')), '');

  -- Descricao do que ficou pendente so e exigida ao LIGAR a flag.
  if v_next and v_description is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'PENDENCIA_DESCRIPTION_REQUIRED',
      'message', 'Descreva o servico que ficou pendente.');
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

  if v_target.status not in ('PROGRAMADA', 'REPROGRAMADA') then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'STAGE_NOT_ACTIVE',
      'message', 'Somente etapas ativas podem marcar/desmarcar pendencia.');
  end if;

  if p_expected_updated_at is not null and v_target.updated_at <> p_expected_updated_at then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONFLICT',
      'message', 'A etapa foi alterada por outro usuario. Recarregue antes de tentar novamente.',
      'currentUpdatedAt', v_target.updated_at);
  end if;

  if v_target.is_pendencia = v_next then
    return jsonb_build_object('success', true, 'status', 200, 'programming_id', p_programming_id,
      'updated_at', v_target.updated_at, 'message', 'Nenhuma mudanca de pendencia.');
  end if;

  -- Guarda da 321: desligar num projeto com CONCLUIDO ativo nao-pendencia.
  if not v_next
     and coalesce(public.programming_project_has_active_completion(p_tenant_id, v_target.project_id), false) then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'PROJECT_COMPLETED_REQUIRES_REOPEN',
      'message', 'Projeto concluido: reabra a etapa concluida antes de desmarcar a pendencia desta etapa.');
  end if;

  -- Vinculo de origem (opcional): so ao LIGAR, e a origem precisa ser outra
  -- etapa do MESMO projeto/tenant.
  if v_next and p_resolve_pendencia_de_id is not null then
    select * into v_origin
    from public.programming
    where id = p_resolve_pendencia_de_id and tenant_id = p_tenant_id;

    if v_origin.id is null or v_origin.project_id <> v_target.project_id then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_PENDENCIA_ORIGIN',
        'message', 'A etapa de origem da pendencia precisa ser outra etapa do mesmo projeto.');
    end if;

    if v_origin.id = v_target.id then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_PENDENCIA_ORIGIN',
        'message', 'A etapa de origem nao pode ser a propria etapa.');
    end if;

    -- A origem precisa ter o RESULTADO lancado: nao da para registrar uma sobra
    -- de uma etapa cujo Estado do Trabalho ainda esta em branco.
    if coalesce(v_origin.work_completion_status, '') = '' then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'ORIGIN_WORK_STATUS_REQUIRED',
        'message', 'Informe primeiro o resultado da etapa que originou a pendencia.');
    end if;

    if v_origin.work_completion_status not in ('PARCIAL_NAO_PLANEJADO', 'PARCIAL_PLANEJADO', 'BENEFICIO_ATINGIDO', 'CONCLUIDO') then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_ORIGIN_WORK_STATUS',
        'message', 'A etapa de origem precisa estar em Parcial, Beneficio atingido ou Concluido.');
    end if;
  end if;

  update public.programming
  set
    is_pendencia = v_next,
    -- Ao ligar grava a origem informada; ao desligar limpa o vinculo.
    resolve_pendencia_de_id = case when v_next then p_resolve_pendencia_de_id else null end,
    updated_by = p_actor_user_id
  where id = p_programming_id and tenant_id = p_tenant_id
  returning updated_at into v_updated_at;

  perform public.append_programming_history_record(
    p_tenant_id, p_programming_id, null, p_actor_user_id, 'SET_PENDENCIA_FLAG', v_reason,
    jsonb_build_object(
      'isPendencia', jsonb_build_object('from', v_target.is_pendencia, 'to', v_next),
      'pendenciaDescription', jsonb_build_object('from', null, 'to', v_description),
      'resolvePendenciaDeId', jsonb_build_object(
        'from', v_target.resolve_pendencia_de_id,
        'to', case when v_next then p_resolve_pendencia_de_id else null end
      )
    )
  );

  perform public.reclassify_project_programming_stages(p_tenant_id, v_target.project_id, p_actor_user_id);

  return jsonb_build_object(
    'success', true, 'status', 200,
    'programming_id', p_programming_id,
    'updated_at', v_updated_at,
    'message', case when v_next then 'Pendencia marcada.' else 'Pendencia desmarcada.' end
  );
end;
$$;

-- =============================================================================
-- 2) correct_project_programming_stage_date — corrigir data mantendo o registro (F10)
-- =============================================================================
create or replace function public.correct_project_programming_stage_date(
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
  v_target record;
  v_team record;
  v_conflict record;
  v_reason text;
  v_updated_at timestamptz;
begin
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');

  if p_new_execution_date is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'DATE_REQUIRED',
      'message', 'Informe a data correta.');
  end if;

  if v_reason is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'REASON_REQUIRED',
      'message', 'Informe o motivo da correcao de data.');
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

  -- Bloqueios (decisao): CANCELADA/ANTECIPADA nunca; concluida exige reabrir
  -- (nao alterar retroativamente a base usada na antecipacao).
  if v_target.status in ('CANCELADA', 'ANTECIPADA') then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'STAGE_NOT_CORRECTABLE',
      'message', 'Etapa cancelada ou antecipada nao pode ter a data corrigida.');
  end if;

  if coalesce(v_target.work_completion_status, '') = 'CONCLUIDO' then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'STAGE_COMPLETED_REQUIRES_REOPEN',
      'message', 'Etapa concluida: reabra antes de corrigir a data.');
  end if;

  -- Etapa em espera (ADIADA sem data) segue pelo Adiar > nova data.
  if v_target.status = 'ADIADA' and v_target.execution_date is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'STAGE_ON_HOLD_USE_POSTPONE',
      'message', 'Etapa em espera: use Adiar para definir a nova data.');
  end if;

  if p_expected_updated_at is not null and v_target.updated_at <> p_expected_updated_at then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONFLICT',
      'message', 'A etapa foi alterada por outro usuario. Recarregue antes de corrigir a data.',
      'currentUpdatedAt', v_target.updated_at);
  end if;

  if v_target.execution_date is not distinct from p_new_execution_date then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'DATE_UNCHANGED',
      'message', 'A data informada e a mesma ja gravada na etapa.');
  end if;

  -- Duplicidade projeto + data (o indice unico parcial tambem barra, mas aqui a
  -- mensagem fica clara).
  if exists (
    select 1 from public.programming p
    where p.tenant_id = p_tenant_id
      and p.project_id = v_target.project_id
      and p.id <> v_target.id
      and p.execution_date = p_new_execution_date
  ) then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'UNIQUE_STAGE_PER_DATE',
      'message', 'Ja existe uma etapa para este projeto na data informada.');
  end if;

  -- Conflito de agenda de TODAS as equipes ativas na data nova.
  for v_team in
    select * from public.programming_team
    where programming_id = p_programming_id and tenant_id = p_tenant_id and status = 'ATIVA'
  loop
    select * into v_conflict
    from public.programming_team_schedule_conflict(
      p_tenant_id, v_team.team_id, p_new_execution_date, v_target.start_time, v_target.end_time, p_programming_id
    )
    limit 1;

    if v_conflict.programming_id is not null then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'TEAM_TIME_CONFLICT',
        'message', 'Uma das equipes ja tem alocacao ativa com horario sobreposto na data corrigida.');
    end if;
  end loop;

  -- PRESERVA o status atual de proposito (correcao de cadastro != remarcacao).
  update public.programming
  set execution_date = p_new_execution_date,
      updated_by = p_actor_user_id
  where id = p_programming_id and tenant_id = p_tenant_id
  returning updated_at into v_updated_at;

  perform public.append_programming_history_record(
    p_tenant_id, p_programming_id, null, p_actor_user_id, 'CORRECT_STAGE_DATE', v_reason,
    jsonb_build_object('executionDate', jsonb_build_object('from', v_target.execution_date, 'to', p_new_execution_date))
  );

  perform public.reclassify_project_programming_stages(p_tenant_id, v_target.project_id, p_actor_user_id);

  return jsonb_build_object(
    'success', true, 'status', 200,
    'programming_id', p_programming_id,
    'updated_at', v_updated_at,
    'message', 'Data corrigida com sucesso.'
  );
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'UNIQUE_STAGE_PER_DATE',
      'message', 'Ja existe uma etapa para este projeto na data informada.');
end;
$$;

-- =============================================================================
-- 3) Hardening de grants (service_role apenas)
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
        'set_project_programming_pendencia_flag',
        'correct_project_programming_stage_date'
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);

    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '329: funcao % ainda executavel por anon/authenticated', v_fn;
    end if;
  end loop;
end;
$$;
