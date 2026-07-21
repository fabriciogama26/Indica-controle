-- 326_postpone_clears_work_completion_status.sql
-- Achado (revisao do Mapa): postpone_project_programming_stage nao zerava
-- work_completion_status ao adiar/remarcar in-place. Regra da spec §3:
-- "ADIADA/CANCELADA: Estado Trabalho em branco". No modelo antigo (linha nova) a
-- linha nascia zerada; no modelo in-place (318) isso precisa ser explicito.
--
-- IMPORTANTE: esta correcao estava, por engano, editada direto na 318 (ja
-- aplicada). A 318 foi restaurada e o fix movido para esta migration nova, para
-- manter a correspondencia arquivo<->banco. Corpo identico ao postpone da 318 +
-- "work_completion_status = null" no UPDATE.

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
  if p_new_execution_date is not null then
    if v_old.execution_date is not null and p_new_execution_date <= v_old.execution_date then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'DATE_MUST_BE_LATER',
        'message', 'A nova data precisa ser posterior a data atual da etapa.');
    end if;

    v_new_status := 'REPROGRAMADA';

    -- Conflito de agenda por equipe na nova data (so ha agenda quando ha data).
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
  end if;

  -- Estado do Trabalho volta a branco ao adiar/remarcar (paridade com o modelo
  -- antigo, que nascia a linha nova zerada; obrigatorio para ADIADA — spec §3:
  -- "ADIADA/CANCELADA: Estado Trabalho em branco").
  update public.programming
  set
    execution_date = p_new_execution_date,
    status = v_new_status,
    work_completion_status = null,
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
    'on_hold', (p_new_execution_date is null),
    'message', case when p_new_execution_date is null then 'Etapa colocada em espera.' else 'Etapa remarcada com sucesso.' end
  );
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'UNIQUE_STAGE_PER_DATE',
      'message', 'Ja existe uma etapa para este projeto na nova data.');
end;
$$;


-- Hardening de grants (reaplica por seguranca).
do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = 'postpone_project_programming_stage'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '326: funcao % ainda executavel por anon/authenticated', v_fn;
    end if;
  end loop;
end;
$$;
