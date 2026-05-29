-- 211_block_duplicate_asbuilt_measurement_project.sql
-- Bloqueia Medicao Asbuilt duplicada para projeto ja lancado no mesmo tenant.

create or replace function public.enforce_active_project_for_asbuilt_measurement_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_active boolean;
begin
  if new.tenant_id is null or new.project_id is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext(format(
    'asbuilt-project|%s|%s',
    new.tenant_id::text,
    new.project_id::text
  ))::bigint);

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

  if exists (
    select 1
    from public.project_asbuilt_measurement_orders amo
    where amo.tenant_id = new.tenant_id
      and amo.project_id = new.project_id
      and amo.status <> 'CANCELADA'
      and amo.id <> new.id
  ) then
    raise exception 'Projeto ja possui Medicao Asbuilt lancada.'
      using errcode = '23505';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_active_project_for_asbuilt_measurement_order
  on public.project_asbuilt_measurement_orders;

create trigger trg_enforce_active_project_for_asbuilt_measurement_order
before insert or update of project_id, status on public.project_asbuilt_measurement_orders
for each row
execute function public.enforce_active_project_for_asbuilt_measurement_order();

revoke all on function public.enforce_active_project_for_asbuilt_measurement_order() from public;
revoke all on function public.enforce_active_project_for_asbuilt_measurement_order() from anon;
revoke all on function public.enforce_active_project_for_asbuilt_measurement_order() from authenticated;
grant execute on function public.enforce_active_project_for_asbuilt_measurement_order() to service_role;

do $$
declare
  v_signature regprocedure := 'public.save_project_asbuilt_measurement_order(uuid, uuid, uuid, uuid, text, uuid, text, jsonb, timestamptz)'::regprocedure;
  v_definition text;
  v_original text;
begin
  select pg_get_functiondef(v_signature::oid)
  into v_definition;

  v_original := v_definition;

  if position('PROJECT_ASBUILT_MEASUREMENT_ALREADY_EXISTS' in v_definition) = 0 then
    v_definition := replace(
      v_definition,
      $block$  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROJECT_NOT_FOUND', 'message', 'Projeto nao encontrado.');
  end if;

  if v_asbuilt_kind = 'SEM_PRODUCAO' then$block$,
      $block$  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROJECT_NOT_FOUND', 'message', 'Projeto nao encontrado.');
  end if;

  perform pg_advisory_xact_lock(hashtext(format('asbuilt-project|%s|%s', p_tenant_id::text, p_project_id::text))::bigint);

  if exists (
    select 1
    from public.project_asbuilt_measurement_orders amo
    where amo.tenant_id = p_tenant_id
      and amo.project_id = p_project_id
      and amo.status <> 'CANCELADA'
      and (
        p_asbuilt_measurement_order_id is null
        or amo.id <> p_asbuilt_measurement_order_id
      )
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'PROJECT_ASBUILT_MEASUREMENT_ALREADY_EXISTS',
      'message', 'Projeto ja possui Medicao Asbuilt lancada.'
    );
  end if;

  if v_asbuilt_kind = 'SEM_PRODUCAO' then$block$
    );

    if v_definition = v_original then
      raise exception 'Nao foi possivel aplicar o bloqueio de projeto ja lancado na RPC de Medicao Asbuilt.';
    end if;

    execute v_definition;
  end if;
end;
$$;
