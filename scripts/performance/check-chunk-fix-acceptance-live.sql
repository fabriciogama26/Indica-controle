-- Auditoria 15 - Criterio de aceite da correcao de `loadRowsInChunks`
--
-- SOMENTE LEITURA. Nenhum DDL, nenhum DML. Pode rodar em producao.
-- UMA UNICA INSTRUCAO: o SQL editor exibe so o resultado da ultima.
--
-- Como rodar:
--   npm run db:chunk-acceptance-live
-- ou colar este arquivo inteiro no SQL editor do Dashboard.
--
-- ============================================================================
-- POR QUE ESTE ARQUIVO EXISTE
--
-- O criterio de aceite da correcao NAO e "nao deu erro". Depois de trocar
-- `loadRowsInChunks` por um helper que pagina a resposta, a tela tem de passar a
-- devolver a contagem COMPLETA — e a unica forma de saber qual e a contagem
-- completa e perguntar ao banco.
--
-- Estes numeros sao o esperado. A validacao manual compara o que a tela mostra
-- (e o que o CSV exporta) com o que esta aqui.
--
-- ANTES da correcao, a leitura de itens em `Operacoes de Equipe` quebrava a lista
-- de transferencias em lotes de 500 e cada lote devolvia no maximo 1.000 linhas.
-- `itens_entregues_antes` reproduz esse teto lote a lote; `itens_reais` e o total
-- verdadeiro. A diferenca entre os dois e exatamente o que sumia da tela.
-- ============================================================================

with ops as (
  select distinct transfer_id
  from public.stock_transfer_team_operations
),
itens_por_transferencia as (
  select i.stock_transfer_id, count(*) as n
  from public.stock_transfer_items i
  join ops o on o.transfer_id = i.stock_transfer_id
  group by i.stock_transfer_id
),
-- Reproduz o lote de 500 na MESMA ordem que o codigo usava (ordem de chegada dos
-- ids). `row_number` sobre `stock_transfer_id` e a aproximacao estavel possivel em
-- SQL puro; serve para dimensionar a perda, nao para reproduzi-la linha a linha.
numerado as (
  select
    stock_transfer_id,
    n,
    ((row_number() over (order by stock_transfer_id) - 1) / 500)::int as lote
  from itens_por_transferencia
),
por_lote as (
  select lote, sum(n) as linhas_do_lote
  from numerado
  group by lote
)
select
  (select count(*) from ops)                                   as transferencias_de_operacoes,
  (select coalesce(sum(n), 0) from itens_por_transferencia)    as itens_reais,
  (select coalesce(sum(least(linhas_do_lote, 1000)), 0)
     from por_lote)                                            as itens_entregues_antes,
  (select coalesce(sum(n), 0) from itens_por_transferencia)
    - (select coalesce(sum(least(linhas_do_lote, 1000)), 0) from por_lote)
                                                               as itens_perdidos_antes,
  (select count(*) from por_lote)                              as lotes,
  (select count(*) from por_lote where linhas_do_lote > 1000)  as lotes_que_truncavam,
  case
    when (select count(*) from por_lote where linhas_do_lote > 1000) = 0
    then 'Nenhum lote truncava nesta base. A correcao e preventiva aqui.'
    else 'Truncava. Apos a correcao, a tela deve mostrar itens_reais.'
  end                                                          as veredito;
