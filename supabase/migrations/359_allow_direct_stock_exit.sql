-- 359_allow_direct_stock_exit.sql
-- Permite registrar Saida de estoque sem vinculo obrigatorio com projeto (Saida direta),
-- reaproveitando a flag stock_transfers.direct_purchase ja usada pela Entrada (Compra direta).

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
    $block$  if v_direct_purchase and v_movement_type <> 'ENTRY' and nullif(btrim(coalesce(p_notes, '')), '') not ilike 'ESTORNO%' then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'DIRECT_PURCHASE_ENTRY_ONLY',
      'message', 'Compra direta e permitida somente para operacao Entrada.'
    );
  end if;$block$,
    $block$  if v_direct_purchase and v_movement_type not in ('ENTRY', 'EXIT') and nullif(btrim(coalesce(p_notes, '')), '') not ilike 'ESTORNO%' then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'DIRECT_MOVEMENT_ENTRY_OR_EXIT_ONLY',
      'message', 'Movimentacao direta e permitida somente para Entrada e Saida.'
    );
  end if;$block$
  );

  if v_definition = v_original then
    raise exception
      'Nao foi possivel atualizar save_stock_transfer_record_direct_purchase_v209 para liberar Saida direta.';
  end if;

  execute v_definition;
end;
$$;

do $$
declare
  v_source text;
begin
  select p.prosrc
  into v_source
  from pg_proc p
  where p.oid = 'public.save_stock_transfer_record_direct_purchase_v209(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb, boolean)'::regprocedure;

  if v_source is null or position('DIRECT_MOVEMENT_ENTRY_OR_EXIT_ONLY' in v_source) = 0 then
    raise exception
      'save_stock_transfer_record_direct_purchase_v209 nao ficou com o bloqueio de movimentacao direta atualizado.';
  end if;

  if position('DIRECT_PURCHASE_ENTRY_ONLY' in v_source) > 0 then
    raise exception
      'save_stock_transfer_record_direct_purchase_v209 ainda mantem o bloqueio antigo de compra direta.';
  end if;

  if position('tmp_retired_serial_transfer_items' in v_source) = 0 then
    raise exception
      'save_stock_transfer_record_direct_purchase_v209 perdeu o tratamento de seriais RET.';
  end if;
end;
$$;
