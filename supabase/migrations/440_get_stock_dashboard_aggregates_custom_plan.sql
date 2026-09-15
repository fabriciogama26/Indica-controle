-- 440_get_stock_dashboard_aggregates_custom_plan.sql
-- Corrige o timeout do Dashboard Estoque: mesma consulta da 439, agora em PL/pgSQL com plano
-- customizado. Sem mudanca de assinatura, retorno, regra ou permissao.
--
-- O PROBLEMA (medido em producao em 2026-09-15)
-- ---------------------------------------------------------------------------
-- `select public.get_stock_dashboard_aggregates(<tenant>, 2026-01-01, 2026-12-31, ...)` levou
-- 10.305 ms no SQL Editor. Pela API a chamada roda como `service_role`, que herda
-- `statement_timeout = 8s` do `authenticator`: a tela recebia erro 5xx.
--
-- A CAUSA
-- ---------------------------------------------------------------------------
-- Funcao `language sql` que nao pode ser embutida (CTEs, retorno escalar) e planejada SEM os
-- valores dos parametros (plano generico). Com `entry_date between $2 and $3` o planejador
-- estima pouquissimas movimentacoes no periodo e escolhe lacos aninhados que releem as CTEs
-- materializadas (transferencias do periodo) para cada item. O custo cresce de forma quadratica.
-- Reproduzido em Postgres 16 com massa sintetica do mesmo porte:
--   1.500 transferencias: funcao 439 = 3.390 ms | mesma consulta com valores = 170 ms
--   3.000 transferencias: funcao 439 = 10.827 ms | mesma consulta com valores = 249 ms
--
-- A CORRECAO
-- ---------------------------------------------------------------------------
-- `language plpgsql` com `set plan_cache_mode = force_custom_plan`: o SQL estatico do PL/pgSQL
-- passa pelo plancache, e o modo forcado planeja cada chamada com os valores reais dos
-- parametros (inclusive simplificando `p_x is null or ...`). Mesma massa de 3.000
-- transferencias: 255 ms na primeira chamada, 241 ms na segunda. O custo de planejamento por
-- chamada e de poucos milissegundos, desprezivel para um dashboard.
--
-- Resultado identico ao da 439 (mesmo conteudo em todos os campos; arrays agregados sem
-- `order by` podem sair em outra ordem, e o Node ja reordena todos eles na apresentacao).
--
-- SEGURANCA: igual a 439 -- `security invoker`, EXECUTE revogado de `public`/`anon`/`authenticated`
-- e concedido so a `service_role`.

