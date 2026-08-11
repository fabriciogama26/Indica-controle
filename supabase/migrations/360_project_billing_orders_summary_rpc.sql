-- 360_project_billing_orders_summary_rpc.sql
-- Resumo agregado da listagem de Faturamento (contagem + valor total) sobre
-- TODOS os registros que batem com os filtros, nao apenas a pagina atual.
--
-- POR QUE UMA RPC
-- ---------------------------------------------------------------------------
-- O card "Valor total" da tela de Faturamento somava apenas os itens da pagina
-- carregada, entao mostrava um numero menor que o real sempre que a lista tinha
-- mais de uma pagina. Somar no Node exigiria trazer todos os itens de todos os
-- pedidos filtrados para a memoria do route -- exatamente o que o guia de
-- backend proibe. A agregacao fica no banco, junto do count que ja existia.
--
-- CONTAGEM E SOMA NA MESMA FUNCAO
-- ---------------------------------------------------------------------------
-- "Total filtrado" e "Valor total" precisam falar do MESMO conjunto de pedidos.
-- Manter o count numa query e a soma noutra abriria espaco para os dois numeros
-- divergirem quando um filtro novo for adicionado em so um dos lugares.
--
-- ESCOPO DOS FILTROS (identico ao da listagem em src/app/api/faturamento)
-- ---------------------------------------------------------------------------
-- Parametro nulo = filtro nao aplicado. Nao ha filtro por `is_active` nem por
-- status na base: pedidos cancelados continuam contando, como ja acontece na
-- lista. Do lado dos itens vale `is_active = true`, mesma regra do agregado por
-- pagina que a rota ja usava.
--
-- SEGURANCA
-- ---------------------------------------------------------------------------
-- `security invoker` (padrao): a RLS de project_billing_orders e
-- project_billing_order_items continua valendo para o usuario da sessao, e o
-- filtro por p_tenant_id e a segunda barreira. Mesmo desenho da 357.

create or replace function public.project_billing_orders_summary(
  p_tenant_id uuid,
  p_project_id uuid default null,
  p_status text default null,
  p_billing_kind text default null,
  p_no_production_reason_id uuid default null
)
returns table (
  total_orders bigint,
  total_amount numeric
)
language sql
stable
set search_path = public
as $$
  with filtered_orders as (
    select o.id
    from public.project_billing_orders o
    where o.tenant_id = p_tenant_id
      and (p_project_id is null or o.project_id = p_project_id)
      and (p_status is null or o.status = p_status)
      and (p_billing_kind is null or o.billing_kind = p_billing_kind)
      and (p_no_production_reason_id is null or o.no_production_reason_id = p_no_production_reason_id)
  )
  select
    (select count(*) from filtered_orders)::bigint as total_orders,
    coalesce(
      (
        select sum(i.total_value)
        from public.project_billing_order_items i
        join filtered_orders f on f.id = i.billing_order_id
        where i.tenant_id = p_tenant_id
          and i.is_active = true
      ),
      0
    )::numeric as total_amount;
$$;

revoke all on function public.project_billing_orders_summary(uuid, uuid, text, text, uuid) from public;
revoke all on function public.project_billing_orders_summary(uuid, uuid, text, text, uuid) from anon;
grant execute on function public.project_billing_orders_summary(uuid, uuid, text, text, uuid) to authenticated;
grant execute on function public.project_billing_orders_summary(uuid, uuid, text, text, uuid) to service_role;
