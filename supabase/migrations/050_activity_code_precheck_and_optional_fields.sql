-- 050_activity_code_precheck_and_optional_fields.sql
-- Torna group/scope opcionais em service_activities e cria RPC para pre-check de codigo duplicado.

alter table if exists public.service_activities
  alter column group_name drop not null,
  alter column scope drop not null;

alter table if exists public.service_activities
  drop constraint if exists chk_service_activities_group_name_not_blank;

alter table if exists public.service_activities
  add constraint chk_service_activities_group_name_not_blank
  check (group_name is null or btrim(group_name) <> '');

alter table if exists public.service_activities
  drop constraint if exists chk_service_activities_scope_not_blank;

alter table if exists public.service_activities
  add constraint chk_service_activities_scope_not_blank
  check (scope is null or btrim(scope) <> '');

create or replace function public.precheck_activity_code_conflict(
  p_tenant_id uuid,
  p_activity_id uuid default null,
  p_code text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_existing_id uuid;
begin
  if p_tenant_id is null then
    return jsonb_build_object(
      'success', false,
      'reason', 'TENANT_REQUIRED'
    );
  end if;

  if v_code = '' then
    return jsonb_build_object(
      'success', false,
      'reason', 'CODE_REQUIRED'
    );
  end if;

  select sa.id
  into v_existing_id
  from public.service_activities sa
  where sa.tenant_id = p_tenant_id
    and upper(btrim(sa.code)) = v_code
    and (p_activity_id is null or sa.id <> p_activity_id)
  limit 1;

  if v_existing_id is not null then
    return jsonb_build_object(
      'success', false,
      'reason', 'CODE_ALREADY_EXISTS',
      'code', v_code,
      'existing_id', v_existing_id
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'code', v_code
  );
end;
$$;

revoke all on function public.precheck_activity_code_conflict(uuid, uuid, text) from public;
grant execute on function public.precheck_activity_code_conflict(uuid, uuid, text) to authenticated;
grant execute on function public.precheck_activity_code_conflict(uuid, uuid, text) to service_role;
