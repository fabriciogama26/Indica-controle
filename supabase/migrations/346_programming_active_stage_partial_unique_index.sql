-- 346_programming_active_stage_partial_unique_index.sql
-- Fase 1 do plano acordado com o usuario para o modulo Programacao
-- Normalizada: corrige a reutilizacao de data bloqueada por etapa
-- CANCELADA/ADIADA(migrada)/ANTECIPADA. Escopo desta migration: SO o indice
-- (schema). Revisao de consumidores (cadastro manual, importacao/upsert,
-- APR, medicao, cronograma, ordenacao, qualquer .single()/limit(1) por
-- projeto+data) fica para uma entrega separada, decidida com o usuario.
--
-- CORRECAO DE PREMISSA (importante para quem ler o historico desta decisao)
-- ---------------------------------------------------------------------------
-- A analise que motivou esta migration descreveu `programming_tenant_project_
-- date_key` como "unique constraint incondicional" (310). Isso estava certo em
-- 310, mas a 318 ja tinha DROPADO essa table constraint e recriado o MESMO
-- NOME como INDICE UNICO PARCIAL (`where execution_date is not null`), so
-- para permitir varias etapas "em espera" (execution_date NULL) no mesmo
-- projeto — motivo alheio a este bug. Esse indice parcial NAO filtra por
-- status, entao o efeito pratico sobre CANCELADA/ADIADA-com-data/ANTECIPADA e
-- IDENTICO ao que a analise descreveu (todas tem execution_date preenchida,
-- continuam bloqueando a chave); so a mecanica de troca muda: e `DROP INDEX`,
-- nao `ALTER TABLE ... DROP CONSTRAINT` (essa ultima falharia, o objeto ja
-- nao e mais uma constraint desde a 318).
--
-- CAUSA RAIZ (investigada nesta conversa, com dado real de producao)
-- ---------------------------------------------------------------------------
-- `programming_tenant_project_date_key` (indice desde a 318) nao filtra por
-- status: qualquer linha com execution_date preenchida ocupa a chave
-- (tenant_id, project_id, execution_date), inclusive CANCELADA, ANTECIPADA e
-- ADIADA. Confirmado em producao antes desta migration: 91 etapas CANCELADA e
-- 20+ ADIADA (migradas da tabela legada `project_programming`, migrations
-- 315/335/342/343 — o modelo antigo mantinha a data original na linha
-- marcada ADIADA) carregam execution_date e bloqueiam a data para sempre,
-- mesmo a etapa nunca mais indo acontecer. A migration 338 documenta 87
-- CANCELADA + 66 ADIADA sem snapshot em 2026-07-28, mesma familia de casos.
--
-- cancel_project_programming_stage (337) e postpone_project_programming_stage
-- (337/326) ja fazem a parte deles corretamente:
--   - cancelar NUNCA mexe em execution_date (intencional: preserva a data
--     para filtro de periodo, exportacao e auditoria — ver 337);
--   - adiar SEMPRE atualiza a propria linha (nova data OU NULL se "em
--     espera") — nao ha bug de RPC nem de front a corrigir aqui;
--   - antecipar (mark_project_programming_completed_and_anticipate, 322)
--     tambem preserva execution_date, mesmo padrao da cancelada (hoje sem
--     nenhum caso real em producao, mas o codigo ja garante o mesmo bloqueio
--     assim que a primeira antecipacao acontecer).
--
-- DECISAO (aprovada pelo usuario)
-- ---------------------------------------------------------------------------
-- Regra deixa de ser "uma etapa por projeto+data com execution_date
-- preenchida" e passa a ser "no maximo uma etapa ATIVA (PROGRAMADA/
-- REPROGRAMADA) por projeto+data". CANCELADA, ADIADA e ANTECIPADA continuam
-- existindo com a mesma data (historico, filtro de periodo, classificacao
-- snapshot da 337, exportacao), so deixam de contar para a unicidade.
--
-- PREFLIGHT
-- ---------------------------------------------------------------------------
-- Mesmo com o indice parcial atual ja garantindo unicidade por execution_date
-- IS NOT NULL ate aqui (portanto, em teoria, impossivel haver 2 etapas ATIVAS
-- na mesma chave), este bloco confere e aborta com mensagem clara em vez de
-- deixar o CREATE UNIQUE INDEX falhar com o erro generico do Postgres.
do $$
declare
  v_dup_count integer;
begin
  select count(*) into v_dup_count
  from (
    select tenant_id, project_id, execution_date
    from public.programming
    where execution_date is not null
      and status in ('PROGRAMADA', 'REPROGRAMADA')
    group by tenant_id, project_id, execution_date
    having count(*) > 1
  ) dupes;

  if v_dup_count > 0 then
    raise exception
      '346: % combinacao(oes) de tenant+projeto+data com mais de uma etapa ATIVA (PROGRAMADA/REPROGRAMADA) — resolva manualmente qual etapa fica ativa antes de aplicar esta migration.',
      v_dup_count;
  end if;
end;
$$;

-- =============================================================================
-- Troca do indice: "execution_date preenchida" -> "ativa e com execution_date"
-- =============================================================================
-- DROP INDEX, nao DROP CONSTRAINT: desde a 318 este objeto e um indice unico
-- parcial, nao mais uma table constraint (ver nota de premissa acima). Cobre
-- os dois formatos possiveis (defesa contra o historico de migrations estar
-- desalinhado com o banco real, ja visto neste modulo — ver 340): se por
-- algum motivo ainda for uma table constraint com esse nome, o DROP INDEX
-- abaixo e um no-op silencioso e este bloco cobre o caso via DROP CONSTRAINT.
do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'programming_tenant_project_date_key'
  ) then
    alter table public.programming drop constraint programming_tenant_project_date_key;
  end if;
end;
$$;

drop index if exists public.programming_tenant_project_date_key;

create unique index programming_active_project_date_key
  on public.programming (tenant_id, project_id, execution_date)
  where execution_date is not null
    and status in ('PROGRAMADA', 'REPROGRAMADA');

comment on index public.programming_active_project_date_key is
  'Uma etapa ATIVA (PROGRAMADA/REPROGRAMADA) por projeto+data. CANCELADA/ADIADA/ANTECIPADA podem coexistir na mesma data (historico) — nao contam para esta unicidade. Substitui programming_tenant_project_date_key (346).';

-- =============================================================================
-- Validacao pos-criacao
-- =============================================================================
-- save_project_programming_stage e postpone_project_programming_stage ja
-- capturam `exception when unique_violation` de forma generica (por SQLSTATE
-- 23505, nao por nome de indice) — continuam funcionando sem alteracao. A
-- mensagem retornada ("Ja existe uma etapa para este projeto nesta data")
-- fica tecnicamente imprecisa (deveria dizer "etapa ATIVA"), mas ajustar o
-- texto e as demais telas/consumidores que tratam projeto+data como
-- identidade absoluta fica para a proxima entrega, por decisao explicita do
-- usuario nesta rodada.
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'programming'
      and indexname = 'programming_active_project_date_key'
  ) then
    raise exception '346: programming_active_project_date_key nao foi criado.';
  end if;

  if exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'programming'
      and indexname = 'programming_tenant_project_date_key'
  ) then
    raise exception '346: programming_tenant_project_date_key (indice) ainda existe (drop nao aplicado).';
  end if;

  if exists (
    select 1 from pg_constraint where conname = 'programming_tenant_project_date_key'
  ) then
    raise exception '346: programming_tenant_project_date_key (constraint) ainda existe (drop nao aplicado).';
  end if;
end;
$$;
