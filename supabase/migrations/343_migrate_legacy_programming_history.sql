-- 343_migrate_legacy_programming_history.sql
-- Fase 2 do corte: migra o historico da tela programacao-simples
-- (`project_programming_history`) para o historico do modelo normalizado
-- (`programming_history`), usando o de/para criado pela migration 342
-- (`programming_legacy_map`).
--
-- Contraria a decisao registrada nos cabecalhos das migrations 310/315/335
-- ("historico legado NAO migrado"), revista com o usuario em 2026-07-29.
--
-- LEVANTAMENTO QUE ORIGINOU ESTE ARQUIVO (producao, 2026-07-29, via
-- scripts/audit-programming-legacy-map-readonly.mjs)
-- ---------------------------------------------------------------------------
--   linhas de historico legado ...... 2594
--   sem etapa correspondente ........    0
--   apos dedupe de linhas irmas ..... 2027 (567 colapsadas, 21,9%)
--   `programming_history` ja tinha ..  414 linhas de uso real da tela nova
--
--   action_type reais: UPDATE 1376 | BATCH_CREATE 486 | RESCHEDULE 270 |
--                      COPY 145 | CANCELADA 142 | ADIADA 99 | CREATE 76
--   NAO existe ADD_TEAM nem TRANSFER_TEAM no historico legado.
--
-- DECISAO: `action_type` E PRESERVADO COMO ESTA, SEM TRADUZIR
-- ---------------------------------------------------------------------------
-- Traduzir para o vocabulario novo (CREATE_STAGE/UPDATE_STAGE/POSTPONE_STAGE...)
-- afirmaria equivalencias que nao existem. O caso mais claro e `RESCHEDULE`: na
-- tela antiga ele e uma EDICAO em que a data mudou (`v_is_reschedule` na
-- migration 106), enquanto `POSTPONE_STAGE` no modelo novo ADIA a etapa, criando
-- outra e marcando a anterior como ADIADA. Sao operacoes diferentes. Reescrever
-- o rotulo tornaria o historico migrado mais bonito e menos verdadeiro.
-- Os rotulos de exibicao dos 7 codigos legados foram adicionados em
-- `HISTORY_ACTION_LABELS` (src/modules/dashboard/programacao-normalizada/
-- constants.ts), cada um sufixado com "(Programacao Simples)", para que a origem
-- do evento fique visivel na tela sem precisar de mudanca de componente.
--
-- DEDUPE DE LINHAS IRMAS
-- ---------------------------------------------------------------------------
-- No modelo antigo uma acao de grupo gravava N linhas de historico, uma por
-- equipe da mesma etapa (o maior caso em producao tem 10 linhas do mesmo UPDATE
-- no mesmo instante). Migrar cru faria a mesma entrada aparecer 10x no historico
-- da etapa. A chave de colapso e
-- (etapa destino, action_type, created_at, created_by, reason); o representante
-- e a linha de menor `id`, e o que se perde do grupo e preservado em `metadata`
-- (`legacySiblingCount`, `legacyTeamIds`).
--
-- `programming_team_id` fica NULL em tudo que e migrado: sao eventos de ETAPA, e
-- apontar para a equipe de um irmao arbitrario seria informacao falsa. Nao ha
-- perda pratica porque nao existe evento de escopo de equipe no legado.
--
-- CAMPOS SEM COLUNA NO DESTINO
-- ---------------------------------------------------------------------------
-- O historico novo tem menos colunas. O que nao tem par vai para `metadata` com
-- prefixo `legacy`: project_id, related_programming_id, from/to_status,
-- from/to_execution_date, from/to_etapa_number. `changes` passa intacto — ja esta
-- no formato {campo: {from, to}} que a tela nova renderiza, confirmado nas 2594
-- linhas (o unico fora do padrao e `operationalGroupSync`, 31 ocorrencias, que o
-- renderizador descarta sozinho por nao ter from/to).
--
-- IDEMPOTENCIA
-- ---------------------------------------------------------------------------
-- Cada linha migrada carrega `metadata->>'legacyHistoryId'` (o id do
-- representante), com indice unico parcial criado ANTES do insert. Reexecutar
-- nao duplica. O destino ja tem 414 linhas de uso real, que nao tem essa chave e
-- nao sao tocadas.
--
-- `project_programming_history` (fonte) NAO e alterado nem apagado — so leitura.

begin;

