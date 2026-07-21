-- 321_guard_pendencia_toggle_and_single_completion.sql
-- Fecha a brecha CRÍTICA em que a flag is_pendencia virava um caminho para furar
-- a trava de projeto concluído.
--
-- BRECHA (achado 2 da auditoria)
-- ---------------------------------------------------------------------------
-- set_project_programming_pendencia_flag (migration 318) invertia is_pendencia
-- sem nenhuma guarda no sentido true->false. Cenários:
--   a) Projeto tem etapa A CONCLUIDO. Cria B com Pendência (permitido pela
--      exceção). Desliga a Pendência de B -> B vira etapa comum num projeto
--      concluído, sem reabrir A.
--   b) A é CONCLUIDO não-pendência. B é pendência E concluída. Desliga a
--      Pendência de B -> o projeto passa a ter DOIS CONCLUIDO não-pendência
--      (a guarda de mark_completed só agia no momento da conclusão).
--
-- CORREÇÃO
-- ---------------------------------------------------------------------------
-- 1) No toggle, bloquear true->false enquanto o projeto tiver um CONCLUIDO ativo
--    não-pendência (programming_project_has_active_completion já ignora
--    is_pendencia). Isso cobre (a) — etapa comum em projeto concluído — e (b) —
--    segundo CONCLUIDO comum. O caso em que a própria pendência concluída é a
--    ÚNICA conclusão do projeto (has_active_completion=false) continua permitido:
--    vira a conclusão do projeto, sem violar a invariante de "um por projeto".
-- 2) Índice único parcial como defesa em profundidade: no máximo um CONCLUIDO
--    ativo não-pendência por projeto, independente do caminho.

-- =============================================================================
-- 1) Pré-checagem: o índice único falharia se já houver projeto com 2+ CONCLUIDO
--    ativo não-pendência (dado legado/backfill). Falhar aqui com mensagem clara.
-- =============================================================================
do $$
declare
  v_dups int;
begin
  select count(*) into v_dups from (
    select tenant_id, project_id
    from public.programming
    where status in ('PROGRAMADA', 'REPROGRAMADA')
      and work_completion_status = 'CONCLUIDO'
      and is_pendencia = false
    group by tenant_id, project_id
    having count(*) > 1
  ) d;

  if v_dups > 0 then
    raise exception
      '321: % projeto(s) já têm 2+ etapas CONCLUIDO ativas não-pendência. Limpe esses casos (reabrir/cancelar duplicatas) antes de aplicar o índice único.',
      v_dups;
  end if;
end;
$$;

-- =============================================================================
-- 2) Índice único parcial: um CONCLUIDO ativo não-pendência por projeto
-- =============================================================================
create unique index if not exists programming_one_active_completion_per_project
  on public.programming (tenant_id, project_id)
  where status in ('PROGRAMADA', 'REPROGRAMADA')
    and work_completion_status = 'CONCLUIDO'
    and is_pendencia = false;

-- =============================================================================
-- 3) set_project_programming_pendencia_flag — guarda no true->false
-- =============================================================================
create or replace function public.set_project_programming_pendencia_flag(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_id uuid,
  p_is_pendencia boolean,
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
  v_next boolean := coalesce(p_is_pendencia, false);
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

  -- GUARDA (achado 2): desligar a pendencia num projeto que tem um CONCLUIDO
  -- ativo nao-pendencia traria a etapa de volta como comum sem reabrir, ou
  -- criaria um segundo CONCLUIDO comum. has_active_completion ignora is_pendencia,
  -- entao so bloqueia quando ja existe uma conclusao "de verdade" no projeto.
  if not v_next
     and coalesce(public.programming_project_has_active_completion(p_tenant_id, v_target.project_id), false) then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'PROJECT_COMPLETED_REQUIRES_REOPEN',
      'message', 'Projeto concluido: reabra a etapa concluida antes de desmarcar a pendencia desta etapa.');
  end if;

  update public.programming
  set is_pendencia = v_next, updated_by = p_actor_user_id
  where id = p_programming_id and tenant_id = p_tenant_id
  returning updated_at into v_updated_at;

  perform public.append_programming_history_record(
    p_tenant_id, p_programming_id, null, p_actor_user_id, 'SET_PENDENCIA_FLAG', null,
    jsonb_build_object('isPendencia', jsonb_build_object('from', v_target.is_pendencia, 'to', v_next))
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
-- 4) Hardening de grants (DROP+CREATE nao houve, mas reaplica por seguranca)
-- =============================================================================
do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = 'set_project_programming_pendencia_flag'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);

    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '321: funcao % ainda executavel por anon/authenticated', v_fn;
    end if;
  end loop;
end;
$$;
