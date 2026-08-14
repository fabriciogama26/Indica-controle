-- 367_update_materials_umb_cjt_to_un.sql
-- Saneia o cadastro oficial de materiais: UMB CJT passa a ser UN.

with target_materials as (
  select
    id,
    tenant_id,
    umb as previous_umb
  from public.materials
  where upper(btrim(coalesce(umb, ''))) = 'CJT'
),
updated_materials as (
  update public.materials materials
  set umb = 'UN'
  from target_materials target
  where materials.id = target.id
    and materials.tenant_id = target.tenant_id
  returning
    materials.id,
    materials.tenant_id,
    target.previous_umb
)
insert into public.material_history (
  tenant_id,
  material_id,
  change_type,
  changes
)
select
  tenant_id,
  id,
  'UPDATE',
  jsonb_build_object(
    'umb',
    jsonb_build_object(
      'from', previous_umb,
      'to', 'UN'
    )
  )
from updated_materials;

do $$
begin
  if exists (
    select 1
    from public.materials
    where upper(btrim(coalesce(umb, ''))) = 'CJT'
  ) then
    raise exception 'Ainda existem materiais com UMB CJT apos o saneamento.';
  end if;
end;
$$;
