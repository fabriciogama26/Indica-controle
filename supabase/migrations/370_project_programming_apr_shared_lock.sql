-- 370_project_programming_apr_shared_lock.sql
-- Auditoria-Concorrencia/2026-08-15-relatorio.md, achados CRITICOS #4 (Projetos x
-- Programacao Normalizada) e MEDIO #5 (Projetos x Controle de APR).
--
-- Problema: `set_project_record_status` (cancelar/ativar projeto) trava a linha de
-- `project` com `for update`, mas sua re-checagem interna de "programacao pendente"
-- consulta `public.project_programming` -- a tabela LEGADA, sem escrita viva desde o
-- corte para o modelo normalizado (`public.programming`, ver
-- docs/Tela_Cronograma_Solicitacoes_SaaS.txt, "Fase 3a do corte", e a migration 364
-- que retirou a tela `programacao-simples`). O guard real hoje e so o pre-check em JS
-- (`countActiveStagesForProject`, ja le `programming` corretamente), que roda ANTES da
-- RPC, sem nenhum lock. `save_project_programming_stage` e as demais RPCs de
-- criar/reabrir etapa (migrations 318/322/337/340/369) so tomam
-- `pg_advisory_xact_lock(hashtextextended(tenant:project, 0))` -- um namespace de lock
-- diferente do `for update` de `project`. As duas operacoes nao se bloqueiam: cancelar
-- o projeto e criar/reabrir uma etapa quase ao mesmo tempo pode terminar com projeto
-- CANCELADO e etapa PROGRAMADA/REPROGRAMADA ativa.
--
-- `save_project_apr_control` tem o mesmo problema pela outra ponta: le
-- `project.is_active` sem lock nenhum (nem `for update`, nem advisory lock) antes de
-- criar/editar uma APR -- se o cancelamento do projeto commitar entre essa leitura e o
-- insert, a APR fica presa a um projeto ja inativo.
--
-- Nota (achado registrado, NAO corrigido nesta migration por decisao explicita): a
-- migration 233_harden_projects_programming_cross_flow.sql ja criou 2 triggers
-- (`enforce_programming_active_project`, `prevent_project_inactivation_with_active_programming`)
-- com advisory lock proprio para essa mesma fronteira -- mas vigiando
-- `public.project_programming` (legada). Continuam instalados e ativos, so que
-- observando uma tabela que a Programacao Normalizada nao escreve mais, portanto sem
-- efeito pratico hoje. Nao remover nem redirecionar nesta migration -- e uma
-- investigacao separada (confirmar que nada mais depende do comportamento atual antes
-- de mexer). Registrado no relatorio da tarefa como pendencia de follow-up.
--
-- Correcao: reaproveitar o MESMO lock canonico ja usado pelas RPCs de Programacao
-- Normalizada (`pg_advisory_xact_lock(hashtextextended(tenant_id::text || ':' ||
-- project_id::text, 0))`, migrations 318/322/337/340/369) dentro de
-- `set_project_record_status` (acao CANCEL) e `save_project_apr_control`, e trocar a
-- re-checagem interna de `set_project_record_status` para consultar `programming`
-- (normalizada) com os 3 status realmente ativos (PROGRAMADA/REPROGRAMADA/ADIADA) --
-- hoje faltava REPROGRAMADA, alem de ler a tabela errada. Isso torna as 4 operacoes
-- (cancelar projeto, criar/reabrir etapa, criar/editar APR) mutuamente exclusivas por
-- (tenant, project) sem precisar de RPC nova nem mudar contrato de nenhuma delas.

