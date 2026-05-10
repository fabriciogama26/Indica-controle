-- 179_add_stock_transfer_item_reversal.sql
-- Adds item-level stock transfer reversals without changing legacy full-transfer reversal records.

create table if not exists public.stock_transfer_item_reversals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  original_stock_transfer_id uuid not null references public.stock_transfers(id),
  original_stock_transfer_item_id uuid not null references public.stock_transfer_items(id),
  reversal_stock_transfer_id uuid not null references public.stock_transfers(id),
  reversal_stock_transfer_item_id uuid references public.stock_transfer_items(id),
  reversal_reason text not null,
  reversal_reason_code text not null references public.stock_transfer_reversal_reason_catalog(code),
  reversal_reason_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint stock_transfer_item_reversals_distinct_transfer_check
    check (original_stock_transfer_id <> reversal_stock_transfer_id),
  constraint stock_transfer_item_reversals_distinct_item_check
    check (
      reversal_stock_transfer_item_id is null
      or original_stock_transfer_item_id <> reversal_stock_transfer_item_id
    ),
  constraint stock_transfer_item_reversals_reason_not_blank_check
    check (nullif(btrim(coalesce(reversal_reason, '')), '') is not null),
  constraint stock_transfer_item_reversals_reason_notes_not_blank_check
    check (
      reversal_reason_notes is null
      or nullif(btrim(reversal_reason_notes), '') is not null
    ),
  unique (tenant_id, original_stock_transfer_item_id),
  unique (tenant_id, reversal_stock_transfer_item_id)
);

create index if not exists idx_stock_transfer_item_reversals_original_transfer
  on public.stock_transfer_item_reversals (tenant_id, original_stock_transfer_id, created_at desc);

create index if not exists idx_stock_transfer_item_reversals_reversal_transfer
  on public.stock_transfer_item_reversals (tenant_id, reversal_stock_transfer_id, created_at desc);

create index if not exists idx_stock_transfer_item_reversals_reason_code
  on public.stock_transfer_item_reversals (tenant_id, reversal_reason_code, created_at desc);

alter table if exists public.stock_transfer_item_reversals enable row level security;

drop policy if exists stock_transfer_item_reversals_tenant_select on public.stock_transfer_item_reversals;
create policy stock_transfer_item_reversals_tenant_select on public.stock_transfer_item_reversals
for select
to authenticated
using (public.user_can_access_tenant(stock_transfer_item_reversals.tenant_id));

drop policy if exists stock_transfer_item_reversals_tenant_insert on public.stock_transfer_item_reversals;
create policy stock_transfer_item_reversals_tenant_insert on public.stock_transfer_item_reversals
for insert
to authenticated
with check (public.user_can_access_tenant(stock_transfer_item_reversals.tenant_id));

drop policy if exists stock_transfer_item_reversals_tenant_update on public.stock_transfer_item_reversals;
create policy stock_transfer_item_reversals_tenant_update on public.stock_transfer_item_reversals
for update
to authenticated
using (public.user_can_access_tenant(stock_transfer_item_reversals.tenant_id))
with check (public.user_can_access_tenant(stock_transfer_item_reversals.tenant_id));

drop trigger if exists trg_stock_transfer_item_reversals_audit on public.stock_transfer_item_reversals;
create trigger trg_stock_transfer_item_reversals_audit
before insert or update on public.stock_transfer_item_reversals
for each row execute function public.apply_audit_fields();

create or replace function public.validate_stock_transfer_item_reversal_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original_transfer_tenant uuid;
  v_reversal_transfer_tenant uuid;
  v_original_item record;
  v_reversal_item record;
begin
  select tenant_id
  into v_original_transfer_tenant
  from public.stock_transfers
  where id = new.original_stock_transfer_id;

  if v_original_transfer_tenant is null or v_original_transfer_tenant <> new.tenant_id then
    raise exception 'original stock transfer tenant mismatch'
      using errcode = '23514';
  end if;

  select tenant_id
  into v_reversal_transfer_tenant
  from public.stock_transfers
  where id = new.reversal_stock_transfer_id;

  if v_reversal_transfer_tenant is null or v_reversal_transfer_tenant <> new.tenant_id then
    raise exception 'reversal stock transfer tenant mismatch'
      using errcode = '23514';
  end if;

  select tenant_id, stock_transfer_id
  into v_original_item
  from public.stock_transfer_items
  where id = new.original_stock_transfer_item_id;

  if not found then
    raise exception 'original stock transfer item mismatch'
      using errcode = '23514';
  end if;

  if v_original_item.tenant_id is null
    or v_original_item.tenant_id <> new.tenant_id
    or v_original_item.stock_transfer_id <> new.original_stock_transfer_id then
    raise exception 'original stock transfer item mismatch'
      using errcode = '23514';
  end if;

  if new.reversal_stock_transfer_item_id is not null then
    select tenant_id, stock_transfer_id
    into v_reversal_item
    from public.stock_transfer_items
    where id = new.reversal_stock_transfer_item_id;

    if not found then
      raise exception 'reversal stock transfer item mismatch'
        using errcode = '23514';
    end if;

    if v_reversal_item.tenant_id is null
      or v_reversal_item.tenant_id <> new.tenant_id
      or v_reversal_item.stock_transfer_id <> new.reversal_stock_transfer_id then
      raise exception 'reversal stock transfer item mismatch'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_stock_transfer_item_reversals_validate_links on public.stock_transfer_item_reversals;
