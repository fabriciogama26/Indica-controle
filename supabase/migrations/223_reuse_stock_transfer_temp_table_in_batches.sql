-- 223_reuse_stock_transfer_temp_table_in_batches.sql
-- Permite reutilizar a tabela temporaria principal de itens durante lotes atomicos.

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
    $block$  create temporary table tmp_stock_transfer_items (
    material_id uuid not null,
    material_code text not null,
    material_description text not null,
    quantity numeric not null,
    serial_number text,
    lot_code text,
    is_transformer boolean not null
  ) on commit drop;$block$,
    $block$  create temporary table if not exists tmp_stock_transfer_items (
    material_id uuid not null,
    material_code text not null,
    material_description text not null,
    quantity numeric not null,
    serial_number text,
    lot_code text,
    is_transformer boolean not null
  ) on commit drop;

  truncate table pg_temp.tmp_stock_transfer_items;$block$
  );

  if v_definition = v_original then
    raise exception
      'Nao foi possivel atualizar save_stock_transfer_record_base_v181 para reutilizar a tabela temporaria.';
  end if;

  execute v_definition;
end;
$$;
