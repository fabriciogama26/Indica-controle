-- 181_create_serial_retirement_flow.sql
-- Registra RET de unidade rastreavel por serial: baixa saldo disponivel e mantem presenca fisica no rastreio.

alter table if exists public.trafo_instances
  add column if not exists retired_at timestamptz,
  add column if not exists retired_by uuid references public.app_users(id),
  add column if not exists retired_reason text,
  add column if not exists retired_stock_center_id uuid references public.stock_centers(id);

create index if not exists idx_trafo_instances_tenant_retired
  on public.trafo_instances (tenant_id, retired_at, retired_stock_center_id);

create table if not exists public.serial_retirements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  trafo_instance_id uuid not null references public.trafo_instances(id),
  material_id uuid not null references public.materials(id),
  stock_center_id uuid not null references public.stock_centers(id),
  quantity numeric not null default 1,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint serial_retirements_quantity_one check (quantity = 1),
  unique (tenant_id, trafo_instance_id)
);

create index if not exists idx_serial_retirements_tenant_center_material
  on public.serial_retirements (tenant_id, stock_center_id, material_id, created_at desc);

alter table if exists public.serial_retirements enable row level security;

drop policy if exists serial_retirements_tenant_select on public.serial_retirements;
create policy serial_retirements_tenant_select on public.serial_retirements
for select
to authenticated
using (public.user_can_access_tenant(serial_retirements.tenant_id));

drop policy if exists serial_retirements_tenant_insert on public.serial_retirements;
create policy serial_retirements_tenant_insert on public.serial_retirements
for insert
to authenticated
with check (public.user_can_access_tenant(serial_retirements.tenant_id));

drop trigger if exists trg_serial_retirements_audit on public.serial_retirements;
create trigger trg_serial_retirements_audit
before insert or update on public.serial_retirements
for each row execute function public.set_audit_fields();

