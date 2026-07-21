-- 318_pendencia_as_boolean_flag.sql
-- Revisao FINAL de pendencia (supersede a migration 317, que modelava pendencia
-- como status espelhado). Fonte da verdade: Spec_Nova_Programacao_Modelo_
-- Normalizado.md, secoes 2, 3.1, 3.2, 4, 4.2, 6, 9 e 10 (atualizadas).
--
-- O QUE MUDA (e por que)
-- ---------------------------------------------------------------------------
-- 1) Pendencia deixa de ser status/Estado do Trabalho e vira a flag booleana
--    programming.is_pendencia (ortogonal a tudo). 'PENDENCIA' sai do CHECK de
--    status e do conjunto de work_completion_status.
--    - is_pendencia=true so muda a EXIBICAO: a coluna Status mostra "Pendencia"
--      (front), mas o status de agenda (PROGRAMADA/REPROGRAMADA) continua
--      gravado por baixo. Nao toca coluna Etapa, Estado do Trabalho nem numeracao.
--    - reclassify volta a numerar so PROGRAMADA/REPROGRAMADA com data (dense rank
--      por data; Final = maior data ativa; Unica se N=1). A flag e ortogonal.
--
-- 2) Adiar in-place com duas rotas (decisao do usuario 2026-07-20; o editor
--    comum mantem a data travada, remarcar e sempre via Adiar):
--    - Nova data  -> a MESMA etapa: execution_date=nova, status=REPROGRAMADA.
--    - Em espera   -> a MESMA etapa: execution_date=NULL, status=ADIADA.
--    - Dar data a uma etapa em espera (ADIADA sem data) -> REPROGRAMADA.
--    Consequencias no schema:
--    - execution_date passa a ser ANULAVEL (etapa em espera nao tem data).
--    - a UNIQUE (tenant, project, execution_date) vira indice parcial
--      WHERE execution_date IS NOT NULL (duas etapas em espera nao colidem).
--    - etapa sem data fica FORA da numeracao (reclassify exige data not null).
--    - a data De/Para vai para o historico (nao se perde ao remarcar).
--
-- 3) Excecao da trava de projeto CONCLUIDO (secao 4.2/9):
--    - projeto com etapa CONCLUIDO ativa bloqueia inserir/editar/adicionar
--      equipe/adiar/cancelar, EXCETO quando a etapa em questao e is_pendencia.
--    - programming_project_has_active_completion passa a IGNORAR etapas
--      is_pendencia (uma pendencia concluida nao tranca o projeto).
--
-- 4) Concluir uma pendencia: PERMITIR (secao 6/item 6). is_pendencia FICA
--    (rastreio); Concluido prevalece na exibicao; concluir uma pendencia nao
--    antecipa as demais nem conta como a conclusao do projeto.
--
-- 5) Conflito de agenda: sem mudanca — a etapa em pendencia continua
--    PROGRAMADA/REPROGRAMADA por baixo, entao ja entra na checagem por
--    status in (PROGRAMADA, REPROGRAMADA).
--
-- FORA DE ESCOPO (nao alterado aqui)
-- ---------------------------------------------------------------------------
-- - programming.updated_at nao e atualizado por trigger nem pelas RPCs de
--   update (bug pre-existente, expectedUpdatedAt nunca detecta conflito).

-- =============================================================================
-- 1) Schema: is_pendencia + execution_date anulavel + unique parcial
-- =============================================================================
alter table public.programming
  add column if not exists is_pendencia boolean not null default false;

create index if not exists idx_programming_tenant_is_pendencia
  on public.programming (tenant_id, is_pendencia)
  where is_pendencia = true;

-- execution_date anulavel (etapa "em espera" = ADIADA sem data).
alter table public.programming
  alter column execution_date drop not null;

-- A UNIQUE (tenant, project, execution_date) impedia NULL repetido de forma
-- indesejada (no Postgres NULLs sao distintos numa unique constraint, mas
-- trocamos por indice parcial explicito para deixar a intencao clara e permitir
-- varias etapas em espera no mesmo projeto).
alter table public.programming
  drop constraint if exists programming_tenant_project_date_key;

