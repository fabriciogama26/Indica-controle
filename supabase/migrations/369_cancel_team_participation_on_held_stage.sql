-- 369_cancel_team_participation_on_held_stage.sql
-- Permite CANCELAR A PARTICIPACAO de uma equipe em etapa "em espera" (ADIADA).
--
-- O PROBLEMA (achado ao expor a saida do "em espera" — ver 368 e o TXT da tela)
-- ---------------------------------------------------------------------------
-- Retomar uma etapa em espera revalida o conflito de agenda de TODAS as equipes
-- ATIVA na data escolhida e, se UMA conflitar, recusa a retomada inteira
-- (TEAM_TIME_CONFLICT). Isso e o caso provavel, nao a excecao: a obra fica
-- semanas parada e a equipe e realocada para outro projeto no meio do caminho.
--
-- Para destravar, o usuario precisa tirar aquela equipe ANTES de retomar. Hoje:
--   - remove_project_programming_team  -> ACEITA etapa em espera (nao checa o
--     status da etapa; so protege a ultima equipe de etapa CONCLUIDA, 322);
--   - cancel_project_programming_team  -> RECUSA com STAGE_NOT_ACTIVE (349);
--   - postpone_project_programming_team -> RECUSA, e continua recusando de
--     proposito: "adiar equipe" parte da data da etapa de origem, que a etapa em
--     espera nao tem.
-- Sobrava so o REMOVER, que grava a semantica ERRADA: REMOVIDA significa
-- "cadastrada por engano" (349), nao "estava programada e nao vem mais". Sem
-- esta migration, destravar a retomada custaria falsear o historico.
--
-- DECISAO (aprovada pelo usuario)
-- ---------------------------------------------------------------------------
-- `cancel_project_programming_team` passa a aceitar etapa `ADIADA`, alem de
-- PROGRAMADA/REPROGRAMADA — mesmo movimento que a 337 fez em
-- cancel_project_programming_stage e postpone_project_programming_stage.
-- CANCELADA continua registrando motivo/quem/quando, que e exatamente o que o
-- caso pede.
--
-- ADICIONAR equipe permanece bloqueado em etapa em espera (317): sem
-- execution_date, `programming_team_schedule_conflict` nao casa nada e a
-- alocacao entraria sem checagem nenhuma. Realocar e depois da retomada.
--
-- A guarda de ULTIMA equipe ativa (LAST_ACTIVE_TEAM) vale igual para etapa em
-- espera: esvaziar a etapa continua sendo decisao consciente do usuario.
--
-- ESCOPO: corpo IDENTICO ao da 349, mudando so a lista de status aceitos e a
-- mensagem correspondente.

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

  -- 369: aceita tambem etapa em espera (ADIADA), para o usuario poder tirar a
  -- equipe que travaria a retomada sem ter de falsear o historico com REMOVIDA.
  if v_stage.status not in ('PROGRAMADA', 'REPROGRAMADA', 'ADIADA') then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'STAGE_NOT_ACTIVE',
      'message', 'A etapa desta alocacao nao esta ativa nem em espera.');
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
      and p.proname = 'cancel_project_programming_team'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);

    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '369: funcao % ainda executavel por anon/authenticated', v_fn;
    end if;
  end loop;
end;
$$;
