-- 128_create_stock_transfer_module.sql
-- Implements stock transfer between centers with transactional debit/credit and audit trail.

alter table if exists public.materials
  add column if not exists is_transformer boolean not null default false;

create index if not exists idx_materials_tenant_is_transformer
  on public.materials (tenant_id, is_transformer);

create table if not exists public.stock_centers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint stock_centers_name_not_blank check (nullif(btrim(coalesce(name, '')), '') is not null),
  unique (tenant_id, name)
);

create index if not exists idx_stock_centers_tenant_active_name
  on public.stock_centers (tenant_id, is_active, name);

create table if not exists public.stock_center_balances (
  tenant_id uuid not null references public.tenants(id),
  stock_center_id uuid not null references public.stock_centers(id) on delete cascade,
  material_id uuid not null references public.materials(id),
  quantity numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint stock_center_balances_quantity_non_negative check (quantity >= 0),
  primary key (tenant_id, stock_center_id, material_id)
);

create index if not exists idx_stock_center_balances_center_material
  on public.stock_center_balances (tenant_id, stock_center_id, material_id);

create table if not exists public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  from_stock_center_id uuid not null references public.stock_centers(id),
  to_stock_center_id uuid not null references public.stock_centers(id),
  project_id uuid not null references public.project(id),
  entry_date date not null,
  entry_type text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint stock_transfers_entry_type_check check (entry_type in ('SUCATA', 'NOVO')),
  constraint stock_transfers_distinct_centers check (from_stock_center_id <> to_stock_center_id)
);

create index if not exists idx_stock_transfers_tenant_entry_date
  on public.stock_transfers (tenant_id, entry_date desc, created_at desc);

create index if not exists idx_stock_transfers_tenant_project
  on public.stock_transfers (tenant_id, project_id, created_at desc);

create table if not exists public.stock_transfer_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  stock_transfer_id uuid not null references public.stock_transfers(id) on delete cascade,
  material_id uuid not null references public.materials(id),
  quantity numeric not null,
  serial_number text,
  lot_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint stock_transfer_items_quantity_positive check (quantity > 0)
);

create index if not exists idx_stock_transfer_items_transfer_material
  on public.stock_transfer_items (tenant_id, stock_transfer_id, material_id);

do $$
begin
  if to_regclass('public.project_service_centers') is not null then
    insert into public.stock_centers (
      tenant_id,
      name,
      description,
      is_active
    )
    select
      psc.tenant_id,
      psc.name,
      'Seeded from project_service_centers',
      coalesce(psc.ativo, true)
    from public.project_service_centers psc
    where psc.tenant_id is not null
      and nullif(btrim(coalesce(psc.name, '')), '') is not null
    on conflict (tenant_id, name) do update
    set
      is_active = excluded.is_active,
      updated_at = now();
  end if;
end
$$;

with default_stock_center as (
  select
    sc.tenant_id,
    sc.id as stock_center_id,
    row_number() over (partition by sc.tenant_id order by sc.name asc, sc.id asc) as rn
  from public.stock_centers sc
  where sc.is_active = true
),
tenants_without_center_balance as (
  select dsc.tenant_id, dsc.stock_center_id
  from default_stock_center dsc
  where dsc.rn = 1
    and not exists (
      select 1
      from public.stock_center_balances balance
      where balance.tenant_id = dsc.tenant_id
    )
)
insert into public.stock_center_balances (
  tenant_id,
  stock_center_id,
  material_id,
  quantity
)
select
  ib.tenant_id,
  twcb.stock_center_id,
  ib.material_id,
  greatest(ib.qty_on_hand, 0)
from public.inventory_balance ib
join tenants_without_center_balance twcb
  on twcb.tenant_id = ib.tenant_id
where ib.qty_on_hand > 0
on conflict (tenant_id, stock_center_id, material_id) do nothing;

alter table if exists public.stock_centers enable row level security;
alter table if exists public.stock_center_balances enable row level security;
alter table if exists public.stock_transfers enable row level security;
alter table if exists public.stock_transfer_items enable row level security;

drop policy if exists stock_centers_tenant_select on public.stock_centers;
create policy stock_centers_tenant_select on public.stock_centers
for select
to authenticated
using (public.user_can_access_tenant(stock_centers.tenant_id));

drop policy if exists stock_centers_tenant_insert on public.stock_centers;
create policy stock_centers_tenant_insert on public.stock_centers
for insert
to authenticated
with check (public.user_can_access_tenant(stock_centers.tenant_id));

drop policy if exists stock_centers_tenant_update on public.stock_centers;
create policy stock_centers_tenant_update on public.stock_centers
for update
to authenticated
using (public.user_can_access_tenant(stock_centers.tenant_id))
with check (public.user_can_access_tenant(stock_centers.tenant_id));

drop policy if exists stock_center_balances_tenant_select on public.stock_center_balances;
create policy stock_center_balances_tenant_select on public.stock_center_balances
for select
to authenticated
using (public.user_can_access_tenant(stock_center_balances.tenant_id));