create unique index if not exists programming_tenant_project_date_key
  on public.programming (tenant_id, project_id, execution_date)
  where execution_date is not null;

-- =============================================================================
-- 2) Backfill: converte o modelo antigo (status/estado PENDENCIA) para a flag
-- =============================================================================
-- IMPORTANTE: roda ANTES de re-adicionar o CHECK de status (senao, se a 317
-- estiver aplicada, existiriam linhas status='PENDENCIA' que violariam o novo
-- CHECK de 5 valores). Robusto a 317 aplicada ou nao:
--   - status='PENDENCIA' (modelo 317): restaura a agenda de previous_operational_status.
--   - work_completion_status='PENDENCIA' (catalogo antigo/legado 315): so limpa o estado.
-- Nos dois casos liga is_pendencia=true.
update public.programming
set is_pendencia = true,
    status = case
               when status = 'PENDENCIA'
                 then coalesce(previous_operational_status, 'PROGRAMADA')
               else status
             end,
    previous_operational_status = case
                                    when status = 'PENDENCIA' then null
                                    else previous_operational_status
                                  end,
    work_completion_status = case
                               when work_completion_status = 'PENDENCIA' then null
                               else work_completion_status
                             end
where status = 'PENDENCIA'
   or coalesce(work_completion_status, '') = 'PENDENCIA';

-- 'PENDENCIA' sai do CHECK de status (volta aos 5 valores de agenda). So depois
-- do backfill acima ter convertido qualquer linha status='PENDENCIA'.
alter table public.programming
  drop constraint if exists programming_status_check;

alter table public.programming
  add constraint programming_status_check
  check (status in ('PROGRAMADA', 'REPROGRAMADA', 'ADIADA', 'CANCELADA', 'ANTECIPADA'));

-- =============================================================================
-- 3) programming_project_has_active_completion — ignora pendencias
-- =============================================================================
create or replace function public.programming_project_has_active_completion(
  p_tenant_id uuid,
  p_project_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.programming p
    where p.tenant_id = p_tenant_id
      and p.project_id = p_project_id
      and p.status in ('PROGRAMADA', 'REPROGRAMADA')
      and p.work_completion_status = 'CONCLUIDO'
      and p.is_pendencia = false
  );
$$;

