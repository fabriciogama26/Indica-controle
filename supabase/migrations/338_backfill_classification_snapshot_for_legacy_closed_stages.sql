-- 338_backfill_classification_snapshot_for_legacy_closed_stages.sql
-- Preenche a classificacao historica das etapas que ja estavam ENCERRADAS quando
-- a migration 337 entrou.
--
-- O PROBLEMA
-- ---------------------------------------------------------------------------
-- A 337 fotografa a classificacao no momento em que a etapa sai do plano — mas so
-- vale dali para frente. Toda etapa cancelada/em espera ANTES dela ficou sem
-- snapshot, e a coluna INFO STATUS das extracoes ENEL/ENEL NOVO saia em branco
-- para elas. Medido em producao em 2026-07-28: 153 de 472 etapas (87 CANCELADA +
-- 66 ADIADA), TODAS sem snapshot. Um terco do arquivo saindo sem classificacao.
--
-- O QUE DA E O QUE NAO DA PARA RECUPERAR
-- ---------------------------------------------------------------------------
-- NAO da para saber a verdade historica: a classificacao de uma etapa dependia de
-- quais OUTRAS etapas estavam ativas naquele dia, e esse conjunto nao foi
-- registrado (o historico guarda a acao, nao a numeracao vigente).
--
-- O que DA para reconstruir e a POSICAO CRONOLOGICA da etapa dentro do projeto,
-- que e a mesma nocao que a numeracao expressa. Regra aplicada, por projeto,
-- sobre TODAS as etapas COM data (ativas e encerradas), ordenadas por data:
--   - 1 etapa no conjunto            -> Unica
--   - posicao == ultima (maior data) -> Final
--   - demais                         -> Etapa N (N = posicao)
-- E a mesma regra do reclassify, so que aplicada ao conjunto completo em vez de so
-- ao conjunto ativo — e por isso que ela reconstitui "qual etapa esta era quando
-- existia". Confere com o exemplo de negocio: cancelar a Etapa 2 deixa "Era Etapa
-- 2" (cancelada) convivendo com a nova "Etapa 2" (a antiga 3, renumerada).
--
-- Isto e RECONSTRUCAO, nao fotografia. Para nao misturar as duas coisas, a coluna
-- `classification_snapshot_source` marca a procedencia de cada snapshot.
--
-- Todas as 153 tem `execution_date` (verificado), entao nao ha caso sem por onde
-- ordenar. Etapa encerrada SEM data que apareca no futuro fica de fora do backfill
-- e continua sem classificacao historica — correto, nao ha o que deduzir.
--
-- IDEMPOTENTE: so escreve onde `classification_snapshot_at is null`. Reexecutar
-- nao altera nada e nunca sobrescreve fotografia real.
--
-- Escopo: SOMENTE dado historico de exibicao/exportacao. Nao altera reclassify,
-- nem a numeracao ativa, nem qualquer regra de escrita.

-- =============================================================================
-- 1) Procedencia do snapshot
-- =============================================================================
alter table public.programming
  add column if not exists classification_snapshot_source text null;

alter table public.programming
  drop constraint if exists programming_classification_snapshot_source_check;

alter table public.programming
  add constraint programming_classification_snapshot_source_check
  check (
    classification_snapshot_source is null
    or classification_snapshot_source in ('CAPTURED', 'BACKFILL_338')
  );

comment on column public.programming.classification_snapshot_source is
  'Procedencia da classificacao historica: CAPTURED = fotografada no momento em que a etapa saiu do plano (337). BACKFILL_338 = RECONSTRUIDA pela posicao cronologica no projeto, para etapas ja encerradas antes da 337 — aproximacao, nao registro do que estava vigente.';

-- =============================================================================
-- 2) Capturas NOVAS passam a marcar a procedencia
-- =============================================================================
-- Sem isso, snapshot real e reconstruido ficariam indistinguiveis (um com NULL na
-- coluna de procedencia, outro com BACKFILL_338), e a coluna perderia a serventia.
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
    classification_snapshot_at = now(),
    classification_snapshot_source = 'CAPTURED'
  where id = p_programming_id
    and tenant_id = p_tenant_id
    and classification_snapshot_at is null
    and (etapa_number is not null or etapa_unica or etapa_final);
$$;

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
    new.classification_snapshot_source := 'CAPTURED';
  end if;

  return new;
end;
$$;

-- A rota "nova data" do postpone LIMPA o snapshot (a etapa volta ao plano ativo).
-- A coluna de procedencia tem que ser limpa junto, senao sobra procedencia orfa
-- apontando para um snapshot que nao existe mais.
create or replace function public.tg_programming_clear_snapshot_source()
returns trigger
language plpgsql
as $$
begin
  if new.classification_snapshot_at is null and old.classification_snapshot_at is not null then
    new.classification_snapshot_source := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_programming_clear_snapshot_source on public.programming;
create trigger trg_programming_clear_snapshot_source
  before update on public.programming
  for each row
  execute function public.tg_programming_clear_snapshot_source();

-- =============================================================================
-- 3) Backfill das etapas ja encerradas
-- =============================================================================
with posicoes as (
  select
    p.id,
    p.tenant_id,
    p.execution_date,
    row_number() over (partition by p.tenant_id, p.project_id order by p.execution_date, p.id) as posicao,
    count(*) over (partition by p.tenant_id, p.project_id) as total
  from public.programming p
  where p.execution_date is not null
)
update public.programming alvo
set
  classification_snapshot_number = case
                                     when posicoes.total = 1 then null
                                     when posicoes.posicao = posicoes.total then null
                                     else posicoes.posicao::integer
                                   end,
  classification_snapshot_unica = (posicoes.total = 1),
  classification_snapshot_final = (posicoes.total > 1 and posicoes.posicao = posicoes.total),
  classification_snapshot_execution_date = posicoes.execution_date,
  classification_snapshot_at = now(),
  classification_snapshot_source = 'BACKFILL_338'
from posicoes
where alvo.id = posicoes.id
  and alvo.tenant_id = posicoes.tenant_id
  and alvo.status in ('ADIADA', 'CANCELADA', 'ANTECIPADA')
  and alvo.classification_snapshot_at is null
  and alvo.execution_date is not null;

-- =============================================================================
-- 4) Relatorio do que foi preenchido (aparece no log da aplicacao)
-- =============================================================================
do $$
declare
  v_backfilled int;
  v_restantes int;
begin
  select count(*) into v_backfilled
  from public.programming
  where classification_snapshot_source = 'BACKFILL_338';

  select count(*) into v_restantes
  from public.programming
  where status in ('ADIADA', 'CANCELADA', 'ANTECIPADA')
    and classification_snapshot_at is null;

  raise notice '338: % etapa(s) encerrada(s) com classificacao historica RECONSTRUIDA.', v_backfilled;
  raise notice '338: % etapa(s) encerrada(s) seguem sem classificacao historica (sem data — nao ha como deduzir).', v_restantes;
end;
$$;

-- =============================================================================
-- 5) Hardening de grants: service_role apenas
-- =============================================================================
do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = 'capture_programming_classification_snapshot'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);

    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '338: funcao % ainda executavel por anon/authenticated', v_fn;
    end if;
  end loop;
end;
$$;
