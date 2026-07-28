-- 339_add_cmd_to_serial_stock_movements.sql
-- Adiciona a marcacao CMD em itens de movimentacao e no rastreio unitario por serial.

alter table public.stock_transfer_items
  add column if not exists cmd boolean not null default false;

alter table public.trafo_instances
  add column if not exists cmd boolean not null default false;

create index if not exists idx_stock_transfer_items_tenant_cmd
  on public.stock_transfer_items (tenant_id, cmd, stock_transfer_id)
  where cmd = true;

create index if not exists idx_trafo_instances_tenant_cmd
  on public.trafo_instances (tenant_id, cmd, updated_at desc)
  where cmd = true;

do $$
declare
  v_signature regprocedure :=
    'public.save_stock_transfer_record_base_v181(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb)'::regprocedure;
  v_definition text;
  v_original text;
begin
  select pg_get_functiondef(v_signature::oid)
  into v_definition;

  v_original := v_definition;

  v_definition := replace(
    v_definition,
    $block$  create temporary table if not exists tmp_stock_transfer_items (
    material_id uuid not null,
    material_code text not null,
    material_description text not null,
    quantity numeric not null,
    serial_number text,
    lot_code text,
    is_transformer boolean not null
  ) on commit drop;

  truncate table pg_temp.tmp_stock_transfer_items;$block$,
    $block$  create temporary table if not exists tmp_stock_transfer_items (
    material_id uuid not null,
    material_code text not null,
    material_description text not null,
    quantity numeric not null,
    serial_number text,
    lot_code text,
    cmd boolean not null default false,
    is_transformer boolean not null
  ) on commit drop;

  truncate table pg_temp.tmp_stock_transfer_items;$block$
  );

  v_definition := replace(
    v_definition,
    $block$      lot_code,
      is_transformer
    ) values (
      v_material_id,
      v_material_code,
      v_material_description,
      v_quantity,
      v_serial_number,
      v_lot_code,
      v_is_transformer
    );$block$,
    $block$      lot_code,
      cmd,
      is_transformer
    ) values (
      v_material_id,
      v_material_code,
      v_material_description,
      v_quantity,
      v_serial_number,
      v_lot_code,
      case
        when upper(btrim(coalesce(v_item ->> 'cmd', ''))) in ('TRUE', 'T', '1', 'SIM', 'S', 'YES') then true
        else false
      end,
      v_is_transformer
    );$block$
  );

  v_definition := replace(
    v_definition,
    $block$    lot_code,
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
  from tmp_stock_transfer_items;$block$,
    $block$    lot_code,
    cmd,
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
    case
      when exists (
        select 1
        from public.materials m
        where m.id = tmp_stock_transfer_items.material_id
          and m.tenant_id = p_tenant_id
          and upper(btrim(coalesce(m.serial_tracking_type, case when coalesce(m.is_transformer, false) then 'TRAFO' else 'NONE' end))) = 'RELIGADOR'
      ) then cmd
      else false
    end,
    p_actor_user_id,
    p_actor_user_id
  from tmp_stock_transfer_items;$block$
  );

  if v_definition = v_original then
    raise exception
      'Nao foi possivel atualizar save_stock_transfer_record_base_v181 para persistir CMD.';
  end if;

  execute v_definition;
end;
$$;

create or replace function public.sync_stock_transfer_item_cmd_to_serial_instance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(btrim(coalesce(new.serial_number, '')), '') is null then
    return null;
  end if;

  update public.trafo_instances ti
  set
    cmd = case
      when exists (
        select 1
        from public.materials m
        where m.id = new.material_id
          and m.tenant_id = new.tenant_id
          and upper(btrim(coalesce(m.serial_tracking_type, case when coalesce(m.is_transformer, false) then 'TRAFO' else 'NONE' end))) = 'RELIGADOR'
      ) then coalesce(new.cmd, false)
      else false
    end,
    updated_by = coalesce(new.updated_by, new.created_by),
    updated_at = now()
  where ti.tenant_id = new.tenant_id
    and ti.material_id = new.material_id
    and ti.serial_number = new.serial_number
    and ti.lot_code = coalesce(nullif(btrim(coalesce(new.lot_code, '')), ''), '-')
    and ti.last_stock_transfer_id = new.stock_transfer_id;

  return null;
end;
$$;

drop trigger if exists trg_stock_transfer_items_sync_cmd_to_serial_instance on public.stock_transfer_items;
create trigger trg_stock_transfer_items_sync_cmd_to_serial_instance
after insert or update of cmd on public.stock_transfer_items
for each row execute function public.sync_stock_transfer_item_cmd_to_serial_instance();

with latest_cmd as (
  select distinct on (item.tenant_id, item.material_id, item.serial_number, coalesce(nullif(btrim(coalesce(item.lot_code, '')), ''), '-'))
    item.tenant_id,
    item.material_id,
    item.serial_number,
    coalesce(nullif(btrim(coalesce(item.lot_code, '')), ''), '-') as lot_code,
    case
      when upper(btrim(coalesce(material.serial_tracking_type, case when coalesce(material.is_transformer, false) then 'TRAFO' else 'NONE' end))) = 'RELIGADOR'
      then item.cmd
      else false
    end as cmd
  from public.stock_transfer_items item
  join public.stock_transfers transfer
    on transfer.id = item.stock_transfer_id
   and transfer.tenant_id = item.tenant_id
  join public.materials material
    on material.id = item.material_id
   and material.tenant_id = item.tenant_id
  where nullif(btrim(coalesce(item.serial_number, '')), '') is not null
  order by
    item.tenant_id,
    item.material_id,
    item.serial_number,
    coalesce(nullif(btrim(coalesce(item.lot_code, '')), ''), '-'),
    transfer.entry_date desc,
    transfer.updated_at desc,
    item.id desc
)
update public.trafo_instances ti
set cmd = coalesce(latest_cmd.cmd, false)
from latest_cmd
where ti.tenant_id = latest_cmd.tenant_id
  and ti.material_id = latest_cmd.material_id
  and ti.serial_number = latest_cmd.serial_number
  and ti.lot_code = latest_cmd.lot_code;

revoke all on function public.sync_stock_transfer_item_cmd_to_serial_instance() from public;
revoke all on function public.sync_stock_transfer_item_cmd_to_serial_instance() from anon;
revoke all on function public.sync_stock_transfer_item_cmd_to_serial_instance() from authenticated;