create or replace function public.retire_serial_tracked_unit(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_trafo_instance_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_instance public.trafo_instances%rowtype;
  v_material record;
  v_stock_center record;
  v_balance numeric;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_retirement_id uuid;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 401,
      'reason', 'INVALID_SESSION',
      'message', 'Sessao invalida para aplicar RET.'
    );
  end if;

  if p_trafo_instance_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'SERIAL_INSTANCE_REQUIRED',
      'message', 'Unidade por serial obrigatoria para aplicar RET.'
    );
  end if;

  select *
  into v_instance
  from public.trafo_instances
  where id = p_trafo_instance_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'SERIAL_INSTANCE_NOT_FOUND',
      'message', 'Unidade por serial nao encontrada para este tenant.'
    );
  end if;

  if v_instance.retired_at is not null then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'SERIAL_INSTANCE_ALREADY_RETIRED',
      'message', 'Esta unidade ja esta marcada como RET.'
    );
  end if;

  if v_instance.current_stock_center_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'SERIAL_INSTANCE_NOT_IN_STOCK',
      'message', 'RET so pode ser aplicado em unidade presente em estoque fisico.'
    );
  end if;

  select
    m.id,
    m.codigo,
    coalesce(nullif(btrim(coalesce(m.serial_tracking_type, '')), ''), case when coalesce(m.is_transformer, false) then 'TRAFO' else 'NONE' end) as serial_tracking_type,
    m.is_active
  into v_material
  from public.materials m
  where m.id = v_instance.material_id
    and m.tenant_id = p_tenant_id;

  if not found or coalesce(v_material.is_active, false) is not true or v_material.serial_tracking_type = 'NONE' then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'MATERIAL_NOT_SERIAL_TRACKED',
      'message', 'Material da unidade nao esta ativo ou nao possui rastreio por serial.'
    );
  end if;

  select
    sc.id,
    sc.name,
    sc.center_type,
    sc.is_active,
    coalesce(sc.controls_balance, true) as controls_balance
  into v_stock_center
  from public.stock_centers sc
  where sc.id = v_instance.current_stock_center_id
    and sc.tenant_id = p_tenant_id;

  if not found
    or coalesce(v_stock_center.is_active, false) is not true
    or coalesce(v_stock_center.center_type, '') <> 'OWN'
    or coalesce(v_stock_center.controls_balance, false) is not true
  then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'INVALID_RET_STOCK_CENTER',
      'message', 'RET exige unidade em centro proprio fisico que controla saldo.'
    );
  end if;

  if exists (
    select 1
    from public.teams t
    where t.tenant_id = p_tenant_id
      and t.stock_center_id = v_instance.current_stock_center_id
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'TEAM_STOCK_CENTER_NOT_ALLOWED',
      'message', 'RET nao pode ser aplicado em centro vinculado a equipe.'
    );
  end if;

  insert into public.stock_center_balances (
    tenant_id,
    stock_center_id,
    material_id,
    quantity,
    created_by,
    updated_by
  ) values (
    p_tenant_id,
    v_instance.current_stock_center_id,
    v_instance.material_id,
    0,
    p_actor_user_id,
    p_actor_user_id
  )
  on conflict (tenant_id, stock_center_id, material_id) do nothing;

  select quantity
  into v_balance
  from public.stock_center_balances
  where tenant_id = p_tenant_id
    and stock_center_id = v_instance.current_stock_center_id
    and material_id = v_instance.material_id
  for update;

  if coalesce(v_balance, 0) < 1 then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'INSUFFICIENT_STOCK',
      'message', 'Saldo disponivel insuficiente para aplicar RET nesta unidade.',
      'details', jsonb_build_object(
        'materialId', v_instance.material_id::text,
        'materialCode', v_material.codigo,
        'availableQuantity', coalesce(v_balance, 0),
        'requestedQuantity', 1
      )
    );
  end if;

  update public.stock_center_balances balance
  set
    quantity = balance.quantity - 1,
    updated_by = p_actor_user_id
  where balance.tenant_id = p_tenant_id
    and balance.stock_center_id = v_instance.current_stock_center_id
    and balance.material_id = v_instance.material_id;

  insert into public.serial_retirements (
    tenant_id,
    trafo_instance_id,
    material_id,
    stock_center_id,
    quantity,
    reason,
    created_by,
    updated_by
  ) values (
    p_tenant_id,
    v_instance.id,
    v_instance.material_id,
    v_instance.current_stock_center_id,
    1,
    coalesce(v_reason, 'RET aplicado no rastreio de serial.'),
    p_actor_user_id,
    p_actor_user_id
  )
  returning id into v_retirement_id;

  update public.trafo_instances
  set
    retired_at = now(),
    retired_by = p_actor_user_id,
    retired_reason = coalesce(v_reason, 'RET aplicado no rastreio de serial.'),
    retired_stock_center_id = v_instance.current_stock_center_id,
    updated_by = p_actor_user_id
  where id = v_instance.id
    and tenant_id = p_tenant_id;

  insert into public.material_history (
    tenant_id,
    material_id,
    change_type,
    changes,
    created_by,
    updated_by
  ) values (
    p_tenant_id,
    v_instance.material_id,
    'UPDATE',
    jsonb_build_object(
      '_context', 'SERIAL_RET',
      'serialRetirementId', v_retirement_id::text,
      'trafoInstanceId', v_instance.id::text,
      'stockCenterId', jsonb_build_object('from', null, 'to', v_instance.current_stock_center_id::text),
      'serialNumber', jsonb_build_object('from', null, 'to', v_instance.serial_number),
      'lotCode', jsonb_build_object('from', null, 'to', v_instance.lot_code),
      'quantity', jsonb_build_object('from', null, 'to', '1'),
      'reason', jsonb_build_object('from', null, 'to', coalesce(v_reason, 'RET aplicado no rastreio de serial.'))
    ),
    p_actor_user_id,
    p_actor_user_id
  );

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'retirement_id', v_retirement_id,
    'message', 'RET aplicado com sucesso. A unidade permanece no rastreio fisico e foi removida do saldo disponivel.'
  );
exception
  when unique_violation then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'SERIAL_INSTANCE_ALREADY_RETIRED',
      'message', 'Esta unidade ja esta marcada como RET.'
    );
end;
$$;

drop trigger if exists trg_stock_transfer_items_prevent_retired_serial on public.stock_transfer_items;
drop function if exists public.prevent_retired_serial_tracked_stock_item();

do $$
begin
  if to_regprocedure('public.save_stock_transfer_record_base_v181(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb)') is null
     and to_regprocedure('public.save_stock_transfer_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb)') is not null then
    alter function public.save_stock_transfer_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb)
      rename to save_stock_transfer_record_base_v181;
  end if;
end;
$$;

