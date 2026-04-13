-- 150_add_project_is_test_and_status_filters.sql
-- Adiciona marcador de obra de teste em projetos, atualiza view de labels e RPC de escrita.

alter table if exists public.project
  add column if not exists is_test boolean;

update public.project
set is_test = false
where is_test is null;

alter table if exists public.project
  alter column is_test set default false;

alter table if exists public.project
  alter column is_test set not null;

create index if not exists idx_project_tenant_is_test
  on public.project (tenant_id, is_test);

drop view if exists public.project_with_labels;
create view public.project_with_labels with (security_invoker = true) as
select
  p.id,
  p.tenant_id,
  p.sob,
  p.fob,
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
  p.is_test,
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

drop function if exists public.save_project_record(
  uuid, uuid, uuid, text, text, uuid, uuid, uuid, date, uuid, numeric, uuid, uuid, uuid, uuid, uuid, text, text, uuid, text, text, jsonb, timestamptz
);

create or replace function public.save_project_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_project_id uuid default null,
  p_sob text default null,
  p_fob text default null,
  p_service_center uuid default null,
  p_partner uuid default null,
  p_service_type uuid default null,
  p_execution_deadline date default null,
  p_priority uuid default null,
  p_estimated_value numeric default null,
  p_voltage_level uuid default null,
  p_project_size uuid default null,
  p_contractor_responsible uuid default null,
  p_utility_responsible uuid default null,
  p_utility_field_manager uuid default null,
  p_street text default null,
  p_neighborhood text default null,
  p_city uuid default null,
  p_service_description text default null,
  p_observation text default null,
  p_is_test boolean default false,
  p_changes jsonb default '{}'::jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.project%rowtype;
  v_project_id uuid;
  v_updated_at timestamptz;
begin
  if p_project_id is null then
    insert into public.project (
      tenant_id,
      sob,
      fob,
      service_center,
      partner,
      service_type,
      execution_deadline,
      priority,
      estimated_value,
      voltage_level,
      project_size,
      contractor_responsible,
      utility_responsible,
      utility_field_manager,
      street,
      neighborhood,
      city,
      service_description,
      observation,
      is_active,
      is_test,
      cancellation_reason,
      canceled_at,
      canceled_by,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      p_sob,
      p_fob,
      p_service_center,
      p_partner,
      p_service_type,
      p_execution_deadline,
      p_priority,
      p_estimated_value,
      p_voltage_level,
      p_project_size,
      p_contractor_responsible,
      p_utility_responsible,
      p_utility_field_manager,
      p_street,
      p_neighborhood,
      p_city,
      nullif(btrim(coalesce(p_service_description, '')), ''),
      nullif(btrim(coalesce(p_observation, '')), ''),
      true,
      coalesce(p_is_test, false),
      null,
      null,
      null,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at
    into v_project_id, v_updated_at;

    return jsonb_build_object(
      'success', true,
      'status', 200,
      'project_id', v_project_id,
      'updated_at', v_updated_at
    );
  end if;

  select *
  into v_current
  from public.project
  where id = p_project_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'PROJECT_NOT_FOUND',
      'message', 'Projeto nao encontrado.'
    );
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
      'message', 'Atualize a lista antes de editar o projeto.'
    );
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'CONCURRENT_MODIFICATION',
      'message', format('O projeto %s foi alterado por outro usuario. Recarregue os dados antes de salvar novamente.', v_current.sob)
    );
  end if;

  if not v_current.is_active then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'RECORD_INACTIVE',
      'message', 'Projeto inativo nao pode ser editado.'
    );
  end if;

  update public.project
  set
    sob = p_sob,
    fob = p_fob,
    service_center = p_service_center,
    partner = p_partner,
    service_type = p_service_type,
    execution_deadline = p_execution_deadline,
    priority = p_priority,
    estimated_value = p_estimated_value,
    voltage_level = p_voltage_level,
    project_size = p_project_size,
    contractor_responsible = p_contractor_responsible,
    utility_responsible = p_utility_responsible,
    utility_field_manager = p_utility_field_manager,
    street = p_street,
    neighborhood = p_neighborhood,
    city = p_city,
    service_description = nullif(btrim(coalesce(p_service_description, '')), ''),
    observation = nullif(btrim(coalesce(p_observation, '')), ''),
    is_test = coalesce(p_is_test, false),
    updated_by = p_actor_user_id
  where id = p_project_id
    and tenant_id = p_tenant_id
  returning id, updated_at
  into v_project_id, v_updated_at;

  if coalesce(jsonb_object_length(coalesce(p_changes, '{}'::jsonb)), 0) > 0 then
    insert into public.project_history (
      tenant_id,
      project_id,
      change_type,
      changes,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      p_project_id,
      'UPDATE',
      coalesce(p_changes, '{}'::jsonb),
      p_actor_user_id,
      p_actor_user_id
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'project_id', v_project_id,
    'updated_at', v_updated_at
  );
exception
  when unique_violation then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_PROJECT_SOB',
      'message', 'Ja existe projeto com este SOB no tenant atual.'
    );
end;
$$;

revoke all on function public.save_project_record(
  uuid, uuid, uuid, text, text, uuid, uuid, uuid, date, uuid, numeric, uuid, uuid, uuid, uuid, uuid, text, text, uuid, text, text, boolean, jsonb, timestamptz
) from public;

grant execute on function public.save_project_record(
  uuid, uuid, uuid, text, text, uuid, uuid, uuid, date, uuid, numeric, uuid, uuid, uuid, uuid, uuid, text, text, uuid, text, text, boolean, jsonb, timestamptz
) to authenticated;

grant execute on function public.save_project_record(
  uuid, uuid, uuid, text, text, uuid, uuid, uuid, date, uuid, numeric, uuid, uuid, uuid, uuid, uuid, text, text, uuid, text, text, boolean, jsonb, timestamptz
) to service_role;
