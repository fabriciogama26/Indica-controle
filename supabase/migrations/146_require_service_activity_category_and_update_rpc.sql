-- 146_require_service_activity_category_and_update_rpc.sql
-- Exige categoria em atividades e atualiza RPC de escrita para persistir type_service.

alter table if exists public.service_activities
  alter column type_service set not null;

drop function if exists public.save_service_activity_record(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  text,
  numeric,
  text,
  text,
  jsonb,
  timestamptz
);

drop function if exists public.save_service_activity_record(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  uuid,
  text,
  numeric,
  text,
  text,
  jsonb,
  timestamptz
);

create or replace function public.save_service_activity_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_activity_id uuid default null,
  p_code text default null,
  p_description text default null,
  p_team_type_id uuid default null,
  p_type_service uuid default null,
  p_group_name text default null,
  p_unit_value numeric default null,
  p_unit text default null,
  p_scope text default null,
  p_changes jsonb default '{}'::jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.service_activities%rowtype;
  v_activity_id uuid;
  v_updated_at timestamptz;
begin
  if p_type_service is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'CATEGORY_REQUIRED',
      'message', 'Categoria obrigatoria para salvar atividade.'
    );
  end if;

  if not exists (
    select 1
    from public.types_service_activities tsa
    where tsa.tenant_id = p_tenant_id
      and tsa.id = p_type_service
      and tsa.ativo = true
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'INVALID_CATEGORY',
      'message', 'Categoria invalida para o tenant atual.'
    );
  end if;

  if p_activity_id is null then
    insert into public.service_activities (
      tenant_id,
      code,
      description,
      team_type_id,
      type_service,
      group_name,
      unit_value,
      unit,
      scope,
      ativo,
      cancellation_reason,
      canceled_at,
      canceled_by,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      p_code,
      p_description,
      p_team_type_id,
      p_type_service,
      nullif(btrim(coalesce(p_group_name, '')), ''),
      p_unit_value,
      p_unit,
      nullif(btrim(coalesce(p_scope, '')), ''),
      true,
      null,
      null,
      null,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at
    into v_activity_id, v_updated_at;

    return jsonb_build_object(
      'success', true,
      'status', 200,
      'activity_id', v_activity_id,
      'updated_at', v_updated_at
    );
  end if;

  select *
  into v_current
  from public.service_activities
  where id = p_activity_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'ACTIVITY_NOT_FOUND',
      'message', 'Atividade nao encontrada.'
    );
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
      'message', 'Atualize a lista antes de editar a atividade.'
    );
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'CONCURRENT_MODIFICATION',
      'message', format('A atividade %s foi alterada por outro usuario. Recarregue os dados antes de salvar novamente.', v_current.code)
    );
  end if;

  if not v_current.ativo then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'RECORD_INACTIVE',
      'message', 'Ative a atividade antes de editar.'
    );
  end if;

  update public.service_activities
  set
    code = p_code,
    description = p_description,
    team_type_id = p_team_type_id,
    type_service = p_type_service,
    group_name = nullif(btrim(coalesce(p_group_name, '')), ''),
    unit_value = p_unit_value,
    unit = p_unit,
    scope = nullif(btrim(coalesce(p_scope, '')), ''),
    updated_by = p_actor_user_id
  where id = p_activity_id
    and tenant_id = p_tenant_id
  returning id, updated_at
  into v_activity_id, v_updated_at;

  if coalesce(jsonb_object_length(coalesce(p_changes, '{}'::jsonb)), 0) > 0 then
    insert into public.app_entity_history (
      tenant_id,
      module_key,
      entity_table,
      entity_id,
      entity_code,
      change_type,
      reason,
      changes,
      metadata,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      'atividades',
      'service_activities',
      p_activity_id,
      p_code,
      'UPDATE',
      null,
      coalesce(p_changes, '{}'::jsonb),
      '{}'::jsonb,
      p_actor_user_id,
      p_actor_user_id
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'activity_id', v_activity_id,
    'updated_at', v_updated_at
  );
exception
  when unique_violation then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_ACTIVITY_CODE',
      'message', 'Ja existe atividade com este codigo no tenant atual.'
    );
end;
$$;

revoke all on function public.save_service_activity_record(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  uuid,
  text,
  numeric,
  text,
  text,
  jsonb,
  timestamptz
) from public;

grant execute on function public.save_service_activity_record(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  uuid,
  text,
  numeric,
  text,
  text,
  jsonb,
  timestamptz
) to authenticated;

grant execute on function public.save_service_activity_record(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  uuid,
  text,
  numeric,
  text,
  text,
  jsonb,
  timestamptz
) to service_role;
