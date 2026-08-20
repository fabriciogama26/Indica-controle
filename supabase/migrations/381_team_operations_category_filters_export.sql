-- 381_team_operations_category_filters_export.sql
-- Adiciona filtros de Categoria/Subcategoria e colunas equivalentes na exportacao CSV
-- de Operacoes de Equipe.
--
-- A classificacao ja existe em materials.category_id/subcategory_id desde a 378, com indices por
-- tenant. Aqui a RPC de exportacao so passa a consumir esse catalogo. A listagem da tela filtra
-- pelo endpoint Node; o CSV usa esta RPC para manter o download paginado e sem carregar tudo em
-- memoria.
--
-- guia_sql.md regra 17: migration posterior a hardening de grants repete revoke/grant explicito.

drop function if exists public.list_team_operations_export(
  uuid, date, date, uuid, text, uuid, text, text, text, integer, integer
);

create or replace function public.list_team_operations_export(
  p_tenant_id uuid,
  p_start_date date default null,
  p_end_date date default null,
  p_team_id uuid default null,
  p_operation_kind text default null,
  p_project_id uuid default null,
  p_material_code text default null,
  p_category_id uuid default null,
  p_subcategory_id uuid default null,
  p_entry_type text default null,
  p_reversal_status text default null,
  p_limit integer default 1000,
  p_offset integer default 0
)
returns table (
  operacao text,
  centro_estoque text,
  equipe text,
  encarregado text,
  origem_apoio text,
  projeto text,
  material_codigo text,
  descricao text,
  categoria text,
  subcategoria text,
  quantidade text,
  serial text,
  lp text,
  data_operacao text,
  tipo text,
  status text,
  observacao text
)
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select
      sti.id                                   as item_id,
      st.id                                    as transfer_id,
      coalesce(st.updated_at, st.created_at)   as sort_at,
      st.entry_date,
      st.entry_type,
      st.notes,
      st.from_stock_center_id,
      st.to_stock_center_id,
      st.project_id,
      o.team_name_snapshot,
      o.foreman_name_snapshot,
      coalesce(
        o.operation_kind,
        case
          when t.stock_center_id is not null and st.to_stock_center_id = t.stock_center_id
            then 'REQUISITION'
          else 'RETURN'
        end
      )                                        as operation_kind,
      sti.quantity,
      sti.serial_number,
      sti.lot_code,
      sti.material_id,
      (
        exists (
          select 1
          from public.stock_transfer_reversals r
          where r.tenant_id = p_tenant_id
            and r.original_stock_transfer_id = st.id
        )
        or exists (
          select 1
          from public.stock_transfer_item_reversals ir
          where ir.tenant_id = p_tenant_id
            and ir.original_stock_transfer_item_id = sti.id
        )
      )                                        as is_reversed,
      (
        exists (
          select 1
          from public.stock_transfer_reversals r
          where r.tenant_id = p_tenant_id
            and r.reversal_stock_transfer_id = st.id
        )
        or exists (
          select 1
          from public.stock_transfer_item_reversals ir
          where ir.tenant_id = p_tenant_id
            and ir.reversal_stock_transfer_item_id = sti.id
        )
      )                                        as is_reversal
    from public.stock_transfer_team_operations o
    join public.stock_transfers st
      on st.id = o.transfer_id
     and st.tenant_id = p_tenant_id
    join public.stock_transfer_items sti
      on sti.stock_transfer_id = st.id
     and sti.tenant_id = p_tenant_id
    left join public.teams t
      on t.id = o.team_id
     and t.tenant_id = p_tenant_id
    where o.tenant_id = p_tenant_id
      and (p_team_id is null or o.team_id = p_team_id)
      and (p_operation_kind is null or o.operation_kind = p_operation_kind)
      and (p_start_date is null or st.entry_date >= p_start_date)
      and (p_end_date is null or st.entry_date <= p_end_date)
      and (p_project_id is null or st.project_id = p_project_id)
      and (p_entry_type is null or st.entry_type = p_entry_type)
      and (
        (p_material_code is null and p_category_id is null and p_subcategory_id is null)
        or exists (
          select 1
          from public.materials mf
          where mf.id = sti.material_id
            and mf.tenant_id = p_tenant_id
            and (p_material_code is null or mf.codigo ilike '%' || p_material_code || '%')
            and (p_category_id is null or mf.category_id = p_category_id)
            and (p_subcategory_id is null or mf.subcategory_id = p_subcategory_id)
        )
      )
  )
  select
    case
      when b.is_reversal then 'ESTORNO'
      when b.operation_kind = 'REQUISITION' then 'Requisicao'
      when b.operation_kind = 'RETURN' then 'Devolucao'
      when b.operation_kind = 'FIELD_RETURN' then 'Retorno de campo'
      else '-'
    end                                                            as operacao,
    coalesce(
      case when b.operation_kind = 'REQUISITION' then scf.name else sct.name end,
      '-'
    )                                                              as centro_estoque,
    coalesce(b.team_name_snapshot, '')                             as equipe,
    coalesce(b.foreman_name_snapshot, '')                          as encarregado,
    coalesce(
      case when b.operation_kind = 'REQUISITION' then sct.name else scf.name end,
      '-'
    )                                                              as origem_apoio,
    coalesce(p.sob, '-')                                           as projeto,
    coalesce(m.codigo, '-')                                        as material_codigo,
    coalesce(m.descricao, '-')                                     as descricao,
    coalesce(mc.name, '')                                          as categoria,
    coalesce(ms.name, '')                                          as subcategoria,
    trim_scale(coalesce(b.quantity, 0))::text                      as quantidade,
    coalesce(b.serial_number, '')                                  as serial,
    coalesce(b.lot_code, '')                                       as lp,
    to_char(b.entry_date, 'YYYY-MM-DD')                            as data_operacao,
    coalesce(b.entry_type, '')                                     as tipo,
    case
      when b.is_reversal then 'Estorno'
      when b.is_reversed then 'Estornada'
      else 'Ativa'
    end                                                            as status,
    coalesce(b.notes, '')                                          as observacao
  from base b
  left join public.stock_centers scf
    on scf.id = b.from_stock_center_id
  left join public.stock_centers sct
    on sct.id = b.to_stock_center_id
  left join public.project p
    on p.id = b.project_id
   and p.tenant_id = p_tenant_id
  left join public.materials m
    on m.id = b.material_id
   and m.tenant_id = p_tenant_id
  left join public.material_categories mc
    on mc.id = m.category_id
   and mc.tenant_id = p_tenant_id
  left join public.material_subcategories ms
    on ms.id = m.subcategory_id
   and ms.tenant_id = p_tenant_id
  where
    case upper(coalesce(p_reversal_status, 'TODOS'))
      when 'ESTORNADAS'      then b.is_reversed
      when 'NAO_ESTORNADAS'  then (not b.is_reversed and not b.is_reversal)
      when 'ESTORNOS'        then b.is_reversal
      else true
    end
  order by b.sort_at desc, b.transfer_id, b.item_id
  limit greatest(coalesce(p_limit, 1000), 0)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.list_team_operations_export(
  uuid, date, date, uuid, text, uuid, text, uuid, uuid, text, text, integer, integer
) from public;
revoke all on function public.list_team_operations_export(
  uuid, date, date, uuid, text, uuid, text, uuid, uuid, text, text, integer, integer
) from anon;
revoke all on function public.list_team_operations_export(
  uuid, date, date, uuid, text, uuid, text, uuid, uuid, text, text, integer, integer
) from authenticated;
grant execute on function public.list_team_operations_export(
  uuid, date, date, uuid, text, uuid, text, uuid, uuid, text, text, integer, integer
) to service_role;

comment on function public.list_team_operations_export(
  uuid, date, date, uuid, text, uuid, text, uuid, uuid, text, text, integer, integer
) is
  'Exportacao CSV de Operacoes de Equipe com filtros de Categoria/Subcategoria. p_tenant_id vem SEMPRE da sessao resolvida no servidor, nunca do cliente. Executavel apenas por service_role.';