create trigger trg_stock_transfer_item_reversals_validate_links
before insert or update on public.stock_transfer_item_reversals
for each row execute function public.validate_stock_transfer_item_reversal_links();

create or replace function public.reverse_stock_transfer_item_record_v1(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_original_stock_transfer_item_id uuid,
  p_reversal_reason_code text,
  p_reversal_reason_notes text default null,
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
  v_reversal_item_id uuid;
  v_existing_reversal_transfer_id uuid;
  v_reason_code text := upper(btrim(coalesce(p_reversal_reason_code, '')));
  v_reason_notes text := nullif(btrim(coalesce(p_reversal_reason_notes, '')), '');
  v_reason_label text;
  v_reason_requires_notes boolean;
  v_reversal_reason text;
  v_reversal_date date := coalesce(p_reversal_date, current_date);
begin
  if p_original_stock_transfer_item_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'ORIGINAL_ITEM_REQUIRED',
      'message', 'stock_transfer_item_id original e obrigatorio para estorno.'
    );
  end if;

  if v_reason_code = '' then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'REVERSAL_REASON_CODE_REQUIRED',
      'message', 'Motivo padrao do estorno e obrigatorio.'
    );
  end if;

  select label_pt, requires_notes
  into v_reason_label, v_reason_requires_notes
  from public.stock_transfer_reversal_reason_catalog
  where code = v_reason_code
    and is_active = true;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_REVERSAL_REASON_CODE',
      'message', 'Motivo padrao do estorno invalido ou inativo.'
    );
  end if;

  if v_reason_requires_notes and v_reason_notes is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'REVERSAL_REASON_NOTES_REQUIRED',
      'message', 'Observacao do motivo e obrigatoria para o motivo selecionado.'
    );
  end if;

  v_reversal_reason := case
    when v_reason_notes is null then v_reason_label
    else concat(v_reason_label, ': ', v_reason_notes)
  end;

  if v_reversal_date > current_date then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'REVERSAL_DATE_IN_FUTURE',
      'message', 'Data do estorno nao pode ser futura.'
    );
  end if;

  select
    transfer.id as stock_transfer_id,
    transfer.movement_type,
    transfer.from_stock_center_id,
    transfer.to_stock_center_id,
    transfer.project_id,
    transfer.entry_type,
    item.id as stock_transfer_item_id,
    item.material_id,
    item.quantity,
    item.serial_number,
    item.lot_code
  into v_original
  from public.stock_transfer_items item
  join public.stock_transfers transfer
    on transfer.id = item.stock_transfer_id
   and transfer.tenant_id = item.tenant_id
  where item.id = p_original_stock_transfer_item_id
    and item.tenant_id = p_tenant_id
  for update of item, transfer;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'ORIGINAL_ITEM_NOT_FOUND',
      'message', 'Item da movimentacao original nao encontrado para este tenant.'
    );
  end if;

  select reversal_stock_transfer_id
  into v_existing_reversal_transfer_id
  from public.stock_transfer_reversals
  where tenant_id = p_tenant_id
    and original_stock_transfer_id = v_original.stock_transfer_id;

  if v_existing_reversal_transfer_id is not null then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'FULL_TRANSFER_ALREADY_REVERSED',
      'message', 'Esta transferencia ja foi estornada integralmente.',
      'reversal_transfer_id', v_existing_reversal_transfer_id::text
    );
  end if;

  if exists (
    select 1
    from public.stock_transfer_reversals
    where tenant_id = p_tenant_id
      and reversal_stock_transfer_id = v_original.stock_transfer_id
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'REVERSAL_OF_REVERSAL_NOT_ALLOWED',
      'message', 'Nao e permitido estornar uma movimentacao que ja e estorno.'
    );
  end if;

  select reversal_stock_transfer_id
  into v_existing_reversal_transfer_id
  from public.stock_transfer_item_reversals
  where tenant_id = p_tenant_id
    and original_stock_transfer_item_id = p_original_stock_transfer_item_id;

  if v_existing_reversal_transfer_id is not null then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'ITEM_ALREADY_REVERSED',
      'message', 'Este item da movimentacao ja foi estornado.',
      'reversal_transfer_id', v_existing_reversal_transfer_id::text
    );
  end if;

  if exists (
    select 1
    from public.stock_transfer_item_reversals
    where tenant_id = p_tenant_id
      and reversal_stock_transfer_item_id = p_original_stock_transfer_item_id
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'REVERSAL_OF_REVERSAL_NOT_ALLOWED',
      'message', 'Nao e permitido estornar um item que ja e estorno.'
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

  v_reversal_items := jsonb_build_array(
    jsonb_build_object(
      'materialId', v_original.material_id::text,
      'quantity', v_original.quantity,
      'serialNumber', v_original.serial_number,
      'lotCode', v_original.lot_code
    )
  );

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
      'ESTORNO do item ',
      p_original_stock_transfer_item_id::text,
      ' da transferencia ',
      v_original.stock_transfer_id::text,
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

  select id
  into v_reversal_item_id
  from public.stock_transfer_items
  where tenant_id = p_tenant_id
    and stock_transfer_id = v_reversal_transfer_id
  order by created_at asc, id asc
  limit 1;

  if v_reversal_item_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 500,
      'reason', 'REVERSAL_ITEM_ID_MISSING',
      'message', 'Falha ao obter id do item de estorno.'
    );
  end if;

  begin
    insert into public.stock_transfer_item_reversals (
      tenant_id,
      original_stock_transfer_id,
      original_stock_transfer_item_id,
      reversal_stock_transfer_id,
      reversal_stock_transfer_item_id,
      reversal_reason,
      reversal_reason_code,
      reversal_reason_notes,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      v_original.stock_transfer_id,
      p_original_stock_transfer_item_id,
      v_reversal_transfer_id,
      v_reversal_item_id,
      v_reversal_reason,
      v_reason_code,
      v_reason_notes,
      p_actor_user_id,
      p_actor_user_id
    );
  exception
    when unique_violation then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'ITEM_ALREADY_REVERSED',
        'message', 'Este item da movimentacao ja foi estornado.'
      );
  end;

  insert into public.material_history (
    tenant_id,
    material_id,
    change_type,
    changes,
    created_by,
    updated_by
  ) values (
    p_tenant_id,
    v_original.material_id,
    'UPDATE',
    jsonb_build_object(
      '_context', 'STOCK_TRANSFER_ITEM_REVERSAL',
      '_action', 'REVERSAL',
      'originalStockTransferId', v_original.stock_transfer_id::text,
      'originalStockTransferItemId', p_original_stock_transfer_item_id::text,
      'reversalStockTransferId', v_reversal_transfer_id::text,
      'reversalStockTransferItemId', v_reversal_item_id::text,
      'reversalReasonCode', jsonb_build_object('from', null, 'to', v_reason_code),
      'reversalReasonNotes', jsonb_build_object('from', null, 'to', v_reason_notes),
      'reversalReason', jsonb_build_object('from', null, 'to', v_reversal_reason),
      'movementType', jsonb_build_object('from', v_original.movement_type, 'to', v_reversal_movement_type),
      'fromStockCenterId', jsonb_build_object('from', v_original.from_stock_center_id::text, 'to', v_original.to_stock_center_id::text),
      'toStockCenterId', jsonb_build_object('from', v_original.to_stock_center_id::text, 'to', v_original.from_stock_center_id::text),
      'quantity', jsonb_build_object('from', null, 'to', v_original.quantity::text),
      'serialNumber', jsonb_build_object('from', null, 'to', v_original.serial_number),
      'lotCode', jsonb_build_object('from', null, 'to', v_original.lot_code)
    ),
    p_actor_user_id,
    p_actor_user_id
  );

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'transfer_id', v_reversal_transfer_id,
    'original_transfer_id', v_original.stock_transfer_id,
    'original_item_id', p_original_stock_transfer_item_id,
    'reversal_item_id', v_reversal_item_id,
    'message', 'Item estornado com sucesso.'
  );
