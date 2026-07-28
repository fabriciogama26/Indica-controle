-- 337_preserve_programming_stage_classification_snapshot.sql
-- Preserva a classificacao (Etapa N / Unica / Final) que a etapa TINHA no momento
-- em que saiu do plano ativo — por cancelamento ou por "deixar em espera".
--
-- NOTA DE NUMERACAO: esta migration foi pedida como "331", mas 331 ja esta ocupada
-- (331_prevent_duplicate_active_measurement_items.sql) e a sequencia ja chegou em
-- 336. Numero real: 337. A 318 NAO e alterada, conforme pedido.
--
-- O PROBLEMA
-- ---------------------------------------------------------------------------
-- reclassify_project_programming_stages numera so o conjunto operacional
-- (PROGRAMADA/REPROGRAMADA COM data) e ZERA a classificacao de ADIADA, CANCELADA
-- e ANTECIPADA. A etapa nunca e apagada, mas perde o numero: cancelar a "Etapa 2"
-- faz a antiga "Etapa 3" virar "Etapa 2" e some o registro de que a cancelada era
-- a 2. O plano ativo fica certo; a historia se perde.
--
-- POR QUE NAO INCLUIR ADIADA/CANCELADA NA NUMERACAO (decisao registrada)
-- ---------------------------------------------------------------------------
-- Incluir preservaria a sequencia, mas quebraria o resto:
--   - uma etapa cancelada poderia continuar sendo a "Final" do projeto;
--   - ADIADA em espera nao tem execution_date — nao ha por onde ordena-la;
--   - relatorios contariam etapas que nao serao executadas como operacionais;
--   - antecipacao e cobertura passariam a considerar etapa encerrada;
--   - a numeracao ativa deixaria de representar o plano atual.
-- Solucao adotada: DOIS conceitos separados — classificacao ATUAL (operacional,
-- inalterada) e classificacao NO MOMENTO DA INTERRUPCAO (snapshot, historica).
--
-- IMPORTANTE — a etapa encerrada NAO fica escondida no historico. Ela continua
-- na lista, no plano do projeto e nas extracoes; o snapshot so responde "qual era
-- a classificacao dela quando parou".
--
-- ANTECIPADA: ganha snapshot pelo mesmo motivo (sai da numeracao), gravado pela
-- cascata do Concluir em mark_project_programming_completed_and_anticipate.
--
-- Escopo: colunas novas + gravacao do snapshot nas RPCs que encerram a etapa +
-- chip CANCELADAS na listagem. reclassify NAO muda: continua numerando so o
-- conjunto operacional.

-- =============================================================================
-- 1) Colunas do snapshot
-- =============================================================================
-- Espelham as tres colunas de classificacao mais a data que a etapa tinha (a
-- etapa em espera perde execution_date, entao sem guardar a data a exibicao
-- "Era Final em 15/08" seria impossivel) e o momento da fotografia.
alter table public.programming
  add column if not exists classification_snapshot_number integer null,
  add column if not exists classification_snapshot_unica boolean null,
  add column if not exists classification_snapshot_final boolean null,
  add column if not exists classification_snapshot_execution_date date null,
  add column if not exists classification_snapshot_at timestamptz null;

comment on column public.programming.classification_snapshot_number is
  'Classificacao historica: numero da etapa no momento em que saiu do plano ativo (cancelamento/em espera/antecipacao). Nunca escrita por edicao do usuario.';
comment on column public.programming.classification_snapshot_execution_date is
  'Data que a etapa tinha ao sair do plano ativo. Necessaria porque "em espera" zera execution_date.';
comment on column public.programming.classification_snapshot_at is
  'Momento da fotografia. NULL = etapa nunca saiu do plano ativo, ou saiu antes desta migration (dado legado, sem classificacao historica).';

