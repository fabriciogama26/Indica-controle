-- 357_dashboard_portfolio_asbuilt_factor_rpc.sql
-- Fator historico de realizacao As Built, para a banda de sensibilidade da
-- Carteira Operacional.
--
-- POR QUE UMA RPC E NAO UMA QUERY NO CONTROLLER
-- ---------------------------------------------------------------------------
-- A Carteira nao pode importar o dominio da Medicao As Built (CLAUDE.md secao 5:
-- feature nao importa regra de dominio de feature irma; comunicacao por contrato
-- explicito). Esta funcao e o contrato, no mesmo padrao das 333 e 334, que ja
-- servem esta tela.
--
-- O QUE O FATOR MEDE
-- ---------------------------------------------------------------------------
-- As Built NAO e producao paralela: todo projeto com As Built tambem tem medicao
-- operacional. E remedicao do MESMO escopo com valor reconhecido diferente. O
-- fator e portanto uma taxa de realizacao (valor As Built / valor medido nos
-- MESMOS projetos), nao um valor a somar em lugar nenhum.
--
-- HISTORICO CONSOLIDADO, SEM JANELA
-- ---------------------------------------------------------------------------
-- Nao ha recorte de ciclo de proposito. As Built acontece depois da medicao
-- operacional, com defasagem: restringir a um ciclo pegaria o numerador
-- incompleto e subestimaria o fator de forma sistematica.
--
-- SEM SEGMENTACAO POR CENTRO DE SERVICO
-- ---------------------------------------------------------------------------
-- A elegibilidade de As Built e decidida pelo Estado do Trabalho
-- (get_cronograma_asbuilt_project_ids, migration 347: CONCLUIDO,
-- BENEFICIO_ATINGIDO ou PARCIAL_PLANEJADO_BENEFICIO_ATINGIDO), nunca por
-- regional ou tipo de servico. Projeto medido sem As Built nao e isento: e
-- projeto que ainda nao chegou ao marco de conclusao. Por isso o fator e unico
-- e uniforme.
--
-- SEGURANCA
-- ---------------------------------------------------------------------------
-- `security invoker` (padrao): a RLS de cada tabela continua valendo para o
-- usuario da sessao, e o filtro por p_tenant_id e a segunda barreira. Mesmo
-- desenho da 333.

create or replace function public.dashboard_portfolio_asbuilt_factor(
  p_tenant_id uuid
)
returns table (
  asbuilt_value numeric,
  measured_value numeric,
  factor numeric,
  projects_with_asbuilt integer,
  projects_measured integer
)
language sql
stable
set search_path = public
as $$
  with asbuilt_projects as (
    select distinct o.project_id
    from public.project_asbuilt_measurement_orders o
    where o.tenant_id = p_tenant_id
      and o.is_active = true
      and o.status <> 'CANCELADA'
      and o.asbuilt_kind = 'COM_PRODUCAO'
  ),
  asbuilt_totals as (
    select coalesce(sum(i.total_value), 0)::numeric as total
    from public.project_asbuilt_measurement_order_items i
    join public.project_asbuilt_measurement_orders o
      on o.id = i.asbuilt_measurement_order_id
     and o.tenant_id = i.tenant_id
    where i.tenant_id = p_tenant_id
      and i.is_active = true
      and o.is_active = true
      and o.status <> 'CANCELADA'
      and o.asbuilt_kind = 'COM_PRODUCAO'
  ),
  -- Medicao operacional com EXATAMENTE os mesmos filtros que a Carteira usa para
  -- compor `valor acumulado`. Qualquer divergencia aqui tornaria o fator
  -- incomparavel com o numero em que ele sera aplicado.
  measured_orders as (
    select mo.id, mo.project_id
    from public.project_measurement_orders mo
    where mo.tenant_id = p_tenant_id
      and mo.is_active = true
      and mo.measurement_kind = 'COM_PRODUCAO'
      and mo.status <> 'CANCELADA'
  ),
  measured_totals as (
    select coalesce(sum(mi.total_value), 0)::numeric as total
    from public.project_measurement_order_items mi
    join measured_orders mo
      on mo.id = mi.measurement_order_id
    join asbuilt_projects ap
      on ap.project_id = mo.project_id
    where mi.tenant_id = p_tenant_id
      and mi.is_active = true
  ),
  sample as (
    select
      (
        select count(distinct mo.project_id)
        from measured_orders mo
        join asbuilt_projects ap on ap.project_id = mo.project_id
      )::integer as with_asbuilt,
      (
        select count(distinct mo.project_id)
        from measured_orders mo
      )::integer as measured
  )
  select
    asbuilt_totals.total as asbuilt_value,
    measured_totals.total as measured_value,
    case
      when measured_totals.total > 0 then asbuilt_totals.total / measured_totals.total
      else 0
    end::numeric as factor,
    sample.with_asbuilt as projects_with_asbuilt,
    sample.measured as projects_measured
  from asbuilt_totals, measured_totals, sample;
$$;

revoke all on function public.dashboard_portfolio_asbuilt_factor(uuid) from public;
revoke all on function public.dashboard_portfolio_asbuilt_factor(uuid) from anon;
grant execute on function public.dashboard_portfolio_asbuilt_factor(uuid) to authenticated;
grant execute on function public.dashboard_portfolio_asbuilt_factor(uuid) to service_role;