drop policy if exists stock_center_balances_tenant_insert on public.stock_center_balances;
create policy stock_center_balances_tenant_insert on public.stock_center_balances
for insert
to authenticated
with check (public.user_can_access_tenant(stock_center_balances.tenant_id));

drop policy if exists stock_center_balances_tenant_update on public.stock_center_balances;
create policy stock_center_balances_tenant_update on public.stock_center_balances
for update
to authenticated
using (public.user_can_access_tenant(stock_center_balances.tenant_id))
with check (public.user_can_access_tenant(stock_center_balances.tenant_id));

drop policy if exists stock_transfers_tenant_select on public.stock_transfers;
create policy stock_transfers_tenant_select on public.stock_transfers
for select
to authenticated
using (public.user_can_access_tenant(stock_transfers.tenant_id));

drop policy if exists stock_transfers_tenant_insert on public.stock_transfers;
create policy stock_transfers_tenant_insert on public.stock_transfers
for insert
to authenticated
with check (public.user_can_access_tenant(stock_transfers.tenant_id));

drop policy if exists stock_transfers_tenant_update on public.stock_transfers;
create policy stock_transfers_tenant_update on public.stock_transfers
for update
to authenticated
using (public.user_can_access_tenant(stock_transfers.tenant_id))
with check (public.user_can_access_tenant(stock_transfers.tenant_id));

drop policy if exists stock_transfer_items_tenant_select on public.stock_transfer_items;
create policy stock_transfer_items_tenant_select on public.stock_transfer_items
for select
to authenticated
using (public.user_can_access_tenant(stock_transfer_items.tenant_id));

drop policy if exists stock_transfer_items_tenant_insert on public.stock_transfer_items;
create policy stock_transfer_items_tenant_insert on public.stock_transfer_items
for insert
to authenticated
with check (public.user_can_access_tenant(stock_transfer_items.tenant_id));

drop policy if exists stock_transfer_items_tenant_update on public.stock_transfer_items;
create policy stock_transfer_items_tenant_update on public.stock_transfer_items
for update
to authenticated
using (public.user_can_access_tenant(stock_transfer_items.tenant_id))
with check (public.user_can_access_tenant(stock_transfer_items.tenant_id));

drop trigger if exists trg_stock_centers_audit on public.stock_centers;
create trigger trg_stock_centers_audit before insert or update on public.stock_centers
for each row execute function public.apply_audit_fields();

drop trigger if exists trg_stock_center_balances_audit on public.stock_center_balances;
create trigger trg_stock_center_balances_audit before insert or update on public.stock_center_balances
for each row execute function public.apply_audit_fields();

drop trigger if exists trg_stock_transfers_audit on public.stock_transfers;
create trigger trg_stock_transfers_audit before insert or update on public.stock_transfers
for each row execute function public.apply_audit_fields();

drop trigger if exists trg_stock_transfer_items_audit on public.stock_transfer_items;
create trigger trg_stock_transfer_items_audit before insert or update on public.stock_transfer_items
for each row execute function public.apply_audit_fields();

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
declare
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
  rec record;
begin
  if p_from_stock_center_id is null or p_to_stock_center_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'STOCK_CENTER_REQUIRED',
      'message', 'Both from_stock_center_id and to_stock_center_id are required.'
    );
  end if;

  if p_from_stock_center_id = p_to_stock_center_id then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'DUPLICATE_STOCK_CENTER',
      'message', 'From and to stock centers must be different.'
    );
  end if;

  if p_project_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'PROJECT_REQUIRED',
      'message', 'project_id is required.'
    );
  end if;

  if p_entry_date is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'ENTRY_DATE_REQUIRED',
      'message', 'entry_date is required.'
    );
  end if;

  if v_entry_type not in ('SUCATA', 'NOVO') then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_ENTRY_TYPE',
      'message', 'entry_type must be SUCATA or NOVO.'
    );
  end if;

  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'ITEMS_REQUIRED',
      'message', 'At least one transfer item is required.'
    );
  end if;

  perform 1
  from public.stock_centers
  where id = p_from_stock_center_id
    and tenant_id = p_tenant_id
    and is_active = true;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'FROM_STOCK_CENTER_NOT_FOUND',
      'message', 'From stock center not found or inactive for this tenant.'
    );
  end if;

  perform 1
  from public.stock_centers
  where id = p_to_stock_center_id
    and tenant_id = p_tenant_id
    and is_active = true;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'TO_STOCK_CENTER_NOT_FOUND',
      'message', 'To stock center not found or inactive for this tenant.'
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
      'message', 'Project not found or inactive for this tenant.'
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
      'message', 'Invalid transfer items payload.',
      'details', v_validation_details
    );
  end if;

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

  if jsonb_array_length(v_stock_details) > 0 then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'INSUFFICIENT_STOCK',
      'message', 'Insufficient stock in the from stock center.',
      'details', v_stock_details
    );
  end if;

  insert into public.stock_transfers (
    tenant_id,
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
    'message', 'Stock transfer saved successfully.'
  );
end;
$$;
