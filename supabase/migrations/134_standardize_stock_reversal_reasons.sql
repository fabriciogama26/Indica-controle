-- 134_standardize_stock_reversal_reasons.sql
-- Standardizes stock reversal reasons with catalog + reason code/notes persistence.

create table if not exists public.stock_transfer_reversal_reason_catalog (
  code text primary key,
  label_pt text not null,
  requires_notes boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint stock_transfer_reversal_reason_catalog_code_not_blank_check
    check (nullif(btrim(coalesce(code, '')), '') is not null),
  constraint stock_transfer_reversal_reason_catalog_label_not_blank_check
    check (nullif(btrim(coalesce(label_pt, '')), '') is not null)
);

create index if not exists idx_stock_transfer_reversal_reason_catalog_active_order
  on public.stock_transfer_reversal_reason_catalog (is_active, sort_order, code);

alter table if exists public.stock_transfer_reversal_reason_catalog enable row level security;

drop policy if exists stock_transfer_reversal_reason_catalog_select on public.stock_transfer_reversal_reason_catalog;
create policy stock_transfer_reversal_reason_catalog_select on public.stock_transfer_reversal_reason_catalog
for select
to authenticated
using (true);

drop trigger if exists trg_stock_transfer_reversal_reason_catalog_audit on public.stock_transfer_reversal_reason_catalog;
create trigger trg_stock_transfer_reversal_reason_catalog_audit
before insert or update on public.stock_transfer_reversal_reason_catalog
for each row execute function public.apply_audit_fields();

insert into public.stock_transfer_reversal_reason_catalog (code, label_pt, requires_notes, is_active, sort_order)
values
  ('DATA_ENTRY_ERROR', 'Erro de digitacao', false, true, 10),
  ('WRONG_STOCK_CENTER', 'Centro incorreto', false, true, 20),
  ('WRONG_MATERIAL', 'Material incorreto', false, true, 30),
  ('WRONG_QUANTITY', 'Quantidade incorreta', false, true, 40),
  ('DUPLICATE_ENTRY', 'Lancamento duplicado', false, true, 50),
  ('OPERATION_CANCELED', 'Operacao cancelada', false, true, 60),
  ('OTHER', 'Outro', true, true, 70)
on conflict (code) do update
set
  label_pt = excluded.label_pt,
  requires_notes = excluded.requires_notes,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order;

alter table if exists public.stock_transfer_reversals
  add column if not exists reversal_reason_code text,
  add column if not exists reversal_reason_notes text;

update public.stock_transfer_reversals
set reversal_reason_code = 'OTHER'
where nullif(btrim(coalesce(reversal_reason_code, '')), '') is null;

update public.stock_transfer_reversals
set reversal_reason_notes = nullif(btrim(coalesce(reversal_reason_notes, '')), '')
where reversal_reason_notes is distinct from nullif(btrim(coalesce(reversal_reason_notes, '')), '');

update public.stock_transfer_reversals
set reversal_reason_notes = nullif(btrim(coalesce(reversal_reason, '')), '')
where reversal_reason_code = 'OTHER'
  and nullif(btrim(coalesce(reversal_reason_notes, '')), '') is null;

alter table if exists public.stock_transfer_reversals
  alter column reversal_reason_code set not null;

alter table if exists public.stock_transfer_reversals
  drop constraint if exists stock_transfer_reversals_reason_code_fk;

alter table if exists public.stock_transfer_reversals
  add constraint stock_transfer_reversals_reason_code_fk
  foreign key (reversal_reason_code)
  references public.stock_transfer_reversal_reason_catalog(code);

alter table if exists public.stock_transfer_reversals
  drop constraint if exists stock_transfer_reversals_reason_notes_not_blank_check;

alter table if exists public.stock_transfer_reversals
  add constraint stock_transfer_reversals_reason_notes_not_blank_check
  check (
    reversal_reason_notes is null
    or nullif(btrim(reversal_reason_notes), '') is not null
  );

create index if not exists idx_stock_transfer_reversals_reason_code
  on public.stock_transfer_reversals (tenant_id, reversal_reason_code, created_at desc);

create or replace function public.validate_stock_transfer_reversal_reason_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason_code text;
  v_reason_notes text;
  v_reason_label text;
  v_requires_notes boolean;
begin
  v_reason_code := upper(btrim(coalesce(new.reversal_reason_code, '')));
  v_reason_notes := nullif(btrim(coalesce(new.reversal_reason_notes, '')), '');

  if v_reason_code = '' then
    raise exception 'reversal_reason_code e obrigatorio.'
      using errcode = '23514';
  end if;

  select label_pt, requires_notes
  into v_reason_label, v_requires_notes
  from public.stock_transfer_reversal_reason_catalog
  where code = v_reason_code
    and is_active = true;

  if not found then
    raise exception 'reversal_reason_code invalido ou inativo.'
      using errcode = '23514';
  end if;

  if v_requires_notes and v_reason_notes is null then
    raise exception 'reversal_reason_notes e obrigatorio para o motivo selecionado.'
      using errcode = '23514';
  end if;

  new.reversal_reason_code := v_reason_code;
  new.reversal_reason_notes := v_reason_notes;

  if nullif(btrim(coalesce(new.reversal_reason, '')), '') is null then
    new.reversal_reason := case
      when v_reason_notes is null then v_reason_label
      else concat(v_reason_label, ': ', v_reason_notes)
    end;
  else
    new.reversal_reason := btrim(new.reversal_reason);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_stock_transfer_reversals_validate_reason_fields on public.stock_transfer_reversals;
create trigger trg_stock_transfer_reversals_validate_reason_fields
before insert or update on public.stock_transfer_reversals
for each row execute function public.validate_stock_transfer_reversal_reason_fields();

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
begin
  return public.reverse_stock_transfer_record_v2(
    p_tenant_id => p_tenant_id,
    p_actor_user_id => p_actor_user_id,
    p_original_stock_transfer_id => p_original_stock_transfer_id,
    p_reversal_reason_code => 'OTHER',
    p_reversal_reason_notes => nullif(btrim(coalesce(p_reversal_reason, '')), ''),
    p_reversal_date => p_reversal_date
  );
end;
$$;
