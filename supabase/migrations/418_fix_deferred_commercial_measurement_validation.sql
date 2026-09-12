-- 418_fix_deferred_commercial_measurement_validation.sql
-- Corrige a validacao comercial deferida: ela reprovava TODA ordem de Medicao
-- Comercial, inclusive a primeira.
--
-- CONTEXTO
-- ---------------------------------------------------------------------------
-- A 415 criou `trg_enforce_commercial_measurement_fields` como CONSTRAINT
-- TRIGGER `after insert or update ... deferrable initially deferred`, com esta
-- justificativa (comentario da propria 415):
--
--   "Diferido, a checagem roda no fim da transacao, com a linha ja completa"
--
-- A premissa esta ERRADA. `deferrable` muda QUANDO o trigger roda, nao QUAL
-- versao da tupla o evento carrega. O evento de INSERT guarda o `ctid` da tupla
-- inserida e, na hora de disparar, o Postgres busca exatamente aquela versao
-- (`SnapshotAny`) -- nao a versao final da transacao. Um UPDATE posterior, na
-- mesma transacao, gera um SEGUNDO evento; ele nao substitui o primeiro.
--
-- A ordem comercial nasce em dois passos dentro de
-- `save_project_commercial_measurement_order`:
--   1. o cabecalho e gravado por `save_project_measurement_order`, que nao
--      conhece Processo/horarios/Ordem -- INSERT com as colunas comerciais NULL;
--   2. so depois um UPDATE preenche essas colunas.
--
-- No COMMIT o trigger disparava para os DOIS eventos. O do UPDATE via a linha
-- completa e passava; o do INSERT via a tupla original, com
-- `commercial_process_id` NULL, caia no ramo comercial e levantava
-- `commercial_process_required`. A transacao inteira fazia rollback -- por isso
-- nao sobrava nem ordem nem lixo parcial, e a tela so mostrava falha ao salvar.
--
-- Evidencia no banco antes desta migration: 971 ordens de medicao no total,
-- ZERO de equipe comercial, ZERO com `commercial_process_id` preenchido e ZERO
-- linhas em `project_commercial_measurement_order_members`. Nenhuma Medicao
-- Comercial jamais foi gravada. A ordem TECNICA nunca quebrou porque
-- `is_commercial_team` e falso e todas as colunas comerciais sao NULL: ela cai
-- no ramo de saida limpa do trigger.
--
-- O QUE ESTA MIGRATION FAZ
-- ---------------------------------------------------------------------------
-- Recria `enforce_commercial_measurement_fields()` para RELER a linha por `id`
-- em vez de confiar no `new` do evento. Como o trigger roda no fim da transacao
-- e dentro dela, o SELECT enxerga o estado final -- que e exatamente o que a
-- 415 pretendia validar. Os dois eventos passam a ler a MESMA linha, entao a
-- checagem vira idempotente em vez de contraditoria.
--
-- O QUE ESTA MIGRATION NAO FAZ
-- ---------------------------------------------------------------------------
-- Nao altera o trigger (continua `after insert or update`, deferido, que agora
-- funciona como a 415 descreveu), nao muda a regra de negocio validada, nao
-- mexe em `enforce_measurement_project_rules`, nao toca em nenhuma ordem
-- existente e nao exige backfill: nenhuma linha comercial chegou a existir.

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
    raise exception '418: enforce_commercial_measurement_fields nao encontrada.';
  end if;

  -- A funcao nao pode mais decidir pelo `new` do evento.
  if position('from public.project_measurement_orders o' in v_definition) = 0 then
    raise exception '418: enforce_commercial_measurement_fields nao releu a linha; correcao nao aplicada.';
  end if;

  if position('new.commercial_process_id' in v_definition) > 0 then
    raise exception '418: enforce_commercial_measurement_fields ainda valida campo comercial vindo de `new`.';
  end if;

  -- O trigger continua existindo e continua deferido.
  select count(*)
  into v_count
  from pg_trigger t
  where t.tgrelid = 'public.project_measurement_orders'::regclass
    and t.tgname = 'trg_enforce_commercial_measurement_fields'
    and t.tgdeferrable
    and t.tginitdeferred;

  if v_count <> 1 then
    raise exception '418: trg_enforce_commercial_measurement_fields ausente ou nao esta deferido.';
  end if;

  -- Nenhuma ordem existente pode estar violando a regra que passa a ser
  -- efetivamente avaliada no estado final da linha.
  select count(*)
  into v_count
  from public.project_measurement_orders o
  where coalesce(public.is_commercial_team(o.tenant_id, o.team_id), false)
    and (
      o.commercial_process_id is null
      or o.commercial_start_time is null
      or o.commercial_end_time is null
    );

  if v_count > 0 then
    raise exception '418: % ordem(ns) de equipe comercial sem Processo/horarios.', v_count;
  end if;

  select count(*)
  into v_count
  from public.project_measurement_orders o
  where not coalesce(public.is_commercial_team(o.tenant_id, o.team_id), false)
    and (
      o.commercial_process_id is not null
      or o.commercial_process_name_snapshot is not null
      or o.commercial_start_time is not null
      or o.commercial_end_time is not null
      or o.commercial_order_ref is not null
    );

  if v_count > 0 then
    raise exception '418: % ordem(ns) tecnica(s) com campo comercial preenchido.', v_count;
  end if;
end;
$$;
