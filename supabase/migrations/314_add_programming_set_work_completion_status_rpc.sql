-- 314_add_programming_set_work_completion_status_rpc.sql
-- A lista/card de Programacao Normalizada separou "Status" (agenda, somente
-- leitura) de "Estado do trabalho" (execucao, editavel pelo usuario). Ate aqui
-- nao existia nenhuma RPC que deixasse o usuario gravar Estado Trabalho
-- diretamente: CONCLUIDO/ANTECIPADO ja tinham suas RPCs dedicadas
-- (mark_project_programming_completed_and_anticipate/reopen_project_programming_completed),
-- e PENDENCIA/em branco eram so calculados automaticamente ao criar/adiar.
--
-- Esta RPC cobre os 5 valores que faltavam (em branco, PARCIAL_PLANEJADO,
-- PARCIAL_NAO_PLANEJADO, BENEFICIO_ATINGIDO, PENDENCIA agora tambem manual).
-- CONCLUIDO/ANTECIPADO continuam bloqueados aqui de proposito: o frontend
-- reusa Concluir/Reabrir para esses dois (mesmo guard de "unico CONCLUIDO
-- ativo por projeto" e mesma cascata de antecipacao ja validados).
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

  if v_target.status not in ('PROGRAMADA', 'REPROGRAMADA') then
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
  where id = p_programming_id and tenant_id = p_tenant_id
  returning updated_at into v_updated_at;

  perform public.append_programming_history_record(
    p_tenant_id, p_programming_id, null, p_actor_user_id, 'SET_WORK_COMPLETION_STATUS', null,
    jsonb_build_object('workCompletionStatus', jsonb_build_object('from', v_target.work_completion_status, 'to', v_status))
  );

  return jsonb_build_object(
    'success', true, 'status', 200,
    'programming_id', p_programming_id,
    'updated_at', v_updated_at,
    'message', 'Estado do trabalho atualizado com sucesso.'
  );
end;
$$;

-- Hardening de grants: revoga public/anon/authenticated, concede so a
-- service_role, mesmo padrao das migrations 311/313.
do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = 'set_project_programming_work_completion_status'
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
      and p.proname = 'set_project_programming_work_completion_status'
  loop
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception '314: funcao % ainda executavel por anon', v_fn;
    end if;

    if has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '314: funcao % ainda executavel por authenticated', v_fn;
    end if;
  end loop;
end;
$$;
