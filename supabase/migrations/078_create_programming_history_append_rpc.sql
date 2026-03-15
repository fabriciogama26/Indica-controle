-- 078_create_programming_history_append_rpc.sql
-- Move o historico complementar da Programacao para RPC dedicada.

drop function if exists public.append_programming_history(
  uuid,
  uuid,
  uuid,
  text,
  text,
  jsonb,
  jsonb,
  text,
  boolean
);

create or replace function public.append_programming_history(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_id uuid,
  p_project_code text,
  p_reason text default null,
  p_changes jsonb default '{}'::jsonb,
  p_metadata jsonb default '{}'::jsonb,
  p_change_type text default 'UPDATE',
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_change_type text := upper(nullif(btrim(coalesce(p_change_type, '')), ''));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_project_code text := nullif(btrim(coalesce(p_project_code, '')), '');
  v_exists boolean := false;
begin
  if p_tenant_id is null or p_actor_user_id is null or p_programming_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_HISTORY_PAYLOAD',
      'message', 'Payload invalido para registrar historico da programacao.'
    );
  end if;

  if jsonb_typeof(coalesce(p_changes, '{}'::jsonb)) <> 'object' then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_HISTORY_CHANGES',
      'message', 'O bloco de changes do historico da programacao e invalido.'
    );
  end if;

  if jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_HISTORY_METADATA',
      'message', 'O bloco de metadata do historico da programacao e invalido.'
    );
  end if;

  if v_change_type is null then
    v_change_type := 'UPDATE';
  end if;

  if v_change_type not in ('UPDATE', 'CANCEL', 'ACTIVATE') then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_HISTORY_CHANGE_TYPE',
      'message', 'Tipo de historico invalido para a programacao.'
    );
  end if;

  if not p_force and coalesce(jsonb_object_length(coalesce(p_changes, '{}'::jsonb)), 0) = 0 then
    return jsonb_build_object(
      'success', true,
      'status', 200,
      'skipped', true
    );
  end if;

  select exists(
    select 1
    from public.project_programming pp
    where pp.tenant_id = p_tenant_id
      and pp.id = p_programming_id
  )
  into v_exists;

  if not v_exists then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'PROGRAMMING_NOT_FOUND',
      'message', 'Programacao nao encontrada para registrar historico.'
    );
  end if;

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
    'programacao',
    'project_programming',
    p_programming_id,
    coalesce(v_project_code, p_programming_id::text),
    v_change_type,
    v_reason,
    coalesce(p_changes, '{}'::jsonb),
    coalesce(p_metadata, '{}'::jsonb),
    p_actor_user_id,
    p_actor_user_id
  );

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'skipped', false
  );
end;
$$;

revoke all on function public.append_programming_history(
  uuid,
  uuid,
  uuid,
  text,
  text,
  jsonb,
  jsonb,
  text,
  boolean
) from public;

grant execute on function public.append_programming_history(
  uuid,
  uuid,
  uuid,
  text,
  text,
  jsonb,
  jsonb,
  text,
  boolean
) to authenticated;

grant execute on function public.append_programming_history(
  uuid,
  uuid,
  uuid,
  text,
  text,
  jsonb,
  jsonb,
  text,
  boolean
) to service_role;
