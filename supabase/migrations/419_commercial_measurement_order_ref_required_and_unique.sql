-- 419_commercial_measurement_order_ref_required_and_unique.sql
-- `Ordem` passa a ser OBRIGATORIA na Medicao Comercial, e nao pode repetir para
-- a mesma Ordem + Equipe + Data de execucao.
--
-- CONTEXTO
-- ---------------------------------------------------------------------------
-- Hoje a ordem comercial nao tem NENHUMA trava de duplicidade no caso mais
-- comum da tela. As duas barreiras existentes vem da 382 e usam a mesma chave,
-- que nao conhece `Ordem`:
--   1. pre-check com advisory lock dentro de `save_project_measurement_order`;
--   2. trigger `enforce_project_measurement_order_context_unique`.
--
-- Ambas ignoram a ordem comercial `COM_PRODUCAO` sem projeto: o trigger tem
-- early-return explicito (`if new.project_id is null and new.measurement_kind
-- <> 'SEM_PRODUCAO' then return new`) e o pre-check da RPC so procura duplicata
-- entre linhas `SEM_PRODUCAO`. Como a equipe comercial atende demanda que
-- normalmente NAO tem projeto, na pratica a tela aceita gravar a mesma execucao
-- quantas vezes o usuario clicar.
--
-- DECISOES DE NEGOCIO (tomadas pelo usuario nesta tarefa)
-- ---------------------------------------------------------------------------
-- 1. `Ordem` obrigatoria na ordem comercial nos DOIS tipos de medicao
--    (`COM_PRODUCAO` e `SEM_PRODUCAO`), igual a Processo/Hora inicio/Hora
--    termino. A ordem TECNICA continua sem o campo.
-- 2. As regras SOMAM. A chave nova (Ordem + Equipe + Data) e ADICIONADA; as
--    regras da 382 continuam valendo como estao. Consequencia aceita: duas
--    Ordens diferentes no MESMO projeto + equipe + data seguem bloqueadas pela
--    regra antiga, e duas ordens comerciais `SEM_PRODUCAO` sem projeto na mesma
--    equipe + data seguem bloqueadas mesmo com Ordens diferentes.
-- 3. Ordem CANCELADA libera a reutilizacao: cancelar grava `status='CANCELADA'`
--    e `is_active=false` (migrations 124-126), entao a linha sai do indice.
--
-- COMO A UNICIDADE E GARANTIDA
-- ---------------------------------------------------------------------------
-- Por UNIQUE INDEX parcial, nao por checagem otimista (`guia_sql.md`, regras 6 e
-- 10). Diferente do pre-check da 382, o indice nao tem janela TOCTOU: nao existe
-- intervalo entre "conferir" e "gravar". A traducao do erro para uma mensagem
-- legivel (409) fica em `src/server/modules/medicao/handlers.ts`, e a tela ainda
-- avisa antes do submit por `/api/medicao-comercial/order-ref-check`.
--
-- A comparacao e por `upper(btrim(...))` de proposito: `Ordem` e texto livre, e
-- sem normalizar a regra cai no primeiro dia com "1234", "1234 " e "1234a" vs
-- "1234A". O texto continua gravado como o usuario digitou -- a normalizacao
-- vale so para a comparacao.
--
-- O QUE ESTA MIGRATION NAO FAZ
-- ---------------------------------------------------------------------------
-- Nao altera `enforce_project_measurement_order_context_unique` nem o pre-check
-- da 382 (decisao 2), nao recria `save_project_commercial_measurement_order`
-- (o indice ja e a barreira; restatir a RPC inteira so criaria risco de drift
-- com a 415), nao toca em ordem TECNICA e nao exige backfill: nao existe
-- nenhuma ordem comercial gravada.
--
-- EFEITO COLATERAL CONHECIDO
-- ---------------------------------------------------------------------------
-- Reabrir (`ABRIR`) uma ordem cancelada cuja `Ordem` foi reutilizada no periodo
-- volta a colidir com o indice -- que e o conflito real. A mensagem dessa
-- colisao tambem e traduzida em `handlers.ts`.

-- =============================================================================
-- 1) `Ordem` obrigatoria na ordem comercial
-- =============================================================================
-- Mesma funcao corrigida pela 418 (que a fez RELER a linha em vez de confiar no
-- `new` do evento deferido). Aqui ela ganha so a regra nova de `Ordem`; a
-- releitura e a razao dela continuam identicas.
create or replace function public.enforce_commercial_measurement_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_team_id uuid;
  v_commercial_process_id uuid;
  v_commercial_process_name_snapshot text;
  v_commercial_start_time time;
  v_commercial_end_time time;
  v_commercial_order_ref text;
  v_is_commercial boolean;