create or replace function public.save_stock_transfer_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_movement_type text,
  p_from_stock_center_id uuid,
  p_to_stock_center_id uuid,
  p_project_id uuid,
  p_entry_date date,
  p_entry_type text,
  p_notes text default null,
  p_items jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_movement_type text := upper(btrim(coalesce(p_movement_type, '')));
  v_item jsonb;
  v_material_id uuid;
  v_quantity numeric;
  v_serial_number text;
  v_lot_code text;
  v_tracking_type text;
  v_instance record;
  v_has_retired_items boolean := false;
  v_base_result jsonb;
  v_transfer_id uuid;
  v_from_controls_balance boolean := false;
  v_to_controls_balance boolean := false;
begin
  create temporary table tmp_retired_serial_transfer_items (
    material_id uuid not null,
    quantity numeric not null,
    serial_number text not null,
    lot_code text not null
  ) on commit drop;

  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) = 'array' then
    for v_item in
      select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
    loop
      begin
        v_material_id := nullif(btrim(coalesce(v_item ->> 'materialId', '')), '')::uuid;
      exception
        when others then
          v_material_id := null;
      end;

      begin
        v_quantity := (v_item ->> 'quantity')::numeric;
      exception
        when others then
          v_quantity := null;
      end;

      v_serial_number := nullif(btrim(coalesce(v_item ->> 'serialNumber', '')), '');
      v_lot_code := nullif(btrim(coalesce(v_item ->> 'lotCode', '')), '');

      if v_material_id is null or v_serial_number is null or v_quantity is null or v_quantity <= 0 then
        continue;
      end if;

      select coalesce(nullif(btrim(coalesce(m.serial_tracking_type, '')), ''), case when coalesce(m.is_transformer, false) then 'TRAFO' else 'NONE' end)
      into v_tracking_type
      from public.materials m
      where m.id = v_material_id
        and m.tenant_id = p_tenant_id;

      if not found or v_tracking_type = 'NONE' then
        continue;
      end if;

      if v_tracking_type <> 'TRAFO' then
        v_lot_code := '-';
      end if;

      if v_lot_code is null then
        continue;
      end if;

      select ti.id, ti.current_stock_center_id, ti.retired_at
      into v_instance
      from public.trafo_instances ti
      where ti.tenant_id = p_tenant_id
        and ti.material_id = v_material_id
        and ti.serial_number = v_serial_number
        and ti.lot_code = v_lot_code
      for update;

      if not found or v_instance.retired_at is null then
        continue;
      end if;

      if v_movement_type = 'ENTRY' then
        return jsonb_build_object(
          'success', false,
          'status', 409,
          'reason', 'RETIRED_SERIAL_REENTRY_NOT_ALLOWED',
          'message', 'Unidade RET nao pode retornar como entrada normal. Regularize a unidade antes de reativar saldo.'
        );
      end if;

      if v_movement_type not in ('EXIT', 'TRANSFER')
        or v_instance.current_stock_center_id is distinct from p_from_stock_center_id
      then
        continue;
      end if;

      if exists (
        select 1
        from public.teams t
        where t.tenant_id = p_tenant_id
          and t.stock_center_id in (p_from_stock_center_id, p_to_stock_center_id)
      ) then
        return jsonb_build_object(
          'success', false,
          'status', 422,
          'reason', 'RETIRED_SERIAL_TEAM_OPERATION_NOT_ALLOWED',
          'message', 'Unidade RET nao pode ser requisitada/devolvida por equipe; apenas movimentacao fisica de estoque e permitida.'
        );
      end if;

      insert into tmp_retired_serial_transfer_items (
        material_id,
        quantity,
        serial_number,
        lot_code
      ) values (
        v_material_id,
        v_quantity,
        v_serial_number,
        v_lot_code
      );

      v_has_retired_items := true;
    end loop;
  end if;

  if not v_has_retired_items then
    return public.save_stock_transfer_record_base_v181(
      p_tenant_id,
      p_actor_user_id,
      p_movement_type,
      p_from_stock_center_id,
      p_to_stock_center_id,
      p_project_id,
      p_entry_date,
      p_entry_type,
      p_notes,
      p_items
    );
  end if;

  select coalesce(sc.controls_balance, false)
  into v_from_controls_balance
  from public.stock_centers sc
  where sc.id = p_from_stock_center_id
    and sc.tenant_id = p_tenant_id;

  select coalesce(sc.controls_balance, false)
  into v_to_controls_balance
  from public.stock_centers sc
  where sc.id = p_to_stock_center_id
    and sc.tenant_id = p_tenant_id;

  if coalesce(v_from_controls_balance, false) then
    insert into public.stock_center_balances (
      tenant_id,
      stock_center_id,
      material_id,
      quantity,
      created_by,
      updated_by
    )
    select
      p_tenant_id,
      p_from_stock_center_id,
      item.material_id,
      0,
      p_actor_user_id,
      p_actor_user_id
    from (
      select distinct material_id
      from tmp_retired_serial_transfer_items
    ) item
    on conflict (tenant_id, stock_center_id, material_id) do nothing;

    update public.stock_center_balances balance
    set
      quantity = balance.quantity + movement.total_quantity,
      updated_by = p_actor_user_id
    from (
      select material_id, sum(quantity) as total_quantity
      from tmp_retired_serial_transfer_items
      group by material_id
    ) movement
    where balance.tenant_id = p_tenant_id
      and balance.stock_center_id = p_from_stock_center_id
      and balance.material_id = movement.material_id;
  end if;

  v_base_result := public.save_stock_transfer_record_base_v181(
    p_tenant_id,
    p_actor_user_id,
    p_movement_type,
    p_from_stock_center_id,
    p_to_stock_center_id,
    p_project_id,
    p_entry_date,
    p_entry_type,
    p_notes,
    p_items
  );

  if coalesce((v_base_result ->> 'success')::boolean, false) is not true then
    if coalesce(v_from_controls_balance, false) then
      update public.stock_center_balances balance
      set
        quantity = balance.quantity - movement.total_quantity,
        updated_by = p_actor_user_id
      from (
        select material_id, sum(quantity) as total_quantity
        from tmp_retired_serial_transfer_items
        group by material_id
      ) movement
      where balance.tenant_id = p_tenant_id
        and balance.stock_center_id = p_from_stock_center_id
        and balance.material_id = movement.material_id;
    end if;

    return v_base_result;
  end if;

  if coalesce(v_to_controls_balance, false) then
    update public.stock_center_balances balance
    set
      quantity = balance.quantity - movement.total_quantity,
      updated_by = p_actor_user_id
    from (
      select material_id, sum(quantity) as total_quantity
      from tmp_retired_serial_transfer_items
      group by material_id
    ) movement
    where balance.tenant_id = p_tenant_id
      and balance.stock_center_id = p_to_stock_center_id
      and balance.material_id = movement.material_id;
  end if;

  begin
    v_transfer_id := nullif(v_base_result ->> 'transfer_id', '')::uuid;
  exception
    when others then
      v_transfer_id := null;
  end;

  insert into public.material_history (
    tenant_id,
    material_id,
    change_type,
    changes,
    created_by,
    updated_by
  )
  select
    p_tenant_id,
    item.material_id,
    'UPDATE',
    jsonb_build_object(
      '_context', 'SERIAL_RET_PHYSICAL_TRANSFER',
      'stockTransferId', v_transfer_id::text,
      'movementType', jsonb_build_object('from', null, 'to', v_movement_type),
      'fromStockCenterId', jsonb_build_object('from', null, 'to', p_from_stock_center_id::text),
      'toStockCenterId', jsonb_build_object('from', null, 'to', p_to_stock_center_id::text),
      'quantity', jsonb_build_object('from', null, 'to', item.quantity::text),
      'serialNumber', jsonb_build_object('from', null, 'to', item.serial_number),
      'lotCode', jsonb_build_object('from', null, 'to', item.lot_code),
      'availableBalanceChanged', jsonb_build_object('from', null, 'to', 'false')
    ),
    p_actor_user_id,
    p_actor_user_id
  from tmp_retired_serial_transfer_items item;

  return v_base_result;
exception
  when others then
    return jsonb_build_object(
      'success', false,
      'status', 500,
      'reason', 'RETIRED_SERIAL_TRANSFER_ERROR',
      'message', 'Falha ao movimentar unidade RET sem alterar saldo disponivel.',
      'details', sqlerrm
    );
end;
$$;

revoke all on function public.retire_serial_tracked_unit(uuid, uuid, uuid, text) from public;
grant execute on function public.retire_serial_tracked_unit(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.retire_serial_tracked_unit(uuid, uuid, uuid, text) to service_role;

revoke all on function public.save_stock_transfer_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb) from public;
grant execute on function public.save_stock_transfer_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb) to authenticated;
grant execute on function public.save_stock_transfer_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb) to service_role;