create or replace function public.set_project_record_status(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_project_id uuid,
  p_action text,
  p_reason text,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.project%rowtype;
  v_action text := case when upper(coalesce(p_action, '')) = 'ACTIVATE' then 'ACTIVATE' else 'CANCEL' end;
  v_event_timestamp timestamptz := now();
  v_updated_at timestamptz;
  v_programming_count bigint;
  v_changes jsonb;
begin
  if p_project_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_project_id::text, 0));
  end if;

  select *
  into v_current
  from public.project
  where id = p_project_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROJECT_NOT_FOUND', 'message', 'Projeto nao encontrado.');
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'EXPECTED_UPDATED_AT_REQUIRED', 'message', 'Atualize a lista antes de alterar o status do projeto.');
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'CONCURRENT_MODIFICATION',
      'message', format('O projeto %s foi alterado por outro usuario. Recarregue os dados antes de alterar o status.', v_current.sob)
    );
  end if;

  if v_action = 'CANCEL' and not v_current.is_active then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'STATUS_ALREADY_CHANGED', 'message', format('Projeto %s ja esta inativo.', v_current.sob));
  end if;

  if v_action = 'ACTIVATE' and v_current.is_active then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'STATUS_ALREADY_CHANGED', 'message', format('Projeto %s ja esta ativo.', v_current.sob));
  end if;

  if v_action = 'CANCEL' then
    -- 370: fonte trocada de `project_programming` (legada, sem escrita viva) para
    -- `programming` (normalizada), com o mesmo criterio de "etapa em aberto" usado no
    -- pre-check em JS (countActiveStagesForProject). Agora protegido pelo advisory
    -- lock acima, que serializa contra as RPCs de criar/reabrir etapa.
    select count(*)
    into v_programming_count
    from public.programming
    where tenant_id = p_tenant_id
      and project_id = p_project_id
      and status in ('PROGRAMADA', 'REPROGRAMADA', 'ADIADA');

    if v_programming_count > 0 then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'PROJECT_HAS_PENDING_PROGRAMMING',
        'message', format('Projeto %s possui programacoes programadas, reprogramadas ou adiadas. Resolva essas etapas antes de inativar o projeto.', v_current.sob)
      );
    end if;
  end if;

  update public.project
  set
    is_active = case when v_action = 'ACTIVATE' then true else false end,
    cancellation_reason = case when v_action = 'ACTIVATE' then null else nullif(btrim(coalesce(p_reason, '')), '') end,
    canceled_at = case when v_action = 'ACTIVATE' then null else v_event_timestamp end,
    canceled_by = case when v_action = 'ACTIVATE' then null else p_actor_user_id end,
    updated_by = p_actor_user_id
  where id = p_project_id
    and tenant_id = p_tenant_id
  returning updated_at
  into v_updated_at;

  insert into public.project_cancellation_history (
    tenant_id,
    project_id,
    action_type,
    reason,
    created_by,
    updated_by
  ) values (
    p_tenant_id,
    p_project_id,
    v_action,
    nullif(btrim(coalesce(p_reason, '')), ''),
    p_actor_user_id,
    p_actor_user_id
  );

  v_changes := case
    when v_action = 'ACTIVATE' then jsonb_build_object(
      'isActive', jsonb_build_object('from', 'false', 'to', 'true'),
      'activationReason', jsonb_build_object('from', null, 'to', nullif(btrim(coalesce(p_reason, '')), '')),
      'canceledAt', jsonb_build_object('from', v_current.canceled_at, 'to', null),
      'cancellationReason', jsonb_build_object('from', v_current.cancellation_reason, 'to', null)
    )
    else jsonb_build_object(
      'isActive', jsonb_build_object('from', 'true', 'to', 'false'),
      'cancellationReason', jsonb_build_object('from', null, 'to', nullif(btrim(coalesce(p_reason, '')), '')),
      'canceledAt', jsonb_build_object('from', null, 'to', v_event_timestamp)
    )
  end;

  insert into public.project_history (
    tenant_id,
    project_id,
    change_type,
    changes,
    created_by,
    updated_by
  ) values (
    p_tenant_id,
    p_project_id,
    v_action,
    v_changes,
    p_actor_user_id,
    p_actor_user_id
  );

  return jsonb_build_object('success', true, 'status', 200, 'project_id', p_project_id, 'updated_at', v_updated_at);
end;
$$;

