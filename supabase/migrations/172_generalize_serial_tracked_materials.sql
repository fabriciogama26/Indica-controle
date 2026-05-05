-- 172_generalize_serial_tracked_materials.sql
-- Generalizes the TRAFO unit ledger so other serialized materials can be tracked by Serial.

alter table if exists public.materials
  add column if not exists serial_tracking_type text not null default 'NONE';

update public.materials
set serial_tracking_type = case
  when coalesce(is_transformer, false) then 'TRAFO'
  when nullif(btrim(coalesce(serial_tracking_type, '')), '') is null then 'NONE'
  else upper(btrim(serial_tracking_type))
end;

alter table if exists public.materials
  drop constraint if exists materials_serial_tracking_type_check;

alter table if exists public.materials
  add constraint materials_serial_tracking_type_check
  check (serial_tracking_type in ('NONE', 'TRAFO', 'RELIGADOR', 'CHAVE'));

create index if not exists idx_materials_tenant_serial_tracking_type
  on public.materials (tenant_id, serial_tracking_type, is_active, codigo);

update public.app_pages
set
  name = 'Rastreio de SERIAL',
  description = 'Consulta da posicao atual de materiais rastreados por serial.',
  updated_at = now()
where page_key = 'posicao-trafo';

create or replace function public.sync_material_serial_tracking_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.serial_tracking_type := upper(btrim(coalesce(new.serial_tracking_type, 'NONE')));

  if new.serial_tracking_type not in ('NONE', 'TRAFO', 'RELIGADOR', 'CHAVE') then
    raise exception 'serial_tracking_type invalido.';
  end if;

  if new.serial_tracking_type = 'NONE' and coalesce(new.is_transformer, false) then
    new.serial_tracking_type := 'TRAFO';
  end if;

  new.is_transformer := new.serial_tracking_type = 'TRAFO';
  return new;
end;
$$;

drop trigger if exists trg_materials_sync_serial_tracking_fields on public.materials;
create trigger trg_materials_sync_serial_tracking_fields
before insert or update of serial_tracking_type, is_transformer on public.materials
for each row execute function public.sync_material_serial_tracking_fields();

drop function if exists public.save_material_record(uuid, uuid, uuid, text, text, text, text, boolean, numeric, jsonb, timestamptz);
drop function if exists public.save_material_record(uuid, uuid, uuid, text, text, text, text, boolean, numeric, text, jsonb, timestamptz);

create or replace function public.save_material_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_material_id uuid default null,
  p_codigo text default null,
  p_descricao text default null,
  p_umb text default null,
  p_tipo text default null,
  p_is_transformer boolean default false,
  p_unit_price numeric default null,
  p_serial_tracking_type text default null,
  p_changes jsonb default '{}'::jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.materials%rowtype;
  v_material_id uuid;
  v_updated_at timestamptz;
  v_tipo text := upper(btrim(coalesce(p_tipo, '')));
  v_unit_price numeric := coalesce(p_unit_price, 0);
  v_serial_tracking_type text := upper(btrim(coalesce(
    p_serial_tracking_type,
    case when coalesce(p_is_transformer, false) then 'TRAFO' else 'NONE' end
  )));
  v_is_transformer boolean;
