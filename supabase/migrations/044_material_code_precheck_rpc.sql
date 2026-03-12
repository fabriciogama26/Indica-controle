-- 044_material_code_precheck_rpc.sql
-- RPC de pre-check para impedir codigo duplicado em materials por tenant.

create or replace function public.precheck_material_code_conflict(
  p_tenant_id uuid,
  p_material_id uuid default null,
  p_codigo text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_codigo text := upper(btrim(coalesce(p_codigo, '')));
  v_existing_id uuid;
begin
  if p_tenant_id is null then
    return jsonb_build_object(
      'success', false,
      'reason', 'TENANT_REQUIRED'
    );
  end if;

  if v_codigo = '' then
    return jsonb_build_object(
      'success', false,
      'reason', 'CODE_REQUIRED'
    );
  end if;

  select m.id
  into v_existing_id
  from public.materials m
  where m.tenant_id = p_tenant_id
    and upper(btrim(m.codigo)) = v_codigo
    and (p_material_id is null or m.id <> p_material_id)
  limit 1;

  if v_existing_id is not null then
    return jsonb_build_object(
      'success', false,
      'reason', 'CODE_ALREADY_EXISTS',
      'codigo', v_codigo,
      'existing_id', v_existing_id
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'codigo', v_codigo
  );
end;
$$;

revoke all on function public.precheck_material_code_conflict(uuid, uuid, text) from public;
grant execute on function public.precheck_material_code_conflict(uuid, uuid, text) to authenticated;
grant execute on function public.precheck_material_code_conflict(uuid, uuid, text) to service_role;
