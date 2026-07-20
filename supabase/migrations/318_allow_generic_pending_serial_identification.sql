-- 318_allow_generic_pending_serial_identification.sql
-- Permite que a identificacao de CHAVE/RELIGADOR em Operacoes de Equipe
-- consuma pendencia geral do centro quando nao existir pendencia especifica do projeto.

create or replace function public.identify_pending_serial_tracked_unit(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_material_id uuid,
  p_stock_center_id uuid,
  p_project_id uuid,
  p_entry_type text,
  p_serial_number text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry_type text := upper(btrim(coalesce(p_entry_type, '')));
  v_serial_number text := nullif(btrim(coalesce(p_serial_number, '')), '');
  v_tracking_type text;
  v_material_code text;
  v_allow_pending_serial boolean := false;
  v_instance public.trafo_instances%rowtype;
  v_pending_project_id uuid;
begin
  if p_tenant_id is null or p_actor_user_id is null or p_material_id is null or p_stock_center_id is null or v_serial_number is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'PENDING_SERIAL_REQUIRED_FIELDS',
      'message', 'Material, centro, tipo e serial sao obrigatorios para identificar a pendencia.'
    );
  end if;

  if v_entry_type not in ('NOVO', 'SUCATA') then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'PENDING_SERIAL_INVALID_ENTRY_TYPE',
      'message', 'Tipo do material deve ser NOVO ou SUCATA.'
    );
  end if;

  select
    case
      when coalesce(m.serial_tracking_type, '') <> '' then m.serial_tracking_type
      when coalesce(m.is_transformer, false) then 'TRAFO'
      else 'NONE'
    end,
    m.codigo,
    coalesce(m.allow_pending_serial_identification, false)
  into v_tracking_type, v_material_code, v_allow_pending_serial
  from public.materials m
  where m.id = p_material_id
    and m.tenant_id = p_tenant_id
    and m.is_active = true;

  if not found or v_tracking_type = 'NONE' then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'MATERIAL_NOT_SERIAL_TRACKED',
      'message', 'Material rastreavel por serial nao encontrado ou inativo.'
    );
  end if;

  if v_tracking_type = 'TRAFO' or v_allow_pending_serial is not true then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'PENDING_SERIAL_NOT_ALLOWED',
      'message', 'Este material exige serial na entrada e nao aceita pendencia de identificacao.'
    );
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_tenant_id::text),
    hashtext(p_material_id::text || '|' || v_serial_number || '|-')
  );

  select *
  into v_instance
  from public.trafo_instances
  where tenant_id = p_tenant_id
    and material_id = p_material_id
    and serial_number = v_serial_number
    and lot_code = '-'
  for update;

  if found and v_instance.current_stock_center_id is not null then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'SERIAL_TRACKED_UNIT_ALREADY_IN_STOCK',
      'message', 'A unidade por serial informada ja esta registrada em estoque proprio ou vinculada a outra operacao.'
    );
  end if;

  select sp.project_id
  into v_pending_project_id
  from public.stock_serial_pending_balances sp
  where sp.tenant_id = p_tenant_id
    and sp.material_id = p_material_id
    and sp.stock_center_id = p_stock_center_id
    and sp.entry_type = v_entry_type
    and sp.quantity > 0
    and (
      sp.project_id is not distinct from p_project_id
      or (p_project_id is not null and sp.project_id is null)
    )
  order by
    case when sp.project_id is not distinct from p_project_id then 0 else 1 end,
    sp.updated_at asc
  limit 1;

  perform public.adjust_stock_serial_pending_balance(
    p_tenant_id,
    p_actor_user_id,
    p_material_id,
    p_stock_center_id,
    case when found then v_pending_project_id else p_project_id end,
    v_entry_type,
    -1
  );

  insert into public.trafo_instances (
    tenant_id,
    material_id,
    serial_number,
    lot_code,
    current_stock_center_id,
    last_stock_transfer_id,
    last_project_id,
    last_movement_type,
    last_entry_date,
    created_by,
    updated_by
  ) values (
    p_tenant_id,
    p_material_id,
    v_serial_number,
    '-',
    p_stock_center_id,
    null,
    p_project_id,
    'ENTRY',
    current_date,
    p_actor_user_id,
    p_actor_user_id
  )
  on conflict (tenant_id, material_id, serial_number, lot_code) do update
  set
    current_stock_center_id = excluded.current_stock_center_id,
    last_project_id = excluded.last_project_id,
    last_movement_type = excluded.last_movement_type,
    last_entry_date = excluded.last_entry_date,
    updated_by = excluded.updated_by,
    updated_at = now();

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'message', 'Serial identificado com sucesso.',
    'materialCode', v_material_code,
    'serialNumber', v_serial_number,
    'pendingProjectId', v_pending_project_id
  );
exception
  when others then
    if upper(sqlerrm) like '%PENDING_SERIAL_INSUFFICIENT_BALANCE%' then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'PENDING_SERIAL_INSUFFICIENT_BALANCE',
        'message', 'Nao existe quantidade pendente suficiente para identificar este serial.'
      );
    end if;
    raise;
end;
$$;

revoke all on function public.identify_pending_serial_tracked_unit(uuid, uuid, uuid, uuid, uuid, text, text) from public;
revoke all on function public.identify_pending_serial_tracked_unit(uuid, uuid, uuid, uuid, uuid, text, text) from anon;
revoke all on function public.identify_pending_serial_tracked_unit(uuid, uuid, uuid, uuid, uuid, text, text) from authenticated;
grant execute on function public.identify_pending_serial_tracked_unit(uuid, uuid, uuid, uuid, uuid, text, text) to service_role;
