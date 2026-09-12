-- Auditoria 15 - Supabase implicit row cap
-- CARDINALIDADE POS-FILTRO: decide os casos da triagem P0 (passo 5).
--
-- SOMENTE LEITURA. Nenhum DDL, nenhum DML. Pode rodar em producao.
-- UMA UNICA INSTRUCAO: o SQL editor exibe so o resultado da ultima.
--
-- Como rodar:
--   npm run db:postfilter-live
-- ou colar este arquivo inteiro no SQL editor do Dashboard.
--
-- ============================================================================
-- POR QUE ESTA MEDICAO EXISTE
--
-- A medicao de cardinalidade por tabela (check-tenant-cardinality-live.sql) diz
-- QUANTO a tabela tem. Ela nao diz quanto UMA CONSULTA devolve, porque a consulta
-- tem filtro. `material_history` tem 10.803 linhas e e P0, mas filtrada por um
-- `stockTransferId` devolve um punhado — e SAFE na pratica.
--
-- O inverso tambem acontece, e e o caso perigoso: consulta que parece limitada
-- porque o parametro vem em lotes, mas cuja RESPOSTA nao tem teto. `chunk de
-- parametro != paginacao de resposta`. Um chunk de 500 transferencias multiplicado
-- pela media de itens por transferencia passa de 1.000 linhas numa unica resposta.
--
-- Estas quatro consultas medem exatamente as distribuicoes que decidem as cadeias
-- P0 abertas na triagem. Cada uma responde "qual e o MAIOR retorno possivel desta
-- consulta", nao "qual e a media".
-- ============================================================================

with
-- (1) DECIDE 11 das 13 cadeias de `stock_transfer_items`.
-- Todas filtram `.in("stock_transfer_id", <lote>)`. O retorno e
-- (tamanho do lote) x (itens por transferencia). Tamanhos de lote em uso:
--   stock-balance e stock-transfers : RELATION_QUERY_CHUNK_SIZE = 100
--   team-stock-operations           : RELATION_QUERY_CHUNK_SIZE = 500  <- suspeito
-- `pior_lote_500` soma os 500 maiores: e o teto real de um chunk de 500.
itens_por_transferencia as (
  select stock_transfer_id, count(*) as n
  from public.stock_transfer_items
  group by stock_transfer_id
),
lote as (
  select
    'stock_transfer_items por lote de transferencias' as medida,
    max(n)                                            as max_por_transferencia,
    round(avg(n), 2)                                  as media_por_transferencia,
    (select coalesce(sum(n), 0) from (
       select n from itens_por_transferencia order by n desc limit 100
     ) t)                                             as pior_lote_100,
    (select coalesce(sum(n), 0) from (
       select n from itens_por_transferencia order by n desc limit 500
     ) t)                                             as pior_lote_500
  from itens_por_transferencia
),
-- (2) DECIDE `trafo-positions/route.ts:318`.
-- Filtra material_id + serial_number + lot_code: e o historico de UMA unidade
-- fisica. Sem barreira nenhuma na consulta.
serial as (
  select
    'stock_transfer_items por serial (material+serial+lote)' as medida,
    coalesce(max(n), 0) as max_por_transferencia,
    coalesce(round(avg(n), 2), 0) as media_por_transferencia,
    0 as pior_lote_100,
    0 as pior_lote_500
  from (
    select count(*) as n
    from public.stock_transfer_items
    where serial_number is not null
    group by material_id, serial_number, lot_code
  ) s
),
-- (3) DECIDE `stock-transfers/route.ts:1097` (4 consultas sem barreira) e
-- `team-stock-operations/route.ts:1187` (mesma leitura, com `.limit(200)`).
-- Ambas leem material_history filtrando por UM transferId dentro do JSONB
-- `changes`. A pergunta e quantas linhas um unico transferId pode gerar.
hist as (
  select
    'material_history por stockTransferId' as medida,
    coalesce(max(n), 0) as max_por_transferencia,
    coalesce(round(avg(n), 2), 0) as media_por_transferencia,
    0 as pior_lote_100,
    0 as pior_lote_500
  from (
    select changes ->> 'stockTransferId' as tid, count(*) as n
    from public.material_history
    where change_type = 'UPDATE'
      and changes ->> 'stockTransferId' is not null
    group by 1
  ) h
),
-- (4) CONTEXTO para (1): quantas transferencias entram na lista de Operacoes de
-- Equipe. `loadAllPages` le TODAS as operacoes do tenant, sem recorte de pagina,
-- entao esta e a quantidade de ids que vai ser chunkada por 500.
ops as (
  select
    'transferencias ligadas a operacoes de equipe' as medida,
    count(distinct transfer_id) as max_por_transferencia,
    0 as media_por_transferencia,
    0 as pior_lote_100,
    0 as pior_lote_500
  from public.stock_transfer_team_operations
)
select * from lote
union all select * from serial
union all select * from hist
union all select * from ops;
