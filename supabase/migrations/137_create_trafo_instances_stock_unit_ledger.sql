-- 137_create_trafo_instances_stock_unit_ledger.sql
-- Cria a fonte unitaria de verdade para TRAFO e passa a RPC de movimentacao a validar pela instancia, nao pelo ledger reconstruido em runtime.

create table if not exists public.trafo_instances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  material_id uuid not null references public.materials(id),
  serial_number text not null,
  lot_code text not null,
  current_stock_center_id uuid references public.stock_centers(id),
  last_stock_transfer_id uuid references public.stock_transfers(id),
  last_project_id uuid references public.project(id),
  last_movement_type text not null,
  last_entry_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint trafo_instances_serial_not_blank_check
    check (nullif(btrim(coalesce(serial_number, '')), '') is not null),
  constraint trafo_instances_lot_not_blank_check
    check (nullif(btrim(coalesce(lot_code, '')), '') is not null),
  constraint trafo_instances_last_movement_type_check
    check (last_movement_type in ('ENTRY', 'EXIT', 'TRANSFER')),
  unique (tenant_id, material_id, serial_number, lot_code)
);

create index if not exists idx_trafo_instances_tenant_current_center
  on public.trafo_instances (tenant_id, current_stock_center_id, material_id, updated_at desc);

create index if not exists idx_trafo_instances_tenant_material_serial_lot
  on public.trafo_instances (tenant_id, material_id, serial_number, lot_code);

create index if not exists idx_trafo_instances_tenant_last_transfer
  on public.trafo_instances (tenant_id, last_stock_transfer_id);

alter table if exists public.trafo_instances enable row level security;

drop policy if exists trafo_instances_tenant_select on public.trafo_instances;
create policy trafo_instances_tenant_select on public.trafo_instances
for select
to authenticated
using (public.user_can_access_tenant(trafo_instances.tenant_id));

drop policy if exists trafo_instances_tenant_insert on public.trafo_instances;
create policy trafo_instances_tenant_insert on public.trafo_instances
for insert
to authenticated
with check (public.user_can_access_tenant(trafo_instances.tenant_id));

drop policy if exists trafo_instances_tenant_update on public.trafo_instances;
create policy trafo_instances_tenant_update on public.trafo_instances
for update
to authenticated
using (public.user_can_access_tenant(trafo_instances.tenant_id))
with check (public.user_can_access_tenant(trafo_instances.tenant_id));

drop trigger if exists trg_trafo_instances_audit on public.trafo_instances;
create trigger trg_trafo_instances_audit
before insert or update on public.trafo_instances
for each row execute function public.apply_audit_fields();

do $$
declare
  v_invalid_transformer record;
  v_inconsistent_unit record;
begin
  select
    transfer.id as stock_transfer_id,
    item.material_id,
    material.codigo as material_code,
    item.serial_number,
    item.lot_code
  into v_invalid_transformer
  from public.stock_transfer_items item
  join public.stock_transfers transfer
    on transfer.id = item.stock_transfer_id
   and transfer.tenant_id = item.tenant_id
  join public.materials material
    on material.id = item.material_id
   and material.tenant_id = item.tenant_id
  where coalesce(material.is_transformer, false)
    and (
      nullif(btrim(coalesce(item.serial_number, '')), '') is null
      or nullif(btrim(coalesce(item.lot_code, '')), '') is null
    )
  order by transfer.entry_date desc, transfer.created_at desc, item.id desc
  limit 1;

  if found then
    raise exception
      'Nao foi possivel criar trafo_instances: existe TRAFO sem Serial/LP na movimentacao %, material %.',
      v_invalid_transformer.stock_transfer_id,
      coalesce(v_invalid_transformer.material_code, v_invalid_transformer.material_id::text);
  end if;

  with transformer_moves as (
    select
      item.tenant_id,
      item.material_id,
      btrim(item.serial_number) as serial_number,
      btrim(item.lot_code) as lot_code,
      transfer.from_stock_center_id,
      transfer.to_stock_center_id,
      item.quantity
    from public.stock_transfer_items item
    join public.stock_transfers transfer
      on transfer.id = item.stock_transfer_id
     and transfer.tenant_id = item.tenant_id
    join public.materials material
      on material.id = item.material_id
     and material.tenant_id = item.tenant_id
    where coalesce(material.is_transformer, false)
  ),
  center_deltas as (
    select
      move.tenant_id,
      move.material_id,
      move.serial_number,
      move.lot_code,
      move.to_stock_center_id as stock_center_id,
      move.quantity as delta
    from transformer_moves move
    join public.stock_centers to_center
      on to_center.id = move.to_stock_center_id
     and to_center.tenant_id = move.tenant_id
    where coalesce(to_center.controls_balance, false)

    union all

    select
      move.tenant_id,
      move.material_id,
      move.serial_number,
      move.lot_code,
      move.from_stock_center_id as stock_center_id,
      move.quantity * -1 as delta
    from transformer_moves move
    join public.stock_centers from_center
      on from_center.id = move.from_stock_center_id
     and from_center.tenant_id = move.tenant_id
    where coalesce(from_center.controls_balance, false)
  ),
  unit_center_balances as (
    select
      tenant_id,
      material_id,
      serial_number,
      lot_code,
      stock_center_id,
      sum(delta) as balance
    from center_deltas
    group by tenant_id, material_id, serial_number, lot_code, stock_center_id
  ),
  unit_balance_summary as (
    select
      tenant_id,
      material_id,
      serial_number,
      lot_code,
      coalesce(sum(balance), 0) as own_balance,
      count(*) filter (where balance > 0) as positive_center_count,
      max(case when balance > 0 then stock_center_id::text end)::uuid as current_stock_center_id
    from unit_center_balances
    group by tenant_id, material_id, serial_number, lot_code
  )
  select
    summary.tenant_id,
    summary.material_id,
    material.codigo as material_code,
    summary.serial_number,
    summary.lot_code,
    summary.own_balance,
    summary.positive_center_count,
    summary.current_stock_center_id
  into v_inconsistent_unit
  from unit_balance_summary summary
  join public.materials material
    on material.id = summary.material_id
   and material.tenant_id = summary.tenant_id
  where summary.own_balance not in (0, 1)
     or summary.positive_center_count not in (0, 1)
     or (
       summary.own_balance = 1
       and (summary.positive_center_count <> 1 or summary.current_stock_center_id is null)
     )
     or (
       summary.own_balance = 0
       and summary.positive_center_count <> 0
     )
  limit 1;

  if found then
    raise exception
      'Nao foi possivel criar trafo_instances: unidade % / Serial % / LP % esta inconsistente (saldo own %, centros positivos %).',
      coalesce(v_inconsistent_unit.material_code, v_inconsistent_unit.material_id::text),
      v_inconsistent_unit.serial_number,
      v_inconsistent_unit.lot_code,
      v_inconsistent_unit.own_balance,
      v_inconsistent_unit.positive_center_count;
  end if;