revoke all on function public.set_project_record_status(
  uuid, uuid, uuid, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.set_project_record_status(
  uuid, uuid, uuid, text, text, timestamptz
) to service_role;

create or replace function public.save_project_apr_control(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_apr_control_id uuid,
  p_apr_id text,
  p_project_id uuid,
  p_team_id uuid,
  p_service_date date,
  p_observation text,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.project_apr_controls%rowtype;
  v_project record;
  v_team record;
  v_programming record;
  v_apr_control_id uuid;
  v_apr_id text := upper(btrim(coalesce(p_apr_id, '')));
  v_observation text := nullif(btrim(coalesce(p_observation, '')), '');
  v_updated_at timestamptz;
  v_changes jsonb := '{}'::jsonb;
begin
  if not exists (
    select 1
    from public.app_users
    where id = p_actor_user_id
      and tenant_id = p_tenant_id
      and ativo = true
  ) then
    return jsonb_build_object('success', false, 'status', 403, 'reason', 'INVALID_ACTOR', 'message', 'Usuario sem acesso ao tenant informado.');
  end if;

  if v_apr_id = '' or p_project_id is null or p_team_id is null or p_service_date is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_REQUIRED_FIELDS',
      'message', 'Projeto, ID APR, Data do servico e Equipe sao obrigatorios.'
    );
  end if;

  if p_service_date > (now() at time zone 'America/Sao_Paulo')::date then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'FUTURE_SERVICE_DATE',
      'message', 'A Data do servico nao pode ser futura.'
    );
  end if;

  perform pg_advisory_xact_lock(hashtext(v_apr_id)::bigint);

  -- 370: mesmo lock canonico por (tenant, project) usado pelas RPCs de Programacao
  -- Normalizada e por set_project_record_status (migration 370). Serializa a criacao/
  -- edicao de APR contra um cancelamento concorrente do projeto -- antes desta migration
  -- a leitura de project.is_active abaixo nao tinha nenhum lock.
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_project_id::text, 0));

  if exists (
    select 1
    from public.project_apr_controls
    where upper(btrim(apr_id)) = v_apr_id
      and id is distinct from p_apr_control_id
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_APR_ID',
      'message', 'Este ID APR ja esta cadastrado no sistema.'
    );
  end if;

  select p.id, p.sob
    into v_project
  from public.project p
  where p.tenant_id = p_tenant_id
    and p.id = p_project_id
    and p.is_active = true
  limit 1;

  if v_project.id is null then
    return jsonb_build_object('success', false, 'status', 422, 'reason', 'INVALID_PROJECT', 'message', 'Projeto invalido ou inativo para o tenant atual.');
  end if;

  select
    t.id,
    t.name,
    coalesce(person.nome, '') as foreman_name
    into v_team
  from public.teams t
  left join public.people person
    on person.tenant_id = t.tenant_id
   and person.id = t.foreman_person_id
  where t.tenant_id = p_tenant_id
    and t.id = p_team_id
    and t.ativo = true
  limit 1;

  if v_team.id is null then
    return jsonb_build_object('success', false, 'status', 422, 'reason', 'INVALID_TEAM', 'message', 'Equipe invalida ou inativa para o tenant atual.');
  end if;

  -- Match normalizado (350): etapa por projeto+data em `programming`
  -- (`status <> CANCELADA`), so conta se a equipe pedida estiver ATIVA em
  -- `programming_team` naquela etapa. Desempate igual a migration 347
  -- (get_cronograma_asbuilt_project_ids): status ATIVO vence, depois
  -- updated_at desc.
  select p.id, p.status
    into v_programming
  from public.programming p
  where p.tenant_id = p_tenant_id
    and p.project_id = p_project_id
    and p.execution_date = p_service_date
    and p.status <> 'CANCELADA'
    and exists (
      select 1
      from public.programming_team pt
      where pt.tenant_id = p_tenant_id
        and pt.programming_id = p.id
        and pt.team_id = p_team_id
        and pt.status = 'ATIVA'
    )
  order by
    (case when p.status in ('PROGRAMADA', 'REPROGRAMADA') then 0 else 1 end),
    p.updated_at desc
  limit 1;

  if p_apr_control_id is not null then
    select *
      into v_current
    from public.project_apr_controls
    where tenant_id = p_tenant_id
      and id = p_apr_control_id
    for update;

    if not found then
      return jsonb_build_object('success', false, 'status', 404, 'reason', 'NOT_FOUND', 'message', 'APR nao encontrada.');
    end if;

    if v_current.status = 'CANCELADO' then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'APR_CANCELED', 'message', 'APR cancelada nao pode ser editada.');
    end if;

    if p_expected_updated_at is null or v_current.updated_at is distinct from p_expected_updated_at then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'CONCURRENT_MODIFICATION',
        'message', 'A APR foi alterada por outro usuario. Atualize a lista antes de salvar novamente.'
      );
    end if;

    v_changes := jsonb_strip_nulls(jsonb_build_object(
      'aprId', case when v_current.apr_id is distinct from v_apr_id then jsonb_build_object('from', v_current.apr_id, 'to', v_apr_id) end,
      'projectId', case when v_current.project_id is distinct from p_project_id then jsonb_build_object('from', v_current.project_id, 'to', p_project_id) end,
      'teamId', case when v_current.team_id is distinct from p_team_id then jsonb_build_object('from', v_current.team_id, 'to', p_team_id) end,
      'serviceDate', case when v_current.service_date is distinct from p_service_date then jsonb_build_object('from', v_current.service_date, 'to', p_service_date) end,
      'observation', case when v_current.observation is distinct from v_observation then jsonb_build_object('from', v_current.observation, 'to', v_observation) end,
      'status', case when v_current.status <> 'ATIVO' then jsonb_build_object('from', v_current.status, 'to', 'ATIVO') end
    ));

    update public.project_apr_controls
    set
      apr_id = v_apr_id,
      project_id = p_project_id,
      team_id = p_team_id,
      programming_id = v_programming.id,
      service_date = p_service_date,
      status = 'ATIVO',
      observation = v_observation,
      project_code_snapshot = v_project.sob,
      team_name_snapshot = v_team.name,
      foreman_name_snapshot = nullif(v_team.foreman_name, ''),
      programming_status_snapshot = v_programming.status,
      validated_at = null,
      validated_by = null,
      updated_by = p_actor_user_id
    where tenant_id = p_tenant_id
      and id = p_apr_control_id
    returning id, updated_at into v_apr_control_id, v_updated_at;

    insert into public.project_apr_control_history (
      tenant_id, apr_control_id, action_type, reason, changes, metadata, created_by
    )
    values (
      p_tenant_id,
      v_apr_control_id,
      'UPDATE',
      v_observation,
      v_changes,
      jsonb_build_object('programmingId', v_programming.id),
      p_actor_user_id
    );
  else
    insert into public.project_apr_controls (
      tenant_id,
      apr_id,
      project_id,
      team_id,
      programming_id,
      service_date,
      observation,
      project_code_snapshot,
      team_name_snapshot,
      foreman_name_snapshot,
      programming_status_snapshot,
      created_by,
      updated_by
    )
    values (
      p_tenant_id,
      v_apr_id,
      p_project_id,
      p_team_id,
      v_programming.id,
      p_service_date,
      v_observation,
      v_project.sob,
      v_team.name,
      nullif(v_team.foreman_name, ''),
      v_programming.status,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at into v_apr_control_id, v_updated_at;

    insert into public.project_apr_control_history (
      tenant_id, apr_control_id, action_type, reason, changes, metadata, created_by
    )
    values (
      p_tenant_id,
      v_apr_control_id,
      'CREATE',
      v_observation,
      jsonb_build_object(
        'aprId', jsonb_build_object('to', v_apr_id),
        'projectId', jsonb_build_object('to', p_project_id),
        'teamId', jsonb_build_object('to', p_team_id),
        'serviceDate', jsonb_build_object('to', p_service_date),
        'status', jsonb_build_object('to', 'ATIVO')
      ),
      jsonb_build_object('programmingId', v_programming.id),
      p_actor_user_id
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'apr_control_id', v_apr_control_id,
    'updated_at', v_updated_at,
    'programming_id', v_programming.id,
    'message', case when p_apr_control_id is null then 'APR cadastrada com sucesso.' else 'APR atualizada com sucesso e devolvida para conferencia.' end
  );
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'DUPLICATE_APR_ID', 'message', 'Este ID APR ja esta cadastrado no sistema.');
end;
$$;

revoke all on function public.save_project_apr_control(
  uuid, uuid, uuid, text, uuid, uuid, date, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.save_project_apr_control(
  uuid, uuid, uuid, text, uuid, uuid, date, text, timestamptz
) to service_role;

-- Validacao pos-aplicacao
do $$
declare
  v_status_fn regprocedure := 'public.set_project_record_status(uuid, uuid, uuid, text, text, timestamptz)'::regprocedure;
  v_apr_fn regprocedure := 'public.save_project_apr_control(uuid, uuid, uuid, text, uuid, uuid, date, text, timestamptz)'::regprocedure;
begin
  if has_function_privilege('anon', v_status_fn, 'execute')
     or has_function_privilege('authenticated', v_status_fn, 'execute') then
    raise exception '370: set_project_record_status ainda executavel por anon/authenticated';
  end if;

  if has_function_privilege('anon', v_apr_fn, 'execute')
     or has_function_privilege('authenticated', v_apr_fn, 'execute') then
    raise exception '370: save_project_apr_control ainda executavel por anon/authenticated';
  end if;
end
$$;