create or replace function public.get_stock_dashboard_aggregates(
  p_tenant_id uuid,
  p_start_date date,
  p_end_date date,
  p_stock_center_id uuid default null,
  p_team_id uuid default null,
  p_project_id uuid default null,
  p_material_code text default null,
  p_material_type text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
set plan_cache_mode = force_custom_plan
as $$
begin
  -- Corpo identico ao da migration 439 (ver o cabecalho dela para a equivalencia com a
  -- implementacao anterior em route.ts).
  return (
  with
    tenant_teams as (
      select t.id, t.name, t.stock_center_id
      from public.teams t
      where t.tenant_id = p_tenant_id
    ),
    physical_centers as (
      select sc.id, sc.name, sc.controls_balance
      from public.stock_centers sc
      where sc.tenant_id = p_tenant_id
        and sc.is_active = true
        and sc.center_type = 'OWN'
        and not exists (
          select 1 from tenant_teams tt where tt.stock_center_id = sc.id
        )
    ),
    scoped_centers as (
      select pc.id
      from physical_centers pc
      where p_stock_center_id is null or pc.id = p_stock_center_id
    ),
    -- Materiais ativos do tenant que passam nos filtros de codigo/tipo. Vale tanto para
    -- saldo quanto para movimento, como os dois filtros da implementacao anterior.
    filtered_materials as (
      select
        m.id,
        m.codigo,
        m.descricao,
        m.unit_price,
        coalesce(nullif(upper(btrim(coalesce(m.umb, ''), E' \t\r\n')), ''), 'SEM UMB') as unit,
        coalesce(nullif(upper(btrim(coalesce(m.tipo, ''), E' \t\r\n')), ''), 'NAO INFORMADO') as material_type
      from public.materials m
      where m.tenant_id = p_tenant_id
        and m.is_active = true
        and (p_material_code is null or m.codigo ilike '%' || p_material_code || '%')
        and (p_material_type is null or m.tipo = p_material_type)
    ),
    balance_by_material as (
      select
        b.material_id,
        sum(b.quantity) as balance_quantity,
        max(b.updated_at) as last_balance_update
      from public.stock_center_balances b
      join scoped_centers sc on sc.id = b.stock_center_id
      join filtered_materials fm on fm.id = b.material_id
      where b.tenant_id = p_tenant_id
      group by b.material_id
    ),
    period_transfers as (
      select
        st.id,
        st.movement_type,
        st.to_stock_center_id,
        st.project_id,
        st.entry_date,
        st.created_at,
        st.updated_at,
        st.operation_event_id
      from public.stock_transfers st
      where st.tenant_id = p_tenant_id
        and st.entry_date between p_start_date and p_end_date
        and (
          exists (select 1 from scoped_centers sc where sc.id = st.from_stock_center_id)
          or exists (select 1 from scoped_centers sc where sc.id = st.to_stock_center_id)
        )
        and (p_project_id is null or st.project_id = p_project_id)
    ),
    period_team_operations as (
      select o.transfer_id, o.team_id, o.operation_kind, o.team_name_snapshot
      from public.stock_transfer_team_operations o
      join period_transfers pt on pt.id = o.transfer_id
      where o.tenant_id = p_tenant_id
    ),
    transfer_context as (
      select
        pt.id,
        pt.entry_date,
        pt.project_id,
        coalesce(pt.updated_at, pt.created_at) as changed_at,
        o.team_id,
        (
          exists (
            select 1 from public.stock_transfer_reversals r
            where r.tenant_id = p_tenant_id and r.original_stock_transfer_id = pt.id
          )
          or exists (
            select 1 from public.stock_transfer_reversals r
            where r.tenant_id = p_tenant_id and r.reversal_stock_transfer_id = pt.id
          )
        ) as is_reversed,
        case
          when o.transfer_id is null then pt.movement_type
          when o.operation_kind is not null then o.operation_kind
          when tt.stock_center_id is not null and pt.to_stock_center_id = tt.stock_center_id then 'REQUISITION'
          else 'RETURN'
        end as operation_kind,
        coalesce(
          pt.operation_event_id::text,
          concat_ws(
            ':',
            to_char(pt.entry_date, 'YYYY-MM-DD'),
            coalesce(o.team_id::text, 'SEM_EQUIPE'),
            coalesce(pt.project_id::text, 'SEM_PROJETO'),
            upper(btrim(coalesce(o.operation_kind, pt.movement_type), E' \t\r\n'))
          )
        ) as operation_event_key
      from period_transfers pt
      left join period_team_operations o on o.transfer_id = pt.id
      left join tenant_teams tt on tt.id = o.team_id
    ),
    item_context as (
      select
        i.id,
        i.stock_transfer_id,
        i.material_id,
        i.quantity,
        (fm.id is not null) as material_matches,
        (
          exists (
            select 1 from public.stock_transfer_item_reversals ir
            where ir.tenant_id = p_tenant_id
              and ir.original_stock_transfer_item_id = i.id
              and (
                ir.original_stock_transfer_id in (select pt.id from period_transfers pt)
                or ir.reversal_stock_transfer_id in (select pt.id from period_transfers pt)
              )
          )
          or exists (
            select 1 from public.stock_transfer_item_reversals ir
            where ir.tenant_id = p_tenant_id
              and ir.reversal_stock_transfer_item_id = i.id
              and (
                ir.original_stock_transfer_id in (select pt.id from period_transfers pt)
                or ir.reversal_stock_transfer_id in (select pt.id from period_transfers pt)
              )
          )
        ) as is_item_reversed
      from public.stock_transfer_items i
      join period_transfers pt on pt.id = i.stock_transfer_id
      left join filtered_materials fm on fm.id = i.material_id
      where i.tenant_id = p_tenant_id
    ),
    -- Transferencia conta como operacao se tiver ao menos um item nao estornado; com filtro
    -- de material, esse item tambem precisa passar no filtro.
    countable_transfers as (
      select distinct ic.stock_transfer_id
      from item_context ic
      where ic.is_item_reversed = false
        and ((p_material_code is null and p_material_type is null) or ic.material_matches)
    ),
    operation_events as (
      select tc.operation_event_key, tc.operation_kind, tc.entry_date
      from transfer_context tc
      join countable_transfers ct on ct.stock_transfer_id = tc.id
      where tc.is_reversed = false
        and (p_team_id is null or tc.team_id = p_team_id)
    ),
    movements as (
      select
        ic.material_id,
        ic.quantity,
        fm.codigo,
        fm.descricao,
        fm.unit,
        fm.unit_price,
        tc.operation_kind,
        tc.operation_event_key,
        tc.entry_date,
        tc.changed_at,
        tc.project_id
      from item_context ic
      join filtered_materials fm on fm.id = ic.material_id
      join transfer_context tc on tc.id = ic.stock_transfer_id
      where tc.is_reversed = false
        and ic.is_item_reversed = false
        and (p_team_id is null or tc.team_id = p_team_id)
    ),
    movement_last_by_material as (
      select mv.material_id, max(mv.changed_at) as last_movement_at
      from movements mv
      group by mv.material_id
    ),
    dashboard_materials as (
      select
        fm.id as material_id,
        fm.codigo,
        fm.descricao,
        fm.unit,
        fm.material_type,
        case when b.material_id is not null then fm.unit_price else 0 end as unit_price,
        coalesce(b.balance_quantity, 0) as balance_quantity,
        greatest(b.last_balance_update, ml.last_movement_at) as last_movement_at
      from filtered_materials fm
      left join balance_by_material b on b.material_id = fm.id
      left join movement_last_by_material ml on ml.material_id = fm.id
      where b.material_id is not null or ml.material_id is not null
    ),
    months as (
      select gs as month_start
      from generate_series(
        date_trunc('month', p_start_date::timestamp),
        date_trunc('month', p_end_date::timestamp),
        interval '1 month'
      ) gs
    ),
    event_counts_by_month as (
      select
        date_trunc('month', oe.entry_date::timestamp) as month_start,
        count(distinct oe.operation_event_key) filter (where oe.operation_kind = 'ENTRY') as entry_count,
        count(distinct oe.operation_event_key) filter (where oe.operation_kind = 'EXIT') as exit_count,
        count(distinct oe.operation_event_key) filter (where oe.operation_kind = 'TRANSFER') as transfer_count,
        count(distinct oe.operation_event_key) filter (where oe.operation_kind = 'REQUISITION') as requisition_count,
        count(distinct oe.operation_event_key) filter (where oe.operation_kind = 'RETURN') as return_count,
        count(distinct oe.operation_event_key) filter (where oe.operation_kind = 'FIELD_RETURN') as field_return_count
      from operation_events oe
      group by 1
    ),
    value_by_month as (
      select
        date_trunc('month', mv.entry_date::timestamp) as month_start,
        sum(greatest(0, mv.quantity * mv.unit_price)) as estimated_value
      from movements mv
      group by 1
    ),
    scatter_materials as (
      select
        mv.operation_kind,
        mv.material_id,
        mv.codigo,
        mv.descricao,
        mv.unit,
        sum(mv.quantity) as quantity,
        count(distinct mv.operation_event_key) as operation_count,
        count(distinct mv.project_id) as project_count
      from movements mv
      where mv.operation_kind in ('REQUISITION', 'RETURN')
      group by mv.operation_kind, mv.material_id, mv.codigo, mv.descricao, mv.unit
    ),
    scatter_units as (
      select
        mv.operation_kind,
        mv.unit,
        sum(mv.quantity) as quantity,
        count(distinct mv.material_id) as material_count,
        count(distinct mv.operation_event_key) as operation_count
      from movements mv
      where mv.operation_kind in ('REQUISITION', 'RETURN')
      group by mv.operation_kind, mv.unit
    ),
    team_options as (
      select distinct on (o.team_id)
        o.team_id as id,
        coalesce(
          nullif(btrim(coalesce(o.team_name_snapshot, ''), E' \t\r\n'), ''),
          nullif(tt.name, ''),
          'Equipe nao informada'
        ) as label
      from period_team_operations o
      join period_transfers pt on pt.id = o.transfer_id
      left join tenant_teams tt on tt.id = o.team_id
      order by o.team_id, pt.entry_date desc, pt.created_at desc
    ),
    project_options as (
      select distinct on (mv.project_id)
        mv.project_id as id,
        coalesce(nullif(btrim(coalesce(p.sob, ''), E' \t\r\n'), ''), mv.project_id::text) as label
      from movements mv
      left join public.project p on p.id = mv.project_id and p.tenant_id = p_tenant_id
      where mv.project_id is not null
      order by mv.project_id
    )
    select jsonb_build_object(
      'stockCenters', coalesce((
        select jsonb_agg(
          jsonb_build_object('id', pc.id, 'name', pc.name, 'controlsBalance', coalesce(pc.controls_balance, false))
          order by pc.name
        )
        from physical_centers pc
      ), '[]'::jsonb),
      'materials', coalesce((
        select jsonb_agg(jsonb_build_object(
          'materialId', dm.material_id,
          'materialCode', dm.codigo,
          'description', dm.descricao,
          'unit', dm.unit,
          'materialType', dm.material_type,
          'unitPrice', dm.unit_price,
          'balanceQuantity', dm.balance_quantity,
          'lastMovementAt', dm.last_movement_at
        ))
        from dashboard_materials dm
      ), '[]'::jsonb),
      'movementCount', (select count(distinct oe.operation_event_key) from operation_events oe),
      'totalMovementQuantity', coalesce((select sum(mv.quantity) from movements mv), 0),
      'movementEvolution', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'period', to_char(mo.month_start, 'YYYY-MM'),
            'label', to_char(mo.month_start, 'MM/YYYY'),
            'estimatedValue', coalesce(vm.estimated_value, 0),
            'entry', coalesce(ec.entry_count, 0),
            'exit', coalesce(ec.exit_count, 0),
            'transfer', coalesce(ec.transfer_count, 0),
            'requisition', coalesce(ec.requisition_count, 0),
            'return', coalesce(ec.return_count, 0),
            'fieldReturn', coalesce(ec.field_return_count, 0)
          )
          order by mo.month_start
        )
        from months mo
        left join event_counts_by_month ec on ec.month_start = mo.month_start
        left join value_by_month vm on vm.month_start = mo.month_start
      ), '[]'::jsonb),
      'scatterMaterials', coalesce((
        select jsonb_agg(jsonb_build_object(
          'operationKind', sm.operation_kind,
          'materialId', sm.material_id,
          'materialCode', sm.codigo,
          'description', sm.descricao,
          'unit', sm.unit,
          'quantity', sm.quantity,
          'operationCount', sm.operation_count,
          'projectCount', sm.project_count,
          'currentBalance', coalesce(dm.balance_quantity, 0)
        ))
        from scatter_materials sm
        left join dashboard_materials dm on dm.material_id = sm.material_id
      ), '[]'::jsonb),
      'scatterSummaryByUnit', coalesce((
        select jsonb_agg(jsonb_build_object(
          'operationKind', su.operation_kind,
          'unit', su.unit,
          'quantity', su.quantity,
          'materialCount', su.material_count,
          'operationCount', su.operation_count
        ))
        from scatter_units su
      ), '[]'::jsonb),
      'teams', coalesce((
        select jsonb_agg(jsonb_build_object('id', tp.id, 'label', tp.label))
        from team_options tp
      ), '[]'::jsonb),
      'projects', coalesce((
        select jsonb_agg(jsonb_build_object('id', pp.id, 'label', pp.label))
        from project_options pp
      ), '[]'::jsonb)
    )
  );
end;
$$;

comment on function public.get_stock_dashboard_aggregates(uuid, date, date, uuid, uuid, uuid, text, text) is
  'Agregacoes do Dashboard Estoque (saldo por material, evolucao mensal, contagem de operacoes, dispersao e opcoes de filtro) numa unica chamada. PL/pgSQL com plano customizado por chamada (migration 440). Chamada somente pela rota GET /api/dash-estoque com service_role.';

revoke all on function public.get_stock_dashboard_aggregates(uuid, date, date, uuid, uuid, uuid, text, text) from public;
revoke all on function public.get_stock_dashboard_aggregates(uuid, date, date, uuid, uuid, uuid, text, text) from anon;
revoke all on function public.get_stock_dashboard_aggregates(uuid, date, date, uuid, uuid, uuid, text, text) from authenticated;
grant execute on function public.get_stock_dashboard_aggregates(uuid, date, date, uuid, uuid, uuid, text, text) to service_role;