end;
$$;

with transformer_moves as (
  select
    item.tenant_id,
    item.material_id,
    btrim(item.serial_number) as serial_number,
    btrim(item.lot_code) as lot_code,
    transfer.id as stock_transfer_id,
    transfer.project_id,
    transfer.movement_type,
    transfer.entry_date,
    transfer.created_at as transfer_created_at,
    transfer.created_by,
    transfer.updated_by,
    transfer.from_stock_center_id,
    transfer.to_stock_center_id,
    item.quantity
  from public.stock_transfer_items item
  join public.stock_transfers transfer
    on transfer.id = item.stock_transfer_id
   and transfer.tenant_id = item.tenant_id
  join public.materials material
    on material.id = item.material_id
   and material.tenant_id = item.tenant_id
  where coalesce(material.is_transformer, false)
),
center_deltas as (
  select
    move.tenant_id,
    move.material_id,
    move.serial_number,
    move.lot_code,
    move.to_stock_center_id as stock_center_id,
    move.quantity as delta
  from transformer_moves move
  join public.stock_centers to_center
    on to_center.id = move.to_stock_center_id
   and to_center.tenant_id = move.tenant_id
  where coalesce(to_center.controls_balance, false)

  union all

  select
    move.tenant_id,
    move.material_id,
    move.serial_number,
    move.lot_code,
    move.from_stock_center_id as stock_center_id,
    move.quantity * -1 as delta
  from transformer_moves move
  join public.stock_centers from_center
    on from_center.id = move.from_stock_center_id
   and from_center.tenant_id = move.tenant_id
  where coalesce(from_center.controls_balance, false)
),
unit_center_balances as (
  select
    tenant_id,
    material_id,
    serial_number,
    lot_code,
    stock_center_id,
    sum(delta) as balance
  from center_deltas
  group by tenant_id, material_id, serial_number, lot_code, stock_center_id
),
unit_balance_summary as (
  select
    tenant_id,
    material_id,
    serial_number,
    lot_code,
    coalesce(sum(balance), 0) as own_balance,
    max(case when balance > 0 then stock_center_id::text end)::uuid as current_stock_center_id
  from unit_center_balances
  group by tenant_id, material_id, serial_number, lot_code
),
latest_unit_move as (
  select
    move.*,
    row_number() over (
      partition by move.tenant_id, move.material_id, move.serial_number, move.lot_code
      order by move.entry_date desc, move.transfer_created_at desc, move.stock_transfer_id desc
    ) as row_number_desc
  from transformer_moves move
),
backfill_rows as (
  select
    latest.tenant_id,
    latest.material_id,
    latest.serial_number,
    latest.lot_code,
    case
      when balance.own_balance = 1 then balance.current_stock_center_id
      else null
    end as current_stock_center_id,
    latest.stock_transfer_id as last_stock_transfer_id,
    latest.project_id as last_project_id,
    latest.movement_type as last_movement_type,
    latest.entry_date as last_entry_date,
    latest.created_by,
    latest.updated_by
  from latest_unit_move latest
  join unit_balance_summary balance
    on balance.tenant_id = latest.tenant_id
   and balance.material_id = latest.material_id
   and balance.serial_number = latest.serial_number
   and balance.lot_code = latest.lot_code
  where latest.row_number_desc = 1
)
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
)
select
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
from backfill_rows
on conflict (tenant_id, material_id, serial_number, lot_code) do update
set
  current_stock_center_id = excluded.current_stock_center_id,
  last_stock_transfer_id = excluded.last_stock_transfer_id,
  last_project_id = excluded.last_project_id,
  last_movement_type = excluded.last_movement_type,
  last_entry_date = excluded.last_entry_date,
  updated_by = excluded.updated_by,
  updated_at = now();

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
  v_trafo_instance_id uuid;
  v_trafo_current_stock_center_id uuid;
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

    v_trafo_instance_id := null;
    v_trafo_current_stock_center_id := null;

    select id, current_stock_center_id
    into v_trafo_instance_id, v_trafo_current_stock_center_id
    from public.trafo_instances
    where tenant_id = p_tenant_id
      and material_id = rec.material_id
      and serial_number = rec.serial_number
      and lot_code = rec.lot_code
    for update;

    if not found then
      v_trafo_instance_id := null;
      v_trafo_current_stock_center_id := null;
    end if;

    if v_movement_type = 'ENTRY' and v_trafo_current_stock_center_id is not null then
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
            'currentStockCenterId', v_trafo_current_stock_center_id::text
          )
        )
      );
    end if;

    if v_movement_type in ('EXIT', 'TRANSFER') and (
      v_trafo_instance_id is null
      or v_trafo_current_stock_center_id is distinct from p_from_stock_center_id
    ) then
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
            'currentStockCenterId', v_trafo_current_stock_center_id::text
          )
        )
      );
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

  for rec in
    select material_id, material_code, serial_number, lot_code
    from tmp_stock_transfer_items
    where is_transformer
    order by material_id, serial_number, lot_code
  loop
    if v_movement_type = 'ENTRY' then
      update public.trafo_instances
      set
        current_stock_center_id = p_to_stock_center_id,
        last_stock_transfer_id = v_transfer_id,
        last_project_id = p_project_id,
        last_movement_type = v_movement_type,
        last_entry_date = p_entry_date,
        updated_by = p_actor_user_id
      where tenant_id = p_tenant_id
        and material_id = rec.material_id
        and serial_number = rec.serial_number
        and lot_code = rec.lot_code
        and current_stock_center_id is null;

      if not found then
        begin
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
            rec.material_id,
            rec.serial_number,
            rec.lot_code,
            p_to_stock_center_id,
            v_transfer_id,
            p_project_id,
            v_movement_type,
            p_entry_date,
            p_actor_user_id,
            p_actor_user_id
          );
        exception
          when unique_violation then
            raise exception
              'Falha transacional ao registrar trafo_instances para % / Serial % / LP %.',
              rec.material_code,
              rec.serial_number,
              rec.lot_code;
        end;
      end if;
    elsif v_movement_type = 'EXIT' then
      update public.trafo_instances
      set
        current_stock_center_id = null,
        last_stock_transfer_id = v_transfer_id,
        last_project_id = p_project_id,
        last_movement_type = v_movement_type,
        last_entry_date = p_entry_date,
        updated_by = p_actor_user_id
      where tenant_id = p_tenant_id
        and material_id = rec.material_id
        and serial_number = rec.serial_number
        and lot_code = rec.lot_code
        and current_stock_center_id = p_from_stock_center_id;

      if not found then
        raise exception
          'Falha transacional ao baixar trafo_instances para % / Serial % / LP % no centro %.',
          rec.material_code,
          rec.serial_number,
          rec.lot_code,
          p_from_stock_center_id::text;
      end if;
    else
      update public.trafo_instances
      set
        current_stock_center_id = p_to_stock_center_id,
        last_stock_transfer_id = v_transfer_id,
        last_project_id = p_project_id,
        last_movement_type = v_movement_type,
        last_entry_date = p_entry_date,
        updated_by = p_actor_user_id
      where tenant_id = p_tenant_id
        and material_id = rec.material_id
        and serial_number = rec.serial_number
        and lot_code = rec.lot_code
        and current_stock_center_id = p_from_stock_center_id;

      if not found then
        raise exception
          'Falha transacional ao transferir trafo_instances para % / Serial % / LP % entre centros % -> %.',
          rec.material_code,
          rec.serial_number,
          rec.lot_code,
          p_from_stock_center_id::text,
          p_to_stock_center_id::text;
      end if;
    end if;
  end loop;

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
