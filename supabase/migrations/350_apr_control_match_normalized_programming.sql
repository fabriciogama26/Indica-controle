-- 350_apr_control_match_normalized_programming.sql
-- Fase 5a do corte: Controle APR passa a vincular `project_apr_controls.programming_id`
-- a `programming` (modelo normalizado) em vez da tela congelada `project_programming`.
--
-- POR QUE ESTA E A PRIMEIRA METADE DA FASE 5 (nao Medicao junto)
-- ---------------------------------------------------------------------------
-- `save_project_apr_control` (226) e a UNICA RPC de escrita deste modulo que toca
-- `project_programming` (`set_project_apr_control_status` nao toca), nunca foi
-- redefinida depois da 226 (sem patch dinamico como o de `save_project_measurement_order`)
-- e e executavel so por `service_role`. Medicao tem 2 RPCs (uma delas com 4
-- patches dinamicos aplicados sobre o corpo da 127) e fica para uma entrega
-- propria.
--
-- MEDICAO EM PRODUCAO (2026-07-31, scripts/audit-apr-programming-match-readonly.mjs)
-- ---------------------------------------------------------------------------
-- - 172 linhas em `project_apr_controls`; 66 com `programming_id` preenchido, 106
--   nunca vinculadas (nao afetadas por este remap).
-- - 0 orfaos em `programming_legacy_map` para as 66 linhas com FK.
-- - Remapear o valor gravado via `programming_legacy_map` concorda com recalcular
--   o match do zero pelo NOVO criterio em 65/66 casos (98,5%). O unico caso que
--   diverge e uma etapa que foi CANCELADA depois do vinculo original — o
--   recalculo corretamente nao acha substituta (nao existe outra etapa na mesma
--   data), e o remap simples preserva o valor historico correto (a etapa
--   cancelada que a APR realmente referenciava). CONFIRMA que o backfill deve
--   ser remap simples via `programming_legacy_map`, nao recalculo.
-- - 0 casos de colisao de data (a etapa vinculada com outra etapa concorrendo na
--   mesma (projeto,data), cenario da migration 346) nos dados existentes — o
--   desempate "status ativo vence" abaixo (mesmo padrao da 347) nao muda nenhum
--   vinculo hoje; existe para nao repetir o gap que a 347 corrigiu no Cronograma
--   quando esse cenario passar a ocorrer.
-- - 0 etapas com mais de uma APR ativa vinculada — a assimetria de nao ter indice
--   unico (diferente de Medicao) nao esta causando duplicidade real hoje.
--
-- O QUE MUDA NO MATCH (alem da tabela)
-- ---------------------------------------------------------------------------
-- Legado: `project_programming` tem uma linha por (projeto, equipe, data) — o
-- match e uma unica condicao direta na propria linha.
-- Normalizado: `programming` e uma linha por (projeto, data); a equipe vive em
-- `programming_team` (N por etapa). O match passa a ser projeto+data em
-- `programming` (`status <> CANCELADA`) INNER JOIN `programming_team` (mesmo
-- tenant, `team_id` pedido, `status = 'ATIVA'`) — uma etapa so conta como match
-- se a equipe pedida estiver de fato ativa nela agora. Desempate igual a 347:
-- status ATIVO (PROGRAMADA/REPROGRAMADA) vence, depois `updated_at desc`.

begin;

-- =============================================================================
-- 1) Guarda: nenhuma linha pode ficar orfa na virada da constraint.
-- =============================================================================
do $$
declare
  v_sem_par bigint;
begin
  select count(*)
    into v_sem_par
  from public.project_apr_controls a
  left join public.programming_legacy_map m
    on m.legacy_programming_id = a.programming_id
  where a.programming_id is not null
    and m.legacy_programming_id is null;

  if v_sem_par > 0 then
    raise exception
      'Migration 350 abortada: % APR(s) apontam para programacao legada sem par em programming_legacy_map. Rode scripts/audit-apr-programming-match-readonly.mjs e trate os casos antes de repontar a FK.',
      v_sem_par
      using errcode = 'P0001';
  end if;
end
$$;

-- =============================================================================
-- 2) Soltar a constraint ANTES do remap. Diferente de Medicao (231) e
--    Cronograma (304 -> 344), esta FK ja nasceu composta por tenant na propria
--    226 — so precisa trocar a tabela referenciada, sem passo de "endurecer
--    para composta". ORDEM IMPORTA: a constraint ainda aponta pra
--    `project_programming` neste instante; se o remap do passo 3 rodasse
--    antes, cada UPDATE gravaria um id de `programming` que nao existe em
--    `project_programming`, violando a propria FK que ainda esta ativa
--    (23503). A 344 fez update-antes-de-trocar-constraint e nunca pegou esse
--    bug porque a remessa dela era 0 linhas em producao; aqui sao 66.
-- =============================================================================
alter table public.project_apr_controls
  drop constraint if exists project_apr_controls_programming_tenant_fk;

-- =============================================================================
-- 3) Remapear os valores existentes (legado -> etapa normalizada), agora sem
--    nenhuma FK ativa em `programming_id` pra violar. Remap SIMPLES via o
--    de/para (nao recalculo do match): medido acima que os dois concordam em
--    98,5% dos casos, e o unico caso divergente e exatamente onde o remap
--    simples preserva o valor historico correto (etapa cancelada depois do
--    vinculo). Recalcular aqui trocaria um vinculo correto por vazio.
-- =============================================================================
update public.project_apr_controls a
set programming_id = m.programming_id
from public.programming_legacy_map m
where a.programming_id = m.legacy_programming_id
  and a.tenant_id = m.tenant_id
  and a.programming_id is distinct from m.programming_id;

-- =============================================================================
-- 3b) Recriar a constraint, agora apontando para `programming`. So valida com
--     sucesso porque o remap acima ja rodou.
-- =============================================================================
alter table public.project_apr_controls
  add constraint project_apr_controls_programming_tenant_fk
    foreign key (programming_id, tenant_id)
    references public.programming (id, tenant_id);

-- =============================================================================
-- 4) Reescrever a RPC de escrita: mesmo corpo da 226, so o bloco de match (que
--    era `select ... from project_programming`) passa a ler `programming` +
--    `programming_team`.
-- =============================================================================
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

-- Grants (regras 16/17 do guia_sql.md): mesma assinatura da 226, so service_role.
-- CREATE OR REPLACE preserva o ACL existente, mas reaplicar explicitamente
-- mantem a migration re-executavel e auditavel por si so (mesmo padrao da 344/347).
revoke all on function public.save_project_apr_control(
  uuid, uuid, uuid, text, uuid, uuid, date, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.save_project_apr_control(
  uuid, uuid, uuid, text, uuid, uuid, date, text, timestamptz
) to service_role;

-- =============================================================================
-- 5) Validacao pos-aplicacao
-- =============================================================================
do $$
declare
  v_com_fk bigint;
  v_fn regprocedure := 'public.save_project_apr_control(uuid, uuid, uuid, text, uuid, uuid, date, text, timestamptz)'::regprocedure;
begin
  select count(*) into v_com_fk
  from public.project_apr_controls
  where programming_id is not null;

  raise notice '350: APRs com programming_id preenchido=% (agora apontando para programming)', v_com_fk;

  if has_function_privilege('anon', v_fn, 'execute')
     or has_function_privilege('authenticated', v_fn, 'execute') then
    raise exception '350: save_project_apr_control ainda executavel por anon/authenticated';
  end if;
end
$$;

commit;
