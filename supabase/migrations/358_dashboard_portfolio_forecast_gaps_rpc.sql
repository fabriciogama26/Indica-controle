-- 358_dashboard_portfolio_forecast_gaps_rpc.sql
-- Projetos fora da base da Carteira Operacional por falta de atividade prevista.
--
-- POR QUE ISSO EXISTE
-- ---------------------------------------------------------------------------
-- A base da Carteira e fechada: so entra projeto que aparece na RPC 333
-- (`project_activity_forecast` + `service_activities`). Projeto fora dela e
-- invisivel na tela, e o que mais importa e o caso em que ele PRODUZIU: essa
-- producao e receita real do ciclo que nao abate a meta no bloco `Cobertura da
-- meta`, porque a meta vem de `measurement_cycle_target_items` e vale para o
-- tenant inteiro. O numero que essa RPC entrega e o tamanho desse desvio.
--
-- TRES SITUACOES, DUAS DELAS FORA DA BASE
-- ---------------------------------------------------------------------------
-- SEM_PREVISAO        : nenhuma linha em `project_activity_forecast`. Falta
--                       cadastrar. FORA da base.
-- PREVISAO_ORFA       : tem linha, mas nenhuma casa com `service_activities`
--                       pelo par (id, tenant_id). FORA da base. A FK da 064 nao
--                       tem ON DELETE, entao o padrao NO ACTION impede apagar
--                       atividade referenciada — o caso realista que sobra e
--                       divergencia de tenant entre a previsao e a atividade,
--                       ou seja, falha de integridade de importacao. Deve dar
--                       ZERO; se der diferente, e bug, nao cadastro pendente.
-- PREVISAO_SEM_VALOR  : casa, mas o valor previsto soma zero. Esta DENTRO da
--                       base, e por isso aparece na tela como projeto saudavel
--                       sem potencial. Sai na mesma listagem por ser o mesmo
--                       problema de cadastro, mas nao conta como fora da base.
--
-- Separar SEM_PREVISAO de PREVISAO_ORFA importa porque a correcao e oposta: no
-- primeiro alguem cadastra a previsao; no segundo cadastrar de novo nao resolve,
-- a linha continua orfa.
--
-- COMPARABILIDADE
-- ---------------------------------------------------------------------------
-- A producao usa EXATAMENTE os mesmos filtros que a Carteira aplica em `valor
-- acumulado` (is_active, COM_PRODUCAO, status <> CANCELADA, itens ativos) e a
-- mesma formula de valor previsto da 333. Divergir tornaria os numeros
-- incomparaveis com a tela em que sao exibidos.
--
-- SEGURANCA
-- ---------------------------------------------------------------------------
-- `security invoker` (padrao, como 333 e 357): a RLS de cada tabela continua
-- valendo para o usuario da sessao e o filtro por p_tenant_id e a segunda
-- barreira.