-- =============================================================================
-- 4) reclassify_project_programming_stages — numeracao pura (sem espelho)
-- =============================================================================
-- Volta ao modelo pre-317: numera so PROGRAMADA/REPROGRAMADA com data. A flag
-- is_pendencia e ortogonal e nao entra aqui. Etapa sem data (em espera) nao
-- numera. Remove todo o espelho status<->estado que a 317 tinha adicionado.
create or replace function public.reclassify_project_programming_stages(
  p_tenant_id uuid,
  p_project_id uuid,
  p_actor_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_count int;
  v_invalid_count int;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(p_tenant_id::text || ':' || p_project_id::text, 0));

  -- Conjunto NUMERAVEL: no calendario (status de agenda ativo) E com data.
  select count(*) into v_count
  from public.programming
  where tenant_id = p_tenant_id
    and project_id = p_project_id
    and status in ('PROGRAMADA', 'REPROGRAMADA')
    and execution_date is not null;

  -- Zera classificacao de quem saiu do calendario (adiada/cancelada/antecipada)
  -- ou de quem esta ativo mas sem data (em espera).
  update public.programming
    set etapa_number = null, etapa_unica = false, etapa_final = false
    where tenant_id = p_tenant_id and project_id = p_project_id
      and (
        status in ('ADIADA', 'CANCELADA', 'ANTECIPADA')
        or (status in ('PROGRAMADA', 'REPROGRAMADA') and execution_date is null)
      )
      and (etapa_number is not null or etapa_unica is not false or etapa_final is not false);

  for r in
    select id,
           row_number() over (order by execution_date) as pos
    from public.programming
    where tenant_id = p_tenant_id
      and project_id = p_project_id
      and status in ('PROGRAMADA', 'REPROGRAMADA')
      and execution_date is not null
    order by execution_date
  loop
    if v_count = 1 then
      update public.programming
        set etapa_number = null, etapa_unica = true, etapa_final = false
        where id = r.id
          and (etapa_number is not null or etapa_unica is not true or etapa_final is not false);
    elsif r.pos = v_count then
      update public.programming
        set etapa_number = null, etapa_unica = false, etapa_final = true
        where id = r.id
          and (etapa_final is not true or etapa_number is not null or etapa_unica is not false);
    else
      update public.programming
        set etapa_number = r.pos, etapa_unica = false, etapa_final = false
        where id = r.id
          and (etapa_number is distinct from r.pos or etapa_unica is not false or etapa_final is not false);
    end if;

    if found then
      perform public.append_programming_history_record(
        p_tenant_id, r.id, null, p_actor_user_id, 'RECLASSIFY_STAGE'
      );
    end if;
  end loop;

  -- Invariante de classificacao (secao 12): toda etapa numeravel esta em
  -- exatamente um estado valido.
  select count(*) into v_invalid_count
  from public.programming
  where tenant_id = p_tenant_id
    and project_id = p_project_id
    and status in ('PROGRAMADA', 'REPROGRAMADA')
    and execution_date is not null
    and not (
      (etapa_unica and not etapa_final and etapa_number is null)
      or (etapa_final and not etapa_unica and etapa_number is null)
      or (not etapa_unica and not etapa_final and etapa_number is not null and etapa_number > 0)
    );

  if v_invalid_count > 0 then
    raise exception
      'programming_active_stage_classification_invalid: % etapa(s) ativa(s) fora de um estado de classificacao valido (tenant=%, project=%)',
      v_invalid_count, p_tenant_id, p_project_id;
  end if;
end;
$$;

-- =============================================================================
-- 5) set_project_programming_work_completion_status — sem PENDENCIA
-- =============================================================================
-- Remove PENDENCIA dos valores manuais (virou flag). Nao toca is_pendencia.
-- Excecao da trava de concluido: liberada quando a propria etapa e is_pendencia.
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

  if v_status is not null and v_status not in ('PARCIAL_PLANEJADO', 'PARCIAL_NAO_PLANEJADO', 'BENEFICIO_ATINGIDO') then
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

  if not v_target.is_pendencia
     and coalesce(public.programming_project_has_active_completion(p_tenant_id, v_target.project_id), false) then
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

  perform public.reclassify_project_programming_stages(p_tenant_id, v_target.project_id, p_actor_user_id);

  return jsonb_build_object(
    'success', true, 'status', 200,
    'programming_id', p_programming_id,
    'updated_at', v_updated_at,
    'message', 'Estado do trabalho atualizado com sucesso.'
  );
end;
$$;

