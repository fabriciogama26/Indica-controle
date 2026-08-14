-- 368_restore_postpone_unique_violation_handler.sql
-- Restaura o tratamento de `unique_violation` em
-- postpone_project_programming_stage, perdido na 337.
--
-- REGRESSAO (confirmada lendo as tres versoes da funcao)
-- ---------------------------------------------------------------------------
-- A 326 terminava a funcao com:
--     exception
--       when unique_violation then
--         return jsonb_build_object(..., 'status', 409,
--           'reason', 'UNIQUE_STAGE_PER_DATE', ...);
-- A 337 reescreveu a funcao inteira (para gravar o snapshot de classificacao) e
-- NAO recolocou esse bloco. Desde entao, remarcar para uma data que ja tem etapa
-- ATIVA no projeto viola `programming_active_project_date_key` (346) e o 23505
-- sobe cru: `postponeProgrammingStageViaRpc` cai em `failedRpcResult`
-- (src/server/modules/programacao-normalizada/rpc.ts) e a tela mostra erro
-- generico de RPC em vez do 409 com mensagem de negocio.
--
-- O comentario da 346 ("save_project_programming_stage e
-- postpone_project_programming_stage ja capturam `exception when
-- unique_violation`") descrevia a 326 e ficou desatualizado quando a 337 entrou.
-- save_project_programming_stage segue com o handler; so o postpone perdeu.
--
-- POR QUE AGORA
-- ---------------------------------------------------------------------------
-- A tela passou a permitir SAIR do "em espera" (etapa ADIADA volta ao plano
-- recebendo data, virando REPROGRAMADA — caminho que a RPC ja suportava desde a
-- 337 e que so faltava expor na UI). O caso mais provavel dessa retomada e
-- justamente o que dispara a violacao: a etapa foi para espera, outra etapa foi
-- criada naquela data e o usuario tenta voltar para la.
--
-- ESCOPO: corpo IDENTICO ao da 337, com o bloco `exception` de volta no fim. A
-- mensagem foi corrigida para dizer etapa "ATIVA" — desde a 346 a unicidade e
-- "no maximo uma etapa PROGRAMADA/REPROGRAMADA por projeto+data"; CANCELADA,
-- ADIADA e ANTECIPADA convivem na mesma data.

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
  v_team record;
  v_conflict record;
  v_new_status text;
  v_updated_at timestamptz;
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

  -- Aceita ativa (PROGRAMADA/REPROGRAMADA) e em espera (ADIADA).
  if v_old.status not in ('PROGRAMADA', 'REPROGRAMADA', 'ADIADA') then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'STAGE_NOT_ACTIVE',
      'message', 'Somente etapas ativas ou em espera podem ser adiadas/remarcadas.');
  end if;

  if not v_old.is_pendencia
     and coalesce(public.programming_project_has_active_completion(p_tenant_id, v_old.project_id), false) then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'PROJECT_COMPLETED_REQUIRES_REOPEN',
      'message', 'Projeto concluido: reabra antes de adiar.');
  end if;

  if p_expected_updated_at is not null and v_old.updated_at <> p_expected_updated_at then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONFLICT',
      'message', 'A etapa foi alterada por outro usuario. Recarregue antes de adiar.',
      'currentUpdatedAt', v_old.updated_at);
  end if;

  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'REASON_REQUIRED',
      'message', 'Informe o motivo do adiamento.');
  end if;

  -- Rota "nova data": precisa ser diferente da atual e, se a etapa tinha data,
  -- posterior a ela. Rota "em espera": p_new_execution_date IS NULL.
  --
  -- Retomada a partir do "em espera" (v_old.execution_date IS NULL) aceita
  -- QUALQUER data, inclusive anterior a hoje: a etapa perdeu a referencia de
  -- agenda (a data que ela tinha vive no snapshot da 337) e a regularizacao de
  -- servico ja executado e caso real. Decisao do usuario, mantida da 337.
  if p_new_execution_date is not null then
    if v_old.execution_date is not null and p_new_execution_date <= v_old.execution_date then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'DATE_MUST_BE_LATER',
        'message', 'A nova data precisa ser posterior a data atual da etapa.');
    end if;

    v_new_status := 'REPROGRAMADA';

    -- Conflito de agenda por equipe na nova data (so ha agenda quando ha data).
    -- Vale tambem na retomada: as equipes seguem ATIVA na etapa enquanto ela
    -- esta em espera (o "em espera" nao mexe em programming_team), entao voltar
    -- para uma data pode reocupar horario ja comprometido em outro projeto.
    for v_team in
      select * from public.programming_team
      where programming_id = p_programming_id and tenant_id = p_tenant_id and status = 'ATIVA'
    loop
      select * into v_conflict
      from public.programming_team_schedule_conflict(
        p_tenant_id, v_team.team_id, p_new_execution_date, v_old.start_time, v_old.end_time, p_programming_id
      )
      limit 1;

      if v_conflict.programming_id is not null then
        return jsonb_build_object('success', false, 'status', 409, 'reason', 'TEAM_TIME_CONFLICT',
          'message', 'Uma das equipes ja tem alocacao ativa com horario sobreposto na nova data.');
      end if;
    end loop;
  else
    -- Em espera: so faz sentido a partir de uma etapa que tem data.
    if v_old.execution_date is null then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'ALREADY_ON_HOLD',
        'message', 'A etapa ja esta em espera (sem data).');
    end if;
    v_new_status := 'ADIADA';

    -- 337: fotografa antes de perder data e classificacao.
    perform public.capture_programming_classification_snapshot(p_tenant_id, p_programming_id);
  end if;

  -- Estado do Trabalho volta a branco ao adiar/remarcar (paridade com o modelo
  -- antigo, que nascia a linha nova zerada; obrigatorio para ADIADA — spec §3:
  -- "ADIADA/CANCELADA: Estado Trabalho em branco").
  update public.programming
  set
    execution_date = p_new_execution_date,
    status = v_new_status,
    work_completion_status = null,
    -- 337: voltar a ter data devolve a etapa ao plano ativo — a classificacao
    -- atual passa a valer e o snapshot nao pode mais mandar na exibicao.
    classification_snapshot_number = case when p_new_execution_date is not null then null else classification_snapshot_number end,
    classification_snapshot_unica = case when p_new_execution_date is not null then null else classification_snapshot_unica end,
    classification_snapshot_final = case when p_new_execution_date is not null then null else classification_snapshot_final end,
    classification_snapshot_execution_date = case when p_new_execution_date is not null then null else classification_snapshot_execution_date end,
    classification_snapshot_at = case when p_new_execution_date is not null then null else classification_snapshot_at end,
    updated_by = p_actor_user_id
  where id = p_programming_id and tenant_id = p_tenant_id
  returning updated_at into v_updated_at;

  perform public.append_programming_history_record(
    p_tenant_id, p_programming_id, null, p_actor_user_id, 'POSTPONE_STAGE', p_reason,
    jsonb_build_object('executionDate', jsonb_build_object('from', v_old.execution_date, 'to', p_new_execution_date))
  );

  perform public.reclassify_project_programming_stages(p_tenant_id, v_old.project_id, p_actor_user_id);

  return jsonb_build_object(
    'success', true, 'status', 200,
    'programming_id', p_programming_id,
    'updated_at', v_updated_at,
    'new_execution_date', p_new_execution_date,
    'new_status', v_new_status,
    'message', case
                 when p_new_execution_date is not null then 'Etapa remarcada com sucesso.'
                 else 'Etapa colocada em espera.'
               end
  );
exception
  -- Restaurado da 326. Capturado por SQLSTATE 23505, nao por nome de indice:
  -- vale para `programming_active_project_date_key` (346) e para qualquer
  -- sucessor dele.
  when unique_violation then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'UNIQUE_STAGE_PER_DATE',
      'message', 'Ja existe uma etapa ativa para este projeto nesta data.');
end;
$$;

-- =============================================================================
-- Hardening de grants: service_role apenas
-- =============================================================================
do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = 'postpone_project_programming_stage'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);

    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '368: funcao % ainda executavel por anon/authenticated', v_fn;
    end if;
  end loop;
end;
$$;