create or replace function public.dashboard_portfolio_forecast_gaps(
  p_tenant_id uuid,
  p_cycle_start date default null,
  p_cycle_end date default null,
  p_service_center uuid default null
)
returns table (
  project_id uuid,
  project_code text,
  service_center_id uuid,
  service_center_text text,
  situation text,
  is_withdrawn boolean,
  produced_total numeric,
  produced_in_cycle numeric,
  measurement_count integer,
  last_execution_date date
)
language sql
stable
set search_path = public
as $$
  with base_projects as (
    select p.id, p.sob, p.service_center, p.is_withdrawn
    from public.project p
    where p.tenant_id = p_tenant_id
      and p.is_active = true
      and coalesce(p.is_test, false) = false
      and coalesce(p.is_third_party, false) = false
      and (p_service_center is null or p.service_center = p_service_center)
  ),
  forecast_rows as (
    select paf.project_id
    from public.project_activity_forecast paf
    where paf.tenant_id = p_tenant_id
    group by paf.project_id
  ),
  forecast_joined as (
    select
      paf.project_id,
      coalesce(
        sum(
          coalesce(nullif(sa.voice_point, 0), 1)
          * paf.qty_planned
          * coalesce(sa.unit_value, 0)
          * 1
        ),
        0
      )::numeric as forecast_value
    from public.project_activity_forecast paf
    join public.service_activities sa
      on sa.id = paf.service_activity_id
     and sa.tenant_id = paf.tenant_id
    where paf.tenant_id = p_tenant_id
    group by paf.project_id
  ),
  production as (
    select
      mo.project_id,
      coalesce(sum(mi.total_value), 0)::numeric as produced_total,
      coalesce(
        sum(
          case
            when p_cycle_start is not null
             and p_cycle_end is not null
             and mo.execution_date between p_cycle_start and p_cycle_end
            then mi.total_value
            else 0
          end
        ),
        0
      )::numeric as produced_in_cycle,
      count(distinct mo.id)::integer as measurement_count,
      max(mo.execution_date) as last_execution_date
    from public.project_measurement_orders mo
    join public.project_measurement_order_items mi
      on mi.measurement_order_id = mo.id
     and mi.tenant_id = mo.tenant_id
    where mo.tenant_id = p_tenant_id
      and mo.is_active = true
      and mo.measurement_kind = 'COM_PRODUCAO'
      and mo.status <> 'CANCELADA'
      and mi.is_active = true
    group by mo.project_id
  )
  select
    bp.id as project_id,
    coalesce(nullif(btrim(bp.sob), ''), 'Projeto sem codigo') as project_code,
    bp.service_center as service_center_id,
    coalesce(sc.name, 'Nao identificado') as service_center_text,
    case
      when fr.project_id is null then 'SEM_PREVISAO'
      when fj.project_id is null then 'PREVISAO_ORFA'
      else 'PREVISAO_SEM_VALOR'
    end as situation,
    coalesce(bp.is_withdrawn, false) as is_withdrawn,
    coalesce(pr.produced_total, 0)::numeric as produced_total,
    coalesce(pr.produced_in_cycle, 0)::numeric as produced_in_cycle,
    coalesce(pr.measurement_count, 0)::integer as measurement_count,
    pr.last_execution_date
  from base_projects bp
  left join public.project_service_centers sc
    on sc.id = bp.service_center
   and sc.tenant_id = p_tenant_id
  left join forecast_rows fr on fr.project_id = bp.id
  left join forecast_joined fj on fj.project_id = bp.id
  left join production pr on pr.project_id = bp.id
  where fr.project_id is null
     or fj.project_id is null
     or fj.forecast_value <= 0;
$$;

-- Resumo agregado para o cartao da tela. Agrega a propria funcao de lista, para
-- que as duas nunca divirjam de criterio.
create or replace function public.dashboard_portfolio_forecast_gap_summary(
  p_tenant_id uuid,
  p_cycle_start date default null,
  p_cycle_end date default null,
  p_service_center uuid default null
)
returns table (
  projects_outside_base integer,
  projects_without_forecast integer,
  projects_orphan_forecast integer,
  projects_zero_value integer,
  projects_producing_outside integer,
  produced_total_outside numeric,
  produced_in_cycle_outside numeric
)
language sql
stable
set search_path = public
as $$
  select
    count(*) filter (where g.situation in ('SEM_PREVISAO', 'PREVISAO_ORFA'))::integer,
    count(*) filter (where g.situation = 'SEM_PREVISAO')::integer,
    count(*) filter (where g.situation = 'PREVISAO_ORFA')::integer,
    count(*) filter (where g.situation = 'PREVISAO_SEM_VALOR')::integer,
    count(*) filter (where g.situation in ('SEM_PREVISAO', 'PREVISAO_ORFA') and g.produced_total > 0)::integer,
    coalesce(sum(g.produced_total) filter (where g.situation in ('SEM_PREVISAO', 'PREVISAO_ORFA')), 0)::numeric,
    coalesce(sum(g.produced_in_cycle) filter (where g.situation in ('SEM_PREVISAO', 'PREVISAO_ORFA')), 0)::numeric
  from public.dashboard_portfolio_forecast_gaps(p_tenant_id, p_cycle_start, p_cycle_end, p_service_center) g;
$$;

revoke all on function public.dashboard_portfolio_forecast_gaps(uuid, date, date, uuid) from public;
revoke all on function public.dashboard_portfolio_forecast_gaps(uuid, date, date, uuid) from anon;
grant execute on function public.dashboard_portfolio_forecast_gaps(uuid, date, date, uuid) to authenticated;
grant execute on function public.dashboard_portfolio_forecast_gaps(uuid, date, date, uuid) to service_role;

revoke all on function public.dashboard_portfolio_forecast_gap_summary(uuid, date, date, uuid) from public;
revoke all on function public.dashboard_portfolio_forecast_gap_summary(uuid, date, date, uuid) from anon;
grant execute on function public.dashboard_portfolio_forecast_gap_summary(uuid, date, date, uuid) to authenticated;
grant execute on function public.dashboard_portfolio_forecast_gap_summary(uuid, date, date, uuid) to service_role;