end;
$$;

create or replace function public.reverse_team_stock_operation_item_record_v1(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_original_stock_transfer_item_id uuid,
  p_reversal_reason_code text,
  p_reversal_reason_notes text default null,
  p_reversal_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_operation public.stock_transfer_team_operations%rowtype;
  v_original_transfer_id uuid;
  v_reversal_result jsonb;
  v_reversal_transfer_id uuid;
begin
  select item.stock_transfer_id
  into v_original_transfer_id
  from public.stock_transfer_items item
  where item.id = p_original_stock_transfer_item_id
    and item.tenant_id = p_tenant_id;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'ORIGINAL_ITEM_NOT_FOUND',
      'message', 'Item da operacao de equipe original nao encontrado para este tenant.'
    );
  end if;

  select *
  into v_team_operation
  from public.stock_transfer_team_operations sto
  where sto.transfer_id = v_original_transfer_id
    and sto.tenant_id = p_tenant_id;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'TEAM_OPERATION_NOT_FOUND',
      'message', 'Operacao de equipe original nao encontrada para este tenant.'
    );
  end if;

  v_reversal_result := public.reverse_stock_transfer_item_record_v1(
    p_tenant_id => p_tenant_id,
    p_actor_user_id => p_actor_user_id,
    p_original_stock_transfer_item_id => p_original_stock_transfer_item_id,
    p_reversal_reason_code => p_reversal_reason_code,
    p_reversal_reason_notes => p_reversal_reason_notes,
    p_reversal_date => p_reversal_date
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
      'message', 'Falha ao obter id da operacao de equipe estornada.'
    );
  end if;

  insert into public.stock_transfer_team_operations (
    transfer_id,
    tenant_id,
    team_id,
    operation_kind,
    technical_origin_stock_center_id,
    team_name_snapshot,
    foreman_person_id_snapshot,
    foreman_name_snapshot,
    created_by,
    updated_by
  ) values (
    v_reversal_transfer_id,
    p_tenant_id,
    v_team_operation.team_id,
    v_team_operation.operation_kind,
    v_team_operation.technical_origin_stock_center_id,
    v_team_operation.team_name_snapshot,
    v_team_operation.foreman_person_id_snapshot,
    v_team_operation.foreman_name_snapshot,
    p_actor_user_id,
    p_actor_user_id
  );

  return v_reversal_result;
