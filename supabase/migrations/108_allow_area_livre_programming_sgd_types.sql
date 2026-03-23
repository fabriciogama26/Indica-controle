-- 108_allow_area_livre_programming_sgd_types.sql
-- Permite o tipo tecnico AREA_LIVRE no catalogo programming_sgd_types.

alter table if exists public.programming_sgd_types
  drop constraint if exists programming_sgd_types_export_column_check;

alter table if exists public.programming_sgd_types
  add constraint programming_sgd_types_export_column_check
  check (export_column in ('SGD_AT_MT_VYP', 'SGD_BT', 'SGD_TET', 'AREA_LIVRE'));

insert into public.programming_sgd_types (tenant_id, description, export_column, is_active)
select
  t.id as tenant_id,
  'AREA LIVRE' as description,
  'AREA_LIVRE' as export_column,
  true as is_active
from public.tenants t
where not exists (
  select 1
  from public.programming_sgd_types pst
  where pst.tenant_id = t.id
    and (
      pst.export_column = 'AREA_LIVRE'
      or upper(btrim(coalesce(pst.description, ''))) = 'AREA LIVRE'
    )
);