-- =============================================================================
-- 2) Helper: tira a fotografia da classificacao ANTES de encerrar a etapa
-- =============================================================================
-- Uma funcao so, chamada pelas tres RPCs que encerram etapa, para as tres nunca
-- divergirem no que e considerado "classificacao no momento da interrupcao".
--
-- Idempotencia: NAO sobrescreve um snapshot que ja existe. Cancelar uma etapa que
-- ja estava em espera tem que preservar a classificacao de quando ela era
-- operacional — se sobrescrevesse, gravaria a classificacao ja zerada pelo
-- reclassify do "em espera" e o historico morreria na segunda transicao.
create or replace function public.capture_programming_classification_snapshot(
  p_tenant_id uuid,
  p_programming_id uuid
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.programming
  set
    classification_snapshot_number = etapa_number,
    classification_snapshot_unica = etapa_unica,
    classification_snapshot_final = etapa_final,
    classification_snapshot_execution_date = execution_date,
    classification_snapshot_at = now()
  where id = p_programming_id
    and tenant_id = p_tenant_id
    and classification_snapshot_at is null
    -- So vale a pena fotografar se havia classificacao de fato. Etapa sem
    -- numero/unica/final nunca esteve no plano ativo numerado.
    and (etapa_number is not null or etapa_unica or etapa_final);
$$;

-- =============================================================================
-- 3) cancel_project_programming_stage — fotografa antes de cancelar
-- =============================================================================
-- Corpo identico ao da 318, com UMA adicao: a captura do snapshot logo antes do
-- UPDATE que muda o status (e, portanto, antes do reclassify zerar a
-- classificacao). Ordem importa: depois do reclassify nao ha mais o que fotografar.
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

  -- Aceita etapa em espera (ADIADA sem data) tambem, para poder cancela-la.
  if v_target.status not in ('PROGRAMADA', 'REPROGRAMADA', 'ADIADA') then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'STAGE_NOT_ACTIVE',
      'message', 'Somente etapas ativas ou em espera podem ser canceladas.');
  end if;

  if not v_target.is_pendencia
     and coalesce(public.programming_project_has_active_completion(p_tenant_id, v_target.project_id), false) then
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

  -- 337: fotografa a classificacao ANTES de sair do plano ativo.
  perform public.capture_programming_classification_snapshot(p_tenant_id, p_programming_id);

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
-- 4) postpone_project_programming_stage — fotografa SO na rota "em espera"
-- =============================================================================
-- Corpo identico ao da 326, com duas adicoes:
--   a) rota "em espera" (p_new_execution_date IS NULL): fotografa antes de zerar
--      a data — a etapa sai da numeracao e a data original se perderia.
--   b) rota "nova data" (REPROGRAMADA): NAO fotografa; a etapa CONTINUA no plano
--      ativo e sera renumerada normalmente. Alem disso, LIMPA o snapshot: uma
--      etapa que estava em espera e voltou a ter data e operacional de novo, e o
--      snapshot antigo nao pode mais mandar na exibicao (senao a tela mostraria
--      "Era Final" numa etapa que agora tem classificacao atual valida).
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
end;
$$;

-- =============================================================================
-- 5) Cascata da antecipacao — fotografa as etapas que viram ANTECIPADA
-- =============================================================================
-- Concluir uma etapa ANTECIPA as demais etapas ativas do projeto (322). Elas saem
-- da numeracao igual a cancelada, entao tambem merecem a fotografia. Em vez de
-- reescrever mark_project_programming_completed_and_anticipate inteira (funcao
-- grande, com regras de conclusao que nao mudam aqui), um trigger BEFORE UPDATE
-- captura a classificacao no exato momento em que o status vira ANTECIPADA.
--
-- Como e BEFORE UPDATE na propria linha, o snapshot e gravado nas colunas NEW —
-- nao ha UPDATE recursivo nem dependencia de ordem entre RPCs.
create or replace function public.tg_programming_capture_anticipated_snapshot()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'ANTECIPADA'
     and old.status is distinct from 'ANTECIPADA'
     and old.classification_snapshot_at is null
     and (old.etapa_number is not null or old.etapa_unica or old.etapa_final) then
    new.classification_snapshot_number := old.etapa_number;
    new.classification_snapshot_unica := old.etapa_unica;
    new.classification_snapshot_final := old.etapa_final;
    new.classification_snapshot_execution_date := old.execution_date;
    new.classification_snapshot_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_programming_capture_anticipated_snapshot on public.programming;
