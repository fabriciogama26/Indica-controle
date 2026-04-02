-- 131_add_stock_transfer_reversal.sql
-- Adds transactional reversal flow for stock movements without editing original records.

create table if not exists public.stock_transfer_reversals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  original_stock_transfer_id uuid not null references public.stock_transfers(id),
  reversal_stock_transfer_id uuid not null references public.stock_transfers(id),
  reversal_reason text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint stock_transfer_reversals_distinct_transfer_check
    check (original_stock_transfer_id <> reversal_stock_transfer_id),
  constraint stock_transfer_reversals_reason_not_blank_check
    check (nullif(btrim(coalesce(reversal_reason, '')), '') is not null),
  unique (tenant_id, original_stock_transfer_id),
  unique (tenant_id, reversal_stock_transfer_id)
);

create index if not exists idx_stock_transfer_reversals_tenant_created_at
  on public.stock_transfer_reversals (tenant_id, created_at desc);

alter table if exists public.stock_transfer_reversals enable row level security;

drop policy if exists stock_transfer_reversals_tenant_select on public.stock_transfer_reversals;
create policy stock_transfer_reversals_tenant_select on public.stock_transfer_reversals
for select
to authenticated
using (public.user_can_access_tenant(stock_transfer_reversals.tenant_id));

drop policy if exists stock_transfer_reversals_tenant_insert on public.stock_transfer_reversals;
create policy stock_transfer_reversals_tenant_insert on public.stock_transfer_reversals
for insert
to authenticated
with check (public.user_can_access_tenant(stock_transfer_reversals.tenant_id));

drop policy if exists stock_transfer_reversals_tenant_update on public.stock_transfer_reversals;
create policy stock_transfer_reversals_tenant_update on public.stock_transfer_reversals
for update
to authenticated
using (public.user_can_access_tenant(stock_transfer_reversals.tenant_id))
with check (public.user_can_access_tenant(stock_transfer_reversals.tenant_id));

drop trigger if exists trg_stock_transfer_reversals_audit on public.stock_transfer_reversals;
create trigger trg_stock_transfer_reversals_audit
before insert or update on public.stock_transfer_reversals
for each row execute function public.apply_audit_fields();

create or replace function public.validate_stock_transfer_reversal_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original_tenant_id uuid;
  v_reversal_tenant_id uuid;
begin
  select tenant_id
  into v_original_tenant_id
  from public.stock_transfers
  where id = new.original_stock_transfer_id;

  if v_original_tenant_id is null then
    raise exception 'original_stock_transfer_id invalido.'
      using errcode = '23514';
  end if;

  select tenant_id
  into v_reversal_tenant_id
  from public.stock_transfers
  where id = new.reversal_stock_transfer_id;

  if v_reversal_tenant_id is null then
    raise exception 'reversal_stock_transfer_id invalido.'
      using errcode = '23514';
  end if;

  if v_original_tenant_id <> new.tenant_id or v_reversal_tenant_id <> new.tenant_id then
    raise exception 'Transferencias de estorno devem pertencer ao mesmo tenant da linha.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_stock_transfer_reversals_validate_tenant on public.stock_transfer_reversals;
create trigger trg_stock_transfer_reversals_validate_tenant
before insert or update on public.stock_transfer_reversals
for each row execute function public.validate_stock_transfer_reversal_tenant();

create or replace function public.reverse_stock_transfer_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_original_stock_transfer_id uuid,
  p_reversal_reason text,
  p_reversal_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original record;
  v_reversal_movement_type text;
  v_reversal_items jsonb := '[]'::jsonb;
  v_reversal_result jsonb;
  v_reversal_transfer_id uuid;
  v_existing_reversal_transfer_id uuid;
  v_reversal_reason text := nullif(btrim(coalesce(p_reversal_reason, '')), '');
  v_reversal_date date := coalesce(p_reversal_date, current_date);
