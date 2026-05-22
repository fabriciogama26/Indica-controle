-- 193_allow_direct_purchase_stock_entry.sql
-- Permite registrar Entrada de estoque como compra direta sem vinculo obrigatorio com projeto.

alter table if exists public.stock_transfers
  add column if not exists direct_purchase boolean not null default false;

alter table if exists public.stock_transfers
  alter column project_id drop not null;

do $$
declare
  v_signature regprocedure := 'public.save_stock_transfer_record_base_v181(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb)'::regprocedure;
  v_definition text;
  v_original text;
begin
  select pg_get_functiondef(v_signature::oid)
  into v_definition;

  v_original := v_definition;

  v_definition := replace(
    v_definition,
    $block$  if p_project_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'PROJECT_REQUIRED',
      'message', 'project_id e obrigatorio.'
    );
  end if;$block$,
    $block$  if p_project_id is null and coalesce(current_setting('app.stock_transfer_direct_purchase', true)::boolean, false) is not true then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'PROJECT_REQUIRED',
      'message', 'project_id e obrigatorio.'
    );
  end if;$block$
  );

  v_definition := replace(
    v_definition,
    $block$  perform 1
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
  end if;$block$,
    $block$  if p_project_id is not null then
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
  end if;$block$
  );

  v_definition := replace(
    v_definition,
    $block$    project_id,
    entry_date,$block$,
    $block$    project_id,
    direct_purchase,
    entry_date,$block$
  );

  v_definition := replace(
    v_definition,
    $block$    p_project_id,
    p_entry_date,$block$,
    $block$    p_project_id,
    coalesce(current_setting('app.stock_transfer_direct_purchase', true)::boolean, false),
    p_entry_date,$block$
  );

  if v_definition = v_original then
    raise exception 'Nao foi possivel atualizar save_stock_transfer_record_base_v181 para compra direta.';
  end if;

  execute v_definition;
end;
$$;

do $$
declare
  v_signature regprocedure;
  v_definition text;
  v_original text;
begin
  foreach v_signature in array array[
    'public.reverse_stock_transfer_item_record_v1(uuid, uuid, uuid, text, text, date)'::regprocedure,
    'public.reverse_stock_transfer_record_v2(uuid, uuid, uuid, text, text, date)'::regprocedure
  ]
  loop
    select pg_get_functiondef(v_signature::oid)
    into v_definition;

    v_original := v_definition;

    v_definition := replace(
      v_definition,
      $block$    transfer.project_id,
    transfer.entry_type$block$,
      $block$    transfer.project_id,
    coalesce(transfer.direct_purchase, false) as direct_purchase,
    transfer.entry_type$block$
    );

    v_definition := replace(
      v_definition,
      $block$    p_items => v_reversal_items
  );$block$,
      $block$    p_items => v_reversal_items,
    p_direct_purchase => coalesce(v_original.direct_purchase, false)
  );$block$
    );

    if v_definition = v_original then
      raise exception 'Nao foi possivel atualizar % para compra direta.', v_signature::text;
    end if;

    execute v_definition;
  end loop;
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
  p_items jsonb default '[]'::jsonb,
  p_direct_purchase boolean default false
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
  v_direct_purchase boolean := coalesce(p_direct_purchase, false)
    or (
      p_project_id is null
      and nullif(btrim(coalesce(p_notes, '')), '') ilike 'ESTORNO%'
    );
begin
  if v_direct_purchase and v_movement_type <> 'ENTRY' and nullif(btrim(coalesce(p_notes, '')), '') not ilike 'ESTORNO%' then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'DIRECT_PURCHASE_ENTRY_ONLY',
      'message', 'Compra direta e permitida somente para operacao Entrada.'
    );
  end if;

  perform set_config('app.stock_transfer_direct_purchase', case when v_direct_purchase then 'true' else 'false' end, true);

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

  begin
    v_transfer_id := nullif(v_base_result ->> 'transfer_id', '')::uuid;
  exception
    when others then
      v_transfer_id := null;
  end;

  if v_transfer_id is null then
    return v_base_result;
  end if;

  if coalesce(v_to_controls_balance, false) then
    update public.stock_center_balances balance
    set
      quantity = greatest(balance.quantity - movement.total_quantity, 0),
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

  update public.trafo_instances ti
  set
    retired_at = null,
    retired_by = null,
    retired_reason = null,
    last_transfer_id = v_transfer_id,
    updated_by = p_actor_user_id
  from tmp_retired_serial_transfer_items item
  where ti.tenant_id = p_tenant_id
    and ti.material_id = item.material_id
    and ti.serial_number = item.serial_number
    and ti.lot_code = item.lot_code;

  insert into public.material_history (
    tenant_id,
    material_id,
    action,
    changes,
    created_by
  )
  select
    p_tenant_id,
    item.material_id,
    'UPDATE',
    jsonb_build_object(
      '_context', 'SERIAL_RETIREMENT_REACTIVATED_BY_STOCK_TRANSFER',
      'stockTransferId', v_transfer_id::text,
      'serialNumber', item.serial_number,
      'lotCode', item.lot_code,
      'retiredAt', jsonb_build_object('from', 'RET', 'to', null)
    ),
    p_actor_user_id
  from tmp_retired_serial_transfer_items item;

  return v_base_result;
end;
$$;

revoke all on function public.save_stock_transfer_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb, boolean) from public;
grant execute on function public.save_stock_transfer_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb, boolean) to authenticated;
grant execute on function public.save_stock_transfer_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb, boolean) to service_role;

create index if not exists idx_stock_transfers_tenant_direct_purchase
  on public.stock_transfers (tenant_id, direct_purchase, entry_date desc, created_at desc);
