-- 184_enforce_active_project_for_asbuilt_measurement.sql
-- Impede novas medicoes asbuilt para projetos inativos.

create or replace function public.enforce_active_project_for_asbuilt_measurement_order()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_project_active boolean;
begin
  select p.is_active
  into v_project_active
  from public.project p
  where p.tenant_id = new.tenant_id
    and p.id = new.project_id;

  if not found then
    raise exception 'Projeto nao encontrado para Medicao Asbuilt.'
      using errcode = 'P0001';
  end if;

  if v_project_active is distinct from true then
    raise exception 'Projeto inativo nao pode ser usado na Medicao Asbuilt.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_active_project_for_asbuilt_measurement_order
  on public.project_asbuilt_measurement_orders;

create trigger trg_enforce_active_project_for_asbuilt_measurement_order
before insert or update of project_id on public.project_asbuilt_measurement_orders
for each row
execute function public.enforce_active_project_for_asbuilt_measurement_order();