end;
$$;

create or replace function public.reverse_stock_transfer_record_v2(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_original_stock_transfer_id uuid,
  p_reversal_reason_code text,
  p_reversal_reason_notes text default null,
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
  v_reason_code text := upper(btrim(coalesce(p_reversal_reason_code, '')));
  v_reason_notes text := nullif(btrim(coalesce(p_reversal_reason_notes, '')), '');
  v_reason_label text;
  v_reason_requires_notes boolean;
  v_reversal_reason text;
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

  if v_reason_code = '' then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'REVERSAL_REASON_CODE_REQUIRED',
      'message', 'Motivo padrao do estorno e obrigatorio.'
    );
  end if;

  select label_pt, requires_notes
  into v_reason_label, v_reason_requires_notes
  from public.stock_transfer_reversal_reason_catalog
  where code = v_reason_code
    and is_active = true;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_REVERSAL_REASON_CODE',
      'message', 'Motivo padrao do estorno invalido ou inativo.'
    );
  end if;

  if v_reason_requires_notes and v_reason_notes is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'REVERSAL_REASON_NOTES_REQUIRED',
      'message', 'Observacao do motivo e obrigatoria para o motivo selecionado.'
    );
  end if;

  v_reversal_reason := case
    when v_reason_notes is null then v_reason_label
    else concat(v_reason_label, ': ', v_reason_notes)
  end;

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
    from public.stock_transfer_item_reversals
    where tenant_id = p_tenant_id
      and original_stock_transfer_id = p_original_stock_transfer_id
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'PARTIAL_REVERSAL_EXISTS',
      'message', 'Esta transferencia ja possui estorno por item. Estorne os itens restantes individualmente.'
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
      reversal_reason_code,
      reversal_reason_notes,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      p_original_stock_transfer_id,
      v_reversal_transfer_id,
      v_reversal_reason,
      v_reason_code,
      v_reason_notes,
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
      'reversalReasonCode', jsonb_build_object('from', null, 'to', v_reason_code),
      'reversalReasonNotes', jsonb_build_object('from', null, 'to', v_reason_notes),
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

revoke all on function public.reverse_stock_transfer_item_record_v1(uuid, uuid, uuid, text, text, date) from public;
grant execute on function public.reverse_stock_transfer_item_record_v1(uuid, uuid, uuid, text, text, date) to authenticated;
grant execute on function public.reverse_stock_transfer_item_record_v1(uuid, uuid, uuid, text, text, date) to service_role;

revoke all on function public.reverse_team_stock_operation_item_record_v1(uuid, uuid, uuid, text, text, date) from public;
grant execute on function public.reverse_team_stock_operation_item_record_v1(uuid, uuid, uuid, text, text, date) to authenticated;
grant execute on function public.reverse_team_stock_operation_item_record_v1(uuid, uuid, uuid, text, text, date) to service_role;

revoke all on function public.validate_stock_transfer_item_reversal_links() from public;
grant execute on function public.validate_stock_transfer_item_reversal_links() to authenticated;
grant execute on function public.validate_stock_transfer_item_reversal_links() to service_role;
