-- 322_require_team_to_complete_and_atomic_reopen_change.sql
-- Achados 5 e 4 da auditoria.
--
-- F5 (Alto): etapa podia ser concluida sem nenhuma equipe ativa, e a ultima
--   equipe de uma etapa concluida podia ser removida. Regra: planejamento pode
--   ficar sem equipe, mas CONCLUIR exige >= 1 equipe ativa e nao se pode remover
--   a ultima equipe de uma etapa ja concluida.
--
-- F4 (Alto): sair de CONCLUIDO era 2 chamadas RPC no front (reopen -> set),
--   deixando estado intermediario perigoso se a 2a falhasse (projeto reaberto
--   sem o novo estado). Nova RPC unica e transacional change_completed_stage_
--   work_status faz reabrir + restaurar antecipadas + aplicar o novo estado +
--   reclassify num so commit.

-- =============================================================================
-- 1) mark_..._completed_and_anticipate — exige >= 1 equipe ativa (F5)
--    (corpo da 318 + a nova guarda de equipe)
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

  -- F5: concluir exige ao menos uma equipe ativa (planejamento pode ficar sem).
  if not exists (
    select 1 from public.programming_team pt
    where pt.programming_id = p_programming_id and pt.tenant_id = p_tenant_id and pt.status = 'ATIVA'
  ) then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'STAGE_HAS_NO_TEAM',
      'message', 'Aloque ao menos uma equipe ativa antes de concluir a etapa.');
  end if;

  if p_expected_updated_at is not null and v_target.updated_at <> p_expected_updated_at then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONFLICT',
      'message', 'A etapa foi alterada por outro usuario. Recarregue antes de concluir.',
      'currentUpdatedAt', v_target.updated_at);
  end if;

  if not v_target.is_pendencia and exists (
    select 1 from public.programming p
    where p.tenant_id = p_tenant_id
      and p.project_id = v_target.project_id
      and p.id <> v_target.id
      and p.status in ('PROGRAMADA', 'REPROGRAMADA')
      and p.work_completion_status = 'CONCLUIDO'
      and p.is_pendencia = false
  ) then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'PROJECT_ALREADY_COMPLETED',
      'message', 'Ja existe uma etapa concluida ativa neste projeto.');
  end if;

  update public.programming
  set work_completion_status = 'CONCLUIDO', updated_by = p_actor_user_id
  where id = p_programming_id and tenant_id = p_tenant_id
  returning updated_at into v_updated_at;

  if not v_target.is_pendencia then
    for v_row in
      select * from public.programming
      where tenant_id = p_tenant_id
        and project_id = v_target.project_id
        and id <> v_target.id
        and status in ('PROGRAMADA', 'REPROGRAMADA')
        and is_pendencia = false
        and execution_date is not null
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
  end if;

  perform public.append_programming_history_record(
    p_tenant_id, p_programming_id, null, p_actor_user_id, 'COMPLETE_STAGE', null,
    jsonb_build_object('anticipatedCount', v_anticipated_count, 'isPendencia', v_target.is_pendencia)
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
-- 2) remove_project_programming_team — nao remover a ultima de etapa concluida (F5)
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

  if p_expected_updated_at is not null and v_team_row.updated_at <> p_expected_updated_at then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONFLICT',
      'message', 'A alocacao da equipe foi alterada por outro usuario. Recarregue antes de remover.',
      'currentUpdatedAt', v_team_row.updated_at);
  end if;

  -- F5: nao remover a ULTIMA equipe ativa de uma etapa concluida (ficaria uma
  -- etapa concluida sem responsavel). Etapa nao-concluida pode ficar sem equipe.
  select * into v_stage
  from public.programming
  where id = v_team_row.programming_id and tenant_id = p_tenant_id;

  if coalesce(v_stage.work_completion_status, '') = 'CONCLUIDO' then
    select count(*) into v_active_count
    from public.programming_team pt
    where pt.programming_id = v_team_row.programming_id and pt.tenant_id = p_tenant_id and pt.status = 'ATIVA';

    if v_active_count <= 1 then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'STAGE_COMPLETED_LAST_TEAM',
        'message', 'Etapa concluida: nao e possivel remover a ultima equipe. Reabra a etapa antes.');
    end if;
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
-- 3) change_completed_stage_work_status — sair de CONCLUIDO atomicamente (F4)
-- =============================================================================
-- Reabre a etapa (restaura as antecipadas por ela) E aplica o novo Estado do
-- Trabalho num unico commit. Substitui o par reopen+set que o front fazia em
-- duas chamadas. p_new_work_completion_status: null/em branco, PARCIAL_PLANEJADO,
-- PARCIAL_NAO_PLANEJADO ou BENEFICIO_ATINGIDO (nunca CONCLUIDO/ANTECIPADO).
create or replace function public.change_completed_stage_work_status(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_id uuid,
  p_new_work_completion_status text default null,
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
  v_status text;
  v_updated_at timestamptz;
  v_restored_count integer := 0;
begin
  v_status := nullif(btrim(coalesce(p_new_work_completion_status, '')), '');

  if v_status is not null and v_status not in ('PARCIAL_PLANEJADO', 'PARCIAL_NAO_PLANEJADO', 'BENEFICIO_ATINGIDO') then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_WORK_COMPLETION_STATUS',
      'message', 'Estado do trabalho invalido. Use Concluir para Concluido.');
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

  if coalesce(v_target.work_completion_status, '') <> 'CONCLUIDO' then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'STAGE_NOT_COMPLETED',
      'message', 'Esta etapa nao esta concluida.');
  end if;

  if p_expected_updated_at is not null and v_target.updated_at <> p_expected_updated_at then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONFLICT',
      'message', 'A etapa foi alterada por outro usuario. Recarregue antes de tentar novamente.',
      'currentUpdatedAt', v_target.updated_at);
  end if;

  -- Aplica o novo estado na propria etapa (reabre saindo de CONCLUIDO).
  update public.programming
  set work_completion_status = v_status, updated_by = p_actor_user_id
  where id = p_programming_id and tenant_id = p_tenant_id
  returning updated_at into v_updated_at;

  -- Restaura as etapas antecipadas por esta conclusao (mesma logica do reopen).
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
    p_tenant_id, p_programming_id, null, p_actor_user_id, 'CHANGE_COMPLETED_WORK_STATUS', null,
    jsonb_build_object(
      'workCompletionStatus', jsonb_build_object('from', 'CONCLUIDO', 'to', v_status),
      'restoredCount', v_restored_count
    )
  );

  perform public.reclassify_project_programming_stages(p_tenant_id, v_target.project_id, p_actor_user_id);

  return jsonb_build_object(
    'success', true, 'status', 200,
    'programming_id', p_programming_id,
    'updated_at', v_updated_at,
    'restored_count', v_restored_count,
    'message', 'Estado do trabalho atualizado com sucesso.'
  );
end;
$$;

-- =============================================================================
-- 4) Hardening de grants (service_role apenas)
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
        'mark_project_programming_completed_and_anticipate',
        'remove_project_programming_team',
        'change_completed_stage_work_status'
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);

    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '322: funcao % ainda executavel por anon/authenticated', v_fn;
    end if;
  end loop;
end;
$$;