begin
  if v_tipo not in ('NOVO', 'SUCATA') then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_TYPE',
      'message', 'Tipo invalido. Selecione NOVO ou SUCATA.'
    );
  end if;

  if v_unit_price < 0 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_UNIT_PRICE',
      'message', 'Preco invalido. Informe valor maior ou igual a zero.'
    );
  end if;

  if v_serial_tracking_type not in ('NONE', 'TRAFO', 'RELIGADOR', 'CHAVE') then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_SERIAL_TRACKING_TYPE',
      'message', 'Tipo de rastreio por serial invalido.'
    );
  end if;

  v_is_transformer := v_serial_tracking_type = 'TRAFO';

  if p_material_id is null then
    insert into public.materials (
      tenant_id,
      codigo,
      descricao,
      umb,
      tipo,
      is_transformer,
      serial_tracking_type,
      unit_price,
      is_active,
      cancellation_reason,
      canceled_at,
      canceled_by,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      p_codigo,
      p_descricao,
      nullif(btrim(coalesce(p_umb, '')), ''),
      v_tipo,
      v_is_transformer,
      v_serial_tracking_type,
      v_unit_price,
      true,
      null,
      null,
      null,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at
    into v_material_id, v_updated_at;

    return jsonb_build_object('success', true, 'status', 200, 'material_id', v_material_id, 'updated_at', v_updated_at);
  end if;

  select *
  into v_current
  from public.materials
  where id = p_material_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'MATERIAL_NOT_FOUND', 'message', 'Material nao encontrado para edicao.');
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'EXPECTED_UPDATED_AT_REQUIRED', 'message', 'Atualize a lista antes de editar o material.');
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'CONCURRENT_MODIFICATION',
      'message', format('O material %s foi alterado por outro usuario. Recarregue os dados antes de salvar novamente.', v_current.codigo)
    );
  end if;

  if not v_current.is_active then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'RECORD_INACTIVE', 'message', 'Ative o material antes de editar.');
  end if;

  update public.materials
  set
    codigo = p_codigo,
    descricao = p_descricao,
    umb = nullif(btrim(coalesce(p_umb, '')), ''),
    tipo = v_tipo,
    is_transformer = v_is_transformer,
    serial_tracking_type = v_serial_tracking_type,
    unit_price = v_unit_price,
    updated_by = p_actor_user_id
  where id = p_material_id
    and tenant_id = p_tenant_id
  returning id, updated_at
  into v_material_id, v_updated_at;

  if coalesce(jsonb_object_length(coalesce(p_changes, '{}'::jsonb)), 0) > 0 then
    insert into public.material_history (
      tenant_id,
      material_id,
      change_type,
      changes,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      p_material_id,
      'UPDATE',
      coalesce(p_changes, '{}'::jsonb),
      p_actor_user_id,
      p_actor_user_id
    );
  end if;

  return jsonb_build_object('success', true, 'status', 200, 'material_id', v_material_id, 'updated_at', v_updated_at);
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'DUPLICATE_MATERIAL_CODE', 'message', 'Ja existe material com este codigo no tenant atual.');
end;
$$;

revoke all on function public.save_material_record(uuid, uuid, uuid, text, text, text, text, boolean, numeric, text, jsonb, timestamptz) from public;
grant execute on function public.save_material_record(uuid, uuid, uuid, text, text, text, text, boolean, numeric, text, jsonb, timestamptz) to authenticated;
grant execute on function public.save_material_record(uuid, uuid, uuid, text, text, text, text, boolean, numeric, text, jsonb, timestamptz) to service_role;

create or replace function public.normalize_serial_tracked_stock_transfer_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tracking_type text;
  v_material_code text;
begin
  select
    case
      when coalesce(m.serial_tracking_type, '') <> '' then m.serial_tracking_type
      when coalesce(m.is_transformer, false) then 'TRAFO'
      else 'NONE'
    end,
    m.codigo
  into v_tracking_type, v_material_code
  from public.materials m
  where m.id = new.material_id
    and m.tenant_id = new.tenant_id;

  if not found or v_tracking_type in ('NONE', 'TRAFO') then
    return new;
  end if;

  if new.quantity <> 1 then
    raise exception 'SERIAL_TRACKED_QUANTITY_MUST_BE_ONE: material %', coalesce(v_material_code, new.material_id::text);
  end if;

  new.serial_number := nullif(btrim(coalesce(new.serial_number, '')), '');
  if new.serial_number is null then
    raise exception 'SERIAL_TRACKED_SERIAL_REQUIRED: material %', coalesce(v_material_code, new.material_id::text);
  end if;

  new.lot_code := '-';
  return new;
end;
$$;

drop trigger if exists trg_stock_transfer_items_normalize_serial_tracked on public.stock_transfer_items;
create trigger trg_stock_transfer_items_normalize_serial_tracked
before insert or update of material_id, quantity, serial_number, lot_code on public.stock_transfer_items
for each row execute function public.normalize_serial_tracked_stock_transfer_item();

create or replace function public.apply_serial_tracked_stock_transfer_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tracking_type text;
  v_material_code text;
  v_transfer public.stock_transfers%rowtype;
  v_team_operation_kind text;
  v_is_field_return_transfer boolean := false;
  v_instance_id uuid;
  v_current_stock_center_id uuid;
