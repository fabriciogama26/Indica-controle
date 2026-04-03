-- 136_enforce_transformer_unit_rules_on_stock_transfer.sql
-- Endurece a movimentacao de TRAFO com quantidade unitaria e validacao por material + serial + LP no centro de origem.

create index if not exists idx_stock_transfer_items_tenant_material_serial_lot
  on public.stock_transfer_items (tenant_id, material_id, serial_number, lot_code, created_at desc);

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
  v_entry_type text := upper(btrim(coalesce(p_entry_type, '')));
  v_transfer_id uuid;
  v_item jsonb;
  v_material_id uuid;
  v_material_code text;
  v_material_description text;
  v_is_transformer boolean;
  v_quantity numeric;
  v_serial_number text;
  v_lot_code text;
  v_validation_details jsonb := '[]'::jsonb;
  v_stock_details jsonb := '[]'::jsonb;
  v_available numeric;
  v_from_center_type text;
  v_to_center_type text;
  v_from_controls_balance boolean;
  v_to_controls_balance boolean;
  v_transformer_internal_balance numeric;
  v_transformer_from_balance numeric;
  rec record;
begin
  if v_movement_type not in ('ENTRY', 'EXIT', 'TRANSFER') then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_MOVEMENT_TYPE',
      'message', 'movement_type deve ser ENTRY, EXIT ou TRANSFER.'
    );
  end if;

  if p_from_stock_center_id is null or p_to_stock_center_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'STOCK_CENTER_REQUIRED',
      'message', 'from_stock_center_id e to_stock_center_id sao obrigatorios.'
    );
  end if;

  if p_from_stock_center_id = p_to_stock_center_id then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'DUPLICATE_STOCK_CENTER',
      'message', 'Centro DE e Centro PARA devem ser diferentes.'
    );
  end if;

  if p_project_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'PROJECT_REQUIRED',
      'message', 'project_id e obrigatorio.'
    );
  end if;

  if p_entry_date is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'ENTRY_DATE_REQUIRED',
      'message', 'entry_date e obrigatorio.'
    );
  end if;

  if p_entry_date > current_date then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'ENTRY_DATE_IN_FUTURE',
      'message', 'Data da movimentacao nao pode ser futura.'
    );
  end if;

  if v_entry_type not in ('SUCATA', 'NOVO') then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_ENTRY_TYPE',
      'message', 'entry_type deve ser SUCATA ou NOVO.'
    );
  end if;

  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'ITEMS_REQUIRED',
      'message', 'Ao menos um item da movimentacao e obrigatorio.'
    );
  end if;

  select center_type, controls_balance
  into v_from_center_type, v_from_controls_balance
  from public.stock_centers
  where id = p_from_stock_center_id
    and tenant_id = p_tenant_id
    and is_active = true;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'FROM_STOCK_CENTER_NOT_FOUND',
      'message', 'Centro DE nao encontrado ou inativo para este tenant.'
    );
  end if;

  select center_type, controls_balance
  into v_to_center_type, v_to_controls_balance
  from public.stock_centers
  where id = p_to_stock_center_id
    and tenant_id = p_tenant_id
    and is_active = true;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'TO_STOCK_CENTER_NOT_FOUND',
      'message', 'Centro PARA nao encontrado ou inativo para este tenant.'
    );
  end if;

  if (
    (v_movement_type = 'ENTRY' and not (v_from_center_type = 'THIRD_PARTY' and v_to_center_type = 'OWN'))
    or (v_movement_type = 'EXIT' and not (v_from_center_type = 'OWN' and v_to_center_type = 'THIRD_PARTY'))
    or (v_movement_type = 'TRANSFER' and not (v_from_center_type = 'OWN' and v_to_center_type = 'OWN'))
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_MOVEMENT_RULE',
      'message', 'Combinacao de origem e destino invalida para o movement_type.'
    );
  end if;

  perform 1
  from public.project
  where id = p_project_id
    and tenant_id = p_tenant_id
    and is_active = true;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'PROJECT_NOT_FOUND',
      'message', 'Projeto nao encontrado ou inativo para este tenant.'
    );
  end if;

  create temporary table tmp_stock_transfer_items (
    material_id uuid not null,
    material_code text not null,
    material_description text not null,
    quantity numeric not null,
    serial_number text,
    lot_code text,
    is_transformer boolean not null
  ) on commit drop;

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

    if v_material_id is null then
      v_validation_details := v_validation_details || jsonb_build_array(
        jsonb_build_object('reason', 'INVALID_MATERIAL', 'item', v_item)
      );
      continue;
    end if;

    if v_quantity is null or v_quantity <= 0 then
      v_validation_details := v_validation_details || jsonb_build_array(
        jsonb_build_object('reason', 'INVALID_QUANTITY', 'materialId', v_material_id::text, 'quantity', v_item ->> 'quantity')
      );
      continue;
    end if;

    select codigo, descricao, coalesce(is_transformer, false)
    into v_material_code, v_material_description, v_is_transformer
    from public.materials
    where id = v_material_id
      and tenant_id = p_tenant_id
      and is_active = true;

    if not found then
      v_validation_details := v_validation_details || jsonb_build_array(
        jsonb_build_object('reason', 'MATERIAL_NOT_FOUND', 'materialId', v_material_id::text)
      );
      continue;
    end if;

    if v_is_transformer and v_quantity <> 1 then
      v_validation_details := v_validation_details || jsonb_build_array(
        jsonb_build_object(
          'reason', 'TRANSFORMER_QUANTITY_MUST_BE_ONE',
          'materialId', v_material_id::text,
          'materialCode', v_material_code,
          'quantity', v_quantity
        )
      );
      continue;
    end if;

    if v_is_transformer and (v_serial_number is null or v_lot_code is null) then
      v_validation_details := v_validation_details || jsonb_build_array(
        jsonb_build_object(
          'reason', 'TRANSFORMER_SERIAL_OR_LOT_REQUIRED',
          'materialId', v_material_id::text,
          'materialCode', v_material_code
        )
      );
      continue;
    end if;

    insert into tmp_stock_transfer_items (
      material_id,
      material_code,
      material_description,
      quantity,
      serial_number,
      lot_code,
      is_transformer
    ) values (
      v_material_id,
      v_material_code,
      v_material_description,
      v_quantity,
      v_serial_number,
      v_lot_code,
      v_is_transformer
    );
  end loop;

  for rec in
    select material_id, material_code, serial_number, lot_code, count(*) as duplicate_count
    from tmp_stock_transfer_items
    where is_transformer
    group by material_id, material_code, serial_number, lot_code
    having count(*) > 1
  loop
    v_validation_details := v_validation_details || jsonb_build_array(
      jsonb_build_object(
        'reason', 'DUPLICATE_TRANSFORMER_UNIT_IN_PAYLOAD',
        'materialId', rec.material_id::text,
        'materialCode', rec.material_code,
        'serialNumber', rec.serial_number,
        'lotCode', rec.lot_code,
        'duplicateCount', rec.duplicate_count
      )
    );
  end loop;

  if jsonb_array_length(v_validation_details) > 0 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'VALIDATION_ERROR',
      'message', 'Payload de itens da movimentacao invalido.',
      'details', v_validation_details
    );
  end if;

  for rec in
    select material_id, material_code, quantity, serial_number, lot_code
    from tmp_stock_transfer_items
    where is_transformer
    order by material_id, serial_number, lot_code
  loop
    perform pg_advisory_xact_lock(
      hashtext(p_tenant_id::text),
      hashtext(rec.material_id::text || '|' || coalesce(rec.serial_number, '') || '|' || coalesce(rec.lot_code, ''))
    );

    select coalesce(sum(
      (case when to_center.controls_balance then item.quantity else 0 end)
      - (case when from_center.controls_balance then item.quantity else 0 end)
    ), 0)
    into v_transformer_internal_balance
    from public.stock_transfer_items item
    join public.stock_transfers transfer
      on transfer.id = item.stock_transfer_id
     and transfer.tenant_id = p_tenant_id
    join public.stock_centers from_center
      on from_center.id = transfer.from_stock_center_id
     and from_center.tenant_id = p_tenant_id
    join public.stock_centers to_center
      on to_center.id = transfer.to_stock_center_id
     and to_center.tenant_id = p_tenant_id
    where item.tenant_id = p_tenant_id
      and item.material_id = rec.material_id
      and coalesce(item.serial_number, '') = coalesce(rec.serial_number, '')
      and coalesce(item.lot_code, '') = coalesce(rec.lot_code, '');

    if v_transformer_internal_balance < 0 or v_transformer_internal_balance > 1 then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'TRANSFORMER_UNIT_BALANCE_INCONSISTENT',
        'message', 'A unidade de TRAFO informada esta com saldo inconsistente.',
        'details', jsonb_build_array(
          jsonb_build_object(
            'materialId', rec.material_id::text,
            'materialCode', rec.material_code,
            'serialNumber', rec.serial_number,
            'lotCode', rec.lot_code,
            'currentOwnQuantity', v_transformer_internal_balance
          )
        )
      );
    end if;

    if v_movement_type = 'ENTRY' and v_transformer_internal_balance > 0 then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'TRANSFORMER_UNIT_ALREADY_IN_OWN_STOCK',
        'message', 'A unidade de TRAFO informada ja esta registrada em um centro OWN.',
        'details', jsonb_build_array(
          jsonb_build_object(
            'materialId', rec.material_id::text,
            'materialCode', rec.material_code,
            'serialNumber', rec.serial_number,
            'lotCode', rec.lot_code,
            'currentOwnQuantity', v_transformer_internal_balance
          )
        )
      );
    end if;

    if v_movement_type in ('EXIT', 'TRANSFER') then
      select coalesce(sum(
        (case when transfer.to_stock_center_id = p_from_stock_center_id and to_center.controls_balance then item.quantity else 0 end)
        - (case when transfer.from_stock_center_id = p_from_stock_center_id and from_center.controls_balance then item.quantity else 0 end)
      ), 0)
      into v_transformer_from_balance
      from public.stock_transfer_items item
      join public.stock_transfers transfer
        on transfer.id = item.stock_transfer_id
       and transfer.tenant_id = p_tenant_id
      join public.stock_centers from_center
        on from_center.id = transfer.from_stock_center_id
       and from_center.tenant_id = p_tenant_id
      join public.stock_centers to_center
        on to_center.id = transfer.to_stock_center_id
       and to_center.tenant_id = p_tenant_id
      where item.tenant_id = p_tenant_id
        and item.material_id = rec.material_id
        and coalesce(item.serial_number, '') = coalesce(rec.serial_number, '')
        and coalesce(item.lot_code, '') = coalesce(rec.lot_code, '');

      if v_transformer_from_balance <> 1 then
        return jsonb_build_object(
          'success', false,
          'status', 409,
          'reason', 'TRANSFORMER_UNIT_NOT_IN_FROM_CENTER',
          'message', 'A unidade de TRAFO informada nao esta disponivel no centro DE com o Serial e LP informados.',
          'details', jsonb_build_array(
            jsonb_build_object(
              'materialId', rec.material_id::text,
              'materialCode', rec.material_code,
              'serialNumber', rec.serial_number,
              'lotCode', rec.lot_code,
              'fromStockCenterId', p_from_stock_center_id::text,
              'currentFromQuantity', v_transformer_from_balance
            )
          )
        );
      end if;
    end if;
  end loop;

  if coalesce(v_from_controls_balance, false) then
    for rec in
      select material_id, material_code, sum(quantity) as requested_quantity
      from tmp_stock_transfer_items
      group by material_id, material_code
      order by material_id
    loop
      insert into public.stock_center_balances (
        tenant_id,
        stock_center_id,
        material_id,
        quantity,
        created_by,
        updated_by
      ) values (
        p_tenant_id,
        p_from_stock_center_id,
        rec.material_id,
        0,
        p_actor_user_id,
        p_actor_user_id
      )
      on conflict (tenant_id, stock_center_id, material_id) do nothing;

      perform 1
      from public.stock_center_balances
      where tenant_id = p_tenant_id
        and stock_center_id = p_from_stock_center_id
        and material_id = rec.material_id
      for update;

      select quantity
      into v_available
      from public.stock_center_balances
      where tenant_id = p_tenant_id
        and stock_center_id = p_from_stock_center_id
        and material_id = rec.material_id;

      if coalesce(v_available, 0) < rec.requested_quantity then
        v_stock_details := v_stock_details || jsonb_build_array(
          jsonb_build_object(
            'materialId', rec.material_id::text,
            'materialCode', rec.material_code,
            'availableQuantity', coalesce(v_available, 0),
            'requestedQuantity', rec.requested_quantity
          )
        );
      end if;
    end loop;
  end if;

  if jsonb_array_length(v_stock_details) > 0 then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'INSUFFICIENT_STOCK',
      'message', 'Saldo insuficiente no centro DE.',
      'details', v_stock_details
    );
  end if;

  insert into public.stock_transfers (
    tenant_id,
    movement_type,
    from_stock_center_id,
    to_stock_center_id,
    project_id,
    entry_date,
    entry_type,
    notes,
    created_by,
    updated_by
  ) values (
    p_tenant_id,
    v_movement_type,
    p_from_stock_center_id,
    p_to_stock_center_id,
    p_project_id,
    p_entry_date,
    v_entry_type,
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_actor_user_id,
    p_actor_user_id
  )
  returning id into v_transfer_id;

  insert into public.stock_transfer_items (
    tenant_id,
    stock_transfer_id,
    material_id,
    quantity,
    serial_number,
    lot_code,
    created_by,
    updated_by
  )
  select
    p_tenant_id,
    v_transfer_id,
    material_id,
    quantity,
    serial_number,
    lot_code,
    p_actor_user_id,
    p_actor_user_id
  from tmp_stock_transfer_items;

  if coalesce(v_to_controls_balance, false) then
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
      p_to_stock_center_id,
      material_id,
      0,
      p_actor_user_id,
      p_actor_user_id
    from (
      select distinct material_id
      from tmp_stock_transfer_items
    ) distinct_items
    on conflict (tenant_id, stock_center_id, material_id) do nothing;
  end if;

  if coalesce(v_from_controls_balance, false) then
    update public.stock_center_balances balance
    set
      quantity = balance.quantity - movement.total_quantity,
      updated_by = p_actor_user_id
    from (
      select material_id, sum(quantity) as total_quantity
      from tmp_stock_transfer_items
      group by material_id
    ) movement
    where balance.tenant_id = p_tenant_id
      and balance.stock_center_id = p_from_stock_center_id
      and balance.material_id = movement.material_id;
  end if;

  if coalesce(v_to_controls_balance, false) then
    update public.stock_center_balances balance
    set
      quantity = balance.quantity + movement.total_quantity,
      updated_by = p_actor_user_id
    from (
      select material_id, sum(quantity) as total_quantity
      from tmp_stock_transfer_items
      group by material_id
    ) movement
    where balance.tenant_id = p_tenant_id
      and balance.stock_center_id = p_to_stock_center_id
      and balance.material_id = movement.material_id;
  end if;

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
      '_context', 'STOCK_TRANSFER',
      'stockTransferId', v_transfer_id::text,
      'movementType', jsonb_build_object('from', null, 'to', v_movement_type),
      'fromStockCenterId', jsonb_build_object('from', null, 'to', p_from_stock_center_id::text),
      'toStockCenterId', jsonb_build_object('from', null, 'to', p_to_stock_center_id::text),
      'projectId', jsonb_build_object('from', null, 'to', p_project_id::text),
      'entryDate', jsonb_build_object('from', null, 'to', p_entry_date::text),
      'entryType', jsonb_build_object('from', null, 'to', v_entry_type),
      'quantity', jsonb_build_object('from', null, 'to', item.quantity::text),
      'serialNumber', jsonb_build_object('from', null, 'to', item.serial_number),
      'lotCode', jsonb_build_object('from', null, 'to', item.lot_code)
    ),
    p_actor_user_id,
    p_actor_user_id
  from tmp_stock_transfer_items item;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'transfer_id', v_transfer_id,
    'message', 'Movimentacao de estoque salva com sucesso.'
  );
end;
$$;
