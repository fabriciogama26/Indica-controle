-- Auditoria 15 - Residuo de 4 linhas na listagem de Operacoes de Equipe
--
-- SOMENTE LEITURA. UMA UNICA INSTRUCAO.
--   npm run db:residual-live
--
-- CONTEXTO: apos a correcao de `loadAllPages` (commit 01119fc), a listagem passou de
-- 4.193 para 5.787 linhas. O esperado pela medicao anterior era 5.791 — sobram 4.
--
-- A medicao anterior (5.791) NAO filtrava tenant em nenhum dos dois lados, enquanto a
-- rota filtra `tenant_id` na operacao E na transferencia, e usa `stock_transfers!inner`.
-- Esta consulta separa as duas populacoes para dizer se os 4 sao exclusao legitima do
-- join interno ou perda residual da aplicacao.

select
  (select count(*)
     from public.stock_transfer_items i
     join public.stock_transfer_team_operations o
       on o.transfer_id = i.stock_transfer_id)                    as itens_sem_filtro_de_tenant,
  (select count(*)
     from public.stock_transfer_items i
     join public.stock_transfer_team_operations o
       on o.transfer_id = i.stock_transfer_id
     join public.stock_transfers st
       on st.id = o.transfer_id
      and st.tenant_id = o.tenant_id
    where i.tenant_id = o.tenant_id)                              as itens_com_join_da_rota,
  (select count(*)
     from public.stock_transfer_team_operations o
     left join public.stock_transfers st
       on st.id = o.transfer_id
      and st.tenant_id = o.tenant_id
    where st.id is null)                                          as operacoes_sem_transferencia,
  (select count(*)
     from public.stock_transfer_items i
     join public.stock_transfer_team_operations o
       on o.transfer_id = i.stock_transfer_id
    where i.tenant_id <> o.tenant_id)                             as itens_de_outro_tenant;