-- =============================================================================
-- 6) set_project_programming_pendencia_flag — NOVA: toggle da checkbox no card
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
-- 7) add_project_programming_team — excecao da trava para pendencia
-- =============================================================================
create or replace function public.add_project_programming_team(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_id uuid,
  p_team_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stage record;
  v_conflict record;
  v_pt_id uuid;
begin
  select * into v_stage
  from public.programming
  where id = p_programming_id and tenant_id = p_tenant_id
  for update;

  if v_stage.id is null then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROGRAMMING_NOT_FOUND',
      'message', 'Etapa nao encontrada para este tenant.');
  end if;

  if v_stage.status not in ('PROGRAMADA', 'REPROGRAMADA') then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'STAGE_NOT_ACTIVE',
      'message', 'Somente etapas ativas podem receber equipe.');
  end if;

  if not v_stage.is_pendencia
     and coalesce(public.programming_project_has_active_completion(p_tenant_id, v_stage.project_id), false) then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'PROJECT_COMPLETED_REQUIRES_REOPEN',
      'message', 'Projeto concluido: reabra antes de adicionar equipe.');
  end if;

  if not exists (
    select 1 from public.teams t where t.id = p_team_id and t.tenant_id = p_tenant_id and t.ativo = true
  ) then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'TEAM_NOT_FOUND',
      'message', 'Equipe nao encontrada ou inativa para este tenant.');
  end if;

  if exists (
    select 1 from public.programming_team pt
    where pt.programming_id = p_programming_id and pt.tenant_id = p_tenant_id
      and pt.team_id = p_team_id and pt.status = 'ATIVA'
  ) then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'TEAM_ALREADY_ACTIVE',
      'message', 'Equipe ja esta alocada nesta etapa.');
  end if;

  select * into v_conflict
  from public.programming_team_schedule_conflict(
    p_tenant_id, p_team_id, v_stage.execution_date, v_stage.start_time, v_stage.end_time, null
  )
  limit 1;

  if v_conflict.programming_id is not null then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'TEAM_TIME_CONFLICT',
      'message', 'Equipe ja tem alocacao ativa com horario sobreposto nesta data.');
  end if;

  insert into public.programming_team (programming_id, tenant_id, team_id, status, created_by, updated_by)
  values (p_programming_id, p_tenant_id, p_team_id, 'ATIVA', p_actor_user_id, p_actor_user_id)
  returning id into v_pt_id;

  perform public.append_programming_history_record(
    p_tenant_id, p_programming_id, v_pt_id, p_actor_user_id, 'ADD_TEAM'
  );

  return jsonb_build_object('success', true, 'status', 200, 'programming_team_id', v_pt_id,
    'message', 'Equipe adicionada com sucesso.');
end;
$$;

-- =============================================================================
-- 8) cancel_project_programming_stage — aceita ADIADA/espera; excecao pendencia
-- =============================================================================
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
-- 9) postpone_project_programming_stage — REESCRITA: in-place, duas rotas
-- =============================================================================
-- Antes: criava uma etapa NOVA na data futura e marcava a antiga ADIADA.
-- Agora: atualiza a MESMA linha (in-place), com duas rotas:
--   p_new_execution_date NOT NULL -> execution_date=nova, status=REPROGRAMADA.
--   p_new_execution_date NULL      -> execution_date=NULL, status=ADIADA (espera).
-- Aceita entrada PROGRAMADA/REPROGRAMADA (remarcar/por em espera) e ADIADA
-- (dar data a uma etapa em espera -> REPROGRAMADA). Registra a data De/Para no
-- historico. Conflito de agenda so quando ha data nova (espera nao ocupa agenda).
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

  update public.programming
  set
    execution_date = p_new_execution_date,
    status = v_new_status,
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

