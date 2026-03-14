-- 060_add_project_has_locacao.sql
-- Marca operacional no projeto para indicar se ja houve Locacao.

alter table if exists public.project
  add column if not exists has_locacao boolean not null default false;

update public.project p
set has_locacao = true
where exists (
  select 1
  from public.project_location_plans pl
  where pl.tenant_id = p.tenant_id
    and pl.project_id = p.id
);

create index if not exists idx_project_tenant_has_locacao
  on public.project (tenant_id, has_locacao);

drop view if exists public.project_with_labels;
create view public.project_with_labels with (security_invoker = true) as
select
  p.id,
  p.tenant_id,
  p.sob,
  p.service_center,
  sc.name as service_center_text,
  p.partner,
  ct.name as partner_text,
  p.service_type,
  st.name as service_type_text,
  p.execution_deadline,
  p.priority,
  pr.name as priority_text,
  p.estimated_value,
  p.voltage_level,
  vl.name as voltage_level_text,
  p.project_size,
  ps.name as project_size_text,
  p.contractor_responsible,
  pe.nome as contractor_responsible_text,
  p.utility_responsible,
  ur.name as utility_responsible_text,
  p.utility_field_manager,
  ufm.name as utility_field_manager_text,
  p.street,
  p.neighborhood,
  p.city,
  m.name as city_text,
  p.service_description,
  p.observation,
  p.is_active,
  p.has_locacao,
  p.cancellation_reason,
  p.canceled_at,
  p.canceled_by,
  p.created_by,
  p.updated_by,
  p.created_at,
  p.updated_at
from public.project p
left join public.project_service_centers sc
  on sc.id = p.service_center
 and sc.tenant_id = p.tenant_id
left join public.contract ct
  on ct.id = p.partner
 and ct.tenant_id = p.tenant_id
left join public.project_service_types st
  on st.id = p.service_type
 and st.tenant_id = p.tenant_id
left join public.project_priorities pr
  on pr.id = p.priority
 and pr.tenant_id = p.tenant_id
left join public.project_voltage_levels vl
  on vl.id = p.voltage_level
 and vl.tenant_id = p.tenant_id
left join public.project_sizes ps
  on ps.id = p.project_size
 and ps.tenant_id = p.tenant_id
left join public.people pe
  on pe.id = p.contractor_responsible
 and pe.tenant_id = p.tenant_id
left join public.project_utility_responsibles ur
  on ur.id = p.utility_responsible
 and ur.tenant_id = p.tenant_id
left join public.project_utility_field_managers ufm
  on ufm.id = p.utility_field_manager
 and ufm.tenant_id = p.tenant_id
left join public.project_municipalities m
  on m.id = p.city
 and m.tenant_id = p.tenant_id;

grant select on public.project_with_labels to authenticated;