create trigger trg_programming_capture_anticipated_snapshot
  before update on public.programming
  for each row
  execute function public.tg_programming_capture_anticipated_snapshot();

-- =============================================================================
-- 6) Chip CANCELADAS na listagem
-- =============================================================================
-- Recria programming_list_project_page (a 336 ja esta aplicada). Unica mudanca em
-- relacao a 336: o chip 'CANCELADAS'.
--
-- Diferente de EM_ESPERA e SEM_RETORNO, o chip CANCELADAS RESPEITA o intervalo de
-- datas: a etapa cancelada MANTEM execution_date, entao cai normalmente na janela
-- selecionada. So etapa cancelada que ja estava em espera (sem data) fica de fora
-- do periodo — essa aparece pelo chip "Em espera" ou por "Todas".
create or replace function public.programming_list_project_page(
  p_tenant_id uuid,
  p_date_from date,
  p_date_to date,
  p_project_ids uuid[] default null,
  p_stage_ids uuid[] default null,
  p_status_chip text default 'TODAS',
  p_today date default current_date,
  p_page integer default 1,
  p_page_size integer default 50,
  p_work_completion_status text[] default null
)
returns table (project_id uuid, total_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  with matched as (
    select distinct p.project_id
    from public.programming p
    where p.tenant_id = p_tenant_id
      and (p_project_ids is null or p.project_id = any (p_project_ids))
      and (p_stage_ids is null or p.id = any (p_stage_ids))
      and (
        -- "Em espera": sem data, entao o intervalo de data NAO se aplica.
        (p_status_chip = 'EM_ESPERA'
         and p.status = 'ADIADA'
         and p.execution_date is null)
        -- "Pendencias sem retorno": condicao derivada; tambem IGNORA o periodo.
        or (p_status_chip = 'SEM_RETORNO'
            and p.is_pendencia
            and p.status in ('PROGRAMADA', 'REPROGRAMADA')
            and p.execution_date is not null
            and p.execution_date < p_today
            and p.work_completion_status is null)
        or (
          p_status_chip not in ('EM_ESPERA', 'SEM_RETORNO')
          and p.execution_date is not null
          and p.execution_date >= p_date_from
          and p.execution_date <= p_date_to
          and (
            p_status_chip = 'TODAS'
            or (p_status_chip = 'PROGRAMADAS'
                and p.status in ('PROGRAMADA', 'REPROGRAMADA'))
            or (p_status_chip = 'PENDENCIAS'
                and p.is_pendencia
                and p.status in ('PROGRAMADA', 'REPROGRAMADA')
                and p.work_completion_status is distinct from 'CONCLUIDO')
            or (p_status_chip = 'ATRASADAS'
                and p.status in ('PROGRAMADA', 'REPROGRAMADA')
                and p.execution_date < p_today)
            or (p_status_chip = 'ADIADAS'
                and p.status = 'ADIADA')
            -- 337: canceladas mantem a data, entao respeitam o periodo.
            or (p_status_chip = 'CANCELADAS'
                and p.status = 'CANCELADA')
          )
        )
      )
      -- Estado do Trabalho (ortogonal ao chip). Sem valores = sem filtro.
      and (
        p_work_completion_status is null
        or cardinality(p_work_completion_status) = 0
        or p.work_completion_status = any (p_work_completion_status)
        or ('__EM_BRANCO__' = any (p_work_completion_status)
            and p.work_completion_status is null)
      )
  ),
  ordered as (
    select project_id, count(*) over () as total_count
    from matched
    order by project_id
  )
  select project_id, total_count
  from ordered
  limit greatest(p_page_size, 0)
  offset greatest((p_page - 1) * p_page_size, 0);
$$;

-- =============================================================================
-- 7) Hardening de grants: service_role apenas
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
        'programming_list_project_page',
        'capture_programming_classification_snapshot',
        'cancel_project_programming_stage',
        'postpone_project_programming_stage'
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);

    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '337: funcao % ainda executavel por anon/authenticated', v_fn;
    end if;
  end loop;
end;
$$;
