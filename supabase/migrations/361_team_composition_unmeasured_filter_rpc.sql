-- 361_team_composition_unmeasured_filter_rpc.sql
-- Filtra a listagem de Composicao de Equipe por projetos sem Medicao.
--
-- POR QUE UMA RPC
-- ---------------------------------------------------------------------------
-- O indicador verde da tela e derivado de project_measurement_orders para o
-- mesmo Tenant + Projeto + Equipe + Data. Aplicar esse filtro no frontend
-- filtraria apenas a pagina ja carregada e quebraria totalizacao/exportacao.
-- A RPC resolve o anti-join no banco e devolve somente os IDs da pagina.
--
-- REGRA
-- ---------------------------------------------------------------------------
-- Uma composicao entra no filtro quando pelo menos um projeto vinculado a ela
-- nao possui ordem de Medicao ativa e nao cancelada no mesmo contexto.
-- Quando o filtro de Projeto esta ativo, a verificacao vale para aquele projeto
-- especifico.
--
-- SEGURANCA
-- ---------------------------------------------------------------------------
-- `security invoker` (padrao): a rota chama via client admin/service_role e
-- passa o tenant da sessao autenticada. EXECUTE fica fechado para public/anon/
-- authenticated e liberado apenas para service_role.

create or replace function public.list_unmeasured_team_composition_ids(
  p_tenant_id uuid,
  p_start_date date default null,
  p_end_date date default null,
  p_project_id uuid default null,
  p_team_id uuid default null,
  p_work_status text default null,
  p_page integer default 1,
  p_page_size integer default 50
)
returns table (
  composition_id uuid,
  total_count bigint
)
language sql
stable
set search_path = public
as $$
  with filtered_compositions as (
    select
      c.id,
      c.composition_date,
      c.created_at,
      c.project_id,
      c.team_id
    from public.team_compositions c
    where c.tenant_id = p_tenant_id
      and c.is_active = true
      and (p_start_date is null or c.composition_date >= p_start_date)
      and (p_end_date is null or c.composition_date <= p_end_date)
      and (p_team_id is null or c.team_id = p_team_id)
      and (
        p_work_status is null
        or (
          upper(btrim(p_work_status)) = 'WORKING'
          and coalesce(c.work_status, 'WORKING') = 'WORKING'
        )
        or (
          upper(btrim(p_work_status)) = 'NOT_WORKING'
          and c.work_status = 'NOT_WORKING'
        )
      )
  ),
  composition_projects as (
    select
      fc.id as composition_id,
      fc.composition_date,
      fc.created_at,
      fc.team_id,
      tcp.project_id
    from filtered_compositions fc
    join public.team_composition_projects tcp
      on tcp.tenant_id = p_tenant_id
     and tcp.composition_id = fc.id

    union all

    select
      fc.id as composition_id,
      fc.composition_date,
      fc.created_at,
      fc.team_id,
      fc.project_id
    from filtered_compositions fc
    where fc.project_id is not null
      and not exists (
        select 1
        from public.team_composition_projects tcp
        where tcp.tenant_id = p_tenant_id
          and tcp.composition_id = fc.id
      )
  ),
  eligible_compositions as (
    select
      fc.id,
      fc.composition_date,
      fc.created_at
    from filtered_compositions fc
    where exists (
      select 1
      from composition_projects cp
      where cp.composition_id = fc.id
        and (p_project_id is null or cp.project_id = p_project_id)
        and not exists (
          select 1
          from public.project_measurement_orders mo
          where mo.tenant_id = p_tenant_id
            and mo.is_active = true
            and mo.status is distinct from 'CANCELADA'
            and mo.project_id = cp.project_id
            and mo.team_id = cp.team_id
            and mo.execution_date = cp.composition_date
        )
    )
  ),
  counted as (
    select
      ec.id,
      ec.composition_date,
      ec.created_at,
      count(*) over () as total_count
    from eligible_compositions ec
  )
  select
    counted.id as composition_id,
    counted.total_count
  from counted
  order by counted.composition_date desc, counted.created_at desc
  limit greatest(1, least(coalesce(p_page_size, 50), 100))
  offset (greatest(coalesce(p_page, 1), 1) - 1) * greatest(1, least(coalesce(p_page_size, 50), 100));
$$;

revoke all on function public.list_unmeasured_team_composition_ids(uuid, date, date, uuid, uuid, text, integer, integer) from public;
revoke all on function public.list_unmeasured_team_composition_ids(uuid, date, date, uuid, uuid, text, integer, integer) from anon;
revoke all on function public.list_unmeasured_team_composition_ids(uuid, date, date, uuid, uuid, text, integer, integer) from authenticated;
grant execute on function public.list_unmeasured_team_composition_ids(uuid, date, date, uuid, uuid, text, integer, integer) to service_role;

notify pgrst, 'reload schema';
