-- 129_add_stock_movement_types_and_center_roles.sql
-- Adds stock center roles (own/third-party), movement type and movement-specific stock rules.

alter table if exists public.stock_centers
  add column if not exists center_type text not null default 'OWN',
  add column if not exists controls_balance boolean not null default true;

update public.stock_centers
set center_type = upper(
  regexp_replace(
    btrim(coalesce(center_type, '')),
    '[^A-Za-z0-9]+',
    '_',
    'g'
  )
);

update public.stock_centers
set center_type = case
  when center_type in ('OWN', 'PROPRIO', 'PROPRIA', 'PROPRIO_ESTOQUE', 'ESTOQUE_PROPRIO') then 'OWN'
  when center_type in ('THIRD_PARTY', 'THIRD', 'TERCEIRO', 'TERCEIROS', 'ESTOQUE_TERCEIRO') then 'THIRD_PARTY'
  when nullif(center_type, '') is null then 'OWN'
  else center_type
end;

update public.stock_centers
set center_type = case when coalesce(controls_balance, true) = true then 'OWN' else 'THIRD_PARTY' end
where center_type not in ('OWN', 'THIRD_PARTY');

update public.stock_centers
set controls_balance = case when center_type = 'OWN' then true else false end;

alter table if exists public.stock_centers
  drop constraint if exists stock_centers_center_type_check;

alter table if exists public.stock_centers
  add constraint stock_centers_center_type_check
  check (center_type in ('OWN', 'THIRD_PARTY'));

alter table if exists public.stock_centers
  drop constraint if exists stock_centers_controls_balance_consistency_check;

alter table if exists public.stock_centers
  add constraint stock_centers_controls_balance_consistency_check
  check (
    (center_type = 'OWN' and controls_balance = true)
    or (center_type = 'THIRD_PARTY' and controls_balance = false)
  );

create index if not exists idx_stock_centers_tenant_type_active_name
  on public.stock_centers (tenant_id, center_type, is_active, name);

alter table if exists public.stock_transfers
  add column if not exists movement_type text not null default 'TRANSFER';

update public.stock_transfers
set movement_type = 'TRANSFER'
where nullif(btrim(coalesce(movement_type, '')), '') is null;

update public.stock_transfers
set movement_type = upper(btrim(movement_type))
where movement_type is not null;

alter table if exists public.stock_transfers
  drop constraint if exists stock_transfers_movement_type_check;

alter table if exists public.stock_transfers
  add constraint stock_transfers_movement_type_check
  check (movement_type in ('ENTRY', 'EXIT', 'TRANSFER'));

alter table if exists public.stock_transfers
  drop constraint if exists stock_transfers_entry_date_not_future_check;

alter table if exists public.stock_transfers
  add constraint stock_transfers_entry_date_not_future_check
  check (entry_date <= current_date);

create index if not exists idx_stock_transfers_tenant_movement_type_date
  on public.stock_transfers (tenant_id, movement_type, entry_date desc, created_at desc);

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

  if jsonb_array_length(v_validation_details) > 0 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'VALIDATION_ERROR',
      'message', 'Payload de itens da movimentacao invalido.',
      'details', v_validation_details
    );
  end if;

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

create or replace function public.validate_stock_transfer_movement_rule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from_center_type text;
  v_to_center_type text;
begin
  new.movement_type := upper(btrim(coalesce(new.movement_type, '')));

  if new.movement_type not in ('ENTRY', 'EXIT', 'TRANSFER') then
    raise exception 'movement_type deve ser ENTRY, EXIT ou TRANSFER.'
      using errcode = '23514';
  end if;

  select center_type
  into v_from_center_type
  from public.stock_centers
  where id = new.from_stock_center_id
    and tenant_id = new.tenant_id;

  if not found then
    raise exception 'from_stock_center_id invalido para este tenant.'
      using errcode = '23514';
  end if;

  select center_type
  into v_to_center_type
  from public.stock_centers
  where id = new.to_stock_center_id
    and tenant_id = new.tenant_id;

  if not found then
    raise exception 'to_stock_center_id invalido para este tenant.'
      using errcode = '23514';
  end if;

  if (
    (new.movement_type = 'ENTRY' and not (v_from_center_type = 'THIRD_PARTY' and v_to_center_type = 'OWN'))
    or (new.movement_type = 'EXIT' and not (v_from_center_type = 'OWN' and v_to_center_type = 'THIRD_PARTY'))
    or (new.movement_type = 'TRANSFER' and not (v_from_center_type = 'OWN' and v_to_center_type = 'OWN'))
  ) then
    raise exception 'Combinacao de origem/destino invalida para movement_type.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_stock_transfers_validate_movement_rule on public.stock_transfers;
create trigger trg_stock_transfers_validate_movement_rule
before insert or update on public.stock_transfers
for each row execute function public.validate_stock_transfer_movement_rule();

create or replace function public.save_stock_transfer_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
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
begin
  return public.save_stock_transfer_record(
    p_tenant_id => p_tenant_id,
    p_actor_user_id => p_actor_user_id,
    p_movement_type => 'TRANSFER',
    p_from_stock_center_id => p_from_stock_center_id,
    p_to_stock_center_id => p_to_stock_center_id,
    p_project_id => p_project_id,
    p_entry_date => p_entry_date,
    p_entry_type => p_entry_type,
    p_notes => p_notes,
    p_items => p_items
  );
end;
$$;