-- =============================================================================
-- 10) mark_project_programming_completed_and_anticipate — concluir pendencia
-- =============================================================================
-- Muda: (a) remove o antigo bloqueio PENDENCIA_NOT_ANTICIPATING (o Estado do
-- Trabalho PENDENCIA nao existe mais); (b) permite concluir uma etapa
-- is_pendencia mesmo com o projeto ja concluido; (c) concluir uma pendencia NAO
-- antecipa as demais e nao entra na regra de "um CONCLUIDO por projeto"; a flag
-- is_pendencia fica.
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

  if p_expected_updated_at is not null and v_target.updated_at <> p_expected_updated_at then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONFLICT',
      'message', 'A etapa foi alterada por outro usuario. Recarregue antes de concluir.',
      'currentUpdatedAt', v_target.updated_at);
  end if;

  -- "Um CONCLUIDO ativo por projeto" so vale para a conclusao normal do projeto.
  -- Concluir uma pendencia (matar uma sobra) e permitido mesmo com o projeto ja
  -- concluido, e nao antecipa nada.
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

  -- Antecipacao so na conclusao normal (nao numa pendencia). Alvos: etapas
  -- ativas SEM is_pendencia com data posterior (secao 6).
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
-- 11) save_project_programming_stage — p_is_pendencia + excecao da trava
-- =============================================================================
-- Novo parametro p_is_pendencia (default false), gravado so no INSERT (o card
-- usa a RPC de toggle para editar a flag). A trava de projeto CONCLUIDO e
-- liberada quando a etapa e/nasce is_pendencia. Corpo restante identico a 313.
create or replace function public.save_project_programming_stage(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_project_id uuid,
  p_execution_date date,
  p_team_ids uuid[] default null,
  p_programming_id uuid default null,
  p_expected_updated_at timestamptz default null,
  p_service_description text default null,
  p_period text default null,
  p_start_time time default null,
  p_end_time time default null,
  p_expected_minutes integer default null,
  p_outage_start_time time default null,
  p_outage_end_time time default null,
  p_feeder text default null,
  p_campo_eletrico text default null,
  p_affected_customers integer default null,
  p_sgd_type_id uuid default null,
  p_electrical_eq_catalog_id uuid default null,
  p_support text default null,
  p_support_item_id uuid default null,
  p_poste_qty numeric default null,
  p_estrutura_qty numeric default null,
  p_trafo_qty numeric default null,
  p_rede_qty numeric default null,
  p_note text default null,
  p_history_reason text default null,
  p_documents jsonb default '{}'::jsonb,
  p_activities jsonb default '[]'::jsonb,
  p_is_pendencia boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_insert boolean := p_programming_id is null;
  v_current record;
  v_programming_id uuid;
  v_updated_at timestamptz;
  v_team_id uuid;
  v_conflict record;
  v_pt_id uuid;
  v_activity_item jsonb;
  v_activity_catalog_id uuid;
  v_activity_quantity numeric;
  v_doc_number text;
  v_doc_included date;
  v_doc_delivered date;
  v_is_pendencia boolean := coalesce(p_is_pendencia, false);
begin
  if p_project_id is null or p_execution_date is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'REQUIRED_FIELDS',
      'message', 'Projeto e data de execucao sao obrigatorios.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_project_id::text, 0));

  if not exists (
    select 1 from public.project pr
    where pr.id = p_project_id and pr.tenant_id = p_tenant_id
  ) then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'PROJECT_NOT_FOUND',
      'message', 'Projeto nao encontrado para este tenant.');
  end if;

  if not v_is_insert then
    select * into v_current
    from public.programming
    where id = p_programming_id and tenant_id = p_tenant_id
    for update;

    if v_current.id is null then
      return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROGRAMMING_NOT_FOUND',
        'message', 'Etapa nao encontrada para este tenant.');
    end if;

    if v_current.project_id <> p_project_id then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'PROJECT_MISMATCH',
        'message', 'A etapa nao pertence ao projeto informado.');
    end if;

    if v_current.execution_date is distinct from p_execution_date then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'DATE_CHANGE_NOT_ALLOWED',
        'message', 'Para mudar a data use Adiar; edicao nao muda a data da etapa.');
    end if;

    if p_expected_updated_at is not null and v_current.updated_at <> p_expected_updated_at then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONFLICT',
        'message', 'A etapa foi alterada por outro usuario. Recarregue antes de salvar.',
        'currentUpdatedAt', v_current.updated_at);
    end if;
  end if;

  -- Trava de projeto CONCLUIDO com excecao de pendencia (secao 4.2/9): no INSERT
  -- vale a flag recebida; no UPDATE vale a flag ja gravada na etapa.
  if not (case when v_is_insert then v_is_pendencia else v_current.is_pendencia end)
     and coalesce(public.programming_project_has_active_completion(p_tenant_id, p_project_id), false) then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'PROJECT_COMPLETED_REQUIRES_REOPEN',
      'message', 'Projeto concluido: reabra antes de inserir ou editar o plano.');
  end if;

  -- Validacao de TODAS as equipes antes de qualquer escrita.
  if p_team_ids is not null then
    foreach v_team_id in array p_team_ids
    loop
      if not exists (
        select 1 from public.teams t
        where t.id = v_team_id and t.tenant_id = p_tenant_id and t.ativo = true
      ) then
        return jsonb_build_object('success', false, 'status', 400, 'reason', 'TEAM_NOT_FOUND',
          'message', 'Equipe nao encontrada ou inativa para este tenant.');
      end if;

      select * into v_conflict
      from public.programming_team_schedule_conflict(
        p_tenant_id, v_team_id, p_execution_date, p_start_time, p_end_time, p_programming_id
      )
      limit 1;

      if v_conflict.programming_id is not null then
        return jsonb_build_object('success', false, 'status', 409, 'reason', 'TEAM_TIME_CONFLICT',
          'message', 'Uma das equipes ja tem alocacao ativa com horario sobreposto nesta data.');
      end if;
    end loop;
  end if;

  -- Validacao de TODAS as atividades antes de qualquer escrita.
  if p_activities is not null and jsonb_typeof(p_activities) = 'array' then
    for v_activity_item in select value from jsonb_array_elements(p_activities)
    loop
      v_activity_catalog_id := nullif(btrim(coalesce(v_activity_item ->> 'catalogId', '')), '')::uuid;

      begin
        v_activity_quantity := nullif(btrim(coalesce(v_activity_item ->> 'quantity', '')), '')::numeric;
      exception when others then
        return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_ACTIVITY_QUANTITY',
          'message', 'Quantidade de atividade invalida.');
      end;

      if v_activity_catalog_id is null or v_activity_quantity is null or v_activity_quantity <= 0 then
        return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_ACTIVITY',
          'message', 'Atividade ou quantidade invalida.');
      end if;

      if not exists (
        select 1 from public.service_activities sa
        where sa.id = v_activity_catalog_id and sa.tenant_id = p_tenant_id and sa.ativo = true
      ) then
        return jsonb_build_object('success', false, 'status', 400, 'reason', 'ACTIVITY_NOT_FOUND',
          'message', 'Atividade nao encontrada ou inativa para este tenant.');
      end if;
    end loop;
  end if;

  if v_is_insert then
    insert into public.programming (
      tenant_id, project_id, execution_date, status, work_completion_status, is_pendencia,
      service_description, period, start_time, end_time, expected_minutes,
      outage_start_time, outage_end_time, feeder, campo_eletrico, affected_customers,
      sgd_type_id, electrical_eq_catalog_id, support, support_item_id,
      poste_qty, estrutura_qty, trafo_qty, rede_qty, note,
      created_by, updated_by
    ) values (
      p_tenant_id, p_project_id, p_execution_date, 'PROGRAMADA', null, v_is_pendencia,
      nullif(btrim(coalesce(p_service_description, '')), ''), p_period, p_start_time, p_end_time, p_expected_minutes,
      p_outage_start_time, p_outage_end_time, nullif(btrim(coalesce(p_feeder, '')), ''),
      nullif(btrim(coalesce(p_campo_eletrico, '')), ''), p_affected_customers,
      p_sgd_type_id, p_electrical_eq_catalog_id, nullif(btrim(coalesce(p_support, '')), ''), p_support_item_id,
      p_poste_qty, p_estrutura_qty, p_trafo_qty, p_rede_qty, nullif(btrim(coalesce(p_note, '')), ''),
      p_actor_user_id, p_actor_user_id
    )
    returning id, updated_at into v_programming_id, v_updated_at;

    perform public.append_programming_history_record(
      p_tenant_id, v_programming_id, null, p_actor_user_id, 'CREATE_STAGE', p_history_reason
    );
  else
    update public.programming
    set
      service_description = nullif(btrim(coalesce(p_service_description, '')), ''),
      period = p_period,
      start_time = p_start_time,
      end_time = p_end_time,
      expected_minutes = p_expected_minutes,
      outage_start_time = p_outage_start_time,
      outage_end_time = p_outage_end_time,
      feeder = nullif(btrim(coalesce(p_feeder, '')), ''),
      campo_eletrico = nullif(btrim(coalesce(p_campo_eletrico, '')), ''),
      affected_customers = p_affected_customers,
      sgd_type_id = p_sgd_type_id,
      electrical_eq_catalog_id = p_electrical_eq_catalog_id,
      support = nullif(btrim(coalesce(p_support, '')), ''),
      support_item_id = p_support_item_id,
      poste_qty = p_poste_qty,
      estrutura_qty = p_estrutura_qty,
      trafo_qty = p_trafo_qty,
      rede_qty = p_rede_qty,
      note = nullif(btrim(coalesce(p_note, '')), ''),
      updated_by = p_actor_user_id
    where id = p_programming_id and tenant_id = p_tenant_id
    returning id, updated_at into v_programming_id, v_updated_at;

    perform public.append_programming_history_record(
      p_tenant_id, v_programming_id, null, p_actor_user_id, 'UPDATE_STAGE', p_history_reason
    );
  end if;

  if p_team_ids is not null then
    update public.programming_team
    set status = 'REMOVIDA', updated_by = p_actor_user_id
    where programming_id = v_programming_id
      and tenant_id = p_tenant_id
      and status = 'ATIVA'
      and not (team_id = any (p_team_ids));

    foreach v_team_id in array p_team_ids
    loop
      if exists (
        select 1 from public.programming_team pt
        where pt.programming_id = v_programming_id and pt.tenant_id = p_tenant_id
          and pt.team_id = v_team_id and pt.status = 'ATIVA'
      ) then
        continue;
      end if;

      insert into public.programming_team (programming_id, tenant_id, team_id, status, created_by, updated_by)
      values (v_programming_id, p_tenant_id, v_team_id, 'ATIVA', p_actor_user_id, p_actor_user_id)
      returning id into v_pt_id;

      perform public.append_programming_history_record(
        p_tenant_id, v_programming_id, v_pt_id, p_actor_user_id, 'ADD_TEAM'
      );
    end loop;
  end if;

  if p_activities is not null and jsonb_typeof(p_activities) = 'array' then
    update public.programming_activity
    set is_active = false, updated_by = p_actor_user_id
    where programming_id = v_programming_id
      and tenant_id = p_tenant_id
      and is_active = true
      and not (
        service_activity_id = any (
          select (value ->> 'catalogId')::uuid
          from jsonb_array_elements(p_activities)
        )
      );

    for v_activity_item in select value from jsonb_array_elements(p_activities)
    loop
      v_activity_catalog_id := (v_activity_item ->> 'catalogId')::uuid;
      v_activity_quantity := (v_activity_item ->> 'quantity')::numeric;

      update public.programming_activity
      set quantity = v_activity_quantity, is_active = true, updated_by = p_actor_user_id
      where programming_id = v_programming_id and tenant_id = p_tenant_id
        and service_activity_id = v_activity_catalog_id;

      if not found then
        insert into public.programming_activity (
          programming_id, tenant_id, service_activity_id, quantity, is_active, created_by, updated_by
        ) values (
          v_programming_id, p_tenant_id, v_activity_catalog_id, v_activity_quantity, true, p_actor_user_id, p_actor_user_id
        );
      end if;
    end loop;
  end if;

  v_doc_number := nullif(btrim(coalesce(p_documents -> 'sgd' ->> 'number', '')), '');
  v_doc_included := nullif(p_documents -> 'sgd' ->> 'includedAt', '')::date;
  v_doc_delivered := nullif(p_documents -> 'sgd' ->> 'deliveredAt', '')::date;
  if v_doc_number is null and v_doc_included is null and v_doc_delivered is null then
    delete from public.programming_document
      where programming_id = v_programming_id and tenant_id = p_tenant_id and document_type = 'SGD';
  else
    insert into public.programming_document (programming_id, tenant_id, document_type, number, included_at, delivered_at, created_by, updated_by)
    values (v_programming_id, p_tenant_id, 'SGD', v_doc_number, v_doc_included, v_doc_delivered, p_actor_user_id, p_actor_user_id)
    on conflict (programming_id, document_type) do update
    set number = excluded.number, included_at = excluded.included_at, delivered_at = excluded.delivered_at,
        updated_by = excluded.updated_by, updated_at = now();
  end if;

  v_doc_number := nullif(btrim(coalesce(p_documents -> 'pi' ->> 'number', '')), '');
  v_doc_included := nullif(p_documents -> 'pi' ->> 'includedAt', '')::date;
  v_doc_delivered := nullif(p_documents -> 'pi' ->> 'deliveredAt', '')::date;
  if v_doc_number is null and v_doc_included is null and v_doc_delivered is null then
    delete from public.programming_document
      where programming_id = v_programming_id and tenant_id = p_tenant_id and document_type = 'PI';
  else
    insert into public.programming_document (programming_id, tenant_id, document_type, number, included_at, delivered_at, created_by, updated_by)
    values (v_programming_id, p_tenant_id, 'PI', v_doc_number, v_doc_included, v_doc_delivered, p_actor_user_id, p_actor_user_id)
    on conflict (programming_id, document_type) do update
    set number = excluded.number, included_at = excluded.included_at, delivered_at = excluded.delivered_at,
        updated_by = excluded.updated_by, updated_at = now();
  end if;

  v_doc_number := nullif(btrim(coalesce(p_documents -> 'pep' ->> 'number', '')), '');
  v_doc_included := nullif(p_documents -> 'pep' ->> 'includedAt', '')::date;
  v_doc_delivered := nullif(p_documents -> 'pep' ->> 'deliveredAt', '')::date;
  if v_doc_number is null and v_doc_included is null and v_doc_delivered is null then
    delete from public.programming_document
      where programming_id = v_programming_id and tenant_id = p_tenant_id and document_type = 'PEP';
  else
    insert into public.programming_document (programming_id, tenant_id, document_type, number, included_at, delivered_at, created_by, updated_by)
    values (v_programming_id, p_tenant_id, 'PEP', v_doc_number, v_doc_included, v_doc_delivered, p_actor_user_id, p_actor_user_id)
    on conflict (programming_id, document_type) do update
    set number = excluded.number, included_at = excluded.included_at, delivered_at = excluded.delivered_at,
        updated_by = excluded.updated_by, updated_at = now();
  end if;

  perform public.reclassify_project_programming_stages(p_tenant_id, p_project_id, p_actor_user_id);

  select updated_at into v_updated_at from public.programming where id = v_programming_id;

  return jsonb_build_object(
    'success', true, 'status', 200,
    'action', case when v_is_insert then 'INSERT' else 'UPDATE' end,
    'programming_id', v_programming_id,
    'updated_at', v_updated_at,
    'message', case when v_is_insert then 'Etapa criada com sucesso.' else 'Etapa atualizada com sucesso.' end
  );
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'UNIQUE_STAGE_PER_DATE',
      'message', 'Ja existe uma etapa para este projeto nesta data.');
end;
$$;

-- =============================================================================
-- 12) Hardening de grants (service_role apenas), inclui a RPC nova
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
        'programming_project_has_active_completion',
        'reclassify_project_programming_stages',
        'set_project_programming_work_completion_status',
        'set_project_programming_pendencia_flag',
        'add_project_programming_team',
        'cancel_project_programming_stage',
        'postpone_project_programming_stage',
        'mark_project_programming_completed_and_anticipate',
        'save_project_programming_stage'
      )
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
      and p.proname in (
        'set_project_programming_pendencia_flag',
        'postpone_project_programming_stage',
        'save_project_programming_stage'
      )
  loop
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception '318: funcao % ainda executavel por anon', v_fn;
    end if;
    if has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '318: funcao % ainda executavel por authenticated', v_fn;
    end if;
  end loop;
end;
$$;