-- =============================================================================
-- 1) Guarda de idempotencia — criada antes da carga para valer ja na primeira
--    execucao. Predicado por `is not null` em vez do operador `?` do jsonb para
--    nao depender de escape de driver.
-- =============================================================================
create unique index if not exists idx_programming_history_legacy_history_id
  on public.programming_history ((metadata ->> 'legacyHistoryId'))
  where (metadata ->> 'legacyHistoryId') is not null;

-- =============================================================================
-- 2) Carga
-- =============================================================================
with mapped as (
  select
    h.id,
    h.tenant_id,
    h.project_id,
    h.team_id,
    h.related_programming_id,
    h.reason,
    h.changes,
    h.metadata,
    h.created_by,
    h.created_at,
    h.from_status,
    h.to_status,
    h.from_execution_date,
    h.to_execution_date,
    h.from_etapa_number,
    h.to_etapa_number,
    upper(btrim(h.action_type)) as norm_action,
    m.programming_id as new_programming_id
  from public.project_programming_history h
  join public.programming_legacy_map m
    on m.legacy_programming_id = h.programming_id
   and m.tenant_id = h.tenant_id
),
stats as (
  select
    new_programming_id,
    norm_action,
    created_at,
    created_by,
    reason,
    count(*) as sibling_count,
    min(id::text) as rep_id,
    jsonb_agg(distinct team_id) filter (where team_id is not null) as team_ids
  from mapped
  group by new_programming_id, norm_action, created_at, created_by, reason
)
insert into public.programming_history (
  tenant_id, programming_id, programming_team_id, action_type, reason, changes, metadata, created_by, created_at
)
select
  rep.tenant_id,
  rep.new_programming_id,
  null::uuid,
  rep.norm_action,
  rep.reason,
  rep.changes,
  jsonb_strip_nulls(
    coalesce(rep.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'legacySource', 'programacao-simples',
      'legacyHistoryId', s.rep_id,
      'legacySiblingCount', s.sibling_count,
      'legacyTeamIds', s.team_ids,
      'legacyProjectId', rep.project_id,
      'legacyRelatedProgrammingId', rep.related_programming_id,
      'legacyFromStatus', rep.from_status,
      'legacyToStatus', rep.to_status,
      'legacyFromExecutionDate', rep.from_execution_date,
      'legacyToExecutionDate', rep.to_execution_date,
      'legacyFromEtapaNumber', rep.from_etapa_number,
      'legacyToEtapaNumber', rep.to_etapa_number
    )
  ),
  rep.created_by,
  rep.created_at
from stats s
join mapped rep
  on rep.id::text = s.rep_id
where not exists (
  select 1
  from public.programming_history existing
  where existing.metadata ->> 'legacyHistoryId' = s.rep_id
);

-- =============================================================================
-- 3) Relatorio
-- =============================================================================
do $$
declare
  v_legacy_total bigint;
  v_migravel bigint;
  v_gravadas bigint;
  v_colapsadas bigint;
  v_sem_par bigint;
  v_destino_total bigint;
  v_por_acao text;
begin
  select count(*) into v_legacy_total from public.project_programming_history;

  select count(*) into v_migravel
  from public.project_programming_history h
  join public.programming_legacy_map m
    on m.legacy_programming_id = h.programming_id
   and m.tenant_id = h.tenant_id;

  v_sem_par := v_legacy_total - v_migravel;

  select count(*) into v_gravadas
  from public.programming_history
  where metadata ->> 'legacySource' = 'programacao-simples';

  v_colapsadas := v_migravel - v_gravadas;

  select count(*) into v_destino_total from public.programming_history;

  select string_agg(format('%s=%s', action_type, total), ' | ' order by total desc)
    into v_por_acao
  from (
    select action_type, count(*) as total
    from public.programming_history
    where metadata ->> 'legacySource' = 'programacao-simples'
    group by action_type
  ) por_acao;

  raise notice '343: historico legado=% | migravel=% | sem etapa=%', v_legacy_total, v_migravel, v_sem_par;
  raise notice '343: gravadas apos dedupe=% | colapsadas=%', v_gravadas, v_colapsadas;
  raise notice '343: destino agora tem % linhas (legadas + uso real da tela nova)', v_destino_total;
  raise notice '343: por action_type -> %', coalesce(v_por_acao, '(nenhuma)');

  if v_sem_par > 0 then
    raise notice '343: ATENCAO — % linhas ficaram de fora por nao terem etapa correspondente no mapa (342).', v_sem_par;
  end if;
end
$$;

commit;
