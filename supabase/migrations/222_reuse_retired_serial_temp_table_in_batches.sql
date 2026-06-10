-- 222_reuse_retired_serial_temp_table_in_batches.sql
-- Permite reutilizar a tabela temporaria de seriais RET durante lotes atomicos.

do $$
declare
  v_signature regprocedure :=
    'public.save_stock_transfer_record_direct_purchase_v209(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb, boolean)'::regprocedure;
  v_definition text;
  v_original text;
begin
  select pg_get_functiondef(v_signature::oid)
  into v_definition;

  v_original := v_definition;

  v_definition := replace(
    v_definition,
    $block$  create temporary table tmp_retired_serial_transfer_items (
    material_id uuid not null,
    quantity numeric not null,
    serial_number text not null,
    lot_code text not null
  ) on commit drop;$block$,
    $block$  create temporary table if not exists tmp_retired_serial_transfer_items (
    material_id uuid not null,
    quantity numeric not null,
    serial_number text not null,
    lot_code text not null
  ) on commit drop;

  truncate table pg_temp.tmp_retired_serial_transfer_items;$block$
  );

  if v_definition = v_original then
    raise exception
      'Nao foi possivel atualizar save_stock_transfer_record_direct_purchase_v209 para reutilizar a tabela temporaria.';
  end if;

  execute v_definition;
end;
$$;