begin
  select
    case
      when coalesce(m.serial_tracking_type, '') <> '' then m.serial_tracking_type
      when coalesce(m.is_transformer, false) then 'TRAFO'
      else 'NONE'
    end,
    m.codigo
  into v_tracking_type, v_material_code
  from public.materials m
  where m.id = new.material_id
    and m.tenant_id = new.tenant_id;

  if not found or v_tracking_type in ('NONE', 'TRAFO') then
    return null;
  end if;

  select *
  into v_transfer
  from public.stock_transfers st
  where st.id = new.stock_transfer_id
    and st.tenant_id = new.tenant_id;

  if not found then
    raise exception 'SERIAL_TRACKED_TRANSFER_NOT_FOUND: transferencia %', new.stock_transfer_id;
  end if;

  select sto.operation_kind
  into v_team_operation_kind
  from public.stock_transfer_team_operations sto
  where sto.transfer_id = new.stock_transfer_id
    and sto.tenant_id = new.tenant_id
  limit 1;

  select exists (
    select 1
    from public.stock_centers sc
    where sc.id = v_transfer.from_stock_center_id
      and sc.tenant_id = new.tenant_id
      and sc.center_type = 'THIRD_PARTY'
      and upper(btrim(coalesce(sc.name, ''))) = 'CAMPO / INSTALADO'
  )
  into v_is_field_return_transfer;

  perform pg_advisory_xact_lock(
    hashtext(new.tenant_id::text),
    hashtext(new.material_id::text || '|' || coalesce(new.serial_number, '') || '|-')
  );

  select id, current_stock_center_id
  into v_instance_id, v_current_stock_center_id
  from public.trafo_instances
  where tenant_id = new.tenant_id
    and material_id = new.material_id
    and serial_number = new.serial_number
    and lot_code = '-'
  for update;

  if not found then
    v_instance_id := null;
    v_current_stock_center_id := null;
  end if;

  if v_transfer.movement_type = 'ENTRY' and v_current_stock_center_id is not null then
    raise exception 'SERIAL_TRACKED_UNIT_ALREADY_IN_STOCK: material %, serial %', coalesce(v_material_code, new.material_id::text), new.serial_number;
  end if;

  if v_team_operation_kind = 'FIELD_RETURN' or v_is_field_return_transfer then
    if v_current_stock_center_id is not null then
      raise exception 'SERIAL_TRACKED_UNIT_ALREADY_IN_STOCK: material %, serial %', coalesce(v_material_code, new.material_id::text), new.serial_number;
    end if;

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
      new.tenant_id,
      new.material_id,
      new.serial_number,
      '-',
      v_transfer.to_stock_center_id,
      v_transfer.id,
      v_transfer.project_id,
      v_transfer.movement_type,
      v_transfer.entry_date,
      new.created_by,
      new.updated_by
    )
    on conflict (tenant_id, material_id, serial_number, lot_code) do update
    set
      current_stock_center_id = excluded.current_stock_center_id,
      last_stock_transfer_id = excluded.last_stock_transfer_id,
      last_project_id = excluded.last_project_id,
      last_movement_type = excluded.last_movement_type,
      last_entry_date = excluded.last_entry_date,
      updated_by = excluded.updated_by,
      updated_at = now();

    return null;
  end if;

  if v_transfer.movement_type in ('EXIT', 'TRANSFER') and (
    v_instance_id is null
    or v_current_stock_center_id is distinct from v_transfer.from_stock_center_id
  ) then
    raise exception 'SERIAL_TRACKED_UNIT_NOT_IN_FROM_CENTER: material %, serial %', coalesce(v_material_code, new.material_id::text), new.serial_number;
  end if;

  if v_transfer.movement_type = 'ENTRY' then
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
      new.tenant_id,
      new.material_id,
      new.serial_number,
      '-',
      v_transfer.to_stock_center_id,
      v_transfer.id,
      v_transfer.project_id,
      v_transfer.movement_type,
      v_transfer.entry_date,
      new.created_by,
      new.updated_by
    )
    on conflict (tenant_id, material_id, serial_number, lot_code) do update
    set
      current_stock_center_id = excluded.current_stock_center_id,
      last_stock_transfer_id = excluded.last_stock_transfer_id,
      last_project_id = excluded.last_project_id,
      last_movement_type = excluded.last_movement_type,
      last_entry_date = excluded.last_entry_date,
      updated_by = excluded.updated_by,
      updated_at = now();
  elsif v_transfer.movement_type = 'EXIT' then
    update public.trafo_instances
    set
      current_stock_center_id = null,
      last_stock_transfer_id = v_transfer.id,
      last_project_id = v_transfer.project_id,
      last_movement_type = v_transfer.movement_type,
      last_entry_date = v_transfer.entry_date,
      updated_by = new.updated_by
    where id = v_instance_id;
  else
    update public.trafo_instances
    set
      current_stock_center_id = v_transfer.to_stock_center_id,
      last_stock_transfer_id = v_transfer.id,
      last_project_id = v_transfer.project_id,
      last_movement_type = v_transfer.movement_type,
      last_entry_date = v_transfer.entry_date,
      updated_by = new.updated_by
    where id = v_instance_id;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_stock_transfer_items_apply_serial_tracked on public.stock_transfer_items;
create trigger trg_stock_transfer_items_apply_serial_tracked
after insert on public.stock_transfer_items
for each row execute function public.apply_serial_tracked_stock_transfer_item();