begin
  -- Trigger DEFERIDO: `new` e a versao da linha no momento do EVENTO, nao no
  -- fim da transacao. A ordem comercial e gravada em dois passos (INSERT pela
  -- RPC tecnica + UPDATE dos campos comerciais), entao validar `new` do evento
  -- de INSERT reprovava toda ordem comercial. Relemos por `id` para validar o
  -- estado real; o SELECT roda dentro da mesma transacao e enxerga o UPDATE.
  select
    o.tenant_id,
    o.team_id,
    o.commercial_process_id,
    o.commercial_process_name_snapshot,
    o.commercial_start_time,
    o.commercial_end_time,
    o.commercial_order_ref
  into
    v_tenant_id,
    v_team_id,
    v_commercial_process_id,
    v_commercial_process_name_snapshot,
    v_commercial_start_time,
    v_commercial_end_time,
    v_commercial_order_ref
  from public.project_measurement_orders o
  where o.id = new.id;

  -- Linha removida na mesma transacao (ex.: rollback parcial por savepoint):
  -- nao ha estado final para validar.
  if not found then
    return null;
  end if;

  -- `SELECT INTO` pode deixar as variaveis NULL e, em PL/pgSQL, `IF <NULL>` nao
  -- dispara o bloco nem gera erro (guia_sql.md, regras 18-22). O boolean que
  -- decide o ramo e sempre COALESCE.
  v_is_commercial := coalesce(public.is_commercial_team(v_tenant_id, v_team_id), false);

  -- Campos proprios da ordem comercial. As colunas sao anulaveis porque a ordem
  -- TECNICA nao os tem; a obrigatoriedade e por categoria e mora aqui.
  if v_is_commercial then
    if v_commercial_process_id is null then
      raise exception using
        errcode = '23514',
        message = 'commercial_process_required: Processo e obrigatorio na medicao comercial.';
    end if;

    if v_commercial_start_time is null or v_commercial_end_time is null then
      raise exception using
        errcode = '23514',
        message = 'commercial_time_required: Hora inicio e Hora termino sao obrigatorias na medicao comercial.';
    end if;

    -- Regra nova da 419. Vale para COM_PRODUCAO e SEM_PRODUCAO.
    if nullif(btrim(coalesce(v_commercial_order_ref, '')), '') is null then
      raise exception using
        errcode = '23514',
        message = 'commercial_order_ref_required: Ordem e obrigatoria na medicao comercial.';
    end if;

    return null;
  end if;

  -- Ordem tecnica nao carrega campo comercial: evita lixo se alguem reaproveitar
  -- a linha trocando a equipe de comercial para tecnica.
  if v_commercial_process_id is not null
    or v_commercial_process_name_snapshot is not null
    or v_commercial_start_time is not null
    or v_commercial_end_time is not null
    or v_commercial_order_ref is not null
  then
    raise exception using
      errcode = '23514',
      message = 'commercial_fields_on_technical_order: ordem de equipe tecnica nao pode ter campos da medicao comercial.';
  end if;

  return null;
end;
$$;

revoke all on function public.enforce_commercial_measurement_fields() from public, anon, authenticated;

-- =============================================================================
-- 2) Unicidade Ordem + Equipe + Data de execucao
-- =============================================================================
-- Parcial em `is_active = true` (decisao 3: ordem cancelada libera a Ordem) e em
-- `commercial_order_ref is not null` (ordem TECNICA nao entra no indice).
create unique index if not exists uq_project_measurement_orders_commercial_ref_team_date
  on public.project_measurement_orders (
    tenant_id,
    upper(btrim(commercial_order_ref)),
    team_id,
    execution_date
  )
  where commercial_order_ref is not null
    and is_active = true;

-- =============================================================================
-- Validacao
-- =============================================================================
do $$
declare
  v_definition text;
  v_count integer;
begin
  select pg_get_functiondef(p.oid)
  into v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'enforce_commercial_measurement_fields';

  if v_definition is null then
    raise exception '419: enforce_commercial_measurement_fields nao encontrada.';
  end if;

  -- A correcao da 418 (releitura da linha) nao pode ter sido perdida aqui.
  if position('from public.project_measurement_orders o' in v_definition) = 0 then
    raise exception '419: enforce_commercial_measurement_fields deixou de reler a linha (regressao da 418).';
  end if;

  if position('commercial_order_ref_required' in v_definition) = 0 then
    raise exception '419: enforce_commercial_measurement_fields sem a obrigatoriedade de Ordem.';
  end if;

  -- O indice unico precisa existir, ser unico e ser parcial.
  select count(*)
  into v_count
  from pg_index i
  join pg_class c on c.oid = i.indexrelid
  where i.indrelid = 'public.project_measurement_orders'::regclass
    and c.relname = 'uq_project_measurement_orders_commercial_ref_team_date'
    and i.indisunique
    and i.indpred is not null;

  if v_count <> 1 then
    raise exception '419: uq_project_measurement_orders_commercial_ref_team_date ausente, nao unico ou nao parcial.';
  end if;

  -- Nenhuma ordem comercial ativa pode estar sem Ordem depois desta migration.
  select count(*)
  into v_count
  from public.project_measurement_orders o
  where o.is_active = true
    and coalesce(public.is_commercial_team(o.tenant_id, o.team_id), false)
    and nullif(btrim(coalesce(o.commercial_order_ref, '')), '') is null;

  if v_count > 0 then
    raise exception '419: % ordem(ns) comercial(is) ativa(s) sem Ordem preenchida.', v_count;
  end if;
end;
$$;