begin
  if p_original_stock_transfer_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'ORIGINAL_TRANSFER_REQUIRED',
      'message', 'stock_transfer_id original e obrigatorio para estorno.'
    );
  end if;

  if v_reversal_reason is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'REVERSAL_REASON_REQUIRED',
      'message', 'Motivo do estorno e obrigatorio.'
    );
  end if;

  if v_reversal_date > current_date then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'REVERSAL_DATE_IN_FUTURE',
      'message', 'Data do estorno nao pode ser futura.'
    );
  end if;

  select
    transfer.id,
    transfer.movement_type,
    transfer.from_stock_center_id,
    transfer.to_stock_center_id,
    transfer.project_id,
    transfer.entry_type
  into v_original
  from public.stock_transfers transfer
  where transfer.id = p_original_stock_transfer_id
    and transfer.tenant_id = p_tenant_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'ORIGINAL_TRANSFER_NOT_FOUND',
      'message', 'Movimentacao original nao encontrada para este tenant.'
    );
  end if;

  select reversal_stock_transfer_id
  into v_existing_reversal_transfer_id
  from public.stock_transfer_reversals
  where tenant_id = p_tenant_id
    and original_stock_transfer_id = p_original_stock_transfer_id;

  if v_existing_reversal_transfer_id is not null then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'ALREADY_REVERSED',
      'message', 'Esta movimentacao ja foi estornada.',
      'reversal_transfer_id', v_existing_reversal_transfer_id::text
    );
  end if;

  if exists (
    select 1
    from public.stock_transfer_reversals
    where tenant_id = p_tenant_id
      and reversal_stock_transfer_id = p_original_stock_transfer_id
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'REVERSAL_OF_REVERSAL_NOT_ALLOWED',
      'message', 'Nao e permitido estornar uma movimentacao que ja e estorno.'
    );
  end if;

  if v_original.movement_type = 'ENTRY' then
    v_reversal_movement_type := 'EXIT';
  elsif v_original.movement_type = 'EXIT' then
    v_reversal_movement_type := 'ENTRY';
  elsif v_original.movement_type = 'TRANSFER' then
    v_reversal_movement_type := 'TRANSFER';
  else
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_MOVEMENT_TYPE',
      'message', 'movement_type da movimentacao original e invalido para estorno.'
    );
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'materialId', item.material_id::text,
        'quantity', item.quantity,
        'serialNumber', item.serial_number,
        'lotCode', item.lot_code
      )
      order by item.id
    ),
    '[]'::jsonb
  )
  into v_reversal_items
  from public.stock_transfer_items item
  where item.tenant_id = p_tenant_id
    and item.stock_transfer_id = p_original_stock_transfer_id;

  if jsonb_array_length(v_reversal_items) = 0 then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'ORIGINAL_ITEMS_NOT_FOUND',
      'message', 'Itens da movimentacao original nao encontrados.'
    );
  end if;

  v_reversal_result := public.save_stock_transfer_record(
    p_tenant_id => p_tenant_id,
    p_actor_user_id => p_actor_user_id,
    p_movement_type => v_reversal_movement_type,
    p_from_stock_center_id => v_original.to_stock_center_id,
    p_to_stock_center_id => v_original.from_stock_center_id,
    p_project_id => v_original.project_id,
    p_entry_date => v_reversal_date,
    p_entry_type => v_original.entry_type,
    p_notes => concat(
      'ESTORNO da transferencia ',
      p_original_stock_transfer_id::text,
      '. Motivo: ',
      v_reversal_reason
    ),
    p_items => v_reversal_items
  );

  if coalesce((v_reversal_result ->> 'success')::boolean, false) is not true then
    return v_reversal_result;
  end if;

  begin
    v_reversal_transfer_id := nullif(v_reversal_result ->> 'transfer_id', '')::uuid;
  exception
    when others then
      v_reversal_transfer_id := null;
  end;

  if v_reversal_transfer_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 500,
      'reason', 'REVERSAL_TRANSFER_ID_MISSING',
      'message', 'Falha ao obter id da movimentacao de estorno.'
    );
  end if;

  begin
    insert into public.stock_transfer_reversals (
      tenant_id,
      original_stock_transfer_id,
      reversal_stock_transfer_id,
      reversal_reason,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      p_original_stock_transfer_id,
      v_reversal_transfer_id,
      v_reversal_reason,
      p_actor_user_id,
      p_actor_user_id
    );
  exception
    when unique_violation then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'ALREADY_REVERSED',
        'message', 'Esta movimentacao ja foi estornada.'
      );
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
      '_context', 'STOCK_TRANSFER_REVERSAL',
      '_action', 'REVERSAL',
      'originalStockTransferId', p_original_stock_transfer_id::text,
      'reversalStockTransferId', v_reversal_transfer_id::text,
      'reversalReason', jsonb_build_object('from', null, 'to', v_reversal_reason),
      'movementType', jsonb_build_object('from', v_original.movement_type, 'to', v_reversal_movement_type),
      'fromStockCenterId', jsonb_build_object('from', v_original.from_stock_center_id::text, 'to', v_original.to_stock_center_id::text),
      'toStockCenterId', jsonb_build_object('from', v_original.to_stock_center_id::text, 'to', v_original.from_stock_center_id::text),
      'quantity', jsonb_build_object('from', null, 'to', item.quantity::text),
      'serialNumber', jsonb_build_object('from', null, 'to', item.serial_number),
      'lotCode', jsonb_build_object('from', null, 'to', item.lot_code)
    ),
    p_actor_user_id,
    p_actor_user_id
  from public.stock_transfer_items item
  where item.tenant_id = p_tenant_id
    and item.stock_transfer_id = v_reversal_transfer_id;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'transfer_id', v_reversal_transfer_id,
    'original_transfer_id', p_original_stock_transfer_id,
    'message', 'Estorno realizado com sucesso.'
  );
end;
$$;
